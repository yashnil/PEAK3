"""Persistence interface for the PEAK Season global leaderboard (Phase 6G
Part E).

Deliberately a separate, narrow protocol from CourtLineupRepository (which
stores in-progress/completed GAME STATE) -- a leaderboard run is a distinct,
immutable, user-submitted RECORD of a completed game, only ever created via
an explicit "Submit to leaderboard" action, never derived automatically.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
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
    created_at: datetime = field(default_factory=lambda: datetime.now())
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
        self, mode: Optional[str], no_respin_only: bool, limit: int, cursor: Optional[str]
    ) -> list[PerfectSeasonRun]:
        """Public rows only, sorted wins desc, lineup_score desc, fewer
        respins used asc, created_at asc (Part E's exact sort spec).
        `cursor` is an opaque encoding of the last row's sort key from the
        previous page (see leaderboard_memory.py/leaderboard_postgres.py
        for the concrete encoding), or None for the first page."""
        ...

    async def list_runs_for_owner(self, owner_sub: str) -> list[PerfectSeasonRun]: ...

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
