"""Card pool integrity, the price curve, and every System's published effect.

Each System has exactly one test that reproduces its ``summary`` string from
``config.SYSTEMS`` against the real card pool, so a rules change that is not
also a copy change fails here.
"""
from __future__ import annotations

import pytest

from nba_peak.run_the_table.cards import base_cost_for_percentile
from nba_peak.run_the_table.config import (
    BENCH_WEIGHT_TOP_HEAVY,
    LANE_FIELDS,
    MONEYBALL_DISCOUNT,
    MONEYBALL_PERCENTILE_MAX,
    NO_HARDWARE_DISCOUNT,
    NO_HARDWARE_IMPACT_PCT_MIN,
    NO_HARDWARE_RECOGNITION_PCT_MAX,
    PRICE_BASE,
    PRICE_EXPONENT,
    PRICE_MAX,
    PRICE_MIN,
    PRICE_SPAN,
    SYSTEM_IDS,
    SYSTEM_PUBLISHED_THRESHOLDS,
    TRADE_MACHINE_REFUND_PCT,
    TRADE_REFUND_PCT,
    TWO_WAY_BALANCE_MAX_SPREAD,
    TWO_WAY_DISCOUNT,
    TWO_WAY_IMPACT_PCT_MIN,
    TWO_WAY_MAX_PERCENTILE,
    VETERAN_MINIMUM_PERCENTILE_MAX,
    system_by_id,
)
from nba_peak.run_the_table.pricing import (
    price_for,
    qualifies_moneyball,
    qualifies_no_hardware,
    qualifies_two_way,
    qualifies_veteran_minimum,
    refund_for,
    trade_net_cost,
    veteran_minimum_available,
)

from .conftest import make_card


class TestCardPoolIntegrity:
    def test_pool_is_non_trivial_and_uniquely_keyed(self, pool):
        assert len(pool) >= 100
        ids = [c.peak_window_id for c in pool.cards]
        assert len(set(ids)) == len(ids)
        assert pool.stats.card_count == len(pool)

    def test_cards_are_in_canonical_id_order(self, pool):
        ids = [c.peak_window_id for c in pool.cards]
        assert ids == sorted(ids)

    def test_every_card_carries_all_five_canonical_lanes(self, pool):
        for card in pool.cards:
            assert set(card.lane_index) == set(LANE_FIELDS)
            assert set(card.lane_values) == set(LANE_FIELDS)
            assert set(card.lane_percentiles) == set(LANE_FIELDS)

    def test_lane_index_is_rescaled_to_the_full_zero_hundred_range(self, pool):
        for lane in LANE_FIELDS:
            vals = [c.lane_index[lane] for c in pool.cards]
            assert min(vals) == pytest.approx(0.0, abs=1e-6)
            assert max(vals) == pytest.approx(100.0, abs=1e-6)
            assert all(0.0 <= v <= 100.0 for v in vals)

    def test_every_card_has_at_least_one_eligible_role(self, pool):
        assert all(card.eligible_roles for card in pool.cards)

    def test_overall_percentile_ordering_matches_prime_score_ordering(self, pool):
        ranked = sorted(pool.cards, key=lambda c: c.prime_score)
        for a, b in zip(ranked, ranked[1:]):
            if a.prime_score < b.prime_score:
                assert a.overall_percentile < b.overall_percentile


class TestPriceCurve:
    def test_base_cost_is_monotonic_non_decreasing_in_percentile(self):
        prev = None
        for step in range(0, 1001):
            cost = base_cost_for_percentile(step / 1000.0)
            if prev is not None:
                assert cost >= prev, f"price fell at percentile {step / 1000.0}"
            prev = cost

    def test_base_cost_is_clamped_to_the_published_bounds(self):
        for pct in (-5.0, -0.001, 0.0, 0.25, 0.5, 0.75, 1.0, 1.001, 99.0):
            cost = base_cost_for_percentile(pct)
            assert PRICE_MIN <= cost <= PRICE_MAX

    def test_base_cost_reproduces_the_published_formula(self):
        for pct in (0.0, 0.1, 0.33, 0.5, 0.77, 0.9, 1.0):
            expected = PRICE_BASE + round(PRICE_SPAN * (pct ** PRICE_EXPONENT))
            expected = int(min(PRICE_MAX, max(PRICE_MIN, expected)))
            assert base_cost_for_percentile(pct) == expected

    def test_endpoints_are_exactly_four_and_thirty(self):
        assert base_cost_for_percentile(0.0) == 4
        assert base_cost_for_percentile(1.0) == 30

    def test_every_real_card_price_matches_its_percentile(self, pool):
        for card in pool.cards:
            assert card.base_cost == base_cost_for_percentile(card.overall_percentile)

    def test_prices_with_no_systems_equal_base_cost(self, pool):
        for card in pool.cards:
            cost, modifiers = price_for(card, ())
            assert cost == card.base_cost
            assert modifiers == []

    def test_price_is_always_within_bounds_under_every_system_combination(self, pool):
        combos = [
            (),
            ("moneyball",),
            ("no_hardware",),
            ("two_way_value",),
            ("moneyball", "no_hardware"),
            ("moneyball", "two_way_value"),
            ("no_hardware", "two_way_value"),
        ]
        for card in pool.cards:
            for systems in combos:
                cost, _ = price_for(card, systems)
                assert PRICE_MIN <= cost <= PRICE_MAX


class TestMoneyball:
    """"Cards in the bottom 55% of PEAK3 3Y overall cost 35% less." """

    def test_summary_string_matches_the_constants(self):
        assert system_by_id("moneyball")["summary"] == (
            "Cards in the bottom 55% of PEAK3 3Y overall cost 35% less."
        )

    def test_qualifying_cards_get_exactly_the_published_discount(self, pool):
        qualified = [c for c in pool.cards if c.overall_percentile <= MONEYBALL_PERCENTILE_MAX]
        assert len(qualified) > 20
        for card in qualified:
            cost, modifiers = price_for(card, ("moneyball",))
            assert cost == max(
                PRICE_MIN, int(round(card.base_cost * (1.0 - MONEYBALL_DISCOUNT)))
            )
            assert [m["system_id"] for m in modifiers] == ["moneyball"]
            assert modifiers[0]["discount_pct"] == 35

    def test_cards_above_the_band_are_never_discounted(self, pool):
        above = [c for c in pool.cards if c.overall_percentile > MONEYBALL_PERCENTILE_MAX]
        assert above
        for card in above:
            assert not qualifies_moneyball(card)
            cost, modifiers = price_for(card, ("moneyball",))
            assert cost == card.base_cost
            assert modifiers == []

    def test_the_band_boundary_is_inclusive(self):
        on_band = make_card("edge", 50.0, overall_percentile=MONEYBALL_PERCENTILE_MAX)
        just_over = make_card(
            "over", 50.0, overall_percentile=MONEYBALL_PERCENTILE_MAX + 1e-9
        )
        assert qualifies_moneyball(on_band)
        assert not qualifies_moneyball(just_over)


class TestDeepRotation:
    """"Your bench counts at 0.65 instead of 0.35 in every lane where that
    helps you, and never in a lane where it would hurt." """

    def test_summary_string_matches_the_constants(self):
        assert system_by_id("deep_rotation")["summary"] == (
            "Your bench counts at 0.65 instead of 0.35 in every lane where that "
            "helps you, and never in a lane where it would hurt — unless a boss "
            "rule fixes the bench weight for both teams."
        )

    def test_the_summary_no_longer_promises_a_flat_re_weight(self):
        """v1 published "in every lane" for a flat re-weight of a weighted MEAN,
        which LOWERS the score of any roster whose bench is weaker than its
        starters — the default for every generated roster. The claim and the
        applied effect pointed in opposite directions."""
        summary = system_by_id("deep_rotation")["summary"]
        assert "where that helps you" in summary
        assert "never in a lane where it would hurt" in summary

    def test_the_summary_admits_that_a_boss_rule_overrides_it(self):
        """`bench_weight_for` lets a boss rule fix the weight for both teams,
        which makes this System redundant against Strength in Numbers and
        actively nullifies it against Top Heavy. "in every lane" on its own was
        a promise the engine does not keep."""
        from nba_peak.run_the_table.battle import bench_weight_for

        summary = system_by_id("deep_rotation")["summary"]
        assert "boss rule" in summary

        held = ("deep_rotation",)
        # Redundant: the boss grants everyone what the System grants.
        assert bench_weight_for(held, "strength_in_numbers") == bench_weight_for(
            (), "strength_in_numbers"
        )
        # Nullified: the System buys nothing at all here.
        assert bench_weight_for(held, "top_heavy") == (
            BENCH_WEIGHT_TOP_HEAVY,
            BENCH_WEIGHT_TOP_HEAVY,
        )

    def test_deep_rotation_is_declared_a_battle_system_and_never_moves_a_price(self, pool):
        assert system_by_id("deep_rotation")["affects"] == "battle"
        for card in pool.cards:
            cost, modifiers = price_for(card, ("deep_rotation",))
            assert cost == card.base_cost
            assert modifiers == []

    def test_deep_rotation_raises_only_the_players_bench_weight(self):
        from nba_peak.run_the_table.battle import bench_weight_for

        assert bench_weight_for((), None) == (0.35, 0.35)
        assert bench_weight_for(("deep_rotation",), None) == (0.65, 0.35)

    def test_deep_rotation_can_never_lower_a_lane_score(self, pool, blueprints):
        """The v1 defect, asserted directly against the real pool: over every
        starting roster the engine generates, the perk must not produce a single
        lane below what the player would have had without it."""
        from nba_peak.run_the_table.battle import player_lane_profile

        raised = 0
        for seed in range(120):
            bp = blueprints(seed)
            s, b = list(bp.starting_starters), list(bp.starting_bench)
            base = player_lane_profile(pool, s, b, ())
            perked = player_lane_profile(pool, s, b, ("deep_rotation",))
            for lane, value in perked.items():
                assert value >= base[lane], (
                    f"seed {seed}: Deep Rotation LOWERED {lane} "
                    f"({base[lane]} -> {value})"
                )
                raised += value > base[lane]
        # ... and it must actually do something, or it is a dead perk.
        assert raised > 0


class TestNoHardware:
    """"Cards below the 40th percentile in Individual Recognition but above the
    60th in Statistical Impact cost 40% less." """

    def test_summary_string_matches_the_constants(self):
        assert system_by_id("no_hardware")["summary"] == (
            "Cards below the 40th percentile in Individual Recognition but above "
            "the 60th percentile in Statistical Impact cost 40% less."
        )

    def test_qualifying_cards_get_exactly_the_published_discount(self, pool):
        qualified = [c for c in pool.cards if qualifies_no_hardware(c)]
        assert len(qualified) >= 5
        for card in qualified:
            assert card.lane_percentiles["individual_recognition"] < NO_HARDWARE_RECOGNITION_PCT_MAX
            assert card.lane_percentiles["statistical_impact"] > NO_HARDWARE_IMPACT_PCT_MIN
            cost, modifiers = price_for(card, ("no_hardware",))
            assert cost == max(
                PRICE_MIN, int(round(card.base_cost * (1.0 - NO_HARDWARE_DISCOUNT)))
            )
            assert [m["system_id"] for m in modifiers] == ["no_hardware"]

    def test_both_clauses_are_required(self):
        low_rec_low_impact = make_card(
            "a", 50.0,
            lane_percentiles={
                "statistical_impact": 10.0, "traditional_production": 50.0,
                "individual_recognition": 10.0, "postseason_individual_value": 50.0,
                "team_achievement": 50.0,
            },
        )
        high_rec_high_impact = make_card(
            "b", 50.0,
            lane_percentiles={
                "statistical_impact": 90.0, "traditional_production": 50.0,
                "individual_recognition": 90.0, "postseason_individual_value": 50.0,
                "team_achievement": 50.0,
            },
        )
        both = make_card(
            "c", 50.0,
            lane_percentiles={
                "statistical_impact": 90.0, "traditional_production": 50.0,
                "individual_recognition": 10.0, "postseason_individual_value": 50.0,
                "team_achievement": 50.0,
            },
        )
        assert not qualifies_no_hardware(low_rec_low_impact)
        assert not qualifies_no_hardware(high_rec_high_impact)
        assert qualifies_no_hardware(both)

    def test_non_qualifying_cards_pay_full_price(self, pool):
        for card in pool.cards:
            if qualifies_no_hardware(card):
                continue
            cost, modifiers = price_for(card, ("no_hardware",))
            assert cost == card.base_cost
            assert modifiers == []


class TestTwoWayValue:
    """"Cards in the bottom 78% of PEAK3 3Y overall whose five component
    percentiles span 28 points or less, with Statistical Impact above the 45th
    percentile, cost 30% less." """

    def test_summary_string_matches_the_constants(self):
        assert system_by_id("two_way_value")["summary"] == (
            "Cards in the bottom 78% of PEAK3 3Y overall whose five component "
            "percentiles span 28 points or less, with Statistical Impact above "
            "the 45th percentile, cost 30% less."
        )

    def test_the_published_rule_and_the_applied_rule_select_the_same_cards(self, pool):
        """The regression this System actually shipped with.

        `qualifies_two_way` read TWO_WAY_MAX_PERCENTILE while the summary named
        only the spread and the impact floor. On the real pool the STATED rule
        matched 26 cards and the APPLIED rule matched 3 — LeBron, Jordan,
        Jokic, Curry, Duncan, Giannis, Durant and Hakeem all satisfied every
        published condition and were still charged full price, with no
        explanation available to the player anywhere in the product.

        This asserts the two populations are now identical, reading the stated
        rule straight off the constants the summary names.
        """
        def stated(card) -> bool:
            vals = list(card.lane_percentiles.values())
            return (
                max(vals) - min(vals) <= TWO_WAY_BALANCE_MAX_SPREAD
                and card.lane_percentiles["statistical_impact"] > TWO_WAY_IMPACT_PCT_MIN
                and card.overall_percentile <= TWO_WAY_MAX_PERCENTILE
            )

        divergent = [c.player_name for c in pool.cards if stated(c) != qualifies_two_way(c)]
        assert divergent == [], (
            f"published and applied Two-Way Value rules disagree on: {divergent}"
        )

    def test_qualifying_cards_get_exactly_the_published_discount(self, pool):
        qualified = [c for c in pool.cards if qualifies_two_way(c)]
        assert qualified, "Two-Way Value must be reachable on the real pool"
        for card in qualified:
            vals = list(card.lane_percentiles.values())
            assert max(vals) - min(vals) <= TWO_WAY_BALANCE_MAX_SPREAD
            assert card.lane_percentiles["statistical_impact"] > TWO_WAY_IMPACT_PCT_MIN
            cost, modifiers = price_for(card, ("two_way_value",))
            assert cost == max(
                PRICE_MIN, int(round(card.base_cost * (1.0 - TWO_WAY_DISCOUNT)))
            )
            assert [m["system_id"] for m in modifiers] == ["two_way_value"]

    def test_no_card_above_the_percentile_cap_is_ever_discounted(self, pool):
        """Regression: without the cap, an all-time great is "balanced" because
        every lane is near the ceiling, turning the System into a GOAT coupon."""
        above_cap = [c for c in pool.cards if c.overall_percentile > TWO_WAY_MAX_PERCENTILE]
        assert len(above_cap) >= 20, "the cap must actually exclude a chunk of the pool"
        for card in above_cap:
            assert not qualifies_two_way(card), (
                f"{card.player_name} at percentile {card.overall_percentile} is above the "
                f"{TWO_WAY_MAX_PERCENTILE} cap and must never be discounted"
            )
            cost, modifiers = price_for(card, ("two_way_value",))
            assert cost == card.base_cost
            assert modifiers == []

    def test_a_perfectly_balanced_elite_card_is_rejected_by_the_cap_alone(self):
        """A synthetic card that satisfies spread + impact but sits above the cap."""
        goat = make_card(
            "goat", 100.0, lane_percentiles=99.0,
            overall_percentile=0.99, base_cost=30,
        )
        assert max(goat.lane_percentiles.values()) - min(goat.lane_percentiles.values()) == 0.0
        assert goat.lane_percentiles["statistical_impact"] > TWO_WAY_IMPACT_PCT_MIN
        assert not qualifies_two_way(goat)
        assert price_for(goat, ("two_way_value",)) == (30, [])

        under_cap = make_card(
            "solid", 60.0, lane_percentiles=60.0,
            overall_percentile=TWO_WAY_MAX_PERCENTILE, base_cost=20,
        )
        assert qualifies_two_way(under_cap)
        assert price_for(under_cap, ("two_way_value",))[0] == 14

    def test_spread_clause_is_required(self):
        spread_out = make_card(
            "spread", 50.0,
            lane_percentiles={
                "statistical_impact": 95.0, "traditional_production": 95.0,
                "individual_recognition": 20.0, "postseason_individual_value": 95.0,
                "team_achievement": 95.0,
            },
            overall_percentile=0.5,
        )
        assert not qualifies_two_way(spread_out)


class TestTradeMachine:
    """Trade Machine refunds more than the base rate, and both are published."""

    def test_summary_string_matches_the_constants(self):
        # DERIVED, NOT RETYPED. This used to hardcode "70% instead of 50%", so
        # the v4 refund change (0.50 -> 0.60 and 0.70 -> 0.78; see
        # config.TRADE_REFUND_PCT for the measured reason) failed it for
        # restating a number rather than for breaking a contract. The contract
        # is that the summary states both LIVE percentages, which is what
        # SYSTEM_PUBLISHED_THRESHOLDS already walks, so it is expressed that
        # way here too and cannot go stale again.
        assert system_by_id("trade_machine")["summary"] == (
            f"Outgoing cards refund {round(TRADE_MACHINE_REFUND_PCT * 100)}% "
            f"instead of {round(TRADE_REFUND_PCT * 100)}%."
        )

    def test_refund_uses_the_undiscounted_base_cost_and_rounds_down(self, pool):
        for card in pool.cards:
            assert refund_for(card, ()) == int(card.base_cost * TRADE_REFUND_PCT)
            assert refund_for(card, ("trade_machine",)) == int(
                card.base_cost * TRADE_MACHINE_REFUND_PCT
            )
            # A System that discounts the purchase must not inflate the refund.
            assert refund_for(card, ("moneyball",)) == int(card.base_cost * TRADE_REFUND_PCT)

    def test_hand_computed_refunds(self):
        # The BEHAVIOUR under test is "multiply by the published rate, then
        # floor" -- the floor is the part a hand-computed case exists to pin,
        # because it is what stops a round trip turning a profit. The rate
        # itself is a balance constant, so the expectation is computed from it
        # and the floor is asserted explicitly on a value that is not whole.
        card = make_card("x", 50.0, base_cost=25)
        assert refund_for(card, ()) == int(25 * TRADE_REFUND_PCT)
        assert refund_for(card, ("trade_machine",)) == int(25 * TRADE_MACHINE_REFUND_PCT)
        # 25 * 0.6 == 15.0 exactly, so pick a base cost that does not divide
        # evenly and prove the result is floored rather than rounded.
        odd = make_card("y", 50.0, slug="y", base_cost=7)
        assert 7 * TRADE_REFUND_PCT % 1 != 0
        assert refund_for(odd, ()) == int(7 * TRADE_REFUND_PCT)
        assert refund_for(odd, ()) < 7 * TRADE_REFUND_PCT

    def test_trade_net_cost_is_incoming_price_minus_outgoing_refund(self):
        outgoing = make_card("out", 50.0, slug="out", base_cost=20)
        incoming = make_card("in", 50.0, slug="in", base_cost=28, overall_percentile=0.9)

        plain = trade_net_cost(outgoing, incoming, ())
        assert plain["incoming_cost"] == 28
        assert plain["outgoing_refund"] == int(20 * TRADE_REFUND_PCT)
        assert plain["net_cost"] == 28 - int(20 * TRADE_REFUND_PCT)

        machine = trade_net_cost(outgoing, incoming, ("trade_machine",))
        assert machine["incoming_cost"] == 28
        assert machine["outgoing_refund"] == int(20 * TRADE_MACHINE_REFUND_PCT)
        assert machine["net_cost"] == 28 - int(20 * TRADE_MACHINE_REFUND_PCT)
        # The System must actually be worth holding.
        assert machine["net_cost"] < plain["net_cost"]

    def test_trade_machine_never_reduces_the_refund_on_the_real_pool(self, pool):
        for card in pool.cards:
            assert refund_for(card, ("trade_machine",)) >= refund_for(card, ())

    def test_a_round_trip_can_never_turn_a_profit(self, pool):
        """Buy then sell the same card: refund must not exceed what was paid."""
        for card in pool.cards:
            for systems in ((), ("trade_machine",), ("moneyball", "trade_machine")):
                paid, _ = price_for(card, systems)
                assert refund_for(card, systems) <= card.base_cost
                if not systems or systems == ("trade_machine",):
                    assert refund_for(card, systems) <= paid


class TestVeteranMinimum:
    """"In the Draft Room only: 1 card per act in the bottom 35% of PEAK3 3Y
    overall costs 0 credits." """

    def test_summary_string_matches_the_constants(self):
        assert system_by_id("veteran_minimum")["summary"] == (
            "In the Draft Room only: 1 card per act in the bottom 35% of PEAK3 3Y "
            "overall costs 0 credits."
        )

    def test_the_summary_says_where_the_discount_actually_works(self):
        """`veteran_minimum_available` is consulted by exactly one action —
        `action_draft_buy`. A player who reads "one card per act costs 0" and
        then takes a Trade Desk has been told something untrue, so the surface
        it works on is part of the published rule."""
        import inspect

        from nba_peak.run_the_table import state as run_state

        assert "Draft Room" in system_by_id("veteran_minimum")["summary"]

        source = inspect.getsource(run_state)
        # Call sites only — `veteran_minimum_available(`. The bare name also
        # appears in the module's import list, which is not a consultation.
        callers = [
            line.strip()
            for line in source.splitlines()
            if "veteran_minimum_available(" in line
        ]
        assert len(callers) == 1, (
            f"veteran_minimum_available is consulted in {len(callers)} places; the "
            f"summary claims only the Draft Room: {callers}"
        )

    def test_only_bottom_band_cards_qualify(self, pool):
        qualified = [c for c in pool.cards if qualifies_veteran_minimum(c)]
        assert len(qualified) >= 30
        for card in pool.cards:
            assert qualifies_veteran_minimum(card) == (
                card.overall_percentile <= VETERAN_MINIMUM_PERCENTILE_MAX
            )

    def test_availability_requires_the_system_an_unused_act_and_a_cheap_card(self, pool):
        cheap = next(c for c in pool.cards if qualifies_veteran_minimum(c))
        pricey = next(c for c in pool.cards if not qualifies_veteran_minimum(c))

        assert veteran_minimum_available(cheap, ["veteran_minimum"], False) is True
        assert veteran_minimum_available(cheap, ["veteran_minimum"], True) is False
        assert veteran_minimum_available(cheap, [], False) is False
        assert veteran_minimum_available(pricey, ["veteran_minimum"], False) is False

    def test_veteran_minimum_is_an_economy_system_and_never_moves_a_list_price(self, pool):
        assert system_by_id("veteran_minimum")["affects"] == "economy"
        for card in pool.cards:
            assert price_for(card, ("veteran_minimum",)) == (card.base_cost, [])


class TestPublishedThresholds:
    """Every threshold a System APPLIES must be a threshold it PUBLISHES.

    This is the class of defect Two-Way Value shipped with: a predicate read a
    constant that the summary never named, so the rule the player could read
    and the rule the engine ran were different rules. It is invisible to every
    other test in this file, because each of those checks one System against
    the copy that System happens to have.

    `config.SYSTEM_PUBLISHED_THRESHOLDS` declares, per System, the constants its
    rule reads and the exact rendering each must appear as. Both the summary and
    the expected rendering are built from the same constants, so changing a
    threshold moves them together — the only way to fail here is to add a
    condition to a predicate (or a battle/economy rule) and not say so.
    """

    def test_every_system_declares_the_thresholds_it_reads(self):
        assert set(SYSTEM_PUBLISHED_THRESHOLDS) == set(SYSTEM_IDS), (
            "a System with no declared thresholds is a System whose published "
            "rule cannot be checked against its applied rule"
        )
        for system_id, thresholds in SYSTEM_PUBLISHED_THRESHOLDS.items():
            assert thresholds, f"{system_id} declares no thresholds"

    def test_every_declared_threshold_appears_in_its_summary(self):
        for system_id, thresholds in SYSTEM_PUBLISHED_THRESHOLDS.items():
            summary = system_by_id(system_id)["summary"]
            for constant_name, rendering in thresholds.items():
                assert rendering in summary, (
                    f"{system_id} applies {constant_name}, which should read "
                    f"{rendering!r} in its summary, but the summary is: {summary!r}"
                )

    def test_the_declared_thresholds_are_the_constants_each_predicate_reads(self):
        """Closes the loop from the other end: read the predicate's own source
        and require every `config` constant it names to be declared above.

        Without this, the table could quietly omit a constant and the summary
        test would pass vacuously — which is precisely how the original bug
        survived a green suite.
        """
        import inspect

        from nba_peak.run_the_table import battle, pricing

        # System id -> the function that decides that System's effect.
        rules = {
            "moneyball": pricing.qualifies_moneyball,
            "no_hardware": pricing.qualifies_no_hardware,
            "two_way_value": pricing.qualifies_two_way,
            "veteran_minimum": pricing.qualifies_veteran_minimum,
            "trade_machine": pricing.refund_for,
            # The function that APPLIES Deep Rotation is the candidate-weight
            # chooser, not the display helper beside it.
            "deep_rotation": battle.player_bench_weight_candidates,
        }
        assert set(rules) == set(SYSTEM_IDS)

        # Constants a rule may read without publishing them: they are not
        # thresholds the player is choosing against, they are the universal
        # price floor/ceiling and the per-System discount already named.
        exempt = {"PRICE_MIN", "PRICE_MAX", "BENCH_WEIGHT_TOP_HEAVY"}

        for system_id, fn in rules.items():
            source = inspect.getsource(fn)
            module_constants = {
                name for name in dir(inspect.getmodule(fn)) if name.isupper()
            }
            read = {name for name in module_constants if name in source} - exempt
            declared = set(SYSTEM_PUBLISHED_THRESHOLDS[system_id])
            # Veteran Minimum's uses-per-act is enforced by the state machine's
            # per-act flag rather than by the predicate, so it is declared but
            # not named in the predicate's own source. Undeclared reads are the
            # failure; extra declarations are not.
            assert read <= declared, (
                f"{system_id} reads {sorted(read - declared)} but does not publish "
                f"{'them' if len(read - declared) > 1 else 'it'}"
            )


class TestSystemStacking:
    def test_discounts_stack_multiplicatively_in_the_published_order(self):
        card = make_card(
            "stack", 50.0,
            lane_percentiles={
                "statistical_impact": 65.0, "traditional_production": 50.0,
                "individual_recognition": 39.0, "postseason_individual_value": 55.0,
                "team_achievement": 45.0,
            },
            overall_percentile=0.40, base_cost=20,
        )
        assert qualifies_moneyball(card)
        assert qualifies_no_hardware(card)
        assert qualifies_two_way(card)

        cost, modifiers = price_for(card, ("moneyball", "no_hardware", "two_way_value"))
        # 20 -> 13.0 -> 7.8 -> 5.46 -> round -> 5
        assert [m["system_id"] for m in modifiers] == [
            "moneyball", "no_hardware", "two_way_value"
        ]
        assert cost == 5

    def test_stacked_price_never_falls_below_the_floor(self):
        card = make_card(
            "cheap", 50.0,
            lane_percentiles={
                "statistical_impact": 65.0, "traditional_production": 50.0,
                "individual_recognition": 39.0, "postseason_individual_value": 55.0,
                "team_achievement": 45.0,
            },
            overall_percentile=0.05, base_cost=PRICE_MIN,
        )
        cost, _ = price_for(card, ("moneyball", "no_hardware", "two_way_value"))
        assert cost == PRICE_MIN

    def test_every_declared_system_id_is_unique_and_resolvable(self):
        assert len(set(SYSTEM_IDS)) == len(SYSTEM_IDS) == 6
        for sid in SYSTEM_IDS:
            spec = system_by_id(sid)
            assert spec["id"] == sid
            assert spec["summary"]
            assert spec["affects"] in {"price", "battle", "economy"}
