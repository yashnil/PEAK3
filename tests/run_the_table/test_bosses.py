"""Boss lineups: identity integrity, roster-relative difficulty, rule expression.

WHAT THIS FILE ASSERTS, AND WHY IT CHANGED IN v4
------------------------------------------------
Under v3 the five bosses were CURATED constants, and this file's job was to
prove the constants were still resolvable, still role-legal, and still hit five
absolute prime_score targets. Under v4 the lineups are GENERATED per run
against the roster that will face them, so several of those assertions were
statements about a thing that no longer exists. They were rewritten -- each
rewrite is marked REWRITTEN with the contract it replaced and the contract it
now asserts -- and every one is strictly stronger, because the v4 contract is
strictly stronger:

  * v3 asserted a boss did not repeat a player WITHIN ITSELF. v4 asserts that,
    PLUS no identity shared with the player's roster, PLUS no identity shared
    with any other unbeaten boss. That is the defect this pass exists to fix.
  * v3 asserted five fixed starter means. v4 asserts difficulty RELATIVE to the
    roster -- the quantity that actually decides a fight -- plus the act ramp,
    plus the distribution overlap the ramp is required to have.
"""
from __future__ import annotations

import pytest

from nba_peak.run_the_table.battle import player_lane_profile, roster_total
from nba_peak.run_the_table.bosses import (
    BOSS_SPECS,
    BossGenerationError,
    assert_boss_is_legal,
    boss_lineup_rating,
    boss_reveal_order,
    boss_slugs,
    boss_spec_for_act,
    boss_target_rating,
    generate_boss_for_act,
    scout_report,
)
from nba_peak.run_the_table.config import (
    ACTS,
    BENCH_SLOTS,
    BOSS_ELITE_PERCENTILE,
    BOSS_MAX_ELITE_CARDS,
    BOSS_RULES,
    BOSS_RULE_PUBLISHED_THRESHOLDS,
    BOSS_RULE_TARGET_OFFSET,
    BOSS_TARGET_JITTER,
    boss_combined_target,
    ROLES,
    STARTER_SLOTS,
)
from nba_peak.run_the_table.generation import generate_blueprint
from nba_peak.run_the_table.schemas import Opponent

from .conftest import slate_for_seed


def _roster(pool, seed):
    bp = generate_blueprint(seed, pool=pool)
    return list(bp.starting_starters), list(bp.starting_bench)


def _excl(pool, starters, bench):
    return frozenset(pool.get(c).player_slug for c in starters + bench)


def _boss(pool, seed, act=1, systems=()):
    st, bn = _roster(pool, seed)
    return generate_boss_for_act(pool, seed, act, st, bn, systems, _excl(pool, st, bn))


# ---------------------------------------------------------------------------
class TestBossSpecs:
    def test_there_is_exactly_one_spec_per_act(self):
        assert len(BOSS_SPECS) == ACTS
        assert [spec["act"] for spec in BOSS_SPECS] == list(range(1, ACTS + 1))
        assert len({spec["boss_id"] for spec in BOSS_SPECS}) == ACTS

    def test_every_spec_has_player_facing_copy(self):
        for spec in BOSS_SPECS:
            assert spec["name"].strip()
            assert len(spec["tagline"]) > 20

    def test_every_boss_rule_is_declared_in_config(self):
        for spec in BOSS_SPECS:
            assert spec["rule_id"] in BOSS_RULES

    def test_the_boss_rules_are_the_published_progression(self):
        assert [s["rule_id"] for s in BOSS_SPECS] == [
            "the_wall", "strength_in_numbers", "top_heavy", "the_standard",
            "the_long_series",
        ]

    def test_the_last_spec_is_the_final_boss_and_carries_a_published_rule(self):
        final = BOSS_SPECS[-1]
        assert final["act"] == ACTS
        assert final["boss_id"] == "the_long_series"
        assert final["rule_id"] in BOSS_RULES

    def test_every_boss_rule_publishes_every_constant_it_applies(self):
        """A rule may never apply a threshold it did not publish.

        Unchanged from v3 and deliberately so: this is the contract that caught
        `the_wall` publishing a tie-break it never performed.
        """
        for rule_id, expected in BOSS_RULE_PUBLISHED_THRESHOLDS.items():
            summary = BOSS_RULES[rule_id]["summary"]
            for constant, rendering in expected.items():
                assert rendering in summary, (
                    f"{rule_id} applies {constant} but its published summary "
                    f"does not contain {rendering!r}: {summary!r}"
                )

    def test_an_act_with_no_spec_raises(self):
        with pytest.raises(BossGenerationError):
            boss_spec_for_act(ACTS + 1)


# ---------------------------------------------------------------------------
class TestIdentityIntegrity:
    """THE DEFECT THIS PASS EXISTS TO FIX.

    v3 checked only that a boss did not repeat a player within itself, which is
    why 88.5% of runs could start with a boss's own card on the player's roster
    and nothing failed.
    """

    @pytest.mark.parametrize("seed", [1, 11, 23, 42, 99, 2026])
    def test_no_boss_shares_an_identity_with_the_player_roster(self, pool, seed):
        st, bn = _roster(pool, seed)
        owned = _excl(pool, st, bn)
        exclude = set(owned)
        for act in range(1, ACTS + 1):
            boss = generate_boss_for_act(pool, seed, act, st, bn, (), frozenset(exclude))
            assert not (boss_slugs(pool, boss) & owned), (
                f"seed {seed} act {act}: boss shares "
                f"{boss_slugs(pool, boss) & owned} with the player's roster"
            )
            exclude |= boss_slugs(pool, boss)

    def test_seed_23_no_longer_puts_joakim_noah_on_both_rosters(self, pool):
        """The reported screenshot, pinned as a regression test.

        Seed 23 dealt `joakim-noah-3yr-201314` as the player's anchor while the
        v3 curated act-5 boss fielded the identical card id.
        """
        st, bn = _roster(pool, 23)
        owned = _excl(pool, st, bn)
        assert "joakim-noah" in owned, "seed 23 no longer deals the reported card"
        for boss in slate_for_seed(pool, 23):
            assert "joakim-noah" not in boss_slugs(pool, boss)

    @pytest.mark.parametrize("seed", [3, 17, 250])
    def test_no_two_bosses_in_a_run_share_an_identity(self, pool, seed):
        seen: set[str] = set()
        for boss in slate_for_seed(pool, seed):
            slugs = boss_slugs(pool, boss)
            assert not (slugs & seen), f"seed {seed}: {slugs & seen} on two bosses"
            seen |= slugs

    @pytest.mark.parametrize("seed", [1, 11, 23, 42])
    def test_no_boss_repeats_a_player_within_itself(self, pool, seed):
        for boss in slate_for_seed(pool, seed):
            ids = list(boss.starter_ids) + list(boss.bench_ids)
            slugs = [pool.get(i).player_slug for i in ids]
            assert len(set(slugs)) == len(slugs)

    @pytest.mark.parametrize("seed", [1, 11, 23, 42])
    def test_every_starter_is_role_legal_for_its_ordered_slot(self, pool, seed):
        for boss in slate_for_seed(pool, seed):
            assert len(boss.starter_ids) == STARTER_SLOTS
            assert len(boss.bench_ids) == BENCH_SLOTS
            for role, card_id in zip(ROLES, boss.starter_ids):
                assert role in pool.get(card_id).eligible_roles

    def test_generation_validates_its_own_output_before_returning_it(self, pool):
        st, bn = _roster(pool, 11)
        legal = generate_boss_for_act(pool, 11, 1, st, bn, (), _excl(pool, st, bn))
        # Re-validating the very lineup it produced, against an exclusion set
        # that now contains one of its own players, must raise.
        one = sorted(boss_slugs(pool, legal))[0]
        with pytest.raises(BossGenerationError, match="excluded identity"):
            assert_boss_is_legal(pool, legal, frozenset({one}))


class TestAssertBossIsLegal:
    def test_a_duplicated_player_is_refused(self, pool):
        boss = _boss(pool, 11)
        broken = Opponent(
            **{
                **boss.__dict__,
                "bench_ids": (boss.starter_ids[0], boss.bench_ids[1]),
            }
        )
        with pytest.raises(BossGenerationError, match="same identity twice"):
            assert_boss_is_legal(pool, broken)

    def test_a_card_outside_the_pool_is_refused(self, pool):
        boss = _boss(pool, 11)
        broken = Opponent(
            **{**boss.__dict__, "bench_ids": ("not-a-real-card", boss.bench_ids[1])}
        )
        with pytest.raises(BossGenerationError, match="outside the pool"):
            assert_boss_is_legal(pool, broken)

    def test_a_role_illegal_starter_is_refused(self, pool):
        boss = _boss(pool, 11)
        bad = next(
            c for c in pool.cards
            if "anchor" not in c.eligible_roles
            and c.peak_window_id not in boss.starter_ids
            and c.peak_window_id not in boss.bench_ids
        )
        broken = Opponent(
            **{
                **boss.__dict__,
                "starter_ids": boss.starter_ids[:4] + (bad.peak_window_id,),
            }
        )
        with pytest.raises(BossGenerationError, match="cannot play"):
            assert_boss_is_legal(pool, broken)

    def test_a_wrong_sized_lineup_is_refused(self, pool):
        boss = _boss(pool, 11)
        broken = Opponent(**{**boss.__dict__, "bench_ids": (boss.bench_ids[0],)})
        with pytest.raises(BossGenerationError, match="expected"):
            assert_boss_is_legal(pool, broken)


# ---------------------------------------------------------------------------
class TestDeterminism:
    def test_the_same_seed_roster_and_act_produce_an_identical_boss(self, pool):
        """REWRITTEN. v3's `test_resolution_is_deterministic_and_seed_independent`
        asserted `resolve_bosses(pool) == resolve_bosses(pool)` and, in its
        name, that the slate did NOT depend on the seed at all.

        DESIGN DECISION (approved): seed independence is exactly the property
        removed on purpose. A fixed slate cannot avoid the player's roster and
        cannot be calibrated to it. What replaces it is a STRICTLY STRONGER
        determinism claim -- the lineup is a pure function of (seed, act,
        roster, systems, exclusions), so the same run always faces the same
        opponent -- and it is persisted on the run state, so a refresh cannot
        re-roll it either.
        """
        st, bn = _roster(pool, 11)
        ex = _excl(pool, st, bn)
        a = generate_boss_for_act(pool, 11, 3, st, bn, (), ex)
        b = generate_boss_for_act(pool, 11, 3, st, bn, (), ex)
        assert a == b

    def test_different_seeds_produce_genuinely_different_bosses(self, pool):
        """REWRITTEN. v3's `test_curated_bosses_are_the_ones_actually_served`
        asserted every boss's `source` was "curated" and that the five ids
        matched the constant table.

        DESIGN DECISION (approved): there is no curated table any more. The ids
        and rules are still fixed by the ruleset (TestBossSpecs asserts that);
        what this asserts instead is the property the rewrite was FOR -- that
        the lineups genuinely vary by run, which a curated slate could never do.
        """
        slates = {
            seed: tuple(
                tuple(b.starter_ids) + tuple(b.bench_ids)
                for b in slate_for_seed(pool, seed)
            )
            for seed in (1, 11, 23, 42, 99, 250)
        }
        assert len(set(slates.values())) == len(slates), "seeds produced identical slates"
        for boss in slate_for_seed(pool, 11):
            assert boss.source == "generated"

    def test_a_different_roster_produces_a_different_boss(self, pool):
        """The whole point of roster-relative: the opponent tracks the roster."""
        st_a, bn_a = _roster(pool, 11)
        st_b, bn_b = _roster(pool, 12)
        a = generate_boss_for_act(pool, 11, 3, st_a, bn_a, (), _excl(pool, st_a, bn_a))
        b = generate_boss_for_act(pool, 11, 3, st_b, bn_b, (), _excl(pool, st_b, bn_b))
        assert a.starter_ids != b.starter_ids

    def test_the_jitter_is_a_pure_function_of_seed_and_act(self):
        a = [boss_target_rating(20.0, act, "the_wall", 7) for act in range(1, ACTS + 1)]
        b = [boss_target_rating(20.0, act, "the_wall", 7) for act in range(1, ACTS + 1)]
        assert a == b
        assert boss_target_rating(20.0, 1, "the_wall", 7) != boss_target_rating(
            20.0, 1, "the_wall", 8
        )


# ---------------------------------------------------------------------------
class TestDifficulty:
    """REWRITTEN AS A GROUP. v3's `test_each_boss_hits_its_published_difficulty_
    target` and `test_the_bosses_get_harder_act_by_act` asserted five ABSOLUTE
    prime_score starter means (61.0/65.0/70.0/74.5/76.5 +/- 2.5).

    DESIGN DECISION (approved): an absolute target IS the defect. It cannot be
    fair to a roster it has never seen, and measured over 100k seeds it produced
    a 97-99% act-1 win rate and a 0.2-35% act-5 win rate. The replacement
    asserts the quantity that actually decides a fight -- the boss's lineup
    rating RELATIVE to the roster it faces -- which is strictly stronger,
    because it constrains the matchup rather than one side of it.
    """

    SEEDS = [1, 5, 11, 23, 42, 99, 250, 777, 1234, 4242, 8080, 31337]

    def _deltas(self, pool, seed):
        """Boss rating minus player rating, per act."""
        st, bn = _roster(pool, seed)
        exclude = set(_excl(pool, st, bn))
        out = []
        for act in range(1, ACTS + 1):
            boss = generate_boss_for_act(pool, seed, act, st, bn, (), frozenset(exclude))
            player = roster_total(player_lane_profile(pool, st, bn, (), boss.rule_id))
            out.append(boss_lineup_rating(pool, boss) - player)
            exclude |= boss_slugs(pool, boss)
        return out

    def _targets(self):
        """The published combined target per act -- act ramp plus rule offset.

        Neither half is meaningful alone: `BOSS_RELATIVE_TARGET` is not
        monotonic on its own and is not supposed to be, because the rule
        correction absorbs the fact that two rules at an identical delta do not
        produce an identical win rate. Their SUM is the published difficulty and
        the thing that must rise act over act.
        """
        return [
            boss_combined_target(act, boss_spec_for_act(act)["rule_id"])
            for act in range(1, ACTS + 1)
        ]

    def test_each_boss_lands_near_its_roster_relative_target(self, pool):
        targets = self._targets()
        for seed in self.SEEDS:
            for act, delta in enumerate(self._deltas(pool, seed), start=1):
                intended = targets[act - 1]
                assert abs(delta - intended) <= BOSS_TARGET_JITTER + 1.6, (
                    f"seed {seed} act {act}: delta {delta:.2f} vs intended "
                    f"{intended:.2f}"
                )

    def test_the_published_targets_rise_act_over_act(self):
        targets = self._targets()
        assert targets == sorted(targets), f"targets are not monotonic: {targets}"

    def test_difficulty_rises_across_the_acts_in_aggregate(self, pool):
        """Act 5 must be hardest ON AVERAGE.

        Asserted as "no act is materially easier than the one before, and act 5
        is clearly harder than act 1" rather than as strict monotonicity of the
        measured delta -- because strict monotonicity of the DELTA is not the
        contract and asserting it would be asserting noise.

        Acts 3 and 4 have near-identical combined targets (2.19 and 2.21) and
        genuinely different difficulty: the separation between them is carried
        by their RULES (`top_heavy` +0.91 against `the_standard` -0.77), which
        is exactly what BOSS_RULE_TARGET_OFFSET exists to express. Their
        measured deltas are therefore supposed to be about equal while their win
        rates are not -- act 3 lands at 0.386 and act 4 at 0.334 in the balance
        audit. Monotonicity of the published TARGETS is asserted separately, and
        monotonicity of the realised WIN RATES is the audit's job.
        """
        per_act = list(zip(*[self._deltas(pool, s) for s in self.SEEDS]))
        means = [sum(col) / len(col) for col in per_act]
        for i in range(len(means) - 1):
            assert means[i + 1] >= means[i] - 0.30, (
                f"act {i + 2} is materially easier than act {i + 1}: {means}"
            )
        assert means[-1] > means[0] + 1.0, "act 5 is not meaningfully harder than act 1"

    def test_the_act_distributions_overlap(self, pool):
        """REQUIRED, not incidental: an individual late boss may be harder than
        an individual later one. Five disjoint tiers is the v3 failure mode, and
        overlap is what BOSS_TARGET_JITTER exists to create.
        """
        per_act = list(zip(*[self._deltas(pool, s) for s in self.SEEDS]))
        for earlier in range(ACTS - 1):
            assert max(per_act[earlier]) > min(per_act[earlier + 1]), (
                f"no act-{earlier + 1} boss is harder than any "
                f"act-{earlier + 2} boss; those two bands are disjoint"
            )

    def test_no_act_is_a_walkover_or_unwinnable_by_construction(self, pool):
        """Every boss must be within reach of the roster it faces.

        Expressed on the rating scale rather than as a win rate (that is the
        balance audit's job): measured sensitivity is ~12.6 points of win rate
        per point of rating.

        The band is asymmetric and the upper bound is generous ON PURPOSE. This
        harness fights ALL FIVE acts with the opening roster, which is the
        worst case no real run experiences -- a real act-5 fight happens after
        four acts of upgrades, and the opponent only tracks 90% of that gain
        (BOSS_ROSTER_TRACKING), so the realised act-5 delta for a played run is
        far lower. +4.5 here is about 8% win rate for a roster that has done
        nothing at all for five acts, which is a loss it earned, not an
        unwinnable fight.
        """
        for seed in self.SEEDS:
            for act, delta in enumerate(self._deltas(pool, seed), start=1):
                assert -3.0 <= delta <= 4.5, (
                    f"seed {seed} act {act}: delta {delta:.2f} is outside the "
                    f"playable band"
                )

    def test_difficulty_is_not_driven_by_stacking_elite_cards(self, pool):
        for seed in self.SEEDS[:4]:
            for boss in slate_for_seed(pool, seed):
                elite = sum(
                    1 for cid in list(boss.starter_ids) + list(boss.bench_ids)
                    if pool.get(cid).overall_percentile >= BOSS_ELITE_PERCENTILE
                )
                assert elite <= BOSS_MAX_ELITE_CARDS, (
                    f"seed {seed} {boss.boss_id} fields {elite} top-decile cards"
                )


class TestRuleExpression:
    """A boss must express its rule, not merely carry it as a label."""

    def test_the_bench_rules_produce_opposite_bench_shapes(self, pool):
        """`strength_in_numbers` weights the bench at 0.65 and `top_heavy` at
        0.15, so the lineups built for them must differ in the direction their
        rule rewards -- otherwise the rule is decoration."""
        import statistics

        from nba_peak.run_the_table.config import LANE_FIELDS

        def bench_gap(boss):
            def mean(ids):
                return statistics.mean(
                    statistics.mean(pool.get(i).lane_index[lane] for lane in LANE_FIELDS)
                    for i in ids
                )

            return mean(boss.bench_ids) - mean(boss.starter_ids)

        depth_gaps, heavy_gaps = [], []
        for seed in (1, 11, 23, 42, 99, 250, 777, 1234):
            slate = slate_for_seed(pool, seed)
            depth_gaps.append(bench_gap(slate[1]))   # strength_in_numbers
            heavy_gaps.append(bench_gap(slate[2]))   # top_heavy
        assert sum(depth_gaps) / len(depth_gaps) > sum(heavy_gaps) / len(heavy_gaps), (
            "Strength in Numbers does not field a deeper bench than Top Heavy"
        )

    def test_the_rule_changes_the_target_it_is_calibrated_to(self):
        """Rules are not equally hard at equal delta, so each carries its own
        published offset. If they were all zero the act band would mean five
        different things depending on which boss occupied it."""
        assert set(BOSS_RULE_TARGET_OFFSET) == {s["rule_id"] for s in BOSS_SPECS}
        assert len(set(BOSS_RULE_TARGET_OFFSET.values())) > 1
        assert boss_target_rating(20.0, 1, "top_heavy", 5) != boss_target_rating(
            20.0, 1, "the_standard", 5
        )
        assert boss_combined_target(1, "top_heavy") != boss_combined_target(
            1, "the_standard"
        )


# ---------------------------------------------------------------------------
class TestScoutReport:
    """Spec §5A. Everything the report reveals must be reproducible from values
    the player is already shown — scouting buys the work, not private data."""

    def _report(self, pool, act_index=0, systems=()):
        boss = slate_for_seed(pool, 1)[act_index]
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
        for boss in slate_for_seed(pool, 1):
            report = scout_report(pool, boss, bp.starting_starters, bp.starting_bench, ())
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

    def test_it_publishes_both_lineup_ratings(self, pool):
        """v4 addition: the boss is built to a target expressed in the lineup
        rating, so the report has to state that quantity for both sides."""
        boss, report = self._report(pool, 2)
        assert report["opponent_lineup_rating"] == boss_lineup_rating(pool, boss)
        assert isinstance(report["player_lineup_rating"], float)

    def test_it_is_a_pure_function_of_its_arguments(self, pool):
        assert self._report(pool, 2)[1] == self._report(pool, 2)[1]


class TestBossReveal:
    """Spec §3: a short deterministic reveal before each boss, labelled as seed
    and roster generated rather than built live."""

    def test_the_reveal_is_the_seven_slots_in_the_published_order(self, pool):
        for boss in slate_for_seed(pool, 1):
            rows = boss_reveal_order(pool, boss)
            assert [r["order"] for r in rows] == list(range(STARTER_SLOTS + BENCH_SLOTS))
            assert [r["slot_id"] for r in rows] == list(ROLES) + ["bench_1", "bench_2"]
            assert [r["card_id"] for r in rows] == (
                list(boss.starter_ids) + list(boss.bench_ids)
            )
            assert [r["is_starter"] for r in rows] == [True] * 5 + [False] * 2

    def test_it_is_identical_every_time(self, pool):
        boss = slate_for_seed(pool, 1)[-1]
        assert boss_reveal_order(pool, boss) == boss_reveal_order(pool, boss)


class TestPoolExhaustion:
    def test_a_pool_too_small_to_field_a_lineup_raises_rather_than_fabricating(
        self, pool
    ):
        st, bn = _roster(pool, 11)
        keep = {c.player_slug for c in pool.cards[:4]}
        exclude = frozenset(
            c.player_slug for c in pool.cards if c.player_slug not in keep
        )
        with pytest.raises(BossGenerationError):
            generate_boss_for_act(pool, 11, 1, st, bn, (), exclude)
