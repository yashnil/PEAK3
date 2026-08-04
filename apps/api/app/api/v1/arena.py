"""Arena — server-authoritative multiplayer. Mode-agnostic routes.

  GET  /arena/readiness                          safe diagnostic, no auth
  POST /arena/matches/practice                   bots, immediate, UNRATED
  POST /arena/matches/private                    room code, UNRATED
  POST /arena/matches/private/join               take a seat by code
  POST /arena/queue/{mode}/join                  public queue, RATED
  GET  /arena/queue/{mode}/status                poll while waiting
  POST /arena/queue/{mode}/cancel                withdraw
  GET  /arena/matches                            your matches, newest first
  GET  /arena/matches/{match_id}                 THE POLL: state for your seat
  POST /arena/matches/{match_id}/commands        THE MUTATION
  GET  /arena/matches/{match_id}/events          incremental log for your seat
  GET  /arena/matches/{match_id}/results         once completed

NO GAME RULES LIVE HERE. Every route delegates the rules to the registered
`ArenaMode`; this module owns authorization, the clock, the bot pump and the
response envelope.

AUTHORIZATION -- `_seat_or_403`, and it is on every route that names a match
--------------------------------------------------------------------------
Copied in shape from `ranked.py:196-203` and `head_to_head.py:300-319`:

    seat = await repo.get_seat_for_sub(match_id, auth.sub)
    if seat is None:  -> 403 not_a_participant

and every subsequent read is scoped to `seat.seat_index` -- never to a seat
index taken from the request. There is no route here that accepts a
client-supplied seat index on a mutation, so possessing a match id is worth a
403 and nothing more.

WHY EVERY ROUTE REQUIRES A REAL ACCOUNT
----------------------------------------
Unlike RUN THE TABLE and Peak Duel Daily, whose owners are usually anon-cookie
subjects, every seat here is a Supabase `auth.uid()`. An anon subject can be
discarded by clearing a cookie, and in a three-seat match that means abandoning
two other people mid-clock -- and, in a public match, walking away from a rated
result. Head-to-head made the identical call for the identical reason
(`head_to_head_protocols.py:60-65`: "a head-to-head that one side could win by
clearing their cookies is not a head-to-head").

Practice is the one path where this could later be relaxed, since it involves
nobody else. It is NOT relaxed here: a practice match still writes durable rows
and still needs an owner that survives a cookie clear, and one identity rule for
the whole subsystem is easier to reason about than three.

THE CLOCK RUNS ON READS, NOT JUST WRITES
-----------------------------------------
`GET /arena/matches/{id}` calls `clock.enforce` before serving. That is what
makes a deadline real without a background worker: the opponent waiting on a
timeout is the one whose own polling fires it. See `services/arena/clock.py` for
why lazy enforcement is sufficient and why the alternative was rejected.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request

from app.core.auth import RequiredAuth
from app.core.config import settings
from app.core.dependencies import ArenaRepoDep, ProfileRepoDep
from app.core.rate_limit import RateLimitRule, client_key, limiter
from app.models.arena import (
    ArenaEventsResponse,
    ArenaEventView,
    ArenaMatchView,
    ArenaModeInfo,
    ArenaReadinessResponse,
    ArenaResultsResponse,
    ArenaResultView,
    CreateMatchRequest,
    JoinRoomRequest,
    MatchHistoryResponse,
    MatchSummary,
    QueueStatusResponse,
    SeatPublic,
    SubmitCommandRequest,
    SubmitCommandResponse,
)
from app.repositories.arena_protocols import (
    ENTRY_PATH_PRIVATE_ROOM,
    ActiveQueueEntryExists,
    ArenaMatch,
    ArenaSeat,
    CommandRequest,
    MatchNotFound,
    SeatUnavailable,
    validate_client_command,
)
from app.services.arena import bots as bot_service
from app.services.arena import clock
from app.services.arena import matchmaking as mm
from app.services.arena.modes import ModeNotRegistered, registry as mode_registry

logger = logging.getLogger(__name__)
router = APIRouter()

BASE = "/arena"


def _error(message: str, error_code: str) -> dict:
    """The error envelope every Arena router uses (see daily_grid.py)."""
    return {"error_code": error_code, "message": message}


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Gating
# ---------------------------------------------------------------------------


def _require_enabled() -> None:
    if not settings.ARENA_ENABLED:
        raise HTTPException(
            status_code=403,
            detail=_error("The Arena is not enabled.", "arena_not_enabled"),
        )


def _require_access(auth: RequiredAuth) -> None:
    _require_enabled()
    if auth.is_anonymous:
        raise HTTPException(
            status_code=403,
            detail=_error(
                "The Arena requires a signed-in account.", "arena_requires_account"
            ),
        )
    allowlist = settings.ARENA_ALPHA_ALLOWLIST
    if allowlist and auth.sub not in allowlist:
        raise HTTPException(
            status_code=403,
            detail=_error(
                "The Arena is in closed alpha; this account is not on the allowlist.",
                "not_in_alpha_allowlist",
            ),
        )


def _mode_or_404(mode: str):
    try:
        return mode_registry.get(mode)
    except ModeNotRegistered:
        raise HTTPException(
            status_code=404,
            detail=_error(f"Unknown mode {mode!r}.", "unknown_mode"),
        )


#: Room-code lookup is the only route a stranger can call in a loop against a
#: 31^6 space, so it carries a bound. Not what stops a code being guessed --
#: that is the space itself -- but a nuisance-cost control on the one open door,
#: in the spirit of `app/core/rate_limit.py`'s own docstring.
_ROOM_JOIN_RULE = RateLimitRule(limit=20, window_seconds=60.0)


def _limit_room_joins(request: Request) -> None:
    verdict = limiter.check(client_key(request, "arena:room"), _ROOM_JOIN_RULE)
    if not verdict.allowed:
        raise HTTPException(
            status_code=429,
            detail=_error("Too many room-code attempts. Try again shortly.", "rate_limited"),
            headers={"Retry-After": str(verdict.retry_after_seconds)},
        )


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------


async def _match_or_404(repo, match_id: str) -> ArenaMatch:
    match = await repo.get_match(match_id)
    if match is None:
        raise HTTPException(
            status_code=404, detail=_error("No such match.", "match_not_found")
        )
    return match


async def _seat_or_403(repo, match_id: str, sub: str) -> tuple[ArenaMatch, ArenaSeat]:
    """The match must exist AND the caller must hold a seat in it.

    The caller's seat index is then read off that row -- never off the request.
    This is the function that makes "possessing a match id" worth nothing.
    """
    match = await _match_or_404(repo, match_id)
    seat = await repo.get_seat_for_sub(match_id, sub)
    if seat is None:
        raise HTTPException(
            status_code=403,
            detail=_error(
                "You are not a participant in this match.", "not_a_participant"
            ),
        )
    return match, seat


async def _display_name(profile_repo, sub: str) -> str:
    """A human name, with an honest fallback and never the raw subject."""
    try:
        profile = await profile_repo.get_or_create_profile(sub)
    except Exception:
        return "PEAK3 player"
    return profile.display_name or profile.handle or "PEAK3 player"


# ---------------------------------------------------------------------------
# View building
# ---------------------------------------------------------------------------


async def _build_view(repo, mode, match: ArenaMatch, seat: Optional[ArenaSeat]):
    """Project one match for one seat. The ONLY way a match reaches a client.

    Note what is not read here: `match.snapshot` never reaches the response. The
    mode's `project` decides what a seat may see, and everything else stays on
    the server.
    """
    seats = tuple(await repo.get_seats(match.match_id))
    seat_index = seat.seat_index if seat is not None else None

    public_state: dict = {}
    private_state: dict = {}
    legal: tuple[str, ...] = ()
    if seat_index is not None and mode is not None:
        public_state, private_state, legal = mode.project(match, seats, seat_index)

    turn = await repo.get_open_turn(match.match_id)
    seconds_remaining = None
    if turn is not None and seat_index is not None:
        if turn.seat_index is None or turn.seat_index == seat_index:
            from app.repositories.arena_protocols import _utc

            seconds_remaining = max(
                0.0, (_utc(turn.deadline_at) - _now()).total_seconds()
            )

    visible = await repo.list_events(match.match_id, for_seat=seat_index)
    latest_seq = max((e.seq for e in visible), default=-1)

    return ArenaMatchView(
        match_id=match.match_id,
        mode=match.mode,
        mode_version=match.mode_version,
        model_version=match.model_version,
        status=match.status,
        state_version=match.state_version,
        seat_count=match.seat_count,
        entry_path=match.entry_path,
        rated=match.rated,
        your_seat_index=seat_index,
        seats=[
            SeatPublic(
                seat_index=s.seat_index,
                display_name=s.display_name,
                is_bot=s.is_bot,
                status=s.status,
                bot_rating=s.bot_rating if s.is_bot else None,
            )
            for s in seats
        ],
        public_state=public_state,
        private_state=private_state,
        legal_commands=list(legal),
        current_turn_seat_index=turn.seat_index if turn else None,
        seconds_remaining=seconds_remaining,
        latest_event_seq=latest_seq,
        # The room code goes only to a seat holder, and only while the room is
        # still filling -- it is how they invite the second player. Once the
        # match is full it is noise, and after it ends it may have been reissued.
        room_code=(
            match.room_code
            if seat is not None and match.status == "forming"
            else None
        ),
    )


async def _advance(repo, mode, match_id: str) -> ArenaMatch:
    """Run the clock, then let any bots whose turn it is move.

    Called before serving a match and after a human's command, which is what
    makes both happen without a background worker. Bot driving is gated on
    ARENA_BOTS_ENABLED so a miscalibrated bot can be stopped without taking the
    matches it is already seated in offline -- those simply stall until the
    clock forfeits, which is a defined outcome.
    """
    now = _now()
    await clock.enforce(repo, match_id, mode.reduce if mode else None, now)
    if mode is not None and settings.ARENA_BOTS_ENABLED:
        await bot_service.drive_pending_bots(repo, mode, mode.reduce, match_id, now)
    return await _match_or_404(repo, match_id)


# ---------------------------------------------------------------------------
# Readiness -- always answers
# ---------------------------------------------------------------------------


@router.get(f"{BASE}/readiness", response_model=ArenaReadinessResponse)
async def readiness() -> ArenaReadinessResponse:
    return ArenaReadinessResponse(
        readiness_level=settings.ARENA_READINESS_LEVEL,
        arena_enabled=settings.ARENA_ENABLED,
        public_queue_enabled=settings.ARENA_PUBLIC_QUEUE_ENABLED,
        bots_enabled=settings.ARENA_BOTS_ENABLED,
        # Seat count is read from the registry -- the same object the matchmaker
        # sizes matches from -- so the number the lobby draws and the number the
        # server actually seats cannot become two different facts.
        modes=[
            ArenaModeInfo(id=name, seat_count=mode_registry.get(name).seat_count)
            for name in mode_registry.names()
        ],
    )


# ---------------------------------------------------------------------------
# Entry paths
# ---------------------------------------------------------------------------


@router.post(f"{BASE}/matches/practice", response_model=ArenaMatchView)
async def start_practice(
    body: CreateMatchRequest,
    auth: RequiredAuth,
    repo: ArenaRepoDep,
    profile_repo: ProfileRepoDep,
) -> ArenaMatchView:
    """Practice against bots. Starts immediately. Always UNRATED."""
    _require_access(auth)
    if not settings.ARENA_BOTS_ENABLED:
        # Practice IS a bot match; with bots off there is nothing to start.
        raise HTTPException(
            status_code=403,
            detail=_error("Bot practice is not currently enabled.", "bots_disabled"),
        )
    mode = _mode_or_404(body.mode)
    name = await _display_name(profile_repo, auth.sub)
    match = await mm.start_practice(repo, mode, auth.sub, name, _now())
    seat = await repo.get_seat_for_sub(match.match_id, auth.sub)
    return await _build_view(repo, mode, match, seat)


@router.post(f"{BASE}/matches/private", response_model=ArenaMatchView)
async def create_private(
    body: CreateMatchRequest,
    auth: RequiredAuth,
    repo: ArenaRepoDep,
    profile_repo: ProfileRepoDep,
) -> ArenaMatchView:
    """Open a private room. Always UNRATED, and never auto-filled with bots."""
    _require_access(auth)
    mode = _mode_or_404(body.mode)
    name = await _display_name(profile_repo, auth.sub)
    try:
        match = await mm.create_private_room(repo, mode, auth.sub, name, _now())
    except SeatUnavailable as exc:
        raise HTTPException(status_code=503, detail=_error(str(exc), "room_unavailable"))
    seat = await repo.get_seat_for_sub(match.match_id, auth.sub)
    return await _build_view(repo, mode, match, seat)


@router.post(f"{BASE}/matches/private/join", response_model=ArenaMatchView)
async def join_private(
    body: JoinRoomRequest,
    request: Request,
    auth: RequiredAuth,
    repo: ArenaRepoDep,
    profile_repo: ProfileRepoDep,
) -> ArenaMatchView:
    """Take a seat in a private room.

    The code grants exactly one thing: the right to seat YOURSELF. It cannot
    submit a command, cannot read another seat's state, and cannot be replayed
    into a second seat -- the storage layer's uniqueness refuses that, not an
    if-statement here.
    """
    _require_access(auth)
    _limit_room_joins(request)
    code = body.room_code.strip().upper()
    existing = await repo.find_match_by_room_code(code)
    if existing is None:
        raise HTTPException(
            status_code=404,
            detail=_error("No open room with that code.", "room_not_found"),
        )
    mode = _mode_or_404(existing.mode)
    name = await _display_name(profile_repo, auth.sub)
    try:
        match = await mm.join_private_room(repo, mode, code, auth.sub, name, _now())
    except SeatUnavailable as exc:
        raise HTTPException(status_code=409, detail=_error(str(exc), "seat_unavailable"))
    seat = await repo.get_seat_for_sub(match.match_id, auth.sub)
    return await _build_view(repo, mode, match, seat)


@router.post(f"{BASE}/queue/{{mode}}/join", response_model=QueueStatusResponse)
async def join_queue(
    mode: str,
    auth: RequiredAuth,
    repo: ArenaRepoDep,
    profile_repo: ProfileRepoDep,
) -> QueueStatusResponse:
    """Join the public queue. Matches created from it are RATED."""
    _require_access(auth)
    if not settings.ARENA_PUBLIC_QUEUE_ENABLED:
        raise HTTPException(
            status_code=403,
            detail=_error("The public queue is not currently open.", "queue_disabled"),
        )
    mode_impl = _mode_or_404(mode)
    now = _now()
    try:
        entry = await mm.join_queue(repo, mode_impl, auth.sub, now)
    except ActiveQueueEntryExists as exc:
        raise HTTPException(
            status_code=409, detail=_error(str(exc), "already_in_queue")
        )

    name = await _display_name(profile_repo, auth.sub)
    match = await mm.try_match(repo, mode_impl, entry, {auth.sub: name}, now)
    if match is not None:
        return QueueStatusResponse(status="matched", mode=mode, match_id=match.match_id)
    return QueueStatusResponse(
        status="waiting", mode=mode, waited_seconds=0.0,
        still_seeking_humans=entry.prefers_humans_at(now),
    )


@router.get(f"{BASE}/queue/{{mode}}/status", response_model=QueueStatusResponse)
async def queue_status(
    mode: str,
    auth: RequiredAuth,
    repo: ArenaRepoDep,
    profile_repo: ProfileRepoDep,
) -> QueueStatusResponse:
    """Poll while waiting. This is also where a lapsed window turns into a bot
    fill -- the waiting player's own poll is what completes their match, which
    is the same lazy discipline the clock uses and for the same reason."""
    _require_access(auth)
    mode_impl = _mode_or_404(mode)
    now = _now()
    entry = await repo.get_queue_entry(auth.sub, mode)
    if entry is None:
        for m in await repo.list_matches_for_sub(auth.sub, limit=5):
            if m.mode == mode and m.is_live():
                return QueueStatusResponse(
                    status="matched", mode=mode, match_id=m.match_id
                )
        return QueueStatusResponse(status="not_in_queue", mode=mode)

    if settings.ARENA_PUBLIC_QUEUE_ENABLED:
        name = await _display_name(profile_repo, auth.sub)
        match = await mm.try_match(repo, mode_impl, entry, {auth.sub: name}, now)
        if match is not None:
            return QueueStatusResponse(
                status="matched", mode=mode, match_id=match.match_id
            )

    from app.repositories.arena_protocols import _utc

    return QueueStatusResponse(
        status="waiting",
        mode=mode,
        waited_seconds=(now - _utc(entry.joined_at)).total_seconds(),
        still_seeking_humans=entry.prefers_humans_at(now),
    )


def _require_bots_enabled() -> None:
    """Refuse cleanly rather than half-seating.

    Checked BEFORE anything is written, so a disabled-bots deploy cannot leave a
    room with two of its three seats filled and no way to reach the third.
    """
    if not settings.ARENA_BOTS_ENABLED:
        raise HTTPException(
            status_code=403,
            detail=_error("Bots are not currently enabled.", "bots_disabled"),
        )


@router.post(f"{BASE}/queue/{{mode}}/fill-now", response_model=QueueStatusResponse)
async def fill_queue_now(
    mode: str,
    auth: RequiredAuth,
    repo: ArenaRepoDep,
    profile_repo: ProfileRepoDep,
) -> QueueStatusResponse:
    """"Fill with bots now" -- the other half of "Keep waiting".

    Waiting already had a route (the poll IS waiting). This is the waiting
    player saying they would rather start than hold out for the rest of their
    30-second window.

    ONLY YOUR OWN WINDOW. The subject comes from the verified JWT and is passed
    straight into a statement that narrows on `owner_sub`; there is no request
    field naming whose entry to collapse, so this cannot be aimed at another
    player. A caller with no waiting entry gets `not_in_queue`, not somebody
    else's match.

    STILL RATED. This is the public queue, so `is_rated(ENTRY_PATH_PUBLIC_QUEUE)`
    is True exactly as it would have been had the window lapsed on its own --
    which is the whole point of the matchmaking module's argument that a
    bot-filled public match stays rated. Waiting 30 seconds versus pressing a
    button must not change what the match is worth, or the button becomes a way
    to farm unrated matches out of a rated queue.
    """
    _require_access(auth)
    _require_bots_enabled()
    mode_impl = _mode_or_404(mode)
    now = _now()

    name = await _display_name(profile_repo, auth.sub)
    match = await mm.fill_queue_with_bots_now(
        repo, mode_impl, auth.sub, {auth.sub: name}, now
    )
    if match is not None:
        return QueueStatusResponse(status="matched", mode=mode, match_id=match.match_id)

    # No waiting entry. Either this is a second press whose first press already
    # created the match, or the caller was never queued. Resolved exactly the way
    # `queue_status` resolves a vanished entry rather than with a second
    # bookkeeping mechanism -- which is also what makes a double-click return
    # the FIRST match instead of seating a second set of bots.
    for m in await repo.list_matches_for_sub(auth.sub, limit=5):
        if m.mode == mode and m.is_live():
            return QueueStatusResponse(status="matched", mode=mode, match_id=m.match_id)
    return QueueStatusResponse(status="not_in_queue", mode=mode)


@router.post(f"{BASE}/matches/{{match_id}}/fill-bots", response_model=ArenaMatchView)
async def fill_room_with_bots(
    match_id: str,
    auth: RequiredAuth,
    repo: ArenaRepoDep,
    profile_repo: ProfileRepoDep,
) -> ArenaMatchView:
    """"Fill empty seats with bots" -- the private-room host's explicit choice.

    A private room is still NEVER auto-filled; `create_private_room` says so and
    that stays true. This is the host deciding out loud that they would rather
    start than keep waiting for a friend.

    HOST ONLY, AND VERIFIED SERVER-SIDE. `match.created_by` is compared against
    the JWT subject. There is no host field in the request body to spoof, and a
    guest who already holds a seat in the room is still refused -- holding a seat
    is not the same authority as opening the room.

    STILL UNRATED. `rated` is not touched here; it was derived from
    `private_room` at creation and the `arena_matches_rated_matches_entry_path`
    CHECK would refuse anything else. No new entry_path is introduced either:
    a host-filled room is the same private room with its seats resolved, not a
    fourth way into the arena.
    """
    _require_access(auth)
    _require_bots_enabled()
    match = await _match_or_404(repo, match_id)

    if match.entry_path != ENTRY_PATH_PRIVATE_ROOM:
        raise HTTPException(
            status_code=400,
            detail=_error(
                "Only a private room's empty seats can be filled on request.",
                "not_a_private_room",
            ),
        )
    if match.created_by != auth.sub:
        # 403 and not 404: the caller may well be a guest who legitimately holds
        # a seat here, so "this is not yours to do" is the honest answer rather
        # than pretending the room does not exist.
        raise HTTPException(
            status_code=403,
            detail=_error(
                "Only the player who opened this room can fill its seats.",
                "not_room_host",
            ),
        )

    mode_impl = _mode_or_404(match.mode)
    try:
        match = await mm.fill_private_room_with_bots(
            repo, mode_impl, match, auth.sub, _now()
        )
    except SeatUnavailable as exc:
        # Also what a double-click gets: the first press consumed the seats.
        raise HTTPException(
            status_code=409, detail=_error(str(exc), "no_empty_seats")
        )

    _, seat = await _seat_or_403(repo, match_id, auth.sub)
    return await _build_view(repo, mode_impl, match, seat)


@router.post(f"{BASE}/queue/{{mode}}/cancel")
async def cancel_queue(mode: str, auth: RequiredAuth, repo: ArenaRepoDep) -> dict:
    _require_access(auth)
    return {"cancelled": await repo.cancel_queue_entry(auth.sub, mode)}


# ---------------------------------------------------------------------------
# Playing
# ---------------------------------------------------------------------------


@router.get(f"{BASE}/matches", response_model=MatchHistoryResponse)
async def list_matches(auth: RequiredAuth, repo: ArenaRepoDep) -> MatchHistoryResponse:
    _require_access(auth)
    matches = await repo.list_matches_for_sub(auth.sub, limit=20)
    return MatchHistoryResponse(
        matches=[
            MatchSummary(
                match_id=m.match_id, mode=m.mode, status=m.status, rated=m.rated,
                entry_path=m.entry_path, seat_count=m.seat_count,
                created_at=m.created_at.isoformat(),
            )
            for m in matches
        ]
    )


@router.get(f"{BASE}/matches/{{match_id}}", response_model=ArenaMatchView)
async def get_match(
    match_id: str, auth: RequiredAuth, repo: ArenaRepoDep
) -> ArenaMatchView:
    """THE POLL. Enforces the clock, pumps bots, then serves this seat's view.

    This is the endpoint the authoritative-polling design rests on: everything a
    client needs to render is here, and `state_version` is what it echoes back
    on its next command. A future Supabase Broadcast hint would trigger exactly
    this call and change nothing else.
    """
    _require_access(auth)
    match, seat = await _seat_or_403(repo, match_id, auth.sub)
    mode = mode_registry.get(match.mode) if mode_registry.has(match.mode) else None
    match = await _advance(repo, mode, match_id)
    await repo.touch_seat(match_id, seat.seat_index, _now())
    return await _build_view(repo, mode, match, seat)


@router.post(f"{BASE}/matches/{{match_id}}/commands", response_model=SubmitCommandResponse)
async def submit_command(
    match_id: str,
    body: SubmitCommandRequest,
    auth: RequiredAuth,
    repo: ArenaRepoDep,
) -> SubmitCommandResponse:
    """THE MUTATION.

    The four required fields: the subject comes from the verified bearer token,
    the timestamp is stamped here from the server clock, and the idempotency key
    and expected version come from the body (both mandatory -- see
    `SubmitCommandRequest`).

    The clock runs FIRST. A command that arrives after its turn expired must lose
    to the timeout rather than beat it by virtue of being the request that
    happened to trigger the sweep.
    """
    _require_access(auth)
    match, seat = await _seat_or_403(repo, match_id, auth.sub)

    try:
        validate_client_command(body.command_type)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=_error(str(exc), "reserved_command")
        )

    mode = _mode_or_404(match.mode)
    now = _now()
    await clock.enforce(repo, match_id, mode.reduce, now)

    request = CommandRequest(
        match_id=match_id,
        idempotency_key=body.idempotency_key,
        command_type=body.command_type,
        payload=body.payload,
        actor_sub=auth.sub,
        # From the SEAT ROW, never from the request. There is no request field
        # that can disagree.
        actor_seat_index=seat.seat_index,
        expected_state_version=body.expected_state_version,
        issued_at=now,
    )
    try:
        outcome = await repo.apply_command(request, mode.reduce, now)
    except MatchNotFound:
        raise HTTPException(
            status_code=404, detail=_error("No such match.", "match_not_found")
        )

    updated = await _advance(repo, mode, match_id)
    return SubmitCommandResponse(
        accepted=outcome.accepted,
        replayed=outcome.replayed,
        rejection_code=outcome.rejection_code,
        message=outcome.rejection_message,
        match=await _build_view(repo, mode, updated, seat),
    )


@router.get(f"{BASE}/matches/{{match_id}}/events", response_model=ArenaEventsResponse)
async def get_events(
    match_id: str,
    auth: RequiredAuth,
    repo: ArenaRepoDep,
    after_seq: int = Query(-1, ge=-1),
    limit: int = Query(200, ge=1, le=500),
) -> ArenaEventsResponse:
    """The incremental log for THIS seat.

    `for_seat` is the caller's own seat index from their seat row. It is never
    None on this path -- None is the server view and returns 'server'-visibility
    rows, which no client may see.
    """
    _require_access(auth)
    _match, seat = await _seat_or_403(repo, match_id, auth.sub)
    events = await repo.list_events(
        match_id, after_seq=after_seq, for_seat=seat.seat_index, limit=limit
    )
    return ArenaEventsResponse(
        match_id=match_id,
        events=[
            ArenaEventView(
                seq=e.seq, event_type=e.event_type,
                actor_seat_index=e.actor_seat_index, payload=e.payload,
                state_version_after=e.state_version_after,
                created_at=e.created_at.isoformat(),
            )
            for e in events
        ],
        latest_seq=max((e.seq for e in events), default=after_seq),
    )


@router.get(f"{BASE}/matches/{{match_id}}/results", response_model=ArenaResultsResponse)
async def get_results(
    match_id: str, auth: RequiredAuth, repo: ArenaRepoDep
) -> ArenaResultsResponse:
    """Final results. Participant-only, and empty until the match completes.

    A pure read: the settlement is written by the command that ended the match,
    never by somebody looking at it. Peak Draft's `/comparison` wrote a
    settlement on a GET; that shape is deliberately not repeated here, the same
    call `head_to_head.py:48-51` records.
    """
    _require_access(auth)
    match, _seat = await _seat_or_403(repo, match_id, auth.sub)
    seats = {s.seat_index: s for s in await repo.get_seats(match_id)}
    results = await repo.get_results(match_id)
    return ArenaResultsResponse(
        match_id=match_id,
        mode=match.mode,
        rated=match.rated,
        results=[
            ArenaResultView(
                seat_index=r.seat_index,
                display_name=(
                    seats[r.seat_index].display_name
                    if r.seat_index in seats
                    else "PEAK3 player"
                ),
                placement=r.placement, score=r.score, outcome=r.outcome,
                was_bot=r.was_bot, detail=r.detail,
            )
            for r in results
        ],
    )
