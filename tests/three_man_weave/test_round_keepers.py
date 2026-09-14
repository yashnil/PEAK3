"""A pick may not strand a later drafter in the same round (tmw_ruleset_v3).

The two states in `fixtures/stranding_states.v1.json` were captured from real
practice matches one pick before the match hung under v2: a bot's bench pick of
the roll's only point guard left the next seat (open slot: PG only) with no
legal player, its timeout found no auto-pick, and the timeout was refused on
every read. These tests pin the rule that closes that hole and the property
that makes the rule safe -- the seat on the clock always keeps a legal move.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from nba_peak.three_man_weave import draft as D
from nba_peak.three_man_weave import feasibility as F
from nba_peak.three_man_weave.arrangement import STRANDS_ROUND
from nba_peak.three_man_weave.autopick import auto_pick, auto_pick_options
from nba_peak.three_man_weave.config import stream_rng

FIXTURES = json.loads(
    (Path(__file__).parent / "fixtures" / "stranding_states.v1.json").read_text()
)["seeds"]


def _state(seed: str) -> D.DraftState:
    return D.DraftState.from_dict(FIXTURES[seed]["snapshot_before_strand"])


def _commit(state: D.DraftState, index, fit) -> D.DraftState:
    if fit.direct_slots:
        return D.apply_pick(state, index, fit.player_slug, fit.direct_slots[0])
    landed = next(slot for slot, slug in fit.plan.items() if slug == fit.player_slug)
    return D.apply_pick(state, index, fit.player_slug, landed, placements=fit.plan)


@pytest.mark.parametrize("seed", sorted(FIXTURES))
def test_the_captured_stranding_pick_is_no_longer_selectable(index, seed):
    row = FIXTURES[seed]
    state = _state(seed)
    assert state.current_seat == row["strand_seat"]
    assert state.current_round == row["round"]
    slug = row["strand_payload"]["player_slug"]

    fits = D.candidate_fits(state, index, state.current_seat)
    assert fits[slug].state == STRANDS_ROUND
    assert not fits[slug].selectable
    assert fits[slug].reason

    assert slug not in D.legal_picks(state, index, state.current_seat)
    with pytest.raises(D.DraftError) as refused:
        D.apply_pick(state, index, slug, row["strand_payload"]["slot_type"])
    assert refused.value.code == D.REJECT_STRANDS_ROUND


@pytest.mark.parametrize("seed", sorted(FIXTURES))
def test_every_keeper_leaves_the_stranded_seat_a_selectable_player(index, seed):
    """The rule is exactly as strong as it needs to be: whichever keeper the seat
    on the clock takes, the seat that used to be stranded can still draft."""
    row = FIXTURES[seed]
    state = _state(seed)
    fits = D.candidate_fits(state, index, state.current_seat)
    keepers = [fit for fit in fits.values() if fit.selectable]
    assert keepers, "the seat on the clock must keep at least one legal move"
    for fit in keepers:
        after = _commit(state, index, fit)
        while after.current_seat != row["stuck_seat"]:
            options = [f for f in D.candidate_fits(after, index, after.current_seat).values() if f.selectable]
            assert options, f"seat {after.current_seat} was stranded after {fit.player_slug}"
            after = _commit(after, index, options[0])
        stranded = D.candidate_fits(after, index, row["stuck_seat"])
        assert any(f.selectable for f in stranded.values()), fit.player_slug


@pytest.mark.parametrize("seed", sorted(FIXTURES))
def test_auto_pick_never_returns_a_stranding_pick(index, seed):
    row = FIXTURES[seed]
    state = _state(seed)
    options = auto_pick_options(state, index)
    assert options
    assert row["strand_payload"]["player_slug"] not in {o.player_slug for o in options}
    assert auto_pick(state, index).player_slug == options[0].player_slug


def test_the_last_seat_of_a_round_is_never_restricted(index):
    state = _state(sorted(FIXTURES)[0])
    while D.seats_still_to_pick_this_round(state):
        fit = next(f for f in D.candidate_fits(state, index, state.current_seat).values() if f.selectable)
        state = _commit(state, index, fit)
    assert D.round_keepers(state, index) is None


def _drive(index, seed: int, choose) -> D.DraftState:
    state = D.create_match(seed)
    while not state.is_complete:
        if state.current_roll is None:
            roll = F.roll_next(
                index, state.rosters, state.drafted_identities(), state.current_round,
                stream_rng(seed, f"roll:{state.current_round}"), frozenset(state.used_roll_ids),
            )
            assert roll is not None, f"seed {seed}: no feasible roll for round {state.current_round}"
            state = D.set_roll(state, roll)
        selectable = [f for f in D.candidate_fits(state, index, state.current_seat).values() if f.selectable]
        assert selectable, f"seed {seed}: seat {state.current_seat} stranded in round {state.current_round}"
        state = _commit(state, index, choose(selectable))
    return state


@pytest.mark.parametrize("policy", ["first", "last"])
def test_adversarially_naive_drafters_always_finish(index, policy):
    """Whatever order a drafter scans the list in, no seat is ever left with
    nothing to pick and every match completes."""
    choose = (lambda fits: min(fits, key=lambda f: f.player_slug)) if policy == "first" else (
        lambda fits: max(fits, key=lambda f: f.player_slug)
    )
    for seed in range(40):
        final = _drive(index, seed, choose)
        assert all(roster.is_complete() for roster in final.rosters)
