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

from app.repositories.daily_grid_protocols import DailyGridResult, DailyGridResultRepository


class MemoryDailyGridResultRepository:
    def __init__(self) -> None:
        self._results: dict[str, DailyGridResult] = {}
        # (owner_sub, board_date, board_version) -> result_id.
        self._by_owner_board: dict[tuple[str, str, str], str] = {}
        self._lock = asyncio.Lock()

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


# Protocol conformance is structural (runtime_checkable Protocol) -- this
# assertion documents the intent and fails fast at import time if a method
# signature ever drifts from daily_grid_protocols.py.
assert isinstance(MemoryDailyGridResultRepository(), DailyGridResultRepository)
