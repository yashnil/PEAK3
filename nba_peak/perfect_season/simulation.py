"""v0 experimental lineup-fit + season simulation for CourtBuilder.

Explicitly a labeled placeholder (config.SIMULATOR_VERSION = "...v0"), not a
calibrated model (master plan Sec 12.8) -- produces a plausible seeded record
and an expected-wins range from lineup-fit components derived from the same
LineupDNA fields Peak Draft's own experimental model already computes per
card (nba_peak.lineup.schemas.CardProfile.lineup_dna), never from a new or
approximated PEAK3 score (ADR-005 Decisions 3-4).
"""
from __future__ import annotations

import random
from collections import Counter

from nba_peak.lineup.schemas import CardProfile
from nba_peak.perfect_season.config import (
    LINEUP_MODEL_VERSION,
    SIMULATOR_EXPERIMENTAL_NOTICE,
    SIMULATOR_VERSION,
    STARTER_SLOTS,
)
from nba_peak.perfect_season.schemas import LineupFitComponents, SimulationResult

TOTAL_GAMES = 82


def _avg(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def compute_fit_components(cards: list[CardProfile]) -> LineupFitComponents:
    """Derive lineup-fit components from each card's existing LineupDNA.

    `cards` should be all 8 placed cards (starters + bench); starters weigh
    more heavily for talent_core, consistent with master plan Sec 6.2's
    "starters + bench" shape.
    """
    if not cards:
        return LineupFitComponents(0, 0, 0, 0, 0, 0)

    starters = cards[:STARTER_SLOTS]
    bench = cards[STARTER_SLOTS:]

    talent_core = _avg([c.individual_peak_score for c in starters]) * 0.8 + \
        _avg([c.individual_peak_score for c in bench]) * 0.2 if bench else \
        _avg([c.individual_peak_score for c in starters])

    creation_coverage = _avg([c.lineup_dna.primary_creation for c in cards])
    scoring_coverage = _avg([c.lineup_dna.scoring_pressure for c in cards])
    postseason_pedigree = _avg([c.lineup_dna.postseason_translation for c in cards])
    team_context_depth = _avg([c.lineup_dna.team_context for c in cards])

    # Role-overlap penalty: more than 3 cards sharing the same primary_role
    # is treated as redundant, per-role-beyond-3 penalty, capped.
    role_counts = Counter(c.primary_role for c in cards if c.primary_role)
    overlap_penalty = 0.0
    for role, count in role_counts.items():
        if count > 3:
            overlap_penalty -= (count - 3) * 3.0
    overlap_penalty = max(overlap_penalty, -15.0)

    return LineupFitComponents(
        talent_core=round(talent_core, 2),
        creation_coverage=round(creation_coverage, 2),
        scoring_coverage=round(scoring_coverage, 2),
        postseason_pedigree=round(postseason_pedigree, 2),
        team_context_depth=round(team_context_depth, 2),
        role_overlap_penalty=round(overlap_penalty, 2),
    )


def _decisive_factors(fit: LineupFitComponents) -> list[str]:
    factors: list[str] = []
    if fit.talent_core >= 85:
        factors.append("Elite talent core across the roster")
    elif fit.talent_core < 55:
        factors.append("Talent core is the roster's biggest limitation")

    if fit.creation_coverage >= 75:
        factors.append("Strong shot-creation coverage")
    elif fit.creation_coverage < 40:
        factors.append("Thin shot-creation coverage")

    if fit.postseason_pedigree >= 75:
        factors.append("Deep postseason pedigree")

    if fit.role_overlap_penalty <= -6.0:
        factors.append("Redundant role coverage limited overall fit")

    if not factors:
        factors.append("A balanced, unremarkable lineup profile")

    return factors[:3]


def simulate_season(cards: list[CardProfile], board_seed: int) -> SimulationResult:
    """Run the v0 simulation for a completed 8-card lineup.

    Deterministic given the same cards + board_seed (never re-randomized on
    replay), consistent with "official results must be reproducible"
    (bridge doc Sec 8). Card identities (peak_window_ids) feed the RNG seed so
    two different lineups on the same board_seed do not collide.
    """
    fit = compute_fit_components(cards)

    # expected_wins: talent-dominated, matching the experimental lineup
    # model's own "talent dominates" hypothesis (nba_peak/lineup/config.py),
    # nudged by coverage/overlap. Purely a v0 heuristic -- not calibrated
    # against real historical win distributions (master plan Sec 12.8).
    base = 41.0 + (fit.talent_core - 50.0) * 0.85
    base += (fit.creation_coverage - 50.0) * 0.06
    base += (fit.scoring_coverage - 50.0) * 0.05
    base += (fit.postseason_pedigree - 50.0) * 0.04
    base += fit.role_overlap_penalty * 0.3
    expected_wins = max(15.0, min(82.0, base))

    card_key = ",".join(sorted(c.peak_window_id for c in cards))
    rng = random.Random(f"{board_seed}:{card_key}")
    noise = rng.uniform(-2.5, 2.5)
    wins = int(round(max(0.0, min(82.0, expected_wins + noise))))
    losses = TOTAL_GAMES - wins

    expected_low = max(0.0, expected_wins - 5.0)
    expected_high = min(82.0, expected_wins + 5.0)

    return SimulationResult(
        lineup_model_version=LINEUP_MODEL_VERSION,
        simulator_version=SIMULATOR_VERSION,
        fit_components=fit,
        wins=wins,
        losses=losses,
        expected_wins=round(expected_wins, 1),
        expected_wins_low=round(expected_low, 1),
        expected_wins_high=round(expected_high, 1),
        decisive_factors=_decisive_factors(fit),
        is_perfect_season=(wins >= 82),
        experimental_notice=SIMULATOR_EXPERIMENTAL_NOTICE,
    )
