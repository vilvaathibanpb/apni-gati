"""Deterministic tests: no network, no API spend.  Run: uv run pytest -q"""
from __future__ import annotations

import pytest

from apnigati import concepts, guardrails, reading, verifier


# ---------------------------------------------------------------- verifier

@pytest.mark.parametrize(
    "claim,status",
    [
        ("503 - 278 = 225", "true"),
        ("503 - 278 = 235", "false"),
        ("52 - 28 = 36", "false"),          # smaller-from-larger misconception
        ("1307 ÷ 15 = 87 R 2", "true"),
        ("1307 ÷ 15 = 87 R 3", "false"),
        ("1307 : 15 = 87,13", "true"),      # European division sign + decimal comma, truncated recurring
        ("3/4 + 1/8 = 7/8", "true"),
        ("1/2 + 1/3 = 2/5", "false"),       # added straight across
        ("0.5 > 0.25", "true"),
        ("0.25 > 0.5", "false"),            # longer decimal judged larger
        ("12,34,567 + 1 = 12,34,568", "true"),  # Indian digit grouping
        ("2,345 + 1,000 = 3,345", "true"),
        ("12 × 13 = 156", "true"),
        ("2 1/4 + 1/4 = 2 1/2", "true"),    # mixed numbers
        ("abc = 3", "unparseable"),
        ("hello", "unparseable"),
    ],
)
def test_check_claim(claim: str, status: str) -> None:
    assert verifier.check_claim(claim).status == status


def test_solve() -> None:
    assert verifier.solve("503 - 278") == "225"
    assert verifier.solve("1307 / 15").startswith("87 R 2")
    assert verifier.solve("not maths") is None


def test_wrong_never_reported_true_for_close_integers() -> None:
    # Decimal tolerance must not leak into integer answers.
    assert verifier.check_claim("100 - 1 = 98").status == "false"


# ---------------------------------------------------------------- reading

def test_alignment_ops() -> None:
    ref = reading.tokens("My name is Ravi. I have a red ball.")
    said = reading.tokens("my name Ravi I have a red bell ball")
    ops = [o["op"] for o in reading.align(ref, said)]
    assert "omitted" in ops and ("inserted" in ops or "substituted" in ops)


def test_hindi_normalisation_ignores_nukta_variants() -> None:
    assert reading.normalise_word("सफ़ेद") == reading.normalise_word("सफेद")
    assert reading.normalise_word("है।") == "है"


def test_score_levels() -> None:
    p = {"level": "story"}
    ref = ["a"] * 40
    perfect = reading.score(p, reading.align(ref, ref), 60)
    assert perfect["passed"] and perfect["wcpm"] == 40 and perfect["next_test"] is None
    poor = reading.score(p, reading.align(ref, ref[:30]), 60)
    assert not poor["passed"] and poor["next_test"] == "paragraph"


# ---------------------------------------------------------------- guardrails

def test_hint_must_not_reveal_answer() -> None:
    assert "reveals answer 225" in guardrails.deterministic_hint_issues("en", "The answer is 225, well done", "225")
    assert not guardrails.deterministic_hint_issues("en", "Check the tens column again. You can do it!", "225")


def test_hint_script_and_tone() -> None:
    assert "wrong script" in guardrails.deterministic_hint_issues("ta", "Look again", "24")
    assert "harsh wording" in guardrails.deterministic_hint_issues("en", "That was careless", "24")
    for lang, hint in guardrails.SAFE_HINTS.items():
        assert not guardrails.deterministic_hint_issues(lang, hint, "24"), lang


def test_validate_diagnosis_clamps_to_graph() -> None:
    some = next(iter(concepts.nodes()))
    args = {
        "root_concept_id": "made_up_concept",
        "chain": ["made_up_concept", some],
        "misconception_ids": ["nope"],
        "confidence": 1.7,
        "probes": [
            {"question": "What is 5 + 3?", "expr": "5 + 3", "expected_answer": "8", "concept_id": some, "if_wrong_means": ""},
            {"question": "What is 9999999 + 1?", "expr": "9999999 + 1", "expected_answer": "10000000", "concept_id": some, "if_wrong_means": ""},
            {"question": "x", "expr": "1+1", "expected_answer": "2", "concept_id": "bogus", "if_wrong_means": ""},
        ],
    }
    fixes = guardrails.validate_diagnosis(args)
    assert args["root_concept_id"] == some and args["chain"] == [some]
    assert args["misconception_ids"] == [] and args["confidence"] == 1.0
    assert len(args["probes"]) == 1 and fixes


# ---------------------------------------------------------------- concept graph

def test_graph_is_a_dag_with_valid_references() -> None:
    order = concepts.topo_order()
    assert len(order) == len(concepts.nodes())
    for m in concepts.misconceptions().values():
        assert m["root_concept_id"] in concepts.nodes()


def test_ancestors_reach_foundations() -> None:
    anc = concepts.ancestors("long_division")
    assert "subtraction_with_borrow" in anc and "place_value_2_digit" in anc


def test_teaching_order_respects_prerequisites() -> None:
    pos = {c: i for i, c in enumerate(concepts.topo_order())}
    for c, n in concepts.nodes().items():
        assert all(pos[q] < pos[c] for q in n["prereqs"]), c


def test_plan_guardrail_rejects_keyboard_mash() -> None:
    bad = {"groups": [{"key": "g", "title": "sdfghjkl", "teacher_script_local": ""}]}
    good = {"groups": [{"key": "g", "title": "பத்து பத்தாக கட்டு", "teacher_script_local": "இன்று நாம் பத்து குச்சிகளை ஒரு கட்டாகக் கட்டுவோம்."}]}
    assert len(guardrails.plan_text_issues(bad, "Tamil")) == 2
    assert guardrails.plan_text_issues(good, "Tamil") == []
    assert not guardrails._looks_like_junk("Bundles of ten")
