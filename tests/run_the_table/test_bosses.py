"""Boss lineups: curated integrity, difficulty targets, and the generated fallback."""
from __future__ import annotations

import dataclasses

import pytest

from nba_peak.run_the_table import bosses as B
from nba_peak.run_the_table.bosses import (
    CURATED_BOSSES,
    boss_reveal_order,
    boss_starter_mean,
    boss_within_target,
    generate_themed_boss,
    resolve_bosses,
    scout_report,
)
from nba_peak.run_the_table.generation import generate_blueprint
from nba_peak.run_the_table.cards import CardPool
from nba_peak.run_the_table.config import (
    ACTS,
    BENCH_SLOTS,
    BOSS_BENCH_WEIGHT,
    BOSS_LANE_MARGIN,
    BOSS_LANES_TO_WIN,
    BOSS_RULES,
    BOSS_RULE_PUBLISHED_THRESHOLDS,
    BOSS_TARGET_STARTER_MEAN,
    BOSS_TARGET_TOLERANCE,
    ROLES,
    STARTER_SLOTS,
)


@pytest.fixture(scope="module")
def fallback_bosses(pool):
    """The full generated-fallback slate, computed once (the search is ~1s)."""
    original = B._curated_is_resolvable
    B._curated_is_resolvable = lambda pool, spec: False
    try:
        return resolve_bosses(pool)
    finally:
        B._curated_is_resolvable = original


def _subset_pool(pool: CardPool, drop_ids: set[str]) -> CardPool:
    """A real CardPool missing specific window ids, to force the fallback path."""
    kept = [c for c in pool.cards if c.peak_window_id not in drop_ids]
    stats = dataclasses.replace(pool.stats, card_count=len(kept))
    return CardPool(kept, stats)


class TestCuratedBosses:
    def test_there_is_exactly_one_curated_boss_per_act(self):
        assert len(CURATED_BOSSES) == ACTS
        assert [spec["act"] for spec in CURATED_BOSSES] == list(range(1, ACTS + 1))
        assert len({spec["boss_id"] for spec in CURATED_BOSSES}) == ACTS

    def test_every_curated_window_id_resolves_in_the_pool(self, pool):
        for spec in CURATED_BOSSES:
            for card_id in list(spec["starter_ids"]) + list(spec["bench_ids"]):
                assert pool.has(card_id), (
                    f"{spec['boss_id']} references '{card_id}', which is not in the "
                    f"{pool.stats.duration_years}Y pool"
                )

    def test_every_starter_is_role_legal_for_its_ordered_slot(self, pool):
        for spec in CURATED_BOSSES:
            assert len(spec["starter_ids"]) == STARTER_SLOTS
            assert len(spec["bench_ids"]) == BENCH_SLOTS
            for role, card_id in zip(ROLES, spec["starter_ids"]):
                card = pool.get(card_id)
                assert card.is_eligible_for(role), (
                    f"{spec['boss_id']}: {card.player_name} cannot play {role} "
                    f"(eligible: {card.eligible_roles})"
                )

    def test_no_curated_boss_repeats_a_player(self, pool):
        for spec in CURATED_BOSSES:
            ids = list(spec["starter_ids"]) + list(spec["bench_ids"])
            slugs = [pool.get(i).player_slug for i in ids]
            assert len(set(slugs)) == len(slugs), f"{spec['boss_id']} repeats a player"
            assert len(set(ids)) == len(ids)

    def test_every_boss_rule_is_declared_in_config(self):
        for spec in CURATED_BOSSES:
            assert spec["rule_id"] in BOSS_RULES
            assert BOSS_RULES[spec["rule_id"]]["summary"]

    def test_each_boss_hits_its_published_difficulty_target(self, pool):
        for idx, boss in enumerate(resolve_bosses(pool)):
            mean = boss_starter_mean(pool, boss)
            target = BOSS_TARGET_STARTER_MEAN[idx]
            assert abs(mean - target) <= BOSS_TARGET_TOLERANCE, (
                f"{boss.boss_id} starter mean {mean:.2f} is outside "
                f"{target} +/- {BOSS_TARGET_TOLERANCE}"
            )
            assert boss_within_target(pool, boss, idx)

    def test_the_bosses_get_harder_act_by_act(self, pool):
        means = [boss_starter_mean(pool, b) for b in resolve_bosses(pool)]
        assert means == sorted(means)
        assert means[-1] - means[0] >= 5.0
        assert len(means) == ACTS == 5

    def test_curated_bosses_are_the_ones_actually_served(self, pool):
        bosses = resolve_bosses(pool)
        assert len(bosses) == ACTS
        assert all(b.source == "curated" for b in bosses)
        assert [b.boss_id for b in bosses] == [s["boss_id"] for s in CURATED_BOSSES]
        assert [b.act for b in bosses] == list(range(1, ACTS + 1))

    def test_resolution_is_deterministic_and_seed_independent(self, pool, blueprints):
        a = resolve_bosses(pool)
        b = resolve_bosses(pool)
        assert [dataclasses.asdict(x) for x in a] == [dataclasses.asdict(x) for x in b]
        for seed in (0, 17, 4242):
            assert [dataclasses.asdict(x) for x in blueprints(seed).bosses] == [
                dataclasses.asdict(x) for x in a
            ]

    def test_every_boss_has_player_facing_copy(self, pool):
        for boss in resolve_bosses(pool):
            assert boss.name and boss.tagline
            assert boss.name != boss.boss_id

    def test_the_last_boss_is_the_final_boss_and_carries_a_published_rule(self, pool):
        """Winning act ACTS is the only way to clear the table (plan §2.2), so
        the run must actually have an act-ACTS boss and it must be ruled."""
        bosses = resolve_bosses(pool)
        final = bosses[-1]
        assert final.act == ACTS == 5
        assert final.boss_id == "the_long_series"
        assert final.rule_id in BOSS_RULES
        # v3's Final Boss rule raises the lane bar rather than the lane margin,
        # so the published-rule check is on BOSS_RULES plus whichever mechanic
        # table the rule actually reads.
        assert final.rule_id in BOSS_LANES_TO_WIN
        assert BOSS_RULES[final.rule_id]["summary"]

    def test_the_boss_rules_are_the_published_progression(self, pool):
        """1 teaches lanes, 2 punishes a thin roster, 3 forces perk/economy
        strategy, 4 demands a decisive margin, 5 is the Final Boss. Asserted as
        an ordered list because the progression is a design contract, not an
        accident of ordering."""
        assert [b.rule_id for b in resolve_bosses(pool)] == [
            "the_wall", "strength_in_numbers", "top_heavy", "the_standard",
            "the_long_series",
        ]

    def test_every_boss_rule_publishes_every_constant_it_applies(self):
        """Same machine-checkable contract as SYSTEM_PUBLISHED_THRESHOLDS: a
        rule may not apply a threshold its summary does not name. v1's
        `the_wall` published a tie-break it never actually performed."""
        assert set(BOSS_RULE_PUBLISHED_THRESHOLDS) == set(BOSS_RULES)
        for rule_id, thresholds in BOSS_RULE_PUBLISHED_THRESHOLDS.items():
            summary = BOSS_RULES[rule_id]["summary"]
            assert thresholds, f"{rule_id} publishes no thresholds"
            for constant, rendering in thresholds.items():
                assert rendering in summary, (
                    f"{rule_id} applies {constant} but its summary does not "
                    f"contain {rendering!r}: {summary!r}"
                )
        # And every constant a rule reads is declared.
        for rule_id in BOSS_LANE_MARGIN:
            assert "BOSS_LANE_MARGIN" in BOSS_RULE_PUBLISHED_THRESHOLDS[rule_id]
        for rule_id in BOSS_BENCH_WEIGHT:
            assert "BOSS_BENCH_WEIGHT" in BOSS_RULE_PUBLISHED_THRESHOLDS[rule_id]
        for rule_id in BOSS_LANES_TO_WIN:
            assert "BOSS_LANES_TO_WIN" in BOSS_RULE_PUBLISHED_THRESHOLDS[rule_id]


class TestGeneratedFallback:
    def test_a_missing_curated_card_forces_the_fallback_for_that_boss_only(self, pool):
        dropped = CURATED_BOSSES[1]["starter_ids"][2]
        subset = _subset_pool(pool, {dropped})
        assert not subset.has(dropped)

        bosses = resolve_bosses(subset)
        expected = ["curated"] * ACTS
        expected[1] = "generated_fallback"
        assert [b.source for b in bosses] == expected

        fallback = bosses[1]
        assert fallback.boss_id == CURATED_BOSSES[1]["boss_id"]
        assert fallback.act == CURATED_BOSSES[1]["act"]
        assert fallback.rule_id == CURATED_BOSSES[1]["rule_id"]
        self._assert_lineup_is_sound(subset, fallback)
        assert dropped not in fallback.starter_ids + fallback.bench_ids

    def test_monkeypatching_resolvability_forces_every_boss_to_the_fallback(
        self, pool, fallback_bosses
    ):
        assert [b.source for b in fallback_bosses] == ["generated_fallback"] * ACTS
        for idx, boss in enumerate(fallback_bosses):
            self._assert_lineup_is_sound(pool, boss)
            assert boss.boss_id == CURATED_BOSSES[idx]["boss_id"]
            assert boss.rule_id == CURATED_BOSSES[idx]["rule_id"]
            assert boss.act == CURATED_BOSSES[idx]["act"]

    def test_the_fallback_lands_near_its_difficulty_target(self, pool, fallback_bosses):
        for idx, boss in enumerate(fallback_bosses):
            mean = boss_starter_mean(pool, boss)
            target = BOSS_TARGET_STARTER_MEAN[idx]
            assert abs(mean - target) <= BOSS_TARGET_TOLERANCE, (
                f"fallback {boss.boss_id} landed at {mean:.2f}, target {target}"
            )

    def test_the_fallback_is_deterministic_and_run_independent(
        self, pool, fallback_bosses, monkeypatch
    ):
        monkeypatch.setattr(B, "_curated_is_resolvable", lambda pool, spec: False)
        again = resolve_bosses(pool)
        assert [dataclasses.asdict(b) for b in again] == [
            dataclasses.asdict(b) for b in fallback_bosses
        ]

    def test_generate_themed_boss_is_a_pure_function_of_its_arguments(self, pool):
        kwargs = dict(
            boss_id="the_wall", act=1, name="The Wall", tagline="t",
            rule_id="the_wall", target_mean=61.0, seed=90_001, attempts=300,
        )
        a = generate_themed_boss(pool, **kwargs)
        b = generate_themed_boss(pool, **kwargs)
        assert dataclasses.asdict(a) == dataclasses.asdict(b)
        assert a.source == "generated_fallback"
        self._assert_lineup_is_sound(pool, a)

    def test_a_different_seed_produces_a_different_fallback(self, pool):
        kwargs = dict(
            boss_id="the_wall", act=1, name="The Wall", tagline="t",
            rule_id="the_wall", target_mean=61.0, attempts=300,
        )
        a = generate_themed_boss(pool, seed=1, **kwargs)
        b = generate_themed_boss(pool, seed=2, **kwargs)
        assert a.starter_ids != b.starter_ids or a.bench_ids != b.bench_ids

    def test_a_pool_too_small_to_field_a_lineup_raises_rather_than_fabricating(self, pool):
        tiny = _subset_pool(
            pool, {c.peak_window_id for c in pool.cards[3:]}
        )
        assert len(tiny) == 3
        with pytest.raises(RuntimeError):
            generate_themed_boss(
                tiny, boss_id="the_wall", act=1, name="n", tagline="t",
                rule_id=None, target_mean=61.0, seed=1, attempts=25,
            )

    @staticmethod
    def _assert_lineup_is_sound(pool, boss):
        assert len(boss.starter_ids) == STARTER_SLOTS
        assert len(boss.bench_ids) == BENCH_SLOTS
        for role, card_id in zip(ROLES, boss.starter_ids):
            assert pool.has(card_id)
            assert pool.get(card_id).is_eligible_for(role), (
                f"{boss.boss_id}: {card_id} cannot play {role}"
            )
        ids = list(boss.starter_ids) + list(boss.bench_ids)
        slugs = [pool.get(i).player_slug for i in ids]
        assert len(set(slugs)) == len(slugs), f"{boss.boss_id} repeats a player"


class TestResolvabilityCheck:
    def test_a_missing_window_id_is_not_resolvable(self, pool):
        spec = dict(CURATED_BOSSES[0])
        spec["starter_ids"] = ("not-a-real-window",) + spec["starter_ids"][1:]
        assert B._curated_is_resolvable(pool, spec) is False

    def test_a_role_illegal_starter_is_not_resolvable(self, pool):
        spec = dict(CURATED_BOSSES[0])
        anchor_card = spec["starter_ids"][4]
        # Put the anchor in the lead_creator slot; if it happens to be eligible
        # for both, find a card that is not.
        ineligible = next(
            c.peak_window_id for c in pool.cards if ROLES[0] not in c.eligible_roles
        )
        spec["starter_ids"] = (ineligible,) + spec["starter_ids"][1:]
        assert anchor_card in CURATED_BOSSES[0]["starter_ids"]
        assert B._curated_is_resolvable(pool, spec) is False

    def test_a_duplicated_player_is_not_resolvable(self, pool):
        spec = dict(CURATED_BOSSES[0])
        spec["bench_ids"] = (spec["starter_ids"][0], spec["bench_ids"][1])
        assert B._curated_is_resolvable(pool, spec) is False

    def test_the_shipped_specs_are_all_resolvable(self, pool):
        for spec in CURATED_BOSSES:
            assert B._curated_is_resolvable(pool, spec) is True


class TestScoutReport:
    """Spec §5A. Everything the report reveals must be reproducible from values
    the player is already shown — scouting buys the work, not private data."""

    def _report(self, pool, act_index=0, systems=()):
        boss = resolve_bosses(pool)[act_index]
        bp = generate_blueprint(1, pool=pool)
        return boss, scout_report(
            pool, boss, bp.starting_starters, bp.starting_bench, systems
        )

    def test_it_names_the_rule_two_strongest_lanes_and_the_weakest(self, pool):
        boss, report = self._report(pool)
        assert report["boss_id"] == boss.boss_id
        assert report["rule_id"] == boss.rule_id
        assert report["rule"]["summary"] == BOSS_RULES[boss.rule_id]["summary"]
        assert len(report["strongest_lanes"]) == 2
        assert report["weakest_lane"] not in report["strongest_lanes"]
        scores = {row["lane"]: row["opponent_score"] for row in report["lanes"]}
        ordered = sorted(scores, key=lambda k: (-scores[k], k))
        assert report["strongest_lanes"] == ordered[:2]
        assert report["weakest_lane"] == ordered[-1]

    def test_the_projection_matches_a_real_battle_resolution(self, pool):
        """The projected matchup must not be a second, looser model of the
        fight — it has to agree with `resolve_battle` on lane counts."""
        from nba_peak.run_the_table.battle import resolve_battle
        from nba_peak.run_the_table.config import BOSS_WIN_CREDITS, COMEBACK_CREDITS

        bp = generate_blueprint(1, pool=pool)
        for boss in resolve_bosses(pool):
            report = scout_report(
                pool, boss, bp.starting_starters, bp.starting_bench, ()
            )
            actual = resolve_battle(
                pool, bp.starting_starters, bp.starting_bench, boss, (),
                lives_before=3, comeback_credits=COMEBACK_CREDITS,
                win_credits=BOSS_WIN_CREDITS,
            )
            assert report["projected_lanes_won"] == actual.player_lanes_won
            assert report["projected_lanes_lost"] == actual.opponent_lanes_won
            assert report["projected_summed_margin"] == actual.summed_margin
            assert report["lanes_to_win"] == actual.lanes_to_win

    def test_every_lane_offers_a_preparation_with_an_honest_flip_flag(self, pool):
        from nba_peak.run_the_table.config import LANE_FIELDS, SCOUT_PREP_LANE_BONUS

        _, report = self._report(pool, act_index=3)
        assert [row["lane"] for row in report["preparations"]] == list(LANE_FIELDS)
        for row in report["preparations"]:
            assert row["bonus"] == SCOUT_PREP_LANE_BONUS
            assert row["margin_after"] == round(row["margin_before"] + row["bonus"], 4)
            lane = next(l for l in report["lanes"] if l["lane"] == row["lane"])
            expected = (
                lane["projected_winner"] != "player"
                and row["margin_after"] > report["lane_margin_threshold"]
            )
            assert row["would_flip"] is expected

    def test_it_is_a_pure_function_of_its_arguments(self, pool):
        assert self._report(pool, 2)[1] == self._report(pool, 2)[1]


class TestBossReveal:
    """Spec §3: a short deterministic reveal before each boss, labelled as seed
    and rule generated rather than built live."""

    def test_the_reveal_is_the_seven_slots_in_the_published_order(self, pool):
        for boss in resolve_bosses(pool):
            rows = boss_reveal_order(pool, boss)
            assert [r["order"] for r in rows] == list(range(STARTER_SLOTS + BENCH_SLOTS))
            assert [r["slot_id"] for r in rows] == list(ROLES) + ["bench_1", "bench_2"]
            assert [r["card_id"] for r in rows] == (
                list(boss.starter_ids) + list(boss.bench_ids)
            )
            assert [r["is_starter"] for r in rows] == [True] * 5 + [False] * 2

    def test_it_is_identical_every_time(self, pool):
        boss = resolve_bosses(pool)[-1]
        assert boss_reveal_order(pool, boss) == boss_reveal_order(pool, boss)
