"""Boss lineups: curated integrity, difficulty targets, and the generated fallback."""
from __future__ import annotations

import dataclasses

import pytest

from nba_peak.run_the_table import bosses as B
from nba_peak.run_the_table.bosses import (
    CURATED_BOSSES,
    boss_starter_mean,
    boss_within_target,
    generate_themed_boss,
    resolve_bosses,
)
from nba_peak.run_the_table.cards import CardPool
from nba_peak.run_the_table.config import (
    ACTS,
    BENCH_SLOTS,
    BOSS_RULES,
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


class TestGeneratedFallback:
    def test_a_missing_curated_card_forces_the_fallback_for_that_boss_only(self, pool):
        dropped = CURATED_BOSSES[1]["starter_ids"][2]
        subset = _subset_pool(pool, {dropped})
        assert not subset.has(dropped)

        bosses = resolve_bosses(subset)
        assert [b.source for b in bosses] == ["curated", "generated_fallback", "curated"]

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
