"""Product telemetry ingest (Track F).

  POST /api/v1/telemetry/events   - batched, anonymous-or-authenticated

ONE ENDPOINT, AND IT ONLY WRITES. There is no GET. Nothing reads a telemetry
row back over HTTP, for the same reason the migration's RLS policy denies
PostgREST every verb: a client that can read its own events is one broken
predicate away from reading everyone's, and no product surface needs it.
Analysis is server-side only (scripts/telemetry_report.py).

WHY THIS ENDPOINT IS UNAUTHENTICATED AND WHY THAT IS THE RISK TO MANAGE. The
questions telemetry has to answer are all about people who have NOT signed in
-- does a first-time visitor finish a run, does the tutorial help, does anyone
come back tomorrow. Requiring auth would blind it to exactly the cohort it
exists for. The price is an unauthenticated write endpoint, which is the
obvious abuse surface in this codebase, so it is metered
(app/core/rate_limit.py, the second router to opt in after daily_grid) and
bounded on every axis a body can grow along: batch size, property count,
property value length, serialized bytes and Content-Length.

OFF BY DEFAULT. `PEAK3_TELEMETRY_ENABLED` is false unless an operator sets it.
A privacy-affecting collection path that turns itself on at install time is
not a privacy-conscious one. When off, the route answers 403 with a stable
code and writes nothing; the browser client treats any non-2xx as "stop
sending for this session" and the product is unaffected.

WHAT NEVER ENTERS THIS PROCESS'S MEMORY, LET ALONE THE DATABASE: the request's
Authorization header (read only by the shared auth dependency, never here),
the client IP (used by the limiter as a bucket key and never persisted), the
raw owner subject (hashed at the boundary below, before a row is constructed),
and any string that is not a short slug. See docs/implementation/TELEMETRY.md.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status

from app.core.auth import ANON_COOKIE_NAME, OptionalAuth, resolve_owner_sub
from app.core.config import settings
from app.core.rate_limit import RateLimitRule, client_key, limiter
from app.models.telemetry import (
    DEFAULT_RETENTION_DAYS,
    EVENT_NAMES,
    MAX_EVENTS_PER_BATCH,
    TelemetryBatchIn,
    TelemetryBatchResponse,
    TelemetryEventIn,
    TelemetryValidationError,
    hash_subject,
    retention_expiry,
    subject_kind,
    validate_properties,
)
from app.repositories.telemetry_memory import MemoryTelemetryRepository
from app.repositories.telemetry_protocols import TelemetryEvent, TelemetryRepository

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/telemetry", tags=["telemetry"])

# Spelled as literals rather than `status.HTTP_422_UNPROCESSABLE_ENTITY` /
# `status.HTTP_413_REQUEST_ENTITY_TOO_LARGE`: the installed Starlette emits a
# DeprecationWarning for both names, and this repo runs its suites without a
# warning filter.
_HTTP_413 = 413
_HTTP_422 = 422


# ---------------------------------------------------------------------------
# Configuration
#
# These are module constants rather than Settings fields because
# app/core/config.py is owned by another track in this pass. The resolver
# below reads a Settings attribute FIRST when one exists, so the day the lead
# adds `TELEMETRY_ENABLED` / `TELEMETRY_RATE_LIMIT` / ... to Settings, these
# constants become dead defaults with no code change here. The exact fields
# requested are listed in docs/implementation/TELEMETRY.md.
# ---------------------------------------------------------------------------


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


#: Master switch. OFF by default -- see the module docstring.
TELEMETRY_ENABLED = _env_bool("PEAK3_TELEMETRY_ENABLED", False)

#: Ingest requests per client key per window. A playing client emits a few
#: events a minute and batches them, so this is far above real use and far
#: below what a flood needs. Combined with MAX_EVENTS_PER_BATCH it caps one
#: client at 60 x 20 = 1200 events/minute.
TELEMETRY_RATE_LIMIT = _env_int("PEAK3_TELEMETRY_RATE_LIMIT", 60)
TELEMETRY_RATE_LIMIT_WINDOW_SECONDS = 60.0

#: Days a row survives. Stamped onto every row at write time.
TELEMETRY_RETENTION_DAYS = _env_int("PEAK3_TELEMETRY_RETENTION_DAYS", DEFAULT_RETENTION_DAYS)

#: Hard ceiling on the request body, checked before parsing. MAX_EVENTS_PER_BATCH
#: events at MAX_PROPS_BYTES each is ~20 KB; 64 KB leaves generous headroom
#: while still refusing a megabyte of JSON without reading it.
MAX_BODY_BYTES = 64 * 1024


def telemetry_enabled() -> bool:
    configured = getattr(settings, "TELEMETRY_ENABLED", None)
    if configured is not None:
        return bool(configured)
    return TELEMETRY_ENABLED


def _rate_limit() -> int:
    configured = getattr(settings, "TELEMETRY_RATE_LIMIT", None)
    return int(configured) if configured is not None else TELEMETRY_RATE_LIMIT


def _retention_days() -> int:
    configured = getattr(settings, "TELEMETRY_RETENTION_DAYS", None)
    return int(configured) if configured is not None else TELEMETRY_RETENTION_DAYS


# ---------------------------------------------------------------------------
# Repository wiring
#
# Local to this router rather than in core/dependencies.py, which another
# track owns in this pass. Same single-flag switch every other domain uses
# (`app.state.db_pool is not None`), so telemetry cannot end up on a different
# backend from the rest of the process.
# ---------------------------------------------------------------------------

_memory_telemetry_repo = MemoryTelemetryRepository()


def get_telemetry_repo(request: Request) -> TelemetryRepository:
    pool = getattr(request.app.state, "db_pool", None)
    if pool is not None:
        from app.repositories.telemetry_postgres import PostgresTelemetryRepository

        return PostgresTelemetryRepository(pool)
    # No warning log here, unlike the other repos: with the flag off by
    # default this path is the normal local one, and a per-request warning
    # about analytics storage is noise nobody can act on.
    return _memory_telemetry_repo


def _error(message: str, error_code: str) -> dict:
    """The error envelope every Arena router uses (see daily_grid.py)."""
    return {"error_code": error_code, "message": message}


def _enforce_rate_limit(request: Request) -> None:
    """Meter one ingest request, or raise 429.

    Uses the shared `client_key`, which buckets on scope + IP + the anon
    cookie subject. Note that the IP is used here and nowhere else: it is a
    bucket dimension inside an in-process dict and is never written to the
    telemetry store, never logged, and never part of an event.

    The 429 body carries `Retry-After` and no budget information, matching
    daily_grid.py -- a remaining-request count is the calibration signal an
    abuser wants.
    """
    rule = RateLimitRule(
        limit=_rate_limit(), window_seconds=TELEMETRY_RATE_LIMIT_WINDOW_SECONDS
    )
    verdict = limiter.check(client_key(request, "telemetry:ingest"), rule)
    if verdict.allowed:
        return
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=_error("Too many telemetry requests.", "rate_limited"),
        headers={"Retry-After": str(verdict.retry_after_seconds)},
    )


def _validate_event(event: TelemetryEventIn) -> None:
    """Closed-vocabulary check. Raises 422 naming the rule, never the value.

    Two distinct failures, deliberately distinguishable by the caller:
      * `unknown_event`      -- the name is not in the allowlist. Adding an
                                event is an edit to app/models/telemetry.py,
                                not something a client can do by sending one.
      * `forbidden_property` -- a key we name on purpose (email/token/...).
                                Redundant with the property allowlist and kept
                                because a privacy regression should not read
                                like a typo.
    """
    if event.name not in EVENT_NAMES:
        raise HTTPException(
            status_code=_HTTP_422,
            detail=_error(
                "Unknown telemetry event name.",
                "unknown_event",
            ),
        )
    try:
        validate_properties(event.props)
    except TelemetryValidationError as exc:
        raise HTTPException(
            status_code=_HTTP_422,
            detail=_error(exc.message, exc.code),
        )


@router.post(
    "/events",
    response_model=TelemetryBatchResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Ingest a batch of product telemetry events",
)
async def ingest_events(
    request: Request,
    response: Response,
    payload: TelemetryBatchIn,
    auth: OptionalAuth,
    repo: TelemetryRepository = Depends(get_telemetry_repo),
    peak3_anon: Optional[str] = Cookie(default=None, alias=ANON_COOKIE_NAME),
) -> TelemetryBatchResponse:
    """Accept a validated batch and return how many rows were taken.

    202, not 200: the events are accepted for recording, and the caller is
    explicitly not told anything about the stored representation.

    IDENTITY. `resolve_owner_sub` is the shared path every owned-data route
    uses; it returns the verified JWT `sub` when present, else the signed anon
    cookie's subject, else mints one. The raw value is used for exactly one
    thing here -- deriving `subject_hash` -- and is not stored, logged or
    returned.

    A NOTE ON THE MINTED COOKIE. Because telemetry may be the first call a
    brand-new visitor makes, this route can be the thing that issues the
    30-day anon cookie. That is acceptable (it is the same cookie every game
    route would issue moments later, and it is what makes an anonymous funnel
    countable at all) but it is worth being explicit about rather than
    incidental.
    """
    if not telemetry_enabled():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_error(
                "Telemetry collection is disabled on this deployment.",
                "telemetry_disabled",
            ),
        )

    _enforce_rate_limit(request)

    # Body bound, checked from the declared length. Starlette has already read
    # the body by the time a Pydantic model is bound, so this is a cheap
    # second line rather than the primary defence -- the primary defence is
    # MAX_EVENTS_PER_BATCH plus the per-event property caps, which bound the
    # amount of work regardless of what the header claims.
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            if int(declared) > MAX_BODY_BYTES:
                raise HTTPException(
                    status_code=_HTTP_413,
                    detail=_error("Telemetry batch too large.", "batch_too_large"),
                )
        except ValueError:
            pass

    if len(payload.events) > MAX_EVENTS_PER_BATCH:  # pragma: no cover - model bounds it
        raise HTTPException(
            status_code=_HTTP_422,
            detail=_error("Too many events in one batch.", "batch_too_large"),
        )

    for event in payload.events:
        _validate_event(event)

    owner_sub = resolve_owner_sub(auth, peak3_anon, response, settings.SIGNING_SECRET)
    digest = hash_subject(owner_sub, settings.SIGNING_SECRET)
    kind = subject_kind(owner_sub)
    now = datetime.now(timezone.utc)
    expires = retention_expiry(now, _retention_days())

    rows = [
        TelemetryEvent(
            subject_hash=digest,
            subject_kind=kind,
            event_name=event.name,
            props=dict(event.props),
            created_at=now,
            expires_at=expires,
        )
        for event in payload.events
    ]

    written = await repo.record_events(rows)
    return TelemetryBatchResponse(accepted=len(rows), stored=written == len(rows))
