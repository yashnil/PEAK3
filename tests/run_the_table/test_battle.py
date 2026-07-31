"""Battle resolution: lane aggregation, bench weights, boss rules, tie-breaks.

Most tests here run against hand-built synthetic pools so every expected value
is arithmetic a reader can check by hand, not a snapshot.
"""
from __future__ import annotations

import copy

import pytest

from nba_peak.run_the_table.battle import (
    bench_weight_for,
    lane_score,
    resolve_battle,
    roster_lane_profile,
    roster_total,
)
from nba_peak.run_the_table.bosses import resolve_bosses
from nba_peak.run_the_table.config import (
    BENCH_WEIGHT_DEEP_ROTATION,
    BENCH_WEIGHT_DEFAULT,
    BENCH_WEIGHT_TOP_HEAVY,
    BOSS_RULES,
    COMEBACK_CREDITS,
    LANE_FIELDS,
    LANE_LABELS,
    LANE_PEAK3_WEIGHTS,
    LANES_TO_WIN,
)
from nba_peak.run_the_table.schemas import Opponent

from .conftest import make_card, make_pool

SI, TP, REC, PO, TEAM = LANE_FIELDS


def _flat(**overrides) -> dict:
    """Lane dict where every lane is 50 unless overridden."""
    base = {lane: 50.0 for lane in LANE_FIELDS}
    base.update(overrides)
    return base


def _side(prefix: str, lanes: dict, n: int = 5):
    """n distinct cards that all carry the same lane profile."""
    return [make_card(f"{prefix}{i}", lanes, slug=f"{prefix}{i}") for i in range(n)]


def _opponent(starter_ids, bench_ids=(), rule_id=None, act=1) -> Opponent:
    return Opponent(
        boss_id="test_boss",
        name="Test Boss",
        tagline="",
        act=act,
        rule_id=rule_id,
        starter_ids=tuple(starter_ids),
        bench_ids=tuple(bench_ids),
        source="curated",
    )


class TestLaneAggregation:
    """Starters at weight 1.00, bench at the active bench weight, weighted mean."""

    @pytest.fixture
    def graded(self):
        starters = [
            make_card(f"s{i}", float(v), slug=f"s{i}")
            for i, v in enumerate((10, 20, 30, 40, 50))
        ]
        bench = [
            make_card("b0", 60.0, slug="b0"),
            make_card("b1", 80.0, slug="b1"),
        ]
        return make_pool(starters + bench), [c.peak_window_id for c in starters], [
            c.peak_window_id for c in bench
        ]

    def test_default_bench_weight_hand_computed(self, graded):
        pool, starters, bench = graded
        # (10+20+30+40+50) + 0.35*(60+80) = 150 + 49 = 199
        # weight = 5*1.00 + 2*0.35 = 5.7   ->  199 / 5.7 = 34.912280...
        assert lane_score(pool, starters, bench, SI, BENCH_WEIGHT_DEFAULT) == 34.9123

    def test_deep_rotation_bench_weight_hand_computed(self, graded):
        pool, starters, bench = graded
        # 150 + 0.65*140 = 241 ; weight 6.3 ; 241 / 6.3 = 38.253968...
        assert lane_score(pool, starters, bench, SI, BENCH_WEIGHT_DEEP_ROTATION) == 38.254

    def test_top_heavy_bench_weight_hand_computed(self, graded):
        pool, starters, bench = graded
        # 150 + 0.15*140 = 171 ; weight 5.3 ; 171 / 5.3 = 32.264150...
        assert lane_score(pool, starters, bench, SI, BENCH_WEIGHT_TOP_HEAVY) == 32.2642

    def test_a_heavier_bench_moves_the_score_toward_the_bench(self, graded):
        pool, starters, bench = graded
        light = lane_score(pool, starters, bench, SI, BENCH_WEIGHT_TOP_HEAVY)
        default = lane_score(pool, starters, bench, SI, BENCH_WEIGHT_DEFAULT)
        deep = lane_score(pool, starters, bench, SI, BENCH_WEIGHT_DEEP_ROTATION)
        assert light < default < deep  # bench (60, 80) is stronger than the starters

    def test_empty_bench_is_the_plain_starter_mean(self, graded):
        pool, starters, _ = graded
        assert lane_score(pool, starters, [], SI, BENCH_WEIGHT_DEFAULT) == 30.0

    def test_empty_roster_scores_zero(self, graded):
        pool, _, _ = graded
        assert lane_score(pool, [], [], SI, BENCH_WEIGHT_DEFAULT) == 0.0

    def test_roster_profile_covers_all_five_lanes(self, graded):
        pool, starters, bench = graded
        profile = roster_lane_profile(pool, starters, bench)
        assert set(profile) == set(LANE_FIELDS)
        assert all(v == 34.9123 for v in profile.values())

    def test_roster_total_is_the_official_weight_blend(self, graded):
        pool, starters, bench = graded
        profile = roster_lane_profile(pool, starters, bench)
        expected = round(
            sum(profile[lane] * LANE_PEAK3_WEIGHTS[lane] for lane in LANE_FIELDS), 4
        )
        assert roster_total(profile) == expected
        # The five official weights sum to 1.0, so a flat profile round-trips.
        assert roster_total(profile) == 34.9123


class TestBenchWeightSelection:
    def test_default_when_no_system_and_no_rule(self):
        assert bench_weight_for((), None) == (BENCH_WEIGHT_DEFAULT, BENCH_WEIGHT_DEFAULT)

    def test_deep_rotation_lifts_only_the_player(self):
        assert bench_weight_for(("deep_rotation",), None) == (
            BENCH_WEIGHT_DEEP_ROTATION,
            BENCH_WEIGHT_DEFAULT,
        )

    def test_the_wall_does_not_touch_bench_weight(self):
        assert bench_weight_for((), "the_wall") == (BENCH_WEIGHT_DEFAULT, BENCH_WEIGHT_DEFAULT)

    def test_boss_bench_rules_are_symmetric_and_override_every_system(self):
        for rule_id, expected in (
            ("strength_in_numbers", BENCH_WEIGHT_DEEP_ROTATION),
            ("top_heavy", BENCH_WEIGHT_TOP_HEAVY),
        ):
            for systems in ((), ("deep_rotation",), ("deep_rotation", "moneyball")):
                player, opponent = bench_weight_for(systems, rule_id)
                assert player == opponent == expected, (
                    f"{rule_id} with systems {systems} was not symmetric"
                )

    def test_every_declared_boss_rule_is_handled(self):
        for rule_id in BOSS_RULES:
            player, opponent = bench_weight_for(("deep_rotation",), rule_id)
            if rule_id == "the_wall":
                # A tie-break rule, not a weight rule: Deep Rotation still applies.
                assert (player, opponent) == (BENCH_WEIGHT_DEEP_ROTATION, BENCH_WEIGHT_DEFAULT)
            else:
                assert player == opponent


class TestTieBreakerLadder:
    def _battle(self, player_lanes, opponent_lanes, rule_id=None, systems=()):
        player = _side("p", player_lanes)
        opponent = _side("o", opponent_lanes)
        pool = make_pool(player + opponent)
        p_ids = [c.peak_window_id for c in player]
        o_ids = [c.peak_window_id for c in opponent]
        return pool, resolve_battle(
            pool, p_ids, [], _opponent(o_ids, rule_id=rule_id), systems,
            lives_before=3, comeback_credits=COMEBACK_CREDITS,
        )

    def test_decided_by_lanes_when_three_lanes_are_won(self):
        _, result = self._battle(_flat(**{SI: 60.0, TP: 60.0, REC: 60.0}), _flat())
        assert result.player_lanes_won == 3 >= LANES_TO_WIN
        assert result.opponent_lanes_won == 0
        assert result.ties == 2
        assert result.decided_by == "lanes"
        assert result.outcome == "win"

    def test_decided_by_lanes_for_a_loss(self):
        _, result = self._battle(_flat(), _flat(**{SI: 70.0, TP: 70.0, REC: 70.0, PO: 70.0}))
        assert result.opponent_lanes_won == 4
        assert result.decided_by == "lanes"
        assert result.outcome == "loss"

    def test_decided_by_summed_margin_when_lanes_split_two_two(self):
        # margins: +5, +5, -1, -1, 0  ->  2 lanes each, one tie, sum +8
        player = _flat(**{SI: 55.0, TP: 55.0, REC: 49.0, PO: 49.0})
        _, result = self._battle(player, _flat())
        assert (result.player_lanes_won, result.opponent_lanes_won, result.ties) == (2, 2, 1)
        assert result.decided_by == "summed_margin"
        assert result.summed_margin == 8.0
        assert result.outcome == "win"

    def test_decided_by_summed_margin_can_lose(self):
        player = _flat(**{SI: 51.0, TP: 51.0, REC: 40.0, PO: 40.0})
        _, result = self._battle(player, _flat())
        assert (result.player_lanes_won, result.opponent_lanes_won) == (2, 2)
        assert result.summed_margin == -18.0
        assert result.decided_by == "summed_margin"
        assert result.outcome == "loss"

    def test_decided_by_roster_total_when_margins_cancel_exactly(self):
        # +10 Statistical Impact (weight .38) against -10 Traditional Production
        # (weight .21). Summed margin is exactly zero; the weighted blend is not.
        player = _flat(**{SI: 60.0, TP: 40.0})
        _, result = self._battle(player, _flat())
        assert (result.player_lanes_won, result.opponent_lanes_won, result.ties) == (1, 1, 3)
        assert result.summed_margin == 0.0
        assert result.decided_by == "roster_total"
        assert result.outcome == "win"
        assert round(result.player_roster_total - result.opponent_roster_total, 4) == 1.7

    def test_decided_by_roster_total_can_lose(self):
        player = _flat(**{SI: 40.0, TP: 60.0})
        _, result = self._battle(player, _flat())
        assert result.summed_margin == 0.0
        assert result.decided_by == "roster_total"
        assert result.outcome == "loss"
        assert round(result.player_roster_total - result.opponent_roster_total, 4) == -1.7

    def test_a_roster_against_itself_is_an_exact_draw(self, pool, blueprints):
        """The strongest possible determinism check on the real pool."""
        bp = blueprints(4)
        starters = list(bp.starting_starters)
        bench = list(bp.starting_bench)
        mirror = _opponent(starters, bench, rule_id=None)
        result = resolve_battle(
            pool, starters, bench, mirror, (), lives_before=3,
            comeback_credits=COMEBACK_CREDITS,
        )
        assert result.player_lanes_won == 0
        assert result.opponent_lanes_won == 0
        assert result.ties == len(LANE_FIELDS)
        assert result.summed_margin == 0.0
        assert result.player_roster_total == result.opponent_roster_total
        assert result.decided_by == "exact_draw"
        assert result.outcome == "draw"

    def test_a_draw_costs_nothing_and_pays_nothing(self, pool, blueprints):
        bp = blueprints(4)
        mirror = _opponent(bp.starting_starters, bp.starting_bench)
        result = resolve_battle(
            pool, list(bp.starting_starters), list(bp.starting_bench), mirror, (),
            lives_before=2, comeback_credits=COMEBACK_CREDITS,
        )
        assert result.outcome == "draw"
        assert result.lives_after == 2
        assert result.credits_awarded == 0


class TestTheWallRule:
    def _wall(self, player_lanes, opponent_lanes, rule_id):
        player = _side("p", player_lanes)
        opponent = _side("o", opponent_lanes)
        pool = make_pool(player + opponent)
        return resolve_battle(
            pool,
            [c.peak_window_id for c in player],
            [],
            _opponent([c.peak_window_id for c in opponent], rule_id=rule_id),
            (),
            lives_before=3,
            comeback_credits=COMEBACK_CREDITS,
        )

    def test_traditional_production_takes_every_exact_lane_tie(self):
        player = _flat(**{TP: 60.0})
        opponent = _flat(**{TP: 40.0})
        without = self._wall(player, opponent, None)
        assert (without.player_lanes_won, without.ties) == (1, 4)
        assert without.decided_by == "summed_margin"

        with_rule = self._wall(player, opponent, "the_wall")
        assert with_rule.player_lanes_won == 5
        assert with_rule.ties == 0
        assert with_rule.decided_by == "lanes"
        broken = [l for l in with_rule.lanes if l.tie_broken_by_rule]
        assert {l.lane for l in broken} == set(LANE_FIELDS) - {TP}

    def test_the_rule_is_symmetric_and_can_hand_the_lanes_to_the_boss(self):
        player = _flat(**{TP: 40.0})
        opponent = _flat(**{TP: 60.0})
        result = self._wall(player, opponent, "the_wall")
        assert result.opponent_lanes_won == 5
        assert result.player_lanes_won == 0
        assert result.outcome == "loss"

    def test_a_tie_in_traditional_production_itself_stays_a_tie(self):
        result = self._wall(_flat(), _flat(), "the_wall")
        assert result.ties == len(LANE_FIELDS)
        assert not any(l.tie_broken_by_rule for l in result.lanes)
        assert result.decided_by == "exact_draw"


class TestBossRuleSafety:
    def test_no_boss_rule_alters_any_individual_cards_lane_index(self, pool, blueprints):
        bp = blueprints(6)
        before = {c.peak_window_id: copy.deepcopy(c.lane_index) for c in pool.cards}
        for boss in resolve_bosses(pool):
            resolve_battle(
                pool, list(bp.starting_starters), list(bp.starting_bench), boss,
                ("deep_rotation",), lives_before=3, comeback_credits=COMEBACK_CREDITS,
            )
        after = {c.peak_window_id: c.lane_index for c in pool.cards}
        assert before == after

    def test_both_sides_receive_the_same_bench_weight_under_a_bench_rule(self, pool, blueprints):
        bp = blueprints(6)
        bosses = {b.boss_id: b for b in resolve_bosses(pool)}
        for boss_id, expected in (
            ("strength_in_numbers", BENCH_WEIGHT_DEEP_ROTATION),
            ("the_ceiling", BENCH_WEIGHT_TOP_HEAVY),
        ):
            boss = bosses[boss_id]
            result = resolve_battle(
                pool, list(bp.starting_starters), list(bp.starting_bench), boss,
                ("deep_rotation",), lives_before=3, comeback_credits=COMEBACK_CREDITS,
            )
            assert result.bench_weight == expected
            for lane in LANE_FIELDS:
                row = next(l for l in result.lanes if l.lane == lane)
                assert row.opponent_score == lane_score(
                    pool, boss.starter_ids, boss.bench_ids, lane, expected
                )
                assert row.player_score == lane_score(
                    pool, bp.starting_starters, bp.starting_bench, lane, expected
                )

    def test_lane_results_carry_labels_and_top_contributors(self, pool, blueprints):
        bp = blueprints(6)
        boss = resolve_bosses(pool)[0]
        result = resolve_battle(
            pool, list(bp.starting_starters), list(bp.starting_bench), boss, (),
            lives_before=3, comeback_credits=COMEBACK_CREDITS,
        )
        assert [l.lane for l in result.lanes] == list(LANE_FIELDS)
        roster = list(bp.starting_starters) + list(bp.starting_bench)
        for row in result.lanes:
            assert row.label == LANE_LABELS[row.lane]
            assert row.player_top_card_id in roster
            best = max(pool.get(c).lane_index[row.lane] for c in roster)
            assert pool.get(row.player_top_card_id).lane_index[row.lane] == best

    def test_battle_resolution_is_repeatable(self, pool, blueprints):
        import dataclasses

        bp = blueprints(6)
        boss = resolve_bosses(pool)[2]
        args = (pool, list(bp.starting_starters), list(bp.starting_bench), boss, ("deep_rotation",))
        a = resolve_battle(*args, lives_before=3, comeback_credits=COMEBACK_CREDITS)
        b = resolve_battle(*args, lives_before=3, comeback_credits=COMEBACK_CREDITS)
        assert dataclasses.asdict(a) == dataclasses.asdict(b)


class TestLivesAndComebackCredits:
    def _losing_battle(self, lives_before):
        player = _side("p", _flat(**{SI: 10.0, TP: 10.0, REC: 10.0, PO: 10.0, TEAM: 10.0}))
        opponent = _side("o", _flat(**{SI: 90.0, TP: 90.0, REC: 90.0, PO: 90.0, TEAM: 90.0}))
        pool = make_pool(player + opponent)
        return resolve_battle(
            pool,
            [c.peak_window_id for c in player],
            [],
            _opponent([c.peak_window_id for c in opponent]),
            (),
            lives_before=lives_before,
            comeback_credits=COMEBACK_CREDITS,
        )

    def test_a_loss_costs_one_life_and_pays_comeback_credits_while_lives_remain(self):
        for lives_before in (3, 2):
            result = self._losing_battle(lives_before)
            assert result.outcome == "loss"
            assert result.lives_after == lives_before - 1
            assert result.credits_awarded == COMEBACK_CREDITS

    def test_the_last_life_pays_no_comeback_credits(self):
        result = self._losing_battle(1)
        assert result.outcome == "loss"
        assert result.lives_after == 0
        assert result.credits_awarded == 0

    def test_a_win_costs_nothing_and_pays_nothing(self):
        player = _side("p", _flat(**{SI: 90.0, TP: 90.0, REC: 90.0}))
        opponent = _side("o", _flat())
        pool = make_pool(player + opponent)
        result = resolve_battle(
            pool,
            [c.peak_window_id for c in player],
            [],
            _opponent([c.peak_window_id for c in opponent]),
            (),
            lives_before=3,
            comeback_credits=COMEBACK_CREDITS,
        )
        assert result.outcome == "win"
        assert result.lives_after == 3
        assert result.credits_awarded == 0
