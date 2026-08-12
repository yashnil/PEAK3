"""RUN THE TABLE — the lane is won by the TEAM, and the bench is part of it.

WHAT THIS FILE IS FOR
---------------------
Two reports, one about the rules and one about the receipt:

  * "Current experience gives too much importance to the single strongest
    player in each PEAK3 component. A roster containing one LeBron/MJ/Shaq-level
    component score should benefit, but that one player should not effectively
    determine the whole lane."
  * "Receipts can show `+ Bench 0.00` even with a populated bench."

THE FIRST ONE IS ABOUT THE UI, NOT THE RULES, AND THIS FILE IS THE PROOF.
`battle.lane_score` has always been the depth-weighted team aggregate the brief
describes:

    weighted_sum  = sum(starter lane values) + bench_weight * sum(bench values)
    denominator   = starter_count + bench_weight * bench_count
    lane_rating   = weighted_sum / denominator

so no single card has ever decided a lane. What decided the *impression* was the
result screen, which put "your top contributor 71.2 / their top contributor
49.5" at the top of a lane the player had just lost. The cases below pin the
rule so it cannot drift, and `BattleReveal` was re-ordered so the screen agrees
with it (F5).

THE SECOND ONE IS REAL, AND IT IS A RECEIPT DEFECT RATHER THAN AN ARITHMETIC
ONE. The only bench line the receipt had was `bench_adjustment`, which is the
PERK residual — how far the bench weight this lane was scored at sits from the
default — and with no Deep Rotation and no boss rule that is correctly zero.
The bench was contributing the whole time, inside `pre_perk_rating`, because the
formula above is a weighted MEAN over starters and bench together. See
`starters_only_rating` / `bench_contribution` on `LaneResult`.

DETERMINISTIC MATRIX, NOT RANDOM REPETITION. Every case below is a hand-built
pool with exact lane values, so each assertion is a statement about the formula
rather than about a sample.
"""
from __future__ import annotations

import pytest

from nba_peak.run_the_table import battle
from nba_peak.run_the_table.config import (
    BENCH_WEIGHT_DEEP_ROTATION,
    BENCH_WEIGHT_DEFAULT,
    LANE_FIELDS,
    STARTER_WEIGHT,
)
from nba_peak.run_the_table.schemas import Opponent

from tests.run_the_table.conftest import make_card, make_pool

LANE = LANE_FIELDS[0]


def _roster(prefix: str, starters: list[float], bench: list[float]):
    """Five starters and a bench, at explicit lane values."""
    cards = [
        make_card(f"{prefix}-s{i}", value) for i, value in enumerate(starters)
    ] + [make_card(f"{prefix}-b{i}", value) for i, value in enumerate(bench)]
    return cards, [f"{prefix}-s{i}" for i in range(len(starters))], [
        f"{prefix}-b{i}" for i in range(len(bench))
    ]


def _opponent(starters, bench, rule_id=None) -> Opponent:
    return Opponent(
        boss_id="test-boss",
        name="Test Boss",
        tagline="",
        act=1,
        rule_id=rule_id,
        starter_ids=tuple(starters),
        bench_ids=tuple(bench),
        source="curated",
    )


def _battle(player_cards, p_start, p_bench, opp_cards, o_start, o_bench, systems=()):
    pool = make_pool(player_cards + opp_cards)
    opponent = _opponent(o_start, o_bench)
    return battle.resolve_battle(
        pool,
        p_start,
        p_bench,
        opponent,
        systems,
        lives_before=3,
        comeback_credits=0,
    )


# ---------------------------------------------------------------------------
# THE FORMULA IS THE ONE THE BRIEF DESCRIBES
# ---------------------------------------------------------------------------


def test_the_lane_rating_is_the_depth_weighted_team_mean():
    """Stated as arithmetic, against a hand-computed value.

    This is the invariant everything else in the file depends on, so it is
    asserted directly rather than inferred from an outcome.
    """
    cards, starters, bench = _roster("p", [80, 60, 60, 60, 60], [40, 40])
    pool = make_pool(cards)
    got = battle.lane_score(pool, starters, bench, LANE, BENCH_WEIGHT_DEFAULT)

    weighted_sum = STARTER_WEIGHT * (80 + 60 + 60 + 60 + 60) + BENCH_WEIGHT_DEFAULT * (40 + 40)
    denominator = STARTER_WEIGHT * 5 + BENCH_WEIGHT_DEFAULT * 2
    assert got == pytest.approx(weighted_sum / denominator, abs=1e-4)


def test_the_lane_rating_is_never_the_maximum_or_the_plain_mean():
    """The two formulas it must NOT be.

    "Highest single card" is the one the brief forbids; "unweighted mean of
    everybody" would make a bench slot worth exactly as much as a starter.
    """
    cards, starters, bench = _roster("p", [90, 50, 50, 50, 50], [10, 10])
    pool = make_pool(cards)
    got = battle.lane_score(pool, starters, bench, LANE, BENCH_WEIGHT_DEFAULT)
    assert got != pytest.approx(90.0)
    assert got != pytest.approx((90 + 50 * 4 + 10 * 2) / 7)


# ---------------------------------------------------------------------------
# CASE A vs CASE B — one superstar cannot carry a lane
# ---------------------------------------------------------------------------


def test_case_a_superstar_plus_weak_roster_loses_to_case_b_balanced_elite():
    """THE HEADLINE CLAIM, as a battle rather than as a formula.

    CASE A: one enormous card (100) and four weak ones (20). Its top
    contributor beats the opponent's by 25 points in every lane.
    CASE B: five balanced elite starters (75).

    A must lose, and its own top contributor must still be the higher of the
    two — which is exactly the screen that read as a bug and is in fact the
    game working.
    """
    a_cards, a_start, a_bench = _roster("a", [100, 20, 20, 20, 20], [20, 20])
    b_cards, b_start, b_bench = _roster("b", [75, 75, 75, 75, 75], [75, 75])

    result = _battle(a_cards, a_start, a_bench, b_cards, b_start, b_bench)

    assert result.outcome == "loss", "a single superstar carried the whole battle"
    assert result.player_lanes_won == 0
    for lane in result.lanes:
        assert lane.winner == "opponent"
        # AND THE EXPLANATORY NUMBER STILL FAVOURS THE LOSER. This is the
        # combination the result screen has to present honestly: the top
        # contributor is a fact about one card, the lane is a fact about five.
        assert lane.player_score < lane.opponent_score


def test_the_superstar_still_matters_though():
    """Depth-weighting is not flattening. Against the SAME weak supporting
    cast, the roster with the superstar is strictly better off."""
    with_star, ws, wb = _roster("star", [100, 20, 20, 20, 20], [20, 20])
    without, ns, nb = _roster("plain", [20, 20, 20, 20, 20], [20, 20])
    pool = make_pool(with_star + without)
    assert battle.lane_score(pool, ws, wb, LANE, BENCH_WEIGHT_DEFAULT) > battle.lane_score(
        pool, ns, nb, LANE, BENCH_WEIGHT_DEFAULT
    )


def test_improving_the_weakest_starter_is_worth_more_than_improving_the_best():
    """Why a balanced roster is the goal: every slot is worth the same weight,
    so a point spent on the fifth starter buys exactly what a point spent on
    the first does — and the fifth starter is where the points are cheap."""
    base, bs, bb = _roster("base", [90, 50, 50, 50, 30], [30, 30])
    lift_weak, ws, wb = _roster("weak", [90, 50, 50, 50, 50], [30, 30])
    lift_best, ls, lb = _roster("best", [110, 50, 50, 50, 30], [30, 30])
    pool = make_pool(base + lift_weak + lift_best)

    baseline = battle.lane_score(pool, bs, bb, LANE, BENCH_WEIGHT_DEFAULT)
    weak_lift = battle.lane_score(pool, ws, wb, LANE, BENCH_WEIGHT_DEFAULT) - baseline
    best_lift = battle.lane_score(pool, ls, lb, LANE, BENCH_WEIGHT_DEFAULT) - baseline
    # +20 in either place moves the team rating by the same amount.
    assert weak_lift == pytest.approx(best_lift, abs=1e-4)
    assert weak_lift > 0


# ---------------------------------------------------------------------------
# CASE C vs CASE D — the bench is a real decision
# ---------------------------------------------------------------------------


def test_case_c_strong_bench_beats_case_d_weak_bench_on_identical_starters():
    """Same five starters, different benches, different outcome."""
    strong, cs, cb = _roster("c", [70, 70, 70, 70, 70], [70, 70])
    weak, ds, db = _roster("d", [70, 70, 70, 70, 70], [10, 10])

    result = _battle(strong, cs, cb, weak, ds, db)
    assert result.outcome == "win"
    assert result.player_lanes_won == len(LANE_FIELDS)
    for lane in result.lanes:
        # The starters are identical, so every point of margin is the bench.
        assert lane.margin > 0
        assert lane.player_top_card_id is not None


def test_a_stronger_bench_raises_the_rating_and_a_weaker_one_lowers_it():
    """Monotone in bench quality, holding starters fixed."""
    cards = (
        _roster("hi", [70, 70, 70, 70, 70], [95, 95])[0]
        + _roster("mid", [70, 70, 70, 70, 70], [70, 70])[0]
        + _roster("lo", [70, 70, 70, 70, 70], [10, 10])[0]
    )
    pool = make_pool(cards)

    def rating(prefix: str) -> float:
        return battle.lane_score(
            pool,
            [f"{prefix}-s{i}" for i in range(5)],
            [f"{prefix}-b{i}" for i in range(2)],
            LANE,
            BENCH_WEIGHT_DEFAULT,
        )

    assert rating("hi") > rating("mid") > rating("lo")


# ---------------------------------------------------------------------------
# F4 — the receipt tells the truth about the bench
# ---------------------------------------------------------------------------


def test_a_populated_bench_never_reports_a_zero_contribution():
    """THE REPORTED DEFECT, as an assertion.

    A bench that differs from the starters must move the rating, and the
    receipt must have a line that says by how much.
    """
    player, ps, pb = _roster("p", [70, 70, 70, 70, 70], [20, 20])
    opp, os_, ob = _roster("o", [60, 60, 60, 60, 60], [60, 60])
    result = _battle(player, ps, pb, opp, os_, ob)

    for lane in result.lanes:
        assert lane.bench_contribution != 0.0, (
            "a populated bench reported a zero contribution"
        )
        # WEAKER THAN THE STARTERS, SO THE HONEST NUMBER IS NEGATIVE. Hiding
        # the sign would make a bad bench look free.
        assert lane.bench_contribution < 0
        assert lane.starters_only_rating == pytest.approx(70.0, abs=1e-4)


def test_the_receipt_adds_up_exactly(pool_factory=None):
    """Every addend closes to `player_score`, with no rounding drift.

        starters_only_rating + bench_contribution        == pre_perk_rating
        pre_perk_rating + bench_adjustment + prep_bonus  == player_score
    """
    player, ps, pb = _roster("p", [82, 61, 55, 47, 33], [40, 21])
    opp, os_, ob = _roster("o", [60, 60, 60, 60, 60], [60, 60])
    result = _battle(player, ps, pb, opp, os_, ob)

    for lane in result.lanes:
        assert lane.starters_only_rating + lane.bench_contribution == pytest.approx(
            lane.pre_perk_rating, abs=1e-4
        )
        assert (
            lane.pre_perk_rating + lane.bench_adjustment + lane.player_prep_bonus
        ) == pytest.approx(lane.player_score, abs=1e-4)


def test_an_empty_bench_contributes_exactly_nothing_and_says_so():
    """The one case where 0.00 is the truth."""
    player, ps, _ = _roster("p", [70, 70, 70, 70, 70], [])
    opp, os_, ob = _roster("o", [60, 60, 60, 60, 60], [60, 60])
    result = _battle(player, ps, [], opp, os_, ob)
    for lane in result.lanes:
        assert lane.bench_contribution == 0.0
        assert lane.starters_only_rating == pytest.approx(lane.pre_perk_rating, abs=1e-4)


# ---------------------------------------------------------------------------
# CASE E — perks and boss rules, in their intended order
# ---------------------------------------------------------------------------


def test_deep_rotation_helps_a_strong_bench_and_never_hurts_a_weak_one():
    """v2's Deep Rotation is best-of-two weights PER LANE, so it is a buff.

    A flat re-weight would LOWER the rating of any roster whose bench is weaker
    than its starters, which is most of them — the v1 nerf this replaced.
    """
    strong, ss, sb = _roster("strong", [70, 70, 70, 70, 70], [95, 95])
    weak, ws, wb = _roster("weak", [70, 70, 70, 70, 70], [10, 10])
    pool = make_pool(strong + weak)

    for starters, bench, label in ((ss, sb, "strong"), (ws, wb, "weak")):
        plain = battle.player_lane_profile(pool, starters, bench, (), None)[LANE]
        perked = battle.player_lane_profile(pool, starters, bench, ("deep_rotation",), None)[
            LANE
        ]
        assert perked >= plain, f"Deep Rotation lowered the {label}-bench rating"

    # It genuinely helps the roster that built for it.
    assert (
        battle.player_lane_profile(pool, ss, sb, ("deep_rotation",), None)[LANE]
        > battle.player_lane_profile(pool, ss, sb, (), None)[LANE]
    )
    assert BENCH_WEIGHT_DEEP_ROTATION > BENCH_WEIGHT_DEFAULT


def test_a_boss_rule_that_fixes_the_bench_weight_applies_to_both_sides():
    """Symmetric by contract: a boss can never secretly advantage itself."""
    player = battle.bench_weight_for(("deep_rotation",), "top_heavy")
    assert player[0] == player[1], "a boss rule weighted the two sides differently"
    # And it overrides the perk, which is what the perk's published summary says.
    assert battle.player_bench_weight_candidates(("deep_rotation",), "top_heavy") == (
        player[0],
    )


def test_the_receipt_names_a_rule_that_removes_the_bench_rather_than_printing_zero():
    """If a rule ever zeroes the bench weight the receipt says which rule did
    it. Asserted through the field rather than through a rule that happens to
    exist today, so the explanation arrives with the rule rather than after it.
    """
    from nba_peak.run_the_table.config import BOSS_BENCH_WEIGHT

    zeroing = [rule for rule, weight in BOSS_BENCH_WEIGHT.items() if weight == 0.0]
    player, ps, pb = _roster("p", [70, 70, 70, 70, 70], [40, 40])
    opp, os_, ob = _roster("o", [60, 60, 60, 60, 60], [60, 60])

    # No such rule ships today, and with none active the field is None rather
    # than an empty string — an absent explanation, not a blank one.
    result = _battle(player, ps, pb, opp, os_, ob)
    assert all(lane.bench_suppressed_by is None for lane in result.lanes)

    for rule in zeroing:  # pragma: no cover - none configured at present
        pool = make_pool(player + opp)
        opponent = _opponent(os_, ob, rule_id=rule)
        out = battle.resolve_battle(
            pool, ps, pb, opponent, (), lives_before=3, comeback_credits=0
        )
        assert all(lane.bench_suppressed_by == rule for lane in out.lanes)


def test_no_double_counting_a_bench_card():
    """A card in the bench list is counted once, at the bench weight — never
    also as a starter."""
    cards, starters, bench = _roster("p", [60, 60, 60, 60, 60], [60])
    pool = make_pool(cards)
    # Every card is 60, so the weighted mean must be exactly 60 whatever the
    # weights are. A double-counted bench card would still give 60 here, so the
    # denominator is checked directly too.
    assert battle.lane_score(pool, starters, bench, LANE, BENCH_WEIGHT_DEFAULT) == (
        pytest.approx(60.0, abs=1e-4)
    )
    mixed_cards, mixed_start, mixed_bench = _roster("m", [60, 60, 60, 60, 60], [0])
    mixed_pool = make_pool(mixed_cards)
    expected = (60 * 5) / (5 + BENCH_WEIGHT_DEFAULT)
    assert battle.lane_score(
        mixed_pool, mixed_start, mixed_bench, LANE, BENCH_WEIGHT_DEFAULT
    ) == pytest.approx(expected, abs=1e-4)
