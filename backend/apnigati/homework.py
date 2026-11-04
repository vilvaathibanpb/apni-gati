"""Personalised homework: every child gets a different sheet built from their own knowledge graph.

Teacher sets up once (roster + syllabus). Each evening:
  plan_for(child)  -> which concepts, at which difficulty, how many items  (deterministic, explainable)
  generate items   -> Muse Spark writes questions in the child's language   (each one sympy-verified)
  child submits a photo -> graded against this answer key -> knowledge tracing updates -> next sheet adapts

Tracks (shown to teachers and families; never "smart / weak"):
  placement  - no evidence yet: one quick item per syllabus concept to find the starting point
  challenge  - recent accuracy high: next concepts in the syllabus, harder multi-step / word problems, fewer items
  on_track   - current concepts at class level
  practice   - recent accuracy low: the gap concept underneath, easier items, more of them, confidence builders first
"""
from __future__ import annotations

import asyncio
import json
import re
import secrets
from typing import Any

from . import concepts, config, db, guardrails, llm, tracing, verifier

NUM = re.compile(r"\d+(?:\.\d+)?")

TRACKS = {
    "placement": {"label": "Placement check", "items": 10},
    "challenge": {"label": "Ready for challenge", "items": 6, "level": 3},
    "on_track": {"label": "On track", "items": 8, "level": 2},
    "practice": {"label": "Needs practice", "items": 10, "level": 1},
}
LEVELS = {
    1: "Level 1 (gentle): small numbers, one step, familiar context, no traps.",
    2: "Level 2 (class level): numbers and steps typical for the child's NCERT class.",
    3: "Level 3 (challenge): larger numbers, two or more steps, or a short word problem that needs choosing the operation.",
}


# ---------------------------------------------------------------- syllabus + progress

def syllabus(class_id: str) -> list[str]:
    rows = db.query("SELECT concept_ids FROM syllabi WHERE class_id = ? ORDER BY created DESC LIMIT 1", class_id)
    return json.loads(rows[0]["concept_ids"]) if rows else []


def scope(class_id: str) -> list[str]:
    """Syllabus concepts plus every prerequisite (children may need to go back), in teaching order."""
    s = set(syllabus(class_id))
    for c in list(s):
        s |= set(concepts.ancestors(c))
    return [c for c in concepts.topo_order() if c in s]


def progress(student_id: str, class_id: str) -> dict[str, Any]:
    syl = syllabus(class_id)
    m = tracing.mastery(student_id)
    mastered = [c for c in syl if m.get(c, {}).get("p", 0) >= tracing.MASTERED]
    learning = [c for c in syl if c in m and m[c]["n"] > 0 and m[c]["p"] < tracing.MASTERED]
    return {
        "total": len(syl),
        "mastered": len(mastered),
        "learning": len(learning),
        "percent": round(100 * len(mastered) / len(syl)) if syl else 0,
        "concepts": [{"id": c, "name": concepts.nodes()[c]["name"], "grade": concepts.nodes()[c]["grade"], "p": round(m[c]["p"], 2) if c in m else None, "n": m.get(c, {}).get("n", 0)} for c in syl],
    }


MAP_SCHEMA = {
    "type": "object",
    "properties": {"concept_ids": {"type": "array", "items": {"type": "string"}}, "unmatched": {"type": "array", "items": {"type": "string"}}},
    "required": ["concept_ids", "unmatched"],
}


async def map_syllabus_text(text: str) -> dict[str, Any]:
    """Teacher pastes a syllabus / chapter list; Muse Wonder maps it onto the concept graph."""
    listing = "\n".join(f"{n['id']}: {n['name']} (Class {n['grade']}, {n['ncert_ref']})" for n in concepts.graph()["nodes"])
    out = await llm.json_call(
        system="You map a school maths syllabus onto a fixed list of concept ids. Only use ids from the list.",
        user=f"Concept list:\n{listing}\n\nSyllabus written by the teacher:\n{text}\n\nReturn every concept id the syllabus covers, and list syllabus lines you could not map.",
        schema=MAP_SCHEMA,
        name="syllabus_map",
        model=config.WONDER,
        effort="medium",
    )
    valid = [c for c in out["concept_ids"] if c in concepts.nodes()]
    return {"concept_ids": [c for c in concepts.topo_order() if c in valid], "unmatched": out["unmatched"]}


# ---------------------------------------------------------------- per-child plan

def recent_accuracy(student_id: str, n: int = 20) -> tuple[float | None, int]:
    rows = db.query("SELECT correct FROM attempts WHERE student_id = ? AND source != 'simulated' ORDER BY created DESC LIMIT ?", student_id, n)
    if len(rows) < 4:
        rows = db.query("SELECT correct FROM attempts WHERE student_id = ? ORDER BY created DESC LIMIT ?", student_id, n)
    if not rows:
        return None, 0
    return sum(r["correct"] for r in rows) / len(rows), len(rows)


def plan_for(student: dict[str, Any], class_id: str) -> dict[str, Any]:
    """Choose track, target concepts and item mix for one child. Deterministic and explainable."""
    sc = scope(class_id)
    syl = set(syllabus(class_id))
    m = tracing.mastery(student["id"])
    acc, n_recent = recent_accuracy(student["id"])
    seen = lambda c: m.get(c, {}).get("n", 0) > 0  # noqa: E731

    def p(c: str) -> float:
        # Untested prerequisites below the syllabus are presumed known; only evidence can open a gap there.
        if seen(c):
            return m[c]["p"]
        return tracing.P_INIT if c in syl else 0.7

    below_gaps = {c for c in sc if c not in syl and m.get(c, {}).get("n", 0) >= tracing.MIN_EVIDENCE and m[c]["p"] < tracing.GAP}
    candidates = [c for c in sc if c in syl or c in below_gaps]

    if acc is None or sum(1 for c in syl if seen(c)) < 2:
        targets = [c for c in sc if c in syl][: TRACKS["placement"]["items"]]
        return {"track": "placement", "targets": [{"concept_id": c, "level": 2, "count": 1} for c in targets],
                "why": "No homework marked yet: one question per syllabus topic to find where to start."}

    # Ready = not yet mastered, and every prerequisite is at least partly secure.
    ready = [c for c in candidates if p(c) < tracing.MASTERED and all(p(q) >= 0.6 for q in concepts.nodes()[c]["prereqs"])]
    gap = next((c for c in candidates if seen(c) and m[c]["n"] >= tracing.MIN_EVIDENCE and p(c) < tracing.GAP), None)
    mastered = [c for c in sc if seen(c) and p(c) >= tracing.MASTERED]

    if acc >= 0.8:
        track = "challenge"
        # Stretch towards the child's own class, not back to easy early topics.
        near = sorted((c for c in ready if c in syl), key=lambda c: (abs(concepts.nodes()[c]["grade"] - student["grade"]), concepts.nodes()[c]["grade"]))
        targets = near[:2] or ready[:2]
        stretch = next((c for c in near if c not in targets), None)
        mix = [{"concept_id": c, "level": 3, "count": 2} for c in targets]
        if stretch:
            mix.append({"concept_id": stretch, "level": 3, "count": 1})
        if mastered:
            mix.append({"concept_id": mastered[-1], "level": 3, "count": 1})  # keep earlier skills alive
        why = f"Recent accuracy {acc:.0%}: moving ahead to {', '.join(concepts.nodes()[c]['name'] for c in targets) or 'new topics'} with harder problems."
    elif acc >= 0.5:
        track = "on_track"
        targets = ([gap] if gap else []) + [c for c in ready if c != gap][:2]
        mix = [{"concept_id": c, "level": 2, "count": 3} for c in targets[:2]] + [{"concept_id": c, "level": 2, "count": 2} for c in targets[2:3]]
        why = f"Recent accuracy {acc:.0%}: practising {', '.join(concepts.nodes()[c]['name'] for c in targets[:3])} at class level."
    else:
        track = "practice"
        focus = gap or (ready[0] if ready else candidates[0])
        under = [q for q in concepts.nodes()[focus]["prereqs"] if seen(q) and p(q) < tracing.MASTERED][:1]
        warmup = [c for c in mastered if c not in (focus, *under)][-1:]
        mix = [{"concept_id": c, "level": 1, "count": 2} for c in warmup]  # confidence builders first
        if not warmup:
            mix = [{"concept_id": focus, "level": 1, "count": 2}]  # nothing mastered yet: the gentlest items of the focus topic
        mix += [{"concept_id": c, "level": 1, "count": 3} for c in under]
        mix += [{"concept_id": focus, "level": 1, "count": 5}]
        why = f"Recent accuracy {acc:.0%}: rebuilding {concepts.nodes()[focus]['name']} step by step, starting with questions the child can already do."
    merged: dict[tuple[str, int], int] = {}
    for x in mix:  # the same (concept, level) can be chosen twice, e.g. warm-up and focus
        merged[(x["concept_id"], x["level"])] = merged.get((x["concept_id"], x["level"]), 0) + x["count"]
    mix = [{"concept_id": c, "level": lv, "count": n} for (c, lv), n in merged.items()]
    total = sum(x["count"] for x in mix)
    cap = TRACKS[track]["items"]
    if total > cap:  # trim from the largest group
        mix.sort(key=lambda x: -x["count"])
        while sum(x["count"] for x in mix) > cap:
            mix[0]["count"] -= 1
            mix.sort(key=lambda x: -x["count"])
        mix = [x for x in mix if x["count"] > 0]
    return {"track": track, "targets": mix, "why": why, "recent_accuracy": round(acc, 2), "recent_attempts": n_recent}


# ---------------------------------------------------------------- item generation

ITEMS_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "concept_id": {"type": "string"},
                    "level": {"type": "integer"},
                    "question": {"type": "string"},
                    "question_en": {"type": "string"},
                    "expr": {"type": "string"},
                    "answer": {"type": "string"},
                },
                "required": ["concept_id", "level", "question", "question_en", "expr", "answer"],
            },
        }
    },
    "required": ["items"],
}

ITEMS_SYSTEM = """You write homework questions for one child in a rural Indian government school.
Rules:
- Exactly the requested number of questions per (concept, level). Vary them; never repeat a question.
- question: in the child's language (Tamil / Hindi script, or English), short, friendly, Indian context
  (rupees, mangoes, bus tickets, cricket runs, rangoli dots). question_en: the same in English.
- expr: the arithmetic the question asks for, plain + - * / with digits (use "?" between two values for a
  comparison, e.g. "0.5 ? 0.25"). answer: the exact answer ("R" for remainders, fractions like 3/4, or the
  sign <, > or = for comparisons).
- Every number in expr must appear in the question text.
- Never put the answer in the question."""


INDIC = re.compile(r"[\u0900-\u0DFF]")
SCRIPT_RANGE = {"Hindi": ("\u0900", "\u097F"), "Tamil": ("\u0B80", "\u0BFF")}


def _script_ok(text: str, language: str) -> bool:
    """No characters from a different Indian script (models occasionally leak e.g. an Odia letter into Tamil)."""
    lo, hi = SCRIPT_RANGE.get(language, ("\uffff", "\uffff"))
    return all(lo <= ch <= hi for ch in INDIC.findall(text))


def _item_ok(it: dict[str, Any], language: str = "English") -> bool:
    """Verified answer, valid concept, clean script, and every number in the arithmetic appears in the question."""
    if it["concept_id"] not in concepts.nodes() or not _script_ok(it["question"], language):
        return False
    if "?" in it["expr"]:
        left, right = it["expr"].split("?", 1)
        claim = f"{left} {it['answer'].strip()} {right}"
    else:
        claim = f"{it['expr']} = {it['answer']}"
    if verifier.check_claim(claim).status != "true":
        return False
    shown = set(NUM.findall(it["question"] + " " + it["question_en"]))
    return all(n in shown for n in NUM.findall(it["expr"]))


async def generate_items(student: dict[str, Any], plan: dict[str, Any], avoid: list[str]) -> tuple[list[dict[str, Any]], int]:
    wanted = "\n".join(
        f"- {t['count']} x concept {t['concept_id']} ({concepts.nodes()[t['concept_id']]['name']}, NCERT Class {concepts.nodes()[t['concept_id']]['grade']}), {LEVELS[t['level']]}"
        for t in plan["targets"]
    )
    user = (
        f"Child: {student['name']}, Class {student['grade']}, language {student.get('language') or 'English'}.\n"
        f"Write these questions:\n{wanted}\n\n"
        + ("Do not reuse these recent questions:\n" + "\n".join(avoid[:30]) if avoid else "")
    )
    good: list[dict[str, Any]] = []
    rejected = 0
    for _ in range(2):  # second round only to replace rejected items
        out = await llm.json_call(system=ITEMS_SYSTEM, user=user, schema=ITEMS_SCHEMA, name="homework_items", effort="medium")
        for it in out["items"]:
            if _item_ok(it, student.get("language") or "English") and it["expr"] not in {g["expr"] for g in good} and it["expr"] not in avoid:
                good.append(it)
            else:
                rejected += 1
        need = {(t["concept_id"], t["level"]): t["count"] for t in plan["targets"]}
        for g in good:
            key = (g["concept_id"], g["level"])
            if key in need:
                need[key] -= 1
        missing = {k: v for k, v in need.items() if v > 0}
        if not missing:
            break
        user = user + "\n\nSome questions failed verification. Write only these replacements:\n" + "\n".join(
            f"- {v} x concept {k[0]}, {LEVELS[k[1]]}" for k, v in missing.items()
        )
    # keep plan order and counts
    ordered: list[dict[str, Any]] = []
    for t in plan["targets"]:
        pool = [g for g in good if g["concept_id"] == t["concept_id"] and g not in ordered]
        ordered += pool[: t["count"]]
    return ordered, rejected


async def make_homework(student: dict[str, Any], class_id: str) -> dict[str, Any]:
    plan = plan_for(student, class_id)
    recent = db.query("SELECT items FROM homeworks WHERE student_id = ? ORDER BY created DESC LIMIT 3", student["id"])
    avoid = [i["expr"] for r in recent for i in (r["items"] or [])]
    items, rejected = await generate_items(student, plan, avoid)
    for n, it in enumerate(items, 1):
        it["n"] = n
        it["leak"] = bool(guardrails.deterministic_hint_issues("en", it["question_en"], it["answer"]))
    items = [it for it in items if not it["leak"]]
    hw_id = db.new_id("hw")
    token = secrets.token_urlsafe(9)
    db.insert("homeworks", id=hw_id, student_id=student["id"], class_id=class_id, token=token, track=plan["track"],
              plan=plan, items=items, status="assigned", rejected=rejected)
    return {"id": hw_id, "token": token, "student": {"id": student["id"], "name": student["name"]}, "track": plan["track"],
            "track_label": TRACKS[plan["track"]]["label"], "why": plan["why"], "items": items, "rejected_by_verifier": rejected}


async def make_class_homework(class_id: str) -> list[dict[str, Any]]:
    students = db.query("SELECT * FROM students WHERE class_id = ? ORDER BY name", class_id)
    sem = asyncio.Semaphore(6)

    async def one(s: dict[str, Any]) -> dict[str, Any]:
        async with sem:
            try:
                return await make_homework(s, class_id)
            except Exception as exc:  # noqa: BLE001 - one child's failure must not block the class
                return {"student": {"id": s["id"], "name": s["name"]}, "error": str(exc)}

    return list(await asyncio.gather(*[one(s) for s in students]))


# ---------------------------------------------------------------- grading against the answer key

def apply_answer_key(hw: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    """Match what was read on the photo to this homework's questions; unanswered questions are recorded."""
    def nums(s: str) -> list[str]:
        return NUM.findall(s or "")

    used: set[int] = set()
    rows = []
    for it in hw["items"]:
        want = nums(it["expr"])
        match = None
        for i, p in enumerate(result["problems"]):
            if i in used:
                continue
            got = nums(p.get("problem_expr", "")) or nums(p.get("problem_text", ""))
            if got[: len(want)] == want:
                match = i
                break
        if match is None:
            rows.append({"n": it["n"], "concept_id": it["concept_id"], "status": "not_attempted"})
            continue
        used.add(match)
        p = result["problems"][match]
        p["concept_id"] = it["concept_id"]  # the answer key knows the concept; no guessing
        p["homework_item"] = it["n"]
        p["level"] = it["level"]
        rows.append({"n": it["n"], "concept_id": it["concept_id"], "status": p["status"], "problem_index": match})
    return {"items": rows, "extra_problems": [i for i in range(len(result["problems"])) if i not in used]}
