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


@runtime_checkable
class DailyGridResultRepository(Protocol):
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
