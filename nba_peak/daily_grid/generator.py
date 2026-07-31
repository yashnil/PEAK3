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
composition rules below are what make a board read like a basketball puzzle,
with nested/mutually-exclusive pairs kept off opposite axes.

PHASE 11C: THE AXES ARE BASKETBALL, THE SCORING IS PEAK3
11B required TWO PEAK3-native axes on every board, which turned out to be the
mode's central design mistake. The objective is to maximise total PEAK3 score;
putting "60+ PEAK" or "Top 10% Statistical Impact" on an AXIS therefore asks
the player to do, as an eligibility test, the same thing the scoring already
rewards. Those squares collapse to "name the biggest all-time player who
clears the bar" -- self-referential, and always answered by the same handful
of legends.

So the standard board is now built entirely from basketball facts: franchises,
awards and league-leader titles, decades, positions, playoff outcomes, and
season context (minutes, games). PEAK3 stays hidden until a pick locks, where
it decides how much the pick was WORTH. A single PEAK3-native axis survives as
a deterministic spice on roughly one date in _SPICE_MODULUS -- never two, and
never on a majority of boards. See _native_allowance().
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

# v2: Phase 11C. The composition rules changed enough that every date's board
# changes, so the version salt moves with them -- a v1 board_id must never
# resolve to a v2 board (it is also the client's progress key).
DAILY_GRID_VERSION = "daily_grid.v2"

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
MIN_TEAM_CONSTRAINTS = 1
# Capped at 2: a third franchise crowds out the categories that make a board
# interesting, and franchise-heavy boards are where the "just look it up"
# feeling came from.
MAX_TEAM_CONSTRAINTS = 2

# Phase 11C: a board may carry AT MOST ONE PEAK3 score/component axis, and on
# most dates carries none. This is the hard ceiling; _native_allowance() is
# what decides whether a given date gets its one.
MAX_PEAK3_NATIVE = 1

MIN_CATEGORIES = 4            # distinct categories among the six axes
MAX_PER_CATEGORY = 2          # no category may own a whole axis

# Season context (minutes, games played) is a real basketball fact and a good
# second condition, but two context axes crossed with each other is an
# availability quiz rather than a puzzle.
MAX_CONTEXT_CONSTRAINTS = 1

# Every board needs at least two constraints a fan can anchor on that are not
# a franchise, a position or a workload line: awards, playoff outcomes, eras.
# Raised from 1 in 11C -- with the PEAK3-native axes gone there is room for
# them, and they are what makes "Lakers x MVP" rather than "Lakers x Center".
MIN_ANCHOR_CONSTRAINTS = 2

# Categories that a casual fan recognizes without knowing PEAK3 at all.
_RECOGNIZABLE = frozenset({"team", "award", "era", "position", "outcome", "context"})
_PEAK3_NATIVE = frozenset({"peak", "component"})
# "Interesting on their own" -- the categories that carry basketball meaning
# beyond roster membership, listed height and minutes played.
_ANCHOR = frozenset({"award", "outcome", "era"})
# The categories that, alone, make a board feel like a lookup table.
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

# How often a date is allowed its one PEAK3-native axis. One date in five, so
# the formula still appears on an axis occasionally (it is part of what this
# product is) without being the shape of the game. Chosen off the SEED rather
# than the calendar so it cannot line up with a weekday and become predictable.
_SPICE_MODULUS = 5

# On a spice date, attempts spent insisting the board actually uses its
# allowance before accepting a plain zero-native board. Deterministic (a
# function of the attempt counter, not the clock), so the preference can never
# cost a date its board.
_PREFER_SPICE_UNTIL_ATTEMPT = 2500

# Attempts before giving up on a date. Sized to leave real headroom above
# _PREFER_SPICE_UNTIL_ATTEMPT rather than sitting just above the observed
# worst case (~2,700 attempts over a 365-day sample of v2 boards).
_MAX_ATTEMPTS = 8000


def _native_allowance(seed: int) -> int:
    """How many PEAK3 score/component axes this date's board may carry: 1 on a
    spice date, 0 otherwise. Never more than MAX_PEAK3_NATIVE.

    Pure function of the seed, so it is as deterministic as the rest of
    generation -- the same date gets the same allowance forever.
    """
    return MAX_PEAK3_NATIVE if seed % _SPICE_MODULUS == 0 else 0


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
    theme: str
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
            # Safe to expose: derived from the axis labels the client already
            # has, so it carries no answer information the board did not.
            "theme": self.theme,
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
# Re-measured for the Phase 11C composition rules (P33 = 67, P66 = 122 over a
# 365-day sample). Dropping the PEAK3-native axes -- which were the tightest
# constraints in the taxonomy -- widened every cell, and stale thresholds would
# have quietly relabelled almost the whole year "easy".
_DIFFICULTY_HARD_BELOW = 67
_DIFFICULTY_MEDIUM_BELOW = 122


# ---------------------------------------------------------------------------
# Board theme
# ---------------------------------------------------------------------------

# Constraint ids whose subject is defence. Named explicitly rather than
# pattern-matched on the label, so renaming a label cannot silently change a
# board's theme.
_DEFENSIVE_CONSTRAINT_IDS = frozenset(
    {"award_dpoy", "award_dpoy_votes", "award_all_defense", "award_all_defense_first"}
)
_MODERN_ERA_IDS = frozenset({"era_2010s", "era_2020s"})
_THROWBACK_ERA_IDS = frozenset({"era_1980s", "era_1990s"})


def board_theme(rows: Sequence[Constraint], cols: Sequence[Constraint]) -> str:
    """A short name for what this board is ABOUT.

    Read off the axes the board actually has -- it is a description, never a
    generation input, so it cannot drift from the board it labels and cannot
    influence which board a date gets. Rules are checked in order and the first
    match wins, which keeps it a pure function of the axis set: two boards with
    the same axes always get the same theme.
    """
    axes = list(rows) + list(cols)
    ids = {c.id for c in axes}
    categories = [c.category for c in axes]

    if categories.count("outcome") >= 2:
        return "Ring Chasers"
    if categories.count("award") >= 2:
        return "Award Season"
    if ids & _DEFENSIVE_CONSTRAINT_IDS:
        return "Two-Way Night"
    if categories.count("team") >= 2:
        return "Franchise Icons"
    if categories.count("outcome") >= 1:
        return "Playoff Pressure"
    if ids & _MODERN_ERA_IDS:
        return "Modern Era"
    if ids & _THROWBACK_ERA_IDS:
        return "Throwback Night"
    return "Open Court"


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
    rows: Sequence[Constraint],
    cols: Sequence[Constraint],
    attempt: int = 1,
    native_allowance: int = 0,
) -> bool:
    """Cheap structural rejects, run before any answer-set work.

    `native_allowance` is this date's ceiling on PEAK3 score/component axes --
    0 on an ordinary date, 1 on a spice date (see _native_allowance).

    `attempt` drives one soft preference: on a spice date the first
    _PREFER_SPICE_UNTIL_ATTEMPT attempts must actually USE the allowance,
    after which a zero-native board is accepted too. Expressed as a function of
    the attempt counter rather than a separate pass so the whole generator
    stays a pure function of the seed.
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

    if categories.count("context") > MAX_CONTEXT_CONSTRAINTS:
        return False

    # Phase 11C: the score/component axes are capped by the date's allowance,
    # which is 0 on four dates in five. See the module docstring for why an
    # axis that restates the scoring objective makes a worse puzzle.
    native_count = sum(1 for cat in categories if cat in _PEAK3_NATIVE)
    if native_count > min(native_allowance, MAX_PEAK3_NATIVE):
        return False
    if native_allowance and attempt <= _PREFER_SPICE_UNTIL_ATTEMPT and native_count == 0:
        return False

    # At least two awards / playoff outcomes / eras. Without this a board can
    # be all franchises, positions and minutes lines -- every square answerable
    # by scanning a roster, none of them by knowing basketball.
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
    native_allowance = _native_allowance(seed)

    # Masks are computed once per constraint and reused across every attempt;
    # recomputing them per attempt is what would make generation slow.
    masks: dict[str, np.ndarray] = {
        constraint.id: constraint.matches(grid_pool.frame) for constraint in taxonomy
    }

    for attempt in range(1, _MAX_ATTEMPTS + 1):
        picked = rng.sample(taxonomy, 2 * GRID_SIZE)
        rows, cols = picked[:GRID_SIZE], picked[GRID_SIZE:]

        if not _composition_ok(rows, cols, attempt, native_allowance):
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
            theme=board_theme(rows, cols),
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
