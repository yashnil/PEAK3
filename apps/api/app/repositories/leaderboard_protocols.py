"""Persistence interface for the PEAK Season global leaderboard (Phase 6G
Part E).

Deliberately a separate, narrow protocol from CourtLineupRepository (which
stores in-progress/completed GAME STATE) -- a leaderboard run is a distinct,
immutable, user-submitted RECORD of a completed game, only ever created via
an explicit "Submit to leaderboard" action, never derived automatically.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, Protocol, runtime_checkable


@dataclass
class PerfectSeasonRun:
    """One submitted, immutable PEAK Season leaderboard entry.

    Every numeric/roster field here is RECOMPUTED server-side from the
    saved CourtLineupState at submit time (app/services/perfect_season/state.py's
    action_complete_game already produced simulation_result) -- never taken
    from client-submitted values (Part E: "Client must never submit
    arbitrary wins/score").
    """
    id: str
    owner_sub: str
    display_name: str
    mode: str
    game_id: str
    seed: int
    wins: int
    losses: int
    lineup_score: float
    score_status: str  # "complete" | "incomplete"
    exact_cards_scored: int
    total_cards: int
    team_respins_used: int
    season_respins_used: int
    roster_card_keys: list[str] = field(default_factory=list)
    data_version: Optional[str] = None
    formula_version: Optional[str] = None
    simulation_version: Optional[str] = None
    is_public: bool = True
    # tz-aware UTC, never a naive local-clock timestamp -- SCORE_RECONCILIATION.md's
    # daily-board work depends on comparing this against
    # `nba_peak.daily_key.day_start_utc`'s tz-aware boundary, and a naive
    # `datetime.now()` here would either raise on that comparison (memory
    # backend) or silently mis-tag the row's Postgres TIMESTAMPTZ if the
    # server process's local zone is ever not UTC (Postgres backend, whose
    # INSERT passes this value straight through). Was naive `datetime.now()`.
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    game_type: str = "peak_season"


class DuplicateRunSubmission(RuntimeError):
    """Raised when a game_id has already been submitted -- submission is a
    one-time action per completed game, not resubmittable/overwritable
    (Part E: 'Prefer immutable submitted runs')."""


@runtime_checkable
class PerfectSeasonLeaderboardRepository(Protocol):
    async def submit_run(self, run: PerfectSeasonRun) -> PerfectSeasonRun:
        """Raises DuplicateRunSubmission if this game_id was already
        submitted (idempotent-safe: a retried identical request should be
        handled by the caller checking get_run_by_game_id first)."""
        ...

    async def get_run_by_game_id(self, game_id: str) -> Optional[PerfectSeasonRun]: ...

    async def get_leaderboard(
        self,
        mode: Optional[str],
        limit: int,
        cursor: Optional[str],
        since: Optional[datetime] = None,
    ) -> list[PerfectSeasonRun]:
        """Public rows only, sorted wins desc, lineup_score desc, fewer
        respins used asc, created_at asc (Part E's exact sort spec).

        No respin FILTER exists (launch-polish IMPLEMENTATION_CONTRACT.md
        §7: respins are normal Standard 82-0 play, not a reason to exclude a
        run from the board) -- respin counts remain a TIE-BREAK dimension in
        the sort above, and are still returned per-row as displayable
        metadata (`team_respins_used`/`season_respins_used` on
        `PerfectSeasonRun`), just never a reason a run is left off entirely.
        An earlier `no_respin_only` parameter did exactly that filtering and
        has been removed, not merely defaulted off.

        `cursor` is an opaque encoding of the last row's sort key from the
        previous page (see leaderboard_memory.py/leaderboard_postgres.py
        for the concrete encoding), or None for the first page.

        `since` -- tz-aware UTC, or None for the all-time board -- restricts
        to runs submitted at or after that instant. This is what the daily
        board IS: the identical query and tie-break order as all-time,
        filtered to `created_at >= since`. The boundary itself is computed by
        the CALLER (the router, from `nba_peak.daily_key.day_start_utc`, the
        one shared "official application day" function every daily mode in
        this codebase uses) -- this repository takes an already-resolved
        instant and never derives a day boundary of its own, so there is
        exactly one place in the whole codebase that can disagree about what
        day it is.
        """
        ...

    def encode_cursor(self, run: PerfectSeasonRun) -> str:
        """The opaque `next_cursor` string for `run`, in THIS backend's own
        `get_leaderboard`-`cursor`-decoding format.

        Deliberately a method on the repository rather than a free function in
        the router (`apps/api/app/api/v1/perfect_season.py`'s `get_leaderboard`
        route calls this): the router does not know, and must not need to
        know, which backend is active, and the memory and Postgres
        implementations do not share one cursor encoding today (the memory
        repo negates wins/lineup_score INSIDE the encoded value for a single
        Python tuple comparison; the Postgres repo encodes raw values and
        negates only inside the SQL predicate text). A router-level encoder
        that assumed one shared format would silently produce a cursor the
        ACTIVE backend's own `_decode_cursor` cannot read on the next page.
        """
        ...

    async def set_visibility(
        self, run_id: str, owner_sub: str, is_public: bool
    ) -> Optional[PerfectSeasonRun]:
        """Hide or unhide `run_id` on the public leaderboard. Owner-only:
        `owner_sub` must match or nothing is changed. Returns the updated run,
        or None if `run_id` does not exist or is not owned by `owner_sub`.

        SCORE_RECONCILIATION.md gap #3: this is the ONLY mutation a submitted
        run may ever undergo (`is_public` -- one column). Every other field
        stays the immutable record of what was submitted (Part E: "Prefer
        immutable submitted runs; no UPDATE except admin"), which is also why
        this is a repository method with a narrow, single-column SQL
        statement rather than a new RLS UPDATE policy: the existing
        `perfect_season_runs` migration deliberately carries no UPDATE policy
        at all (immutable-by-omission under RLS), and this stays that way --
        the capability is reachable ONLY through the API's own service-role
        connection and its own ownership check, never via a direct
        anon/authenticated PostgREST UPDATE.
        """
        ...

    async def list_runs_for_owner(self, owner_sub: str) -> list[PerfectSeasonRun]: ...

    async def get_personal_placement(
        self, owner_sub: str, mode: Optional[str]
    ) -> Optional[tuple[int, PerfectSeasonRun]]:
        """The caller's best-ranked PUBLIC run in `mode` (every mode if
        `mode` is None) and its 1-indexed rank on that same public leaderboard
        `get_leaderboard` serves -- SCORE_RECONCILIATION.md gap #2: a player
        could see the board but never where they placed on it. Returns
        `(rank, run)` for whichever of the caller's public runs sorts best by
        the Part E tie-break order, or None if the caller has no public run in
        `mode`. A run submitted `is_public=False` (once that becomes settable
        -- gap #3) is correctly excluded: this is standing ON the public
        board, not a private lookup of the caller's own best score.
        """
        ...

    async def transfer_owner(self, from_sub: str, to_sub: str) -> int:
        """Reassign every submitted run owned by `from_sub` to `to_sub`.
        Returns the number of runs actually moved.

        Present so this domain cannot be the one the guest claim silently
        forgets. Today's submit route requires a signed-in account, so an
        anon-owned row should not exist here in practice and this normally
        moves 0 -- reported honestly rather than by being absent.

        `display_name` is deliberately NOT rewritten. A submitted run is an
        immutable record of what was submitted, and the leaderboard shows the
        name that was standing behind the submission at the time; ownership
        moving does not retroactively change who the board says played it.
        `UNIQUE (game_id)` is global rather than owner-scoped, so unlike the
        other claimable domains there is no per-owner collision to resolve.
        """
        ...
