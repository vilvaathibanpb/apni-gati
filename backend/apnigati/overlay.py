"""Render teacher-style red-pen marks onto the page photo."""
from __future__ import annotations

import math
import random
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

RED = (210, 22, 32, 235)
AMBER = (214, 128, 0, 235)
FONT_PATH = Path(__file__).parent / "assets" / "Caveat.ttf"


def _font(size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(str(FONT_PATH), size)
    except OSError:
        return ImageFont.load_default(size)


def _stroke(draw: ImageDraw.ImageDraw, pts: list[tuple[float, float]], color, width: int) -> None:
    draw.line(pts, fill=color, width=width, joint="curve")
    for p in (pts[0], pts[-1]):
        draw.ellipse((p[0] - width / 2, p[1] - width / 2, p[0] + width / 2, p[1] + width / 2), fill=color)


def pen_ellipse(draw, box, color, width, rng: random.Random) -> None:
    """A loose hand-drawn loop that overshoots its start, like a teacher circling an answer."""
    x1, y1, x2, y2 = box
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    rx, ry = (x2 - x1) / 2 + width * 3, (y2 - y1) / 2 + width * 3
    start = rng.uniform(0, 2 * math.pi)
    pts = []
    steps = 64
    for i in range(steps + 9):
        a = start + 2 * math.pi * i / steps
        wobble = 1 + 0.04 * math.sin(3 * a + start) + rng.uniform(-0.01, 0.01)
        grow = 1 + 0.06 * i / steps
        pts.append((cx + rx * wobble * grow * math.cos(a), cy + ry * wobble * grow * math.sin(a)))
    _stroke(draw, pts, color, width)


def pen_tick(draw, x, y, size, color, width) -> None:
    _stroke(draw, [(x, y), (x + size * 0.35, y + size * 0.45), (x + size, y - size * 0.55)], color, width)


def pen_cross(draw, x, y, size, color, width) -> None:
    _stroke(draw, [(x, y - size / 2), (x + size, y + size / 2)], color, width)
    _stroke(draw, [(x + size, y - size / 2), (x, y + size / 2)], color, width)


def render(page: Image.Image, result: dict[str, Any], out_path: Path) -> None:
    img = page.convert("RGBA")
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    rng = random.Random(7)
    unit = max(img.size) / 1000
    width = max(3, round(4 * unit))
    note_font = _font(max(22, round(34 * unit)))

    for p in result["problems"]:
        ax1, ay1, ax2, ay2 = p.get("answer_ink_px") or p["answer_px"]
        mark = max(18, (ay2 - ay1) * 0.9, 26 * unit)
        if p["status"] == "correct":
            pen_tick(draw, ax2 + mark * 0.4, (ay1 + ay2) / 2, mark, RED, width)
            continue
        if p["status"] == "needs_review":
            draw.text((ax2 + mark * 0.4, ay1 - mark * 0.2), "?", font=_font(round(mark * 1.4)), fill=AMBER)
            continue
        pen_cross(draw, ax2 + mark * 0.4, (ay1 + ay2) / 2, mark * 0.8, RED, width)
        target = None
        if p["error_step"] is not None:
            step = p["steps"][p["error_step"]]
            target = step.get("ink_px") or step["box_px"]
        target = target or p.get("answer_ink_px") or p["answer_px"]
        pen_ellipse(draw, target, RED, width, rng)
        note = (p.get("diagnosis") or {}).get("pen_note") or (f"= {p['expected']}" if p.get("expected") else "")
        if note:
            tx = min(target[2] + 14 * unit, img.width - note_font.getlength(note) - 8)
            draw.text((tx, target[1] - 4 * unit), note, font=note_font, fill=RED)

    score = result["score"]
    if score["total"]:
        label = f"{score['correct']}/{score['total']}"
        f = _font(max(40, round(64 * unit)))
        tw = f.getlength(label)
        x, y = img.width - tw - 70 * unit, 40 * unit
        draw.text((x, y), label, font=f, fill=RED)
        pen_ellipse(draw, (x - 6 * unit, y + 10 * unit, x + tw + 6 * unit, y + f.size), RED, width, rng)

    Image.alpha_composite(img, layer).convert("RGB").save(out_path, quality=92)
