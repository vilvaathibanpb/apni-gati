"""The NCERT-aligned concept graph (built by scripts/build_concept_graph.py) and graph queries."""
from __future__ import annotations

import json
from functools import lru_cache
from graphlib import TopologicalSorter
from typing import Any

from . import config


@lru_cache(maxsize=1)
def graph() -> dict[str, Any]:
    return json.loads(config.CONCEPT_GRAPH_PATH.read_text())


@lru_cache(maxsize=1)
def nodes() -> dict[str, dict[str, Any]]:
    return {n["id"]: n for n in graph()["nodes"]}


@lru_cache(maxsize=1)
def misconceptions() -> dict[str, dict[str, Any]]:
    return {m["id"]: {**m, "concept_id": n["id"]} for n in graph()["nodes"] for m in n["misconceptions"]}


@lru_cache(maxsize=1)
def topo_order() -> list[str]:
    """Teaching order: NCERT class first, then prerequisite order. Valid because no prerequisite is taught in a
    later class than the concept that needs it (checked in tests)."""
    topo = list(TopologicalSorter({n["id"]: n["prereqs"] for n in graph()["nodes"]}).static_order())
    return sorted(topo, key=lambda c: (nodes()[c]["grade"], topo.index(c)))


def ancestors(concept_id: str) -> list[str]:
    """All prerequisites, nearest first (BFS)."""
    seen: list[str] = []
    frontier = list(nodes()[concept_id]["prereqs"]) if concept_id in nodes() else []
    while frontier:
        nxt = []
        for c in frontier:
            if c not in seen:
                seen.append(c)
                nxt.extend(nodes()[c]["prereqs"])
        frontier = nxt
    return seen


def catalogue_for_prompt(concept_ids: list[str] | None = None) -> str:
    """Compact text listing of concepts + misconceptions for grounding model prompts."""
    lines = []
    for n in graph()["nodes"]:
        if concept_ids and n["id"] not in concept_ids:
            continue
        lines.append(f"- {n['id']} (Class {n['grade']}): {n['name']}")
        for m in n["misconceptions"]:
            lines.append(f"    * {m['id']}: {m['description']} e.g. {m['example_wrong']}")
    return "\n".join(lines)


def public_graph() -> dict[str, Any]:
    return {
        "nodes": [
            {k: n[k] for k in ("id", "name", "grade", "strand", "ncert_ref", "description", "prereqs")}
            | {"misconceptions": [{k: m[k] for k in ("id", "name", "description", "example_wrong", "example_right", "root_concept_id")} for m in n["misconceptions"]]}
            for n in graph()["nodes"]
        ],
        "meta": {k: v for k, v in graph().get("meta", {}).items() if k != "research_notes"},
    }
