"""The ascending auction, rule by rule.

The brief specifies eighteen numbered rules for this mode. This module covers
the ones about the SEQUENCE -- who acts, in what order, and what each action
does to the lot -- because those are the rules the retired sealed-bid model got
structurally wrong rather than merely differently.
"""
from __future__ import annotations

import pytest

from nba_peak.twenty_dollar import rules
from nba_peak.twenty_dollar import state as S
from nba_peak.twenty_dollar.config import (
    HARD_MAX_LOTS,
    MARKET_CLOSEOUT,
    MARKET_SKIPS_PER_SEAT,
    MARKET_STANDARD,
    QUALIFIED_POOL_SIZE,
    SEAT_COUNT,
    STANDARD_MARKET_LOTS,
)

from .conftest import play_match, assert_terminal_state_is_legal


def opener(state) -> int:
    return state["opening_seat"]


def other(seat: int) -> int:
    return 1 - seat


class TestOpeningBidder:
    """Brief rules 4 and 5."""

    def test_the_first_opener_is_drawn_from_the_seed(self):
        # A pure function of the seed, so it replays -- and not a constant, so
        # it is a real draw. Both matter: the foundation used to hardcode the
        # first turn onto seat 0.
        seats = {S.initial_state(seed=s)["opening_seat"] for s in range(40)}
        assert seats == {0, 1}

    def test_the_opener_is_the_seat_on_the_clock_at_tip_off(self):
        for seed in (3, 11, 404, 90210):
            state = S.initial_state(seed=seed)
            assert state["active_seat"] == state["opening_seat"]

    def test_the_opener_is_published_before_any_bid(self):
        state = S.initial_state(seed=5)
        public, _, _ = S.project(state, 0)
        assert public["opening_seat"] == state["opening_seat"]
        assert public["current_bid"] == 0

    def test_the_opener_alternates_after_a_resolved_lot(self):
        state = S.initial_state(seed=17)
        first = opener(state)
        S.submit_action(state, first, S.COMMAND_BID, 1)
        S.submit_action(state, other(first), S.COMMAND_PASS)
        assert state["history"][-1]["winner_seat"] == first
        assert opener(state) == other(first)

    def test_the_opener_alternates_after_an_unsold_lot(self):
        # Brief rule 5 says "after every resolved OR UNSOLD lot" -- a lot
        # nobody bought still moves the advantage along.
        state = S.initial_state(seed=23)
        first = opener(state)
        S.submit_action(state, first, S.COMMAND_PASS)
        S.submit_action(state, other(first), S.COMMAND_PASS)
        assert state["history"][-1]["winner_seat"] is None
        assert opener(state) == other(first)

    def test_it_keeps_alternating_across_several_lots(self):
        state = S.initial_state(seed=29)
        seen = []
        for _ in range(6):
            seen.append(opener(state))
            a = state["active_seat"]
            S.submit_action(state, a, S.COMMAND_PASS)
            if not S.is_complete(state) and state["active_seat"] is not None:
                S.submit_action(state, state["active_seat"], S.COMMAND_PASS)
        assert seen == [seen[0], other(seen[0])] * 3


class TestTurnOrder:
    """Only the active seat has a move (brief rule 3 and the timer section)."""

    def test_only_the_active_seat_has_legal_commands(self):
        state = S.initial_state(seed=31)
        active = state["active_seat"]
        assert S.legal_commands(state, active) == (S.COMMAND_BID, S.COMMAND_PASS)
        assert S.legal_commands(state, other(active)) == ()

    def test_the_inactive_seat_is_refused_rather_than_queued(self):
        state = S.initial_state(seed=31)
        _, code, _ = S.submit_action(state, other(state["active_seat"]), S.COMMAND_BID, 3)
        assert code == S.REJECT_NOT_YOUR_TURN

    def test_a_bid_hands_the_clock_to_the_opponent(self):
        state = S.initial_state(seed=37)
        first = state["active_seat"]
        S.submit_action(state, first, S.COMMAND_BID, 2)
        assert state["active_seat"] == other(first)
        assert state["high_bidder"] == first
        assert state["current_bid"] == 2


class TestOpenerPasses:
    """Brief rule 7, the case the old model could not express at all."""

    def test_the_opponent_gets_an_independent_decision(self):
        state = S.initial_state(seed=41)
        first = opener(state)
        S.submit_action(state, first, S.COMMAND_PASS)
        # The lot is still live and the OTHER seat is on the clock. Nothing
        # about the opener's pass decided anything for them.
        assert not S.is_complete(state)
        assert state["active_seat"] == other(first)
        assert state["current_bid"] == 0
        assert S.COMMAND_BID in S.legal_commands(state, other(first))

    def test_the_opponent_opening_wins_at_that_amount(self):
        state = S.initial_state(seed=41)
        first = opener(state)
        candidate = state["current_candidate"]
        S.submit_action(state, first, S.COMMAND_PASS)
        S.submit_action(state, other(first), S.COMMAND_BID, 3)
        record = state["history"][-1]
        assert record["candidate"]["player_slug"] == candidate
        assert record["winner_seat"] == other(first)
        assert record["price"] == 3
        assert record["decided_by"] == S.DECIDED_BY_PASS_OUT

    def test_a_passed_out_opener_cannot_come_back_in(self):
        state = S.initial_state(seed=43)
        first = opener(state)
        S.submit_action(state, first, S.COMMAND_PASS)
        # The opponent opening ENDS the lot -- there is nobody left to answer,
        # so the opener never gets another turn on this player.
        S.submit_action(state, other(first), S.COMMAND_BID, 1)
        assert len(state["history"]) == 1

    def test_both_passing_leaves_the_candidate_unsold(self):
        state = S.initial_state(seed=47)
        first = opener(state)
        S.submit_action(state, first, S.COMMAND_PASS)
        S.submit_action(state, other(first), S.COMMAND_PASS)
        record = state["history"][-1]
        assert record["winner_seat"] is None
        assert record["price"] == 0
        assert record["decided_by"] == S.DECIDED_BY_UNSOLD
        assert all(len(s["roster"]) == 0 for s in state["seats"])

    def test_passing_costs_nothing(self):
        # Brief rule 10.
        state = S.initial_state(seed=53)
        before = [s["budget"] for s in state["seats"]]
        S.submit_action(state, state["active_seat"], S.COMMAND_PASS)
        S.submit_action(state, state["active_seat"], S.COMMAND_PASS)
        assert [s["budget"] for s in state["seats"]] == before


class TestRaising:
    """Brief rule 8."""

    def test_a_live_bid_can_be_raised(self):
        state = S.initial_state(seed=59)
        first = state["active_seat"]
        S.submit_action(state, first, S.COMMAND_BID, 2)
        _, code, _ = S.submit_action(state, other(first), S.COMMAND_BID, 3)
        assert code is None
        assert state["current_bid"] == 3
        assert state["high_bidder"] == other(first)
        assert state["active_seat"] == first

    def test_a_raise_must_clear_the_standing_bid(self):
        state = S.initial_state(seed=59)
        first = state["active_seat"]
        S.submit_action(state, first, S.COMMAND_BID, 4)
        _, code, message = S.submit_action(state, other(first), S.COMMAND_BID, 4)
        assert code == S.REJECT_BID_TOO_LOW
        assert "$5" in message

    def test_passing_after_a_live_bid_awards_the_player(self):
        state = S.initial_state(seed=61)
        first = state["active_seat"]
        candidate = state["current_candidate"]
        S.submit_action(state, first, S.COMMAND_BID, 5)
        S.submit_action(state, other(first), S.COMMAND_PASS)
        record = state["history"][-1]
        assert record["winner_seat"] == first
        assert record["price"] == 5
        assert state["seats"][first]["roster"][0]["player_slug"] == candidate
        assert state["seats"][first]["roster"][0]["price"] == 5

    def test_the_winner_pays_the_final_bid_and_the_loser_pays_nothing(self):
        state = S.initial_state(seed=67)
        first = state["active_seat"]
        S.submit_action(state, first, S.COMMAND_BID, 2)
        S.submit_action(state, other(first), S.COMMAND_BID, 6)
        S.submit_action(state, first, S.COMMAND_PASS)
        assert state["seats"][other(first)]["budget"] == 20 - 6
        assert state["seats"][first]["budget"] == 20

    def test_a_bidding_war_alternates_until_someone_stops(self):
        state = S.initial_state(seed=71)
        first = state["active_seat"]
        for amount, seat in ((1, first), (2, other(first)), (3, first), (4, other(first))):
            _, code, _ = S.submit_action(state, seat, S.COMMAND_BID, amount)
            assert code is None, amount
        assert state["current_bid"] == 4
        assert state["high_bidder"] == other(first)
        S.submit_action(state, first, S.COMMAND_PASS)
        assert state["history"][-1]["price"] == 4

    def test_the_history_records_every_action_in_order(self):
        state = S.initial_state(seed=71)
        first = state["active_seat"]
        S.submit_action(state, first, S.COMMAND_BID, 1)
        S.submit_action(state, other(first), S.COMMAND_BID, 2)
        S.submit_action(state, first, S.COMMAND_PASS)
        actions = state["history"][-1]["actions"]
        assert [(a["seat_index"], a["action"], a["amount"]) for a in actions] == [
            (first, "bid", 1),
            (other(first), "bid", 2),
            (first, "pass", 0),
        ]


class TestLegality:
    """Brief rules 11, 12 and 13."""

    def test_a_bid_over_the_reserve_ceiling_is_refused(self):
        state = S.initial_state(seed=73)
        seat = state["active_seat"]
        _, code, message = S.submit_action(state, seat, S.COMMAND_BID, 17)
        assert code == S.REJECT_BID_OVER_MAX
        assert "$16" in message

    def test_the_ceiling_is_the_servers_and_not_the_clients(self):
        state = S.initial_state(seed=73)
        seat = state["active_seat"]
        # Rewriting the client's idea of its budget changes nothing: the
        # ceiling is recomputed here from the persisted number.
        state["seats"][seat]["budget"] = 4
        _, code, _ = S.submit_action(state, seat, S.COMMAND_BID, 20)
        assert code == S.REJECT_BID_OVER_MAX

    def test_a_bid_below_the_opening_minimum_is_refused(self):
        state = S.initial_state(seed=79)
        _, code, _ = S.submit_action(state, state["active_seat"], S.COMMAND_BID, 0)
        assert code == S.REJECT_BID_TOO_LOW

    def test_a_boolean_is_not_a_bid(self):
        state = S.initial_state(seed=79)
        _, code, _ = S.submit_action(state, state["active_seat"], S.COMMAND_BID, True)
        assert code == S.REJECT_BID_NOT_INTEGER

    def test_position_feasibility_is_enforced_at_the_bid(self, pool):
        # Fill a seat's roster so that only one slot remains, then offer them a
        # player who cannot occupy it.
        state = S.initial_state(seed=83)
        seat_index = state["active_seat"]
        seat = state["seats"][seat_index]
        candidate = pool.get(state["current_candidate"])
        # Occupy every slot the candidate could take, plus enough others that
        # `can_seat_acquire` is False.
        blockers = []
        for slot in sorted(candidate.positions):
            fill = next(
                c for c in pool.qualified
                if c.positions == frozenset({slot}) and c.player_slug != candidate.player_slug
                and c.player_slug not in blockers
            )
            blockers.append(fill.player_slug)
            seat["roster"].append({"player_slug": fill.player_slug, "price": 1, "lot_index": 0})
        assert not S.can_seat_acquire(state, seat_index, candidate, pool)
        _, code, _ = S.submit_action(state, seat_index, S.COMMAND_BID, 1, pool)
        assert code == S.REJECT_CANDIDATE_UNFIT

    def test_a_seat_that_cannot_win_the_lot_is_never_put_on_the_clock(self, pool):
        # A seat with a full roster has no move, so the lot opens on the other
        # one rather than handing out a turn whose only legal action is a pass.
        for seed in range(30):
            state = S.initial_state(seed=seed)
            for _ in range(4):
                if S.is_complete(state):
                    break
                active = state["active_seat"]
                assert active is not None
                assert S.legal_commands(state, active), "the active seat always has a move"
                S.submit_action(state, active, S.COMMAND_BID, rules.minimum_bid(state["current_bid"]))


class TestTimeout:
    """The timer rules: a timeout is exactly one seat passing."""

    def test_a_timeout_passes_only_the_active_seat(self):
        state = S.initial_state(seed=89)
        first = state["active_seat"]
        S.timeout_active_seat(state)
        assert state["passed"][first] is True
        assert state["passed"][other(first)] is False
        assert state["active_seat"] == other(first)
        assert not S.is_complete(state)
        assert len(state["history"]) == 0

    def test_a_timeout_never_passes_both_players(self):
        # v1's one shared deadline swept every seat that had not locked. This
        # is the assertion that says that cannot happen again.
        state = S.initial_state(seed=89)
        S.timeout_active_seat(state)
        assert sum(1 for p in state["passed"] if p) == 1

    def test_a_timeout_after_a_live_bid_awards_the_player(self):
        state = S.initial_state(seed=97)
        first = state["active_seat"]
        S.submit_action(state, first, S.COMMAND_BID, 3)
        S.timeout_active_seat(state)
        record = state["history"][-1]
        assert record["winner_seat"] == first
        assert record["price"] == 3
        assert record["timed_out"][other(first)] is True

    def test_a_timeout_is_a_pass_and_never_a_forfeit(self):
        state = S.initial_state(seed=97)
        first = state["active_seat"]
        S.timeout_active_seat(state)
        S.submit_action(state, other(first), S.COMMAND_PASS)
        # Next lot: the seat that timed out is live again and holds its money.
        assert state["seats"][first]["budget"] == 20
        assert state["passed"] == [False, False]

    def test_the_timed_out_seat_is_recorded_on_the_lot(self):
        state = S.initial_state(seed=101)
        first = state["active_seat"]
        S.timeout_active_seat(state)
        S.submit_action(state, other(first), S.COMMAND_PASS)
        record = state["history"][-1]
        assert record["timed_out"][first] is True
        assert record["timed_out"][other(first)] is False


class TestCandidatePool:
    """Brief section 6: qualified top-500, star-weighted, no duplicates."""

    def test_every_offered_candidate_is_inside_the_qualified_pool(self, pool):
        for seed in (1, 2, 3, 5, 8, 13):
            state = play_match(seed, pool)
            for record in state["history"]:
                slug = record["candidate"]["player_slug"]
                assert pool.is_qualified(slug), slug
                assert record["candidate"]["rank"] <= QUALIFIED_POOL_SIZE

    def test_no_identity_is_offered_twice_in_one_match(self, pool):
        for seed in (4, 9, 16, 25):
            state = play_match(seed, pool)
            offered = [r["candidate"]["player_slug"] for r in state["history"]]
            assert len(offered) == len(set(offered))

    def test_the_draw_is_weighted_towards_the_top_of_the_pool(self, pool):
        # The exact split is adjusted for legality, so this asserts the shape
        # the brief asks for -- stars common, the tail present but not
        # dominant -- rather than three decimal places.
        counts = {"1-100": 0, "101-250": 0, "251-500": 0}
        for seed in range(40):
            state = play_match(seed, pool)
            for record in state["history"]:
                rank = record["candidate"]["rank"]
                key = "1-100" if rank <= 100 else "101-250" if rank <= 250 else "251-500"
                counts[key] += 1
        total = sum(counts.values())
        assert total > 200, "not enough lots sampled to judge the distribution"
        assert counts["1-100"] / total > 0.30
        assert counts["251-500"] / total < 0.35

    def test_the_qualified_pool_is_a_view_and_not_a_truncation(self, pool):
        # Every row is still resolvable -- a settled match played under a
        # deeper cut must be able to look its own purchases up.
        assert len(pool.qualified) == QUALIFIED_POOL_SIZE
        assert len(pool.candidates) > QUALIFIED_POOL_SIZE
        deepest = pool.candidates[-1]
        assert pool.get(deepest.player_slug) is deepest
        assert not pool.is_qualified(deepest.player_slug)


class TestDeterminism:
    def test_the_same_seed_produces_the_same_match(self, pool):
        a = play_match(12345, pool)
        b = play_match(12345, pool)
        assert [r["candidate"]["player_slug"] for r in a["history"]] == [
            r["candidate"]["player_slug"] for r in b["history"]
        ]
        assert [s["budget"] for s in a["seats"]] == [s["budget"] for s in b["seats"]]

    def test_different_seeds_produce_different_boards(self, pool):
        boards = {
            tuple(r["candidate"]["player_slug"] for r in play_match(seed, pool)["history"])
            for seed in (1, 2, 3, 4, 5)
        }
        assert len(boards) > 1


class TestTermination:
    @pytest.mark.parametrize("seed", [1, 7, 42, 1234, 99999, 2 ** 20, 31337])
    def test_a_random_match_terminates_with_two_legal_rosters(self, seed, pool):
        assert_terminal_state_is_legal(play_match(seed, pool), pool)

    def test_the_maximally_passive_line_still_finishes_a_real_roster(self, pool):
        """WAITING NO LONGER WORKS, and this is what replaced the old proof.

        Under v2 two seats could decline every lot forever and the match ended
        auto-filled. Under v3 each seat has five market skips; once they are
        spent, a candidate that fits with nothing bid must be opened at $1. So
        the passive line buys players -- and the match completes by ROSTERS
        FILLING rather than by the escape hatch firing.
        """
        from .conftest import always_pass

        state = play_match(5, pool, strategy=always_pass)
        assert S.is_complete(state)
        assert state["autofilled"] is False, "the cap should not have been needed"
        assert_terminal_state_is_legal(state, pool)
        assert not any(
            entry.get("autofilled") for seat in state["seats"] for entry in seat["roster"]
        )

    def test_the_skip_allowance_is_fully_spent_by_the_passive_line(self, pool):
        from .conftest import always_pass

        state = play_match(5, pool, strategy=always_pass)
        for seat in state["seats"]:
            assert seat["market_skips"] == 0, (
                "a seat that declined everything it legally could should have "
                "no skips left"
            )

    def test_the_autofill_hatch_still_exists_and_is_marked(self, pool):
        """The escape hatch is unreachable in play, so it is tested directly.

        Deleting it because nothing reaches it would remove the termination
        PROOF and leave only the argument that nothing should. It is exercised
        here by driving the state to the hard cap.
        """
        state = S.initial_state(seed=5)
        state["lot_index"] = state["max_lots"]
        S._advance_lot(state, pool)
        assert S.is_complete(state)
        assert state["autofilled"] is True
        assert any(
            entry.get("autofilled") for seat in state["seats"] for entry in seat["roster"]
        )
        assert_terminal_state_is_legal(state, pool)

    @pytest.mark.parametrize("seed", [5, 17, 404, 90210])
    def test_no_match_ever_exceeds_the_hard_lot_cap(self, seed, pool):
        from .conftest import always_pass

        for strategy in (always_pass, None):
            state = (
                play_match(seed, pool, strategy=strategy)
                if strategy
                else play_match(seed, pool)
            )
            auctioned = [
                r for r in state["history"] if r["decided_by"] != S.DECIDED_BY_AUTOFILL
            ]
            assert len(auctioned) <= state["max_lots"] == HARD_MAX_LOTS

    @pytest.mark.parametrize("seed", [11, 222, 3333])
    def test_a_seat_can_always_afford_its_remaining_slots(self, seed, pool):
        from .conftest import always_min_raise

        state = S.initial_state(seed=seed)
        import random

        rng = random.Random(seed)
        guard = 0
        while not S.is_complete(state) and guard < 4000:
            guard += 1
            seat_index = state["active_seat"]
            command, amount = always_min_raise(state, seat_index, pool, rng)
            S.submit_action(state, seat_index, command, amount, pool)
            for seat in state["seats"]:
                assert rules.is_solvent(seat["budget"], len(seat["roster"]))
        assert S.is_complete(state)


class TestSeatCount:
    def test_the_mode_is_two_seats(self):
        assert SEAT_COUNT == 2
        assert len(S.initial_state(seed=1)["seats"]) == 2


class TestMarketSkips:
    """The skip economy: the rule that removes the waiting strategy.

    Under v2 a participant could decline an unbid candidate at no cost,
    forever. The dominant line was therefore to buy nothing, let the opponent
    spend down, and then take five elite players for $1 each once nobody was
    left to bid against. Every test here is a property of the fix.
    """

    def test_each_seat_starts_with_the_published_allowance(self):
        state = S.initial_state(seed=71)
        for index in range(SEAT_COUNT):
            assert S.market_skips(state, index) == MARKET_SKIPS_PER_SEAT
        public, private, _ = S.project(state, 0)
        assert private["market_skips"] == MARKET_SKIPS_PER_SEAT
        # Both counters are public: knowing whether your opponent can still
        # afford to wait is a real strategic fact.
        assert [seat["market_skips"] for seat in public["seats"]] == [
            MARKET_SKIPS_PER_SEAT
        ] * SEAT_COUNT

    def test_declining_an_unbid_candidate_that_fits_costs_a_skip(self, pool):
        state = S.initial_state(seed=73)
        first = state["active_seat"]
        assert S.pass_consumes_skip(state, first, pool)
        S.submit_action(state, first, S.COMMAND_PASS, 0, pool)
        assert S.market_skips(state, first) == MARKET_SKIPS_PER_SEAT - 1
        assert state["lot_actions"][-1]["consumed_skip"] is True

    def test_conceding_a_live_auction_is_free(self, pool):
        """Being outbid is not the same as declining. Charging for it would
        make every contested lot a tax on the loser."""
        state = S.initial_state(seed=79)
        first = state["active_seat"]
        S.submit_action(state, first, S.COMMAND_BID, 3, pool)
        second = state["active_seat"]
        before = S.market_skips(state, second)
        assert not S.pass_consumes_skip(state, second, pool)
        S.submit_action(state, second, S.COMMAND_PASS, 0, pool)
        assert S.market_skips(state, second) == before

    def test_an_unusable_candidate_costs_nothing_to_decline(self, pool):
        """A candidate a seat could not have bought is not a decision.

        Constructed rather than waited for: `_advance_lot` marks a seat that
        cannot acquire the candidate as already out of the lot, so this is the
        state that produces the automatic pass.
        """
        state = S.initial_state(seed=83)
        seat_index = state["active_seat"]
        state["seats"][seat_index]["budget"] = 0
        assert not S.pass_consumes_skip(state, seat_index, pool)

    def test_a_timeout_never_costs_a_skip(self, pool):
        """An expired clock is a lost connection, not a judgement. Charging it
        would make latency part of the strategy."""
        state = S.initial_state(seed=89)
        first = state["active_seat"]
        assert S.pass_consumes_skip(state, first, pool)
        S.timeout_active_seat(state, pool)
        assert S.market_skips(state, first) == MARKET_SKIPS_PER_SEAT
        assert state["lot_actions"][-1]["consumed_skip"] is False

    def test_a_seat_with_no_skips_left_cannot_decline_a_fitting_candidate(self, pool):
        state = S.initial_state(seed=97)
        first = state["active_seat"]
        state["seats"][first]["market_skips"] = 0
        assert S.pass_consumes_skip(state, first, pool)
        assert not S.may_pass(state, first, pool)
        assert S.legal_commands(state, first, pool) == (S.COMMAND_BID,)

        _, code, message = S.submit_action(state, first, S.COMMAND_PASS, 0, pool)
        assert code == S.REJECT_NO_MARKET_SKIPS
        assert "$1" in message

    def test_a_seat_with_no_skips_may_still_concede_a_live_auction(self, pool):
        state = S.initial_state(seed=101)
        first = state["active_seat"]
        state["seats"][0]["market_skips"] = 0
        state["seats"][1]["market_skips"] = 0
        S.submit_action(state, first, S.COMMAND_BID, 2, pool)
        second = state["active_seat"]
        assert S.may_pass(state, second, pool)
        _, code, _ = S.submit_action(state, second, S.COMMAND_PASS, 0, pool)
        assert code is None

    def test_the_projection_warns_before_the_click(self, pool):
        state = S.initial_state(seed=103)
        first = state["active_seat"]
        _public, private, _ = S.project(state, first, pool)
        assert private["pass_consumes_skip"] is True
        assert private["can_pass"] is True

        state["seats"][first]["market_skips"] = 0
        _public, private, _ = S.project(state, first, pool)
        assert private["can_pass"] is False

    def test_skips_never_replenish(self, pool):
        """Not asserted by an absence of code -- asserted."""
        from nba_peak.twenty_dollar.config import MARKET_SKIPS_REPLENISH

        assert MARKET_SKIPS_REPLENISH is False
        state = S.initial_state(seed=107)
        seen = MARKET_SKIPS_PER_SEAT
        for _ in range(30):
            if S.is_complete(state):
                break
            seat_index = state["active_seat"]
            command = (
                S.COMMAND_PASS
                if S.COMMAND_PASS in S.legal_commands(state, seat_index, pool)
                else S.COMMAND_BID
            )
            S.submit_action(state, seat_index, command, 1, pool)
            for index in range(SEAT_COUNT):
                assert S.market_skips(state, index) <= MARKET_SKIPS_PER_SEAT
            seen = min(seen, min(S.market_skips(state, i) for i in range(SEAT_COUNT)))
        assert seen < MARKET_SKIPS_PER_SEAT


class TestMarketPhases:
    def test_a_match_opens_in_the_standard_market(self):
        state = S.initial_state(seed=113)
        assert state["market_phase"] == MARKET_STANDARD
        public, _, _ = S.project(state, 0)
        assert public["market_phase"] == MARKET_STANDARD
        assert public["standard_market_lots"] == STANDARD_MARKET_LOTS
        assert public["max_lots"] == HARD_MAX_LOTS

    def test_the_standard_market_gives_way_to_the_closeout_market(self, pool):
        state = S.initial_state(seed=127)
        state["lot_index"] = STANDARD_MARKET_LOTS
        S._advance_lot(state, pool)
        assert state["market_phase"] == MARKET_CLOSEOUT
        public, _, _ = S.project(state, 0)
        assert public["market_phase"] == MARKET_CLOSEOUT

    def test_the_standard_market_never_narrows_to_a_missing_position(self, pool):
        """Candidate generation is independent of either roster's needs.

        Built as the case that most tempts a tailored board: one seat needs
        only a centre. Over many lots the market must still offer guards and
        forwards.
        """
        positions = set()
        for lot in range(STANDARD_MARKET_LOTS):
            state = S.initial_state(seed=1000 + lot)
            # Seat 0 needs only a centre.
            singles = {}
            for candidate in pool.qualified:
                for slot in ("PG", "SG", "SF", "PF"):
                    if slot not in singles and candidate.positions == frozenset({slot}):
                        singles[slot] = candidate
            state["seats"][0]["roster"] = [
                {"player_slug": c.player_slug, "price": 1, "lot_index": 0, "round_index": 0}
                for c in singles.values()
            ]
            state["lot_index"] = 5
            S._advance_lot(state, pool)
            if state.get("current_candidate"):
                positions |= pool.get(state["current_candidate"]).positions
        assert positions - {"C"}, (
            "every standard-market draw fitted the one slot seat 0 was missing"
        )
