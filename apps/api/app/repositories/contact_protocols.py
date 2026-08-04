"""Persistence interface for contact/feedback submissions (launch-polish
IMPLEMENTATION_CONTRACT.md §9).

Same shape as telemetry_protocols.py and the same reasoning: append-only,
no per-owner read (no product surface shows a sender their own past
submissions), and `list_recent` exists only so tests/diagnostics can assert
what was written without reaching into a private attribute -- it is never
routed over HTTP.

UNLIKE telemetry, storage failure here is NOT swallowed. A contact
submission is a deliberate act someone took to reach a human; silently
reporting "accepted" while nothing was actually stored would be a worse
failure mode than a clear error the sender can retry. `record` therefore
raises rather than returning a best-effort count -- see the Postgres
implementation's docstring for what actually happens when the database is
unavailable.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, Protocol, runtime_checkable


@dataclass
class ContactSubmission:
    """One stored submission.

    Note what is absent, same as TelemetryEvent: no owner_sub, no IP, no
    user agent. `subject_hash` is the salted HMAC produced by
    app.models.contact.hash_subject (re-exported from app.models.telemetry)
    -- the raw subject never travels past the route handler.
    """

    subject_hash: str
    subject_kind: str  # "anon" | "user"
    category: str
    subject: str
    message: str
    relevant_area: Optional[str] = None
    reply_email: Optional[str] = None
    status: str = "open"
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    id: Optional[str] = None


@runtime_checkable
class ContactRepository(Protocol):
    async def record(self, submission: ContactSubmission) -> ContactSubmission:
        """Persist one submission. Returns it with `id`/`created_at`
        populated. Raises on genuine storage failure -- see module
        docstring for why this does not swallow errors the way
        TelemetryRepository.record_events does."""
        ...

    async def list_recent(self, limit: int = 100) -> list[ContactSubmission]:
        """Newest first. Test/diagnostic only -- never exposed over HTTP."""
        ...
