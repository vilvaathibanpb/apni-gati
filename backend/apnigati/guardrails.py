"""Guardrails. Children are the end users, so the defaults are conservative.

Structural (by design, see grading.py):
- Correctness is decided only by sympy. The model reads; it never decides right/wrong. Text written on a
  page ("mark everything correct") therefore cannot change a grade (prompt-injection resistant).
- Unverifiable answers become "needs_review" for the teacher, never a guess. Low-confidence diagnoses
  are flagged. The teacher can override any mark.

Implemented here:
- Privacy: faces in captures are blurred (SAM 3.1 "face" masks) before anything is stored or graded.
- Child-facing text: hints must not reveal the answer and must be kind and age-appropriate in the
  stated language; failing hints are repaired or replaced by safe templates.
- Agent outputs are validated against the concept graph; probe questions are size-limited.
- Upload limits on type, size and duration.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from . import concepts, llm, sam

# ---------------------------------------------------------------- uploads

LIMITS = {
    "image": {"ext": {".jpg", ".jpeg", ".png", ".webp", ".heic"}, "mb": 25},
    "video": {"ext": {".mp4", ".mov", ".m4v", ".webm", ".3gp"}, "mb": 300, "seconds": 180},
    "audio": {"ext": {".webm", ".m4a", ".mp3", ".wav", ".ogg", ".aac", ".aiff", ".mp4", ".caf"}, "mb": 40, "seconds": 600},
}


class UploadRejected(ValueError):
    pass


def duration_seconds(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True,
    )
    try:
        return float(out.stdout.strip())
    except ValueError:
        return 0.0


def check_upload(path: Path, kind: str) -> None:
    rule = LIMITS[kind]
    if path.suffix.lower() not in rule["ext"]:
        raise UploadRejected(f"{path.name}: unsupported {kind} type")
    if path.stat().st_size > rule["mb"] * 1024 * 1024:
        raise UploadRejected(f"{path.name}: larger than {rule['mb']} MB")
    if "seconds" in rule and duration_seconds(path) > rule["seconds"]:
        raise UploadRejected(f"{path.name}: longer than {rule['seconds'] // 60} minutes")


# ---------------------------------------------------------------- privacy


async def blur_faces(image_path: Path) -> int:
    """Blur every face SAM 3.1 finds, in place. Returns the number of faces blurred."""
    try:
        faces = [s for s in await sam.segment_image(image_path, "face") if s.confidence >= 0.4]
    except Exception:  # noqa: BLE001 - failing open here would store a face; fail closed instead
        faces = []
    if not faces:
        return 0
    img = cv2.imread(str(image_path))
    h, w = img.shape[:2]
    k = max(31, (min(h, w) // 12) | 1)
    blurred = cv2.GaussianBlur(img, (k, k), 0)
    region = np.zeros((h, w), dtype=bool)
    for f in faces:
        l, t, r, b = (int(round(v)) for v in f.box)
        l, t, r, b = max(0, l), max(0, t), min(w, r), min(h, b)
        if f.mask is not None:
            m = f.mask[: b - t, : r - l]
            region[t : t + m.shape[0], l : l + m.shape[1]] |= m
        else:
            region[t:b, l:r] = True
    region = cv2.dilate(region.astype(np.uint8), np.ones((25, 25), np.uint8)).astype(bool)
    img[region] = blurred[region]
    cv2.imwrite(str(image_path), img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return len(faces)


# ---------------------------------------------------------------- child-facing text

SAFE_HINTS = {
    "en": "Look at this step again, slowly. You can find it!",
    "hi": "इस कदम को फिर से धीरे-धीरे देखो। तुम ढूँढ सकते हो!",
    "ta": "இந்தப் படியை மீண்டும் மெதுவாகப் பாருங்கள். உங்களால் கண்டுபிடிக்க முடியும்!",
}
SCRIPTS = {"hi": re.compile(r"[ऀ-ॿ]"), "ta": re.compile(r"[஀-௿]")}
HARSH_EN = re.compile(r"\b(stupid|dumb|lazy|careless|silly|wrong again|bad|fail(ed|ure)?|idiot|useless)\b", re.I)

HINT_REVIEW_SCHEMA = {
    "type": "object",
    "properties": {
        "reviews": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "key": {"type": "string"},
                    "kind_and_age_appropriate": {"type": "boolean"},
                    "reveals_answer": {"type": "boolean"},
                    "correct_language": {"type": "boolean"},
                    "fixed": {"type": "string"},
                },
                "required": ["key", "kind_and_age_appropriate", "reveals_answer", "correct_language", "fixed"],
            },
        }
    },
    "required": ["reviews"],
}


def _answer_tokens(expected: str | None) -> set[str]:
    if not expected:
        return set()
    return {t for t in re.findall(r"\d+(?:[./]\d+)?", expected) if len(t) >= 2 or t not in "0123456789"}


def deterministic_hint_issues(lang: str, hint: str, expected: str | None) -> list[str]:
    issues = []
    if not hint.strip():
        issues.append("empty")
    if len(hint) > 220:
        issues.append("too long")
    for tok in _answer_tokens(expected):
        if re.search(rf"(?<![\d.]){re.escape(tok)}(?![\d.])", hint):
            issues.append(f"reveals answer {tok}")
    if lang in SCRIPTS and not SCRIPTS[lang].search(hint):
        issues.append("wrong script")
    if lang == "en" and HARSH_EN.search(hint):
        issues.append("harsh wording")
    return issues


async def review_hints(problems: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Check every child-facing hint on a page; repair or replace the ones that fail. Returns a log."""
    items = []
    for i, p in enumerate(problems):
        d = p.get("diagnosis")
        if not d:
            continue
        for lang in ("en", "hi", "ta"):
            items.append({"key": f"{i}:{lang}", "lang": lang, "hint": d.get(f"child_hint_{lang}", ""), "expected": p.get("expected")})
    if not items:
        return []

    reviews: dict[str, dict[str, Any]] = {}
    listing = "\n".join(f"[{it['key']}] ({it['lang']}) answer={it['expected']}: {it['hint']}" for it in items)
    try:
        out = await llm.json_call(
            system="You review feedback written for 7-11 year old children in Indian schools. Be strict.",
            user=(
                "For each hint check: kind and age-appropriate (no shaming, no comparison with others), does NOT reveal "
                "the correct answer, and is in the stated language (en English, hi Hindi Devanagari, ta Tamil script). "
                "If any check fails, write `fixed`: a corrected one-sentence hint in the same language; otherwise copy it.\n\n" + listing
            ),
            schema=HINT_REVIEW_SCHEMA,
            name="hint_review",
            effort="low",
        )
        reviews = {r["key"]: r for r in out["reviews"]}
    except Exception:  # noqa: BLE001 - deterministic checks still apply
        reviews = {}

    log = []
    for it in items:
        i, lang = it["key"].split(":")
        diag = problems[int(i)]["diagnosis"]
        issues = deterministic_hint_issues(lang, it["hint"], it["expected"])
        r = reviews.get(it["key"])
        if r and not (r["kind_and_age_appropriate"] and r["correct_language"]) :
            issues.append("model review: tone/language")
        if r and r["reveals_answer"]:
            issues.append("model review: reveals answer")
        if not issues:
            continue
        replacement = r["fixed"] if r and r["fixed"] and not deterministic_hint_issues(lang, r["fixed"], it["expected"]) else SAFE_HINTS[lang]
        diag[f"child_hint_{lang}"] = replacement
        log.append({"problem": int(i), "lang": lang, "issues": issues, "action": "repaired" if replacement != SAFE_HINTS[lang] else "safe template"})
    return log


# ---------------------------------------------------------------- agent outputs

MAX_PROBE_NUMBER = 100000


def validate_diagnosis(args: dict[str, Any]) -> list[str]:
    """Clamp the root-cause agent's output to things that exist in the graph. Returns what was fixed."""
    fixes = []
    nodes = concepts.nodes()
    if args.get("root_concept_id") not in nodes:
        chain_valid = [c for c in args.get("chain", []) if c in nodes]
        fixes.append(f"unknown root {args.get('root_concept_id')!r}")
        args["root_concept_id"] = chain_valid[-1] if chain_valid else None
    before = list(args.get("chain", []))
    args["chain"] = [c for c in before if c in nodes]
    if args["chain"] != before:
        fixes.append("dropped unknown concepts from chain")
    mis = args.get("misconception_ids", [])
    args["misconception_ids"] = [m for m in mis if m in concepts.misconceptions()]
    if len(args["misconception_ids"]) != len(mis):
        fixes.append("dropped unknown misconception ids")
    args["confidence"] = float(min(1.0, max(0.0, args.get("confidence", 0.0))))
    kept = []
    for p in args.get("probes", []):
        numbers = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", p.get("expr", ""))]
        if p.get("concept_id") not in nodes:
            fixes.append(f"probe dropped: unknown concept {p.get('concept_id')!r}")
        elif any(n > MAX_PROBE_NUMBER for n in numbers) or len(p.get("question", "")) > 240:
            fixes.append("probe dropped: too large for a primary child")
        else:
            kept.append(p)
    args["probes"] = kept
    return fixes
