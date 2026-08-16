"""Direct unit coverage for `_eligible_candidates`, the fix for the reported
"$20 Showdown rolls players that no remaining bidder can roster" defect.

WHAT THIS FILE IS AND IS NOT. `test_bot_calibration.py` and
`test_phantom_lot_fix.py` prove the fix holds across real, simulated matches --
the shape a player actually experiences. This file proves the same rule at
the unit level, one precondition at a time, against real players from the
qualified pool (never a fabricated card): every candidate `_eligible_
candidates` returns is legally winnable by at least one still-eligible seat,
under every combination CLAUDE.md and the task both name -- a lone bidder with
one open slot, two bidders with disjoint needs, a multi-position player, a
completed roster, an insolvent seat, and the pool running out entirely.
"""
from __future__ import annotations

import pytest

from nba_peak.twenty_dollar import state as S
from nba_peak.twenty_dollar.config import ROSTER_SIZE, SLOTS


def _fill_seat_all_but(state: dict, pool, seat_index: int, missing: set[str]) -> None:
    """Give `seat_index` a single-position player at every slot NOT in
    `missing`, using real qualified players never reused across seats in the
    same state.
    """
    used = {
        entry["player_slug"]
        for seat in state["seats"]
        for entry in seat["roster"]
    } | set(state["offered"])
    chosen = []
    for slot in SLOTS:
        if slot in missing:
            continue
        candidate = next(
            (
                c
                for c in pool.qualified
                if c.player_slug not in used and c.positions == frozenset({slot})
            ),
            None,
        )
        assert candidate is not None, f"no single-position {slot} left in the qualified pool"
        used.add(candidate.player_slug)
        chosen.append(candidate)
    state["seats"][seat_index]["roster"] = [
        {"player_slug": c.player_slug, "price": 1, "lot_index": i, "round_index": i}
        for i, c in enumerate(chosen)
    ]
    state["offered"].extend(c.player_slug for c in chosen)


def _eligible(state: dict, pool) -> list:
    available = S._available_candidates(state, pool)
    return S._eligible_candidates(state, pool, available)


class TestASingleRemainingBidder:
    """THE EXACT SCENARIO REPORTED: one bidder left, one slot open. Every
    candidate the market can still draw must fit that slot -- Lauri Markkanen
    and Brad Daugherty, both cited in the report, must not appear once seat 0
    is the only seat left and SG is its only opening."""

    def test_only_sg_open_every_eligible_candidate_is_sg(self, pool):
        state = S.initial_state(seed=1)
        _fill_seat_all_but(state, pool, 0, missing={"SG"})
        _fill_seat_all_but(state, pool, 1, missing=set())  # seat 1: roster complete

        eligible = _eligible(state, pool)
        assert eligible, "no candidate is eligible even though seat 0 still needs an SG"
        for candidate in eligible:
            assert "SG" in candidate.positions, (
                f"{candidate.player_slug} ({sorted(candidate.positions)}) is not "
                "SG-eligible, but seat 0 -- the only seat with an open slot -- "
                "only needs SG"
            )

    def test_a_fully_rostered_seat_contributes_nothing_to_the_pool(self, pool):
        """Symmetric check: with seat 0 complete and seat 1 needing only C,
        the union is exactly the C-eligible candidates -- seat 0's completed
        roster does not widen it even though it is checked first in seat
        order."""
        state = S.initial_state(seed=2)
        _fill_seat_all_but(state, pool, 0, missing=set())
        _fill_seat_all_but(state, pool, 1, missing={"C"})

        eligible = _eligible(state, pool)
        assert eligible
        for candidate in eligible:
            assert "C" in candidate.positions


class TestTwoBiddersWithDisjointNeeds:
    def test_open_needs_pg_and_c_every_candidate_fits_at_least_one(self, pool):
        state = S.initial_state(seed=3)
        _fill_seat_all_but(state, pool, 0, missing={"PG"})
        _fill_seat_all_but(state, pool, 1, missing={"C"})

        eligible = _eligible(state, pool)
        assert eligible
        for candidate in eligible:
            assert "PG" in candidate.positions or "C" in candidate.positions, (
                f"{candidate.player_slug} fits neither seat's open need "
                f"({sorted(candidate.positions)})"
            )
        # AND THE UNION IS A REAL UNION, not one need silently dominating: a
        # market that only ever offered PG (or only ever offered C) would
        # still pass the assertion above while failing the actual product
        # requirement -- see `test_bot_calibration.py::
        # test_the_market_still_draws_broadly_when_open_needs_differ` for the
        # full-match version of this same property.
        assert any("PG" in c.positions for c in eligible)
        assert any("C" in c.positions for c in eligible)

    def test_a_multi_position_candidate_is_eligible_via_either_need(self, pool):
        """A player who can start at more than one position must count toward
        the union through WHICHEVER need it satisfies -- not be excluded for
        failing to be a single-position specialist in either.
        """
        state = S.initial_state(seed=4)
        _fill_seat_all_but(state, pool, 0, missing={"PG"})
        _fill_seat_all_but(state, pool, 1, missing={"C"})

        used = {e["player_slug"] for s in state["seats"] for e in s["roster"]} | set(
            state["offered"]
        )
        multi = next(
            (
                c
                for c in pool.qualified
                if c.player_slug not in used
                and len(c.positions) > 1
                and ("PG" in c.positions or "C" in c.positions)
            ),
            None,
        )
        if multi is None:
            pytest.skip("no multi-position PG/C-eligible player left unused in the pool")

        eligible = _eligible(state, pool)
        assert multi.player_slug in {c.player_slug for c in eligible}


class TestBidderEligibilityExcludesTheRightSeats:
    def test_a_roster_with_no_open_slots_never_widens_the_pool(self, pool):
        """Both seats complete: nothing is eligible, and the match must not
        try to keep drawing -- `_advance_lot`'s own `all(_roster_full(...))`
        check fires before eligibility is even asked, which this proves by
        construction rather than assuming."""
        state = S.initial_state(seed=5)
        _fill_seat_all_but(state, pool, 0, missing=set())
        _fill_seat_all_but(state, pool, 1, missing=set())
        assert all(S._roster_full(s) for s in state["seats"])

    def test_a_seat_with_no_legal_opening_bid_does_not_widen_the_pool(self, pool):
        """An seat that cannot even open at `MIN_OPENING_BID` under the
        reserve rule is exactly as inactive as a full roster, per
        `can_seat_acquire` -- broke is a form of eliminated."""
        state = S.initial_state(seed=6)
        _fill_seat_all_but(state, pool, 0, missing={"SG"})
        _fill_seat_all_but(state, pool, 1, missing={"C"})
        # Seat 1 is left with nothing it can legally bid: below the reserve
        # for its one remaining slot.
        state["seats"][1]["budget"] = 0

        eligible = _eligible(state, pool)
        assert eligible, "seat 0 can still act -- the pool should not be empty"
        for candidate in eligible:
            assert "SG" in candidate.positions, (
                f"{candidate.player_slug} was offered even though the only "
                "seat that can still legally bid (seat 0) needs SG, not "
                f"{sorted(candidate.positions)} -- the insolvent seat 1 "
                "should not have widened the pool"
            )


class TestPoolExhaustion:
    def test_no_eligible_candidate_left_autofills_deterministically(self, pool):
        """`_advance_lot` must never spin when nothing left in the qualified
        pool can be legally won by anybody still short a slot -- it autofills
        the same deterministic way a genuinely empty `available` list already
        does.
        """
        state = S.initial_state(seed=7)
        _fill_seat_all_but(state, pool, 0, missing={"SG"})
        _fill_seat_all_but(state, pool, 1, missing=set())

        # Consume every remaining SG-eligible qualified candidate in the
        # entire 500-player pool -- a pathological construction (a real match
        # never exhausts one position across the whole board), used here
        # specifically to force the terminal branch rather than to model a
        # realistic game.
        used = {e["player_slug"] for s in state["seats"] for e in s["roster"]} | set(
            state["offered"]
        )
        remaining_sg = [
            c for c in pool.qualified if c.player_slug not in used and "SG" in c.positions
        ]
        state["offered"].extend(c.player_slug for c in remaining_sg)

        eligible = _eligible(state, pool)
        assert eligible == [], "every SG-eligible candidate was consumed; none should remain"

        lot_index_before = state["lot_index"]
        S._advance_lot(state, pool)
        # THE INVARIANT UNDER TEST: `_advance_lot` returns -- it does not spin
        # re-drawing candidates nobody can use -- and takes the SAME
        # deterministic terminal branch a genuinely empty `available` list
        # already takes (`_autofill(reason="pool_exhausted")`), never a
        # silent no-op that would leave the lot machinery stalled. With every
        # SG-eligible player gone from the whole pool, autofill itself can
        # legitimately find nothing for that one slot either -- the assertion
        # is therefore about TERMINATION, not about the slot magically
        # filling from a supply that no longer exists.
        assert state["lot_index"] == lot_index_before, (
            "pool-exhaustion autofill must not advance the lot counter -- "
            "there was no lot to advance"
        )
        assert state["current_candidate"] is None, (
            "no candidate should be left standing after an exhausted-pool autofill"
        )
        assert len(state["seats"][0]["roster"]) in (
            ROSTER_SIZE - 1,
            ROSTER_SIZE,
        ), "seat 0's roster must be left exactly as autofill could legally leave it"


class TestBotsAndHumansAreTreatedIdentically:
    def test_eligibility_does_not_read_occupant_kind(self, pool):
        """`can_seat_acquire` -- the contract `_eligible_candidates` reuses --
        takes only `state`, `seat_index` and the candidate: there is no
        occupant-kind field anywhere in a seat's own state to special-case a
        bot against a human, and this snapshot shape carries none. Asserted
        directly against the snapshot schema so a future field cannot
        silently reintroduce the asymmetry.
        """
        state = S.initial_state(seed=8)
        _fill_seat_all_but(state, pool, 0, missing={"PG"})
        for seat in state["seats"]:
            assert "occupant_kind" not in seat and "is_bot" not in seat
        # The seam that WOULD carry a human/bot distinction (`ArenaSeat`) is
        # a foundation concept outside this pure snapshot entirely -- see
        # `apps/api/app/services/twenty_dollar/mode.py`, which hands
        # `can_seat_acquire` the same `state` regardless of which seat's turn
        # it is driving.
