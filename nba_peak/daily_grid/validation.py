"""Server-side answer validation for the Daily Grid.

The client is never trusted and never holds the answer key: it sends a cell
and a player-season id, and this module is the only thing that decides
whether that is right. Every rejection carries a concise, specific reason --
"1996-97 Michael Jordan played for the Bulls, not the Lakers" teaches the
player something, where "invalid" just annoys them.

Rejection order is deliberate: structural problems (unknown id, filled cell,
reused player) are reported before constraint failures, so a player who
reuses a name is told exactly that rather than being told the season fails a
constraint it might actually satisfy.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional

from nba_peak.daily_grid.constraints import Constraint, constraint_by_id
from nba_peak.daily_grid.generator import GridBoard, GridCell
from nba_peak.daily_grid.pool import GridPool, PlayerSeason, load_pool
from nba_peak.daily_grid.scoring import CellScore, score_cell

VALIDATION_VERSION = "daily_grid_validation.v1"


class InvalidCell(ValueError):
    """Raised for row/col indices outside the board."""


@dataclass(frozen=True)
class ValidationResult:
    """Outcome of one submitted answer."""

    valid: bool
    reason: Optional[str] = None
    reason_code: Optional[str] = None
    player_season: Optional[PlayerSeason] = None
    cell_score: Optional[CellScore] = None

    def as_dict(self) -> dict:
        """Phase 11B: `player_season` is the IDENTITY-ONLY shape, on a valid
        submission as well as an invalid one.

        A rejected answer must not come back carrying its PEAK3 score --
        otherwise any square is a free score oracle: submit a season you know
        will fail, read its rating, and optimise the rest of the board without
        spending a real pick. The score for a season the player actually
        LOCKED IN is revealed through `cell_score` instead
        (`quality_points` is that season's prime_score), which exists only on
        a valid result and so cannot be reached by probing.
        """
        payload: dict = {"valid": self.valid}
        if self.reason:
            payload["reason"] = self.reason
            payload["reason_code"] = self.reason_code
        if self.player_season is not None:
            payload["player_season"] = self.player_season.as_search_dict()
        if self.cell_score is not None:
            payload["cell_score"] = self.cell_score.as_dict()
        return payload


def _reject(code: str, reason: str, player_season: PlayerSeason | None = None) -> ValidationResult:
    return ValidationResult(
        valid=False, reason=reason, reason_code=code, player_season=player_season
    )


def _constraint_failure_reason(
    player_season: PlayerSeason, constraint: Constraint
) -> str:
    """A specific, teachable sentence for why this season misses this
    constraint -- built from what the season actually IS, so the player
    learns the real fact rather than just being told 'no'."""
    label = player_season.label
    if constraint.category == "team":
        return f"{label} played for the {player_season.team_name}, not the {constraint.label}."
    if constraint.category == "era":
        return f"{label} is not a {constraint.label} season."
    if constraint.category == "position":
        listed = player_season.position or "no listed position"
        return f"{label} is listed at {listed}, not {constraint.label.lower()}."
    if constraint.category == "peak":
        # Phase 11B: says that it missed the bar, never by how much. Printing
        # the exact prime_score here would turn a peak-threshold square into a
        # score oracle -- submit any season, read its rating back -- which is
        # the one number the mode is built around not giving away before a
        # lock. The player still learns the real fact: this season does not
        # clear that line.
        return f"PEAK3 rates {label} below the {constraint.label} line."
    if constraint.category == "outcome":
        return f"{label}: that team finished at {player_season.playoff_round.lower()}."
    return f"{label} does not satisfy {constraint.label}."


def validate_answer(
    board: GridBoard,
    row: int,
    col: int,
    answer_id: str,
    used_player_slugs: Iterable[str] = (),
    filled_cells: Iterable[tuple[int, int]] = (),
    pool: GridPool | None = None,
) -> ValidationResult:
    """Check one submitted player-season against one cell.

    `used_player_slugs` carries the identities already placed elsewhere on
    this board, enforcing the distinct-identity rule (see generator.py). It is
    supplied by the caller because Phase 11A stores no server-side board
    state -- which means it is CLIENT-SUPPLIED and therefore only a
    convenience guard, not a security boundary. That is acceptable: local
    progress is explicitly not cheat-proof and not eligible for global
    ranking (CLAUDE.md Security), and constraint validity itself -- the part
    that must be right -- is decided here from server data alone.
    """
    grid_pool = pool if pool is not None else load_pool()

    if not (0 <= row < 3 and 0 <= col < 3):
        raise InvalidCell(f"cell ({row}, {col}) is outside the 3x3 board")

    cell: GridCell = board.cell(row, col)

    if (row, col) in set(filled_cells):
        return _reject("cell_filled", "That square is already filled.")

    player_season = grid_pool.get(answer_id)
    if player_season is None:
        return _reject(
            "unknown_answer",
            "That player-season is not in the Daily Grid pool.",
        )

    if player_season.player_slug in set(used_player_slugs):
        return _reject(
            "player_already_used",
            f"You have already used {player_season.player_name} on this board — "
            "each square needs a different player.",
            player_season,
        )

    row_constraint = constraint_by_id(cell.row_constraint_id, pool)
    col_constraint = constraint_by_id(cell.col_constraint_id, pool)

    if answer_id not in set(cell.answer_ids):
        # Report the specific side that failed. Both sides are re-derived from
        # the constraint predicates rather than trusting the cached key, so the
        # message can never disagree with the reason the answer was excluded.
        frame = grid_pool.frame
        matches = frame["answer_id"].to_numpy() == answer_id
        for constraint in (row_constraint, col_constraint):
            if not bool((constraint.matches(frame) & matches).any()):
                return _reject(
                    "constraint_failed",
                    _constraint_failure_reason(player_season, constraint),
                    player_season,
                )
        return _reject(
            "constraint_failed",
            f"{player_season.label} does not satisfy both constraints for this square.",
            player_season,
        )

    return ValidationResult(
        valid=True,
        player_season=player_season,
        cell_score=score_cell(player_season, cell),
    )
