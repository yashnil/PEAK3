"""Today's maximum: the highest-scoring legal fill of a Daily Grid board.

Phase 11B turns the Daily Grid into an optimisation puzzle -- "build the
highest-scoring valid 3x3 grid" -- which only means something if there is a
number to be measured against. This module computes that number, and it
computes it EXACTLY rather than approximating.

THE PROBLEM
Assign one player-season to each of the 9 squares so that every square
satisfies its two constraints, no player identity is used twice, and the
total of `round(prime_score * cell_rarity_multiplier)` is as large as
possible.

WHY IT IS EXACTLY SOLVABLE
A cell's rarity multiplier is fixed per cell, so for a given (cell, player)
the best available season is simply that player's highest-scoring season
among the cell's valid answers -- there is never a reason to prefer a lower
one. Collapsing each (cell, player) pair to that single best value turns the
whole thing into a rectangular linear assignment problem: 9 rows (cells) by
however many distinct players appear anywhere on the board (~10^2-10^3), with
the no-duplicate-player rule becoming assignment's own one-player-per-row
constraint. scipy.optimize.linear_sum_assignment solves that to proven
optimality in microseconds at this size.

So this is genuinely "today's maximum", not "the best we found". The
distinction matters because the result screen states it to the player, and
overclaiming there would be exactly the kind of unearned certainty the rest
of the project avoids. `OptimalSolution.exact` records which claim is being
made, and is True on every board the shipped generator can produce.

A feasible assignment always exists: generator.py refuses to publish a board
until it has proven one by backtracking search, so the infeasible-pair
sentinel below can never be forced into the answer.

NEVER LEAKS EARLY
Nothing here is reachable from the board or search routes. The API exposes it
only through the result endpoint, which first re-validates that all nine
squares are genuinely filled with valid answers -- see
apps/api/app/api/v1/daily_grid.py.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional

import numpy as np
from scipy.optimize import linear_sum_assignment

from nba_peak.daily_grid.generator import GridBoard, GridCell
from nba_peak.daily_grid.pool import GridPool, PlayerSeason, load_pool
from nba_peak.daily_grid.scoring import CellScore, score_cell

OPTIMAL_VERSION = "daily_grid_optimal.v1"

# Value used for a (cell, player) pair the player cannot fill. Must be more
# negative than any achievable board total so the optimiser can never trade a
# real square for an impossible one: a cell tops out at 150 points
# (scoring.max_possible_cell_points), so a whole board tops out at 1,350.
_INFEASIBLE = -1_000_000


@dataclass(frozen=True)
class OptimalCell:
    """What the maximum-scoring fill puts in one square."""

    row: int
    col: int
    player_season: PlayerSeason
    cell_score: CellScore

    def as_dict(self) -> dict:
        return {
            "row": self.row,
            "col": self.col,
            "player_season": self.player_season.as_dict(),
            "cell_score": self.cell_score.as_dict(),
        }


@dataclass(frozen=True)
class OptimalSolution:
    """The highest-scoring legal fill of one board."""

    board_id: str
    date: str
    total_points: int
    cells: tuple[OptimalCell, ...]
    # True when computed over the board's complete candidate sets, i.e. this
    # is provably the maximum rather than the best found. See module docstring.
    exact: bool
    version: str = OPTIMAL_VERSION

    def cell(self, row: int, col: int) -> OptimalCell:
        for candidate in self.cells:
            if candidate.row == row and candidate.col == col:
                return candidate
        raise KeyError(f"no optimal cell at ({row}, {col})")

    def as_dict(self) -> dict:
        return {
            "board_id": self.board_id,
            "date": self.date,
            "total_points": self.total_points,
            "exact": self.exact,
            "cells": [cell.as_dict() for cell in self.cells],
            "version": self.version,
        }


def _best_season_per_player(
    cell: GridCell, pool: GridPool
) -> dict[str, PlayerSeason]:
    """For one square: each eligible player's own highest-scoring valid season.

    Ties break on answer id so the choice is stable across runs -- two seasons
    with an identical prime_score would otherwise resolve by dict ordering.
    """
    best: dict[str, PlayerSeason] = {}
    for answer_id in cell.answer_ids:
        player_season = pool.by_id[answer_id]
        incumbent = best.get(player_season.player_slug)
        if incumbent is None or (player_season.prime_score, player_season.id) > (
            incumbent.prime_score,
            incumbent.id,
        ):
            best[player_season.player_slug] = player_season
    return best


def solve_optimal(
    board: GridBoard, pool: GridPool | None = None
) -> OptimalSolution:
    """The maximum-scoring legal fill of `board`. Deterministic.

    Deterministic in a stronger sense than "the solver is deterministic": the
    player list is sorted, and per-(cell, player) ties are broken on answer id,
    so the same board yields not just the same TOTAL but the same nine
    seasons every time. That matters because the result screen names them.
    """
    grid_pool = pool if pool is not None else load_pool()

    per_cell_best: list[dict[str, PlayerSeason]] = [
        _best_season_per_player(cell, grid_pool) for cell in board.cells
    ]

    players = sorted({slug for best in per_cell_best for slug in best})
    player_index = {slug: i for i, slug in enumerate(players)}

    values = np.full((len(board.cells), len(players)), _INFEASIBLE, dtype=np.int64)
    for cell_index, (cell, best) in enumerate(zip(board.cells, per_cell_best)):
        for slug, player_season in best.items():
            values[cell_index, player_index[slug]] = score_cell(
                player_season, cell
            ).arena_points

    rows, cols = linear_sum_assignment(values, maximize=True)

    cells: list[OptimalCell] = []
    for cell_index, player_col in zip(rows, cols):
        cell = board.cells[cell_index]
        slug = players[player_col]
        player_season = per_cell_best[cell_index][slug]
        cells.append(
            OptimalCell(
                row=cell.row,
                col=cell.col,
                player_season=player_season,
                cell_score=score_cell(player_season, cell),
            )
        )
    cells.sort(key=lambda c: (c.row, c.col))

    assigned = {(int(r), int(c)) for r, c in zip(rows, cols)}
    exact = all(values[r, c] > _INFEASIBLE for r, c in assigned) and len(
        cells
    ) == len(board.cells)
    if not exact:
        # Unreachable: generator.py proves a distinct-player solution exists
        # before publishing. Raised rather than returned so a board that
        # somehow slipped through fails loudly instead of quoting the player a
        # maximum that is not achievable.
        raise RuntimeError(
            f"no feasible maximum fill for board {board.board_id} "
            "-- the generator's solvability proof and this solver disagree"
        )

    return OptimalSolution(
        board_id=board.board_id,
        date=board.date,
        total_points=sum(c.cell_score.arena_points for c in cells),
        cells=tuple(cells),
        exact=True,
    )


_OPTIMAL_CACHE: dict[str, OptimalSolution] = {}
# Bounded for the same reason as generator._BOARD_CACHE: `date` is
# caller-supplied, and an unbounded cache would let date enumeration grow the
# process. Recomputation is cheap and deterministic, so eviction is free.
_OPTIMAL_CACHE_MAX = 200


def get_optimal(board: GridBoard, pool: GridPool | None = None) -> OptimalSolution:
    """Process-cached maximum for a board. Pure function of the board."""
    cached = _OPTIMAL_CACHE.get(board.board_id)
    if cached is not None:
        return cached
    solution = solve_optimal(board, pool=pool)
    if len(_OPTIMAL_CACHE) >= _OPTIMAL_CACHE_MAX:
        _OPTIMAL_CACHE.pop(next(iter(_OPTIMAL_CACHE)))
    _OPTIMAL_CACHE[board.board_id] = solution
    return solution


# ---------------------------------------------------------------------------
# User result vs. today's maximum
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ResultCell:
    """One square, side by side: what the player used, what the maximum used."""

    row: int
    col: int
    row_constraint_label: str
    col_constraint_label: str
    user_player_season: PlayerSeason
    user_points: int
    optimal_player_season: PlayerSeason
    optimal_points: int

    @property
    def points_left(self) -> int:
        """How much this square cost the player. Zero when they matched the
        maximum -- which includes finding a DIFFERENT season worth the same."""
        return max(0, self.optimal_points - self.user_points)

    @property
    def matched_optimal(self) -> bool:
        return self.points_left == 0

    def as_dict(self) -> dict:
        return {
            "row": self.row,
            "col": self.col,
            "row_constraint_label": self.row_constraint_label,
            "col_constraint_label": self.col_constraint_label,
            "user_player_season": self.user_player_season.as_dict(),
            "user_points": self.user_points,
            "optimal_player_season": self.optimal_player_season.as_dict(),
            "optimal_points": self.optimal_points,
            "points_left": self.points_left,
            "matched_optimal": self.matched_optimal,
        }


@dataclass(frozen=True)
class GridResult:
    """The post-completion comparison. Only ever built for a full, valid board."""

    board_id: str
    date: str
    user_total: int
    optimal_total: int
    percent_of_best: float
    exact_optimal: bool
    incorrect_attempts: int
    cells: tuple[ResultCell, ...]
    best_cell: ResultCell
    biggest_miss: Optional[ResultCell]
    squares_matching_optimal: int

    def as_dict(self) -> dict:
        return {
            "board_id": self.board_id,
            "date": self.date,
            "user_total": self.user_total,
            "optimal_total": self.optimal_total,
            "percent_of_best": self.percent_of_best,
            "exact_optimal": self.exact_optimal,
            "incorrect_attempts": self.incorrect_attempts,
            "squares_matching_optimal": self.squares_matching_optimal,
            "cells": [cell.as_dict() for cell in self.cells],
            "best_cell": self.best_cell.as_dict(),
            "biggest_miss": self.biggest_miss.as_dict() if self.biggest_miss else None,
        }


def build_result(
    board: GridBoard,
    filled: Iterable[tuple[int, int, str]],
    incorrect_attempts: int = 0,
    pool: GridPool | None = None,
) -> GridResult:
    """Compare a completed board against today's maximum.

    `filled` is (row, col, answer_id) for all nine squares. The caller is
    responsible for having validated them -- this does not re-check
    constraints, because the API route that reaches here has already re-run
    the full validator over every square (a client claiming a completed board
    it did not earn must not be able to unlock the answer key).
    """
    grid_pool = pool if pool is not None else load_pool()
    optimal = get_optimal(board, pool=grid_pool)

    from nba_peak.daily_grid.constraints import constraint_by_id

    cells: list[ResultCell] = []
    for row, col, answer_id in filled:
        cell = board.cell(row, col)
        user_season = grid_pool.by_id[answer_id]
        optimal_cell = optimal.cell(row, col)
        cells.append(
            ResultCell(
                row=row,
                col=col,
                row_constraint_label=constraint_by_id(
                    cell.row_constraint_id, grid_pool
                ).label,
                col_constraint_label=constraint_by_id(
                    cell.col_constraint_id, grid_pool
                ).label,
                user_player_season=user_season,
                user_points=score_cell(user_season, cell).arena_points,
                optimal_player_season=optimal_cell.player_season,
                optimal_points=optimal_cell.cell_score.arena_points,
            )
        )
    cells.sort(key=lambda c: (c.row, c.col))

    user_total = sum(c.user_points for c in cells)
    # Reading order breaks ties for both, so the same board and the same fill
    # always name the same square.
    best_cell = max(cells, key=lambda c: (c.user_points, -c.row, -c.col))
    misses = [c for c in cells if c.points_left > 0]
    biggest_miss = (
        max(misses, key=lambda c: (c.points_left, -c.row, -c.col)) if misses else None
    )

    return GridResult(
        board_id=board.board_id,
        date=board.date,
        user_total=user_total,
        optimal_total=optimal.total_points,
        percent_of_best=(
            round(100.0 * user_total / optimal.total_points, 1)
            if optimal.total_points
            else 0.0
        ),
        exact_optimal=optimal.exact,
        incorrect_attempts=incorrect_attempts,
        cells=tuple(cells),
        best_cell=best_cell,
        biggest_miss=biggest_miss,
        squares_matching_optimal=sum(1 for c in cells if c.matched_optimal),
    )
