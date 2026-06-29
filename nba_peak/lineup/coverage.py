"""Coverage scoring layer for the experimental lineup model.

Aggregates the eight Lineup DNA dimensions across five cards using saturation:
- Duplicate strength has diminishing returns (saturation_alpha config parameter)
- Catastrophic roster holes reduce the coverage score
- Missing data (context_completeness < 100) reduces certainty

Output is in [0, 100].
"""
from __future__ import annotations

from nba_peak.lineup.config import (
    COVERAGE_CATASTROPHIC_HOLE_PENALTY,
    COVERAGE_CATASTROPHIC_HOLE_THRESHOLD,
    COVERAGE_SATURATION_ALPHA,
    DNA_DIMENSIONS,
)
from nba_peak.lineup.schemas import CardProfile, LineupDNA


def _saturated_aggregate(values: list[float], alpha: float) -> float:
    """Aggregate dimension values across cards with saturation.

    The nth card's contribution is weighted by 1 / (1 + alpha * (n - 1)).
    Cards are processed in descending order (best first).
    Result is clipped to [0, 100].
    """
    if not values:
        return 0.0
    sorted_vals = sorted(values, reverse=True)
    total = 0.0
    for i, v in enumerate(sorted_vals):
        weight = 1.0 / (1.0 + alpha * i)
        total += weight * v
    # Normalise so that 5 cards at 100 still returns 100
    normaliser = sum(1.0 / (1.0 + alpha * i) for i in range(len(sorted_vals)))
    return min(100.0, max(0.0, total / normaliser)) if normaliser > 0 else 0.0


def compute_coverage_score(
    cards: list[CardProfile],
) -> tuple[float, LineupDNA]:
    """Compute coverage score and final aggregated Lineup DNA for a 5-card lineup.

    Returns:
        (coverage_score: float, final_dna: LineupDNA)

    Raises:
        ValueError: If cards is empty or has more than 5 entries.
    """
    if not cards:
        raise ValueError("Coverage scoring requires at least 1 card")
    if len(cards) > 5:
        raise ValueError(f"Coverage scoring requires at most 5 cards, got {len(cards)}")

    # Gather per-dimension values from all cards
    dim_values: dict[str, list[float]] = {d: [] for d in DNA_DIMENSIONS}
    for card in cards:
        dna = card.lineup_dna.as_dict()
        for dim in DNA_DIMENSIONS:
            dim_values[dim].append(dna.get(dim, 0.0))

    # Compute saturated aggregate for each dimension
    aggregated: dict[str, float] = {}
    for dim in DNA_DIMENSIONS:
        aggregated[dim] = _saturated_aggregate(
            dim_values[dim], COVERAGE_SATURATION_ALPHA
        )

    # Catastrophic hole penalty: any dimension below threshold
    hole_penalty = 0.0
    for dim, val in aggregated.items():
        if val < COVERAGE_CATASTROPHIC_HOLE_THRESHOLD:
            hole_penalty += COVERAGE_CATASTROPHIC_HOLE_PENALTY

    # Mean coverage minus holes
    raw_mean = sum(aggregated.values()) / len(DNA_DIMENSIONS)
    coverage = max(0.0, min(100.0, raw_mean - hole_penalty))

    final_dna = LineupDNA(**{d: round(aggregated[d], 2) for d in DNA_DIMENSIONS})
    return round(coverage, 4), final_dna
