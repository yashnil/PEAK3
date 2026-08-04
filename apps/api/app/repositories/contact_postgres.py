"""PostgreSQL-backed ContactRepository (launch-polish IMPLEMENTATION_CONTRACT.md
§9).

Writes through the API's own owner-role asyncpg pool, like every other
Postgres* repository here -- that role is not subject to the RLS policy in
20260803110000_contact_submissions.sql, which is the intended split: the
policy denies PostgREST clients everything, and this process is the only
writer.

UNLIKE PostgresTelemetryRepository, `record` DOES raise on storage failure
rather than swallowing it. See contact_protocols.py's module docstring for
why: a contact submission is a deliberate act, and reporting success while
nothing was stored would be worse than a clear, retryable error.
"""
from __future__ import annotations

import uuid
from typing import Any

from app.repositories.contact_protocols import ContactSubmission

try:
    import asyncpg  # type: ignore[import]
    _ASYNCPG_AVAILABLE = True
except ImportError:
    _ASYNCPG_AVAILABLE = False


def _require_asyncpg() -> None:
    if not _ASYNCPG_AVAILABLE:
        raise RuntimeError(
            "asyncpg is required for PostgreSQL repositories. Install it: pip install asyncpg"
        )


def _row_to_submission(row: Any) -> ContactSubmission:
    return ContactSubmission(
        id=str(row["id"]),
        subject_hash=row["subject_hash"],
        subject_kind=row["subject_kind"],
        category=row["category"],
        relevant_area=row["relevant_area"],
        subject=row["subject"],
        message=row["message"],
        reply_email=row["reply_email"],
        status=row["status"],
        created_at=row["created_at"],
    )


class PostgresContactRepository:
    def __init__(self, pool: Any) -> None:
        _require_asyncpg()
        self._pool = pool

    async def record(self, submission: ContactSubmission) -> ContactSubmission:
        row_id = uuid.UUID(submission.id) if submission.id else uuid.uuid4()
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO contact_submissions
                    (id, subject_hash, subject_kind, category, relevant_area,
                     subject, message, reply_email, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, NOW()))
                RETURNING *
                """,
                row_id,
                submission.subject_hash,
                submission.subject_kind,
                submission.category,
                submission.relevant_area,
                submission.subject,
                submission.message,
                submission.reply_email,
                submission.created_at,
            )
        # No try/except here, deliberately -- see this module's docstring
        # and contact_protocols.py: a genuine storage failure must surface
        # to the caller (api/v1/contact.py turns it into a 500 with a
        # retryable error code), not be swallowed the way telemetry's is.
        return _row_to_submission(row)

    async def list_recent(self, limit: int = 100) -> list[ContactSubmission]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM contact_submissions ORDER BY created_at DESC LIMIT $1",
                limit,
            )
        return [_row_to_submission(r) for r in rows]
