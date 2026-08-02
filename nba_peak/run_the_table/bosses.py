"""Boss lineups for RUN THE TABLE.

Five curated opponents, each assembled entirely from canonical exact 3-year
prime windows that exist in the committed card pool. Every window id below was
verified present, role-legal for its slot, and duplicate-free before being
written here; ``tests/run_the_table/test_bosses.py`` re-verifies all of that on
every run so a card-pool rebuild that drops a card fails loudly.

Honesty note
------------
These are **not** reconstructions of real NBA teams. Each card is that
player's own career-best 3-year window, which is frequently from a different
franchise and era than the theme suggests, so the bosses are named for the
statistical identity they actually have rather than for a historical roster.
Presenting "2004 Detroit" while serving Chauncey Billups' 2005-08 Denver window
would be a claim the data does not support.

If a curated window is ever missing from the pool, ``resolve_bosses`` falls
back to :func:`generate_themed_boss`, which builds an equivalent opponent from
the live pool using the same theme scoring and difficulty target.
"""
from __future__ import annotations

import random
import statistics
from typing import Callable, Sequence

from nba_peak.run_the_table.cards import CardPool
from nba_peak.run_the_table.config import (
    BENCH_SLOTS,
    BOSS_RULES,
    BOSS_TARGET_STARTER_MEAN,
    BOSS_TARGET_TOLERANCE,
    LANE_FIELDS,
    LANE_LABELS,
    LANE_ROUNDING,
    ROLES,
    SCOUT_PREP_LANE_BONUS,
)
from nba_peak.run_the_table.schemas import Opponent, RunCard

# ---------------------------------------------------------------------------
# Curated definitions
# ---------------------------------------------------------------------------
# Each starter tuple is ordered to match ``config.ROLES``.
#
# The five-act progression each boss is built to test (v3, plan §4.3):
#   1. The Wall            — teaches the lane system; beatable with the starting five.
#   2. Strength in Numbers — punishes a one-dimensional roster: a balanced
#                            opponent under a rule that makes your bench count.
#   3. The Ceiling         — makes perk/economy strategy matter: the bench is
#                            nearly switched off, so credits had to go into starters.
#   4. The Standard        — a decisive-margin test: a lane you did not really
#                            win is nobody's.
#   5. The Long Series     — the v3 Final Boss. Three lanes is a split decision
#                            here; four of five wins outright and anything short
#                            of that is settled on total margin, so the whole
#                            roster is on trial rather than its best three lanes.
#                            Winning it is the only way to clear the table.
CURATED_BOSSES: tuple[dict, ...] = (
    {
        "boss_id": "the_wall",
        "name": "The Wall",
        "tagline": "Five two-way profiles with almost no hardware. They win on impact, not on votes.",
        "act": 1,
        "rule_id": "the_wall",
        "starter_ids": (
            "kyle-lowry-3yr-201617",         # lead_creator   60.56
            "hassan-whiteside-3yr-201516",   # guard_wing     59.92
            "jarrett-allen-3yr-202425",      # wing_forward   59.04
            "elton-brand-3yr-200506",        # forward_big    63.48
            "marc-gasol-3yr-201213",         # anchor         60.50
        ),
        "bench_ids": (
            "clint-capela-3yr-201718",       # 57.38
            "mike-conley-3yr-201617",        # 55.67
        ),
    },
    {
        "boss_id": "strength_in_numbers",
        "name": "Strength in Numbers",
        "tagline": "No superstar, no weak link. Every lane is covered by somebody.",
        "act": 2,
        "rule_id": "strength_in_numbers",
        "starter_ids": (
            "terry-porter-3yr-199091",       # lead_creator   64.51
            "ray-allen-3yr-200001",          # guard_wing     64.28
            "paul-pierce-3yr-200102",        # wing_forward   62.57
            "pau-gasol-3yr-200809",          # forward_big    64.78
            "gary-payton-3yr-199596",        # anchor         67.33
        ),
        "bench_ids": (
            "reggie-miller-3yr-199394",      # 66.53
            "jeff-hornacek-3yr-199596",      # 57.05
        ),
    },
    {
        "boss_id": "the_ceiling",
        "name": "The Ceiling",
        "tagline": "The highest-rated five you can face. Your bench will not save you.",
        "act": 3,
        "rule_id": "top_heavy",
        "starter_ids": (
            "patrick-ewing-3yr-198990",      # lead_creator   69.08
            "alonzo-mourning-3yr-199900",    # guard_wing     72.35
            "clyde-drexler-3yr-199192",      # wing_forward   72.98
            "chauncey-billups-3yr-200506",   # forward_big    71.00
            "jason-kidd-3yr-200203",         # anchor         65.28
        ),
        "bench_ids": (
            "rudy-gobert-3yr-201819",        # 71.73
            "ben-wallace-3yr-200203",        # 64.83
        ),
    },
    {
        "boss_id": "the_standard",
        "name": "The Standard",
        "tagline": "Close is not good enough here. Beat them by a clear margin in three "
                   "lanes or the lane goes to nobody.",
        "act": 4,
        "rule_id": "the_standard",
        "starter_ids": (
            "steve-nash-3yr-200506",         # lead_creator   77.79
            "tracy-mcgrady-3yr-200203",      # guard_wing     77.45
            "julius-erving-3yr-198081",      # wing_forward   76.47
            "victor-wembanyama-3yr-202526",  # forward_big    76.50
            "draymond-green-3yr-201516",     # anchor         63.82
        ),
        "bench_ids": (
            "john-stockton-3yr-198788",      # 76.21
            "jimmy-butler-3yr-202223",       # 73.11
        ),
    },
    {
        # v3's Final Boss. Built by a constrained search over the live pool
        # (starter mean within 0.6 of the 76.5 band, bench mean within 3.0 of
        # the starter mean so the published difficulty target is not quietly
        # beaten by a stacked bench, no player already used by bosses 1-4, and
        # an anchor at or above 59.5 so the lineup is not four monsters and a
        # hole), then written down here as a curated spec.
        # Starter mean 76.50, bench mean 78.95.
        "boss_id": "the_long_series",
        "name": "The Long Series",
        "tagline": "No exploitable lane and no cheap three-lane win. Beat them across "
                   "the board or beat them on total margin.",
        "act": 5,
        "rule_id": "the_long_series",
        "starter_ids": (
            "kevin-durant-3yr-201314",       # lead_creator   88.79
            "anthony-davis-3yr-201920",      # guard_wing     80.80
            "allen-iverson-3yr-200001",      # wing_forward   69.53
            "dirk-nowitzki-3yr-200506",      # forward_big    82.78
            "joakim-noah-3yr-201314",        # anchor         60.58
        ),
        "bench_ids": (
            "shai-gilgeous-alexander-3yr-202425",   # 90.61
            "adrian-dantley-3yr-198384",            # 67.29
        ),
    },
)


# ---------------------------------------------------------------------------
# Theme scoring — used only by the generated fallback
# ---------------------------------------------------------------------------
def _theme_wall(card: RunCard) -> float:
    """Impact and playoff value without recognition."""
    p = card.lane_percentiles
    return (
        0.55 * p["statistical_impact"]
        + 0.30 * p["postseason_individual_value"]
        + 0.15 * (100.0 - p["individual_recognition"])
    )


def _theme_depth(card: RunCard) -> float:
    """Balanced across all five lanes — high mean, low spread."""
    vals = list(card.lane_percentiles.values())
    return statistics.mean(vals) - 1.4 * statistics.pstdev(vals)


def _theme_ceiling(card: RunCard) -> float:
    """Peak recognised performance."""
    p = card.lane_percentiles
    return 0.5 * p["individual_recognition"] + 0.5 * p["statistical_impact"]


def _theme_standard(card: RunCard) -> float:
    """No exploitable lane: a high floor across all five, then peak on top.

    The Final Boss's published rule only awards a lane to a decisive winner, so
    the opponent it is fair to build for it is one with no lane you can beat by
    four points almost by accident.
    """
    vals = list(card.lane_percentiles.values())
    return 0.55 * min(vals) + 0.45 * statistics.mean(vals)


def _theme_long_series(card: RunCard) -> float:
    """A high floor everywhere, with total output as the tie-break.

    The Final Boss's published rule pushes most battles onto the summed margin
    across all five lanes, so the opponent it is fair to build for it is one
    with no lane cheap enough to concede and enough overall volume that a
    two-lane player still loses the total.
    """
    vals = list(card.lane_percentiles.values())
    return 0.45 * min(vals) + 0.55 * statistics.mean(vals)


_THEMES: dict[str, Callable[[RunCard], float]] = {
    "the_wall": _theme_wall,
    "strength_in_numbers": _theme_depth,
    "the_ceiling": _theme_ceiling,
    "the_standard": _theme_standard,
    "the_long_series": _theme_long_series,
}


def _legal_lineup(
    candidates: list[RunCard], rng: random.Random
) -> tuple[list[RunCard], list[RunCard]] | None:
    """Fill the five roles scarcest-first, then draw a bench. No duplicate players."""
    scarcity = sorted(
        ROLES, key=lambda r: sum(1 for c in candidates if r in c.eligible_roles)
    )
    used_slugs: set[str] = set()
    by_role: dict[str, RunCard] = {}
    for role in scarcity:
        options = [
            c for c in candidates
            if role in c.eligible_roles and c.player_slug not in used_slugs
        ]
        if not options:
            return None
        pick = rng.choice(options)
        by_role[role] = pick
        used_slugs.add(pick.player_slug)
    rest = [c for c in candidates if c.player_slug not in used_slugs]
    if len(rest) < BENCH_SLOTS:
        return None
    return [by_role[r] for r in ROLES], rng.sample(rest, BENCH_SLOTS)


def generate_themed_boss(
    pool: CardPool,
    boss_id: str,
    act: int,
    name: str,
    tagline: str,
    rule_id: str | None,
    target_mean: float,
    seed: int,
    attempts: int = 3000,
) -> Opponent:
    """Deterministic fallback opponent built from the live pool.

    Searches role-legal lineups inside a score band around ``target_mean`` and
    keeps the one that best balances difficulty accuracy against theme fit.
    Fully determined by ``(pool, boss_id, target_mean, seed)``.
    """
    theme = _THEMES.get(boss_id, _theme_depth)
    band = [
        c for c in pool.cards
        if target_mean - 8.0 <= c.prime_score <= target_mean + 8.0
    ]
    if len(band) < len(ROLES) + BENCH_SLOTS:
        band = list(pool.cards)

    # A band can be large and still be UNFILLABLE. At the v3 Final Boss's target
    # the band is [68.5, 84.5], and the whole 3Y pool contains no anchor-eligible
    # card above 67.33 -- so `_legal_lineup` returned None on every attempt and
    # the fallback raised on a pool that can obviously field a lineup. Any role
    # the band cannot cover is topped up with the closest-scoring eligible cards
    # from the full pool, which keeps the search near its difficulty target
    # instead of collapsing it onto the whole pool.
    covered = {c.player_slug for c in band}
    for role in ROLES:
        if any(role in c.eligible_roles for c in band):
            continue
        nearest = sorted(
            (c for c in pool.cards if role in c.eligible_roles),
            key=lambda c: (abs(c.prime_score - target_mean), c.peak_window_id),
        )[: len(ROLES) + BENCH_SLOTS]
        for c in nearest:
            if c.player_slug not in covered:
                band.append(c)
                covered.add(c.player_slug)
    band.sort(key=lambda c: c.peak_window_id)

    rng = random.Random(seed)
    best: tuple[float, list[RunCard], list[RunCard]] | None = None
    for _ in range(attempts):
        got = _legal_lineup(band, rng)
        if got is None:
            continue
        starters, bench = got
        mean = statistics.mean(c.prime_score for c in starters)
        score = -abs(mean - target_mean) * 4.0 + statistics.mean(
            theme(c) for c in starters + bench
        ) * 0.09
        if best is None or score > best[0]:
            best = (score, starters, bench)

    if best is None:
        raise RuntimeError(
            f"Could not generate a legal fallback boss '{boss_id}' from a pool of "
            f"{len(pool)} cards."
        )
    _, starters, bench = best
    return Opponent(
        boss_id=boss_id,
        name=name,
        tagline=tagline,
        act=act,
        rule_id=rule_id,
        starter_ids=tuple(c.peak_window_id for c in starters),
        bench_ids=tuple(c.peak_window_id for c in bench),
        source="generated_fallback",
    )


def _curated_is_resolvable(pool: CardPool, spec: dict) -> bool:
    ids = list(spec["starter_ids"]) + list(spec["bench_ids"])
    if not all(pool.has(i) for i in ids):
        return False
    slugs = [pool.get(i).player_slug for i in ids]
    if len(set(slugs)) != len(slugs):
        return False
    for role, card_id in zip(ROLES, spec["starter_ids"]):
        if role not in pool.get(card_id).eligible_roles:
            return False
    return True


def resolve_bosses(pool: CardPool) -> tuple[Opponent, ...]:
    """Return the five act bosses, in act order, curated where possible.

    Deterministic and independent of the run seed — every run faces the same
    five opponents, which is what makes runs comparable to each other and to
    the daily board. The last entry is the Final Boss: winning it is the only
    way to clear the table (``receipt.build_receipt``).
    """
    out: list[Opponent] = []
    for idx, spec in enumerate(CURATED_BOSSES):
        if _curated_is_resolvable(pool, spec):
            out.append(
                Opponent(
                    boss_id=spec["boss_id"],
                    name=spec["name"],
                    tagline=spec["tagline"],
                    act=spec["act"],
                    rule_id=spec["rule_id"],
                    starter_ids=tuple(spec["starter_ids"]),
                    bench_ids=tuple(spec["bench_ids"]),
                    source="curated",
                )
            )
        else:
            out.append(
                generate_themed_boss(
                    pool,
                    boss_id=spec["boss_id"],
                    act=spec["act"],
                    name=spec["name"],
                    tagline=spec["tagline"],
                    rule_id=spec["rule_id"],
                    target_mean=BOSS_TARGET_STARTER_MEAN[idx],
                    # Fixed per-boss seed: the fallback must not vary by run.
                    seed=90_001 + idx * 977,
                )
            )
    return tuple(out)


def boss_reveal_order(pool: CardPool, boss: Opponent) -> list[dict]:
    """The deterministic slot-by-slot reveal of a boss lineup (spec §3).

    Same seven slots and the same order as the opening roster reveal, so a
    client can drive both with one component. Pure lookup — no seed, no clock,
    no model inference: the boss slate is fixed for every run of a ruleset, and
    labelling the reveal as seed/rule generated rather than "an LLM building a
    team live" is only honest if the data actually behaves that way.
    """
    out: list[dict] = []
    for idx, (role, card_id) in enumerate(zip(ROLES, boss.starter_ids)):
        card = pool.get(card_id)
        out.append(
            {
                "order": idx,
                "slot_id": role,
                "role": role,
                "is_starter": True,
                "card_id": card_id,
                "player_name": card.player_name,
                "anchor_season": card.anchor_season,
                "prime_score": card.prime_score,
            }
        )
    for idx, card_id in enumerate(boss.bench_ids):
        card = pool.get(card_id)
        out.append(
            {
                "order": len(ROLES) + idx,
                "slot_id": f"bench_{idx + 1}",
                "role": None,
                "is_starter": False,
                "card_id": card_id,
                "player_name": card.player_name,
                "anchor_season": card.anchor_season,
                "prime_score": card.prime_score,
            }
        )
    return out


def scout_report(
    pool: CardPool,
    boss: Opponent,
    player_starters: Sequence[str],
    player_bench: Sequence[str],
    systems: Sequence[str] = (),
    prep_bonus: float = SCOUT_PREP_LANE_BONUS,
) -> dict:
    """Everything "Scout the Boss" reveals, computed from published values.

    Spec §5A: the next boss's rule, its two strongest lanes, its weakest lane,
    and a projected matchup — then the capped preparation the player may buy on
    top of it. Every number here is one the player can already reproduce from
    the lane profiles the UI shows; scouting buys the *work*, not private
    information the engine is otherwise hiding.

    ``would_flip`` on each preparation option is the whole reason this node is
    no longer dead content: it tells the player, before they commit, whether the
    2.5-point preparation actually changes a lane result in the fight they are
    about to take.
    """
    # Imported here rather than at module scope: `battle` is the resolution
    # layer and importing it eagerly would make the boss catalogue depend on it
    # for every caller that only wants the lineups.
    from nba_peak.run_the_table.battle import (
        bench_weight_for,
        lane_margin_threshold,
        lanes_to_win_for,
        player_lane_profile,
        roster_lane_profile,
    )

    _, opponent_bench_weight = bench_weight_for(systems, boss.rule_id)
    boss_profile = roster_lane_profile(
        pool, boss.starter_ids, boss.bench_ids, opponent_bench_weight
    )
    player_profile = player_lane_profile(
        pool, player_starters, player_bench, systems, boss.rule_id
    )
    threshold = lane_margin_threshold(boss.rule_id)
    lanes_needed = lanes_to_win_for(boss.rule_id)

    lanes: list[dict] = []
    projected_player_lanes = 0
    projected_opponent_lanes = 0
    summed_margin = 0.0
    for lane in LANE_FIELDS:
        margin = round(player_profile[lane] - boss_profile[lane], LANE_ROUNDING)
        summed_margin += margin
        if margin > threshold:
            winner = "player"
            projected_player_lanes += 1
        elif margin < -threshold:
            winner = "opponent"
            projected_opponent_lanes += 1
        else:
            winner = "tie"
        lanes.append(
            {
                "lane": lane,
                "label": LANE_LABELS[lane],
                "opponent_score": boss_profile[lane],
                "player_score": player_profile[lane],
                "margin": margin,
                "projected_winner": winner,
            }
        )

    by_strength = sorted(lanes, key=lambda row: (-row["opponent_score"], row["lane"]))
    summed_margin = round(summed_margin, LANE_ROUNDING)

    if projected_player_lanes >= lanes_needed:
        projection = "win"
    elif projected_opponent_lanes >= lanes_needed:
        projection = "loss"
    elif summed_margin > 0:
        projection = "win_on_margin"
    elif summed_margin < 0:
        projection = "loss_on_margin"
    else:
        projection = "draw"

    preparations = []
    for row in lanes:
        prepared = round(row["margin"] + prep_bonus, LANE_ROUNDING)
        preparations.append(
            {
                "lane": row["lane"],
                "label": row["label"],
                "bonus": prep_bonus,
                "margin_before": row["margin"],
                "margin_after": prepared,
                "would_flip": row["projected_winner"] != "player" and prepared > threshold,
            }
        )

    return {
        "boss_id": boss.boss_id,
        "name": boss.name,
        "tagline": boss.tagline,
        "act": boss.act,
        "rule_id": boss.rule_id,
        "rule": dict(BOSS_RULES[boss.rule_id]) if boss.rule_id else None,
        "lane_margin_threshold": threshold,
        "lanes_to_win": lanes_needed,
        "lanes": lanes,
        "strongest_lanes": [row["lane"] for row in by_strength[:2]],
        "weakest_lane": by_strength[-1]["lane"],
        "projected_lanes_won": projected_player_lanes,
        "projected_lanes_lost": projected_opponent_lanes,
        "projected_summed_margin": summed_margin,
        "projection": projection,
        "preparations": preparations,
        "starter_mean": round(boss_starter_mean(pool, boss), 3),
    }


def boss_starter_mean(pool: CardPool, boss: Opponent) -> float:
    return statistics.mean(pool.get(i).prime_score for i in boss.starter_ids)


def boss_within_target(pool: CardPool, boss: Opponent, act_index: int) -> bool:
    target = BOSS_TARGET_STARTER_MEAN[act_index]
    return abs(boss_starter_mean(pool, boss) - target) <= BOSS_TARGET_TOLERANCE
