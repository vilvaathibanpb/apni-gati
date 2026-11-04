"""Build the NCERT-aligned maths concept graph with Muse Wonder + web search grounding.

Stage 1: Wonder researches NCERT Class 1-6 maths chapters and documented misconceptions (web_search).
Stage 2: Wonder turns the cited notes into a prerequisite DAG with a misconception catalogue.
Stage 3: we validate the DAG locally (ids, cycles, grades) and write data/concepts/math_graph.json.

Run:  uv run python scripts/build_concept_graph.py
"""
from __future__ import annotations

import asyncio
import json
import sys
from graphlib import CycleError, TopologicalSorter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from apnigati import config, llm  # noqa: E402

RESEARCH_PROMPT = """You are building a diagnostic concept map for Indian primary maths (number and operations strand).

Use web search to ground your answer in:
1. The NCERT maths textbooks for Class 1 to Class 6 under NCF-SE 2023 (Joyful Mathematics for Class 1-2,
   Maths Mela for Class 3-5, Ganita Prakash for Class 6) and, where newer books are not available, the
   older Math-Magic series. Identify the chapters that teach place value, addition, subtraction,
   multiplication, division, fractions and decimals, and which class teaches each.
2. Documented student misconceptions in these topics (for example from ASER, Pratham / Teaching at the
   Right Level, NCERT learning-outcome documents, or maths education research), such as "larger number
   minus smaller number in each column", "longer decimal is larger", "adds numerators and denominators".

Write compact research notes: for each topic list the NCERT book + chapter + class, the sub-skills in
teaching order, and 2-4 specific misconceptions with a concrete wrong-answer example each.
Cite sources inline as URLs. Keep it under 1500 words."""

GRAPH_SYSTEM = """You turn research notes into a prerequisite graph used by a diagnostic tutoring agent.
Rules:
- 30 to 45 concept nodes covering Class 1-6 number and operations: counting/number names, place value,
  addition (no carry, carry), subtraction (no borrow, borrow, borrow across zero), multiplication
  (tables, multi-digit), division (sharing, facts, long division, remainders), fractions (meaning,
  equivalence, comparison, like/unlike addition), decimals (place value, comparison, addition).
- id: short snake_case, unique. prereqs: ids of DIRECT prerequisites only (must exist, no cycles).
- grade: NCERT class where it is first taught (1-6). ncert_ref: book and chapter from the notes.
- Each node 1-4 misconceptions. Misconception id is globally unique snake_case. root_concept_id is the
  prerequisite concept whose gap usually causes it (may be the node itself).
- example_wrong and example_right are short worked examples a child might write, e.g. "52 - 37 = 25".
- sources: URLs from the notes that support the node."""

GRAPH_SCHEMA = {
    "type": "object",
    "properties": {
        "nodes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                    "grade": {"type": "integer"},
                    "strand": {"type": "string"},
                    "ncert_ref": {"type": "string"},
                    "description": {"type": "string"},
                    "prereqs": {"type": "array", "items": {"type": "string"}},
                    "misconceptions": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "name": {"type": "string"},
                                "description": {"type": "string"},
                                "example_wrong": {"type": "string"},
                                "example_right": {"type": "string"},
                                "root_concept_id": {"type": "string"},
                            },
                            "required": ["id", "name", "description", "example_wrong", "example_right", "root_concept_id"],
                        },
                    },
                    "sources": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["id", "name", "grade", "strand", "ncert_ref", "description", "prereqs", "misconceptions"],
            },
        }
    },
    "required": ["nodes"],
}


def validate(graph: dict) -> list[str]:
    problems: list[str] = []
    ids = {n["id"] for n in graph["nodes"]}
    mids: set[str] = set()
    for n in graph["nodes"]:
        bad = [p for p in n["prereqs"] if p not in ids or p == n["id"]]
        if bad:
            problems.append(f"{n['id']}: unknown prereqs {bad} (dropped)")
            n["prereqs"] = [p for p in n["prereqs"] if p in ids and p != n["id"]]
        for m in n["misconceptions"]:
            if m["id"] in mids:
                m["id"] = f"{n['id']}__{m['id']}"
            mids.add(m["id"])
            if m["root_concept_id"] not in ids:
                problems.append(f"{m['id']}: unknown root {m['root_concept_id']} -> {n['id']}")
                m["root_concept_id"] = n["id"]
    try:
        list(TopologicalSorter({n["id"]: n["prereqs"] for n in graph["nodes"]}).static_order())
    except CycleError as exc:
        problems.append(f"CYCLE {exc.args[1]}")
    return problems


async def main() -> None:
    print("Stage 1: Muse Wonder + web search researching NCERT chapters and misconceptions…")
    research = await llm.responses_text(
        purpose="concept_graph_research",
        model=config.WONDER,
        input=RESEARCH_PROMPT,
        tools=[{"type": "web_search"}],
        reasoning={"effort": "medium"},
    )
    notes = research.output_text
    searches = sum(1 for o in research.output if o.type == "web_search_call")
    print(f"  {searches} searches, {len(notes)} chars of notes")

    print("Stage 2: Muse Wonder structuring the prerequisite graph…")
    graph = await llm.json_call(
        system=GRAPH_SYSTEM,
        user="Research notes:\n\n" + notes,
        schema=GRAPH_SCHEMA,
        name="concept_graph",
        model=config.WONDER,
        effort="high",
    )

    print("Stage 3: validating…")
    problems = validate(graph)
    for p in problems:
        print("  !", p)
    if any(p.startswith("CYCLE") for p in problems):
        raise SystemExit("Graph has a cycle; re-run.")

    graph["meta"] = {
        "built_by": f"{config.WONDER} with web_search",
        "research_notes": notes,
        "n_nodes": len(graph["nodes"]),
        "n_misconceptions": sum(len(n["misconceptions"]) for n in graph["nodes"]),
    }
    config.CONCEPT_GRAPH_PATH.parent.mkdir(parents=True, exist_ok=True)
    config.CONCEPT_GRAPH_PATH.write_text(json.dumps(graph, indent=2, ensure_ascii=False))
    print(f"Wrote {graph['meta']['n_nodes']} concepts, {graph['meta']['n_misconceptions']} misconceptions -> {config.CONCEPT_GRAPH_PATH}")


if __name__ == "__main__":
    asyncio.run(main())
