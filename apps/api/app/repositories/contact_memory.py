"""In-memory ContactRepository -- the backend used in dev and in tests when
DATABASE_URL is unset, same discipline as every other Memory* repository
here. Bounded like MemoryTelemetryRepository, for the same reason: an
unauthenticated write per visitor in a long-running dev process is
unbounded otherwise.
"""
from __future__ import annotations

import asyncio
import uuid
from collections import deque
from datetime import datetime, timezone

from app.repositories.contact_protocols import ContactRepository, ContactSubmission

#: Generous for a dev/test session -- contact submissions are rare compared
#: to telemetry events, so this bound is mostly theoretical.
MAX_RETAINED_SUBMISSIONS = 2000


class MemoryContactRepository:
    def __init__(self, max_submissions: int = MAX_RETAINED_SUBMISSIONS) -> None:
        self._submissions: deque[ContactSubmission] = deque(maxlen=max_submissions)
        self._lock = asyncio.Lock()

    async def record(self, submission: ContactSubmission) -> ContactSubmission:
        async with self._lock:
            submission.id = submission.id or str(uuid.uuid4())
            if submission.created_at is None:  # pragma: no cover - dataclass default covers this
                submission.created_at = datetime.now(timezone.utc)
            self._submissions.append(submission)
            return submission

    async def list_recent(self, limit: int = 100) -> list[ContactSubmission]:
        return list(self._submissions)[-limit:][::-1]

    async def clear(self) -> None:
        """Test helper -- not on the protocol."""
        async with self._lock:
            self._submissions.clear()


assert isinstance(MemoryContactRepository(), ContactRepository)
