"""Deterministic timeout auto-pick."""
from __future__ import annotations

import dataclasses

import pytest

from nba_peak.three_man_weave import draft as D
from nba_peak.three_man_weave.autopick import auto_pick
from nba_peak.three_man_weave.config import AUTOPICK_VERSION
from nba_peak.three_man_weave.schemas import Roll, Roster


def _roll(round_number: int, slugs, franchise="CHI", decade="1990s") -> Roll:
    return Roll(
        round_number=round_number,
        franchise_id=franchise,
        franchise_display_name="Chicago Bulls",
        decade=decade,
        eligible_slugs=tuple(slugs),
    )


@pytest.fixture
def opened_state():
    state = D.create_match(20260803)
    return D.set_roll(
        state, _roll(1, ["michael-jordan", "scottie-pippen", "dennis-rodman", "horace-grant"])
    )


# ---------------------------------------------------------------------------
# Purity and determinism
# ---------------------------------------------------------------------------
def test_auto_pick_is_a_pure_function_of_state_and_seed(index, opened_state):
    """The platform layer resolves a timeout/action race by computing this
    and committing exactly one action. Any node that recomputes it later must
    get the same answer, or the decision is not auditable."""
    first = auto_pick(opened_state, index, seed=5)
    for _ in range(5):
        assert auto_pick(opened_state, index, seed=5).as_dict() == first.as_dict()


def test_auto_pick_does_not_mutate_the_state(index, opened_state):
    before = opened_state.as_dict()
    auto_pick(opened_state, index, seed=5)
    assert opened_state.as_dict() == before


def test_the_seed_is_what_varies_the_tie_break(index, opened_state):
    """Different seeds are allowed to differ, but each is stable."""
    picks = {seed: auto_pick(opened_state, index, seed=seed).player_slug for seed in range(6)}
    for seed, slug in picks.items():
        assert auto_pick(opened_state, index, seed=seed).player_slug == slug


def test_the_match_seed_is_used_when_no_seed_is_given(index, opened_state):
    assert (
        auto_pick(opened_state, index).as_dict()
        == auto_pick(opened_state, index, seed=opened_state.match_seed).as_dict()
    )


def test_result_carries_its_own_version(index, opened_state):
    assert auto_pick(opened_state, index).autopick_version == AUTOPICK_VERSION


# ---------------------------------------------------------------------------
# The policy
# ---------------------------------------------------------------------------
def test_auto_pick_takes_the_best_available_by_scoring_card(index, opened_state):
    """"Best" means best by the number the roster is actually scored on --
    not by a separate heuristic that could disagree with the result."""
    pick = auto_pick(opened_state, index)
    assert pick.player_slug == "michael-jordan"
    expected = index.scoring_card(
        "michael-jordan", opened_state.current_roll.franchise_id, "1990s"
    ).prime_score
    assert pick.scoring_score == pytest.approx(expected)


def test_auto_pick_only_ever_returns_a_legal_placement(index, opened_state):
    pick = auto_pick(opened_state, index)
    assert pick.slot_type in D.legal_slots_for_pick(opened_state, pick.seat_index, pick.player_slug)
    # And it is genuinely applicable.
    D.apply_pick(opened_state, pick.player_slug, pick.slot_type)


def test_auto_pick_respects_the_identity_lock(index):
    state = D.create_match(1)
    state = D.set_roll(state, _roll(1, ["michael-jordan", "scottie-pippen", "dennis-rodman"]))
    state = D.apply_pick(state, "michael-jordan", "SG")
    for _ in range(2):
        pick = auto_pick(state, index)
        assert pick.player_slug != "michael-jordan"
        state = D.apply_pick(state, pick.player_slug, pick.slot_type)


def test_auto_pick_respects_hard_position_legality(index):
    """A roll of pure centres against a seat with only PG open has nothing
    legal, and auto_pick must say so rather than inventing a placement."""
    state = D.create_match(1)
    state = D.set_roll(state, _roll(1, ["shaquille-o-neal", "dikembe-mutombo", "patrick-ewing"]))
    filled = dict(state.rosters[0].slots)
    for slot, slug in [
        ("SG", "michael-jordan"),
        ("SF", "larry-bird"),
        ("PF", "tim-duncan"),
        ("C", "hakeem-olajuwon"),
        ("bench_1", "scottie-pippen"),
    ]:
        filled[slot] = D.DraftPick(
            seat_index=0,
            round_number=1,
            slot_type=slot,
            player_slug=slug,
            franchise_id="CHI",
            decade="1990s",
        )
    state = dataclasses.replace(
        state, rosters=(Roster(seat_index=0, slots=filled),) + state.rosters[1:]
    )
    assert state.rosters[0].open_slots() == ("PG",)
    assert auto_pick(state, index) is None


def test_auto_pick_prefers_a_choice_that_keeps_the_match_completable(index, opened_state):
    pick = auto_pick(opened_state, index)
    assert pick.preserved_completability is True


def test_auto_pick_returns_none_when_nothing_is_legal(index):
    state = D.create_match(1)
    state = D.set_roll(state, _roll(1, []))
    assert auto_pick(state, index) is None


def test_auto_pick_returns_none_without_a_roll(index):
    assert auto_pick(D.create_match(1), index) is None


def test_auto_pick_returns_none_for_a_completed_match(index, completed_match):
    assert auto_pick(completed_match, index) is None


# ---------------------------------------------------------------------------
# Driving a whole match on auto-pick
# ---------------------------------------------------------------------------
def test_auto_pick_alone_can_complete_a_match(index, match_driver):
    """If auto-pick could strand a match, a table of three idle players would
    deadlock. It must be able to finish on its own."""
    for seed in (1, 2, 3, 101, 20260803):
        state = match_driver(index, seed)
        assert state.is_complete
        assert len(state.drafted_identities()) == 18
