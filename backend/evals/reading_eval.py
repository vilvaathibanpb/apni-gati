"""Reading assessment eval with synthetic speech (macOS Indian-English, Hindi and Tamil voices).

Each passage is read once cleanly (false-alarm rate) and once with planted errors: substitutions and
omissions with known positions (detection recall). Synthetic voices are cleaner than children, so these
numbers are an upper bound; the real-child recording is reported separately in the README.

Run: uv run python -m evals.reading_eval
"""
from __future__ import annotations

import asyncio
import json
import subprocess
import tempfile
from pathlib import Path

from apnigati import reading

OUT = Path(__file__).parent / "results" / "reading.json"
VOICES = {"English": "Rishi", "Hindi": "Lekha", "Tamil": "Vani"}

# (passage_id, text actually spoken, planted errors as (printed word, kind))
CASES = [
    ("en_paragraph", None, []),
    ("en_story", None, []),
    ("en_paragraph", "My name is Ravi. I have a bell. I play with my friend. We play on the park.", [("red", "omitted"), ("ball", "substituted"), ("in", "substituted")]),
    ("hi_paragraph", None, []),
    ("hi_story", None, []),
    ("hi_paragraph", "मेरा नाम राजा है। मेरे घर में गाय है। गाय का रंग सफ़ेद है। वह हरी घास खाता है।", [("राजू", "substituted"), ("एक", "omitted"), ("खाती", "substituted")]),
    ("ta_paragraph", None, []),
    ("ta_story", None, []),
    ("ta_paragraph", "என் பெயர் கவின். என் வீட்டில் பூனை உள்ளது. அது பழம் குடிக்கும். அது என்னுடன் ஓடும்.", [("ஒரு", "omitted"), ("பால்", "substituted"), ("விளையாடும்", "substituted")]),
]


def speak(text: str, voice: str, out: Path) -> None:
    subprocess.run(["say", "-v", voice, "-r", "135", "-o", str(out), text], check=True)


async def run_case(passage_id: str, spoken: str | None, planted: list[tuple[str, str]]) -> dict:
    passage = reading.passages()[passage_id]
    with tempfile.TemporaryDirectory() as tmpd:
        audio = Path(tmpd) / "read.aiff"
        speak(spoken or passage["text"], VOICES[passage["language"]], audio)
        res = await reading.assess(audio, passage_id)
    flagged = [o for o in res["alignment"] if o["op"] in ("substituted", "omitted")]
    planted_norm = {reading.normalise_word(w) for w, _ in planted}
    caught = {reading.normalise_word(w) for w, _ in planted if any(o["ref"] == reading.normalise_word(w) and o["op"] != "correct" for o in res["alignment"])}
    false_alarms = [o for o in flagged if o["ref"] not in planted_norm]
    return {
        "passage": passage_id, "language": passage["language"], "clean": not planted,
        "planted": len(planted), "caught": len(caught), "false_alarms": len(false_alarms),
        "false_alarm_words": [(o["ref"], o["said"]) for o in false_alarms],
        "words": res["words"], "accuracy": res["accuracy"], "level": res["level"], "transcript": res["transcript"],
    }


async def main() -> None:
    rows = await asyncio.gather(*[run_case(*c) for c in CASES])
    by_lang = {}
    for lang in VOICES:
        rs = [r for r in rows if r["language"] == lang]
        clean_words = sum(r["words"] for r in rs if r["clean"])
        by_lang[lang] = {
            "planted_errors_caught": f"{sum(r['caught'] for r in rs)}/{sum(r['planted'] for r in rs)}",
            "false_alarms_on_clean_reads": f"{sum(r['false_alarms'] for r in rs if r['clean'])}/{clean_words} words",
            "false_alarms_on_error_reads": sum(r["false_alarms"] for r in rs if not r["clean"]),
        }
    report = {"by_language": by_lang, "rows": rows}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=1, ensure_ascii=False))
    print(json.dumps(by_lang, indent=1, ensure_ascii=False))
    for r in rows:
        print(r["passage"], "clean" if r["clean"] else "errors", f"caught {r['caught']}/{r['planted']}", "FA:", r["false_alarm_words"])


if __name__ == "__main__":
    asyncio.run(main())
