"""RUN THE TABLE API endpoints.

Routes:
  GET  /api/v1/run-the-table/readiness            - flag + card-pool diagnostic (never 403)
  GET  /api/v1/run-the-table/meta                 - the whole ruleset (cacheable, no run state)
  GET  /api/v1/run-the-table/daily                - today's descriptor + whether you played it
  POST /api/v1/run-the-table/runs                 - create (standard | daily | challenge)
  GET  /api/v1/run-the-table/runs/{run_id}        - resume
  POST /api/v1/run-the-table/runs/{run_id}/actions- apply one action (idempotent by key)
  POST /api/v1/run-the-table/runs/{run_id}/challenge - mint an /arena/run-the-table?c={token} link
  GET  /api/v1/run-the-table/challenges/{token}   - spoiler-safe descriptor

A thin transport shell. Every rule -- what a card costs, which slot is legal,
who wins a lane, what a run is worth -- lives in nba_peak/run_the_table/, and
what the browser may see lives in services/run_the_table/public.py. Nothing
here re-derives or second-guesses either, and no PEAK3 score is computed at
request time (CLAUDE.md).

ANONYMOUS PLAY IS THE DEFAULT PATH, not a fallback. Every route uses
OptionalAuth + resolve_owner_sub, exactly as perfect_season.py does, so a
first-time visitor with no account gets a signed anon cookie and a real,
resumable, server-authoritative run. Requiring sign-in to press "start" would
put an account wall in front of the flagship mode.

READINESS NEVER 403s. It is the endpoint the web app calls to decide whether to
render the mode at all, so gating it behind the same flag it reports would make
failing closed impossible -- the client could not tell "disabled" from "broken"
from "not deployed". It also never 503s on a missing card pool: it reports
`card_pool.available = false` instead, because "the data has not been built" is
a genuinely different operational state from "the service is down".

ERROR MAPPING, and why each one is what it is:
  RunActionError    -> 409  the rules forbid this move (carries the engine's
                            stable `code`, which the UI renders as plain language)
  VersionMismatch   -> 409  this saved run predates a ruleset change
  KeyError          -> 404  unknown node/card/stage id inside the engine
  RunNotFound       -> 404
  RunForbidden      -> 403  someone else's run
  InvalidActionRequest -> 422  the request never described a move
  InvalidRunDate    -> 422
  CardPoolUnavailable  -> 503  retryable: generated artifacts are missing

These handlers are `async def` because they await the repository. The engine
work between awaits is pure in-process CPU over the cached card pool -- no
network, no disk, no scraping (CLAUDE.md).
"""
from __future__ import annotations

import secrets
import sys
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Cookie, HTTPException, Query, Response

_repo_root = Path(__file__).resolve().parent.parent.parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from app.core.auth import ANON_COOKIE_NAME, OptionalAuth, resolve_owner_sub, verify_anon_subject
from app.core.config import settings
from app.core.dependencies import RunTheTableRunRepoDep
from app.core.security import create_session_token, verify_session_token
from app.models.run_the_table import (
    CardPoolStatus,
    ChallengeDescriptorResponse,
    ChallengeLinkResponse,
    CreateRunRequest,
    DailyDescriptorResponse,
    RulesetMetaResponse,
    RunActionRequest,
    RunStateResponse,
    RunTheTableReadinessResponse,
    error_detail,
)
from app.services.run_the_table import runs as run_service
from app.services.run_the_table.public import ruleset_meta
from nba_peak.run_the_table.cards import CardPoolUnavailable
from nba_peak.run_the_table.config import version_tuple
from nba_peak.run_the_table.daily import (
    InvalidRunDate,
    daily_descriptor,
    today_utc_date,
    validate_run_date,
)
from nba_peak.run_the_table.state import RunActionError, VersionMismatch

router = APIRouter()

# Challenge links live for a week. Long enough that a link shared on a Friday
# still works the following weekend; short enough that a token cannot outlive
# the ruleset it encodes by much.
CHALLENGE_TTL_SECONDS = 7 * 86400
CHALLENGE_TOKEN_KIND = "run_the_table"


# ---------------------------------------------------------------------------
# Gating helpers
# ---------------------------------------------------------------------------

def _require_enabled() -> None:
    if not settings.RUN_THE_TABLE_ENABLED:
        raise HTTPException(
            status_code=403,
            detail=error_detail(
                "RUN THE TABLE is not enabled.", "run_the_table_not_enabled"
            ),
        )


def _require_daily_enabled() -> None:
    _require_enabled()
    if not settings.RUN_THE_TABLE_DAILY_ENABLED:
        raise HTTPException(
            status_code=403,
            detail=error_detail(
                "The RUN THE TABLE daily is not enabled.", "run_the_table_daily_not_enabled"
            ),
        )


def _pool():
    """The card pool, or a 503 that says so honestly."""
    try:
        return run_service.card_pool()
    except CardPoolUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail=error_detail(
                f"{exc} This is a data-build problem, not a bad request -- retry once "
                "the generated artifacts are present.",
                "card_pool_unavailable",
            ),
        )


def _owner(auth, response: Response, anon_cookie: Optional[str]) -> str:
    return resolve_owner_sub(auth, anon_cookie, response, settings.SIGNING_SECRET)


def _existing_owner(auth, anon_cookie: Optional[str]) -> Optional[str]:
    """The caller's identity IF they already have one -- never mints a new one.

    Used by the daily descriptor, which is otherwise a pure read: handing a
    brand-new visitor a 30-day identity cookie just for looking at today's date
    would be issuing a credential nobody asked for.
    """
    if auth is not None:
        return auth.sub
    if anon_cookie:
        return verify_anon_subject(anon_cookie, settings.SIGNING_SECRET)
    return None


def _raise_for_engine_error(exc: Exception):
    """Translate one engine exception into its HTTP answer. Always raises."""
    if isinstance(exc, VersionMismatch):
        raise HTTPException(
            status_code=409,
            detail=error_detail(str(exc), "version_mismatch"),
        )
    if isinstance(exc, RunActionError):
        raise HTTPException(
            status_code=409, detail=error_detail(exc.message, exc.code)
        )
    if isinstance(exc, run_service.InvalidActionRequest):
        raise HTTPException(
            status_code=422, detail=error_detail(exc.message, exc.code)
        )
    if isinstance(exc, run_service.RunNotFound):
        raise HTTPException(
            status_code=404, detail=error_detail("Run not found.", "run_not_found")
        )
    if isinstance(exc, run_service.RunForbidden):
        raise HTTPException(
            status_code=403,
            detail=error_detail(
                "This run belongs to a different player.", "run_not_owned"
            ),
        )
    if isinstance(exc, CardPoolUnavailable):
        raise HTTPException(
            status_code=503, detail=error_detail(str(exc), "card_pool_unavailable")
        )
    if isinstance(exc, KeyError):
        # The engine raises bare KeyError for an unknown card/node/stage id.
        raise HTTPException(
            status_code=404,
            detail=error_detail(str(exc).strip("'\""), "unknown_id"),
        )
    raise exc


async def _load(repo, run_id: str, owner_sub: str, pool):
    try:
        return await run_service.load_run(repo, run_id, owner_sub, pool)
    except Exception as exc:  # translated exhaustively, then re-raised
        _raise_for_engine_error(exc)


def _state_response(state, blueprint, pool) -> RunStateResponse:
    return RunStateResponse(**run_service.public_view(state, blueprint, pool))


# ---------------------------------------------------------------------------
# Readiness -- no auth, never 403, never 503. See the module docstring.
# ---------------------------------------------------------------------------

@router.get("/run-the-table/readiness", response_model=RunTheTableReadinessResponse)
async def get_readiness() -> RunTheTableReadinessResponse:
    """Flag state plus whether the card pool is actually loadable.

    Safe diagnostic: version strings and pool counts only. No run state, no
    seeds, no roster, nothing owned by anyone.
    """
    try:
        stats = run_service.card_pool().stats
        pool_status = CardPoolStatus(
            available=True,
            duration_years=stats.duration_years,
            card_count=stats.card_count,
            excluded_count=stats.excluded_count,
            prime_score_min=stats.prime_score_min,
            prime_score_max=stats.prime_score_max,
        )
    except CardPoolUnavailable as exc:
        pool_status = CardPoolStatus(available=False, error=str(exc))

    return RunTheTableReadinessResponse(
        enabled=settings.RUN_THE_TABLE_ENABLED,
        daily_enabled=settings.RUN_THE_TABLE_DAILY_ENABLED,
        readiness_level=settings.RUN_THE_TABLE_READINESS_LEVEL,
        versions=version_tuple(),
        card_pool=pool_status,
    )


# ---------------------------------------------------------------------------
# Ruleset meta -- static and cacheable
# ---------------------------------------------------------------------------

@router.get("/run-the-table/meta", response_model=RulesetMetaResponse)
async def get_meta() -> RulesetMetaResponse:
    """Every rule the game applies, with the constants it applies them with.

    The rules screen renders from this rather than from hard-coded copy, which
    is what stops displayed rules from drifting away from applied rules --
    both sides read the same `config.py` values.
    """
    _require_enabled()
    return RulesetMetaResponse(**ruleset_meta(_pool()))


# ---------------------------------------------------------------------------
# Daily descriptor
# ---------------------------------------------------------------------------

@router.get("/run-the-table/daily", response_model=DailyDescriptorResponse)
async def get_daily(
    auth: OptionalAuth,
    repo: RunTheTableRunRepoDep,
    date: Optional[str] = Query(
        None, max_length=32, description="YYYY-MM-DD (UTC); defaults to today"
    ),
    peak3_anon: Optional[str] = Cookie(default=None, alias=ANON_COOKIE_NAME),
) -> DailyDescriptorResponse:
    """Today's daily run descriptor, or an archive date's.

    The seed is published deliberately: it is a pure function of the date, so
    everyone getting the same run is true by construction rather than by
    synchronisation, and a challenge link to a daily is reproducible. It gives
    away no content -- deriving the roster from the seed requires the engine.

    `already_played` is present only for a caller who already carries an
    identity; see DailyDescriptorResponse for why it is not defaulted to false.
    """
    _require_daily_enabled()
    try:
        run_date = validate_run_date(date) if date else today_utc_date()
    except InvalidRunDate as exc:
        raise HTTPException(
            status_code=422, detail=error_detail(str(exc), "invalid_run_date")
        )

    payload = dict(daily_descriptor(run_date))
    owner_sub = _existing_owner(auth, peak3_anon)
    if owner_sub:
        existing = await repo.get_daily_run(owner_sub, run_date)
        payload["already_played"] = existing is not None
        payload["existing_run_id"] = existing.run_id if existing else None
    return DailyDescriptorResponse(**payload)


# ---------------------------------------------------------------------------
# Create a run
# ---------------------------------------------------------------------------

def _decode_challenge_token(token: str) -> dict:
    payload = verify_session_token(token, settings.SIGNING_SECRET)
    if payload is None or payload.get("kind") != CHALLENGE_TOKEN_KIND:
        raise HTTPException(
            status_code=404,
            detail=error_detail(
                "This challenge link is invalid or has expired.", "invalid_challenge_token"
            ),
        )
    return payload


@router.post("/run-the-table/runs", response_model=RunStateResponse)
async def create_run(
    body: CreateRunRequest,
    auth: OptionalAuth,
    response: Response,
    repo: RunTheTableRunRepoDep,
    peak3_anon: Optional[str] = Cookie(default=None, alias=ANON_COOKIE_NAME),
) -> RunStateResponse:
    """Start a run. No account required.

    Three sources of a seed, and only one of them is the client:
      standard  -- `secrets.randbelow(2**31)`, or the client's seed if it sent
                   one (which is what makes a shared standard run replayable)
      daily     -- derived from the UTC date; a client seed is ignored, because
                   a re-rollable daily is not a daily
      challenge -- read from the HMAC-signed token, together with the run type
                   and date it was minted from, so the recipient plays the
                   sender's run rather than a lookalike

    Re-creating a daily you already started returns the run in progress rather
    than a new one (HTTP 200 either way -- a reload is not an error).
    """
    _require_enabled()
    pool = _pool()
    owner_sub = _owner(auth, response, peak3_anon)

    run_type = body.run_type
    seed = body.seed
    date = body.date

    if run_type == "challenge":
        if not body.challenge_token:
            raise HTTPException(
                status_code=422,
                detail=error_detail(
                    "run_type 'challenge' requires a challenge_token.",
                    "missing_challenge_token",
                ),
            )
        payload = _decode_challenge_token(body.challenge_token)
        seed = int(payload["seed"])
        # The token's seed is what makes the run identical; its `run_type` is
        # only provenance. The new run stays `challenge` regardless, for two
        # reasons: it should be labelled as a challenge play rather than
        # masquerading as the recipient's own free run, and a challenge minted
        # from someone else's DAILY must not consume the recipient's daily
        # attempt for that date.
        run_type = "challenge"
        # Carried for provenance only; `resolve_seed` never re-derives a seed
        # from a date unless run_type is "daily".
        date = payload.get("date")
    elif run_type == "daily":
        _require_daily_enabled()
        seed = None  # a daily's seed comes from its date, never from a client

    try:
        stored, state, blueprint, _created = await run_service.create_run(
            repo, owner_sub, run_type, seed, date, pool
        )
    except InvalidRunDate as exc:
        raise HTTPException(
            status_code=422, detail=error_detail(str(exc), "invalid_run_date")
        )
    except Exception as exc:
        _raise_for_engine_error(exc)

    return _state_response(state, blueprint, pool)


# ---------------------------------------------------------------------------
# Resume
# ---------------------------------------------------------------------------

@router.get("/run-the-table/runs/{run_id}", response_model=RunStateResponse)
async def get_run(
    run_id: str,
    auth: OptionalAuth,
    response: Response,
    repo: RunTheTableRunRepoDep,
    peak3_anon: Optional[str] = Cookie(default=None, alias=ANON_COOKIE_NAME),
) -> RunStateResponse:
    """The current public state of a run you own.

    The blueprint is regenerated from the stored seed on every call, so what is
    returned is always provably still what that seed produces.
    """
    _require_enabled()
    pool = _pool()
    owner_sub = _owner(auth, response, peak3_anon)
    _stored, state, blueprint = await _load(repo, run_id, owner_sub, pool)
    return _state_response(state, blueprint, pool)


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------

@router.post("/run-the-table/runs/{run_id}/actions", response_model=RunStateResponse)
async def apply_run_action(
    run_id: str,
    body: RunActionRequest,
    auth: OptionalAuth,
    response: Response,
    repo: RunTheTableRunRepoDep,
    peak3_anon: Optional[str] = Cookie(default=None, alias=ANON_COOKIE_NAME),
) -> RunStateResponse:
    """Apply one action and return the whole refreshed state.

    THE SERVER IS AUTHORITATIVE. The client sends an intent, not a result: it
    never says what a card cost, whether a slot was legal, or who won a lane.
    Every one of those is decided by the engine from the run's own persisted
    state and the blueprint its seed produces.

    IDEMPOTENT BY KEY. Resending the same `idempotency_key` is a no-op that
    returns the same state with an unchanged `action_count` -- so a retry after
    a dropped connection cannot buy the same card twice or resolve a boss
    twice. The check lives in the engine's action log, so there is no second
    cache that could disagree with it.
    """
    _require_enabled()
    pool = _pool()
    owner_sub = _owner(auth, response, peak3_anon)
    stored, state, blueprint = await _load(repo, run_id, owner_sub, pool)

    fields = body.model_dump(exclude={"action_type", "idempotency_key"})
    try:
        state = run_service.apply_action(
            state, blueprint, pool, body.action_type, fields, body.idempotency_key
        )
    except Exception as exc:
        _raise_for_engine_error(exc)

    await run_service.save_run(repo, stored, state)
    return _state_response(state, blueprint, pool)


# ---------------------------------------------------------------------------
# Challenge links
# ---------------------------------------------------------------------------

@router.post("/run-the-table/runs/{run_id}/challenge", response_model=ChallengeLinkResponse)
async def create_challenge(
    run_id: str,
    auth: OptionalAuth,
    response: Response,
    repo: RunTheTableRunRepoDep,
) -> ChallengeLinkResponse:
    """Mint a shareable link that reproduces this run's board.

    THE TOKEN CARRIES THE SEED, NOT THE RUN. It says "play this board", never
    "here is what I did with it" -- so it is safe to share before finishing,
    and the recipient gets a genuine attempt rather than a spoiler.

    HMAC-signed with the server's signing secret and a 7-day expiry, so a seed
    cannot be smuggled in from outside (which would matter the moment a shared
    board is compared between two players), and a `nonce` makes two links for
    the same run distinct tokens rather than one shared string.

    Deliberately readable by anyone who can read the run: no ownership check
    beyond the run existing. The seed is not secret -- a daily's is published
    outright -- and requiring ownership would break the obvious flow of a
    spectator sharing a board they were shown.
    """
    _require_enabled()
    stored = await repo.get_run(run_id)
    if stored is None:
        raise HTTPException(
            status_code=404, detail=error_detail("Run not found.", "run_not_found")
        )

    token = create_session_token(
        {
            "kind": CHALLENGE_TOKEN_KIND,
            "seed": stored.seed,
            "run_type": stored.run_type,
            "date": stored.run_date,
            "nonce": secrets.token_hex(8),
        },
        settings.SIGNING_SECRET,
        ttl_seconds=CHALLENGE_TTL_SECONDS,
    )
    # `/arena/run-the-table?c={token}` -- NOT `/c/{token}`. `/c/[token]` is Peak
    # Draft's challenge page: it resolves the token against
    # `/api/v1/draft/challenges/{token}/meta`, which knows nothing about a RUN
    # THE TABLE token, so every link minted here used to land the recipient on a
    # not-found screen. The RUN THE TABLE route reads its token from `?c=`
    # (see apps/web/src/app/(main)/arena/run-the-table/page.tsx), and
    # `challengeUrl()` in run-the-table-state.ts builds the same shape.
    return ChallengeLinkResponse(
        challenge_token=token,
        public_url_path=f"/arena/run-the-table?c={token}",
    )


@router.get("/run-the-table/challenges/{token}", response_model=ChallengeDescriptorResponse)
async def get_challenge(token: str) -> ChallengeDescriptorResponse:
    """What a challenge link resolves to, for the recipient's landing page.

    SPOILER-SAFE BY OMISSION: seed, run type, date and versions -- no roster,
    no bosses, no offers, no map, and nothing at all about the sender's run.
    The recipient plays the board; they do not get to read it first.

    `versions` is included so the landing page can say "this link was made
    under an older ruleset" instead of failing confusingly at create time.
    """
    _require_enabled()
    payload = _decode_challenge_token(token)
    return ChallengeDescriptorResponse(
        seed=int(payload["seed"]),
        run_type=payload.get("run_type") or "standard",
        date=payload.get("date"),
        versions=version_tuple(),
    )
