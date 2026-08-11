"""Persistence interface for OFFICIAL Daily Grid results (Phase 11D).

A fourth owned-data protocol alongside the three the 82-0 side already has
(game state / public leaderboard / private saved runs). It is separate for the
same reason those three are: it stores a genuinely different thing.

  DailyGridResult (this file)
      One completed Daily Grid per user per board, re-validated square by
      square by the API before it is written. PRIVATE, immutable, and NOT
      ranked -- it is the trustworthy record a future leaderboard would be
      built from, not the leaderboard.

WHY IT EXISTS AT ALL, GIVEN LOCAL HISTORY WORKS
Anonymous players get a localStorage archive with streaks and history, and
that is genuinely enough to play the game. What localStorage cannot do is be
BELIEVED: it is editable, per-browser, and lost with site data. So the local
archive is honest about being local, and this table is what a signed-in player
gets instead -- the same result, but one the server watched happen.

WHAT IS AND IS NOT SERVER-VERIFIED
Verified: every answer id, that all nine squares are filled, that no player
identity repeats, and every score/percentage (recomputed from the board, never
read from the request). Not verified: `elapsed_seconds`, which is client
wall-clock and is stored presentationally. That asymmetry is why the timer
must stay out of scoring until the server times attempts itself.

IDEMPOTENT, NOT UPDATABLE. Saving the same board twice returns the row that is
already there. A daily attempt happens once; a second POST is a retry, and
treating it as new information would let a player resubmit until they liked
the number.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, Protocol, runtime_checkable


@dataclass
class DailyGridResult:
    """One official completed Daily Grid.

    Every scored field is recomputed server-side at save time from the
    submitted squares -- never taken from the client (same discipline as
    SavedRun; see the save route's own docstring).
    """

    id: str
    owner_sub: str
    board_id: str
    # YYYY-MM-DD (UTC) -- the board's date, not the completion timestamp.
    board_date: str
    # e.g. "daily_grid.v2". Part of the uniqueness key, because a taxonomy
    # revision makes a different board for the same date.
    board_version: str
    score: int
    optimal_total: int
    percent_of_best: float
    squares_matching_optimal: int
    board_theme: Optional[str] = None
    incorrect_attempts: int = 0
    # Client wall-clock. Presentational only -- see the module docstring.
    elapsed_seconds: Optional[int] = None
    # False when the player replayed an archive board through ?date=. Recorded
    # honestly rather than rejected: it is a real thing they did, it is simply
    # not a live daily attempt.
    played_on_board_date: bool = True
    # The nine locked answer ids, in reading order.
    answers: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class DailyGridAttempt:
    """One player's ATTEMPT at one daily board -- the server-side clock.

    Separate from ``DailyGridResult`` because it records something genuinely
    different, and at a different time. A result is written once, at the end,
    and is immutable. An attempt is written once, at the START, and exists
    precisely so the end can be measured against something the player did not
    choose.

    WHY THE SERVER OWNS THE CLOCK. Until Phase 12 the elapsed time on a board
    was measured entirely in the browser: it advanced while the tab was closed,
    reset with local storage, and was editable by anyone who opened the
    console -- and it was still written to the durable result. Anything derived
    from it (a personal best, a future leaderboard, a "fastest board" badge)
    would have been derived from a number the client asserted. ``started_at``
    is now assigned by the server, once.

    ONE ATTEMPT PER OWNER PER DAILY KEY. That is the whole idempotency
    contract, and it is enforced by ``UNIQUE (owner_sub, daily_key)`` in
    ``supabase/migrations/20260801150000_daily_grid_attempts.sql`` rather than
    by convention -- a double-click, a refresh and a second tab must all be the
    same attempt, including under concurrency.

    NOT KEYED ON BOARD VERSION, unlike ``DailyGridResult``. A player has one
    timed attempt per DAY; if the taxonomy were revised mid-day, re-clocking
    them from zero would be a worse answer than keeping the clock they have
    been watching. ``board_version`` and ``board_id`` are recorded so a row
    stays self-describing.
    """

    id: str
    owner_sub: str
    # YYYY-MM-DD in the product reset zone (America/Los_Angeles) -- the board's
    # day, never a wall-clock date from a browser.
    daily_key: str
    board_id: str
    board_version: str
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class DailyGridRetryAttempt:
    """One RETRY clock for one player's replay of today's board (final
    integrity closure, gap 1).

    Append-only and deliberately NOT unique per (owner, daily_key), unlike
    :class:`DailyGridAttempt`: a retry is an explicit, repeatable act, each
    one is its own attempt with its own server-stamped ``started_at``, and
    the ACTIVE retry is simply the newest row. Rows here can only ever feed
    the leaderboard's better-only upsert — they never touch the canonical
    first attempt or the immutable official result.
    """

    id: str
    owner_sub: str
    daily_key: str
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@runtime_checkable
class DailyGridResultRepository(Protocol):
    async def start_attempt(
        self, attempt: DailyGridAttempt
    ) -> tuple[DailyGridAttempt, bool]:
        """Start (or re-read) this owner's attempt at ``attempt.daily_key``.

        Returns ``(record, created)``. ``created`` is False when an attempt for
        this (owner, daily_key) already existed, in which case the EXISTING row
        is returned with its original ``started_at`` -- never re-stamped. That
        is the entire point: the second call must not be able to move the
        clock, or a player could restart the timer at will and the elapsed time
        would mean nothing.
        """
        ...

    async def get_attempt(
        self, owner_sub: str, daily_key: str
    ) -> Optional[DailyGridAttempt]:
        """This owner's attempt at one daily key, or None.

        Scoped by BOTH arguments, so a caller asking about today can never be
        handed yesterday's attempt.
        """
        ...

    async def save_result(self, result: DailyGridResult) -> tuple[DailyGridResult, bool]:
        """Save one official result.

        Returns `(record, created)`. `created` is False when a result for this
        (owner, board_date, board_version) already existed, in which case the
        EXISTING record is returned unchanged -- never overwritten, and never
        duplicated. Callers surface that as an idempotent success rather than
        an error: a retry is not a failure, and the player's first attempt is
        the one that counts.
        """
        ...

    async def get_result(
        self, owner_sub: str, board_date: str, board_version: str
    ) -> Optional[DailyGridResult]: ...

    async def list_results_for_owner(
        self, owner_sub: str, limit: int = 30
    ) -> list[DailyGridResult]:
        """Most recent board date first."""
        ...

    async def upsert_leaderboard_best(
        self, entry: "DailyGridLeaderboardEntry"
    ) -> tuple["DailyGridLeaderboardEntry", bool]:
        """Write one user's best for one daily key, atomically. (A2.5)

        Returns ``(stored, changed)``. The conflict rule is
        :func:`is_strictly_better`, applied INSIDE the storage layer (a
        conditional ``ON CONFLICT DO UPDATE ... WHERE`` in Postgres, under the
        repository lock in memory) so two concurrent submissions cannot
        interleave a read-compare-write and a better performance can never be
        replaced by a worse one, whatever the arrival order.
        """
        ...

    async def leaderboard_top(
        self, daily_key: str, limit: int = 25
    ) -> list["DailyGridLeaderboardEntry"]:
        """The day's entries in ranking order (:func:`leaderboard_sort_key`).

        The PARTITION is the whole contract: only rows whose ``daily_key``
        matches, so yesterday's board can never leak into today's view.
        """
        ...

    async def leaderboard_entry_for_owner(
        self, owner_sub: str, daily_key: str
    ) -> Optional["DailyGridLeaderboardEntry"]: ...

    async def leaderboard_all_for_day(
        self, daily_key: str
    ) -> list["DailyGridLeaderboardEntry"]:
        """Every entry for the day, ranking order — the input the route ranks
        over after joining handles (a public rank is a position among LISTED
        players, and listing requires a handle the repository cannot see)."""
        ...

    async def start_retry_attempt(
        self, attempt: "DailyGridRetryAttempt"
    ) -> "DailyGridRetryAttempt":
        """Open a FRESH retry clock. Always inserts — never idempotent.

        The deliberate opposite of :meth:`start_attempt`: the canonical first
        attempt is one non-restartable clock, while a retry is an explicit,
        repeatable act, and each one is its own attempt with its own
        server-stamped ``started_at``. The active retry for
        (owner, daily_key) is defined as the newest row.
        """
        ...

    async def latest_retry_attempt(
        self, owner_sub: str, daily_key: str
    ) -> Optional["DailyGridRetryAttempt"]:
        """The active (newest) retry clock for this owner and day, if any."""
        ...

    async def transfer_owner(self, from_sub: str, to_sub: str) -> int:
        """Reassign every result owned by `from_sub` to `to_sub`. Returns the
        number of RESULTS actually moved.

        In-progress ATTEMPTS move with them, under the same first-attempt-wins
        collision rule, and are not counted in the return value. A guest who
        starts today's board and then signs in mid-board must keep the clock
        they have been watching; leaving the attempt behind would silently
        restart their timer at the moment they created an account.

        The guest-claim half of this protocol: a player who completes boards as
        a guest and then signs in keeps them, instead of the server record
        being stranded under a subject whose cookie has just been consumed.

        ONE OFFICIAL RESULT PER BOARD SURVIVES THE TRANSFER. Where the
        destination account already has its own result for a
        (board_date, board_version) the guest also played, the guest's row
        cannot move without breaking
        `UNIQUE (owner_sub, board_date, board_version)` -- it is dropped rather
        than moved, matching how `DailyCompletionRepository.transfer_owner`
        resolves the identical collision. The account's own attempt is the one
        that counts, and the returned count reports only what really moved.
        """
        ...


@dataclass
class DailyGridLeaderboardEntry:
    """One user's BEST qualified completion of one daily board — the public,
    ranked counterpart of the private ``DailyGridResult``.

    WHY A THIRD RECORD RATHER THAN RANKING RESULTS DIRECTLY. Results are
    PRIVATE (owner-only RLS, owner-only read route) and carry answer material;
    a leaderboard needs a public-readable row carrying nothing but what the
    board displays. Splitting the record keeps the RLS story trivial — this
    table is public-read by policy, the results table stays private — instead
    of trying to expose three columns of a private table.

    EVERY NUMBER IS DERIVED SERVER-SIDE FROM SERVER RECORDS. ``score`` is the
    official result's (itself recomputed from the board at save time);
    ``completion_time_ms`` is ``result.created_at - attempt.started_at`` — two
    server-stamped instants the client never touched (the attempt clock starts
    once per (owner, daily_key) via ``POST /{daily_key}/start`` and cannot be
    restarted; the result is stamped at its first, immutable save). No request
    field reaches either. ``completion_time_ms`` is None only for a completion
    whose owner never had a server clock (a pre-``/start`` legacy client);
    such an entry ranks after every timed entry of equal score, which is the
    honest place for a time the server did not witness.

    ONE ROW PER (owner, daily_key, board_version), enforced by the unique
    constraint and by ``upsert_leaderboard_best``'s better-only conflict rule.
    """

    id: str
    owner_sub: str
    # YYYY-MM-DD in the product reset zone (America/Los_Angeles) — the same
    # key the attempt clock uses. The daily partition: one board per key.
    daily_key: str
    board_id: str
    board_version: str
    score: int
    completion_time_ms: Optional[int]
    # The result row this entry was derived from — provenance, never shown.
    result_id: str
    # When the qualifying completion was first saved (== result.created_at).
    completed_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


def leaderboard_sort_key(entry: DailyGridLeaderboardEntry):
    """THE RANKING, defined once and imported by both repository backends and
    the tests — never re-derived in a component.

        1. score DESC                (a higher score ALWAYS outranks)
        2. completion_time_ms ASC    (time breaks ties only; None sorts last —
                                      an unwitnessed time never beats a
                                      witnessed one)
        3. completed_at ASC          (earliest identical performance first)
        4. id ASC                    (total order, so pagination is stable)
    """
    return (
        -entry.score,
        entry.completion_time_ms if entry.completion_time_ms is not None else float("inf"),
        entry.completed_at,
        entry.id,
    )


def is_strictly_better(
    candidate: DailyGridLeaderboardEntry, incumbent: DailyGridLeaderboardEntry
) -> bool:
    """May `candidate` replace `incumbent` as one user's best? (A2.5)

    Strictly better only: a higher score, or the same score in strictly less
    witnessed time. Everything else — worse score, equal score slower, equal
    score with no witnessed time, byte-identical performance — keeps the
    incumbent, whose earlier `completed_at` is part of the ranking.
    """
    if candidate.score != incumbent.score:
        return candidate.score > incumbent.score
    if candidate.completion_time_ms is None:
        return False
    if incumbent.completion_time_ms is None:
        return True
    return candidate.completion_time_ms < incumbent.completion_time_ms
