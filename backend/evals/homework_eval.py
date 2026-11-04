"""Personalised homework: checks on the latest class homework (no API spend).

- every item's answer re-verified with sympy; every number in the arithmetic appears in the question
- question text in a single script matching the child's language
- personalisation: track mix and how different children's sheets are (Jaccard overlap of questions)
- difficulty follows the track (mean level), item count follows the track
- end-to-end: the latest submitted homework graded against its answer key

Run: uv run python -m evals.homework_eval [class_id]
"""
from __future__ import annotations

import itertools
import json
import sys
from collections import Counter
from pathlib import Path
from statistics import mean

from apnigati import db, homework

OUT = Path(__file__).parent / "results" / "homework.json"


def main(class_id: str) -> None:
    latest = []
    for s in db.query("SELECT * FROM students WHERE class_id = ?", class_id):
        rows = db.query("SELECT * FROM homeworks WHERE student_id = ? ORDER BY created DESC LIMIT 1", s["id"])
        if rows:
            latest.append((s, rows[0]))
    items = [(s, it) for s, h in latest for it in h["items"]]
    verified = sum(homework._item_ok(it, s["language"] or "English") for s, it in items)
    sets = {s["id"]: {it["expr"] for it in h["items"]} for s, h in latest}
    overlaps = [len(a & b) / len(a | b) for a, b in itertools.combinations(sets.values(), 2) if a | b]
    by_track: dict[str, list] = {}
    for s, h in latest:
        by_track.setdefault(h["track"], []).append(h)
    report = {
        "children": len(latest),
        "items": len(items),
        "items_reverified": f"{verified}/{len(items)}",
        "rejected_at_generation": sum(h["rejected"] or 0 for _, h in latest),
        "track_mix": dict(Counter(h["track"] for _, h in latest)),
        "identical_sheets": sum(1 for a, b in itertools.combinations(sets.values(), 2) if a == b),
        "mean_question_overlap_between_children": round(mean(overlaps), 3) if overlaps else None,
        "by_track": {
            t: {"children": len(hs), "mean_items": round(mean(len(h["items"]) for h in hs), 1),
                "mean_level": round(mean(it["level"] for h in hs for it in h["items"]), 2)}
            for t, hs in by_track.items()
        },
    }
    graded = db.query("SELECT * FROM homeworks WHERE class_id = ? AND status = 'graded' ORDER BY created DESC LIMIT 1", class_id)
    if graded:
        h = graded[0]
        page = db.get("pages", h["page_id"])
        rows = page["result"]["homework"]["items"] if page else []
        report["end_to_end"] = {
            "student": (db.get("students", h["student_id"]) or {}).get("name"),
            "track": h["track"], "score": h["result"],
            "items": [{"n": r["n"], "status": r["status"],
                       "misconception": ((page["result"]["problems"][r["problem_index"]].get("diagnosis") or {}).get("misconception_id") if "problem_index" in r else None)} for r in rows],
        }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=1, ensure_ascii=False))
    print(json.dumps(report, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "cl_demo")
