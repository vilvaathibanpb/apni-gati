"""Printable, illustrated practice worksheets with Muse Image, verified after rendering.

Image models can mis-render digits. So after Muse Image draws the sheet, Muse Spark reads it back
and we compare every rendered question with the sympy-verified source items. Mismatch -> regenerate
(up to 2 attempts) and report what was checked.
"""
from __future__ import annotations

import base64
from pathlib import Path
from typing import Any

from . import config, llm, verifier

READBACK_SCHEMA = {
    "type": "object",
    "properties": {"questions": {"type": "array", "items": {"type": "object", "properties": {"text": {"type": "string"}, "expr": {"type": "string"}}, "required": ["text", "expr"]}}},
    "required": ["questions"],
}


def _prompt(title: str, items: list[dict[str, Any]], language: str) -> str:
    lines = "\n".join(f"{i}. {it['question']}" for i, it in enumerate(items, 1))
    return (
        "A clean, printable A4 maths worksheet for Indian primary school children, portrait, white background, "
        "black text with a few simple colourful line illustrations in the margins (mangoes, a cricket bat, a bus ticket, rupee coins). "
        f"Title at top: \"{title}\". Under the title: \"Name: ________   Date: ________\". "
        "Then these numbered questions EXACTLY as written, each with space to work below it:\n"
        f"{lines}\n"
        f"Short instructions line in {language} and English. No answers on the sheet. No logos or brand names. "
        "Large clear printed digits."
    )


def _same(expected: str, got: str) -> bool:
    try:
        return verifier.evaluate(expected.replace("?", "-")) == verifier.evaluate(got.replace("?", "-"))
    except Exception:  # noqa: BLE001
        return expected.replace(" ", "") == got.replace(" ", "")


async def make_worksheet(title: str, items: list[dict[str, Any]], language: str, out_path: Path) -> dict[str, Any]:
    items = items[:6]
    checks: list[dict[str, Any]] = []
    for attempt in range(1, 3):
        resp = await llm.responses_text(purpose="worksheet", model=config.IMAGE, input=_prompt(title, items, language))
        b64 = next(o.result for o in resp.output if o.type == "image_generation_call")
        out_path.write_bytes(base64.b64decode(b64))

        readback = await llm.json_call(
            system="You read printed worksheets exactly as printed.",
            user="List every numbered question on this worksheet in order. expr = the arithmetic in the question as a plain expression with + - * / (use '?' between two values being compared).",
            schema=READBACK_SCHEMA,
            name="worksheet_readback",
            images=[llm.data_url(out_path, "image/webp")],
            effort="low",
        )
        got = readback["questions"]
        mismatches = [
            {"n": i + 1, "expected": it["expr"], "rendered": got[i]["expr"] if i < len(got) else None}
            for i, it in enumerate(items)
            if i >= len(got) or not _same(it["expr"], got[i]["expr"])
        ]
        checks.append({"attempt": attempt, "rendered_questions": len(got), "mismatches": mismatches})
        if not mismatches:
            break
    return {"image_path": str(out_path), "items": items, "verification": checks, "verified": not checks[-1]["mismatches"]}
