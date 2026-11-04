"""Root-cause agent vs knowledge-tracing baseline on simulated children with a hidden gap.

The simulator (scripts/seed_demo.py) gives each child a hidden gap concept; problems on concepts that depend
on it are mostly answered wrongly with misconceptions rooted in it. Neither method sees the hidden gap.

Agent    : Muse Wonder tool loop (agents.diagnose_student)
Baseline : tracing.frontier — the earliest concept in teaching order with P(known) < 0.4

Run: uv run python -m evals.agent_eval [N]
"""
from __future__ import annotations

import asyncio
import json
import random
import sys
import time
from pathlib import Path

from apnigati import agents, concepts, config, llm, tracing

OUT = Path(__file__).parent / "results" / "agent.json"


def hops(a: str | None, b: str | None) -> int | None:
    """Distance in the undirected prerequisite graph."""
    if not a or not b:
        return None
    adj: dict[str, set[str]] = {c: set() for c in concepts.nodes()}
    for c, n in concepts.nodes().items():
        for p in n["prereqs"]:
            adj[c].add(p)
            adj[p].add(c)
    frontier, seen, d = {a}, {a}, 0
    while frontier:
        if b in frontier:
            return d
        frontier = {n for c in frontier for n in adj[c]} - seen
        seen |= frontier
        d += 1
    return None


async def main(n: int) -> None:
    truth = json.loads((config.RUNTIME_DIR / "sim_truth.json").read_text())
    pool = sorted(sid for sid, gap in truth.items() if gap != "none" and sid.startswith("st_sim"))
    picked = random.Random(11).sample(pool, n)
    sem = asyncio.Semaphore(4)

    async def one(sid: str) -> dict:
        async with sem:
            t, cost = time.time(), llm.start_cost_scope()
            try:
                diag = await agents.diagnose_student(sid)
                root, chain, conf, steps = diag.get("root_concept_id"), diag.get("chain", []), diag.get("confidence"), len(diag.get("trace", []))
            except Exception as exc:  # noqa: BLE001
                root, chain, conf, steps = None, [], None, f"error: {exc}"
            gap = truth[sid]
            base = tracing.frontier(sid)
            row = {
                "student": sid, "hidden_gap": gap, "agent_root": root, "agent_confidence": conf, "agent_chain": chain,
                "agent_hops": hops(root, gap), "gap_in_agent_chain": gap in chain,
                "baseline_frontier": base, "baseline_hops": hops(base, gap),
                "tool_calls": steps, "seconds": round(time.time() - t), "cost": round(cost[0], 4),
            }
            print(json.dumps(row))
            return row

    rows = await asyncio.gather(*[one(s) for s in picked])

    def summary(key: str) -> dict:
        h = [r[key] for r in rows]
        return {"exact": sum(x == 0 for x in h), "within_1_hop": sum(x is not None and x <= 1 for x in h), "n": len(h)}

    report = {
        "agent": summary("agent_hops") | {"gap_in_chain": sum(r["gap_in_agent_chain"] for r in rows)},
        "baseline_knowledge_tracing": summary("baseline_hops"),
        "cost_usd": round(sum(r["cost"] for r in rows), 3),
        "median_seconds": sorted(r["seconds"] for r in rows)[len(rows) // 2],
        "rows": rows,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=1))
    print(json.dumps({k: v for k, v in report.items() if k != "rows"}, indent=1))


if __name__ == "__main__":
    asyncio.run(main(int(sys.argv[1]) if len(sys.argv) > 1 else 10))
