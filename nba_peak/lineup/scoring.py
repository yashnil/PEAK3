"""Main lineup evaluation entry point.

Computes lineup_peak_rating = talent*w + coverage*w + synergy (bounded).
All sub-scores are computed separately and combined here.
"""
from __future__ import annotations

from nba_peak.lineup.config import (
    CARD_PROFILE_VERSION,
    COVERAGE_WEIGHT,
    LINEUP_MODEL_VERSION,
    RULESET_VERSION,
    SYNERGY_WEIGHT,
    TALENT_WEIGHT,
)
from nba_peak.lineup.coverage import compute_coverage_score
from nba_peak.lineup.receipts import generate_receipt
from nba_peak.lineup.schemas import CardProfile, LineupEvaluation
from nba_peak.lineup.synergy import compute_synergy
from nba_peak.lineup.talent import compute_talent_score


def evaluate_lineup(
    cards: list[CardProfile],
    role_assignments: dict[str, str],   # role → peak_window_id
    board_optimum: float | None = None,
    board_floor: float | None = None,
    solver_version: str | None = None,
) -> LineupEvaluation:
    """Evaluate a 5-card lineup and produce a full LineupEvaluation.

    Args:
        cards: Exactly 5 CardProfile objects.
        role_assignments: Maps each functional role to the peak_window_id assigned to it.
        board_optimum: Best possible lineup rating on this board (from solver).
        board_floor: 5th-percentile random valid lineup rating (from solver).
        solver_version: Version string for the solver that computed optimum/floor.

    Returns:
        LineupEvaluation with all sub-scores, DNA, synergy items, and receipt.
    """
    if len(cards) != 5:
        raise ValueError(f"evaluate_lineup requires exactly 5 cards, got {len(cards)}")

    # Validate all cards are the same duration
    durations = {c.duration_years for c in cards}
    if len(durations) > 1:
        raise ValueError(
            f"All lineup cards must have the same duration_years. Found: {durations}"
        )

    # 1. Talent
    talent_score = compute_talent_score(cards)

    # 2. Coverage + DNA
    coverage_score, final_dna = compute_coverage_score(cards)

    # 3. Synergy
    synergy_total, synergy_items = compute_synergy(cards)

    # 4. Weighted combination
    # synergy_total is already a small bounded delta applied as a multiplier offset
    raw_before_synergy = TALENT_WEIGHT * talent_score + COVERAGE_WEIGHT * coverage_score
    lineup_peak_rating = raw_before_synergy * (1.0 + synergy_total)
    lineup_peak_rating = max(0.0, min(100.0, lineup_peak_rating))

    # 5. Draft efficiency
    draft_efficiency = None
    board_percentile = None
    if board_optimum is not None and board_floor is not None:
        denominator = board_optimum - board_floor
        if denominator > 1e-6:
            draft_efficiency = (lineup_peak_rating - board_floor) / denominator
            draft_efficiency = max(0.0, min(1.5, draft_efficiency))  # allow slight overshoot display
        else:
            draft_efficiency = 1.0   # trivial board (all options equal)

    # 6. Completeness
    incomplete_ids = [
        c.peak_window_id for c in cards if c.data_completeness != "complete"
    ]
    completeness = 1.0 - len(incomplete_ids) / 5.0
    missing_warnings: list[str] = []
    if incomplete_ids:
        missing_warnings.append(
            f"The experimental model used incomplete data for: "
            + ", ".join(incomplete_ids)
        )

    # 7. Receipt
    receipt_items = generate_receipt(
        cards=cards,
        role_assignments=role_assignments,
        talent_score=talent_score,
        coverage_score=coverage_score,
        synergy_items=synergy_items,
        final_dna=final_dna,
        lineup_peak_rating=lineup_peak_rating,
        board_optimum=board_optimum,
        board_floor=board_floor,
        draft_efficiency=draft_efficiency,
    )

    return LineupEvaluation(
        lineup_model_version=LINEUP_MODEL_VERSION,
        ruleset_version=RULESET_VERSION,
        card_profile_version=CARD_PROFILE_VERSION,
        lineup_peak_rating=round(lineup_peak_rating, 4),
        talent_score=round(talent_score, 4),
        coverage_score=round(coverage_score, 4),
        synergy_total=round(synergy_total, 6),
        raw_before_synergy=round(raw_before_synergy, 4),
        final_dna=final_dna,
        role_assignments=role_assignments,
        synergy_items=synergy_items,
        receipt_items=receipt_items,
        cards_evaluated=5,
        missing_data_warnings=missing_warnings,
        completeness=round(completeness, 2),
        board_optimum=board_optimum,
        board_floor=board_floor,
        draft_efficiency=round(draft_efficiency, 4) if draft_efficiency is not None else None,
        board_percentile=board_percentile,
        solver_version=solver_version,
    )
