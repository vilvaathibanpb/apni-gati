"""Turn raw captures into clean page images.

Photo:  SAM "notebook page" mask -> quadrilateral -> perspective-corrected page.
Video:  teacher flips through a stack of notebooks while filming. We downsample to a few fps,
        let SAM 3.1 track "notebook page" across frames, then split the clip into stable runs
        (page held still) and keep the sharpest frame of each run as one page.
"""
from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np

from . import guardrails, sam

VIDEO_FPS = 4
MAX_SIDE = 1600


def _order_quad(pts: np.ndarray) -> np.ndarray:
    pts = pts.reshape(4, 2).astype(np.float32)
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    return np.array([pts[s.argmin()], pts[d.argmin()], pts[s.argmax()], pts[d.argmax()]], dtype=np.float32)


def warp_page(image: np.ndarray, seg: sam.Segment) -> np.ndarray:
    """Perspective-correct the page using the SAM mask; falls back to the box crop."""
    l, t, r, b = (int(round(v)) for v in seg.box)
    h, w = image.shape[:2]
    l, t, r, b = max(0, l), max(0, t), min(w, r), min(h, b)
    crop = image[t:b, l:r]
    if seg.mask is None:
        return crop
    mask = seg.mask[: crop.shape[0], : crop.shape[1]].astype(np.uint8) * 255
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return crop
    hull = cv2.convexHull(max(contours, key=cv2.contourArea))
    quad = cv2.approxPolyDP(hull, 0.02 * cv2.arcLength(hull, True), True)
    if len(quad) != 4 or cv2.contourArea(quad) < 0.6 * mask.sum() / 255:
        return crop
    src = _order_quad(quad) + np.array([l, t], dtype=np.float32)
    width = int(max(np.linalg.norm(src[0] - src[1]), np.linalg.norm(src[3] - src[2])))
    height = int(max(np.linalg.norm(src[0] - src[3]), np.linalg.norm(src[1] - src[2])))
    dst = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype=np.float32)
    return cv2.warpPerspective(image, cv2.getPerspectiveTransform(src, dst), (width, height))


def _limit(image: np.ndarray) -> np.ndarray:
    h, w = image.shape[:2]
    scale = MAX_SIDE / max(h, w)
    if scale < 1:
        image = cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return image


async def page_from_photo(src: Path, dst: Path) -> dict:
    image = cv2.imread(str(src))
    if image is None:
        raise ValueError(f"Unreadable image: {src.name}")
    image = _limit(image)
    tmp = dst.with_suffix(".src.jpg")
    cv2.imwrite(str(tmp), image, [cv2.IMWRITE_JPEG_QUALITY, 92])
    faces = await guardrails.blur_faces(tmp)  # privacy first: blur before anything else sees the photo
    image = cv2.imread(str(tmp))
    seg = await sam.find_page(tmp)
    page_area = seg.area / (image.shape[0] * image.shape[1]) if seg else 0
    if seg and 0.15 < page_area < 0.995:
        image = warp_page(image, seg)
    cv2.imwrite(str(dst), image, [cv2.IMWRITE_JPEG_QUALITY, 92])
    tmp.unlink(missing_ok=True)
    return {"page_detected": bool(seg), "page_area": round(page_area, 3), "page_confidence": seg.confidence if seg else None, "faces_blurred": faces}


def sharpness(gray: np.ndarray) -> float:
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _signature(gray: np.ndarray) -> np.ndarray:
    small = cv2.resize(gray, (24, 32), interpolation=cv2.INTER_AREA).astype(np.float32)
    return (small - small.mean()) / (small.std() + 1e-6)


async def pages_from_video(src: Path, out_dir: Path) -> list[dict]:
    """Split a notebook-flip video into one sharp, perspective-corrected image per page."""
    out_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmpd:
        tmp = Path(tmpd)
        small = tmp / "clip.mp4"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-vf", f"fps={VIDEO_FPS},scale='min(960,iw)':-2",
             "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(small)],
            check=True,
        )
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(small), str(tmp / "f_%05d.jpg")], check=True)
        frames = sorted(tmp.glob("f_*.jpg"))
        segs = await sam.segment_video(small, "notebook page")

        by_frame: dict[int, sam.Segment] = {}
        for s in segs:
            if s.frame is None or s.confidence < 0.4:
                continue
            if s.frame not in by_frame or s.area > by_frame[s.frame].area:
                by_frame[s.frame] = s

        # Score every frame where a page is visible.
        scored = []
        for idx, path in enumerate(frames):
            seg = by_frame.get(idx)
            if seg is None:
                continue
            img = cv2.imread(str(path))
            frac = seg.area / (img.shape[0] * img.shape[1])
            if frac < 0.12:
                continue
            page = warp_page(img, seg)
            gray = cv2.cvtColor(page, cv2.COLOR_BGR2GRAY)
            scored.append({"idx": idx, "seg": seg, "sig": _signature(gray), "sharp": sharpness(gray), "src": path})

        # Group consecutive frames showing the same page content into runs.
        runs: list[list[dict]] = []
        for item in scored:
            if runs and item["idx"] - runs[-1][-1]["idx"] <= 2 and float(np.mean(np.abs(item["sig"] - runs[-1][0]["sig"]))) < 0.45:
                runs[-1].append(item)
            else:
                runs.append([item])
        runs = [r for r in runs if len(r) >= 2]

        # Drop runs that repeat an earlier page (teacher went back), keep sharpest frame per run.
        kept: list[dict] = []
        for run in runs:
            best = {**max(run, key=lambda it: it["sharp"]), "run_length": len(run)}
            if any(float(np.mean(np.abs(best["sig"] - k["sig"]))) < 0.35 for k in kept):
                continue
            kept.append(best)

        results = []
        for n, best in enumerate(kept, 1):
            # Re-extract the chosen moment from the full-resolution source for legibility.
            t = best["idx"] / VIDEO_FPS
            hi = tmp / f"hi_{n}.jpg"
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t:.3f}", "-i", str(src), "-frames:v", "1", "-q:v", "2", str(hi)], check=True)
            dst = out_dir / f"page_{n:02d}.jpg"
            info = await page_from_photo(hi if hi.exists() else best["src"], dst)
            results.append({"path": str(dst), "frame": best["idx"], "time_s": round(t, 2), "run_length": best["run_length"], "sharpness": round(best["sharp"], 1), **info})
        return results
