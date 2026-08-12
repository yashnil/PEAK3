"""In-memory DailyGridResultRepository (Phase 11D) -- used in dev/tests when
DATABASE_URL is unset, same discipline as every other Memory* repository in
this package.

Enforces the same one-result-per-(owner, board_date, board_version) rule the
Postgres unique constraint does, so idempotency behaves identically in CI and
in production rather than being a property only the database has.
"""
from __future__ import annotations

import asyncio
import uuid
from typing import Optional

from app.repositories.daily_grid_protocols import (
    DailyGridAttempt,
    DailyGridLeaderboardEntry,
    DailyGridResult,
    DailyGridResultRepository,
    DailyGridRetryAttempt,
    is_strictly_better,
    leaderboard_sort_key,
)


class MemoryDailyGridResultRepository:
    def __init__(self) -> None:
        self._results: dict[str, DailyGridResult] = {}
        # (owner_sub, board_date, board_version) -> result_id.
        self._by_owner_board: dict[tuple[str, str, str], str] = {}
        # (owner_sub, daily_key) -> attempt. Plays the part of the Postgres
        # UNIQUE (owner_sub, daily_key) constraint, so `start_attempt` is
        # idempotent here for exactly the reason it is idempotent there.
        self._attempts: dict[tuple[str, str], DailyGridAttempt] = {}
        # (owner_sub, daily_key, board_version) -> best entry. The dict key
        # plays the Postgres UNIQUE constraint; the better-only replacement
        # runs under the same lock every other write takes, so a concurrent
        # pair of submissions serialises here exactly as ON CONFLICT does.
        self._leaderboard: dict[tuple[str, str, str], DailyGridLeaderboardEntry] = {}
        # (owner_sub, daily_key) -> retry attempts, append-only in insertion
        # order. The active retry is the last element -- no unique constraint
        # by design (each retry is its own clock).
        self._retries: dict[tuple[str, str], list[DailyGridRetryAttempt]] = {}
        self._lock = asyncio.Lock()

    async def start_attempt(
        self, attempt: DailyGridAttempt
    ) -> tuple[DailyGridAttempt, bool]:
        async with self._lock:
            key = (attempt.owner_sub, attempt.daily_key)
            existing = self._attempts.get(key)
            if existing is not None:
                # The clock is not restartable. See the protocol docstring.
                return existing, False
            attempt.id = attempt.id or str(uuid.uuid4())
            self._attempts[key] = attempt
            return attempt, True

    async def get_attempt(
        self, owner_sub: str, daily_key: str
    ) -> Optional[DailyGridAttempt]:
        return self._attempts.get((owner_sub, daily_key))

    async def save_result(self, result: DailyGridResult) -> tuple[DailyGridResult, bool]:
        async with self._lock:
            key = (result.owner_sub, result.board_date, result.board_version)
            existing_id = self._by_owner_board.get(key)
            if existing_id is not None:
                # Idempotent: return the record that is already there. See the
                # protocol's docstring for why a re-save is never new
                # information.
                return self._results[existing_id], False
            result_id = result.id or str(uuid.uuid4())
            result.id = result_id
            self._results[result_id] = result
            self._by_owner_board[key] = result_id
            return result, True

    async def get_result(
        self, owner_sub: str, board_date: str, board_version: str
    ) -> Optional[DailyGridResult]:
        result_id = self._by_owner_board.get((owner_sub, board_date, board_version))
        return self._results.get(result_id) if result_id else None

    async def list_results_for_owner(
        self, owner_sub: str, limit: int = 30
    ) -> list[DailyGridResult]:
        rows = [r for r in self._results.values() if r.owner_sub == owner_sub]
        rows.sort(key=lambda r: (r.board_date, r.created_at), reverse=True)
        return rows[:limit]

    async def upsert_leaderboard_best(
        self, entry: DailyGridLeaderboardEntry
    ) -> tuple[DailyGridLeaderboardEntry, bool]:
        async with self._lock:
            key = (entry.owner_sub, entry.daily_key, entry.board_version)
            incumbent = self._leaderboard.get(key)
            if incumbent is not None and not is_strictly_better(entry, incumbent):
                return incumbent, False
            entry.id = entry.id or str(uuid.uuid4())
            self._leaderboard[key] = entry
            return entry, True

    async def leaderboard_top(
        self, daily_key: str, limit: int = 25
    ) -> list[DailyGridLeaderboardEntry]:
        rows = await self.leaderboard_all_for_day(daily_key)
        return rows[:limit]

    async def leaderboard_entry_for_owner(
        self, owner_sub: str, daily_key: str
    ) -> Optional[DailyGridLeaderboardEntry]:
        for (sub, key, _version), entry in self._leaderboard.items():
            if sub == owner_sub and key == daily_key:
                return entry
        return None

    async def leaderboard_all_for_day(
        self, daily_key: str
    ) -> list[DailyGridLeaderboardEntry]:
        rows = [e for e in self._leaderboard.values() if e.daily_key == daily_key]
        rows.sort(key=leaderboard_sort_key)
        return rows

    async def start_retry_attempt(
        self, attempt: DailyGridRetryAttempt
    ) -> DailyGridRetryAttempt:
        async with self._lock:
            attempt.id = attempt.id or str(uuid.uuid4())
            self._retries.setdefault(
                (attempt.owner_sub, attempt.daily_key), []
            ).append(attempt)
            return attempt

    async def latest_retry_attempt(
        self, owner_sub: str, daily_key: str
    ) -> Optional[DailyGridRetryAttempt]:
        attempts = self._retries.get((owner_sub, daily_key))
        return attempts[-1] if attempts else None

    async def transfer_owner(self, from_sub: str, to_sub: str) -> int:
        """Mirror of the Postgres transfer, including the collision rule --
        `_by_owner_board` plays the part the UNIQUE constraint plays there."""
        async with self._lock:
            moved = 0
            for result in [r for r in self._results.values() if r.owner_sub == from_sub]:
                old_key = (from_sub, result.board_date, result.board_version)
                new_key = (to_sub, result.board_date, result.board_version)
                self._by_owner_board.pop(old_key, None)
                if new_key in self._by_owner_board:
                    # Destination already has its own official result for this
                    # board -- first attempt wins, the guest's copy is dropped.
                    self._results.pop(result.id, None)
                    continue
                result.owner_sub = to_sub
                self._by_owner_board[new_key] = result.id
                moved += 1

            # In-progress clocks follow their owner, under the same
            # first-attempt-wins rule and not counted in `moved`.
            for key in [k for k in self._attempts if k[0] == from_sub]:
                attempt = self._attempts.pop(key)
                new_key = (to_sub, attempt.daily_key)
                if new_key in self._attempts:
                    continue
                attempt.owner_sub = to_sub
                self._attempts[new_key] = attempt
            return moved


# Protocol conformance is structural (runtime_checkable Protocol) -- this
# assertion documents the intent and fails fast at import time if a method
# signature ever drifts from daily_grid_protocols.py.
assert isinstance(MemoryDailyGridResultRepository(), DailyGridResultRepository)
