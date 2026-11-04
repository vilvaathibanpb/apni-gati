"""Oral reading assessment (ASER-style) with Muse Voice Transcribe.

The child reads a levelled passage aloud. We transcribe WITHOUT keyword biasing toward the passage
(biasing would make the recogniser "hear" the right words and hide real misreadings), align the
transcript to the passage word by word, and compute accuracy, words-correct-per-minute and a level.
Muse Spark then explains the error pattern to the teacher (matra confusions, conjuncts, skipped lines).
"""
from __future__ import annotations

import json
import re
import subprocess
import tempfile
import unicodedata
import wave
from difflib import SequenceMatcher
from functools import lru_cache
from pathlib import Path
from typing import Any

import httpx

from . import config, llm

LEVEL_ORDER = ["letters", "words", "paragraph", "story"]
NUKTA = "़"
PUNCT = re.compile(r"[।॥.,!?;:'\"“”‘’()\-–—]")


@lru_cache(maxsize=1)
def passages() -> dict[str, dict[str, Any]]:
    data = json.loads(config.PASSAGES_PATH.read_text())
    return {p["id"]: p for p in data["passages"]}


def to_wav(src: Path, dst: Path) -> float:
    """Any phone recording -> 16 kHz mono 16-bit WAV (what the transcribe endpoint accepts). Returns seconds."""
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", str(dst)], check=True)
    with wave.open(str(dst)) as w:
        return w.getnframes() / w.getframerate()


async def transcribe(wav: Path, language: str | None) -> str:
    llm.guard_budget()
    with wave.open(str(wav)) as w:
        llm.record(config.ASR, "transcribe", unit="asr_hour", units=w.getnframes() / w.getframerate() / 3600)
    request = {"model": config.ASR, "audioEncoding": "WAV", "mode": "PUSH_TO_TALK"}
    if language:
        request["languageBias"] = [language]
    async with httpx.AsyncClient(timeout=180) as client:
        resp = await client.post(
            f"{config.META_BASE_URL}/asr/transcribe",
            headers={"Authorization": f"Bearer {config.MODEL_API_KEY}", "Accept": "application/json"},
            files={
                "request": (None, json.dumps(request), "application/json"),
                "audio": (wav.name, wav.read_bytes(), "audio/wav"),
            },
        )
    resp.raise_for_status()
    return resp.json().get("transcript", "")


def normalise_word(word: str) -> str:
    w = unicodedata.normalize("NFC", PUNCT.sub("", word)).lower()
    w = w.replace(NUKTA, "").replace("ँ", "ं")  # nukta and chandrabindu vary in ASR output
    return w


def tokens(text: str) -> list[str]:
    return [t for t in (normalise_word(w) for w in text.split()) if t]


def align(reference: list[str], spoken: list[str]) -> list[dict[str, Any]]:
    """Word-level alignment: correct / near (minor slip) / substituted / omitted / inserted."""
    ops: list[dict[str, Any]] = []
    sm = SequenceMatcher(a=reference, b=spoken, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            ops += [{"op": "correct", "ref": reference[i], "said": spoken[j1 + k]} for k, i in enumerate(range(i1, i2))]
        elif tag == "delete":
            ops += [{"op": "omitted", "ref": reference[i], "said": None} for i in range(i1, i2)]
        elif tag == "insert":
            ops += [{"op": "inserted", "ref": None, "said": spoken[j]} for j in range(j1, j2)]
        else:
            ref, said = reference[i1:i2], spoken[j1:j2]
            for k in range(max(len(ref), len(said))):
                r = ref[k] if k < len(ref) else None
                s = said[k] if k < len(said) else None
                if r and s:
                    sim = SequenceMatcher(a=r, b=s).ratio()
                    ops.append({"op": "near" if sim >= 0.8 else "substituted", "ref": r, "said": s, "similarity": round(sim, 2)})
                elif r:
                    ops.append({"op": "omitted", "ref": r, "said": None})
                else:
                    ops.append({"op": "inserted", "ref": None, "said": s})
    return ops


def score(passage: dict[str, Any], ops: list[dict[str, Any]], seconds: float) -> dict[str, Any]:
    n_ref = sum(1 for o in ops if o["ref"])
    correct = sum(1 for o in ops if o["op"] in ("correct", "near"))
    errors = sum(1 for o in ops if o["op"] in ("substituted", "omitted"))
    accuracy = correct / n_ref if n_ref else 0.0
    wcpm = correct / (seconds / 60) if seconds > 1 else None
    # ASER rule of thumb: a level is "read" with at most ~3 mistakes for paragraph/story, 4/5 words for word list.
    passed = errors <= 3 if passage["level"] in ("paragraph", "story") else accuracy >= 0.8
    idx = LEVEL_ORDER.index(passage["level"])
    level = passage["level"] if passed else (LEVEL_ORDER[idx - 1] + " (to confirm)" if idx > 0 else "beginner")
    next_test = None if passed and idx == len(LEVEL_ORDER) - 1 else (LEVEL_ORDER[idx + 1] if passed else LEVEL_ORDER[max(idx - 1, 0)])
    return {
        "words": n_ref, "correct": correct, "errors": errors, "accuracy": round(accuracy, 3),
        "wcpm": round(wcpm, 1) if wcpm else None, "seconds": round(seconds, 1),
        "passed": passed, "level": level, "next_test": next_test,
    }


ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "patterns": {"type": "array", "items": {"type": "object", "properties": {"pattern": {"type": "string"}, "examples": {"type": "array", "items": {"type": "string"}}}, "required": ["pattern", "examples"]}},
        "teacher_tip": {"type": "string"},
        "asr_caveat": {"type": "string"},
    },
    "required": ["patterns", "teacher_tip", "asr_caveat"],
}


async def analyse(passage: dict[str, Any], ops: list[dict[str, Any]]) -> dict[str, Any]:
    errors = [o for o in ops if o["op"] in ("substituted", "omitted", "inserted", "near")]
    if not errors:
        return {"patterns": [], "teacher_tip": "Read accurately. Move to the next level or check comprehension.", "asr_caveat": ""}
    return await llm.json_call(
        system=f"You are a {passage['language']} early-literacy specialist helping a primary teacher in India. Write in English; quote words in the original script with an English gloss in brackets.",
        user=(
            f"A child read this {passage['level']} passage aloud:\n{passage['text']}\n\n"
            f"Word alignment from speech recognition (ref = printed word, said = what was heard):\n"
            + "\n".join(json.dumps(e, ensure_ascii=False) for e in errors[:40])
            + "\n\nGroup the errors into decoding patterns (e.g. vowel sign / matra confusion, similar-looking letters, "
            "conjunct consonants, skipped line, guessing from first letter). Give one concrete 5-minute activity as teacher_tip. "
            "In asr_caveat note any 'errors' that may be speech-recognition artefacts rather than the child's mistake."
        ),
        schema=ANALYSIS_SCHEMA,
        name="reading_analysis",
        effort="low",
    )


async def assess(audio: Path, passage_id: str) -> dict[str, Any]:
    passage = passages()[passage_id]
    with tempfile.TemporaryDirectory() as tmpd:
        wav = Path(tmpd) / "reading.wav"
        seconds = to_wav(audio, wav)
        if seconds > 600:
            raise ValueError("Recording longer than 10 minutes")
        transcript = await transcribe(wav, passage["language"])
    ops = align(tokens(passage["text"]), tokens(transcript))
    result = {"passage_id": passage_id, "language": passage["language"], "passage_level": passage["level"], "transcript": transcript, "alignment": ops, **score(passage, ops, seconds)}
    result["analysis"] = await analyse(passage, ops)
    return result


async def transcribe_any(audio: Path, language: str | None = None) -> str:
    with tempfile.TemporaryDirectory() as tmpd:
        wav = Path(tmpd) / "clip.wav"
        to_wav(audio, wav)
        return await transcribe(wav, language)
