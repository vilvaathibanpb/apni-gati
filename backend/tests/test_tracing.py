from __future__ import annotations

import pytest

from apnigati import config, db, tracing


@pytest.fixture(autouse=True)
def temp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "t.sqlite3")
    monkeypatch.setattr(db, "_initialised", False)
    yield


def test_bkt_moves_in_the_right_direction() -> None:
    for _ in range(4):
        tracing.observe("s1", "subtraction_with_borrow", True)
    high = tracing.mastery("s1")["subtraction_with_borrow"]["p"]
    for _ in range(4):
        tracing.observe("s2", "subtraction_with_borrow", False)
    low = tracing.mastery("s2")["subtraction_with_borrow"]["p"]
    assert high > tracing.MASTERED > tracing.GAP > low


def test_misconception_is_evidence_against_its_root_prerequisite() -> None:
    # "borrows_without_decrementing_tens" is rooted in grouping_in_tens (a Class 1 concept).
    tracing.observe("s3", "subtraction_with_borrow", False, "borrows_without_decrementing_tens")
    tracing.observe("s3", "subtraction_with_borrow", False, "borrows_without_decrementing_tens")
    m = tracing.mastery("s3")
    assert "grouping_in_tens" in m and m["grouping_in_tens"]["p"] < tracing.P_INIT


def test_frontier_is_earliest_gap_in_teaching_order() -> None:
    for _ in range(3):
        tracing.observe("s4", "long_division", False)
        tracing.observe("s4", "place_value_2_digit", False)
    assert tracing.frontier("s4") == "place_value_2_digit"


def test_easy_items_are_weaker_evidence_than_challenge_items() -> None:
    for _ in range(3):
        tracing.observe("easy", "place_value_3_digit", True, level=1)
        tracing.observe("hard", "place_value_3_digit", True, level=3)
    assert tracing.mastery("hard")["place_value_3_digit"]["p"] > tracing.mastery("easy")["place_value_3_digit"]["p"]


def test_rebuild_is_idempotent() -> None:
    for correct in (True, False, True, True):
        db.insert("attempts", id=db.new_id("at"), student_id="s5", page_id=None, concept_id="addition_with_carry", correct=int(correct), misconception_id=None, problem="", source="page", level=2)
    tracing.rebuild("s5")
    first = tracing.mastery("s5")
    tracing.rebuild("s5")
    assert tracing.mastery("s5") == first
