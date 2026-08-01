"""Pure-stat battle resolution for RUN THE TABLE.

A battle is a deterministic comparison of two rosters across the five
canonical PEAK3 component lanes. There is no simulation of possessions, no
randomness, no fit/chemistry/era/fame adjustment, and no model inference. The
same two rosters under the same rule always produce the same result.
"""
from __future__ import annotations

from typing import Optional, Sequence

from nba_peak.run_the_table.cards import CardPool
from nba_peak.run_the_table.config import (
    BENCH_WEIGHT_DEEP_ROTATION,
    BENCH_WEIGHT_DEFAULT,
    BOSS_BENCH_WEIGHT,
    BOSS_LANE_MARGIN,
    LANE_EPSILON,
    LANE_FIELDS,
    LANE_LABELS,
    LANE_PEAK3_WEIGHTS,
    LANE_ROUNDING,
    LANES_TO_WIN,
    STARTER_WEIGHT,
)
from nba_peak.run_the_table.schemas import BattleResult, LaneResult, Opponent


def bench_weight_for(systems: Sequence[str], boss_rule_id: Optional[str]) -> tuple[float, float]:
    """Return ``(player_bench_weight, opponent_bench_weight)``.

    Boss rules are symmetric by contract: they set the same weight for both
    sides and override any System, so a boss can never secretly advantage
    itself. Deep Rotation only applies when no boss rule has fixed the weight.

    The player value is the HIGHEST weight Deep Rotation may use; under v2 the
    perk takes the better of the two per lane (see
    :func:`player_bench_weight_candidates`), so this is the headline weight the
    UI reports rather than the single weight every lane was scored at.
    """
    fixed = BOSS_BENCH_WEIGHT.get(boss_rule_id) if boss_rule_id else None
    if fixed is not None:
        return fixed, fixed
    player = (
        BENCH_WEIGHT_DEEP_ROTATION
        if "deep_rotation" in systems
        else BENCH_WEIGHT_DEFAULT
    )
    return player, BENCH_WEIGHT_DEFAULT


def player_bench_weight_candidates(
    systems: Sequence[str], boss_rule_id: Optional[str]
) -> tuple[float, ...]:
    """Every bench weight the player's side is scored at, best-of per lane.

    One value normally. Two under Deep Rotation, because v2's Deep Rotation is
    "the better of the two weights, per lane" rather than a flat re-weight —
    ``lane_score`` is a weighted mean, so a flat re-weight LOWERS the score of
    any roster whose bench is weaker than its starters, which is the default.

    A boss rule that fixes the bench weight for both teams collapses this back
    to exactly one value, which is why the perk's published summary says so.
    """
    fixed = BOSS_BENCH_WEIGHT.get(boss_rule_id) if boss_rule_id else None
    if fixed is not None:
        return (fixed,)
    if "deep_rotation" in systems:
        return (BENCH_WEIGHT_DEFAULT, BENCH_WEIGHT_DEEP_ROTATION)
    return (BENCH_WEIGHT_DEFAULT,)


def lane_margin_threshold(boss_rule_id: Optional[str]) -> float:
    """How far apart two lane scores must be before either side takes the lane.

    ``LANE_EPSILON`` normally — it only guards float representation. A boss
    whose published rule raises the band returns that band instead, applied to
    ``|margin|`` so it removes lanes from both teams identically.
    """
    band = BOSS_LANE_MARGIN.get(boss_rule_id, 0.0) if boss_rule_id else 0.0
    return max(LANE_EPSILON, band)


def lane_score(
    pool: CardPool,
    starter_ids: Sequence[str],
    bench_ids: Sequence[str],
    lane: str,
    bench_weight: float,
) -> float:
    """Weighted mean of one lane across a roster.

    Uses ``lane_index`` — the canonical component contribution rescaled to
    0-100 across the eligible pool — so the five lanes are on a comparable
    scale. The rescale is linear and monotonic, so it never changes which
    roster is better in a lane; it only makes the five lanes readable side by
    side. (Raw contributions are pre-weighted by the official PEAK3 weights, so
    ``team_achievement`` spans 0-3 while ``statistical_impact`` spans ~13-37.)
    """
    total = 0.0
    weight = 0.0
    for cid in starter_ids:
        total += STARTER_WEIGHT * pool.get(cid).lane_index[lane]
        weight += STARTER_WEIGHT
    for cid in bench_ids:
        total += bench_weight * pool.get(cid).lane_index[lane]
        weight += bench_weight
    if weight <= 0:
        return 0.0
    return round(total / weight, LANE_ROUNDING)


def roster_lane_profile(
    pool: CardPool,
    starter_ids: Sequence[str],
    bench_ids: Sequence[str],
    bench_weight: float = BENCH_WEIGHT_DEFAULT,
) -> dict[str, float]:
    return {
        lane: lane_score(pool, starter_ids, bench_ids, lane, bench_weight)
        for lane in LANE_FIELDS
    }


def best_lane_score(
    pool: CardPool,
    starter_ids: Sequence[str],
    bench_ids: Sequence[str],
    lane: str,
    bench_weights: Sequence[float],
) -> float:
    """The best of several bench weightings for one lane.

    With a single weight this is exactly :func:`lane_score`. With two (Deep
    Rotation) it is the better of them, which is the whole of that perk's
    mechanic and the reason it is a buff rather than the v1 nerf.
    """
    return max(
        lane_score(pool, starter_ids, bench_ids, lane, w) for w in bench_weights
    )


def player_lane_profile(
    pool: CardPool,
    starter_ids: Sequence[str],
    bench_ids: Sequence[str],
    systems: Sequence[str] = (),
    boss_rule_id: Optional[str] = None,
) -> dict[str, float]:
    """The player's five lane scores under their Systems and the active rule.

    This — not :func:`roster_lane_profile` — is what the player is scored at,
    and therefore what the UI must display, so that the number on the roster
    screen is the number the battle uses.
    """
    weights = player_bench_weight_candidates(systems, boss_rule_id)
    return {
        lane: best_lane_score(pool, starter_ids, bench_ids, lane, weights)
        for lane in LANE_FIELDS
    }


def roster_total(profile: dict[str, float]) -> float:
    """Overall roster strength: lane profile recombined with official weights.

    Used only as the second tie-breaker. It is a weighted blend of already
    published lane values, not a recomputed PEAK3 score.
    """
    return round(
        sum(profile[lane] * LANE_PEAK3_WEIGHTS[lane] for lane in LANE_FIELDS), LANE_ROUNDING
    )


def _top_contributor(
    pool: CardPool, card_ids: Sequence[str], lane: str
) -> Optional[str]:
    """The roster card with the highest value in this lane (ties → lowest id)."""
    if not card_ids:
        return None
    return sorted(card_ids, key=lambda cid: (-pool.get(cid).lane_index[lane], cid))[0]


def resolve_battle(
    pool: CardPool,
    player_starters: Sequence[str],
    player_bench: Sequence[str],
    opponent: Opponent,
    systems: Sequence[str],
    lives_before: int,
    comeback_credits: int,
    win_credits: int = 0,
) -> BattleResult:
    """Resolve one boss battle. Pure function of its arguments."""
    p_weights = player_bench_weight_candidates(systems, opponent.rule_id)
    p_bw, o_bw = bench_weight_for(systems, opponent.rule_id)
    threshold = lane_margin_threshold(opponent.rule_id)

    lanes: list[LaneResult] = []
    p_wins = o_wins = ties = 0
    summed_margin = 0.0

    for lane in LANE_FIELDS:
        p = best_lane_score(pool, player_starters, player_bench, lane, p_weights)
        o = lane_score(pool, opponent.starter_ids, opponent.bench_ids, lane, o_bw)
        margin = round(p - o, LANE_ROUNDING)
        summed_margin += margin

        # `tie_broken_by_rule` means "the boss rule, not the raw margin,
        # determined this lane's result". Under a lane-margin rule that means
        # a lane one side would otherwise have taken is drawn instead.
        tie_broken = False
        if margin > threshold:
            winner = "player"
            p_wins += 1
        elif margin < -threshold:
            winner = "opponent"
            o_wins += 1
        else:
            winner = "tie"
            ties += 1
            tie_broken = abs(margin) > LANE_EPSILON

        lanes.append(
            LaneResult(
                lane=lane,
                label=LANE_LABELS[lane],
                player_score=p,
                opponent_score=o,
                winner=winner,
                margin=margin,
                tie_broken_by_rule=tie_broken,
                player_top_card_id=_top_contributor(
                    pool, list(player_starters) + list(player_bench), lane
                ),
                opponent_top_card_id=_top_contributor(
                    pool, list(opponent.starter_ids) + list(opponent.bench_ids), lane
                ),
            )
        )

    p_profile = player_lane_profile(
        pool, player_starters, player_bench, systems, opponent.rule_id
    )
    o_profile = roster_lane_profile(pool, opponent.starter_ids, opponent.bench_ids, o_bw)
    p_total = roster_total(p_profile)
    o_total = roster_total(o_profile)
    summed_margin = round(summed_margin, LANE_ROUNDING)

    # Primary: first to three lanes.
    if p_wins >= LANES_TO_WIN:
        outcome, decided_by = "win", "lanes"
    elif o_wins >= LANES_TO_WIN:
        outcome, decided_by = "loss", "lanes"
    # Ties prevented either side from reaching three. Fall through the
    # published tie-break ladder.
    elif abs(summed_margin) > LANE_EPSILON:
        outcome = "win" if summed_margin > 0 else "loss"
        decided_by = "summed_margin"
    elif abs(p_total - o_total) > LANE_EPSILON:
        outcome = "win" if p_total > o_total else "loss"
        decided_by = "roster_total"
    else:
        outcome, decided_by = "draw", "exact_draw"

    # A draw is not a loss: it costs nothing, and it pays neither the win reward
    # nor the comeback. It is also not a win, so it never clears the table.
    if outcome == "loss":
        lives_after = lives_before - 1
        credits_awarded = comeback_credits if lives_after > 0 else 0
    elif outcome == "win":
        lives_after = lives_before
        credits_awarded = win_credits
    else:
        lives_after = lives_before
        credits_awarded = 0

    return BattleResult(
        boss_id=opponent.boss_id,
        act=opponent.act,
        lanes=tuple(lanes),
        player_lanes_won=p_wins,
        opponent_lanes_won=o_wins,
        ties=ties,
        outcome=outcome,
        decided_by=decided_by,
        summed_margin=summed_margin,
        player_roster_total=p_total,
        opponent_roster_total=o_total,
        bench_weight=p_bw,
        rule_id=opponent.rule_id,
        lives_after=lives_after,
        credits_awarded=credits_awarded,
    )
