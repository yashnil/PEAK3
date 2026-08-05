"""The Three-Man Weave bot: competent, imperfect, and never illegal.

WHY THE CALIBRATION IS TESTED AS A DISTRIBUTION. "The bot is not always
optimal" is not a property of any single pick -- taking the best available
player is the right move most of the time, and a test that forbade it would be
testing a worse bot. It is a property of a thousand picks, and it is only
falsifiable at that scale.

The bands below are ORDINAL over the bot's own ranked options, so the
calibration means the same thing on a six-candidate roll and a fifty-candidate
one.
"""
from __future__ import annotations

import random
from collections import Counter

import pytest

from nba_peak.three_man_weave import draft as D
from nba_peak.three_man_weave import feasibility as F
from nba_peak.three_man_weave.bot import (
    BOT_ARCHETYPE_NAMES,
    ThreeManWeaveBot,
    archetype_names,
)
from nba_peak.three_man_weave.config import stream_rng

#: Enough matches for the bands to be stable, few enough to stay a fast test.
SEEDS = 60


def _projection(state: D.DraftState, seat: int) -> tuple[dict, dict]:
    """The two dicts the mode's own `project` produces, built from the state."""
    roll = state.current_roll
    assert roll is not None
    fits = D.candidate_fits(state, seat)
    public = {
        "current_roll": {
            **roll.as_dict(),
            "candidates": [{"player_slug": slug} for slug in roll.eligible_slugs],
        }
    }
    private = {
        "open_slots": list(state.roster(seat).open_slots()),
        "candidate_fits": {slug: fit.as_dict() for slug, fit in fits.items()},
    }
    return public, private


def _play(index, seed: int, record: Counter | None = None) -> D.DraftState:
    state = D.create_match(seed)
    roll_rng = stream_rng(seed, "rolls")
    while not state.is_complete:
        if (
            state.current_roll is None
            or state.current_roll.round_number != state.current_round
        ):
            roll = F.roll_next(
                index,
                state.rosters,
                state.drafted_identities(),
                state.current_round,
                roll_rng,
                frozenset(state.used_roll_ids),
            )
            assert roll is not None, f"no feasible roll at round {state.current_round}"
            state = D.set_roll(state, roll)

        seat = state.current_seat
        assert seat is not None
        public, private = _projection(state, seat)
        bot = ThreeManWeaveBot()
        options = bot.options(public, private)
        decision = bot.decide(public, private, random.Random(f"tmw:{seed}:{state.turn_index}"))
        assert decision is not None, f"seed {seed}: the bot had no legal move"
        _command, payload = decision

        if record is not None and options:
            rank = next(
                position
                for position, option in enumerate(options)
                if option["player_slug"] == payload["player_slug"]
                and option["slot_type"] == payload["slot_type"]
            )
            fraction = rank / len(options)
            record[
                "strong"
                if fraction < 0.20
                else "defensible"
                if fraction < 0.55
                else "mistake"
                if fraction < 0.80
                else "tail"
            ] += 1

        state = D.apply_pick(
            state,
            payload["player_slug"],
            payload.get("slot_type"),
            seat_index=seat,
            placements=payload.get("placements"),
        )
    return state


@pytest.fixture(scope="module")
def calibration(index) -> Counter:
    record: Counter = Counter()
    for seed in range(SEEDS):
        _play(index, seed, record)
    return record


def test_every_bot_pick_is_legal_and_every_match_completes(index):
    for seed in range(12):
        state = _play(index, seed)
        assert state.is_complete
        for roster in state.rosters:
            assert roster.is_complete()
        # And the identity lock held throughout.
        slugs = [pick.player_slug for pick in state.picks]
        assert len(slugs) == len(set(slugs))


def test_the_bot_is_usually_strong(calibration):
    total = sum(calibration.values())
    assert total > 500
    assert 0.60 <= calibration["strong"] / total <= 0.80


def test_the_bot_is_regularly_defensible_rather_than_optimal(calibration):
    total = sum(calibration.values())
    assert 0.15 <= calibration["defensible"] / total <= 0.35


def test_the_bot_makes_occasional_mild_mistakes(calibration):
    """Mild, and never worse than mild. The mistake band is drawn from the
    MIDDLE of the ranking: an imperfect drafter takes the third-best wing, not
    the worst player on the board."""
    total = sum(calibration.values())
    assert 0.01 <= calibration["mistake"] / total <= 0.12
    assert calibration["tail"] == 0, "the bot reached into the bottom of its own ranking"


def test_the_bot_never_simply_takes_the_highest_scoring_candidate(index):
    """The v1 policy, asserted against.

    v1 ranked by scoring card and took the maximum, so it agreed with the
    auto-pick on every single turn. If that were still true, the bot would be
    an oracle and the mode would be a game against arithmetic.
    """
    from nba_peak.three_man_weave.autopick import auto_pick

    agreements = 0
    turns = 0
    for seed in range(8):
        state = D.create_match(seed)
        roll_rng = stream_rng(seed, "rolls")
        while not state.is_complete:
            if (
                state.current_roll is None
                or state.current_roll.round_number != state.current_round
            ):
                roll = F.roll_next(
                    index,
                    state.rosters,
                    state.drafted_identities(),
                    state.current_round,
                    roll_rng,
                    frozenset(state.used_roll_ids),
                )
                assert roll is not None
                state = D.set_roll(state, roll)
            seat = state.current_seat
            public, private = _projection(state, seat)
            decision = ThreeManWeaveBot().decide(
                public, private, random.Random(f"tmw:{seed}:{state.turn_index}")
            )
            assert decision is not None
            _command, payload = decision
            greedy = auto_pick(state, index)
            turns += 1
            if greedy and greedy.player_slug == payload["player_slug"]:
                agreements += 1
            state = D.apply_pick(
                state,
                payload["player_slug"],
                payload.get("slot_type"),
                seat_index=seat,
                placements=payload.get("placements"),
            )
    assert agreements < turns, "the bot agreed with best-available on every turn"


def test_the_bot_is_deterministic_from_the_same_inputs(index):
    first = _play(index, 4242)
    second = _play(index, 4242)
    assert [pick.as_dict() for pick in first.picks] == [
        pick.as_dict() for pick in second.picks
    ]


def test_bot_names_are_unique_thematic_and_never_a_real_player(index):
    for seed in range(40):
        names = archetype_names(seed, 2)
        assert len(set(names)) == 2
        for name in names:
            assert name in BOT_ARCHETYPE_NAMES
            assert "PEAK3" not in name
            assert not any(char.isdigit() for char in name)
    # Drafted player names must stay unambiguous, so no archetype may collide
    # with an identity the game can offer.
    everyone = set()
    for roll in index.rolls():
        everyone |= index.eligible_slugs(*roll)
    real = {index.player_name(slug) for slug in everyone}
    assert not (set(BOT_ARCHETYPE_NAMES) & real)
