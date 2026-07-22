"""Personal records service.

Records are versioned by the full (record_type, mode, version_tuple).
Records from incompatible version tuples are never compared.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional


RECORD_TYPES = {
    "lineup_score":      {"higher_is_better": True,  "modes": {"apex_1y", "prime_3y", "foundation_5y"}},
    "draft_efficiency":  {"higher_is_better": True,  "modes": {"apex_1y", "prime_3y", "foundation_5y"}},
    "daily_percentile":  {"higher_is_better": False, "modes": {"apex_1y", "prime_3y", "foundation_5y"}},
    "challenge_margin":  {"higher_is_better": True,  "modes": {"apex_1y", "prime_3y", "foundation_5y"}},
}


@dataclass
class RecordCandidate:
    """A candidate value extracted from an immutable result snapshot."""
    record_type: str
    mode: str
    lineup_model_version: str
    card_pool_version: str
    ruleset_version: str
    value: float
    source_result_id: str
    achieved_at: datetime
    higher_is_better: bool


@dataclass
class RecordEntry:
    """A current personal record row."""
    id: str
    owner_sub: str
    record_type: str
    mode: str
    lineup_model_version: str
    card_pool_version: str
    ruleset_version: str
    record_value: float
    higher_is_better: bool
    source_result_id: str
    achieved_at: datetime
    previous_record_id: Optional[str] = None


def is_new_record(candidate: RecordCandidate, current: Optional[RecordEntry]) -> bool:
    """Return True if the candidate beats the current record."""
    if current is None:
        return True
    if candidate.higher_is_better:
        return candidate.value > current.record_value
    else:
        return candidate.value < current.record_value


def extract_candidates(
    result_snapshot: dict,
    result_id: str,
    achieved_at: datetime,
) -> list[RecordCandidate]:
    """Extract personal-record candidates from an immutable result snapshot.

    The snapshot must include version metadata from the board snapshot.
    """
    candidates: list[RecordCandidate] = []
    mode = result_snapshot.get("mode") or result_snapshot.get("board_mode")
    board_meta = result_snapshot.get("board_metadata", {})
    lmv = board_meta.get("lineup_model_version", "unknown")
    cpv = board_meta.get("card_pool_version", "unknown")
    rv = board_meta.get("ruleset_version", "unknown")
    board_type = result_snapshot.get("board_type", "")

    if not mode:
        return candidates

    lineup_rating = result_snapshot.get("lineup_peak_rating")
    if lineup_rating is not None:
        candidates.append(RecordCandidate(
            record_type="lineup_score",
            mode=mode,
            lineup_model_version=lmv,
            card_pool_version=cpv,
            ruleset_version=rv,
            value=float(lineup_rating),
            source_result_id=result_id,
            achieved_at=achieved_at,
            higher_is_better=True,
        ))

    efficiency = result_snapshot.get("draft_efficiency")
    if efficiency is not None:
        candidates.append(RecordCandidate(
            record_type="draft_efficiency",
            mode=mode,
            lineup_model_version=lmv,
            card_pool_version=cpv,
            ruleset_version=rv,
            value=float(efficiency),
            source_result_id=result_id,
            achieved_at=achieved_at,
            higher_is_better=True,
        ))

    percentile = result_snapshot.get("board_percentile")
    if percentile is not None and board_type == "daily":
        candidates.append(RecordCandidate(
            record_type="daily_percentile",
            mode=mode,
            lineup_model_version=lmv,
            card_pool_version=cpv,
            ruleset_version=rv,
            value=float(percentile),
            source_result_id=result_id,
            achieved_at=achieved_at,
            higher_is_better=False,  # lower percentile = better rank
        ))

    margin = result_snapshot.get("challenge_margin")
    if margin is not None and board_type == "challenge":
        candidates.append(RecordCandidate(
            record_type="challenge_margin",
            mode=mode,
            lineup_model_version=lmv,
            card_pool_version=cpv,
            ruleset_version=rv,
            value=float(margin),
            source_result_id=result_id,
            achieved_at=achieved_at,
            higher_is_better=True,
        ))

    return candidates
