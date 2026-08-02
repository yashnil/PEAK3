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
