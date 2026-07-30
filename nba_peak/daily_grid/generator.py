"""Deterministic date -> 3x3 Daily Grid board.

DETERMINISM
Same date, same board, for everyone, forever -- with no stored per-date
snapshot and no synchronization step. The seed is SHA-256 of a namespaced
date string, exactly mirroring the existing precedent in
nba_peak/perfect_season/daily.py (which itself mirrors the Peak Duel daily
seed). The namespace prefix differs so a given date can never collide with
either of those games' seeds. Everything downstream -- candidate sampling,
acceptance order -- is driven by a single random.Random(seed), so the whole
generator is a pure function of (date, version).

SOLVABILITY
A board is only published if it passes every one of these, checked against
the real answer pool at generation time (there is no "probably fine"):

  1. Every cell has >= MIN_ANSWERS_PER_CELL valid player-seasons.
  2. Every cell has >= MIN_PLAYERS_PER_CELL DISTINCT player identities.
     Cell answer count alone is not enough -- "Lakers x MVP" can have eight
     answers that are all Kobe, which under the distinct-identity rule below
     is effectively a one-answer cell.
  3. The board is fully solvable under the distinct-identity rule: there
     exists an assignment of nine cells to nine DIFFERENT players. Verified
     by actual backtracking search over the real answer sets, not estimated.

DISTINCT-IDENTITY RULE (product decision)
No player identity may be used twice on one board. Chosen over "no repeated
player-season" because the looser rule collapses in practice: the hardest
cells are almost always answerable by the same handful of all-time greats,
and a board that is nine Jordan/LeBron/Hakeem seasons is neither strategic
nor interesting. Requiring nine different players forces the player to spend
their obvious answers carefully. Enforced at generation time (criterion 3
above, so the rule can never make a published board unsolvable) and again at
submit time (validation.py).

BOARD QUALITY
Feasibility alone produces dull boards -- all-team boards, or all-formula
boards, or "80+ PEAK x 60+ PEAK" where one condition implies the other. The
composition rules below are what make a board read like a basketball puzzle:
a mix of recognizable categories (teams, awards, eras) and PEAK3-native ones
(score thresholds, component deciles), with nested/mutually-exclusive pairs
kept off opposite axes.
"""
from __future__ import annotations

import hashlib
import random
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, Sequence

import numpy as np

from nba_peak.daily_grid.constraints import Constraint, all_constraints
from nba_peak.daily_grid.pool import GridPool, load_pool

DAILY_GRID_VERSION = "daily_grid.v1"

# Namespace prefix -- never share a raw date salt with another game's daily
# seed (same discipline as nba_peak/perfect_season/daily.py).
_SEED_NAMESPACE = "peak3-daily-grid"

# Same modulus as the other daily seeds in the repo: keeps the value inside
# the signed-32-bit range every existing seed path accepts.
_SEED_MODULUS = 2 ** 31

DATE_FORMAT = "%Y-%m-%d"

GRID_SIZE = 3

# Solvability floors. The brief's hard minimum is 3 valid answers per cell;
# 6 is used instead so a cell stays findable by a knowledgeable fan who does
# not happen to know the one obscure answer.
MIN_ANSWERS_PER_CELL = 6
MIN_PLAYERS_PER_CELL = 4

# Composition rules -- see "BOARD QUALITY" above.
# Phase 11B composition rules. The Phase 11A set produced technically-fine
# boards that played flat -- "Center x Nuggets", "All-Star x Heat" -- because
# nothing stopped a board being three franchises crossed with three broad
# roles. That is a database lookup, not a puzzle. These rules push every board
# towards a real decision.
MIN_TEAM_CONSTRAINTS = 1
# Capped at 2 (was 3): a third franchise crowds out the categories that make a
# board interesting, and franchise-heavy boards are where the "just look it
# up" feeling came from.
MAX_TEAM_CONSTRAINTS = 2
MIN_PEAK3_NATIVE = 1          # at least one PEAK3-native (peak/component) axis
# Two PEAK3-native axes is the target, not the ceiling -- see
# _PREFER_TWO_NATIVE_UNTIL_ATTEMPT for how the preference is applied without
# making some dates unsolvable.
PREFERRED_PEAK3_NATIVE = 2
MAX_PEAK3_NATIVE = 3
MIN_CATEGORIES = 4            # distinct categories among the six axes
MAX_PER_CATEGORY = 2          # was 3 -- no category may own a whole axis

# Every board needs at least one constraint a fan can anchor on that is not a
# franchise or a position: an award, a playoff outcome, or an era.
MIN_ANCHOR_CONSTRAINTS = 1

# Categories that a casual fan recognizes without knowing PEAK3 at all.
_RECOGNIZABLE = frozenset({"team", "award", "era", "position", "outcome"})
_PEAK3_NATIVE = frozenset({"peak", "component"})
# "Interesting on their own" -- the categories that carry basketball meaning
# beyond roster membership and listed height.
_ANCHOR = frozenset({"award", "outcome", "era"})
# The two categories that, alone, make a board feel like a lookup table.
_LOOKUP_FLAVOURED = frozenset({"team", "position"})

# A square is only a real decision if several different players are plausibly
# its best answer. Measured as: at least this many DISTINCT players have a
# qualifying season worth at least _STRONG_OPTION_RATIO of the square's best.
MIN_STRONG_OPTIONS = 3
_STRONG_OPTION_RATIO = 0.70

# How many squares one player may be the single best answer to. Without this,
# boards appear where Jordan or LeBron is the right answer nearly everywhere
# and the "no repeated player" rule turns into a chore rather than a choice.
MAX_SQUARES_ONE_PLAYER_TOPS = 3

# Attempts spent insisting on PREFERRED_PEAK3_NATIVE before settling for
# MIN_PEAK3_NATIVE. Deterministic (it is a function of the attempt counter, not
# of wall-clock), so the preference never costs a date its board.
_PREFER_TWO_NATIVE_UNTIL_ATTEMPT = 2000

# Attempts before giving up on a date. The Phase 11B composition rules are
# much tighter than 11A's -- the worst date in a 365-day sample now needs
# ~1,900 attempts (it was ~420) -- so the ceiling is raised to keep real
# headroom above the _PREFER_TWO_NATIVE_UNTIL_ATTEMPT relaxation point rather
# than sitting just above the observed worst case.
_MAX_ATTEMPTS = 6000


class InvalidGridDate(ValueError):
    """Raised for a date string that is not a real YYYY-MM-DD calendar date."""


class BoardGenerationFailed(RuntimeError):
    """No composition-valid, solvable board found for a date.

    Should be unreachable with the shipped taxonomy; raised rather than
    returning a degraded board because publishing an unsolvable grid is worse
    than failing loudly.
    """


def today_utc_date() -> str:
    """Today in UTC as YYYY-MM-DD.

    UTC rather than server-local time so the board rolls over at the same
    instant for every player worldwide -- the same choice the Peak Duel and
    PEAK Season daily routes already make.
    """
    return datetime.now(timezone.utc).strftime(DATE_FORMAT)


def validate_grid_date(date_str: str) -> str:
    """Return `date_str` if it is a real YYYY-MM-DD date, else raise.
    strptime validates the actual calendar, so '2026-02-30' is rejected."""
    try:
        datetime.strptime(date_str, DATE_FORMAT)
    except (ValueError, TypeError) as exc:
        raise InvalidGridDate(
            f"date must be a real YYYY-MM-DD date, got '{date_str}'"
        ) from exc
    return date_str


def grid_seed(date_str: str, version: str = DAILY_GRID_VERSION) -> int:
    """The deterministic board seed for one date.

    Pure: no clock read, no randomness, no I/O. `version` is part of the salt
    so a future taxonomy revision can reshuffle boards intentionally without
    colliding with v1's history.
    """
    validate_grid_date(date_str)
    raw = f"{_SEED_NAMESPACE}:{version}:{date_str}"
    return int(hashlib.sha256(raw.encode()).hexdigest(), 16) % _SEED_MODULUS


def board_id(date_str: str, version: str = DAILY_GRID_VERSION) -> str:
    """Stable id for one daily board, e.g. 'daily-grid-v1-2026-07-30'.

    Used as the client-side progress key, so it must stay stable for a given
    (date, version) forever -- and must CHANGE when the date changes, which
    is what makes yesterday's saved progress fall away on its own.
    """
    validate_grid_date(date_str)
    short_version = version.split(".")[-1]
    return f"daily-grid-{short_version}-{date_str}"


@dataclass(frozen=True)
class GridCell:
    """One cell's generation-time facts.

    `answer_ids` is the answer key. It is held on the server-side board object
    (validation and scoring both need it) and is stripped by
    GridBoard.as_public_dict() -- the client is never sent it.
    """

    row: int
    col: int
    row_constraint_id: str
    col_constraint_id: str
    answer_ids: tuple[str, ...]
    player_slugs: frozenset[str]

    @property
    def answer_count(self) -> int:
        return len(self.answer_ids)

    @property
    def distinct_player_count(self) -> int:
        return len(self.player_slugs)


@dataclass(frozen=True)
class GridBoard:
    """A generated daily board, answer key included (server-side only)."""

    board_id: str
    date: str
    seed: int
    version: str
    rows: tuple[Constraint, ...]
    cols: tuple[Constraint, ...]
    cells: tuple[GridCell, ...]
    difficulty: str
    attempts: int

    def cell(self, row: int, col: int) -> GridCell:
        for candidate in self.cells:
            if candidate.row == row and candidate.col == col:
                return candidate
        raise KeyError(f"no cell at ({row}, {col})")

    @property
    def total_answers(self) -> int:
        return sum(cell.answer_count for cell in self.cells)

    def as_public_dict(self) -> dict:
        """What the client is allowed to see.

        Carries the constraint labels, and per cell only the RARITY BUCKET --
        never `answer_ids`, and never the raw answer count (which on a
        six-answer cell would narrow the search almost as much as the key
        itself). The bucket is what the scoring explanation needs and is
        coarse enough to be safe.
        """
        return {
            "board_id": self.board_id,
            "date": self.date,
            "version": self.version,
            "difficulty": self.difficulty,
            "rows": [c.as_dict() for c in self.rows],
            "cols": [c.as_dict() for c in self.cols],
            "cells": [
                {
                    "row": cell.row,
                    "col": cell.col,
                    "row_constraint_id": cell.row_constraint_id,
                    "col_constraint_id": cell.col_constraint_id,
                    "rarity_bucket": rarity_bucket(cell.answer_count),
                }
                for cell in self.cells
            ],
            "rules": {
                "unique_player_identity": True,
                "grid_size": GRID_SIZE,
            },
        }


# ---------------------------------------------------------------------------
# Rarity + difficulty
# ---------------------------------------------------------------------------

# Coarse buckets, safe to expose. Boundaries are answer counts.
_RARITY_BUCKETS: tuple[tuple[int, str], ...] = (
    (10, "very_rare"),
    (25, "rare"),
    (75, "uncommon"),
    (200, "common"),
)


def rarity_bucket(answer_count: int) -> str:
    for threshold, name in _RARITY_BUCKETS:
        if answer_count < threshold:
            return name
    return "very_common"


# Median-cell answer counts at which a board changes difficulty label. Set to
# the observed terciles of a 365-day sample of v1 boards (P33 = 47, P66 = 69),
# so the three labels split roughly evenly across the year rather than
# collapsing into one bucket -- "hard" has to be rare enough to mean something
# and common enough to ever appear.
# Re-measured for the Phase 11B composition rules (P33 = 53, P66 = 91 over a
# 365-day sample); the tighter rules shifted the distribution, and stale
# thresholds would have quietly relabelled two thirds of the year "easy".
_DIFFICULTY_HARD_BELOW = 53
_DIFFICULTY_MEDIUM_BELOW = 91


def _difficulty_label(cells: Sequence[GridCell]) -> str:
    """Board difficulty from the median cell's answer count.

    Median rather than mean so one very open cell cannot mask a board that is
    otherwise tight, and vice versa.
    """
    counts = sorted(cell.answer_count for cell in cells)
    median = counts[len(counts) // 2]
    if median < _DIFFICULTY_HARD_BELOW:
        return "hard"
    if median < _DIFFICULTY_MEDIUM_BELOW:
        return "medium"
    return "easy"


# ---------------------------------------------------------------------------
# Composition + solvability checks
# ---------------------------------------------------------------------------

def _composition_ok(
    rows: Sequence[Constraint], cols: Sequence[Constraint], attempt: int = 1
) -> bool:
    """Cheap structural rejects, run before any answer-set work.

    `attempt` drives one soft preference: for the first
    _PREFER_TWO_NATIVE_UNTIL_ATTEMPT attempts a board must carry two PEAK3-
    native axes, after which one is accepted. Expressed as a function of the
    attempt counter rather than a separate pass so the whole generator stays a
    pure function of the seed.
    """
    axes = list(rows) + list(cols)

    ids = {c.id for c in axes}
    if len(ids) != len(axes):
        return False

    # Nested or mutually-exclusive constraints must never cross. Same-axis is
    # fine ("Lakers" and "Celtics" as two different ROWS is a normal board).
    for row in rows:
        for col in cols:
            if row.exclusive_group is not None and row.exclusive_group == col.exclusive_group:
                return False

    categories = [c.category for c in axes]
    if len(set(categories)) < MIN_CATEGORIES:
        return False
    if any(categories.count(cat) > MAX_PER_CATEGORY for cat in set(categories)):
        return False

    team_count = categories.count("team")
    if not (MIN_TEAM_CONSTRAINTS <= team_count <= MAX_TEAM_CONSTRAINTS):
        return False

    native_count = sum(1 for cat in categories if cat in _PEAK3_NATIVE)
    if not (MIN_PEAK3_NATIVE <= native_count <= MAX_PEAK3_NATIVE):
        return False
    if attempt <= _PREFER_TWO_NATIVE_UNTIL_ATTEMPT and native_count < PREFERRED_PEAK3_NATIVE:
        return False

    # At least one award / playoff outcome / era. Without this a board can be
    # all franchises, positions and thresholds -- every square answerable by
    # scanning a roster, none of them by knowing basketball.
    anchor_count = sum(1 for cat in categories if cat in _ANCHOR)
    if anchor_count < MIN_ANCHOR_CONSTRAINTS:
        return False

    # Never a board built only from "which roster" and "how tall". Those two
    # categories together are exactly the lookup-table feeling this pass is
    # removing, so they may not account for more than half the axes.
    lookup_count = sum(1 for cat in categories if cat in _LOOKUP_FLAVOURED)
    if lookup_count > len(axes) // 2:
        return False

    # A board must not be solvable purely by PEAK3 literacy, nor purely by
    # roster trivia -- both axes need at least one of each flavour so no cell
    # is entirely one or the other.
    if not any(c.category in _RECOGNIZABLE for c in rows):
        return False
    if not any(c.category in _RECOGNIZABLE for c in cols):
        return False

    return True


def _solvable_with_distinct_players(
    player_sets: Sequence[frozenset[str]],
) -> bool:
    """Is there an assignment of all nine cells to nine DIFFERENT players?

    Backtracking over the real answer sets, smallest set first so the search
    fails fast on the binding cell. This is a bipartite matching on nine
    cells; with the MIN_PLAYERS_PER_CELL floor already applied it either
    succeeds almost immediately or is genuinely impossible.
    """
    ordered = sorted(player_sets, key=len)
    used: set[str] = set()

    def assign(index: int) -> bool:
        if index == len(ordered):
            return True
        for slug in ordered[index]:
            if slug in used:
                continue
            used.add(slug)
            if assign(index + 1):
                return True
            used.discard(slug)
        return False

    return assign(0)


def _build_cells(
    rows: Sequence[Constraint],
    cols: Sequence[Constraint],
    pool: GridPool,
    masks: dict[str, np.ndarray],
) -> Optional[tuple[GridCell, ...]]:
    """Materialize all nine cells, or None if any floor is missed.

    Returns early on the first failing cell -- most rejected candidate boards
    fail on their first or second cell, so this avoids computing the rest.
    """
    answer_ids = pool.frame["answer_id"].to_numpy()
    player_slugs = pool.frame["player_slug"].to_numpy()
    prime_scores = pool.frame["prime_score"].to_numpy()

    cells: list[GridCell] = []
    # Who is the single best answer to each square. A player topping too many
    # squares means the board is really about one GOAT -- see
    # MAX_SQUARES_ONE_PLAYER_TOPS.
    top_answer_slugs: list[str] = []

    for row_index, row_constraint in enumerate(rows):
        for col_index, col_constraint in enumerate(cols):
            mask = masks[row_constraint.id] & masks[col_constraint.id]
            count = int(mask.sum())
            if count < MIN_ANSWERS_PER_CELL:
                return None
            cell_slugs = player_slugs[mask]
            slugs = frozenset(cell_slugs.tolist())
            if len(slugs) < MIN_PLAYERS_PER_CELL:
                return None

            # Does this square pose a real choice? A cell's rarity multiplier
            # is constant, so a season's value here is proportional to its
            # prime_score -- meaning "several players could plausibly be the
            # best answer" reduces to counting distinct players holding a
            # season within _STRONG_OPTION_RATIO of the square's best. A square
            # with one runaway answer and a long tail of weak ones is not a
            # decision, it is a recall test.
            cell_scores = prime_scores[mask]
            best_score = cell_scores.max()
            strong = cell_slugs[cell_scores >= _STRONG_OPTION_RATIO * best_score]
            if len(set(strong.tolist())) < MIN_STRONG_OPTIONS:
                return None
            top_answer_slugs.append(str(cell_slugs[cell_scores.argmax()]))

            cells.append(
                GridCell(
                    row=row_index,
                    col=col_index,
                    row_constraint_id=row_constraint.id,
                    col_constraint_id=col_constraint.id,
                    answer_ids=tuple(answer_ids[mask].tolist()),
                    player_slugs=slugs,
                )
            )

    for slug in set(top_answer_slugs):
        if top_answer_slugs.count(slug) > MAX_SQUARES_ONE_PLAYER_TOPS:
            return None

    if not _solvable_with_distinct_players([cell.player_slugs for cell in cells]):
        return None

    return tuple(cells)


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------

def generate_board(
    date_str: str,
    pool: GridPool | None = None,
    constraints: Sequence[Constraint] | None = None,
    version: str = DAILY_GRID_VERSION,
) -> GridBoard:
    """The board for one date. Pure function of (date, version, taxonomy)."""
    validate_grid_date(date_str)
    grid_pool = pool if pool is not None else load_pool()
    taxonomy = list(constraints) if constraints is not None else all_constraints(
        pool if pool is not None else None
    )

    seed = grid_seed(date_str, version)
    rng = random.Random(seed)

    # Masks are computed once per constraint and reused across every attempt;
    # recomputing them per attempt is what would make generation slow.
    masks: dict[str, np.ndarray] = {
        constraint.id: constraint.matches(grid_pool.frame) for constraint in taxonomy
    }

    for attempt in range(1, _MAX_ATTEMPTS + 1):
        picked = rng.sample(taxonomy, 2 * GRID_SIZE)
        rows, cols = picked[:GRID_SIZE], picked[GRID_SIZE:]

        if not _composition_ok(rows, cols, attempt):
            continue

        cells = _build_cells(rows, cols, grid_pool, masks)
        if cells is None:
            continue

        return GridBoard(
            board_id=board_id(date_str, version),
            date=date_str,
            seed=seed,
            version=version,
            rows=tuple(rows),
            cols=tuple(cols),
            cells=cells,
            difficulty=_difficulty_label(cells),
            attempts=attempt,
        )

    raise BoardGenerationFailed(
        f"no solvable board for {date_str} after {_MAX_ATTEMPTS} attempts "
        "-- the constraint taxonomy or the solvability floors need review"
    )


_BOARD_CACHE: "OrderedDict[tuple[str, str], GridBoard]" = OrderedDict()

# Bounded so that enumerating dates cannot grow the process without limit --
# `date` is a caller-supplied string and every distinct value generates (and
# would otherwise retain) its own board with its full answer key, tens of KB
# each. An LRU is the right shape rather than a date-window restriction: the
# contract is that ANY date resolves to the one board it will ever have, and
# bounding a cache does not change that -- an evicted date simply regenerates,
# deterministically, to exactly the same board. Sized to comfortably hold a
# year so ordinary play (today, and browsing recent dates) never evicts.
_BOARD_CACHE_MAX = 400


def get_board(date_str: str, version: str = DAILY_GRID_VERSION) -> GridBoard:
    """Process-cached board for a date.

    Safe to cache because generation is a pure function of (date, version) over
    committed data -- the cache can never serve a board that differs from what
    a fresh generation would produce.
    """
    validate_grid_date(date_str)
    key = (date_str, version)
    cached = _BOARD_CACHE.get(key)
    if cached is not None:
        _BOARD_CACHE.move_to_end(key)
        return cached
    board = generate_board(date_str, version=version)
    _BOARD_CACHE[key] = board
    if len(_BOARD_CACHE) > _BOARD_CACHE_MAX:
        _BOARD_CACHE.popitem(last=False)
    return board
