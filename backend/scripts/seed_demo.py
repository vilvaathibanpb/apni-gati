"""Seed a demo district.

- One demo multi-grade class (fictional roster). Real notebook pages and reading tests are added on
  top of it through the app.
- Optional simulated history for that class and 4 fully simulated schools, so grouping and the
  district view have something to show. Every simulated row is marked (attempts.source = 'simulated',
  schools.simulated = 1) and the UI labels it.

Simulation: each child gets a hidden "true gap" concept. Problems on concepts that depend on that gap
are answered wrongly with a misconception rooted in it; others are mostly right. The agents never see
the hidden gap, so the simulation also lets us check that the root-cause agent recovers it.

Run: uv run python scripts/seed_demo.py [--reset] [--language Tamil]
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from apnigati import concepts, config, db, tracing  # noqa: E402

DEMO_ROSTER = [
    ("Kavin", 3), ("Meena", 3), ("Arun", 3), ("Nila", 3),
    ("Divya", 4), ("Surya", 4), ("Priya", 4), ("Karthik", 4),
    ("Anitha", 5), ("Vijay", 5), ("Lakshmi", 5), ("Ravi", 5),
]
SIM_SCHOOLS = [
    ("GPS Kottaiyur", "Block A"), ("GPS Melur", "Block A"), ("PUMS Vadakkupatti", "Block B"), ("GPS Sengulam", "Block B"),
]
SIM_NAMES = ["Aadhi", "Bala", "Chitra", "Deepa", "Elango", "Fathima", "Gokul", "Harini", "Ilakkiya", "Jeeva", "Kani", "Madhan", "Nandhini", "Oviya", "Pandi", "Rani", "Selvi", "Tamil", "Uma", "Vasanth", "Yazhini", "Ezhil", "Mani", "Revathi", "Sathish"]


def downstream(gap: str) -> set[str]:
    return {cid for cid in concepts.nodes() if cid == gap or gap in concepts.ancestors(cid)}


def simulate_student(student_id: str, grade: int, rng: random.Random, n_attempts: int) -> str:
    candidates = [c for c, n in concepts.nodes().items() if n["grade"] <= grade and n["strand"] != "counting"]
    # Lower-grade gaps are common (ASER): weight earlier concepts more.
    weights = [1.0 / (1 + abs(grade - 1 - concepts.nodes()[c]["grade"])) for c in candidates]
    gap = rng.choices(candidates, weights=weights)[0] if rng.random() < 0.8 else None
    affected = downstream(gap) if gap else set()
    practice = [c for c, n in concepts.nodes().items() if grade - 2 <= n["grade"] <= grade]
    for _ in range(n_attempts):
        cid = rng.choice(practice)
        p_correct = 0.25 if cid in affected else 0.9
        correct = rng.random() < p_correct
        mis = None
        if not correct:
            options = [m for m in concepts.misconceptions().values() if m["concept_id"] == cid and (not gap or m["root_concept_id"] in affected | {gap} or m["root_concept_id"] == gap)]
            options = options or [m for m in concepts.misconceptions().values() if m["concept_id"] == cid]
            mis = rng.choice(options)["id"] if options else None
        node = concepts.nodes()[cid]
        db.insert("attempts", id=db.new_id("at"), student_id=student_id, page_id=None, concept_id=cid, correct=int(correct), misconception_id=mis, problem=f"[simulated] {node['name']}", source="simulated")
        tracing.observe(student_id, cid, correct, mis)
    return gap or "none"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true")
    ap.add_argument("--language", default="Tamil")
    ap.add_argument("--no-sim-history", action="store_true", help="demo class starts empty")
    args = ap.parse_args()
    if args.reset and config.DB_PATH.exists():
        for suffix in ("", "-wal", "-shm"):
            Path(str(config.DB_PATH) + suffix).unlink(missing_ok=True)
    db.init()
    rng = random.Random(2026)
    truth: dict[str, str] = {}

    school = db.insert("schools", id="sc_demo", name="Government Primary School (demo)", district="Demo District", block="Block A", simulated=0)
    klass = db.insert("classes", id="cl_demo", school_id=school, name="Multi-grade Class 3–5", grades=[3, 4, 5], language=args.language)
    for name, grade in DEMO_ROSTER:
        sid = db.insert("students", id=f"st_{name.lower()}", class_id=klass, name=name, grade=grade, language=args.language)
        if not args.no_sim_history:
            truth[sid] = simulate_student(sid, grade, rng, n_attempts=14)

    for i, (sname, block) in enumerate(SIM_SCHOOLS):
        sc = db.insert("schools", id=f"sc_sim{i}", name=sname, district="Demo District", block=block, simulated=1)
        cl = db.insert("classes", id=f"cl_sim{i}", school_id=sc, name="Class 3–5", grades=[3, 4, 5], language=args.language)
        for j, name in enumerate(rng.sample(SIM_NAMES, 20)):
            sid = db.insert("students", id=f"st_sim{i}_{j}", class_id=cl, name=name, grade=rng.choice([3, 4, 5]), language=args.language)
            truth[sid] = simulate_student(sid, db.get("students", sid)["grade"], rng, n_attempts=12)

    (config.RUNTIME_DIR / "sim_truth.json").write_text(json.dumps(truth, indent=1))
    print(f"Seeded demo class cl_demo ({len(DEMO_ROSTER)} children) and {len(SIM_SCHOOLS)} simulated schools. Hidden gaps -> data/runtime/sim_truth.json")


if __name__ == "__main__":
    main()
