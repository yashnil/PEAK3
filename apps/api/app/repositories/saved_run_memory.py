"""In-memory PerfectSeasonSavedRunRepository (Phase 9A) -- used in dev/tests
when DATABASE_URL is unset, same discipline as every other Memory*
repository in this package.

Shares its tiebreaker logic with the Postgres implementation via
saved_run_ranking.py, so personal-best behavior in CI matches production
rather than being reimplemented here.
"""
from __future__ import annotations

import asyncio
import uuid
from typing import Optional

from app.repositories.saved_run_protocols import PersonalBests, PerfectSeasonSavedRunRepository, SavedRun
from app.repositories.saved_run_ranking import best_of, is_officially_scored


class MemoryPerfectSeasonSavedRunRepository:
    def __init__(self) -> None:
        self._runs: dict[str, SavedRun] = {}
        # (owner_sub, game_id) -> run_id, enforcing save idempotency.
        self._by_owner_game: dict[tuple[str, str], str] = {}
        self._lock = asyncio.Lock()

    async def save_run(self, run: SavedRun) -> SavedRun:
        async with self._lock:
            key = (run.owner_sub, run.game_id)
            existing_id = self._by_owner_game.get(key)
            if existing_id is not None:
                # Idempotent: a re-save of the same completed game returns
                # the original record rather than duplicating or overwriting
                # it (see the protocol's own docstring).
                return self._runs[existing_id]
            run_id = run.id or str(uuid.uuid4())
            run.id = run_id
            self._runs[run_id] = run
            self._by_owner_game[key] = run_id
            return run

    async def get_run_by_game_id(self, owner_sub: str, game_id: str) -> Optional[SavedRun]:
        run_id = self._by_owner_game.get((owner_sub, game_id))
        return self._runs.get(run_id) if run_id else None

    def _owner_runs(self, owner_sub: str) -> list[SavedRun]:
        return [r for r in self._runs.values() if r.owner_sub == owner_sub]

    async def list_runs_for_owner(self, owner_sub: str, limit: int = 25) -> list[SavedRun]:
        rows = self._owner_runs(owner_sub)
        rows.sort(key=lambda r: (r.created_at, r.id), reverse=True)
        return rows[:limit]

    async def get_personal_bests(self, owner_sub: str, recent_limit: int = 5) -> PersonalBests:
        rows = self._owner_runs(owner_sub)
        if not rows:
            return PersonalBests()

        scored_rows = [r for r in rows if is_officially_scored(r)]
        best_score_run = max(scored_rows, key=lambda r: r.lineup_score) if scored_rows else None
        daily_rows = [r for r in rows if r.challenge_kind == "daily"]
        recent = sorted(rows, key=lambda r: (r.created_at, r.id), reverse=True)[:recent_limit]

        return PersonalBests(
            total_runs=len(rows),
            best_run=best_of(rows),
            best_wins=max(r.wins for r in rows),
            best_lineup_score=best_score_run.lineup_score if best_score_run else None,
            best_lineup_score_run=best_score_run,
            best_daily_run=best_of(daily_rows),
            perfect_season_count=sum(1 for r in rows if r.is_perfect_season),
            recent_runs=recent,
        )

    async def count_daily_attempts(self, owner_sub: str, challenge_date: str, mode: str) -> int:
        return sum(
            1 for r in self._runs.values()
            if r.owner_sub == owner_sub
            and r.challenge_kind == "daily"
            and r.challenge_date == challenge_date
            and r.mode == mode
        )


# Protocol conformance is structural (runtime_checkable Protocol) -- this
# assertion documents the intent and fails fast at import time if a method
# signature ever drifts from saved_run_protocols.py.
assert isinstance(MemoryPerfectSeasonSavedRunRepository(), PerfectSeasonSavedRunRepository)
