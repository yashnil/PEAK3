"""The deadline firing with ONE seat locked and one not.

This is the interaction most likely to produce a subtle bug, so it is tested in
both orders and on every property that could go wrong, not just "it did not
crash". Three failure modes are guarded against explicitly:

  1. STALL. The round must settle rather than wait for a lock that will never
     arrive.
  2. DISCOUNT. The locked bidder must pay the amount they actually bid. A
     first-price auction that quietly charged them $0 (or the absent
     opponent's non-bid) would hand them a discount they never offered.
  3. FORFEIT. The seat that missed the deadline must be treated as having
     PASSED, not as having lost the match or its slot. A slow connection must
     not cost a roster place, or latency becomes part of the strategy.

Both orders are covered because the two seats are not symmetric in the code:
seat 0 is the creator and holds the tie-priority token on some seeds, so a bug
that only bit the second seat would hide behind a single-order test.
"""
from __future__ import annotations

import pytest

from nba_peak.twenty_dollar import rules
from nba_peak.twenty_dollar import state as S
from nba_peak.twenty_dollar.config import STARTING_BUDGET, TIMEOUT_BID
from nba_peak.twenty_dollar.pool import get_pool


@pytest.fixture(scope="module")
def pool():
    return get_pool()


@pytest.mark.parametrize("locked_seat", [0, 1])
class TestDeadlineWithOneSeatLocked:
    """Every assertion runs for BOTH orders: creator locked, opponent locked."""

    def test_the_round_settles_rather_than_stalling(self, locked_seat, pool):
        st = S.initial_state(seed=8080)
        S.submit_bid(st, locked_seat, 6, pool)
        assert S.all_locked(st) is False, "precondition: the round is not complete"

        st = S.resolve_round(st, pool)

        assert len(st["history"]) == 1
        # The board moved on: either a new candidate or the match ended.
        assert st["current_candidate"] is not None or S.is_complete(st)

    def test_the_locked_bidder_wins_and_pays_their_own_bid(self, locked_seat, pool):
        st = S.initial_state(seed=8080)
        S.submit_bid(st, locked_seat, 6, pool)
        st = S.resolve_round(st, pool)

        record = st["history"][0]
        assert record["winner_seat"] == locked_seat
        assert record["price"] == 6, "the locked bidder must not receive a discount"
        assert st["seats"][locked_seat]["budget"] == STARTING_BUDGET - 6

    def test_the_absent_seat_is_recorded_as_a_pass_not_a_forfeit(self, locked_seat, pool):
        st = S.initial_state(seed=8080)
        absent = 1 - locked_seat
        S.submit_bid(st, locked_seat, 6, pool)
        st = S.resolve_round(st, pool)

        record = st["history"][0]
        assert record["bids"][absent] == TIMEOUT_BID == 0
        assert record["timed_out"][absent] is True
        assert record["timed_out"][locked_seat] is False
        # A pass costs nothing and forfeits nothing.
        assert st["seats"][absent]["budget"] == STARTING_BUDGET
        assert st["seats"][absent]["roster"] == []

    def test_the_absent_seat_can_still_play_the_next_round(self, locked_seat, pool):
        """Missing a deadline must not remove a seat from the match."""
        st = S.initial_state(seed=8080)
        absent = 1 - locked_seat
        S.submit_bid(st, locked_seat, 6, pool)
        st = S.resolve_round(st, pool)

        if not S.is_complete(st):
            assert S.legal_commands(st, absent) == ("bid", "pass")
            _, code, _ = S.submit_bid(st, absent, 2, pool)
            assert code is None

    def test_a_timeout_does_not_spend_the_tie_priority_token(self, locked_seat, pool):
        """One bid against a pass is decided on amount, so no tie-break
        happened and the token must not move."""
        st = S.initial_state(seed=8080)
        before = st["tie_priority_seat"]
        S.submit_bid(st, locked_seat, 6, pool)
        st = S.resolve_round(st, pool)

        assert st["history"][0]["decided_by"] == "bid_amount"
        assert st["history"][0]["tie_priority_used"] is False
        assert st["tie_priority_seat"] == before

    def test_a_zero_bid_lock_against_a_timeout_sells_nothing(self, locked_seat, pool):
        """A locked PASS and an absent seat are two passes.

        The candidate must leave unsold rather than being awarded to whoever
        happened to send a request.
        """
        st = S.initial_state(seed=8080)
        S.submit_bid(st, locked_seat, 0, pool)
        st = S.resolve_round(st, pool)

        record = st["history"][0]
        assert record["winner_seat"] is None
        assert record["price"] == 0
        assert all(seat["budget"] == STARTING_BUDGET for seat in st["seats"])

    def test_resolution_is_deterministic(self, locked_seat, pool):
        """Same seed, same lock, same outcome -- a timeout must not introduce
        a source of variation the seed cannot reproduce."""
        outcomes = []
        for _ in range(2):
            st = S.initial_state(seed=8080)
            S.submit_bid(st, locked_seat, 6, pool)
            st = S.resolve_round(st, pool)
            record = st["history"][0]
            outcomes.append(
                (record["candidate"]["player_slug"], record["winner_seat"], record["price"])
            )
        assert outcomes[0] == outcomes[1]


class TestBothSeatsTimeOut:
    def test_a_double_timeout_sells_nothing_and_still_advances(self, pool):
        st = S.initial_state(seed=8080)
        st = S.resolve_round(st, pool)

        record = st["history"][0]
        assert record["winner_seat"] is None
        assert record["timed_out"] == [True, True]
        assert st["round_index"] == 1
        assert st["current_candidate"] is not None or S.is_complete(st)

    def test_repeated_double_timeouts_still_terminate(self, pool):
        """The pass-loop guard, reached through the timeout path rather than
        through explicit passes."""
        st = S.initial_state(seed=8080)
        guard = 0
        while not S.is_complete(st):
            guard += 1
            assert guard < 300, "repeated timeouts did not terminate"
            st = S.resolve_round(st, pool)
        assert st["autofilled"] is True
        for seat in st["seats"]:
            assert len(seat["roster"]) == 5


class TestTimeoutDoesNotBypassLegality:
    def test_a_locked_bid_that_became_illegal_is_demoted_to_a_pass(self, pool):
        """A bid the seat can no longer honour must not be silently bought.

        Reachable only if the roster changed between lock and resolve. Guarded
        rather than assumed impossible, because the failure would be a seat
        buying a player it cannot legally seat.
        """
        st = S.initial_state(seed=8080)
        S.submit_bid(st, 0, 5, pool)
        # Fill seat 0's roster behind its own back, so the locked bid is no
        # longer legal at resolve time.
        card = pool.get(st["current_candidate"])
        st["seats"][0]["roster"] = [
            {"player_slug": c.player_slug, "price": 1, "round_index": 0}
            for c in _five_legal_excluding(pool, card.player_slug)
        ]
        st = S.resolve_round(st, pool)

        record = st["history"][0]
        assert record["winner_seat"] is None, "an illegal locked bid must not buy"
        assert record["bids"][0] == 0


def _five_legal_excluding(pool, excluded_slug):
    """One real player per slot, none of them the excluded candidate."""
    from nba_peak.twenty_dollar import feasibility
    from nba_peak.twenty_dollar.config import SLOTS

    chosen = []
    used = {excluded_slug}
    for slot in SLOTS:
        for candidate in pool.eligible_for(slot):
            if candidate.player_slug in used:
                continue
            owned = [(c.player_slug, c.positions) for c in chosen]
            if feasibility.fillable_slots(owned, candidate.positions):
                chosen.append(candidate)
                used.add(candidate.player_slug)
                break
    assert len(chosen) == 5
    return chosen
