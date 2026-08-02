"""In-memory TelemetryRepository (Track F) -- the backend used in dev and in
CI when DATABASE_URL is unset, same discipline as every other Memory*
repository here.

BOUNDED, unlike most of its siblings. The others hold one row per game or per
result, so their natural size is the number of things a dev has done. This one
takes an unauthenticated write per player action, which in a long-running dev
process is unbounded -- so it is a `deque(maxlen=...)` and the oldest events
fall off the back. Dropping old dev telemetry costs nothing; a dev server that
slowly eats memory because analytics is on costs a debugging afternoon.

The retention semantics are still implemented honestly: `purge_expired` really
does drop expired rows, so a test can assert retention behaviour against this
backend rather than only against Postgres.
"""
from __future__ import annotations

import asyncio
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Optional

from app.models.telemetry import retention_expiry
from app.repositories.telemetry_protocols import TelemetryEvent, TelemetryRepository

#: Roughly a long dev session's worth of events. Not tunable: nothing depends
#: on the exact number, and a knob would imply this store is meant to be kept.
MAX_RETAINED_EVENTS = 5000


class MemoryTelemetryRepository:
    def __init__(self, max_events: int = MAX_RETAINED_EVENTS) -> None:
        self._events: deque[TelemetryEvent] = deque(maxlen=max_events)
        self._lock = asyncio.Lock()

    async def record_events(self, events: list[TelemetryEvent]) -> int:
        async with self._lock:
            for event in events:
                event.id = event.id or str(uuid.uuid4())
                if event.expires_at is None:
                    event.expires_at = retention_expiry(event.created_at)
                self._events.append(event)
            return len(events)

    async def purge_expired(self, now: Optional[datetime] = None) -> int:
        cutoff = now or datetime.now(timezone.utc)
        async with self._lock:
            before = len(self._events)
            kept = [
                e for e in self._events if e.expires_at is None or e.expires_at > cutoff
            ]
            self._events.clear()
            self._events.extend(kept)
            return before - len(kept)

    async def list_recent(self, limit: int = 100) -> list[TelemetryEvent]:
        return list(self._events)[-limit:][::-1]

    async def clear(self) -> None:
        """Test helper -- not on the protocol."""
        async with self._lock:
            self._events.clear()


assert isinstance(MemoryTelemetryRepository(), TelemetryRepository)
