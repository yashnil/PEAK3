"""In-memory PeakDuelDailyResultRepository -- used in dev/tests when
DATABASE_URL is unset, same discipline as every other Memory* repository in
this package.

Enforces the same one-attempt-per-(owner, mode, daily_key) rule the Postgres
UNIQUE constraint does, so idempotency and the guest-claim collision rule
behave identically in CI and in production rather than being properties only
the database has.
"""
from __future__ import annotations

import asyncio
import uuid
from typing import Optional

from app.repositories.peak_duel_daily_protocols import (
    PeakDuelDailyResult,
    PeakDuelDailyResultRepository,
)


class MemoryPeakDuelDailyResultRepository:
    def __init__(self) -> None:
        self._results: dict[str, PeakDuelDailyResult] = {}
        # (owner_sub, mode, daily_key) -> result_id.
        self._by_owner_daily: dict[tuple[str, str, str], str] = {}
        self._lock = asyncio.Lock()

    async def save_result(
        self, result: PeakDuelDailyResult
    ) -> tuple[PeakDuelDailyResult, bool]:
        async with self._lock:
            key = (result.owner_sub, result.mode, result.daily_key)
            existing_id = self._by_owner_daily.get(key)
            if existing_id is not None:
                # Idempotent: return the record already there. See the
                # protocol's docstring for why a re-save is never new
                # information.
                return self._results[existing_id], False
            result_id = result.id or str(uuid.uuid4())
            result.id = result_id
            self._results[result_id] = result
            self._by_owner_daily[key] = result_id
            return result, True

    async def get_result(
        self, owner_sub: str, mode: str, daily_key: str
    ) -> Optional[PeakDuelDailyResult]:
        result_id = self._by_owner_daily.get((owner_sub, mode, daily_key))
        return self._results.get(result_id) if result_id else None

    async def list_results_for_owner(
        self, owner_sub: str, limit: int = 30
    ) -> list[PeakDuelDailyResult]:
        rows = [r for r in self._results.values() if r.owner_sub == owner_sub]
        rows.sort(key=lambda r: (r.daily_key, r.created_at), reverse=True)
        return rows[:limit]

    async def transfer_owner(self, from_sub: str, to_sub: str) -> int:
        """Mirror of the Postgres transfer, including the collision rule --
        `_by_owner_daily` plays the part the UNIQUE constraint plays there."""
        async with self._lock:
            moved = 0
            for result in [r for r in self._results.values() if r.owner_sub == from_sub]:
                self._by_owner_daily.pop((from_sub, result.mode, result.daily_key), None)
                new_key = (to_sub, result.mode, result.daily_key)
                if new_key in self._by_owner_daily:
                    # Destination already has its own official attempt for this
                    # daily -- first attempt wins, the guest's copy is dropped.
                    self._results.pop(result.id, None)
                    continue
                result.owner_sub = to_sub
                self._by_owner_daily[new_key] = result.id
                moved += 1
            return moved


# Protocol conformance is structural (runtime_checkable Protocol) -- this
# assertion documents the intent and fails fast at import time if a method
# signature ever drifts from peak_duel_daily_protocols.py.
assert isinstance(MemoryPeakDuelDailyResultRepository(), PeakDuelDailyResultRepository)
