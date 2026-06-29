"""Talent scoring layer for the experimental lineup model.

Aggregates five individual_peak_scores with diminishing contribution weights.
The best card contributes 35%, down to 6% for the fifth.

Invariants:
- Weights sum exactly to 1.0
- More peak score is always better (monotone)
- Every card contributes (minimum weight 6%)
- Output is in [TALENT_SCORE_MIN, TALENT_SCORE_MAX]
"""
from __future__ import annotations

from nba_peak.lineup.config import (
    TALENT_CARD_WEIGHTS,
    TALENT_SCORE_MAX,
    TALENT_SCORE_MIN,
)
from nba_peak.lineup.schemas import CardProfile


def compute_talent_score(cards: list[CardProfile]) -> float:
    """Compute the talent score for a 5-card lineup.

    Args:
        cards: Exactly 5 CardProfile objects (any order; sorted internally).

    Returns:
        Talent score in [TALENT_SCORE_MIN, TALENT_SCORE_MAX].

    Raises:
        ValueError: If cards does not have exactly 5 entries.
    """
    if len(cards) != 5:
        raise ValueError(f"Talent scoring requires exactly 5 cards, got {len(cards)}")

    # Sort best-to-worst by individual_peak_score
    sorted_scores = sorted(
        (c.individual_peak_score for c in cards),
        reverse=True,
    )

    assert len(TALENT_CARD_WEIGHTS) == 5, "TALENT_CARD_WEIGHTS must have exactly 5 weights"
    assert abs(sum(TALENT_CARD_WEIGHTS) - 1.0) < 1e-9, "TALENT_CARD_WEIGHTS must sum to 1.0"

    weighted_sum = sum(w * s for w, s in zip(TALENT_CARD_WEIGHTS, sorted_scores))

    return max(TALENT_SCORE_MIN, min(TALENT_SCORE_MAX, weighted_sum))
