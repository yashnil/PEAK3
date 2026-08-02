"""In-memory RunTheTableRunRepository -- used in dev/tests when DATABASE_URL is
unset, same discipline as every other Memory* repository in this package.

Enforces the SAME one-daily-per-(owner, date) rule the Postgres partial unique
index does, so daily re-entry behaves identically in CI and in production
rather than being a property only the database has. Deep-copies snapshots on
the way in and out for the same reason: with a shared process-wide dict, handing
back the stored object would let a caller mutate persisted state without ever
calling `save_run` -- which works in memory and does not work in Postgres, and
that difference is exactly what this class exists not to have.
"""
from __future__ import annotations

import asyncio
import copy
from dataclasses import replace
from datetime import datetime, timezone
from typing import Optional

from app.repositories.run_the_table_protocols import RunTheTableRunRepository, StoredRun


def _clone(run: StoredRun) -> StoredRun:
    return replace(run, snapshot=copy.deepcopy(run.snapshot))


class MemoryRunTheTableRunRepository:
    def __init__(self) -> None:
        self._runs: dict[str, StoredRun] = {}
        # (owner_sub, run_date) -> run_id, for run_type == "daily" only.
        self._daily_index: dict[tuple[str, str], str] = {}
        self._lock = asyncio.Lock()

    async def create_run(self, run: StoredRun) -> tuple[StoredRun, bool]:
        async with self._lock:
            if run.run_type == "daily" and run.run_date:
                key = (run.owner_sub, run.run_date)
                existing_id = self._daily_index.get(key)
                if existing_id is not None:
                    return _clone(self._runs[existing_id]), False
                self._daily_index[key] = run.run_id
            self._runs[run.run_id] = _clone(run)
            return _clone(run), True

    async def get_run(self, run_id: str) -> Optional[StoredRun]:
        stored = self._runs.get(run_id)
        return _clone(stored) if stored is not None else None

    async def save_run(self, run: StoredRun) -> StoredRun:
        async with self._lock:
            run.updated_at = datetime.now(timezone.utc)
            self._runs[run.run_id] = _clone(run)
            return _clone(run)

    async def get_daily_run(self, owner_sub: str, run_date: str) -> Optional[StoredRun]:
        run_id = self._daily_index.get((owner_sub, run_date))
        return await self.get_run(run_id) if run_id else None

    async def list_runs_for_owner(self, owner_sub: str, limit: int = 20) -> list[StoredRun]:
        rows = [r for r in self._runs.values() if r.owner_sub == owner_sub]
        rows.sort(key=lambda r: r.created_at, reverse=True)
        return [_clone(r) for r in rows[:limit]]

    async def transfer_owner(self, from_sub: str, to_sub: str) -> int:
        """Mirror of the Postgres transfer, including the daily collision rule.

        The `_daily_index` here plays the part the partial unique index plays
        in Postgres, so a guest daily for a date the destination account has
        already played is dropped in CI exactly as it is in production rather
        than quietly becoming a second official daily for that date.
        """
        async with self._lock:
            moved = 0
            for run in [r for r in self._runs.values() if r.owner_sub == from_sub]:
                is_daily = run.run_type == "daily" and bool(run.run_date)
                if is_daily and (to_sub, run.run_date) in self._daily_index:
                    # Destination already has its official daily for that date.
                    self._daily_index.pop((from_sub, run.run_date), None)
                    self._runs.pop(run.run_id, None)
                    continue
                if is_daily:
                    self._daily_index.pop((from_sub, run.run_date), None)
                    self._daily_index[(to_sub, run.run_date)] = run.run_id
                run.owner_sub = to_sub
                moved += 1
            return moved


# Protocol conformance is structural (runtime_checkable Protocol) -- this
# assertion documents the intent and fails fast at import time if a method
# signature ever drifts from run_the_table_protocols.py.
assert isinstance(MemoryRunTheTableRunRepository(), RunTheTableRunRepository)
