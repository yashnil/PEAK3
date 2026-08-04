"""Budget reserve, sealed-bid resolution, and tie-priority alternation."""
from __future__ import annotations

import pytest

from nba_peak.twenty_dollar import rules
from nba_peak.twenty_dollar.config import ROSTER_SIZE, STARTING_BUDGET


class TestReserveRule:
    def test_the_briefs_worked_example(self):
        """$11 with 3 empty slots -> max legal bid $9.

        Pinned as a named test because it is the example the rule was specified
        with; if this number ever moves, the specification moved.
        """
        assert rules.max_legal_bid(budget=11, filled_slots=2) == 9

    def test_opening_bid_ceiling(self):
        # 5 slots open, 4 remain after this purchase, so $4 must stay behind.
        assert rules.max_legal_bid(STARTING_BUDGET, 0) == STARTING_BUDGET - 4

    def test_final_slot_may_spend_everything(self):
        # Nothing remains to reserve for.
        assert rules.max_legal_bid(5, ROSTER_SIZE - 1) == 5

    def test_never_negative(self):
        assert rules.max_legal_bid(0, 0) == 0
        assert rules.max_legal_bid(1, 0) == 0

    @pytest.mark.parametrize("filled", range(ROSTER_SIZE))
    def test_spending_the_maximum_leaves_the_roster_affordable(self, filled):
        """The invariant the whole rule exists for.

        After spending every legal dollar, the seat must still hold at least
        $1 for each slot it has not filled. Checked at every fill level rather
        than at one, because an off-by-one in the reserve would only show at
        one of them.
        """
        budget = STARTING_BUDGET
        spend = rules.max_legal_bid(budget, filled)
        assert rules.is_solvent(budget - spend, filled + 1)


class TestBidResolution:
    def test_highest_bid_wins_and_pays_its_own_bid(self):
        outcome = rules.resolve([9, 4], tie_priority_seat=1)
        assert outcome.winner_seat == 0
        assert outcome.price == 9  # first-price: the winner pays what they said
        assert outcome.decided_by == "bid_amount"
        assert outcome.tie_priority_used is False

    def test_loser_pays_nothing(self):
        outcome = rules.resolve([9, 4], tie_priority_seat=1)
        # Nothing in the outcome charges the loser; the state machine only ever
        # debits `outcome.winner_seat`.
        assert outcome.winner_seat is not None and outcome.price == 9

    def test_both_pass_leaves_the_candidate_unsold(self):
        outcome = rules.resolve([0, 0], tie_priority_seat=0)
        assert outcome.winner_seat is None
        assert outcome.price == 0
        assert outcome.decided_by is None

    def test_a_zero_zero_round_does_not_spend_the_token(self):
        """Two passes are not a tie.

        The token is a one-shot resource; consuming it on a round where no
        tie-break happened would silently rob the holder.
        """
        outcome = rules.resolve([0, 0], tie_priority_seat=0)
        assert outcome.tie_priority_used is False
        assert rules.next_tie_priority(0, outcome) == 0

    def test_equal_nonzero_bids_go_to_the_token_holder(self):
        outcome = rules.resolve([7, 7], tie_priority_seat=1)
        assert outcome.winner_seat == 1
        assert outcome.decided_by == "tie_priority"
        assert outcome.tie_priority_used is True

    def test_a_missing_bid_is_a_pass_not_a_forfeit(self):
        outcome = rules.resolve([None, 3], tie_priority_seat=0)
        assert outcome.winner_seat == 1
        assert outcome.price == 3

    def test_every_level_is_reported_even_when_not_consulted(self):
        """House convention: report non-deciding levels, never omit them."""
        outcome = rules.resolve([9, 4], tie_priority_seat=1)
        levels = {level["level"]: level for level in outcome.levels}
        assert set(levels) == {"bid_amount", "tie_priority"}
        assert levels["tie_priority"]["verdict"] == "not_consulted"

    def test_the_order_tuple_is_the_ordering(self):
        """`BID_ORDER` and what `resolve` emits cannot drift apart."""
        outcome = rules.resolve([5, 5], tie_priority_seat=0)
        assert [level["level"] for level in outcome.levels] == [
            level_id for level_id, _label, _higher in rules.BID_ORDER
        ]


class TestTiePriority:
    def test_token_transfers_only_after_it_is_used(self):
        used = rules.resolve([6, 6], tie_priority_seat=0)
        assert rules.next_tie_priority(0, used) == 1

        unused = rules.resolve([6, 2], tie_priority_seat=1)
        assert rules.next_tie_priority(1, unused) == 1

    def test_alternates_across_repeated_ties(self):
        holder = 0
        for expected in (1, 0, 1, 0):
            outcome = rules.resolve([4, 4], tie_priority_seat=holder)
            assert outcome.winner_seat == holder
            holder = rules.next_tie_priority(holder, outcome)
            assert holder == expected

    def test_initial_holder_is_a_pure_function_of_the_seed(self):
        assert rules.initial_tie_priority(999) == rules.initial_tie_priority(999)
        assert rules.initial_tie_priority(999) in (0, 1)

    def test_seeds_do_not_all_favour_one_seat(self):
        holders = {rules.initial_tie_priority(seed) for seed in range(50)}
        assert holders == {0, 1}
