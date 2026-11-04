"""Muse Wonder agents.

RootCauseAgent: walks a child's errors back through the prerequisite graph to the earliest gap, and
writes probe questions that would confirm or refute the hypothesis. Every probe answer is checked
with sympy before it reaches a child.

plan_class: Teaching-at-the-Right-Level grouping (children grouped by learning frontier, not by grade)
and a lesson plan per group, with sympy-verified practice items.
"""
from __future__ import annotations

import json
from typing import Any, Callable

from . import concepts, config, db, guardrails, llm, tracing, verifier

MAX_TURNS = 8

ROOT_CAUSE_SYSTEM = """You are a diagnostic agent for Indian primary maths, working for a teacher who has
40 children who all learn at different paces, and no time for one-to-one testing.

Goal: find the ROOT CAUSE of this child's difficulties: the earliest prerequisite concept that the evidence
says is not secure. A Class 5 long-division error might really be a Class 3 subtraction-with-borrow gap.

You are given the child's evidence summary and a statistical estimate from Bayesian knowledge tracing (BKT).
BKT counts right/wrong answers but ignores WHY answers were wrong. Your job is to combine it with the
misconception evidence: a misconception's root concept is direct evidence about a prerequisite.

Method (be efficient, 2-4 tool calls in total):
1. get_subgraph on the concept(s) where errors concentrate, to see prerequisites, the child's mastery on
   each, and which misconceptions were observed.
2. Decide the root. Start from the BKT estimate; move away from it only when misconception evidence clearly
   points elsewhere. If a prerequisite has NO evidence, you may name it only as alternative_hypothesis.
3. Write 3 probe questions that discriminate between your root and the alternative: one line each, small
   numbers, one concept each. Check each with verify_answer (fix any that fail).
4. Call submit_diagnosis exactly once. Lower confidence when evidence is thin."""

TOOLS = [
    {"type": "function", "name": "get_subgraph", "description": "A concept and all its prerequisites (transitively): NCERT class, prerequisites, this child's P(known) and number of observations, misconceptions observed for this child, and the catalogue misconceptions with their root concepts.", "parameters": {"type": "object", "properties": {"concept_id": {"type": "string"}}, "required": ["concept_id"], "additionalProperties": False}},
    {"type": "function", "name": "verify_answer", "description": "Check a probe with sympy. Returns whether expected_answer is mathematically correct for expr.", "parameters": {"type": "object", "properties": {"expr": {"type": "string", "description": "e.g. '52 - 28' or '1/2 ? 1/3' for comparisons"}, "expected_answer": {"type": "string"}}, "required": ["expr", "expected_answer"], "additionalProperties": False}},
    {
        "type": "function",
        "name": "submit_diagnosis",
        "description": "Submit the final root-cause diagnosis.",
        "parameters": {
            "type": "object",
            "properties": {
                "root_concept_id": {"type": "string"},
                "chain": {"type": "array", "items": {"type": "string"}, "description": "Concept ids from the observed failing concept down to the root."},
                "misconception_ids": {"type": "array", "items": {"type": "string"}},
                "confidence": {"type": "number"},
                "teacher_summary": {"type": "string", "description": "2-3 sentences for the teacher in plain language."},
                "alternative_hypothesis": {"type": "string"},
                "probes": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "question": {"type": "string"},
                            "expr": {"type": "string"},
                            "expected_answer": {"type": "string"},
                            "concept_id": {"type": "string"},
                            "if_wrong_means": {"type": "string"},
                        },
                        "required": ["question", "expr", "expected_answer", "concept_id", "if_wrong_means"],
                    },
                },
            },
            "required": ["root_concept_id", "chain", "misconception_ids", "confidence", "teacher_summary", "probes"],
            "additionalProperties": False,
        },
    },
]


def evidence_summary(student_id: str) -> dict[str, Any]:
    """Compact per-concept evidence (keeps the agent's context small and cheap)."""
    attempts = db.query("SELECT concept_id, correct, misconception_id, source FROM attempts WHERE student_id = ?", student_id)
    per: dict[str, dict[str, Any]] = {}
    for a in attempts:
        c = per.setdefault(a["concept_id"], {"tried": 0, "right": 0, "misconceptions": {}})
        c["tried"] += 1
        c["right"] += a["correct"]
        if a["misconception_id"]:
            c["misconceptions"][a["misconception_id"]] = c["misconceptions"].get(a["misconception_id"], 0) + 1
    readings = db.query("SELECT result FROM readings WHERE student_id = ? AND status = 'done' ORDER BY created DESC LIMIT 2", student_id)
    return {
        "by_concept": {cid: {**v, "class": concepts.nodes()[cid]["grade"]} for cid, v in per.items() if cid in concepts.nodes()},
        "probe_answers": db.query("SELECT question, answer, correct, concept_id FROM probes WHERE student_id = ? AND answer IS NOT NULL", student_id),
        "reading": [{k: r["result"].get(k) for k in ("level", "accuracy", "wcpm", "language")} for r in readings if isinstance(r["result"], dict)],
    }


def subgraph(student_id: str, concept_id: str) -> dict[str, Any]:
    if concept_id not in concepts.nodes():
        return {"error": f"unknown concept {concept_id}", "valid_ids": sorted(concepts.nodes())}
    m = tracing.mastery(student_id)
    seen = db.query("SELECT concept_id, misconception_id FROM attempts WHERE student_id = ? AND misconception_id IS NOT NULL", student_id)
    out = []
    for cid in [concept_id, *concepts.ancestors(concept_id)]:
        n = concepts.nodes()[cid]
        out.append({
            "id": cid, "class": n["grade"], "prereqs": n["prereqs"],
            "p_known": round(m[cid]["p"], 2) if cid in m else None, "observations": m.get(cid, {}).get("n", 0),
            "observed_misconceptions": [s["misconception_id"] for s in seen if s["concept_id"] == cid],
            "catalogue": [{"id": x["id"], "root": x["root_concept_id"]} for x in n["misconceptions"]],
        })
    return {"nodes": out}


def _check_probe(expr: str, expected: str) -> dict[str, Any]:
    if "?" in expr:
        left, right = expr.split("?", 1)
        chk = verifier.check_claim(f"{left} {expected.strip()} {right}")
    else:
        chk = verifier.check_claim(f"{expr} = {expected}")
    return {"correct": chk.status == "true", **chk.as_dict()}


async def diagnose_student(student_id: str) -> dict[str, Any]:
    student = db.get("students", student_id) or {}
    trace: list[dict[str, Any]] = []
    estimate = tracing.frontier(student_id)
    handlers: dict[str, Callable[..., Any]] = {
        "get_subgraph": lambda concept_id: subgraph(student_id, concept_id),
        "verify_answer": lambda expr, expected_answer: _check_probe(expr, expected_answer),
    }
    first = (
        f"Child: {student.get('name', '?')}, enrolled in Class {student.get('grade', '?')}.\n"
        f"BKT estimate of earliest gap: {estimate}\n"
        f"Evidence: {json.dumps(evidence_summary(student_id), ensure_ascii=False)}"
    )
    trace.append({"tool": "context", "args": {"bkt_estimate": estimate}})
    # Stateless loop: we replay the full conversation (incl. encrypted reasoning) each turn, so nothing
    # depends on server-side response storage.
    history: list[Any] = [{"role": "user", "content": first}]
    for turn in range(MAX_TURNS):
        last_turn = turn == MAX_TURNS - 1
        resp = await llm.responses_text(
            purpose="root_cause_agent",
            model=config.WONDER,
            instructions=ROOT_CAUSE_SYSTEM,
            input=history,
            tools=TOOLS,
            tool_choice={"type": "function", "name": "submit_diagnosis"} if last_turn else "auto",
            reasoning={"effort": "medium"},
            store=False,
            include=["reasoning.encrypted_content"],
        )
        history += [o.model_dump(exclude_none=True) for o in resp.output]
        calls = [o for o in resp.output if o.type == "function_call"]
        if not calls:
            history.append({"role": "user", "content": "Use the tools, then call submit_diagnosis."})
            continue
        for call in calls:
            try:
                args = json.loads(call.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            if call.name == "submit_diagnosis":
                return _finish(student_id, args, trace)
            try:
                result = handlers[call.name](**args)
            except Exception as exc:  # noqa: BLE001 - report tool errors back to the agent
                result = {"error": f"{type(exc).__name__}: {exc}"}
            trace.append({"tool": call.name, "args": args, "result_preview": json.dumps(result, ensure_ascii=False)[:400]})
            history.append({"type": "function_call_output", "call_id": call.call_id, "output": json.dumps(result, ensure_ascii=False)})
    raise RuntimeError("Root-cause agent did not submit a diagnosis")


def _finish(student_id: str, args: dict[str, Any], trace: list[dict[str, Any]]) -> dict[str, Any]:
    fixes = guardrails.validate_diagnosis(args)
    if fixes:
        trace.append({"tool": "guardrail", "args": {"fixes": fixes}})
    probes = [p for p in args.get("probes", []) if isinstance(p, dict) and p.get("expr") and p.get("expected_answer") and p.get("question")]
    args["probes"] = probes
    valid = [p for p in probes if _check_probe(p["expr"], p["expected_answer"])["correct"]]
    dropped = len(probes) - len(valid)
    trace.append({"tool": "submit_diagnosis", "args": {"root": args.get("root_concept_id"), "probes_verified": len(valid), "probes_dropped": dropped}})
    args["probes"] = valid
    root = concepts.nodes().get(args.get("root_concept_id", ""))
    args["root_concept"] = {k: root[k] for k in ("id", "name", "grade", "ncert_ref")} if root else None
    diag_id = db.insert("diagnoses", id=db.new_id("dg"), student_id=student_id, result=args, trace=trace)
    for p in valid:
        db.insert("probes", id=db.new_id("pr"), student_id=student_id, diagnosis_id=diag_id, concept_id=p["concept_id"], misconception_id=None, question=p["question"], expected=json.dumps({"expr": p["expr"], "answer": p["expected_answer"]}))
    return {"id": diag_id, **args, "trace": trace}


def answer_probe(probe_id: str, answer: str) -> dict[str, Any]:
    probe = db.get("probes", probe_id)
    if not probe:
        raise KeyError(probe_id)
    exp = json.loads(probe["expected"])
    ok = _check_probe(exp["expr"], answer)["correct"]
    db.update("probes", probe_id, answer=answer, correct=int(ok))
    tracing.observe(probe["student_id"], probe["concept_id"], ok)
    db.insert("attempts", id=db.new_id("at"), student_id=probe["student_id"], page_id=None, concept_id=probe["concept_id"], correct=int(ok), misconception_id=None, problem=f"probe: {probe['question']} → {answer}", source="probe")
    return {"correct": ok, "expected": exp["answer"]}


# ---------------------------------------------------------------- class planning (TaRL)

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "groups": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "key": {"type": "string"},
                    "title": {"type": "string"},
                    "focus_concept_id": {"type": "string"},
                    "why": {"type": "string"},
                    "activity_minutes": {"type": "integer"},
                    "materials": {"type": "array", "items": {"type": "string"}},
                    "steps": {"type": "array", "items": {"type": "string"}},
                    "teacher_script_local": {"type": "string"},
                    "practice": {
                        "type": "array",
                        "items": {"type": "object", "properties": {"question": {"type": "string"}, "expr": {"type": "string"}, "answer": {"type": "string"}}, "required": ["question", "expr", "answer"]},
                    },
                    "exit_check": {"type": "string"},
                },
                "required": ["key", "title", "focus_concept_id", "why", "activity_minutes", "materials", "steps", "teacher_script_local", "practice", "exit_check"],
            },
        },
        "rotation": {"type": "string"},
    },
    "required": ["groups", "rotation"],
}

PLAN_SYSTEM = """You plan tomorrow's maths period for one teacher in an Indian government school using
Teaching at the Right Level (TaRL): children are grouped by what they are ready to learn, not by grade.
Children in the same class are at very different levels, so the teacher runs groups in rotation in one room and each group needs an activity it can partly do alone.
Use only free local materials (sticks and rubber bands for bundles of ten, pebbles, chalk on the floor,
bottle caps, play money drawn on paper). Practice items: 6 per group, small numbers, Indian context
(rupees, mangoes, cricket runs, bus tickets). Write teacher_script_local in the class language."""


def _merge_groups(groups: dict[str, list[dict]], limit: int = 4) -> dict[str, list[dict]]:
    """Keep at most `limit` groups by merging the smallest into the nearest group in teaching order."""
    order = {cid: i for i, cid in enumerate(concepts.topo_order())}
    while len(groups) > limit:
        smallest = min(groups, key=lambda k: (len(groups[k]), order.get(k, 0)))
        others = [k for k in groups if k != smallest]
        nearest = min(others, key=lambda k: abs(order.get(k, 0) - order.get(smallest, 0)))
        keep, drop = (nearest, smallest) if order.get(nearest, 0) <= order.get(smallest, 0) else (smallest, nearest)
        groups[keep] = groups[keep] + groups.pop(drop)
    return groups


async def plan_class(class_id: str) -> dict[str, Any]:
    klass = db.get("classes", class_id) or {}
    students = db.query("SELECT * FROM students WHERE class_id = ?", class_id)
    raw: dict[str, list[dict]] = {}
    for s in students:
        f = tracing.frontier(s["id"]) or "on_track"
        raw.setdefault(f, []).append(s)
    on_track = raw.pop("on_track", [])
    groups = _merge_groups(raw)
    if on_track:
        groups["on_track"] = on_track

    briefs = []
    for key, members in groups.items():
        node = concepts.nodes().get(key)
        mis: dict[str, int] = {}
        for s in members:
            for a in db.query("SELECT misconception_id FROM attempts WHERE student_id = ? AND misconception_id IS NOT NULL", s["id"]):
                mis[a["misconception_id"]] = mis.get(a["misconception_id"], 0) + 1
        top = sorted(mis.items(), key=lambda kv: -kv[1])[:4]
        briefs.append(
            f"Group key={key}: {len(members)} children (enrolled Class {sorted({m['grade'] for m in members})}). "
            + (f"Learning frontier: {node['name']} (NCERT Class {node['grade']}, {node['ncert_ref']}). " if node else "On track: extension work. ")
            + (f"Frequent misconceptions: {', '.join(f'{m} x{c}' for m, c in top)}." if top else "")
        )

    plan = await llm.json_call(
        system=PLAN_SYSTEM,
        user=f"Class language: {klass.get('language', 'Hindi')}.\n\n" + "\n".join(briefs) + "\n\nUse exactly these group keys.",
        schema=PLAN_SCHEMA,
        name="tarl_plan",
        model=config.WONDER,
        effort="medium",
    )
    for g in plan["groups"]:
        checked = [{**p, "verified": _check_probe(p["expr"], p["answer"])["correct"]} for p in g["practice"]]
        g["practice"] = [p for p in checked if p["verified"]]
        g["practice_rejected"] = len(checked) - len(g["practice"])
        g["students"] = [{"id": s["id"], "name": s["name"], "grade": s["grade"]} for s in groups.get(g["key"], [])]
        node = concepts.nodes().get(g["focus_concept_id"])
        g["focus_concept"] = {k: node[k] for k in ("id", "name", "grade", "ncert_ref")} if node else None
    plan_id = db.insert("plans", id=db.new_id("pl"), class_id=class_id, result=plan)
    return {"id": plan_id, **plan}

