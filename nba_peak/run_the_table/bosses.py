"""Boss lineups for RUN THE TABLE.

Three curated opponents, each assembled entirely from canonical exact 3-year
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
from typing import Callable

from nba_peak.run_the_table.cards import CardPool
from nba_peak.run_the_table.config import (
    BENCH_SLOTS,
    BOSS_TARGET_STARTER_MEAN,
    BOSS_TARGET_TOLERANCE,
    ROLES,
)
from nba_peak.run_the_table.schemas import Opponent, RunCard

# ---------------------------------------------------------------------------
# Curated definitions
# ---------------------------------------------------------------------------
# Each starter tuple is ordered to match ``config.ROLES``.
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


_THEMES: dict[str, Callable[[RunCard], float]] = {
    "the_wall": _theme_wall,
    "strength_in_numbers": _theme_depth,
    "the_ceiling": _theme_ceiling,
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
    """Return the three act bosses, curated where possible.

    Deterministic and independent of the run seed — every run faces the same
    three opponents, which is what makes runs comparable to each other and to
    the daily board.
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


def boss_starter_mean(pool: CardPool, boss: Opponent) -> float:
    return statistics.mean(pool.get(i).prime_score for i in boss.starter_ids)


def boss_within_target(pool: CardPool, boss: Opponent, act_index: int) -> bool:
    target = BOSS_TARGET_STARTER_MEAN[act_index]
    return abs(boss_starter_mean(pool, boss) - target) <= BOSS_TARGET_TOLERANCE
