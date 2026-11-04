"""SAM 3.1 on Meta Model API: page detection, page tracking through a notebook-flip video, ink masks.

Findings from probing SAM 3.1 on notebook photos (see README):
- "notebook page" segments the physical page reliably (conf ~0.9) -> crop + video page tracking.
- "number" returns one mask per handwritten digit cluster -> pixel-tight red-pen circles.
- Abstract phrases like "handwritten text line" return nothing; Muse Spark does the reading.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import meta_sam_parser as msp
import numpy as np
from PIL import Image

from . import config, llm


@dataclass
class Segment:
    object_id: str
    frame: int | None
    box: tuple[float, float, float, float]  # left, top, right, bottom in source pixels
    confidence: float
    mask: np.ndarray | None  # bool array covering `box`

    @property
    def area(self) -> float:
        l, t, r, b = self.box
        return max(0.0, r - l) * max(0.0, b - t)


def _collect(result) -> list[Segment]:
    boxes: dict[tuple[str, int | None], msp.SegmentationBoxRecord] = {}
    masks: dict[tuple[str, int | None], msp.SegmentationMaskRecord] = {}
    for rec in result.records:
        frame = rec.frame.frame_index if getattr(rec, "frame", None) else None
        if rec.kind == "box":
            boxes[(rec.object_id, frame)] = rec
        elif rec.kind == "mask":
            masks[(rec.object_id, frame)] = rec
    out: list[Segment] = []
    for key, box in boxes.items():
        mask_arr = None
        mrec = masks.get(key)
        if mrec is not None:
            raw = np.frombuffer(msp.decode_mask_to_raster(mrec.mask), dtype=np.uint8)
            raster = raw.reshape(mrec.mask.height, mrec.mask.width)
            w = max(1, round(box.right - box.left))
            h = max(1, round(box.bottom - box.top))
            if raster.shape != (h, w):
                raster = np.array(Image.fromarray(raster * 255).resize((w, h), Image.NEAREST)) > 127
            mask_arr = raster.astype(bool)
        out.append(
            Segment(
                object_id=box.object_id,
                frame=key[1],
                box=(box.left, box.top, box.right, box.bottom),
                confidence=box.confidence if box.confidence is not None else 1.0,
                mask=mask_arr,
            )
        )
    return out


async def segment_image(image_path: str | Path, concept: str) -> list[Segment]:
    llm.guard_budget()
    llm.record(config.SAM, f"sam:{concept}", unit="sam_image", units=1)
    stream = await llm.meta.responses.create(
        model=config.SAM,
        stream=True,
        metadata={"include_confidence": "true"},
        input=[{
            "type": "message",
            "role": "user",
            "content": [
                {"type": "input_text", "text": concept},
                {"type": "input_image", "image_url": llm.data_url(image_path)},
            ],
        }],
    )
    result = await msp.parse_responses_stream(stream, msp.image_segmentation_format()).final_result()
    return _collect(result)


async def segment_video(video_path: str | Path, concept: str) -> list[Segment]:
    llm.guard_budget()
    with open(video_path, "rb") as fh:
        uploaded = await llm.meta.files.create(file=fh, purpose="user_data")
    stream = await llm.meta.responses.create(
        model=config.SAM,
        stream=True,
        metadata={"include_confidence": "true", "mask_encoding": "one_bit"},
        input=[{
            "type": "message",
            "role": "user",
            "content": [
                {"type": "input_text", "text": concept},
                {"type": "input_video", "file_id": uploaded.id},
            ],
        }],
    )
    result = await msp.parse_responses_stream(stream, msp.video_segmentation_format()).final_result()
    segs = _collect(result)
    frames = max(50, max((s.frame or 0 for s in segs), default=0) + 1)  # billed per frame, 50 minimum
    llm.record(config.SAM, f"sam-video:{concept}", unit="sam_frame", units=frames)
    return segs


async def find_page(image_path: str | Path) -> Segment | None:
    """Largest confident notebook page in a photo, or None (then we use the whole photo)."""
    try:
        segs = await segment_image(image_path, "notebook page")
    except Exception:
        return None
    segs = [s for s in segs if s.confidence >= 0.5]
    return max(segs, key=lambda s: s.area, default=None)


async def ink_segments(image_path: str | Path) -> list[Segment]:
    """Per-digit ink masks. Used to tighten red-pen marks around exactly what the child wrote."""
    try:
        segs = await segment_image(image_path, "number")
    except Exception:
        return []
    return [s for s in segs if s.confidence >= 0.3]
