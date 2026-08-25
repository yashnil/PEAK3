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

`version` itself is a pure function of the date when a caller does not pin
one explicitly -- see NOVELTY_CUTOVER_DATE and `_version_for_date()`. A
taxonomy revision (new constraint ids, a new composition or novelty rule)
changes what `rng.sample()` returns for EVERY date once the population it
samples from changes shape, so "same date always resolves the same" and
"the taxonomy may still evolve" can only both be true if a date on the far
side of a revision keeps resolving through the taxonomy (and version salt)
that was actually in force when it shipped. The cutover date is that
boundary, threaded through grid_seed/board_id/generation rather than left to
whatever DAILY_GRID_VERSION happens to equal today.

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
from datetime import datetime, timedelta
from typing import Optional, Sequence

import numpy as np

from nba_peak.daily_grid.constraints import (
    Constraint,
    V3_ADDED_CONSTRAINT_IDS,
    all_constraints,
)
from nba_peak.daily_grid.pool import GridPool, load_pool
from nba_peak.daily_key import (
    InvalidDailyKey,
    daily_key,
    parse_daily_key,
    validate_daily_key,
)

# v2: Phase 11C. The composition rules changed enough that every date's board
# changes, so the version salt moves with them -- a v1 board_id must never
# resolve to a v2 board (it is also the client's progress key).
DAILY_GRID_VERSION_V2 = "daily_grid.v2"

# v3: adds Sixth Man of the Year / Most Improved Player (constraints.py),
# explicit season-validity gating, and the novelty/cooldown system below that
# keeps a specific axis or axis PAIR from reappearing too soon. Effective
# only for a board date strictly after NOVELTY_CUTOVER_DATE -- see
# _version_for_date(). A v2 date must keep resolving under v2 forever, which
# is the whole reason this is a new symbol rather than a reassignment of the
# old one.
DAILY_GRID_VERSION_V3 = "daily_grid.v3"

# The symbol every external caller imports as "the current taxonomy version".
# Code that needs to know what a SPECIFIC DATE's board actually resolves
# under -- generation, the seed, the board id -- must go through
# _version_for_date(date_str), never this constant directly, because a date
# at or before the cutover has to keep resolving under v2 even after this
# constant moves on to v4, v5, etc.
DAILY_GRID_VERSION = DAILY_GRID_VERSION_V3

# THE CUTOVER. A board date <= this value resolves EXACTLY as it always has:
# same version salt (v2), same frozen v2 taxonomy (no Sixth Man of the Year /
# Most Improved Player, no novelty system), same seed, same board_id -- see
# _legacy_v2_taxonomy(). Only a date strictly AFTER this picks up v3. Set to
# the date this taxonomy revision shipped, so no board a real player could
# already have seen (today's included) is touched.
NOVELTY_CUTOVER_DATE = "2026-08-25"


def _version_for_date(date_str: str) -> str:
    """Which taxonomy version `date_str` resolves under, absent an explicit
    override.

    Plain string comparison: YYYY-MM-DD sorts chronologically, and the caller
    is always a date that has already been through validate_grid_date. Pure
    and total -- every date is on exactly one side of the cutover.
    """
    return (
        DAILY_GRID_VERSION_V2
        if date_str <= NOVELTY_CUTOVER_DATE
        else DAILY_GRID_VERSION_V3
    )


def _legacy_v2_taxonomy(taxonomy: Sequence[Constraint]) -> list[Constraint]:
    """Reconstruct the EXACT v2 constraint list -- same members, same
    relative order -- by filtering the v3-added ids back out of the current
    full taxonomy.

    Why filtering rather than maintaining a second registry: constraints.py
    only ever APPENDS new constraints to the end of their category block (its
    own stated convention), so removing exactly the ids that did not exist in
    v2 reproduces v2's list byte-for-byte in composition -- and generation
    samples from this list by index against a date-seeded RNG
    (`rng.sample(taxonomy, ...)`), so the length and order of the population
    passed in is itself part of what a legacy date's determinism depends on.
    Silently leaving new constraints in for an old date would reshuffle what
    every past board resolves to, even the ones nothing about this change
    touches.
    """
    return [c for c in taxonomy if c.id not in V3_ADDED_CONSTRAINT_IDS]

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

# ---------------------------------------------------------------------------
# Novelty / cooldown (v3+) -- see NOVELTY_CUTOVER_DATE above.
#
# THE GAP THIS CLOSES. Composition rules (above) make any SINGLE board read
# like a basketball puzzle; nothing before this stopped the same axis, or the
# same axis PAIR ("Lakers x MVP"), from resolving again on a nearby date --
# the generator had no notion of what recent boards even were. That is the
# repetition players actually notice, and it is a cross-DAY property, so it
# cannot be fixed inside `_composition_ok`, which only ever sees one board.
#
# DESIGN. Before sampling a date's board, `_recent_usage` records, for every
# constraint id and every (row, col) CELL PAIR seen on the most recently
# published v3 boards (never crossing the cutover -- a legacy board's axes
# are not part of this bookkeeping), how many boards ago that was.
#
# Id-level cooldown is then enforced by REMOVING those ids from the
# population `rng.sample` draws from (see `_cooling_down_ids` in
# `_generate_core`), not by rejecting six-axis candidates that happen to
# contain one after the fact. That distinction matters more than it looks: an
# early version of this pass rejected post-hoc instead, and because
# composition already makes a random six-axis draw succeed only rarely (the
# anchor categories -- award/outcome/era -- have the smallest pools, so the
# combinations composition actually accepts are concentrated there), an id
# cooldown checked ex-post compounds that rarity multiplicatively rather than
# adding to it -- the model-layer simulation measured it burning nearly the
# whole attempt budget on most dates. Filtering the population up front means
# every draw already satisfies the id cooldown, so composition keeps its
# original odds and only the much rarer PAIR cooldown (`_pair_novelty_ok`)
# still needs to reject after the fact.
#
# WHY THIS CANNOT STARVE GENERATION. The soft/hard split below (
# _PREFER_NOVELTY_UNTIL_ATTEMPT) is the safety margin: the strict phase gets a
# real budget of attempts against the filtered population, and if it does not
# succeed inside that budget, generation falls back to the UNFILTERED
# taxonomy for its remaining attempts -- identical to composition-only
# generation, whose own worst case is far below the remaining budget (see the
# model-layer simulation). A date's board is therefore never allowed to fail
# purely because novelty could not be satisfied, exactly the same shape as
# the existing spice preference above -- and CRITICALLY so: an actual
# BoardGenerationFailed on any past v3 date would permanently break every
# later date too, since `_recent_usage` needs that date's board to compute
# ITS OWN history.

# An axis id used on any of the last this-many published boards may not
# reappear. Sized empirically, not just relative to the taxonomy's raw count:
# the categories composition leans on hardest (award/outcome/era, the anchor
# pools) are also its SMALLEST, so the id cooldown was measured directly (see
# scripts/audit_daily_grid_novelty.py) against composition rather than
# assumed safe from pool size alone. 6 boards produced generation attempts
# that regularly ran past budget once award/era/outcome ids were disqualified
# from a large share of the anchor pool at once; 3 keeps the id-level filter
# (see `_cooling_down_ids`) from ever excluding enough of the anchor
# categories to make composition itself hard to satisfy.
CATEGORY_COOLDOWN_BOARDS = 3

# An exact (row, col) CELL PAIR -- the specific matchup a player actually
# sees, e.g. "Lakers x MVP" -- may not reappear for longer. Pairs have far
# more headroom than single ids (thousands of possible id combinations
# against nine consumed per board), so this window can be, and is, longer
# than the per-id one without risking the same starvation. Also tuned
# empirically alongside CATEGORY_COOLDOWN_BOARDS rather than picked from pool
# size alone, for the same reason.
PAIR_COOLDOWN_BOARDS = 10

# How many boards of history `_recent_usage` actually walks. Must cover the
# longer of the two cooldowns above.
NOVELTY_HISTORY_WINDOW = max(CATEGORY_COOLDOWN_BOARDS, PAIR_COOLDOWN_BOARDS)

# Attempts spent insisting on the strict novelty filter before falling back to
# ordinary (non-novelty-filtered) generation, drawing from the FULL taxonomy.
# Mirrors _PREFER_SPICE_UNTIL_ATTEMPT: a preference, never a requirement that
# could cost a date its board. The gap to _MAX_ATTEMPTS below (4,000 attempts)
# is deliberately generous -- several times the worst composition-only
# attempt count measured over a multi-year simulation (see
# scripts/audit_daily_grid_novelty.py) -- because an actual
# BoardGenerationFailed on any v3 date does not just cost that date: every
# LATER date's `_recent_usage` needs this date's board to compute its own
# history, so a single exhausted budget here would permanently break
# generation for every date after it.
_PREFER_NOVELTY_UNTIL_ATTEMPT = 4000

# Per-date (row ids, col ids) for every v3 date this process has ever
# generated -- see `_axis_fingerprint_for`. Deliberately NOT bounded like
# `_CORE_CACHE`: it holds six short strings per date rather than a full
# answer key, and decoupling it from `_CORE_CACHE`'s eviction is what makes
# `_recent_usage` safe against both the quadratic-cost and the
# RecursionError failure modes documented on that function. Process-global,
# same "a fresh process just re-derives it" guarantee as every other cache
# here: it is a performance cache of "what did this date's board already
# turn out to be", never an input any board's content depends on.
_AXIS_FINGERPRINT_CACHE: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {}


def _native_allowance(seed: int) -> int:
    """How many PEAK3 score/component axes this date's board may carry: 1 on a
    spice date, 0 otherwise. Never more than MAX_PEAK3_NATIVE.

    Pure function of the seed, so it is as deterministic as the rest of
    generation -- the same date gets the same allowance forever.
    """
    return MAX_PEAK3_NATIVE if seed % _SPICE_MODULUS == 0 else 0


class InvalidGridDate(InvalidDailyKey):
    """Raised for a date string that is not a real YYYY-MM-DD calendar date.

    Subclasses ``InvalidDailyKey`` (itself a ``ValueError``) so the shared
    daily-key validator's failures arrive here under the name this package's
    callers already catch, and so a caller that catches either one is right.
    """


class BoardGenerationFailed(RuntimeError):
    """No composition-valid, solvable board found for a date.

    Should be unreachable with the shipped taxonomy; raised rather than
    returning a degraded board because publishing an unsolvable grid is worse
    than failing loudly.
    """


# How far back a *request* may reach. Every past Daily Grid board is
# permanently addressable by design -- the streak rule in
# apps/web/src/lib/daily-grid-archive.ts is built on it, and history links
# point at boards by date forever -- so this bound exists only to keep the
# key finite, not to retire the archive. The future, by contrast, is closed:
# a board that has not opened yet must not be enumerable.
GRID_ARCHIVE_DAYS = 36_525  # a century


def today_utc_date(now: datetime | None = None) -> str:
    """Today's board date as YYYY-MM-DD, in the product-wide daily reset zone.

    THE NAME IS A MISNOMER AND THE BEHAVIOUR IS CORRECT -- not the other way
    round. This is a one-line re-export of ``nba_peak.daily_key.daily_key``, so
    it returns the **America/Los_Angeles** date, never a UTC one. The name is
    left alone deliberately: it is imported by the API router, both API test
    modules and the model tests, and renaming it would be a wide rename that
    changes no behaviour. New code should import ``daily_key`` directly; this
    exists so the Daily Grid package keeps a single, obvious "what is today"
    entry point for its existing callers.

    (UTC was the wrong boundary in exactly the way the name suggests it was
    right, which is why the decision now lives in one place instead of being
    restated per game.)
    """
    return daily_key(now)


def validate_grid_date(date_str: str) -> str:
    """Return `date_str` if it is a real YYYY-MM-DD date, else raise.

    SHAPE ONLY, on purpose. A board is a pure function of its date, so any
    calendar date -- including one years from now -- names exactly one board,
    and the generator/test surfaces depend on being able to build them. What a
    *client* is allowed to ask for is a separate question, answered by
    `validate_grid_request_date`.
    """
    try:
        return parse_daily_key(date_str).strftime(DATE_FORMAT)
    except InvalidDailyKey as exc:
        raise InvalidGridDate(
            f"date must be a real YYYY-MM-DD date, got '{date_str}'"
        ) from exc


def validate_grid_request_date(date_str: str, *, now: datetime | None = None) -> str:
    """Validate a CLIENT-supplied board date against the server's clock.

    Rejects a future date (that board has not opened) and anything past the
    archive bound. The server, never the browser, decides what "today" is --
    callers pass `date or today_utc_date()`.
    """
    try:
        return validate_daily_key(date_str, now=now, max_age_days=GRID_ARCHIVE_DAYS)
    except InvalidGridDate:
        raise
    except InvalidDailyKey as exc:
        raise InvalidGridDate(str(exc)) from exc


def grid_seed(date_str: str, version: str | None = None) -> int:
    """The deterministic board seed for one date.

    Pure: no clock read, no randomness, no I/O. `version` is part of the salt
    so a future taxonomy revision can reshuffle boards intentionally without
    colliding with an earlier version's history. Left as None (the default),
    it resolves via `_version_for_date` -- v2 for a date at or before
    NOVELTY_CUTOVER_DATE, v3 after -- so a legacy date keeps its original
    seed even after DAILY_GRID_VERSION itself moves on.
    """
    validate_grid_date(date_str)
    resolved_version = version if version is not None else _version_for_date(date_str)
    raw = f"{_SEED_NAMESPACE}:{resolved_version}:{date_str}"
    return int(hashlib.sha256(raw.encode()).hexdigest(), 16) % _SEED_MODULUS


def board_id(date_str: str, version: str | None = None) -> str:
    """Stable id for one daily board, e.g. 'daily-grid-v2-2026-07-30'.

    Used as the client-side progress key, so it must stay stable for a given
    (date, version) forever -- and must CHANGE when the date changes, which
    is what makes yesterday's saved progress fall away on its own. `version`
    resolves the same way as in `grid_seed` when left as None.
    """
    validate_grid_date(date_str)
    resolved_version = version if version is not None else _version_for_date(date_str)
    short_version = resolved_version.split(".")[-1]
    return f"daily-grid-{short_version}-{date_str}"


# How many hex characters of the SHA-256 digest a board hash keeps. 16 hex
# chars = 64 bits: far beyond collision range for a few thousand daily boards,
# short enough to eyeball in a log line or a test failure.
BOARD_HASH_LENGTH = 16


def board_hash(
    rows: Sequence[Constraint],
    cols: Sequence[Constraint],
    version: str = DAILY_GRID_VERSION,
) -> str:
    """A stable digest of a board's CRITERIA SIGNATURE: its row ids, its column
    ids and the taxonomy version.

    What it is for: a client (or a test, or the freshness audit) can compare two
    boards for "is this actually the same puzzle?" without shipping the answer
    key, without trusting the date label, and without diffing twelve constraint
    objects. Two dates whose boards carry the same hash are the same puzzle;
    two dates whose hashes differ are not, whatever their themes say.

    ORDER-SENSITIVE ON PURPOSE. The same six constraints arranged with the rows
    and columns swapped is a different board to play -- different cells, a
    different optimal assignment -- so it gets a different hash. Sorting the ids
    first would have made the hash agree with the lead's "sorted criteria"
    freshness probe while disagreeing with the game.

    Carries no answer information: it is computed from ids the response already
    contains in full, and SHA-256 is one-way, so it reveals strictly less than
    the payload it summarises.
    """
    row_ids = ",".join(c.id for c in rows)
    col_ids = ",".join(c.id for c in cols)
    raw = f"{_SEED_NAMESPACE}:board-hash:{version}|rows={row_ids}|cols={col_ids}"
    return hashlib.sha256(raw.encode()).hexdigest()[:BOARD_HASH_LENGTH]


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
    # Stable slug for `theme`, e.g. "two-way-night". Defaulted so the handful
    # of hand-built GridBoards in tests keep working; __post_init__ derives it
    # from the display string when it is not supplied, so the two can never
    # disagree on a board that came out of the generator.
    theme_id: str = ""

    def __post_init__(self) -> None:
        if not self.theme_id:
            object.__setattr__(
                self, "theme_id", THEME_IDS_BY_LABEL.get(self.theme, _slugify(self.theme))
            )

    @property
    def board_hash(self) -> str:
        """Digest of this board's criteria signature -- see `board_hash()`."""
        return board_hash(self.rows, self.cols, self.version)

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
            # Stable machine key for the same thing, so a client can style or
            # switch on the theme without string-matching display copy.
            "theme_id": self.theme_id,
            # A one-way digest of the row/col ids already listed below. Lets a
            # client prove "this is a different puzzle to the one I had cached"
            # in one comparison. See `board_hash()`.
            "board_hash": self.board_hash,
            # SAFE TO EXPOSE, and re-verified before it was (Phase 12, T2).
            # The seed is `sha256("peak3-daily-grid:<version>:<date>") % 2**31`
            # -- open, unkeyed, no server secret anywhere in the derivation --
            # so any client could already compute it for any date, past or
            # future, from published code. Its only consumers are the axis
            # sampler (whose output IS `rows`/`cols` below) and
            # `_native_allowance`. It is not an input to any answer set: a
            # cell's answers are (axes x committed player pool), and the pool
            # is what is actually withheld. Nothing signs with it and nothing
            # derives a token from it. Publishing it therefore adds exactly
            # zero information a caller did not already hold.
            "seed": self.seed,
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
#
# THE DEFECT THIS SECTION FIXES (Phase 12, D5 -- the reported "stale board").
#
# Board GENERATION was never stale: over 365 consecutive daily keys the seeds,
# the sorted-criteria hashes and the board ids are 365/365 distinct. What
# repeated was the LABEL. The old `board_theme` was a memoryless first-match
# ladder over eight rules, and measured over 365 days it produced:
#
#     adjacent-day identical theme      93/364 = 25.5 %
#     ... identical theme AND difficulty 42/364 = 11.5 %
#     longest identical-theme run        6 days
#     Award Season                     141/365 = 38.6 %
#     Open Court                         0/365   (unreachable: it was the
#                                                 no-match fallback, and some
#                                                 rule always matched)
#
# 2026-07-31 and 2026-08-01 were identical in both theme and difficulty. The
# theme is the most prominent identity on the page, so one day in four a
# genuinely-new board read as yesterday's.
#
# TWO CHANGES:
#
# 1. A board no longer has ONE true description, it has a RANKED LIST of them
#    (`theme_candidates`), ordered rarest-predicate-first. Ordering by rarity is
#    what flattens the distribution: a common description only wins when no
#    rarer one is true. "Open Court" stops being a fallback and gets a real
#    rule -- a board whose axes are about who was on the floor (positions,
#    minutes, games) rather than hardware.
#
# 2. `resolve_theme_id` picks, from that list, the first description that was
#    NOT also true of yesterday's board. Today's label is therefore something
#    yesterday's board could not have been called, which makes an adjacent
#    repeat structurally impossible rather than statistically unlikely.
#
# WHAT IS PRESERVED. The theme is still a DESCRIPTION, never a generation
# input: `_board_core` -- which decides which six constraints a date gets -- is
# computed before any theme work and cannot see a theme. The anti-repeat term
# reads only the daily key and its predecessor key, both of which are already
# public (every past board is permanently addressable), so which board a date
# gets is bit-for-bit what it was before this change.

# Constraint ids whose subject is defence. Named explicitly rather than
# pattern-matched on the label, so renaming a label cannot silently change a
# board's theme.
_DEFENSIVE_CONSTRAINT_IDS = frozenset(
    {"award_dpoy", "award_dpoy_votes", "award_all_defense", "award_all_defense_first"}
)
_MODERN_ERA_IDS = frozenset({"era_2010s", "era_2020s"})
_THROWBACK_ERA_IDS = frozenset({"era_1980s", "era_1990s"})
# "Open Court": the board is asking who was actually on the floor -- listed
# position, minutes per game, games played -- rather than what they won.
_OPEN_COURT_CATEGORIES = frozenset({"position", "context"})

#: Every theme the game can print, `theme_id -> display label`.
#:
#: ORDER IS THE PRIORITY ORDER, rarest applicable predicate first (measured
#: over 1,100 consecutive daily keys: outcome>=2 9.9 %, throwback 30.6 %,
#: defence 39.7 %, modern 40.2 %, award>=2 40.3 %, team>=2 60.5 %,
#: outcome>=1 67.5 %, position-or-context ~92 %). A dict preserves insertion
#: order, and `theme_candidates` walks it once.
THEME_LABELS: "OrderedDict[str, str]" = OrderedDict(
    (
        ("ring-chasers", "Ring Chasers"),
        ("throwback-night", "Throwback Night"),
        ("two-way-night", "Two-Way Night"),
        ("modern-era", "Modern Era"),
        ("award-season", "Award Season"),
        ("franchise-icons", "Franchise Icons"),
        ("playoff-pressure", "Playoff Pressure"),
        ("open-court", "Open Court"),
    )
)

#: Reverse map, for reconstructing an id from a stored/hand-written label.
THEME_IDS_BY_LABEL: dict[str, str] = {label: key for key, label in THEME_LABELS.items()}


def _slugify(label: str) -> str:
    """Last-resort id for a label that is not in the shipped taxonomy.

    Only reachable for a hand-constructed GridBoard (tests build a couple), so
    it is deliberately trivial rather than a general slugifier.
    """
    return "-".join(part for part in label.lower().replace("/", " ").split() if part)


def theme_candidates(
    rows: Sequence[Constraint], cols: Sequence[Constraint]
) -> tuple[str, ...]:
    """Every theme id that TRUTHFULLY describes this axis set, rarest first.

    A pure function of the axis set -- two boards with the same axes always get
    the same candidate list -- and every entry is a statement that is actually
    true of the board, so whichever one is finally shown is never a lie about
    what the player is looking at.

    Guaranteed non-empty, and in practice always at least two long: the
    composition rules force at least one team axis and at least two
    award/outcome/era anchors onto every published board, and the last rule
    below fires on any position or season-context axis. `resolve_theme_id`
    needs that headroom -- a board with only one true description could not
    avoid repeating it.
    """
    axes = list(rows) + list(cols)
    ids = {c.id for c in axes}
    categories = [c.category for c in axes]

    candidates: list[str] = []
    if categories.count("outcome") >= 2:
        candidates.append("ring-chasers")
    if ids & _THROWBACK_ERA_IDS:
        candidates.append("throwback-night")
    if ids & _DEFENSIVE_CONSTRAINT_IDS:
        candidates.append("two-way-night")
    if ids & _MODERN_ERA_IDS:
        candidates.append("modern-era")
    if categories.count("award") >= 2:
        candidates.append("award-season")
    if categories.count("team") >= 2:
        candidates.append("franchise-icons")
    if categories.count("outcome") >= 1:
        candidates.append("playoff-pressure")
    if any(category in _OPEN_COURT_CATEGORIES for category in categories):
        candidates.append("open-court")

    if not candidates:
        # Unreachable with the shipped composition rules (every board carries a
        # team axis and two anchors), but a board must never be unlabelled.
        candidates.append("open-court")
    return tuple(candidates)


def board_theme(rows: Sequence[Constraint], cols: Sequence[Constraint]) -> str:
    """The board's PRIMARY description, as a display label.

    The rarest true statement about these axes, ignoring what yesterday's board
    was called. Still a pure function of the axis set, and still the value a
    caller wants when it has axes but no date -- for instance a hand-built
    board in a test.

    The published label goes one step further and skips a description that was
    also true yesterday; see `resolve_theme_id`, which is what
    `generate_board` actually calls.
    """
    return THEME_LABELS[theme_candidates(rows, cols)[0]]


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
# Novelty / cooldown (v3+) -- see the constants block above for the design
# note and NOVELTY_CUTOVER_DATE for why this never touches a legacy board.
# ---------------------------------------------------------------------------

def _next_date(date_str: str) -> Optional[str]:
    """The calendar day after `date_str`, or None at the edge of the
    calendar. Mirror of `_previous_date`, used to walk FORWARD."""
    try:
        return (parse_daily_key(date_str) + timedelta(days=1)).strftime(DATE_FORMAT)
    except (InvalidDailyKey, OverflowError, ValueError):
        return None


def _axis_fingerprint_for(
    date_str: str, pool: GridPool | None
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """The (row ids, col ids) a v3 date's board actually used -- generating it
    first if this is the first time this date has ever been asked for.

    THE FIX FOR TWO DISTINCT PERFORMANCE/CORRECTNESS FAILURES THIS PASS HIT.
    `_recent_usage` needs to know, for potentially many historical dates, only
    six short constraint ids each -- not the full `_BoardCore` (seed, cells,
    the whole answer key). Reading that fact through `_board_core` directly
    ties novelty history to `_CORE_CACHE`'s LRU bound, which produced two
    failure modes in the model-layer simulation and test suite:

      1. QUADRATIC BLOWUP. A first design re-primed from the cutover on every
         call. Once more dates had been generated than `_CORE_CACHE` holds,
         "prime from the cutover" started re-GENERATING the evicted earliest
         ones, on every subsequent call, each eviction making room for
         another -- turning single-digit milliseconds per day into tens of
         seconds within the first ~400 days.

      2. RECURSIONERROR ON ARCHIVE ACCESS. A second design tracked a forward
         high-water mark to stop re-priming already-visited dates -- which
         fixed (1), but not the case where an OLDER date's own short lookback
         window had since been evicted by unrelated LATER activity (exactly
         what browsing the permanently-addressable archive is): regenerating
         it recursed into `_generate_core` -> `_recent_usage` for each
         missing predecessor, which needed ITS OWN evicted predecessors, and
         so on, a call stack as deep as the evicted stretch was wide.

    This cache is the actual fix for both: a plain dict, keyed by date,
    holding just the two short id tuples. It is deliberately NOT subject to
    `_CORE_CACHE`'s bound -- six strings times a few thousand dates is a
    trivial amount of memory next to a full `_BoardCore` (whose `cells` carry
    the entire answer key), so there is no meaningful cost to letting this
    one grow for the life of the process. Once a date's fingerprint is
    recorded here, ANY later call -- forward priming, a backward lookback,
    an archive replay years later -- is a dict lookup, never a
    re-generation. Determinism is unaffected either way: the fingerprint
    recorded is always the output of the same deterministic `_board_core`
    call this replaces, just computed at most once per date per process.
    """
    cached = _AXIS_FINGERPRINT_CACHE.get(date_str)
    if cached is not None:
        return cached
    core = _board_core(date_str, pool, None, DAILY_GRID_VERSION_V3)
    fingerprint = (
        tuple(c.id for c in core.rows),
        tuple(c.id for c in core.cols),
    )
    _AXIS_FINGERPRINT_CACHE[date_str] = fingerprint
    return fingerprint


def _recent_usage(
    date_str: str,
    pool: GridPool | None,
    window: int = NOVELTY_HISTORY_WINDOW,
) -> tuple[dict[str, int], dict[frozenset[str], int]]:
    """How recently each axis id, and each (row, col) CELL PAIR, appeared on
    a board immediately before `date_str` -- distance 1 = the board
    immediately before this one, 2 = the one before that, and so on. Only the
    FIRST (smallest) distance for a given id/pair is kept, which is all
    `_novelty_ok` needs to compare against a cooldown.

    Stops at NOVELTY_CUTOVER_DATE rather than walking into legacy boards:
    those ran a different taxonomy (no Sixth Man of the Year / Most Improved
    Player) under a different version salt, and are not part of this
    bookkeeping. Always reads history through `_axis_fingerprint_for` -- the
    real default taxonomy, never a caller-supplied one -- which is why
    `_generate_core` only calls this when its OWN `constraints` argument is
    None; see there.

    WHY THE FORWARD PRIMING PASS BELOW, RATHER THAN JUST WALKING BACKWARD.
    Determinism requires that history be the ACTUAL generated predecessor
    boards, not "whatever happens to be cached" -- so an unfingerprinted
    predecessor cannot simply be skipped, it has to be generated once. A
    naive backward walk that generates one on demand would, for THAT
    predecessor, recurse into this exact function again for ITS OWN
    predecessors -- and so on, all the way back to the cutover for a date
    requested "cold" (e.g. a test, or a real archive click, that reaches a
    date far past the cutover with nothing nearby already generated). That is
    a call stack whose depth is the distance from the cutover, which can and
    does exceed Python's recursion limit long before it exceeds any real time
    budget.

    Priming forward instead -- oldest first, via a plain loop rather than
    recursion -- guarantees that by the time day K is generated, days
    K-1..K-window are already fingerprinted, so ITS OWN call into this
    function finds a fully warm cache and never re-enters generation. The
    call stack never grows past a small constant, regardless of how far
    `date_str` is from the cutover -- and because `_axis_fingerprint_for`'s
    cache never evicts, this loop's per-date cost is a dict lookup for every
    date this process has ever visited before, not just the most recent
    `_CORE_CACHE_MAX` of them.
    """
    cursor = _next_date(NOVELTY_CUTOVER_DATE)
    while cursor is not None and cursor < date_str:
        _axis_fingerprint_for(cursor, pool)
        cursor = _next_date(cursor)

    id_last_seen: dict[str, int] = {}
    pair_last_seen: dict[frozenset[str], int] = {}
    cursor = date_str
    for distance in range(1, window + 1):
        cursor = _previous_date(cursor)
        if cursor is None or cursor <= NOVELTY_CUTOVER_DATE:
            break
        row_ids, col_ids = _axis_fingerprint_for(cursor, pool)
        for constraint_id in row_ids + col_ids:
            id_last_seen.setdefault(constraint_id, distance)
        for row_id in row_ids:
            for col_id in col_ids:
                pair_last_seen.setdefault(frozenset((row_id, col_id)), distance)
    return id_last_seen, pair_last_seen


def _cooling_down_ids(id_last_seen: dict[str, int]) -> frozenset[str]:
    """The ids still inside CATEGORY_COOLDOWN_BOARDS, per `_recent_usage`.

    Split out from the pair check (below) rather than folded into one
    "reject the candidate" predicate like `_composition_ok`: an id-level
    cooldown is cheapest and most effective enforced by REMOVING those ids
    from the population `rng.sample` draws from in the first place (see
    `_generate_core`), not by rejecting six-axis candidates after the fact.
    Composition already makes a random six-axis draw succeed only rarely
    (roughly one draw in a few hundred, by the pre-novelty measurement this
    pass shipped with); rejecting AGAIN post-hoc for an id cooldown compounds
    that rarity multiplicatively; because the axes composition actually needs
    are concentrated in a fairly small recurring subset (the anchor
    categories -- award/outcome/era -- have the smallest pools), that subset
    is exactly what tends to be cooling down, and attempts to satisfy both
    constraints by pure rejection sampling were observed (in the model-layer
    simulation) to burn nearly the entire attempt budget on most dates.
    Pre-filtering the population removes the compounding: every draw already
    satisfies the id cooldown, so only composition (back to its normal odds)
    and the much rarer pair cooldown remain to be rejection-sampled.
    """
    return frozenset(
        cid for cid, seen in id_last_seen.items() if seen <= CATEGORY_COOLDOWN_BOARDS
    )


def _pair_novelty_ok(
    rows: Sequence[Constraint],
    cols: Sequence[Constraint],
    pair_last_seen: dict[frozenset[str], int],
) -> bool:
    """Does this candidate board avoid every (row, col) CELL PAIR still
    inside PAIR_COOLDOWN_BOARDS, per the history `_recent_usage` computed?

    Id-level cooldown is handled by pre-filtering the sample population (see
    `_cooling_down_ids`), not here -- by the time a candidate reaches this
    check every one of its ids is already known-fresh, so this only ever
    needs to reject on the pair, a much smaller and rarer set of
    combinations. Cheap dict lookups only, the same performance shape as
    `_composition_ok`.
    """
    for row in rows:
        for col in cols:
            seen = pair_last_seen.get(frozenset((row.id, col.id)))
            if seen is not None and seen <= PAIR_COOLDOWN_BOARDS:
                return False
    return True


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class _BoardCore:
    """Everything a date's board is, EXCEPT its label.

    Split out so the theme resolver can read yesterday's axes without calling
    `generate_board`, which would ask for yesterday's theme, which would ask
    for the day-before's axes -- an unbounded walk backwards down the calendar.
    The core is the recursion-free half: a pure function of
    (date, version, taxonomy) that never consults another date.
    """

    seed: int
    rows: tuple[Constraint, ...]
    cols: tuple[Constraint, ...]
    cells: tuple[GridCell, ...]
    attempts: int


def _generate_core(
    date_str: str,
    pool: GridPool | None,
    constraints: Sequence[Constraint] | None,
    version: str,
) -> _BoardCore:
    """The seeded search for a composition-valid, solvable board."""
    validate_grid_date(date_str)
    grid_pool = pool if pool is not None else load_pool()
    using_default_taxonomy = constraints is None
    taxonomy = list(constraints) if constraints is not None else all_constraints(
        pool if pool is not None else None
    )

    # A legacy date (version resolved to v2) generates from the FROZEN v2
    # subset of today's taxonomy, never today's full one -- see
    # _legacy_v2_taxonomy(). Only applies to the auto/default taxonomy: a
    # caller that hands its own `constraints` (tests do) gets exactly that
    # list, at every date, unchanged from before this pass.
    if using_default_taxonomy and version == DAILY_GRID_VERSION_V2:
        taxonomy = _legacy_v2_taxonomy(taxonomy)

    seed = grid_seed(date_str, version)
    rng = random.Random(seed)
    native_allowance = _native_allowance(seed)

    # Novelty/cooldown only ever runs for the real default taxonomy on a
    # post-cutover date -- never for a caller-supplied taxonomy (its history
    # would not mean anything) and never for a legacy date (whose board must
    # keep resolving exactly as it always has). See _recent_usage.
    novelty_enabled = using_default_taxonomy and version == DAILY_GRID_VERSION_V3
    pair_last_seen: dict[frozenset[str], int] = {}
    # The population `rng.sample` draws from during the strict-preference
    # phase: the full taxonomy with anything still id-cooling-down removed
    # (see _cooling_down_ids). Falls back to the full taxonomy if cooling
    # down has left too few ids to even draw six from -- vanishingly rare
    # given the taxonomy's size relative to CATEGORY_COOLDOWN_BOARDS, but
    # cheap to guard against.
    fresh_taxonomy = taxonomy
    if novelty_enabled:
        id_last_seen, pair_last_seen = _recent_usage(date_str, pool)
        cooling_down = _cooling_down_ids(id_last_seen)
        candidate_fresh = [c for c in taxonomy if c.id not in cooling_down]
        if len(candidate_fresh) >= 2 * GRID_SIZE:
            fresh_taxonomy = candidate_fresh

    # Masks are computed once per constraint and reused across every attempt;
    # recomputing them per attempt is what would make generation slow.
    masks: dict[str, np.ndarray] = {
        constraint.id: constraint.matches(grid_pool.frame) for constraint in taxonomy
    }

    for attempt in range(1, _MAX_ATTEMPTS + 1):
        # Soft preference, mirroring _PREFER_SPICE_UNTIL_ATTEMPT: insist on
        # novelty for a real budget of attempts (by drawing only from ids
        # that are not cooling down), then accept a repeat rather than ever
        # costing a date its board.
        prefer_novelty = novelty_enabled and attempt <= _PREFER_NOVELTY_UNTIL_ATTEMPT
        sample_from = fresh_taxonomy if prefer_novelty else taxonomy
        picked = rng.sample(sample_from, 2 * GRID_SIZE)
        rows, cols = picked[:GRID_SIZE], picked[GRID_SIZE:]

        if not _composition_ok(rows, cols, attempt, native_allowance):
            continue

        if prefer_novelty and not _pair_novelty_ok(rows, cols, pair_last_seen):
            continue

        cells = _build_cells(rows, cols, grid_pool, masks)
        if cells is None:
            continue

        return _BoardCore(
            seed=seed,
            rows=tuple(rows),
            cols=tuple(cols),
            cells=cells,
            attempts=attempt,
        )

    raise BoardGenerationFailed(
        f"no solvable board for {date_str} after {_MAX_ATTEMPTS} attempts "
        "-- the constraint taxonomy or the solvability floors need review"
    )


# Cores are cached separately from boards, and for the same reason `get_board`
# caches: generation is a pure function of (date, version) over committed data.
# It matters more here than it looks -- resolving one date's theme reads the
# PREVIOUS date's core, so without this cache a sweep over N days would do 2N
# generations instead of N+1. Cells are shared by reference with the GridBoard
# built from the core, so holding both caches does not hold two copies of any
# answer key.
_CORE_CACHE: "OrderedDict[tuple[str, str], _BoardCore]" = OrderedDict()
_CORE_CACHE_MAX = 400


def _board_core(
    date_str: str,
    pool: GridPool | None,
    constraints: Sequence[Constraint] | None,
    version: str,
) -> _BoardCore:
    """Cached `_generate_core`.

    Only the DEFAULT taxonomy is cached. A caller that passes its own `pool` or
    `constraints` (tests do) gets a fresh generation every time, because the
    cache key cannot describe an arbitrary caller-supplied taxonomy and a stale
    hit there would be a silently wrong board.
    """
    cacheable = pool is None and constraints is None
    key = (date_str, version)
    if cacheable:
        cached = _CORE_CACHE.get(key)
        if cached is not None:
            _CORE_CACHE.move_to_end(key)
            return cached
    core = _generate_core(date_str, pool, constraints, version)
    if cacheable:
        _CORE_CACHE[key] = core
        if len(_CORE_CACHE) > _CORE_CACHE_MAX:
            _CORE_CACHE.popitem(last=False)
    return core


# How far back the theme resolver may walk when a date's descriptions were ALL
# true yesterday too (measured at 9.9 % of days). Each extra step costs one
# board generation, so the walk is capped and falls back to the primary
# description -- a label is never worth an unbounded amount of work, and the
# cap is far above the longest run this ever needs (see the freshness audit).
_THEME_LOOKBACK_LIMIT = 8


def _previous_date(date_str: str) -> Optional[str]:
    """The calendar day before `date_str`, or None at the edge of the calendar."""
    try:
        return (parse_daily_key(date_str) - timedelta(days=1)).strftime(DATE_FORMAT)
    except (InvalidDailyKey, OverflowError, ValueError):
        return None


def resolve_theme_id(
    date_str: str,
    pool: GridPool | None = None,
    constraints: Sequence[Constraint] | None = None,
    version: str | None = None,
    _depth: int = 0,
) -> str:
    """The theme id this date PUBLISHES: the rarest true description of its
    axes that was not also true of yesterday's board.

    Why this cannot repeat on adjacent days: the value returned for a date is,
    by construction, a description that is *not* in the previous date's
    candidate list -- while the previous date's own published value is
    necessarily *in* that list. Two adjacent days therefore draw from disjoint
    sets. The one exception is the degenerate case where every description true
    of today was also true yesterday, and that is handled explicitly below by
    resolving yesterday's actual label and stepping past it.

    NOT A GENERATION INPUT. This runs after `_board_core` has already decided
    the axes, reads only public information (the previous daily key, whose
    board is permanently addressable through the archive), and its result is
    never fed back. Which board a date gets is unchanged by this function's
    existence.
    """
    today = theme_candidates(*_axes_for(date_str, pool, constraints, version))

    previous = _previous_date(date_str)
    if previous is None or _depth >= _THEME_LOOKBACK_LIMIT:
        return today[0]

    try:
        yesterday = theme_candidates(*_axes_for(previous, pool, constraints, version))
    except (BoardGenerationFailed, InvalidGridDate):
        # A label must never cost a date its board. If yesterday cannot be
        # generated at all, publish today's primary description and move on.
        return today[0]

    fresh = next((theme for theme in today if theme not in yesterday), None)
    if fresh is not None:
        return fresh

    # Degenerate: every description true today was true yesterday too. Fall
    # back to skipping yesterday's ACTUAL published label, which needs one more
    # step backwards. `theme_candidates` is never shorter than two entries for
    # a generated board, so a different one always exists.
    previous_id = resolve_theme_id(previous, pool, constraints, version, _depth + 1)
    return next((theme for theme in today if theme != previous_id), today[0])


def _axes_for(
    date_str: str,
    pool: GridPool | None,
    constraints: Sequence[Constraint] | None,
    version: str | None,
) -> tuple[tuple[Constraint, ...], tuple[Constraint, ...]]:
    resolved_version = version if version is not None else _version_for_date(date_str)
    core = _board_core(date_str, pool, constraints, resolved_version)
    return core.rows, core.cols


def generate_board(
    date_str: str,
    pool: GridPool | None = None,
    constraints: Sequence[Constraint] | None = None,
    version: str | None = None,
) -> GridBoard:
    """The board for one date. Pure function of (date, version, taxonomy).

    The axes, cells and difficulty come from this date alone. Only the THEME
    LABEL consults the previous daily key, and only to avoid repeating it --
    see `resolve_theme_id`.

    `version` left as None (the default, and what every real caller uses)
    resolves per-date via `_version_for_date`: a date at or before
    NOVELTY_CUTOVER_DATE always gets v2, a later date v3 -- so a legacy
    board's date, seed, taxonomy and board_id are all exactly what they were
    before this taxonomy revision shipped, forever. Passing an explicit
    `version` (tests do) pins every internal call to that one value instead.
    """
    resolved_version = version if version is not None else _version_for_date(date_str)
    core = _board_core(date_str, pool, constraints, resolved_version)
    # `version` (not `resolved_version`) is threaded through here on purpose:
    # the recursive lookback in resolve_theme_id must re-resolve EACH date it
    # visits against its own place relative to the cutover, not inherit
    # today's. Passing an already-concrete version would force yesterday's
    # axes to be read under today's taxonomy even across the cutover boundary.
    theme_id = resolve_theme_id(date_str, pool, constraints, version)

    return GridBoard(
        board_id=board_id(date_str, resolved_version),
        date=date_str,
        seed=core.seed,
        version=resolved_version,
        rows=core.rows,
        cols=core.cols,
        cells=core.cells,
        difficulty=_difficulty_label(core.cells),
        theme=THEME_LABELS[theme_id],
        attempts=core.attempts,
        theme_id=theme_id,
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


def get_board(date_str: str, version: str | None = None) -> GridBoard:
    """Process-cached board for a date.

    Safe to cache because generation is a pure function of (date, version) over
    committed data -- the cache can never serve a board that differs from what
    a fresh generation would produce. `version` resolves per-date exactly as
    in `generate_board` when left as None, which is how every real caller
    (the API included) uses this.
    """
    validate_grid_date(date_str)
    resolved_version = version if version is not None else _version_for_date(date_str)
    key = (date_str, resolved_version)
    cached = _BOARD_CACHE.get(key)
    if cached is not None:
        _BOARD_CACHE.move_to_end(key)
        return cached
    board = generate_board(date_str, version=resolved_version)
    _BOARD_CACHE[key] = board
    if len(_BOARD_CACHE) > _BOARD_CACHE_MAX:
        _BOARD_CACHE.popitem(last=False)
    return board
