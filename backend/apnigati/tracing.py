"""Bayesian Knowledge Tracing over the concept graph.

Each (student, concept) has P(known). Every graded problem is an observation on its concept.
A diagnosed misconception is also evidence against its root concept (often a prerequisite),
which is what lets the agent walk a Class 5 error back to a Class 2 gap.
Mastery also propagates softly: success on a concept is weak evidence for its prerequisites.
"""
from __future__ import annotations

import time

from . import concepts, db

P_INIT = 0.35
P_LEARN = 0.08
P_SLIP = 0.10
P_GUESS = 0.15
MASTERED = 0.80
GAP = 0.40
MIN_EVIDENCE = 2


def _bkt(p: float, correct: bool, slip: float = P_SLIP, guess: float = P_GUESS) -> float:
    if correct:
        post = p * (1 - slip) / (p * (1 - slip) + (1 - p) * guess)
    else:
        post = p * slip / (p * slip + (1 - p) * (1 - guess))
    return post + (1 - post) * P_LEARN


def mastery(student_id: str) -> dict[str, dict]:
    rows = db.query("SELECT concept_id, p_known, n_obs FROM mastery WHERE student_id = ?", student_id)
    return {r["concept_id"]: {"p": r["p_known"], "n": r["n_obs"]} for r in rows}


def _set(student_id: str, concept_id: str, p: float, n: int) -> None:
    db.insert("mastery", student_id=student_id, concept_id=concept_id, p_known=round(p, 4), n_obs=n, updated=time.time())


# Easy questions are weak evidence of mastery (easy to get right by partial understanding); challenge
# questions are strong evidence. Difficulty level comes from the homework answer key.
GUESS_BY_LEVEL = {1: 0.35, 2: 0.2, 3: 0.1}


def observe(student_id: str, concept_id: str, correct: bool, misconception_id: str | None = None, level: int | None = None) -> None:
    if concept_id not in concepts.nodes():
        return
    current = mastery(student_id)
    p = current.get(concept_id, {"p": P_INIT, "n": 0})
    _set(student_id, concept_id, _bkt(p["p"], correct, guess=GUESS_BY_LEVEL.get(level or 0, P_GUESS)), p["n"] + 1)

    if correct:
        # Weak upward evidence for direct prerequisites (they were needed to get this right).
        for pre in concepts.nodes()[concept_id]["prereqs"]:
            q = current.get(pre, {"p": P_INIT, "n": 0})
            _set(student_id, pre, _bkt(q["p"], True, slip=0.3, guess=0.5), q["n"])
    elif misconception_id and misconception_id in concepts.misconceptions():
        root = concepts.misconceptions()[misconception_id]["root_concept_id"]
        if root != concept_id and root in concepts.nodes():
            q = current.get(root, {"p": P_INIT, "n": 0})
            _set(student_id, root, _bkt(q["p"], False, slip=0.2, guess=0.3), q["n"] + 1)


def rebuild(student_id: str) -> None:
    """Recompute a child's knowledge state from their full attempt history (idempotent: re-grading a page or a
    teacher override never double-counts evidence)."""
    db.query("DELETE FROM mastery WHERE student_id = ?", student_id)
    for a in db.query("SELECT concept_id, correct, misconception_id, level FROM attempts WHERE student_id = ? ORDER BY created", student_id):
        observe(student_id, a["concept_id"], bool(a["correct"]), a["misconception_id"], a["level"])


def frontier(student_id: str) -> str | None:
    """Earliest concept in teaching order that has evidence of a gap: where teaching should start."""
    m = mastery(student_id)
    # One slip is not a gap: require repeated evidence before telling a teacher a child is behind.
    for cid in concepts.topo_order():
        if cid in m and m[cid]["n"] >= MIN_EVIDENCE and m[cid]["p"] < GAP:
            return cid
    weakest = [(v["p"], cid) for cid, v in m.items() if v["n"] >= MIN_EVIDENCE and v["p"] < MASTERED]
    return min(weakest)[1] if weakest else None
