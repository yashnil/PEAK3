"""Budget arithmetic and the ascending-auction step, rule by rule.

Every test here names the brief rule it covers, because these are the rules a
player is told and the ones a receipt has to be able to justify.
"""
from __future__ import annotations

import pytest

from nba_peak.twenty_dollar import rules
from nba_peak.twenty_dollar import state as S
from nba_peak.twenty_dollar.config import (
    MIN_OPENING_BID,
    MIN_RAISE,
    ROSTER_SIZE,
    STARTING_BUDGET,
)


class TestReserveRule:
    """Brief rule 11: keep at least $1 for every slot that stays empty."""

    def test_the_briefs_worked_example(self):
        # $20, five empty slots -> the most you may open with is $16, which
        # leaves $4 for the four slots you still have to fill.
        assert rules.max_legal_bid(STARTING_BUDGET, 0) == 16
        assert STARTING_BUDGET - 16 == 4

    def test_opening_bid_ceiling(self):
        assert rules.max_legal_bid(11, 2) == 9

    def test_final_slot_may_spend_everything(self):
        assert rules.max_legal_bid(7, ROSTER_SIZE - 1) == 7

    def test_never_negative(self):
        assert rules.max_legal_bid(0, 0) == 0
        assert rules.max_legal_bid(1, 0) == 0

    @pytest.mark.parametrize("filled", range(ROSTER_SIZE))
    def test_spending_the_maximum_leaves_the_roster_affordable(self, filled):
        budget = STARTING_BUDGET
        top = rules.max_legal_bid(budget, filled)
        assert rules.is_solvent(budget - top, filled + 1)

    def test_the_reserve_floor_is_the_complement_of_the_ceiling(self):
        for filled in range(ROSTER_SIZE):
            assert (
                rules.max_legal_bid(STARTING_BUDGET, filled)
                + rules.reserve_floor(filled)
                == STARTING_BUDGET
            )


class TestMinimumBid:
    """Brief rules 6 and 8: open at $1, raise by at least $1."""

    def test_an_empty_lot_opens_at_one_dollar(self):
        assert rules.minimum_bid(0) == MIN_OPENING_BID

    def test_a_live_bid_must_be_cleared_by_the_raise_increment(self):
        assert rules.minimum_bid(4) == 4 + MIN_RAISE

    def test_matching_the_standing_bid_is_not_a_raise(self):
        # Which is exactly why sequential bidding makes a tie unreachable
        # (brief rule 9) and why there is no tie-break in this ruleset.
        assert rules.minimum_bid(6) > 6

    def test_a_seat_that_cannot_clear_the_standing_bid_has_no_legal_bid(self):
        # $3 left, one slot open -> ceiling $3, standing bid $3 -> nothing legal.
        assert not rules.can_afford_minimum(3, ROSTER_SIZE - 1, 3)
        assert rules.can_afford_minimum(4, ROSTER_SIZE - 1, 3)


class TestWholeDollars:
    def test_a_bool_is_not_a_bid(self):
        # bool subclasses int, and True would otherwise bid one dollar.
        assert not rules.is_whole_dollars(True)
        assert not rules.is_whole_dollars(False)

    def test_a_float_is_not_a_bid(self):
        assert not rules.is_whole_dollars(3.0)
        assert rules.is_whole_dollars(3)


class TestSealedBidRemoval:
    """The v1 auction is gone, not disabled. Two systems in parallel is the
    thing the rewrite existed to avoid, so its symbols must not resolve."""

    @pytest.mark.parametrize(
        "name",
        ["resolve", "BID_ORDER", "BidOutcome", "initial_tie_priority", "next_tie_priority"],
    )
    def test_the_v1_symbols_are_gone_with_an_explanation(self, name):
        with pytest.raises(AttributeError, match="v1 sealed-bid"):
            getattr(rules, name)

    def test_no_state_carries_a_tie_priority_seat(self):
        state = S.initial_state(seed=7)
        assert "tie_priority_seat" not in state
        public, private, _ = S.project(state, 0)
        assert "tie_priority_seat" not in public
        assert "holds_tie_priority" not in private

    def test_a_v1_snapshot_is_refused_rather_than_reinterpreted(self):
        with pytest.raises(S.RulesetVersionMismatch):
            S.assert_supported_version({"ruleset_version": "twenty_dollar_v1"})
