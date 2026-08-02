"""Persistence interface for product telemetry (Track F).

DIFFERENT IN KIND from every other repository in this package, and the
interface says so. The others are owned-data stores: a caller reads back their
own rows, updates them, ranks them. This one is append-only and has no
per-owner read at all, because no product surface ever shows a player their
telemetry and no endpoint returns it. The only reader is
scripts/telemetry_report.py, which talks to the database directly with its own
aggregate SQL rather than through this protocol -- a repository method that
returned rows would be a read path this design does not want to have.

`list_recent` is the single exception and is scoped accordingly: it exists so
the API tests can assert what was written without reaching into a private
attribute, and it is never routed. It is not a "read your telemetry" API.

RETENTION IS PART OF THE CONTRACT, not an operational afterthought:
`purge_expired` is on the protocol so both backends must have an answer for
"what removes old rows", and the in-memory one is bounded by construction.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, Protocol, runtime_checkable


@dataclass
class TelemetryEvent:
    """One event as stored.

    Note what is absent: no owner_sub, no IP, no user agent, no client
    timestamp, no request id. `subject_hash` is the salted HMAC produced by
    app.models.telemetry.hash_subject -- the raw subject never travels past
    the route handler.
    """

    subject_hash: str
    subject_kind: str  # "anon" | "user"
    event_name: str
    props: dict = field(default_factory=dict)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    expires_at: Optional[datetime] = None
    id: Optional[str] = None


@runtime_checkable
class TelemetryRepository(Protocol):
    async def record_events(self, events: list[TelemetryEvent]) -> int:
        """Append a validated batch. Returns the number of rows written.

        Ingest is best-effort by design: telemetry must never be the reason a
        player's request fails. Backends therefore swallow storage errors and
        return a count lower than `len(events)` rather than raising -- the
        route surfaces that as `stored: false`, which is honest, and the
        player's action is unaffected.
        """
        ...

    async def purge_expired(self, now: Optional[datetime] = None) -> int:
        """Delete every row past its `expires_at`. Returns rows removed."""
        ...

    async def list_recent(self, limit: int = 100) -> list[TelemetryEvent]:
        """Newest first. Test/diagnostic only -- never exposed over HTTP."""
        ...
