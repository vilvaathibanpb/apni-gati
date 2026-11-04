"""Render the benchmark notebook pages with Muse Image.  Run: uv run python -m evals.gen_grading_set [page_id ...]"""
from __future__ import annotations

import asyncio
import base64
import sys

import cv2
import numpy as np

from apnigati import config, llm

from .grading_specs import PAGES

OUT = config.ROOT_DIR / "data" / "eval" / "pages"

LAYOUT = {
    "+": "written vertically in columns (tens under tens, ones under ones), a line, and the answer under the line",
    "-": "written vertically in columns (tens under tens, ones under ones), a line, and the answer under the line",
    "×": "written vertically in columns, a line, and the answer under the line",
    "÷": "written in the Indian long-division layout (divisor on the left, dividend inside the bracket, quotient on top)",
}


def prompt_for(page: dict) -> str:
    if page.get("custom_prompt"):
        return page["custom_prompt"]
    lines = []
    for i, p in enumerate(page["problems"], 1):
        if p.get("compare"):
            left, right = (s.strip() for s in p["q"].split("?"))
            lines.append(f"{i}. compare {left} and {right}: the child wrote '{left} {p['a']} {right}'")
        elif "/" in p["q"]:
            lines.append(f"{i}. '{p['q']} = {p['a']}' written on one line with stacked fractions")
        else:
            op = next(o for o in "+-×÷" if o in p["q"])
            lines.append(f"{i}. {p['q']} {LAYOUT[op]}; the child's answer is {p['a']}")
    return (
        "Photo taken with a phone, top-down, of one page of a ruled Indian school exercise notebook. "
        f"At the top in a Class {page['class']} child's pencil handwriting: 'Name: {page['student']}' and '{page['title']}'. "
        "Below, the child's pencil work, numbered, exactly these problems with exactly these answers "
        "(some answers are wrong on purpose; copy them exactly as given, do not fix them):\n"
        + "\n".join(lines)
        + (f"\n{page['extra']}" if page.get("extra") else "")
        + "\nNo ticks, crosses, stars, teacher marks, grades or comments. No extra problems. No printed logos or brand names. "
        "Natural daylight, slight shadow, realistic paper texture, legible child handwriting."
    )


async def render(page: dict) -> None:
    resp = await llm.responses_text(purpose="eval_render", model=config.IMAGE, input=prompt_for(page))
    b64 = next(o.result for o in resp.output if o.type == "image_generation_call")
    img = cv2.imdecode(np.frombuffer(base64.b64decode(b64), np.uint8), cv2.IMREAD_COLOR)
    cv2.imwrite(str(OUT / f"{page['id']}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 93])
    print("rendered", page["id"])


async def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    wanted = set(sys.argv[1:])
    pages = [p for p in PAGES if not wanted or p["id"] in wanted]
    await asyncio.gather(*[render(p) for p in pages])


if __name__ == "__main__":
    asyncio.run(main())
