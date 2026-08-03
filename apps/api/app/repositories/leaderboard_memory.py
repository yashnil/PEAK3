"""In-memory PerfectSeasonLeaderboardRepository (Phase 6G Part E) -- used in
dev/tests when DATABASE_URL is unset, same discipline as the other
Memory* repositories in this package."""
from __future__ import annotations

import asyncio
import base64
import json
import uuid
from datetime import datetime
from typing import Optional

from app.repositories.leaderboard_protocols import DuplicateRunSubmission, PerfectSeasonRun


def _sort_key(run: PerfectSeasonRun) -> tuple:
    # wins desc, lineup_score desc, respins used asc, created_at asc --
    # Python tuple comparison sorts ascending, so wins/lineup_score are
    # negated to get a descending effect while keeping one sort() call.
    total_respins = run.team_respins_used + run.season_respins_used
    return (-run.wins, -run.lineup_score, total_respins, run.created_at.isoformat(), run.id)


def _encode_cursor(run: PerfectSeasonRun) -> str:
    return base64.urlsafe_b64encode(json.dumps(list(_sort_key(run))).encode()).decode()


def _decode_cursor(cursor: str) -> tuple:
    return tuple(json.loads(base64.urlsafe_b64decode(cursor.encode()).decode()))


class MemoryPerfectSeasonLeaderboardRepository:
    def __init__(self) -> None:
        self._runs: dict[str, PerfectSeasonRun] = {}
        self._by_game_id: dict[str, str] = {}
        self._lock = asyncio.Lock()

    async def submit_run(self, run: PerfectSeasonRun) -> PerfectSeasonRun:
        async with self._lock:
            if run.game_id in self._by_game_id:
                raise DuplicateRunSubmission(f"game_id '{run.game_id}' was already submitted")
            run_id = run.id or str(uuid.uuid4())
            run.id = run_id
            self._runs[run_id] = run
            self._by_game_id[run.game_id] = run_id
            return run

    async def get_run_by_game_id(self, game_id: str) -> Optional[PerfectSeasonRun]:
        run_id = self._by_game_id.get(game_id)
        return self._runs.get(run_id) if run_id else None

    async def get_leaderboard(
        self,
        mode: Optional[str],
        no_respin_only: bool,
        limit: int,
        cursor: Optional[str],
        since: Optional[datetime] = None,
    ) -> list[PerfectSeasonRun]:
        rows = [r for r in self._runs.values() if r.is_public]
        if mode:
            rows = [r for r in rows if r.mode == mode]
        if no_respin_only:
            rows = [r for r in rows if r.team_respins_used == 0 and r.season_respins_used == 0]
        if since is not None:
            # The daily board: identical query, filtered to the current
            # application day. `since` is the caller's (router's) already-
            # resolved boundary -- this repo never computes one of its own.
            rows = [r for r in rows if r.created_at >= since]
        rows.sort(key=_sort_key)

        if cursor:
            after_key = _decode_cursor(cursor)
            rows = [r for r in rows if _sort_key(r) > after_key]

        return rows[:limit]

    async def list_runs_for_owner(self, owner_sub: str) -> list[PerfectSeasonRun]:
        rows = [r for r in self._runs.values() if r.owner_sub == owner_sub]
        rows.sort(key=lambda r: r.created_at, reverse=True)
        return rows

    def encode_cursor(self, run: PerfectSeasonRun) -> str:
        return _encode_cursor(run)

    async def get_personal_placement(
        self, owner_sub: str, mode: Optional[str]
    ) -> Optional[tuple[int, PerfectSeasonRun]]:
        rows = [r for r in self._runs.values() if r.is_public]
        if mode:
            rows = [r for r in rows if r.mode == mode]
        rows.sort(key=_sort_key)
        mine = [r for r in rows if r.owner_sub == owner_sub]
        if not mine:
            return None
        best = mine[0]
        # By `id`, not `rows.index(best)`: `PerfectSeasonRun` is a plain
        # (non-frozen) dataclass, so `.index()` would use field-by-field
        # equality rather than identity -- fine in practice since `id` alone
        # already disambiguates, but explicit is safer than relying on
        # dataclass `__eq__` never producing a false-positive match here.
        rank = next(i for i, r in enumerate(rows) if r.id == best.id) + 1
        return rank, best

    async def set_visibility(
        self, run_id: str, owner_sub: str, is_public: bool
    ) -> Optional[PerfectSeasonRun]:
        async with self._lock:
            run = self._runs.get(run_id)
            if run is None or run.owner_sub != owner_sub:
                return None
            run.is_public = is_public
            return run

    async def transfer_owner(self, from_sub: str, to_sub: str) -> int:
        """Mirror of the Postgres transfer -- ownership only, never
        display_name (see the protocol's docstring)."""
        async with self._lock:
            moved = 0
            for run in self._runs.values():
                if run.owner_sub == from_sub:
                    run.owner_sub = to_sub
                    moved += 1
            return moved


encode_leaderboard_cursor = _encode_cursor
