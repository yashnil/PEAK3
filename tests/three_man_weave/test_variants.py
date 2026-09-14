"""FRANCHISE DRAFT and DECADE DRAFT: one constraint for all eighteen picks.

The variants reuse the whole draft engine; what these tests pin is the one
thing a variant changes -- which pool every round draws from -- and the
property that makes a fixed pool safe: no pick may leave any roster unable to
finish (`variants.CompletionOracle`, `draft.round_keepers`).
"""
from __future__ import annotations

import random

import pytest

from nba_peak.three_man_weave import draft as D
from nba_peak.three_man_weave import variants as V
from nba_peak.three_man_weave.autopick import auto_pick_options
from nba_peak.three_man_weave.config import PARTICIPANT_COUNT, ROUNDS, SLOT_TYPES
from nba_peak.three_man_weave.feasibility import can_fill_open_slots
from nba_peak.three_man_weave.positions import is_legal


def _open_round(state: D.DraftState) -> D.DraftState:
    return D.set_roll(
        state,
        V.constraint_roll(state.constraint, state.current_round, state.drafted_identities()),
    )


def _commit(state: D.DraftState, index, fit) -> D.DraftState:
    if fit.direct_slots:
        return D.apply_pick(state, index, fit.player_slug, fit.direct_slots[0])
    landed = next(slot for slot, slug in fit.plan.items() if slug == fit.player_slug)
    return D.apply_pick(state, index, fit.player_slug, landed, placements=fit.plan)


def _drive(index, kind: str, seed: int, choose) -> D.DraftState:
    state = D.create_match(seed, constraint=V.choose_constraint(kind, seed))
    while not state.is_complete:
        if state.current_roll is None:
            state = _open_round(state)
        fits = D.candidate_fits(state, index, state.current_seat)
        selectable = [fit for fit in fits.values() if fit.selectable]
        assert selectable, f"{kind} seed {seed}: seat {state.current_seat} stranded in round {state.current_round}"
        state = _commit(state, index, choose(selectable))
    return state


@pytest.mark.parametrize("kind", [V.VARIANT_FRANCHISE, V.VARIANT_DECADE])
def test_the_constraint_is_drawn_deterministically_from_the_seed(kind):
    first = V.choose_constraint(kind, 4242)
    assert V.choose_constraint(kind, 4242) == first
    assert len({V.choose_constraint(kind, seed).value for seed in range(40)}) > 1
    assert first in V.viable_constraints(kind)


@pytest.mark.parametrize("kind", [V.VARIANT_FRANCHISE, V.VARIANT_DECADE])
def test_every_viable_constraint_is_deep_and_completable(index, kind):
    options = V.viable_constraints(kind)
    assert options
    for constraint in options:
        assert len(constraint.pool) >= V.MIN_POOL_IDENTITIES
        rights = V._rights(index, constraint.cards)
        assert can_fill_open_slots({seat: SLOT_TYPES for seat in range(PARTICIPANT_COUNT)}, constraint.pool, rights)
        for slug, franchise_id, decade in constraint.cards:
            if kind == V.VARIANT_FRANCHISE:
                assert franchise_id == constraint.value
            else:
                assert decade == constraint.value
            assert index.scoring_card(slug, franchise_id, decade) is not None


def test_a_card_is_the_best_season_under_the_constraint(index):
    constraint = V.choose_constraint(V.VARIANT_FRANCHISE, 7)
    for slug, franchise_id, decade in constraint.cards[:40]:
        chosen = index.scoring_card(slug, franchise_id, decade).prime_score
        for other_franchise, other_decade in index.rolls():
            if other_franchise != franchise_id:
                continue
            card = index.scoring_card(slug, other_franchise, other_decade)
            if card is not None:
                assert card.prime_score <= chosen


@pytest.mark.parametrize("kind", [V.VARIANT_FRANCHISE, V.VARIANT_DECADE])
@pytest.mark.parametrize("policy", ["first", "last", "random"])
def test_naive_and_adversarial_drafters_always_finish_a_variant(index, kind, policy):
    """Whatever order drafters scan the pool in, every match completes: nobody is
    ever left with an open slot and nobody to put in it."""
    for seed in range(8):
        rng = random.Random(f"{kind}:{policy}:{seed}")
        choose = {
            "first": lambda fits: min(fits, key=lambda f: f.player_slug),
            "last": lambda fits: max(fits, key=lambda f: f.player_slug),
            "random": lambda fits: fits[rng.randrange(len(fits))],
        }[policy]
        final = _drive(index, kind, seed, choose)
        assert all(roster.is_complete() for roster in final.rosters)
        assert len(final.picks) == ROUNDS * PARTICIPANT_COUNT
        slugs = [pick.player_slug for pick in final.picks]
        assert len(slugs) == len(set(slugs))
        for pick in final.picks:
            if kind == V.VARIANT_FRANCHISE:
                assert pick.franchise_id == final.constraint.value
            else:
                assert pick.decade == final.constraint.value
            assert (pick.franchise_id, pick.decade) == final.constraint.card_key(pick.player_slug)
            assert index.scoring_card(pick.player_slug, pick.franchise_id, pick.decade) is not None


@pytest.mark.parametrize("kind", [V.VARIANT_FRANCHISE, V.VARIANT_DECADE])
def test_the_oracle_agrees_with_a_brute_force_matching(index, kind):
    """For sampled mid-draft states, every candidate's keeper verdict equals the
    direct question: can every roster still be completed after this pick?"""
    for seed in (1, 2, 3):
        state = D.create_match(seed, constraint=V.choose_constraint(kind, seed))
        rng = random.Random(seed)
        for _ in range(rng.randrange(6, 15)):
            if state.current_roll is None:
                state = _open_round(state)
            fits = [f for f in D.candidate_fits(state, index, state.current_seat).values() if f.selectable]
            state = _commit(state, index, fits[rng.randrange(len(fits))])
        if state.current_roll is None:
            state = _open_round(state)
        seat = state.current_seat
        rights = state.slot_rights(index)
        keepers = D.round_keepers(state, index, rights)
        assert keepers is not None
        roster = state.roster(seat)
        assignment = roster.assignment()
        filled = {slot for slot, slug in assignment.items() if slug}
        pool = D.undrafted_pool(state, index)
        from nba_peak.three_man_weave.arrangement import candidate_fit

        for slug in pool:
            fit = candidate_fit(assignment, slug, rights)
            if not fit.selectable:
                continue
            slots = fit.direct_slots if fit.direct_slots else tuple(set(fit.plan) - filled)
            brute = any(
                can_fill_open_slots(
                    {
                        r.seat_index: tuple(s for s in r.open_slots() if not (r.seat_index == seat and s == taken))
                        for r in state.rosters
                    },
                    [p for p in pool if p != slug],
                    rights,
                )
                for taken in slots
            )
            assert (slug in keepers) == brute, (kind, seed, slug)


def test_a_variant_state_round_trips_with_its_constraint(index):
    state = D.create_match(11, constraint=V.choose_constraint(V.VARIANT_DECADE, 11))
    state = _open_round(state)
    back = D.DraftState.from_dict(state.as_dict())
    assert back.constraint == state.constraint
    assert back.as_dict() == state.as_dict()


def test_auto_pick_in_a_variant_only_offers_completable_picks(index):
    state = D.create_match(5, constraint=V.choose_constraint(V.VARIANT_FRANCHISE, 5))
    rng = random.Random(5)
    while state.turn_index < 12:
        if state.current_roll is None:
            state = _open_round(state)
        fits = [f for f in D.candidate_fits(state, index, state.current_seat).values() if f.selectable]
        state = _commit(state, index, fits[rng.randrange(len(fits))])
    if state.current_roll is None:
        state = _open_round(state)
    keepers = D.round_keepers(state, index)
    options = auto_pick_options(state, index)
    assert options
    assert all(option.player_slug in keepers for option in options)
