"""Persistence interface for OFFICIAL Peak Duel Daily attempts.

WHY THIS EXISTS. Of the five daily modes, Peak Duel Daily was the only one with
no server-side attempt record at all -- `GET /game/daily` is stateless, and the
result lived exclusively in the browser's localStorage. Two consequences
followed, and this protocol exists to end both:

  * "one attempt per day" was a convention the client agreed to rather than a
    rule, because there was nothing on the server for a second attempt to
    conflict with; and
  * a guest's daily history could not be claimed when they signed in, because
    there was nothing to claim -- localStorage is per-browser, editable, and
    lost with site data, so it is explicitly not eligible for ranking
    (CLAUDE.md, Security).

The local archive stays, and stays honest about being local. This is what a
signed-in player gets instead: the same attempt, but one the server witnessed
and holds under `UNIQUE (owner_sub, mode, daily_key)`.

ANONYMOUS-FIRST, LIKE RUN THE TABLE. `owner_sub` may be a signed anon-cookie
subject (`anon:...`) rather than a Supabase `auth.uid()`. Peak Duel needs no
account to play, so a guest's attempt is recorded under their anon subject and
becomes claimable the moment they sign in (see `transfer_owner`). That is the
whole point of writing it server-side before there is an account.

THE DAY IS THE SERVER'S. `daily_key` is `nba_peak.daily_key.daily_key()`'s
output -- midnight in `DAILY_TIMEZONE`, never a browser-computed date and never
a UTC date. A client-supplied key is an explicit archive request, validated and
recorded with `played_on_daily_key=False`, never a claim about what today is.

IDEMPOTENT, NOT UPDATABLE. Saving the same (owner, mode, daily key) twice
returns the row already there. A daily attempt happens once; a second POST is a
retry, and treating it as new information would let a player resubmit until
they liked the number.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, Protocol, runtime_checkable


@dataclass
class PeakDuelDailyResult:
    """One official completed Peak Duel Daily attempt.

    `arena_points` -- never `peak_score`. A PEAK3 score describes a player's
    peak; this is what the player earned answering questions about one
    (CLAUDE.md, Naming conventions).
    """

    id: str
    owner_sub: str
    # 'peak_duel' today. A second duel-shaped daily gets its own value rather
    # than overloading this one; it is part of the uniqueness key.
    mode: str
    # YYYY-MM-DD in DAILY_TIMEZONE -- see the module docstring.
    daily_key: str
    duration_years: int
    duels_total: int
    correct_count: int
    arena_points: int = 0
    best_streak: int = 0
    # Client wall-clock. Presentational only -- see daily_grid_protocols.py's
    # module docstring for why an unvalidated timer must stay out of scoring.
    elapsed_seconds: Optional[int] = None
    # False when the player replayed an archive board. Recorded honestly rather
    # than rejected: it is a real thing they did, it is simply not a live
    # attempt at today's daily.
    played_on_daily_key: bool = True
    # Per-duel outcomes in presentation order.
    answers: list[dict] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@runtime_checkable
class PeakDuelDailyResultRepository(Protocol):
    async def save_result(
        self, result: PeakDuelDailyResult
    ) -> tuple[PeakDuelDailyResult, bool]:
        """Save one official attempt.

        Returns `(record, created)`. `created` is False when an attempt for
        this (owner, mode, daily_key) already existed, in which case the
        EXISTING record is returned unchanged -- never overwritten, never
        duplicated. Callers surface that as an idempotent success rather than
        an error: a retry is not a failure, and the player's first attempt is
        the one that counts.
        """
        ...

    async def get_result(
        self, owner_sub: str, mode: str, daily_key: str
    ) -> Optional[PeakDuelDailyResult]: ...

    async def list_results_for_owner(
        self, owner_sub: str, limit: int = 30
    ) -> list[PeakDuelDailyResult]:
        """Most recent daily key first."""
        ...

    async def transfer_owner(self, from_sub: str, to_sub: str) -> int:
        """Reassign every attempt owned by `from_sub` to `to_sub`. Returns the
        number of attempts actually moved.

        The reason this table exists at all is that a guest's daily play should
        survive signing in. Where the destination account already has its own
        attempt for a (mode, daily_key) the guest also played, the guest's row
        cannot move without breaking `UNIQUE (owner_sub, mode, daily_key)` --
        it is dropped rather than moved, matching how
        `DailyCompletionRepository.transfer_owner` resolves the identical
        collision. The account's own attempt is the official one, and the
        returned count reports only what really moved.
        """
        ...
