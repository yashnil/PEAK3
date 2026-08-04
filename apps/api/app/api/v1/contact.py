"""Contact / feedback (launch-polish IMPLEMENTATION_CONTRACT.md §9).

  POST /api/v1/contact   - authenticated-or-anonymous, rate-limited

ONE ENDPOINT, AND IT ONLY WRITES. There is no GET, for the same reason
telemetry has none: a client that can read its own submissions is one
broken predicate away from reading everyone's, and the RLS policy on
`contact_submissions` denies every PostgREST verb regardless (see that
migration). Whatever admin tooling eventually reads this table talks to
Postgres directly with the owner role, the same way
scripts/telemetry_report.py does -- not built in this pass.

MODELED ON app/api/v1/telemetry.py, WITH ONE DELIBERATE DIFFERENCE. Both
routes are authentication-optional and rate-limited for the same reason
(the people most likely to need contact -- someone who can't sign in, a
first-time visitor reporting a bug before ever creating an account -- are
exactly the cohort requiring auth would exclude). But telemetry's ingest
NEVER fails the caller's request on a storage error; this one DOES. A lost
analytics event costs nothing anyone notices. A contact form that silently
swallowed the message someone typed to report a real problem, while
telling them "sent!", is a worse outcome than an honest error they can
retry -- see ContactRepository's docstring.

HONEYPOT, NOT A CAPTCHA. `ContactSubmissionIn.website` is a field a real
user's form never shows and never fills; the frontend renders it visually
hidden (never `display: none` alone, which some scrapers skip -- see the UI
component). A non-empty value gets a normal-looking 202 back (so a bot
learns nothing about being caught) and writes nothing.

OFF BY DEFAULT. `PEAK3_CONTACT_ENABLED` is false unless an operator sets
it -- same posture as telemetry. When off, the route answers 403 with a
stable code and writes nothing.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Cookie, HTTPException, Request, Response, status
from typing import Optional

from app.core.auth import ANON_COOKIE_NAME, OptionalAuth, resolve_owner_sub
from app.core.config import settings
from app.core.rate_limit import RateLimitRule, client_key, limiter
from app.models.contact import ContactSubmissionIn, ContactSubmissionResponse, hash_subject, subject_kind
from app.repositories.contact_memory import MemoryContactRepository
from app.repositories.contact_protocols import ContactRepository, ContactSubmission

router = APIRouter(prefix="/contact", tags=["contact"])

_memory_contact_repo = MemoryContactRepository()


def get_contact_repo(request: Request) -> ContactRepository:
    pool = getattr(request.app.state, "db_pool", None)
    if pool is not None:
        from app.repositories.contact_postgres import PostgresContactRepository

        return PostgresContactRepository(pool)
    return _memory_contact_repo


def _error(message: str, error_code: str) -> dict:
    """The error envelope every Arena router uses (see daily_grid.py,
    telemetry.py)."""
    return {"error_code": error_code, "message": message}


def _enforce_rate_limit(request: Request) -> None:
    """Meter one submission, or raise 429. Uses the shared `client_key`
    (scope + IP + verified anon-cookie subject), same as telemetry -- see
    that route's own docstring on why the IP is a bucket dimension only and
    never persisted."""
    rule = RateLimitRule(
        limit=settings.CONTACT_RATE_LIMIT,
        window_seconds=settings.CONTACT_RATE_LIMIT_WINDOW_SECONDS,
    )
    verdict = limiter.check(client_key(request, "contact:submit"), rule)
    if verdict.allowed:
        return
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=_error(
            "Too many contact submissions from this session. Please wait before trying again.",
            "rate_limited",
        ),
        headers={"Retry-After": str(verdict.retry_after_seconds)},
    )


@router.post(
    "",
    response_model=ContactSubmissionResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Submit a contact / feedback message",
)
async def submit_contact(
    request: Request,
    response: Response,
    payload: ContactSubmissionIn,
    auth: OptionalAuth,
    peak3_anon: Optional[str] = Cookie(default=None, alias=ANON_COOKIE_NAME),
) -> ContactSubmissionResponse:
    """Accept one message. 202: the message is accepted, and (matching the
    contract's "honest copy only" rule) the response never claims a human
    has read it or that an email was sent -- there is no delivery service.

    IDENTITY. `resolve_owner_sub` is the same shared path every
    owned-data-optional route uses (telemetry, and every OptionalAuth
    CourtBuilder route): the verified JWT sub when signed in, else the
    signed anon cookie's subject, else a freshly minted one. Only
    `subject_hash` is derived from it and stored -- the raw value never
    reaches the database, same construction as telemetry_events.
    """
    if not settings.CONTACT_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_error("Contact submission is not enabled on this deployment.", "contact_disabled"),
        )

    _enforce_rate_limit(request)

    # Honeypot: respond exactly like a real success, write nothing. A bot
    # that filled every field (including the one a real user never sees)
    # gets no signal that anything was different about this response.
    if payload.website.strip():
        return ContactSubmissionResponse(request_id=str(uuid.uuid4()), accepted=True)

    owner_sub = resolve_owner_sub(auth, peak3_anon, response, settings.SIGNING_SECRET)
    digest = hash_subject(owner_sub, settings.SIGNING_SECRET)
    kind = subject_kind(owner_sub)

    repo = get_contact_repo(request)
    try:
        saved = await repo.record(
            ContactSubmission(
                subject_hash=digest,
                subject_kind=kind,
                category=payload.category,
                relevant_area=payload.relevant_area,
                subject=payload.subject,
                message=payload.message,
                reply_email=payload.reply_email,
            )
        )
    except Exception as exc:
        # Deliberately NOT telemetry's "never raise" posture -- see this
        # module's and ContactRepository's docstrings. Logged without the
        # message/subject content: the free text is what a privacy review
        # would look at, and an exception string is not the place for it.
        import logging

        logging.getLogger(__name__).error(
            "Contact submission failed to store: %s", type(exc).__name__
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=_error(
                "Could not store your message right now. Please try again in a moment.",
                "storage_unavailable",
            ),
        ) from exc

    return ContactSubmissionResponse(request_id=saved.id or str(uuid.uuid4()), accepted=True)
