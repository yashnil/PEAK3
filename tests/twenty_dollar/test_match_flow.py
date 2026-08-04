"""Termination, one-seat-finishes-first, bid legality, and the receipt.

The termination tests drive REAL matches to completion over many seeds rather
than asserting a property of one hand-built state, because the failure mode
being guarded against -- a pass loop, or a roster that cannot be completed --
only appears in a sequence.
"""
from __future__ import annotations

import random

import pytest

from nba_peak.twenty_dollar import feasibility, receipt, rules
from nba_peak.twenty_dollar import state as S
from nba_peak.twenty_dollar.bot import TwentyDollarBot
from nba_peak.twenty_dollar.config import ROSTER_SIZE, SLOTS, STARTING_BUDGET
from nba_peak.twenty_dollar.pool import get_pool


@pytest.fixture(scope="module")
def pool():
    return get_pool()


def play_match(seed: int, pool, strategy="random", max_iterations: int = 500) -> dict:
    """Drive one full match. Returns the terminal state."""
    st = S.initial_state(seed=seed)
    rng = random.Random(seed ^ 0x5EED)
    bot = TwentyDollarBot()
    iterations = 0
    while not S.is_complete(st):
        iterations += 1
        assert iterations < max_iterations, "match did not terminate"
        for seat_index in range(len(st["seats"])):
            if not S.legal_commands(st, seat_index):
                continue
            if strategy == "always_pass":
                amount = 0
            elif strategy == "bot":
                public, private, _ = S.project(st, seat_index, pool)
                command, payload = bot.decide(public, private, rng)
                amount = int(payload.get("amount", 0)) if command == "bid" else 0
            else:
                seat = st["seats"][seat_index]
                ceiling = rules.max_legal_bid(seat["budget"], len(seat["roster"]))
                card = pool.get(st["current_candidate"])
                amount = (
                    rng.randint(0, ceiling)
                    if S.can_seat_acquire(st, seat_index, card, pool)
                    else 0
                )
            _, code, message = S.submit_bid(st, seat_index, amount, pool)
            assert code is None, f"unexpected rejection {code}: {message}"
        st = S.resolve_round(st, pool)
    return st


def assert_terminal_state_is_legal(st, pool):
    for seat in st["seats"]:
        assert len(seat["roster"]) == ROSTER_SIZE
        assert seat["budget"] >= 0
        owned = [
            (entry["player_slug"], pool.get(entry["player_slug"]).positions)
            for entry in seat["roster"]
        ]
        fit = feasibility.evaluate(owned, (), require_future=False)
        assert fit.feasible, "a completed roster has no legal seating"
        assert len(set(fit.assignment.values())) == ROSTER_SIZE
        assert set(fit.assignment) == set(SLOTS)
    # No player may appear on both rosters.
    slugs = [e["player_slug"] for seat in st["seats"] for e in seat["roster"]]
    assert len(slugs) == len(set(slugs))


class TestTermination:
    @pytest.mark.parametrize("seed", [1, 7, 42, 1234, 99999, 2 ** 20, 31337])
    def test_a_random_match_always_terminates_with_two_legal_rosters(self, seed, pool):
        assert_terminal_state_is_legal(play_match(seed, pool), pool)

    @pytest.mark.parametrize("seed", [3, 77, 5150])
    def test_a_bot_vs_bot_match_terminates(self, seed, pool):
        assert_terminal_state_is_legal(play_match(seed, pool, strategy="bot"), pool)

    def test_two_seats_that_pass_forever_still_terminate(self, pool):
        """The pass-loop guard.

        Neither seat ever bids, so no candidate is ever sold. Without the round
        cap this walks the entire 1,000-player pool; with it, the remaining
        slots are auto-filled and the match ends.
        """
        st = play_match(11, pool, strategy="always_pass")
        assert st["autofilled"] is True
        assert_terminal_state_is_legal(st, pool)

    def test_an_autofilled_roster_is_marked_as_such(self, pool):
        st = play_match(11, pool, strategy="always_pass")
        filled = [
            entry
            for seat in st["seats"]
            for entry in seat["roster"]
            if entry.get("autofilled")
        ]
        assert filled, "auto-filled slots must be recorded, not silently added"
        assert st["autofilled"] is True

    def test_the_round_cap_is_respected(self, pool):
        st = play_match(11, pool, strategy="always_pass")
        assert st["round_index"] <= st["max_rounds"] + ROSTER_SIZE * 2


class TestOneSeatFinishesFirst:
    def test_the_finished_seat_stops_acting_and_the_match_continues(self, pool):
        """The case the brief singles out.

        Seat 0 buys aggressively and completes early; seat 1 must still be able
        to finish its own roster, and the round must not block waiting on the
        seat that has nothing left to do.
        """
        st = S.initial_state(seed=20250)
        guard = 0
        while not S.is_complete(st) and len(st["seats"][0]["roster"]) < ROSTER_SIZE:
            guard += 1
            assert guard < 200
            for seat_index in (0, 1):
                if not S.legal_commands(st, seat_index):
                    continue
                seat = st["seats"][seat_index]
                card = pool.get(st["current_candidate"])
                if seat_index == 0 and S.can_seat_acquire(st, 0, card, pool):
                    amount = rules.max_legal_bid(seat["budget"], len(seat["roster"]))
                else:
                    amount = 0
                S.submit_bid(st, seat_index, amount, pool)
            st = S.resolve_round(st, pool)

        assert len(st["seats"][0]["roster"]) == ROSTER_SIZE
        if not S.is_complete(st):
            # The finished seat has no legal move and is not waited on.
            assert S.legal_commands(st, 0) == ()
            assert S.all_locked(st) is False or S.legal_commands(st, 1) == ()
            assert len(st["seats"][1]["roster"]) < ROSTER_SIZE

    def test_a_full_roster_is_never_waited_on(self, pool):
        st = S.initial_state(seed=5)
        st["seats"][0]["roster"] = [
            {"player_slug": slug, "price": 1, "round_index": 0}
            for slug in _five_distinct_slugs(pool)
        ]
        assert S.legal_commands(st, 0) == ()
        S.submit_bid(st, 1, 0, pool)
        assert S.all_locked(st) is True


def _five_distinct_slugs(pool) -> list[str]:
    """One real player per slot, so the roster is genuinely legal."""
    chosen: list[str] = []
    used: set[str] = set()
    for slot in SLOTS:
        for candidate in pool.eligible_for(slot):
            if candidate.player_slug in used:
                continue
            if feasibility.fillable_slots(
                [(s, pool.get(s).positions) for s in chosen], candidate.positions
            ):
                chosen.append(candidate.player_slug)
                used.add(candidate.player_slug)
                break
    assert len(chosen) == ROSTER_SIZE
    return chosen


class TestBidLegality:
    def test_a_bid_over_the_reserve_ceiling_is_refused(self, pool):
        st = S.initial_state(seed=8)
        _, code, message = S.submit_bid(st, 0, STARTING_BUDGET, pool)
        assert code == S.REJECT_BID_OVER_MAX
        assert "$16" in message

    def test_a_negative_bid_is_refused(self, pool):
        st = S.initial_state(seed=8)
        _, code, _ = S.submit_bid(st, 0, -1, pool)
        assert code == S.REJECT_BID_NEGATIVE

    def test_a_boolean_is_not_a_bid(self, pool):
        """`bool` subclasses `int`, so `True` would otherwise bid one dollar."""
        st = S.initial_state(seed=8)
        _, code, _ = S.submit_bid(st, 0, True, pool)
        assert code == S.REJECT_BID_NOT_INTEGER

    def test_a_second_bid_in_one_round_is_refused(self, pool):
        st = S.initial_state(seed=8)
        S.submit_bid(st, 0, 3, pool)
        _, code, _ = S.submit_bid(st, 0, 9, pool)
        assert code == S.REJECT_ALREADY_LOCKED

    def test_a_pass_is_legal_even_with_no_money(self, pool):
        st = S.initial_state(seed=8)
        st["seats"][0]["budget"] = 0
        _, code, _ = S.submit_bid(st, 0, 0, pool)
        assert code is None

    def test_the_server_ceiling_is_not_taken_from_the_client(self, pool):
        """The clamp is computed from persisted budget, so inflating a client's
        idea of its maximum changes nothing."""
        st = S.initial_state(seed=8)
        st["seats"][0]["budget"] = 6
        _, code, _ = S.submit_bid(st, 0, 6, pool)
        assert code == S.REJECT_BID_OVER_MAX
        _, code, _ = S.submit_bid(st, 0, 2, pool)
        assert code is None


class TestSolvencyInvariant:
    @pytest.mark.parametrize("seed", [2, 22, 222, 2222])
    def test_a_seat_can_always_afford_its_remaining_slots(self, seed, pool):
        """Checked after every single round of a real match, not just at the end."""
        st = S.initial_state(seed=seed)
        rng = random.Random(seed)
        guard = 0
        while not S.is_complete(st):
            guard += 1
            assert guard < 500
            for seat_index in range(2):
                if not S.legal_commands(st, seat_index):
                    continue
                seat = st["seats"][seat_index]
                ceiling = rules.max_legal_bid(seat["budget"], len(seat["roster"]))
                card = pool.get(st["current_candidate"])
                amount = (
                    rng.randint(0, ceiling)
                    if S.can_seat_acquire(st, seat_index, card, pool)
                    else 0
                )
                S.submit_bid(st, seat_index, amount, pool)
            st = S.resolve_round(st, pool)
            for seat in st["seats"]:
                assert rules.is_solvent(seat["budget"], len(seat["roster"])), (
                    "a seat can no longer afford a dollar per unfilled slot"
                )


class TestDeterminism:
    def test_the_same_seed_produces_the_same_match(self, pool):
        first = play_match(777, pool, strategy="bot")
        second = play_match(777, pool, strategy="bot")
        assert [e["player_slug"] for s in first["seats"] for e in s["roster"]] == [
            e["player_slug"] for s in second["seats"] for e in s["roster"]
        ]
        assert S.final_scores(first, pool) == S.final_scores(second, pool)

    def test_different_seeds_produce_different_boards(self, pool):
        boards = {S.initial_state(seed=s)["current_candidate"] for s in range(25)}
        assert len(boards) > 1

    def test_the_tie_priority_holder_is_published_before_the_first_bid(self, pool):
        st = S.initial_state(seed=31337)
        public, private, _ = S.project(st, 0, pool)
        assert public["tie_priority_seat"] in (0, 1)
        assert isinstance(private["holds_tie_priority"], bool)
        assert st["round_index"] == 0


class TestReceipt:
    @pytest.fixture()
    def finished(self, pool):
        return play_match(4242, pool)

    def test_the_total_is_the_sum_of_five_career_best_scores(self, finished, pool):
        built = receipt.build(finished, pool)
        for seat_report, seat in zip(built["seats"], finished["seats"]):
            expected = sum(pool.get(e["player_slug"]).prime_score for e in seat["roster"])
            assert seat_report["roster_total"] == pytest.approx(expected, abs=1e-6)
            assert len(seat_report["roster"]) == ROSTER_SIZE

    def test_spent_plus_remaining_equals_the_starting_budget(self, finished, pool):
        for seat_report in receipt.build(finished, pool)["seats"]:
            assert seat_report["spent"] + seat_report["budget_remaining"] == STARTING_BUDGET

    def test_the_positional_comparison_covers_every_slot_once(self, finished, pool):
        rows = receipt.build(finished, pool)["positional"]
        assert [row["slot"] for row in rows] == list(SLOTS)
        for row in rows:
            assert len(row["seats"]) == 2

    def test_the_five_component_disclosure_is_explicit(self, finished, pool):
        """The receipt must SAY it shows five where the house shows six."""
        disclosure = receipt.build(finished, pool)["component_disclosure"]
        assert disclosure["count"] == 5
        assert disclosure["house_count"] == 6
        assert disclosure["absent"] == ["teammate_adjustment"]
        assert "teammate_adjustment" in disclosure["note"]

    def test_component_names_are_the_long_forms(self, finished, pool):
        """`individual_recognition` / `postseason_individual_value`, never the
        short forms metadata.json uses for the WEIGHTS dict."""
        components = receipt.build(finished, pool)["seats"][0]["components"]
        assert "individual_recognition" in components
        assert "postseason_individual_value" in components
        assert "recognition" not in components
        assert "postseason" not in components

    def test_peak3_per_dollar_is_reported(self, finished, pool):
        for seat_report in receipt.build(finished, pool)["seats"]:
            assert seat_report["peak3_per_dollar"] > 0

    def test_bargain_and_overpay_are_identified(self, finished, pool):
        built = receipt.build(finished, pool)
        if built["best_bargain"] and built["biggest_overpay"]:
            assert (
                built["best_bargain"]["value_per_dollar"]
                >= built["biggest_overpay"]["value_per_dollar"]
            )

    def test_a_free_acquisition_is_never_the_biggest_overpay(self, finished, pool):
        overpay = receipt.build(finished, pool)["biggest_overpay"]
        if overpay is not None:
            assert overpay["price"] > 0

    def test_the_settlement_reports_every_level(self, finished, pool):
        settlement = receipt.build(finished, pool)["settlement"]
        assert [level["level"] for level in settlement["levels"]] == [
            level_id for level_id, _l, _h in receipt.SETTLEMENT_ORDER
        ]
        decided = settlement["decided_by"]
        if decided == "roster_total":
            assert settlement["levels"][1]["verdict"] == "not_consulted"

    def test_no_settlement_before_the_match_ends(self, pool):
        st = S.initial_state(seed=1)
        assert receipt.build(st, pool)["settlement"] is None

    def test_the_counterfactual_is_labelled_as_an_assumption(self, finished, pool):
        counterfactual = receipt.build(finished, pool)["counterfactual"]
        if counterfactual is not None:
            assert "assumption" in counterfactual
            assert counterfactual["needed_bid"] > counterfactual["winning_bid"]
            # It must actually flip the result it claims to flip.
            loser = counterfactual["loser_seat"]
            assert counterfactual["new_totals"][loser] > counterfactual["new_totals"][1 - loser]

    def test_the_most_decisive_auction_names_a_real_round(self, finished, pool):
        decisive = receipt.build(finished, pool)["most_decisive"]
        if decisive is not None:
            assert decisive["winner_seat"] in (0, 1)
            assert decisive["round_index"] < len(finished["history"])
