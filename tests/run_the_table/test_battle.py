"""Battle resolution: lane aggregation, bench weights, boss rules, tie-breaks.

Most tests here run against hand-built synthetic pools so every expected value
is arithmetic a reader can check by hand, not a snapshot.
"""
from __future__ import annotations

import copy

import pytest

from nba_peak.run_the_table.battle import (
    bench_weight_for,
    lane_margin_threshold,
    lane_score,
    lanes_to_win_for,
    player_bench_weight_candidates,
    player_lane_profile,
    resolve_battle,
    roster_lane_profile,
    roster_total,
)
from nba_peak.run_the_table.config import (
    BENCH_WEIGHT_DEEP_ROTATION,
    BENCH_WEIGHT_DEFAULT,
    BENCH_WEIGHT_TOP_HEAVY,
    BOSS_BENCH_WEIGHT,
    BOSS_LANE_MARGIN,
    BOSS_LANES_TO_WIN,
    BOSS_RULES,
    BOSS_WIN_CREDITS,
    COMEBACK_CREDITS,
    LANE_EPSILON,
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

    def test_lane_margin_rules_do_not_touch_bench_weight(self):
        for rule_id in BOSS_LANE_MARGIN:
            assert bench_weight_for((), rule_id) == (
                BENCH_WEIGHT_DEFAULT,
                BENCH_WEIGHT_DEFAULT,
            )

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
            if rule_id in BOSS_BENCH_WEIGHT:
                assert player == opponent == BOSS_BENCH_WEIGHT[rule_id]
            else:
                # A lane-margin rule, not a weight rule: Deep Rotation applies.
                assert (player, opponent) == (BENCH_WEIGHT_DEEP_ROTATION, BENCH_WEIGHT_DEFAULT)

    def test_every_boss_rule_is_implemented_by_exactly_one_mechanic(self):
        """No boss may carry a rule the engine does not implement — that is how
        v1 shipped a tutorial boss whose rule never fired. v3 adds a third
        mechanic (BOSS_LANES_TO_WIN), so the union grows and the
        mutual-exclusion check grows with it."""
        mechanics = (BOSS_BENCH_WEIGHT, BOSS_LANE_MARGIN, BOSS_LANES_TO_WIN)
        assert set(BOSS_RULES) == set().union(*(set(m) for m in mechanics))
        for i, a in enumerate(mechanics):
            for b in mechanics[i + 1:]:
                assert not set(a) & set(b)

    def test_the_raised_lane_bar_applies_to_both_teams(self):
        """Symmetry is the boss-rule contract: `lanes_to_win_for` returns one
        threshold that `resolve_battle` compares BOTH lane counts against."""
        assert lanes_to_win_for(None) == LANES_TO_WIN == 3
        assert lanes_to_win_for("the_wall") == LANES_TO_WIN
        assert lanes_to_win_for("the_long_series") == BOSS_LANES_TO_WIN["the_long_series"]
        assert BOSS_LANES_TO_WIN["the_long_series"] > LANES_TO_WIN


class TestDeepRotationIsABuff:
    """v1's Deep Rotation was a NET NERF: `lane_score` is a weighted mean, so a
    flat re-weight lowers the score of any roster whose bench is weaker than its
    starters — the default. v2 takes the better of the two weights per lane."""

    @pytest.fixture
    def weak_bench(self):
        starters = [make_card(f"s{i}", 80.0, slug=f"s{i}") for i in range(5)]
        bench = [make_card("b0", 10.0, slug="b0"), make_card("b1", 20.0, slug="b1")]
        return make_pool(starters + bench), [c.peak_window_id for c in starters], [
            c.peak_window_id for c in bench
        ]

    def test_a_flat_re_weight_would_lower_every_lane(self, weak_bench):
        pool, starters, bench = weak_bench
        assert lane_score(pool, starters, bench, SI, BENCH_WEIGHT_DEEP_ROTATION) < (
            lane_score(pool, starters, bench, SI, BENCH_WEIGHT_DEFAULT)
        )

    def test_the_perk_never_lowers_a_lane(self, weak_bench):
        pool, starters, bench = weak_bench
        base = player_lane_profile(pool, starters, bench, ())
        with_perk = player_lane_profile(pool, starters, bench, ("deep_rotation",))
        for lane in LANE_FIELDS:
            assert with_perk[lane] >= base[lane]
        assert with_perk == base  # a weak bench is simply not used

    def test_the_perk_raises_a_lane_when_the_bench_is_stronger(self):
        starters = [make_card(f"s{i}", 40.0, slug=f"s{i}") for i in range(5)]
        bench = [make_card("b0", 90.0, slug="b0"), make_card("b1", 90.0, slug="b1")]
        pool = make_pool(starters + bench)
        s = [c.peak_window_id for c in starters]
        b = [c.peak_window_id for c in bench]
        base = player_lane_profile(pool, s, b, ())
        with_perk = player_lane_profile(pool, s, b, ("deep_rotation",))
        for lane in LANE_FIELDS:
            assert with_perk[lane] > base[lane]

    def test_a_boss_bench_rule_collapses_the_perk_to_one_weight(self):
        for rule_id, weight in BOSS_BENCH_WEIGHT.items():
            assert player_bench_weight_candidates(("deep_rotation",), rule_id) == (weight,)
        for rule_id in BOSS_LANE_MARGIN:
            assert player_bench_weight_candidates(("deep_rotation",), rule_id) == (
                BENCH_WEIGHT_DEFAULT,
                BENCH_WEIGHT_DEEP_ROTATION,
            )


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
        # A draw is neither a win nor a loss: no life, no comeback, no reward,
        # and — at the Final Boss — no cleared table.
        assert result.credits_awarded == 0


class TestLaneMarginRules:
    """`the_wall` (act 1) and `the_standard` (the Final Boss) both raise the
    margin a lane must be won by. v1's `the_wall` broke EXACT ties instead, and
    fired 0 times in 120,000 audited battles because lane scores are rounded to
    4 decimals — a rule that cannot fire is not a rule."""

    def _battle(self, player_lanes, opponent_lanes, rule_id):
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
            win_credits=BOSS_WIN_CREDITS,
        )

    def test_the_published_threshold_is_the_applied_threshold(self):
        assert lane_margin_threshold(None) == LANE_EPSILON
        assert lane_margin_threshold("strength_in_numbers") == LANE_EPSILON
        for rule_id, band in BOSS_LANE_MARGIN.items():
            assert lane_margin_threshold(rule_id) == band

    def test_a_lane_inside_the_band_is_drawn_and_marked_as_the_rules_doing(self):
        band = BOSS_LANE_MARGIN["the_wall"]
        # Won by half the band: taken without the rule, drawn with it.
        player = _flat(**{SI: 50.0 + band / 2, TP: 50.0 + band / 2,
                          REC: 50.0 + band / 2})
        without = self._battle(player, _flat(), None)
        assert without.player_lanes_won == 3 >= LANES_TO_WIN
        assert without.outcome == "win"

        with_rule = self._battle(player, _flat(), "the_wall")
        assert with_rule.player_lanes_won == 0
        assert with_rule.ties == len(LANE_FIELDS)
        assert [l.tie_broken_by_rule for l in with_rule.lanes] == [
            True, True, True, False, False
        ]
        # No lane reached three, so the published ladder decides it.
        assert with_rule.decided_by == "summed_margin"
        assert with_rule.outcome == "win"

    def test_a_lane_outside_the_band_is_still_taken(self):
        band = BOSS_LANE_MARGIN["the_wall"]
        player = _flat(**{SI: 50.0 + band + 1, TP: 50.0 + band + 1,
                          REC: 50.0 + band + 1})
        result = self._battle(player, _flat(), "the_wall")
        assert result.player_lanes_won == 3
        assert result.decided_by == "lanes"
        assert result.outcome == "win"
        assert not any(l.tie_broken_by_rule for l in result.lanes[:3])

    def test_the_band_is_symmetric_and_takes_lanes_from_the_boss_too(self):
        band = BOSS_LANE_MARGIN["the_standard"]
        opponent = _flat(**{SI: 50.0 + band / 2, TP: 50.0 + band / 2,
                            REC: 50.0 + band / 2})
        without = self._battle(_flat(), opponent, None)
        assert without.opponent_lanes_won == 3
        assert without.outcome == "loss"

        with_rule = self._battle(_flat(), opponent, "the_standard")
        assert with_rule.opponent_lanes_won == 0
        assert with_rule.ties == len(LANE_FIELDS)
        assert with_rule.outcome == "loss"  # summed margin still favours the boss

    def test_the_final_boss_band_is_the_wider_of_the_two(self):
        assert BOSS_LANE_MARGIN["the_standard"] > BOSS_LANE_MARGIN["the_wall"] > 0

    def test_an_exact_mirror_is_still_an_exact_draw_under_the_rule(self):
        result = self._battle(_flat(), _flat(), "the_wall")
        assert result.ties == len(LANE_FIELDS)
        # Drawn because the scores are equal, not because the rule intervened.
        assert not any(l.tie_broken_by_rule for l in result.lanes)
        assert result.decided_by == "exact_draw"


class TestBossRuleSafety:
    def test_no_boss_rule_alters_any_individual_cards_lane_index(self, pool, blueprints, boss_slate):
        bp = blueprints(6)
        before = {c.peak_window_id: copy.deepcopy(c.lane_index) for c in pool.cards}
        for boss in boss_slate:
            resolve_battle(
                pool, list(bp.starting_starters), list(bp.starting_bench), boss,
                ("deep_rotation",), lives_before=3, comeback_credits=COMEBACK_CREDITS,
            )
        after = {c.peak_window_id: c.lane_index for c in pool.cards}
        assert before == after

    def test_both_sides_receive_the_same_bench_weight_under_a_bench_rule(self, pool, blueprints, boss_slate):
        bp = blueprints(6)
        bosses = {b.boss_id: b for b in boss_slate}
        for boss_id, expected in (
            ("strength_in_numbers", BENCH_WEIGHT_DEEP_ROTATION),
            ("the_ceiling", BENCH_WEIGHT_TOP_HEAVY),
            # the_wall / the_standard are lane-margin rules; covered above.
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

    def test_lane_results_carry_labels_and_top_contributors(self, pool, blueprints, boss_slate):
        bp = blueprints(6)
        boss = boss_slate[0]
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

    def test_battle_resolution_is_repeatable(self, pool, blueprints, boss_slate):
        import dataclasses

        bp = blueprints(6)
        boss = boss_slate[2]
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

    def test_a_win_pays_the_win_reward_and_costs_no_life(self):
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
            win_credits=BOSS_WIN_CREDITS,
        )
        assert result.outcome == "win"
        assert result.lives_after == 3
        assert result.credits_awarded == BOSS_WIN_CREDITS
        # v1 paid a winner nothing while paying a loser COMEBACK_CREDITS, so the
        # only battle income in the game went to the player who was losing.
        assert BOSS_WIN_CREDITS > COMEBACK_CREDITS


class TestLanePreparation:
    """The Scout & Prepare preparation (spec §5A): capped, published, one lane,
    one battle, and always the player's — it is the thing they bought."""

    @pytest.fixture
    def even(self):
        mine = _side("m", _flat())
        theirs = _side("o", _flat())
        pool = make_pool(mine + theirs)
        return (
            pool,
            [c.peak_window_id for c in mine],
            _opponent([c.peak_window_id for c in theirs]),
        )

    def test_no_bonus_is_the_default_and_changes_nothing(self, even):
        pool, mine, boss = even
        a = resolve_battle(pool, mine, [], boss, (), lives_before=3, comeback_credits=0)
        b = resolve_battle(
            pool, mine, [], boss, (), lives_before=3, comeback_credits=0, lane_bonuses={}
        )
        assert a == b
        assert a.lane_bonuses == {}
        assert all(l.player_prep_bonus == 0.0 for l in a.lanes)

    def test_a_bonus_moves_only_the_named_lane_and_is_recorded(self, even):
        pool, mine, boss = even
        result = resolve_battle(
            pool, mine, [], boss, (), lives_before=3, comeback_credits=0,
            lane_bonuses={TP: 2.5},
        )
        assert result.lane_bonuses == {TP: 2.5}
        for lane in result.lanes:
            if lane.lane == TP:
                assert lane.player_score == 52.5
                assert lane.margin == 2.5
                assert lane.winner == "player"
                assert lane.player_prep_bonus == 2.5
            else:
                assert lane.player_score == 50.0
                assert lane.winner == "tie"
                assert lane.player_prep_bonus == 0.0

    def test_a_zero_bonus_is_dropped_rather_than_recorded(self, even):
        pool, mine, boss = even
        result = resolve_battle(
            pool, mine, [], boss, (), lives_before=3, comeback_credits=0,
            lane_bonuses={TP: 0.0},
        )
        assert result.lane_bonuses == {}

    def test_the_bonus_reaches_the_summed_margin_tie_break(self, even):
        pool, mine, boss = even
        result = resolve_battle(
            pool, mine, [], boss, (), lives_before=3, comeback_credits=0,
            lane_bonuses={TEAM: 2.5},
        )
        assert result.summed_margin == 2.5
        assert result.outcome == "win"


class TestReceiptBreakdown:
    """SYNTHESIS_CONTRACT.md §2.3: every lane's ``player_score`` decomposes
    into ``pre_perk_rating + bench_adjustment + player_prep_bonus`` -- exactly,
    not approximately, because ``bench_adjustment`` is defined as the residual
    rather than independently recomputed. A receipt built from these three
    fields must never show numbers that fail to add up.
    """

    def _reconciles(self, result):
        for lane in result.lanes:
            total = round(
                lane.pre_perk_rating + lane.bench_adjustment + lane.player_prep_bonus,
                4,
            )
            assert total == lane.player_score, (
                lane.lane, total, lane.player_score, lane.pre_perk_rating,
                lane.bench_adjustment, lane.player_prep_bonus,
            )

    def test_vanilla_battle_reconciles(self):
        mine = _side("m", _flat())
        theirs = _side("o", _flat())
        pool = make_pool(mine + theirs)
        boss = _opponent([c.peak_window_id for c in theirs])
        result = resolve_battle(
            pool, [c.peak_window_id for c in mine], [], boss, (),
            lives_before=3, comeback_credits=0,
        )
        self._reconciles(result)
        # No perk, no rule, no bonus: nothing to isolate.
        for lane in result.lanes:
            assert lane.bench_adjustment == 0.0
            assert lane.pre_perk_rating == lane.player_score

    def test_deep_rotation_reconciles_and_the_adjustment_is_the_perks_effect(self):
        starters = [make_card(f"s{i}", 40.0, slug=f"s{i}") for i in range(5)]
        bench = [make_card("b0", 90.0, slug="b0"), make_card("b1", 90.0, slug="b1")]
        theirs = _side("o", _flat())
        pool = make_pool(starters + bench + theirs)
        s = [c.peak_window_id for c in starters]
        b = [c.peak_window_id for c in bench]
        boss = _opponent([c.peak_window_id for c in theirs])
        result = resolve_battle(
            pool, s, b, boss, ("deep_rotation",), lives_before=3, comeback_credits=0,
        )
        self._reconciles(result)
        for lane in result.lanes:
            # A stronger bench under Deep Rotation can only ever help --
            # `bench_adjustment` isolates exactly that lift.
            assert lane.bench_adjustment > 0.0
            assert lane.player_prep_bonus == 0.0

    def test_boss_fixed_bench_weight_reconciles_even_when_it_hurts(self):
        # `top_heavy` fixes the bench weight low for BOTH teams -- a player
        # whose bench out-scores their starters is hurt by it, and the
        # breakdown must show that as a negative `bench_adjustment` rather
        # than silently absorbing it into `pre_perk_rating`.
        starters = [make_card(f"s{i}", 40.0, slug=f"s{i}") for i in range(5)]
        bench = [make_card("b0", 90.0, slug="b0"), make_card("b1", 90.0, slug="b1")]
        theirs = _side("o", _flat())
        pool = make_pool(starters + bench + theirs)
        s = [c.peak_window_id for c in starters]
        b = [c.peak_window_id for c in bench]
        boss = _opponent([c.peak_window_id for c in theirs], rule_id="top_heavy")
        result = resolve_battle(
            pool, s, b, boss, (), lives_before=3, comeback_credits=0,
        )
        self._reconciles(result)
        for lane in result.lanes:
            assert lane.bench_adjustment < 0.0

    def test_prep_bonus_reconciles_and_is_isolated_from_bench_adjustment(self):
        mine = _side("m", _flat())
        theirs = _side("o", _flat())
        pool = make_pool(mine + theirs)
        boss = _opponent([c.peak_window_id for c in theirs])
        result = resolve_battle(
            pool, [c.peak_window_id for c in mine], [], boss, (),
            lives_before=3, comeback_credits=0, lane_bonuses={TP: 2.5},
        )
        self._reconciles(result)
        for lane in result.lanes:
            if lane.lane == TP:
                assert lane.player_prep_bonus == 2.5
            assert lane.bench_adjustment == 0.0

    def test_deep_rotation_and_prep_bonus_together_still_reconcile(self):
        starters = [make_card(f"s{i}", 40.0, slug=f"s{i}") for i in range(5)]
        bench = [make_card("b0", 90.0, slug="b0"), make_card("b1", 90.0, slug="b1")]
        theirs = _side("o", _flat())
        pool = make_pool(starters + bench + theirs)
        s = [c.peak_window_id for c in starters]
        b = [c.peak_window_id for c in bench]
        boss = _opponent([c.peak_window_id for c in theirs])
        result = resolve_battle(
            pool, s, b, boss, ("deep_rotation",), lives_before=3, comeback_credits=0,
            lane_bonuses={SI: 2.5},
        )
        self._reconciles(result)


class TestRaisedLaneBar:
    """`the_long_series` (v3 Final Boss): four of five lanes to win outright,
    for both teams, and everything short of that falls to the summed margin."""

    def _sides(self, mine_lanes, theirs_lanes):
        mine = _side("m", mine_lanes)
        theirs = _side("o", theirs_lanes)
        return make_pool(mine + theirs), [c.peak_window_id for c in mine], [
            c.peak_window_id for c in theirs
        ]

    def test_three_lanes_no_longer_wins_outright(self):
        pool, mine, theirs = self._sides(
            _flat(**{SI: 60.0, TP: 60.0, REC: 60.0, PO: 10.0, TEAM: 10.0}),
            _flat(**{SI: 50.0, TP: 50.0, REC: 50.0, PO: 90.0, TEAM: 90.0}),
        )
        boss = _opponent(theirs, rule_id="the_long_series", act=5)
        result = resolve_battle(
            pool, mine, [], boss, (), lives_before=3, comeback_credits=0
        )
        assert result.player_lanes_won == 3
        assert result.lanes_to_win == 4
        # Three lanes is short of the bar, so the total margin decides -- and the
        # total is negative here, which is exactly the point of the rule.
        assert result.decided_by == "summed_margin"
        assert result.outcome == "loss"

    def test_four_lanes_still_wins_outright(self):
        pool, mine, theirs = self._sides(
            _flat(**{SI: 60.0, TP: 60.0, REC: 60.0, PO: 60.0, TEAM: 10.0}),
            _flat(**{SI: 50.0, TP: 50.0, REC: 50.0, PO: 50.0, TEAM: 90.0}),
        )
        boss = _opponent(theirs, rule_id="the_long_series", act=5)
        result = resolve_battle(
            pool, mine, [], boss, (), lives_before=3, comeback_credits=0
        )
        assert result.player_lanes_won == 4
        assert result.outcome == "win"
        assert result.decided_by == "lanes"

    def test_the_bar_binds_the_boss_identically(self):
        pool, mine, theirs = self._sides(
            _flat(**{SI: 50.0, TP: 50.0, REC: 50.0, PO: 90.0, TEAM: 90.0}),
            _flat(**{SI: 60.0, TP: 60.0, REC: 60.0, PO: 10.0, TEAM: 10.0}),
        )
        boss = _opponent(theirs, rule_id="the_long_series", act=5)
        result = resolve_battle(
            pool, mine, [], boss, (), lives_before=3, comeback_credits=0
        )
        assert result.opponent_lanes_won == 3
        assert result.decided_by == "summed_margin"
        assert result.outcome == "win"

    def test_the_default_bar_is_recorded_on_every_other_battle(self):
        pool, mine, theirs = self._sides(_flat(), _flat())
        boss = _opponent(theirs, rule_id="the_wall")
        result = resolve_battle(
            pool, mine, [], boss, (), lives_before=3, comeback_credits=0
        )
        assert result.lanes_to_win == LANES_TO_WIN == 3
