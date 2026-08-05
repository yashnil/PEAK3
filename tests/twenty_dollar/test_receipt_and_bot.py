"""The end-of-match receipt, and the bot that has to be able to play a match.

The bot tests are here rather than beside the rules because the property that
matters is behavioural: the reported defect was not "the bot bids badly", it was
"the bot passes on everything, so a human pass ends every lot". That can only be
observed over a sequence.
"""
from __future__ import annotations

import random

import pytest

from nba_peak.twenty_dollar import receipt, rules
from nba_peak.twenty_dollar import state as S
from nba_peak.twenty_dollar.bot import TwentyDollarBot
from nba_peak.twenty_dollar.config import (
    BOT_DIFFICULTY_LABEL,
    BOT_DISPLAY_NAME,
    ROSTER_SIZE,
    SLOTS,
    STARTING_BUDGET,
)

from .conftest import (
    always_pass,
    assert_terminal_state_is_legal,
    bot_strategy,
    play_match,
)


class TestReceipt:
    @pytest.fixture()
    def finished(self, pool):
        return play_match(4242, pool)

    def test_the_total_is_the_sum_of_five_career_best_scores(self, finished, pool):
        # Brief rule 17: the winner is decided by the sum of the five
        # career-best canonical 1Y PEAK3 scores, and nothing else.
        built = receipt.build(finished, pool)
        for seat_report, seat in zip(built["seats"], finished["seats"]):
            expected = sum(pool.get(e["player_slug"]).prime_score for e in seat["roster"])
            assert seat_report["roster_total"] == pytest.approx(expected, abs=1e-6)
            assert len(seat_report["roster"]) == ROSTER_SIZE

    def test_final_scores_agree_with_the_receipt(self, finished, pool):
        totals = S.final_scores(finished, pool)
        built = receipt.build(finished, pool)
        for total, seat_report in zip(totals, built["seats"]):
            assert total == pytest.approx(seat_report["roster_total"], abs=0.01)

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

    def test_a_free_acquisition_is_never_the_biggest_overpay(self, finished, pool):
        overpay = receipt.build(finished, pool)["biggest_overpay"]
        if overpay is not None:
            assert overpay["price"] > 0

    def test_unspent_money_decides_nothing(self, finished, pool):
        # Brief rule 18. The roster total is the only settlement level, so an
        # exact tie is a draw rather than a budget comparison.
        settlement = receipt.build(finished, pool)["settlement"]
        assert [level["level"] for level in settlement["levels"]] == ["roster_total"]
        assert settlement["decided_by"] in (None, "roster_total")

    def test_no_settlement_before_the_match_ends(self, pool):
        state = S.initial_state(seed=1)
        assert receipt.build(state, pool)["settlement"] is None

    def test_no_counterfactual_is_published(self, finished, pool):
        """"One bid away" is retired, and its absence is asserted.

        The panel reported final totals computed by moving one card from the
        winner's roster to the loser's. That leaves the loser with six cards
        and the winner with four -- each seat buys exactly five, so the loser
        would not then have bought the player they actually bought for that
        slot -- and the published totals summed a six-card roster against a
        four-card one. Every repair requires simulating an auction that did not
        happen, which is a fabricated result standing beside real prices.

        The key is retained and always null so an older client renders nothing
        rather than crashing on a missing field.
        """
        built = receipt.build(finished, pool)
        assert "counterfactual" in built
        assert built["counterfactual"] is None

    def test_the_receipt_still_explains_where_the_match_turned(self, finished, pool):
        """What replaced it is a fact about the auction that happened."""
        built = receipt.build(finished, pool)
        decisive = built["most_decisive"]
        if decisive is not None:
            assert decisive["price"] >= 0
            assert decisive["winner_seat"] in (0, 1)
        assert built["positional"], "the per-slot comparison must survive"

    def test_the_most_decisive_auction_names_a_real_lot(self, finished, pool):
        decisive = receipt.build(finished, pool)["most_decisive"]
        if decisive is not None:
            assert decisive["winner_seat"] in (0, 1)
            assert decisive["round_index"] < len(finished["history"])


class TestBotPlaysARealAuction:
    def test_a_bot_vs_bot_match_completes_with_two_legal_rosters(self, pool):
        for seed in (2, 19, 77):
            state = play_match(seed, pool, strategy=bot_strategy())
            assert S.is_complete(state)
            assert_terminal_state_is_legal(state, pool)

    def test_a_human_pass_does_not_make_the_bot_pass(self, pool):
        """THE REPORTED DEFECT, as an assertion.

        Seat 0 passes on every lot it opens. If the bot mirrored that -- which
        is what the unregistered baseline effectively did, since its empty
        payload reduced to a $0 bid -- nothing would ever be bought and the
        match would end auto-filled. A bot that decides independently buys.
        """
        state = play_match(
            101,
            pool,
            # Seat 0 declines everything the rules let it decline. Once its
            # market skips are gone it must open at $1, which is the rule
            # rather than a change of heart -- the point of the test is what
            # the BOT does, and it must not mirror the human either way.
            seat_strategies={0: always_pass, 1: bot_strategy()},
        )
        bought_by_bot = [
            r for r in state["history"]
            if r["winner_seat"] == 1 and r["decided_by"] != S.DECIDED_BY_AUTOFILL
        ]
        assert bought_by_bot, "the bot passed on every lot the human declined"
        assert state["seats"][1]["budget"] < STARTING_BUDGET

    def test_the_bot_opens_a_lot_the_human_walked_away_from(self, pool):
        """Brief rule 7 from the bot's side: an opener's pass hands the bot a
        free look, and it must take it rather than pass in sympathy."""
        bot = TwentyDollarBot()
        rng = random.Random(9)
        for seed in range(40):
            state = S.initial_state(seed=seed)
            human = state["active_seat"]
            S.submit_action(state, human, S.COMMAND_PASS, 0, pool)
            if S.is_complete(state) or state["active_seat"] is None:
                continue
            public, private, _ = S.project(state, state["active_seat"], pool)
            command, payload = bot.decide(public, private, rng)
            if command == S.COMMAND_BID:
                assert payload["amount"] >= 1
                return
        pytest.fail("the bot never opened on a lot the opener had passed")

    def test_the_bot_never_produces_an_illegal_action(self, pool):
        bot = TwentyDollarBot()
        rng = random.Random(5)
        for seed in (3, 33, 333):
            state = S.initial_state(seed=seed)
            guard = 0
            while not S.is_complete(state) and guard < 2000:
                guard += 1
                seat_index = state["active_seat"]
                public, private, legal = S.project(state, seat_index, pool)
                command, payload = bot.decide(public, private, rng)
                assert command in legal, (command, legal)
                _, code, message = S.submit_action(
                    state, seat_index, command, int(payload.get("amount", 0)), pool
                )
                assert code is None, f"{code}: {message}"

    def test_the_bot_never_exceeds_its_reserve(self, pool):
        state = play_match(4711, pool, strategy=bot_strategy())
        for seat in state["seats"]:
            assert rules.is_solvent(seat["budget"], len(seat["roster"]))
            assert seat["budget"] >= 0

    def test_the_bot_is_deterministic_from_the_same_inputs(self, pool):
        bot = TwentyDollarBot()
        state = S.initial_state(seed=8080)
        public, private, _ = S.project(state, state["active_seat"], pool)
        a = bot.decide(public, private, random.Random("fixed"))
        b = bot.decide(public, private, random.Random("fixed"))
        assert a == b

    def test_the_bot_spends_its_budget_by_the_last_slot(self, pool):
        """Unspent money scores nothing, so a bot that finished with most of
        its $20 would be leaving the game on the table."""
        totals = []
        for seed in (6, 66, 666, 6666):
            state = play_match(seed, pool, strategy=bot_strategy())
            totals.extend(seat["budget"] for seat in state["seats"])
        assert sum(totals) / len(totals) < STARTING_BUDGET / 2


class TestBotIdentityIsNeverAnImplementationLabel:
    def test_the_display_name_is_the_product_name(self):
        bot = TwentyDollarBot()
        assert bot.display_name == f"{BOT_DISPLAY_NAME} · {BOT_DIFFICULTY_LABEL}"

    def test_the_display_name_does_not_contain_the_policy_id(self):
        bot = TwentyDollarBot()
        assert bot.bot_id not in bot.display_name
        assert bot.policy_version not in bot.display_name
        assert "_v" not in bot.display_name
