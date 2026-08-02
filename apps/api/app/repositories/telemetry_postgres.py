"""PostgreSQL-backed TelemetryRepository (Track F).

Writes through the API's own owner-role asyncpg pool, like every other
Postgres* repository here. That role is not subject to the RLS policy in
20260801120000_telemetry_events.sql, which is the intended split: the policy
denies PostgREST clients everything, and this process is the only writer.

THREE THINGS THIS FILE DOES DIFFERENTLY, all for the same reason -- telemetry
must never degrade the product:

1. **It never raises.** `record_events` catches every storage failure and
   returns a short count. An analytics outage that turned into a 500 on the
   player's action would be a worse outcome than losing the analytics.
2. **It writes the whole batch in one statement** (`executemany`), so ingest
   costs one round trip regardless of batch size.
3. **It purges opportunistically**, at most once an hour per process, on the
   write path. This is the fallback for deployments where nobody has scheduled
   `telemetry_events_purge_expired()` via pg_cron -- see the migration's
   retention section, which is explicit that the cron job is the real answer
   and this is the safety net.

There is no SELECT of individual rows on any request path. `list_recent`
exists for tests and diagnostics only and is never routed.
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from app.models.telemetry import retention_expiry
from app.repositories.telemetry_protocols import TelemetryEvent

logger = logging.getLogger(__name__)

try:
    import asyncpg  # type: ignore[import]
    _ASYNCPG_AVAILABLE = True
except ImportError:
    _ASYNCPG_AVAILABLE = False

#: Seconds between opportunistic purges. Per process, not per pool: two API
#: processes each running it hourly is harmless (the DELETE is idempotent).
PURGE_INTERVAL_SECONDS = 3600.0


def _require_asyncpg() -> None:
    if not _ASYNCPG_AVAILABLE:
        raise RuntimeError(
            "asyncpg is required for PostgreSQL repositories. Install it: pip install asyncpg"
        )


def _decode_props(raw: Any) -> dict:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, (str, bytes)):
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


class PostgresTelemetryRepository:
    # Class-level so the interval is shared by every short-lived instance the
    # dependency function creates (one per request, same as the other repos).
    _last_purge_monotonic: float = 0.0

    def __init__(self, pool: Any) -> None:
        _require_asyncpg()
        self._pool = pool

    async def record_events(self, events: list[TelemetryEvent]) -> int:
        if not events:
            return 0
        rows = []
        for event in events:
            created = event.created_at or datetime.now(timezone.utc)
            rows.append(
                (
                    uuid.UUID(event.id) if event.id else uuid.uuid4(),
                    event.subject_hash,
                    event.subject_kind,
                    event.event_name,
                    json.dumps(event.props or {}, separators=(",", ":"), sort_keys=True),
                    created,
                    event.expires_at or retention_expiry(created),
                )
            )
        try:
            async with self._pool.acquire() as conn:
                await conn.executemany(
                    """
                    INSERT INTO telemetry_events
                        (id, subject_hash, subject_kind, event_name, props,
                         created_at, expires_at)
                    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
                    """,
                    rows,
                )
        except Exception as exc:  # pragma: no cover - requires a live pool
            # Never the player's problem. Logged without any event payload:
            # the payload is the thing under privacy review, and an exception
            # string is not a place it should appear.
            logger.warning(
                "Telemetry batch not stored (%d events): %s",
                len(rows),
                type(exc).__name__,
            )
            return 0

        await self._maybe_purge()
        return len(rows)

    async def _maybe_purge(self) -> None:
        now = time.monotonic()
        if now - PostgresTelemetryRepository._last_purge_monotonic < PURGE_INTERVAL_SECONDS:
            return
        PostgresTelemetryRepository._last_purge_monotonic = now
        try:
            removed = await self.purge_expired()
            if removed:
                logger.info("Telemetry retention: purged %d expired events", removed)
        except Exception as exc:  # pragma: no cover - requires a live pool
            logger.warning("Telemetry purge failed: %s", type(exc).__name__)

    async def purge_expired(self, now: Optional[datetime] = None) -> int:
        cutoff = now or datetime.now(timezone.utc)
        async with self._pool.acquire() as conn:
            status = await conn.execute(
                "DELETE FROM telemetry_events WHERE expires_at <= $1", cutoff
            )
        # asyncpg returns e.g. "DELETE 12".
        try:
            return int(str(status).rsplit(" ", 1)[-1])
        except ValueError:  # pragma: no cover - defensive
            return 0

    async def list_recent(self, limit: int = 100) -> list[TelemetryEvent]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, subject_hash, subject_kind, event_name, props,
                       created_at, expires_at
                FROM telemetry_events
                ORDER BY created_at DESC
                LIMIT $1
                """,
                limit,
            )
        return [
            TelemetryEvent(
                id=str(row["id"]),
                subject_hash=row["subject_hash"],
                subject_kind=row["subject_kind"],
                event_name=row["event_name"],
                props=_decode_props(row["props"]),
                created_at=row["created_at"],
                expires_at=row["expires_at"],
            )
            for row in rows
        ]
