"""Head-to-Head RUN THE TABLE — asynchronous two-player matches (spec §6).

Routes:
  GET  /run-the-table/h2h/rules                     - the published winner order
  POST /run-the-table/h2h                           - create from a run YOU own
  GET  /run-the-table/h2h/invite/{token}            - spoiler-safe landing page
  POST /run-the-table/h2h/invite/{token}/accept     - seat yourself, get a run
  GET  /run-the-table/h2h/history                   - your matches, newest first
  GET  /run-the-table/h2h/{match_id}                - your side + hidden opponent
  POST /run-the-table/h2h/{match_id}/result         - submit YOUR run's result
  GET  /run-the-table/h2h/{match_id}/receipt        - side-by-side, once settled
  POST /run-the-table/h2h/{match_id}/rematch        - a new board, same pairing

PURELY ADDITIVE. Nothing in `api/v1/run_the_table.py`,
`services/run_the_table/` or `nba_peak/run_the_table/` is modified by this
feature. A head-to-head run is created through `run_service.create_run` and
then PLAYED THROUGH THE EXISTING RUN ROUTES -- the same
`POST /run-the-table/runs/{run_id}/actions` every other run uses. This module
owns the pairing, the fairness pin and the comparison; it owns no gameplay.


AUTHORIZATION -- the whole point of the gate this feature was held behind
------------------------------------------------------------------------
Every mutation route here follows `ranked.py:196-203` `_get_participant_or_404`
exactly:

    participant = await repo.get_participant(match_id, auth.sub)
    if participant is None:  -> 403 not_a_participant

and then reads the run id **from `participant.run_id`**, never from the
request. There is no route in this file that accepts a client-supplied run id,
game id or opponent subject on a mutation. Possessing a match id gets you a
403; possessing an invite token gets you a read and the right to seat
*yourself*, and nothing else.

Concretely, against the pass spec §7's rule list:

* *possessing an ID never grants mutation rights* -- `_participant_or_403` on
  every mutation, plus `assert_owns` on the creator's source run at create
  time (the `POST /draft/challenges` S4 bug, not repeated).
* *the invite token must not expose a mutable resource ID* -- the token carries
  `inv`, 128 random bits, and the match is found by `sha256(inv)`. The match
  UUID is never in a token and is never accepted from one.
* *a challenge token permits only the intended read/play behaviour* -- the
  invite grants exactly two things: the spoiler-safe descriptor, and seating
  YOURSELF. It cannot submit, cannot settle, cannot rematch and cannot touch
  the other player's run.
* *public result viewing never implies mutation* -- `/receipt` is a pure read
  and is participant-only; the settlement is written by the second SUBMISSION,
  not by anybody looking at it. (Peak Draft's `/comparison` wrote a settlement
  on a GET; that shape is deliberately not repeated here.)
* *head-to-head play must not consume a daily attempt* -- both runs are created
  with `run_type="challenge"`, which `run_the_table.py:378-384` and
  `runs.resolve_seed` already guarantee never touches the daily index.
* *two-tab actions remain idempotent* -- accept, submit and rematch are each
  idempotent, and the first write wins in the repository rather than in an
  if-statement above it.

ERROR VOCABULARY, and why each one is what it is:
  403 not_a_participant     you are not in this match (never 404 -- see
                            ownership.py on why this codebase chose 403)
  403 not_your_run          you tried to create from someone else's run
  404 invalid_invite        forged, wrong-kind, expired or unknown invite
  409 fairness_mismatch     the board no longer regenerates identically
  409 run_not_finished      you have not finished your run yet
  409 match_full            two players are already seated
  409 cannot_play_yourself  the creator opened their own invite
  409 awaiting_opponent     the receipt is not spoiler-safe to serve yet
  410 match_expired         the match's own clock ran out
"""
from __future__ import annotations

import secrets
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Path as PathParam, Request

_repo_root = Path(__file__).resolve().parent.parent.parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from app.core.auth import RequiredAuth
from app.core.config import settings
from app.core.dependencies import (
    HeadToHeadRepoDep,
    ProfileRepoDep,
    RunTheTableRunRepoDep,
)
from app.core.ownership import assert_owns
from app.core.rate_limit import RateLimitRule, client_key, limiter
from app.core.security import create_session_token, verify_session_token
from app.models.head_to_head import (
    AcceptInviteRequest,
    CreateHeadToHeadRequest,
    HeadToHeadCreatedResponse,
    HeadToHeadHistoryEntry,
    HeadToHeadHistoryResponse,
    HeadToHeadMatchResponse,
    HeadToHeadReceiptResponse,
    HeadToHeadRulesResponse,
    InviteDescriptorResponse,
    ParticipantPublic,
    RematchRequest,
    SubmitResultRequest,
)
from app.models.run_the_table import error_detail
from app.services import head_to_head as h2h
from app.repositories.head_to_head_protocols import (
    MATCH_STATUS_IN_PROGRESS,
    MATCH_STATUS_OPEN,
    PARTICIPANT_ROLE_CREATOR,
    PARTICIPANT_ROLE_OPPONENT,
    PARTICIPANT_STATUS_IN_PROGRESS,
    HeadToHeadMatch,
    HeadToHeadParticipant,
    ParticipantSlotTaken,
)
from app.services.run_the_table import runs as run_service
from nba_peak.run_the_table.cards import CardPoolUnavailable
from nba_peak.run_the_table.config import RULESET_VERSION, TERMINAL_STATUSES, version_tuple
from nba_peak.run_the_table.receipt import build_receipt

router = APIRouter()

BASE = "/run-the-table/h2h"


# ---------------------------------------------------------------------------
# Gating and small helpers
# ---------------------------------------------------------------------------

def _require_enabled() -> None:
    """Head-to-head rides the RUN THE TABLE flag, not a flag of its own.

    A head-to-head IS a RUN THE TABLE run: if the mode is off, there is nothing
    for two players to play, and a second flag would create a combination
    ("h2h on, RTT off") that has no coherent behaviour.
    """
    if not settings.RUN_THE_TABLE_ENABLED:
        raise HTTPException(
            status_code=403,
            detail=error_detail(
                "RUN THE TABLE is not enabled.", "run_the_table_not_enabled"
            ),
        )


def _pool():
    try:
        return run_service.card_pool()
    except CardPoolUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail=error_detail(str(exc), "card_pool_unavailable"),
        )


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _expired(match: HeadToHeadMatch) -> bool:
    expires = match.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    return _now() > expires


def _require_not_expired(match: HeadToHeadMatch) -> None:
    if _expired(match):
        raise HTTPException(
            status_code=410,
            detail=error_detail(
                "This head-to-head has expired. Start a new one.", "match_expired"
            ),
        )


def _public_result(result: Optional[dict], *, own: bool) -> Optional[dict]:
    """One side's metrics as the CALLER may see them.

    `ComparisonMetrics.run_id` is kept in storage on purpose -- it is how a
    settled result is traced back to the run it was computed from, which is the
    only way to audit a disputed match. But it is another player's resource id,
    so it is stripped on the way out to anyone but its owner.

    This is not hypothetical tidiness: the first version of this route returned
    the stored dict verbatim and
    `test_the_opponents_run_id_is_never_exposed` caught the opponent's run id
    sitting in the settled receipt. `compare()` never reads the field, so
    removing it changes no verdict.
    """
    if result is None:
        return None
    if own:
        return result
    return {k: v for k, v in result.items() if k != "run_id"}


async def _display_name(profile_repo, sub: str) -> str:
    """A human name for an opponent, with an honest fallback.

    Never returns the raw subject: an `auth.uid()` is an identifier for a
    person, and showing one player another's is a privacy leak dressed as a
    label. A player who has not set a name shows as "PEAK3 player".
    """
    try:
        profile = await profile_repo.get_or_create_profile(sub)
    except Exception:
        return "PEAK3 player"
    return profile.display_name or profile.handle or "PEAK3 player"


# ---------------------------------------------------------------------------
# Invite tokens
# ---------------------------------------------------------------------------

#: The invite descriptor is the only route in this module that takes no
#: account, so it is the only one a stranger can call in a loop. Guessing an
#: invite means forging an HMAC over a 128-bit `inv`, so this is not what stops
#: an invite being found -- it is a nuisance-cost control on the one open door,
#: in the spirit of `app/core/rate_limit.py`'s own docstring about being the
#: second layer rather than the boundary. Generous on purpose: 60 reads a
#: minute is far more than opening a landing page, retrying it and signing in.
_INVITE_READ_RULE = RateLimitRule(limit=60, window_seconds=60.0)


def _limit_invite_reads(request: Request) -> None:
    verdict = limiter.check(client_key(request, "h2h:invite"), _INVITE_READ_RULE)
    if not verdict.allowed:
        raise HTTPException(
            status_code=429,
            detail=error_detail(
                "Too many challenge-link lookups. Try again shortly.",
                "rate_limited",
            ),
            headers={"Retry-After": str(verdict.retry_after_seconds)},
        )


def _mint_invite(invite_id: str) -> str:
    return create_session_token(
        {
            **h2h.invite_claims(invite_id, secrets.token_hex(8)),
            # `invite_claims` deliberately omits `kind` so the discriminator
            # stays the router's constant, exactly as RTT's challenge token
            # does (`run_the_table.py:507-521`).
            "kind": h2h.H2H_INVITE_TOKEN_KIND,
        },
        settings.SIGNING_SECRET,
        ttl_seconds=h2h.INVITE_TTL_SECONDS,
    )


def _decode_invite(token: str) -> dict:
    """Verify an invite token. Rejects forged, expired AND wrong-kind tokens.

    THE `kind` CHECK IS LODE-BEARING. Peak Draft's challenge tokens, RUN THE
    TABLE's challenge tokens, the anonymous identity cookie and this invite are
    all HMAC'd with the same `PEAK3_SIGNING_SECRET`. Without this line a valid
    RTT challenge token would verify here and be read for an `inv` claim it
    does not have -- and `payload.get("inv")` returning None would then hash to
    a stable value that could be probed. Refused before any lookup happens.
    """
    payload = verify_session_token(token, settings.SIGNING_SECRET)
    if (
        payload is None
        or payload.get("kind") != h2h.H2H_INVITE_TOKEN_KIND
        or not isinstance(payload.get("inv"), str)
        or not payload["inv"]
    ):
        raise HTTPException(
            status_code=404,
            detail=error_detail(
                "This head-to-head invite is invalid or has expired.",
                "invalid_invite",
            ),
        )
    return payload


# ---------------------------------------------------------------------------
# Authorization -- the reference pattern, copied deliberately
# ---------------------------------------------------------------------------

async def _match_or_404(repo, match_id: str) -> HeadToHeadMatch:
    match = await repo.get_match(match_id)
    if match is None:
        raise HTTPException(
            status_code=404,
            detail=error_detail("No such head-to-head.", "match_not_found"),
        )
    return match


async def _participant_or_403(
    repo, match_id: str, sub: str
) -> tuple[HeadToHeadMatch, HeadToHeadParticipant]:
    """`ranked.py:196-203`, verbatim in shape.

    The match must exist AND the caller must have a participant row in it. The
    caller's run id is then read off that row -- never off the request. This is
    the function that makes "possessing a match id" worth nothing.
    """
    match = await _match_or_404(repo, match_id)
    participant = await repo.get_participant(match_id, sub)
    if participant is None:
        raise HTTPException(
            status_code=403,
            detail=error_detail(
                "You are not a participant in this head-to-head.",
                "not_a_participant",
            ),
        )
    return match, participant


# ---------------------------------------------------------------------------
# Run loading and fairness
# ---------------------------------------------------------------------------

async def _load_owned_run(run_repo, run_id: str, owner_sub: str, pool):
    """Load a run this caller owns, or 403/404.

    Delegates ownership to `run_service.load_run`, which already distinguishes
    "no such run" from "not yours" -- rather than re-implementing the check and
    creating a second place it could be wrong.
    """
    try:
        return await run_service.load_run(run_repo, run_id, owner_sub, pool)
    except run_service.RunNotFound:
        raise HTTPException(
            status_code=404, detail=error_detail("Run not found.", "run_not_found")
        )
    except run_service.RunForbidden:
        raise HTTPException(
            status_code=403,
            detail=error_detail(
                "This run belongs to a different player.", "not_your_run"
            ),
        )
    except run_service.VersionMismatch as exc:
        raise HTTPException(
            status_code=409, detail=error_detail(str(exc), "version_mismatch")
        )


def _assert_fair(match: HeadToHeadMatch, blueprint) -> None:
    try:
        h2h.assert_fairness(match.fairness, blueprint)
    except h2h.FairnessMismatch as exc:
        raise HTTPException(
            status_code=409,
            detail=error_detail(
                f"{exc} The differing input was {exc.field!r}. This match cannot "
                "be played or scored fairly and has been stopped.",
                "fairness_mismatch",
            ),
        )


# ---------------------------------------------------------------------------
# Published rules
# ---------------------------------------------------------------------------

@router.get(f"{BASE}/rules", response_model=HeadToHeadRulesResponse)
async def get_rules() -> HeadToHeadRulesResponse:
    """The winner order and the credit-efficiency rule, as applied.

    Read from `services/head_to_head.TIEBREAK_ORDER` and
    `CREDIT_EFFICIENCY_RULE` -- the same constants `compare()` walks -- so a
    published rule and an applied rule cannot drift apart. Same argument as
    `/run-the-table/meta`.
    """
    _require_enabled()
    return HeadToHeadRulesResponse(**h2h.published_rules())


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

@router.post(BASE, response_model=HeadToHeadCreatedResponse)
async def create_head_to_head(
    body: CreateHeadToHeadRequest,
    auth: RequiredAuth,
    repo: HeadToHeadRepoDep,
    run_repo: RunTheTableRunRepoDep,
) -> HeadToHeadCreatedResponse:
    """Create a head-to-head from a run YOU own.

    AUTHENTICATED ONLY (spec §6: "an authenticated user creates"). An anonymous
    cookie subject can be discarded by clearing a cookie, which would make a
    head-to-head record a player could walk away from; and the whole feature is
    account-backed history.

    OWNERSHIP IS CHECKED ON THE SOURCE RUN. `POST /draft/challenges` let anyone
    mint a shareable artefact from a stranger's game and then read the
    stranger's snapshot back out of it (S4, `test_ownership_idor.py:304-314`).
    The same shape here would pin a stranger's board and name them as creator,
    so `assert_owns` runs before anything is written.

    WHAT IS PINNED, per spec §6: the invite (as a hash), the rules version, the
    seed, the starting roster, the boss sequence, the market/node generation
    inputs, and an expiration. The creator's RESULT is not pinned here -- it
    cannot be, since a head-to-head is normally created before the creator has
    finished. It is recorded by `POST /{match_id}/result`.
    """
    _require_enabled()
    pool = _pool()

    stored = await run_repo.get_run(body.run_id)
    if stored is None:
        raise HTTPException(
            status_code=404, detail=error_detail("Run not found.", "run_not_found")
        )
    assert_owns(
        stored.owner_sub,
        auth.sub,
        code="not_your_run",
        message="You can only create a head-to-head from your own run.",
    )

    blueprint = run_service.blueprint_for(stored, pool)
    fairness = h2h.fairness_digest(blueprint)

    invite_id = secrets.token_urlsafe(24)
    match = HeadToHeadMatch(
        match_id=str(uuid.uuid4()),
        invite_hash=h2h.invite_hash(invite_id),
        creator_sub=auth.sub,
        seed=int(stored.seed),
        source_run_type=stored.run_type,
        source_run_date=stored.run_date,
        engine_version=stored.engine_version,
        ruleset_version=stored.ruleset_version,
        card_pool_version=stored.card_pool_version,
        fairness=fairness,
        status=MATCH_STATUS_OPEN,
        expires_at=_now() + timedelta(seconds=h2h.MATCH_TTL_SECONDS),
    )
    creator = HeadToHeadParticipant(
        match_id=match.match_id,
        participant_sub=auth.sub,
        role=PARTICIPANT_ROLE_CREATOR,
        run_id=stored.run_id,
        status=PARTICIPANT_STATUS_IN_PROGRESS,
    )
    saved = await repo.create_match(match, creator)

    token = _mint_invite(invite_id)
    return HeadToHeadCreatedResponse(
        match_id=saved.match_id,
        invite_token=token,
        # `/arena/run-the-table/h2h/invite/{token}` -- this feature's own route
        # subtree. Deliberately NOT `/c/{token}` (Peak Draft's) and not
        # `?c={token}` (RUN THE TABLE's challenge link), both of which resolve
        # their token against an endpoint that knows nothing about this one's
        # `kind` and would land the recipient on a not-found screen.
        invite_url_path=f"/arena/run-the-table/h2h/invite/{token}",
        expires_at=saved.expires_at.isoformat(),
        seed=saved.seed,
        versions=version_tuple(),
        fairness=saved.fairness,
    )


# ---------------------------------------------------------------------------
# Invite landing page
# ---------------------------------------------------------------------------

@router.get(f"{BASE}/invite/{{token}}", response_model=InviteDescriptorResponse)
async def get_invite(
    request: Request,
    token: str,
    repo: HeadToHeadRepoDep,
    profile_repo: ProfileRepoDep,
) -> InviteDescriptorResponse:
    """What an invite link resolves to. NO AUTH REQUIRED, NO SPOILERS.

    Open to anyone holding the link, exactly as RUN THE TABLE's own challenge
    descriptor is: the landing page has to render before a recipient signs in,
    and requiring an account to *read* an invite would put an account wall in
    front of the invitation itself.

    Safe to leave open because of what it does NOT contain: no seed, no roster,
    no bosses, no node map, no run id, and no result -- not even the creator's.
    The only identifying thing here is a display name, which is what an
    invitation is for. The match id IS returned, and is not a credential; see
    the comment on the field itself.
    """
    _require_enabled()
    _limit_invite_reads(request)
    payload = _decode_invite(token)
    match = await repo.find_match_by_invite(h2h.invite_hash(payload["inv"]))
    if match is None:
        # An unknown invite and a forged invite answer identically, so a
        # probe learns nothing from the difference.
        raise HTTPException(
            status_code=404,
            detail=error_detail(
                "This head-to-head invite is invalid or has expired.",
                "invalid_invite",
            ),
        )

    participants = await repo.get_participants(match.match_id)
    versions = dict(version_tuple())
    token_ruleset = str(payload.get("ruleset") or match.ruleset_version)
    versions["ruleset_version"] = token_ruleset
    expired = _expired(match)

    return InviteDescriptorResponse(
        # The match id is included ONLY so an already-seated player can be sent
        # back to their match. It is not a credential: every route that takes
        # it re-checks participation, and a stranger reading it here still gets
        # 403 everywhere it is accepted.
        match_id=match.match_id,
        creator_display_name=await _display_name(profile_repo, match.creator_sub),
        status=match.status,
        playable=(
            not expired
            and token_ruleset == RULESET_VERSION
            and match.ruleset_version == RULESET_VERSION
            and len(participants) < 2
        ),
        ruleset_version=token_ruleset,
        versions=versions,
        expires_at=match.expires_at.isoformat(),
        expired=expired,
        your_role=None,
        seats_taken=len(participants),
    )


@router.post(f"{BASE}/invite/{{token}}/accept", response_model=HeadToHeadMatchResponse)
async def accept_invite(
    token: str,
    body: AcceptInviteRequest,
    auth: RequiredAuth,
    repo: HeadToHeadRepoDep,
    run_repo: RunTheTableRunRepoDep,
    profile_repo: ProfileRepoDep,
) -> HeadToHeadMatchResponse:
    """Seat yourself as the opponent and get a run on the pinned board.

    THE INVITE PERMITS EXACTLY THIS AND NOTHING ELSE. It seats the CALLER --
    `auth.sub`, never a subject from the request -- and creates a run owned by
    the CALLER. It cannot touch the creator's run, cannot submit a result and
    cannot settle.

    `run_type="challenge"`, which is what makes head-to-head play free of the
    daily: `resolve_seed` only derives a seed from a date for `run_type ==
    "daily"`, and only a `daily` run is written to the daily index
    (`run_the_table_protocols.py:95`, `runs.py:178-180`). A head-to-head minted
    from someone's daily therefore does not burn the recipient's daily attempt
    -- the same reasoning `run_the_table.py:378-384` already states for
    challenge links.

    IDEMPOTENT. A second POST from a player already seated returns their
    existing match view rather than creating a second run: two tabs on the
    invite page must not produce two boards.
    """
    _require_enabled()
    pool = _pool()
    payload = _decode_invite(token)
    match = await repo.find_match_by_invite(h2h.invite_hash(payload["inv"]))
    if match is None:
        raise HTTPException(
            status_code=404,
            detail=error_detail(
                "This head-to-head invite is invalid or has expired.",
                "invalid_invite",
            ),
        )
    _require_not_expired(match)

    existing = await repo.get_participant(match.match_id, auth.sub)
    if existing is not None:
        # Already seated -- including the creator opening their own link, which
        # is answered below with a clearer message.
        if existing.role == PARTICIPANT_ROLE_CREATOR:
            raise HTTPException(
                status_code=409,
                detail=error_detail(
                    "You created this head-to-head. Share the link with someone "
                    "else -- you cannot play yourself.",
                    "cannot_play_yourself",
                ),
            )
        return await _match_view(repo, profile_repo, match, existing)

    if match.ruleset_version != RULESET_VERSION:
        raise HTTPException(
            status_code=409,
            detail=error_detail(
                f"This head-to-head was created under ruleset "
                f"{match.ruleset_version}; the rules have since changed to "
                f"{RULESET_VERSION}, so the same seed no longer produces the same "
                f"board. Ask for a new link.",
                "version_mismatch",
            ),
        )

    participants = await repo.get_participants(match.match_id)
    if len(participants) >= 2:
        raise HTTPException(
            status_code=409,
            detail=error_detail(
                "This head-to-head already has two players.", "match_full"
            ),
        )

    # Create the opponent's run FIRST, then check that the board it regenerated
    # is the pinned one, and only then seat them. A player must never end up
    # holding a seat in a match whose board they cannot legitimately play.
    try:
        stored, _state, blueprint, _created = await run_service.create_run(
            run_repo, auth.sub, "challenge", match.seed, match.source_run_date, pool
        )
    except run_service.VersionMismatch as exc:
        raise HTTPException(
            status_code=409, detail=error_detail(str(exc), "version_mismatch")
        )
    _assert_fair(match, blueprint)

    opponent = HeadToHeadParticipant(
        match_id=match.match_id,
        participant_sub=auth.sub,
        role=PARTICIPANT_ROLE_OPPONENT,
        run_id=stored.run_id,
        status=PARTICIPANT_STATUS_IN_PROGRESS,
    )
    try:
        seated = await repo.add_participant(opponent)
    except ParticipantSlotTaken:
        # Lost a race to another accept. The seat, not the run, is the scarce
        # thing; the orphan run stays as an ordinary challenge run the caller
        # owns and can play, which is strictly better than deleting a board
        # they may already have opened.
        raise HTTPException(
            status_code=409,
            detail=error_detail(
                "This head-to-head already has two players.", "match_full"
            ),
        )

    await repo.set_match_status(match.match_id, MATCH_STATUS_IN_PROGRESS)
    refreshed = await _match_or_404(repo, match.match_id)
    return await _match_view(repo, profile_repo, refreshed, seated)


# ---------------------------------------------------------------------------
# Match view -- spoiler-safe
# ---------------------------------------------------------------------------

async def _match_view(
    repo,
    profile_repo,
    match: HeadToHeadMatch,
    you: HeadToHeadParticipant,
) -> HeadToHeadMatchResponse:
    """Your side in full, the other side hidden until both have submitted.

    SPOILER SAFETY IS AN OMISSION, NOT A FLAG. Until `both_complete`, the
    opponent block carries a name and the literal status `"hidden"` and nothing
    else -- no result, no partial metrics, not even their progress, because
    "they are on act 4" is itself a spoiler about a shared board. Ranked makes
    the same call at `ranked.py:213-215`.

    The opponent's `run_id` is never included even after settlement: it is
    someone else's resource id, and this codebase has just spent a pass
    learning what those are worth to an attacker.
    """
    participants = await repo.get_participants(match.match_id)
    other = next(
        (p for p in participants if p.participant_sub != you.participant_sub), None
    )
    both_complete = (
        other is not None
        and you.result is not None
        and other.result is not None
    )

    opponent_public = None
    opponent_status = "hidden"
    if other is not None:
        if both_complete:
            opponent_status = other.status
        opponent_public = ParticipantPublic(
            role=other.role,
            display_name=await _display_name(profile_repo, other.participant_sub),
            status=opponent_status,
            run_id=None,
            result=_public_result(other.result, own=False) if both_complete else None,
        )

    return HeadToHeadMatchResponse(
        match_id=match.match_id,
        status=match.status,
        seed=match.seed,
        versions={
            "engine_version": match.engine_version,
            "ruleset_version": match.ruleset_version,
            "card_pool_version": match.card_pool_version,
        },
        created_at=match.created_at.isoformat(),
        expires_at=match.expires_at.isoformat(),
        expired=_expired(match),
        rematch_of=match.rematch_of,
        you=ParticipantPublic(
            role=you.role,
            display_name=await _display_name(profile_repo, you.participant_sub),
            status=you.status,
            run_id=you.run_id,
            result=you.result,
        ),
        opponent=opponent_public,
        opponent_status=opponent_status,
        both_complete=both_complete,
        settlement=match.settlement if both_complete else None,
    )


@router.get(f"{BASE}/history", response_model=HeadToHeadHistoryResponse)
async def get_history(
    auth: RequiredAuth,
    repo: HeadToHeadRepoDep,
    profile_repo: ProfileRepoDep,
) -> HeadToHeadHistoryResponse:
    """Your head-to-head history, newest first. Spoiler-safe.

    Declared BEFORE `/{match_id}` on purpose: FastAPI matches in declaration
    order, so a later `/history` would be swallowed by the `{match_id}` path
    parameter and answer 403 not_a_participant for a route that has nothing to
    do with participation.

    `your_outcome` is None for any match that has not settled -- a player with
    one match still open must not be able to read its answer out of a list
    view.
    """
    _require_enabled()
    matches = await repo.list_matches_for_sub(auth.sub, limit=50)
    entries: list[HeadToHeadHistoryEntry] = []
    for match in matches:
        participants = await repo.get_participants(match.match_id)
        you = next(
            (p for p in participants if p.participant_sub == auth.sub), None
        )
        if you is None:  # pragma: no cover - the query selects on membership
            continue
        other = next(
            (p for p in participants if p.participant_sub != auth.sub), None
        )
        settlement = match.settlement
        entries.append(
            HeadToHeadHistoryEntry(
                match_id=match.match_id,
                status=match.status,
                created_at=match.created_at.isoformat(),
                your_role=you.role,
                opponent_display_name=(
                    await _display_name(profile_repo, other.participant_sub)
                    if other is not None
                    else None
                ),
                your_outcome=(
                    _your_outcome(settlement["winner"], you.role)
                    if settlement
                    else None
                ),
                decided_by=settlement.get("decided_by") if settlement else None,
            )
        )
    return HeadToHeadHistoryResponse(matches=entries)


@router.get(f"{BASE}/{{match_id}}", response_model=HeadToHeadMatchResponse)
async def get_match(
    auth: RequiredAuth,
    repo: HeadToHeadRepoDep,
    profile_repo: ProfileRepoDep,
    match_id: str = PathParam(..., max_length=64),
) -> HeadToHeadMatchResponse:
    """Your side of a match. 403 for anyone who is not in it."""
    _require_enabled()
    match, you = await _participant_or_403(repo, match_id, auth.sub)
    return await _match_view(repo, profile_repo, match, you)


# ---------------------------------------------------------------------------
# Result submission -- where the settlement is written
# ---------------------------------------------------------------------------

def _your_outcome(winner: str, role: str) -> str:
    if winner == "draw":
        return "draw"
    return "won" if winner == role else "lost"


@router.post(f"{BASE}/{{match_id}}/result", response_model=HeadToHeadMatchResponse)
async def submit_result(
    body: SubmitResultRequest,
    auth: RequiredAuth,
    repo: HeadToHeadRepoDep,
    run_repo: RunTheTableRunRepoDep,
    profile_repo: ProfileRepoDep,
    match_id: str = PathParam(..., max_length=64),
) -> HeadToHeadMatchResponse:
    """Submit YOUR finished run. There is no way to submit anyone else's.

    THREE THINGS THIS ROUTE REFUSES TO TAKE FROM THE CLIENT, each of which
    would be a forged win:

    1. WHICH RUN. Read from `you.run_id` -- the row the server wrote when this
       caller was seated. A `run_id` in the body is the shape that made
       `GET /draft/challenges/{token}/comparison` settleable by a stranger
       (S3); it is not accepted here at all.
    2. WHOSE RESULT. `_participant_or_403` resolves the participant from
       `auth.sub`. A body cannot name a participant, so there is no "submit on
       behalf of" to abuse.
    3. THE NUMBERS. Every metric is recomputed here from the run's own
       persisted state through the engine's `build_receipt`. The request body
       is empty by design.

    The run is additionally re-loaded with owner scoping, so even a corrupted
    participant row pointing at someone else's run cannot be submitted.

    IDEMPOTENT. A repeat returns the same view: the repository's result write
    is first-write-wins, and the settlement is written under the same rule, so
    two tabs finishing together cannot produce two different settled outcomes.
    """
    _require_enabled()
    pool = _pool()
    match, you = await _participant_or_403(repo, match_id, auth.sub)
    _require_not_expired(match)

    if you.result is None:
        _stored, state, blueprint = await _load_owned_run(
            run_repo, you.run_id, auth.sub, pool
        )
        # Fairness is re-checked at submission, not only at join: a card-pool
        # rebuild between the two would otherwise let a finished board be
        # compared against a different one.
        _assert_fair(match, blueprint)

        if state.status not in TERMINAL_STATUSES:
            raise HTTPException(
                status_code=409,
                detail=error_detail(
                    "Finish your run before submitting it.", "run_not_finished"
                ),
            )
        receipt = build_receipt(state, blueprint, pool)
        metrics = h2h.metrics_from_run(state, receipt)
        you = await repo.set_participant_result(
            match_id, auth.sub, metrics.to_dict()
        )

    # Settle when both are in. The SECOND submission settles; a GET never does.
    participants = await repo.get_participants(match_id)
    if len(participants) == 2 and all(p.result is not None for p in participants):
        creator = next(p for p in participants if p.role == PARTICIPANT_ROLE_CREATOR)
        opponent = next(p for p in participants if p.role == PARTICIPANT_ROLE_OPPONENT)
        comparison = h2h.compare(
            h2h.ComparisonMetrics.from_dict(creator.result or {}),
            h2h.ComparisonMetrics.from_dict(opponent.result or {}),
        )
        match = await repo.settle(match_id, comparison)
    else:
        await repo.set_match_status(match_id, MATCH_STATUS_IN_PROGRESS)
        match = await _match_or_404(repo, match_id)

    return await _match_view(repo, profile_repo, match, you)


@router.get(f"{BASE}/{{match_id}}/receipt", response_model=HeadToHeadReceiptResponse)
async def get_receipt(
    auth: RequiredAuth,
    repo: HeadToHeadRepoDep,
    profile_repo: ProfileRepoDep,
    match_id: str = PathParam(..., max_length=64),
) -> HeadToHeadReceiptResponse:
    """The side-by-side final receipt. Participants only, both-complete only.

    A PURE READ. It writes nothing -- no settlement, no status, no timestamp.
    Peak Draft's `/comparison` settled a challenge on a GET, which is how
    holding a link became a way to deny the real recipient their comparison
    (S3). Settlement here happens in `POST /result` and nowhere else, so
    viewing a result can never imply mutating one.
    """
    _require_enabled()
    match, you = await _participant_or_403(repo, match_id, auth.sub)
    participants = await repo.get_participants(match_id)
    if len(participants) < 2 or not all(p.result is not None for p in participants):
        raise HTTPException(
            status_code=409,
            detail=error_detail(
                "Both players have to finish before the comparison is shown.",
                "awaiting_opponent",
            ),
        )
    if not match.settlement:  # pragma: no cover - written by the second submit
        raise HTTPException(
            status_code=409,
            detail=error_detail(
                "This head-to-head has not been settled yet.", "awaiting_settlement"
            ),
        )

    creator = next(p for p in participants if p.role == PARTICIPANT_ROLE_CREATOR)
    opponent = next(p for p in participants if p.role == PARTICIPANT_ROLE_OPPONENT)
    return HeadToHeadReceiptResponse(
        match_id=match.match_id,
        seed=match.seed,
        versions={
            "engine_version": match.engine_version,
            "ruleset_version": match.ruleset_version,
            "card_pool_version": match.card_pool_version,
        },
        creator={
            "role": creator.role,
            "display_name": await _display_name(profile_repo, creator.participant_sub),
            "result": _public_result(
                creator.result, own=creator.participant_sub == auth.sub
            ),
        },
        opponent={
            "role": opponent.role,
            "display_name": await _display_name(profile_repo, opponent.participant_sub),
            "result": _public_result(
                opponent.result, own=opponent.participant_sub == auth.sub
            ),
        },
        settlement=match.settlement,
        your_role=you.role,
        your_outcome=_your_outcome(match.settlement["winner"], you.role),
    )


# ---------------------------------------------------------------------------
# Rematch
# ---------------------------------------------------------------------------

@router.post(f"{BASE}/{{match_id}}/rematch", response_model=HeadToHeadCreatedResponse)
async def rematch(
    body: RematchRequest,
    auth: RequiredAuth,
    repo: HeadToHeadRepoDep,
    run_repo: RunTheTableRunRepoDep,
    match_id: str = PathParam(..., max_length=64),
) -> HeadToHeadCreatedResponse:
    """A new head-to-head on a NEW board, offered by one participant.

    PARTICIPANTS ONLY -- a rematch names the caller as creator of a new match
    and mints an invite, so letting a stranger start one from a match id would
    be minting an artefact from someone else's game all over again.

    A NEW SEED, not the old one. A rematch on the same board would be a race
    between two people who have already seen the bosses, the offers and the
    node map; the fair rematch is a fresh board under the same rules.

    THE INVITE STILL HAS TO BE ACCEPTED. The old opponent is not auto-seated:
    consent to one match is not consent to the next, and auto-seating would
    also let a player fill their opponent's schedule unilaterally.

    IDEMPOTENT by `(rematch_of, creator_sub)` in the repository, so a
    double-clicked Rematch button returns the same match and the same invite
    rather than two boards. The invite token is re-minted rather than stored --
    it is derived from the invite id, and the invite id itself is never
    persisted (only its hash), so a re-mint is the only honest way to hand it
    back.
    """
    _require_enabled()
    pool = _pool()
    source, _you = await _participant_or_403(repo, match_id, auth.sub)

    existing = await repo.find_rematch(match_id, auth.sub)
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=error_detail(
                "You already offered a rematch for this head-to-head. Share that "
                "link instead.",
                "rematch_already_offered",
            ),
        )

    seed = secrets.randbelow(2 ** 31)
    stored, _state, blueprint, _created = await run_service.create_run(
        run_repo, auth.sub, "challenge", seed, None, pool
    )
    fairness = h2h.fairness_digest(blueprint)
    invite_id = secrets.token_urlsafe(24)
    match = HeadToHeadMatch(
        match_id=str(uuid.uuid4()),
        invite_hash=h2h.invite_hash(invite_id),
        creator_sub=auth.sub,
        seed=int(stored.seed),
        source_run_type=stored.run_type,
        source_run_date=stored.run_date,
        engine_version=stored.engine_version,
        ruleset_version=stored.ruleset_version,
        card_pool_version=stored.card_pool_version,
        fairness=fairness,
        status=MATCH_STATUS_OPEN,
        expires_at=_now() + timedelta(seconds=h2h.MATCH_TTL_SECONDS),
        rematch_of=source.match_id,
    )
    creator = HeadToHeadParticipant(
        match_id=match.match_id,
        participant_sub=auth.sub,
        role=PARTICIPANT_ROLE_CREATOR,
        run_id=stored.run_id,
        status=PARTICIPANT_STATUS_IN_PROGRESS,
    )
    saved = await repo.create_match(match, creator)
    token = _mint_invite(invite_id)
    return HeadToHeadCreatedResponse(
        match_id=saved.match_id,
        invite_token=token,
        invite_url_path=f"/arena/run-the-table/h2h/invite/{token}",
        expires_at=saved.expires_at.isoformat(),
        seed=saved.seed,
        versions=version_tuple(),
        fairness=saved.fairness,
    )
