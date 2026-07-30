"""Daily Grid scoring: PEAK3 quality x cell rarity.

Two terms, both explainable in one line to a player:

  quality  the season's own PEAK3 prime_score (the calibrated 0-100
           single-season value the rankings already show). A better season is
           worth more, always.
  rarity   a multiplier from how many valid answers the cell had. A cell with
           eight possible answers is a genuinely harder square than one with
           three hundred, and filling it should pay more.

  cell_score = round(prime_score * rarity_multiplier)

Rarity is a PROXY for difficulty -- the size of the valid answer set -- not a
measure of how rare the pick was among real players. True answer-frequency
rarity needs global submission counts and durable per-board storage, which
Phase 11A deliberately does not build (see docs and CLAUDE.md's deferred
list). The proxy is named honestly everywhere it surfaces so it is never
mistaken for "only 2% of players found this".

Nothing here is called peak_score: game scoring is `arena_points` by
convention (CLAUDE.md), and the fields below are grid-local scoring, kept
distinct from the model's own `prime_score`.
"""
from __future__ import annotations

from dataclasses import dataclass

from nba_peak.daily_grid.generator import GridCell, rarity_bucket
from nba_peak.daily_grid.pool import PlayerSeason

SCORING_VERSION = "daily_grid_scoring.v1"

# Multiplier per rarity bucket. Kept shallow (1.0x -> 1.5x) on purpose: rarity
# should reward a hard square without letting one lucky tight cell outweigh
# the rest of the board.
RARITY_MULTIPLIERS: dict[str, float] = {
    "very_rare": 1.50,
    "rare": 1.30,
    "uncommon": 1.15,
    "common": 1.05,
    "very_common": 1.00,
}

# Human-readable rarity names, for the cell card and the completion recap.
RARITY_LABELS: dict[str, str] = {
    "very_rare": "Very rare square",
    "rare": "Rare square",
    "uncommon": "Uncommon square",
    "common": "Common square",
    "very_common": "Open square",
}


@dataclass(frozen=True)
class CellScore:
    """One filled cell's score, broken into the terms that produced it."""

    arena_points: int
    quality_points: float
    rarity_bucket: str
    rarity_label: str
    rarity_multiplier: float
    rarity_bonus: int

    def as_dict(self) -> dict:
        return {
            "arena_points": self.arena_points,
            "quality_points": round(self.quality_points, 2),
            "rarity_bucket": self.rarity_bucket,
            "rarity_label": self.rarity_label,
            "rarity_multiplier": self.rarity_multiplier,
            "rarity_bonus": self.rarity_bonus,
        }


def score_cell(player_season: PlayerSeason, cell: GridCell) -> CellScore:
    """Score one valid answer in one cell. Deterministic and bounded:
    0 < arena_points <= round(100 * max(RARITY_MULTIPLIERS)) = 150."""
    bucket = rarity_bucket(cell.answer_count)
    multiplier = RARITY_MULTIPLIERS[bucket]
    quality = player_season.prime_score
    total = round(quality * multiplier)
    return CellScore(
        arena_points=int(total),
        quality_points=quality,
        rarity_bucket=bucket,
        rarity_label=RARITY_LABELS[bucket],
        rarity_multiplier=multiplier,
        rarity_bonus=int(total - round(quality)),
    )


def max_possible_cell_points() -> int:
    """Upper bound on a single cell, used by tests to assert boundedness."""
    return round(100.0 * max(RARITY_MULTIPLIERS.values()))
