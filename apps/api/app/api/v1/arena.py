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

WHY EVERY ROUTE THAT INVOLVES ANOTHER PERSON REQUIRES A REAL ACCOUNT
-------------------------------------------------------------------
Unlike RUN THE TABLE and Peak Duel Daily, whose owners are usually anon-cookie
subjects, a seat in a shared match is a Supabase `auth.uid()`. An anon subject
can be discarded by clearing a cookie, and in a three-seat match that means
abandoning two other people mid-clock -- and, in a public match, walking away
from a rated result. Head-to-head made the identical call for the identical
reason (`head_to_head_protocols.py:60-65`: "a head-to-head that one side could
win by clearing their cookies is not a head-to-head").

PRACTICE IS THE ONE PATH WHERE THAT ARGUMENT DOES NOT APPLY, because it involves
nobody else -- and it is now relaxed, but only under a switch a deployed API
cannot hold. See "Identity" below: `ARENA_ANONYMOUS_PRACTICE_ENABLED` is refused
at startup outside DEBUG, so hosted authorization is unchanged by construction
rather than by convention. The queue, private rooms, match history and ratings
still require an account in every configuration.

THE CLOCK RUNS ON READS, NOT JUST WRITES
-----------------------------------------
`GET /arena/matches/{id}` calls `clock.enforce` before serving. That is what
makes a deadline real without a background worker: the opponent waiting on a
timeout is the one whose own polling fires it. See `services/arena/clock.py` for
why lazy enforcement is sufficient and why the alternative was rejected.
"""
from __future__ import annotations

import contextlib
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Request, Response

from app.core.auth import ANON_COOKIE_NAME, OptionalAuth, resolve_owner_sub
from app.core.config import settings
from app.core.dependencies import (
    ArenaRatingRepoDep,
    ArenaRepoDep,
    ArenaStandingsRepoDep,
    ProfileRepoDep,
)
from app.core.rate_limit import RateLimitRule, client_key, limiter
from app.models.arena import (
    ArenaAroundMeResponse,
    ArenaEventsResponse,
    ArenaLeaderboardEntry,
    ArenaLeaderboardResponse,
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
    PersonalRecordResponse,
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
    MatchBundle,
    MatchNotFound,
    SeatUnavailable,
    validate_client_command,
)
from app.services.arena import bots as bot_service
from app.services.arena import rating as arena_rating
from app.services.arena import clock
from app.services.arena import personal as arena_personal
from app.services.arena import matchmaking as mm
from app.services.arena import skill as arena_skill
from app.services.arena import standings as arena_standings
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


# ---------------------------------------------------------------------------
# Identity
#
# WHY THIS EXISTS ALONGSIDE `_require_access`, AND WHAT IT DOES NOT CHANGE.
#
# Every route here required a real Supabase `auth.uid()`, for the reason at the
# top of this file: an anon subject can be discarded by clearing a cookie, and
# in a three-seat match that means abandoning two other people mid-clock. That
# argument is exactly correct for the queue, for private rooms, for ratings and
# for match history. It has never applied to PRACTICE, which involves nobody
# else, and this file's own docstring already said so.
#
# The consequence was not theoretical. Reviewing bot practice on a laptop
# required a hosted Supabase project, so the local Multiplayer page could not be
# played at all -- which is one half of why the review found it walled off.
#
# So identity now has THREE kinds rather than two:
#
#   account            a verified Supabase JWT for a real user. Unchanged: the
#                      allowlist applies, every route is open to it.
#   supabase_anonymous a verified JWT from a Supabase ANONYMOUS session. Refused
#                      everywhere, exactly as before.
#   local_practice     the same signed `peak3_anon` cookie RUN THE TABLE,
#                      CourtBuilder and Daily Grid already own their guests
#                      with. Reachable ONLY when
#                      `ARENA_ANONYMOUS_PRACTICE_ENABLED` is set, which config
#                      refuses to accept outside DEBUG -- so a deployed API
#                      cannot mint one.
#
# The third kind may start a practice match and act inside a match it holds a
# seat in. It may not queue, open or join a room, read match history, or touch
# ratings. And it cannot widen access to anyone else's match: every
# match-scoped route still goes through `_seat_or_403`, which reads the caller's
# seat row and never a field of the request.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ArenaIdentity:
    sub: str
    kind: Literal["account", "supabase_anonymous", "local_practice"]

    @property
    def is_account(self) -> bool:
        return self.kind == "account"


async def arena_identity(
    response: Response,
    auth: OptionalAuth,
    peak3_anon: Optional[str] = Cookie(None, alias=ANON_COOKIE_NAME),
) -> ArenaIdentity:
    """The caller, as one of the three kinds above.

    A MISSING TOKEN IS STILL A 401 unless local practice is enabled, so this is
    `RequiredAuth` in every configuration a deployment can have.
    """
    if auth is not None:
        return ArenaIdentity(
            sub=auth.sub,
            kind="supabase_anonymous" if auth.is_anonymous else "account",
        )
    if settings.ARENA_ANONYMOUS_PRACTICE_ENABLED:
        # Mints and sets the signed cookie when the caller has none -- the same
        # shared path every other guest-friendly route in this API uses.
        sub = resolve_owner_sub(None, peak3_anon, response, settings.SIGNING_SECRET)
        return ArenaIdentity(sub=sub, kind="local_practice")
    raise HTTPException(
        status_code=401,
        detail={
            "error_code": "authentication_required",
            "message": (
                "You are not signed in, or your session has expired. "
                "Sign in again to continue."
            ),
        },
    )


ArenaAuth = Annotated[ArenaIdentity, Depends(arena_identity)]


def _require_practice_access(identity: ArenaIdentity) -> None:
    """Gate for starting practice, and for acting inside a match you hold.

    A local-practice subject is admitted here and nowhere else. An account is
    checked against the alpha allowlist exactly as `_require_access` does; a
    Supabase anonymous session is refused exactly as it was.
    """
    _require_enabled()
    if identity.kind == "local_practice":
        return
    if identity.kind == "supabase_anonymous":
        raise HTTPException(
            status_code=403,
            detail=_error(
                "The Arena requires a signed-in account.", "arena_requires_account"
            ),
        )
    allowlist = settings.ARENA_ALPHA_ALLOWLIST
    if allowlist and identity.sub not in allowlist:
        raise HTTPException(
            status_code=403,
            detail=_error(
                "The Arena is in closed alpha; this account is not on the allowlist.",
                "not_in_alpha_allowlist",
            ),
        )


def _require_account_access(identity: ArenaIdentity) -> None:
    """Gate for everything that is not practice: the queue, rooms, history.

    Identical in effect to `_require_access`, expressed against the identity
    type so a local-practice subject is refused with the SAME code a Supabase
    anonymous session gets -- "this needs an account" is the true answer for
    both, and inventing a second code would make the client branch on a
    distinction the player does not have.
    """
    _require_enabled()
    if not identity.is_account:
        raise HTTPException(
            status_code=403,
            detail=_error(
                "The Arena requires a signed-in account.", "arena_requires_account"
            ),
        )
    allowlist = settings.ARENA_ALPHA_ALLOWLIST
    if allowlist and identity.sub not in allowlist:
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


#: Modes that ship behind their own rollout switch, and the setting that opens
#: each one. A mode absent from this map has no switch: Three-Man Weave and
#: The $20 Showdown are served whenever the Arena is, exactly as before.
_MODE_ENABLE_FLAGS: dict[str, str] = {
    "prime_cut": "ARENA_PRIME_CUT_ENABLED",
    "find_the_prime": "ARENA_FIND_THE_PRIME_ENABLED",
}


def _mode_enabled(mode: str) -> bool:
    flag = _MODE_ENABLE_FLAGS.get(mode)
    return True if flag is None else bool(getattr(settings, flag, False))


def _entry_mode_or_error(mode: str):
    """The mode, for a route that STARTS or JOINS a match.

    Every entry path (practice, private room create/join/fill, public queue)
    goes through this; routes that act inside an existing match keep using
    `_mode_or_404`, so switching a mode off never strands a match in progress.
    """
    impl = _mode_or_404(mode)
    if not _mode_enabled(impl.mode):
        raise HTTPException(
            status_code=403,
            detail=_error("This game is not open yet.", "mode_not_enabled"),
        )
    return impl


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


def _repo_session(repo):
    """Pin one storage connection for the request, when the repository has
    connections to pin (see `PostgresArenaRepository.session`)."""
    session = getattr(repo, "session", None)
    return session() if session is not None else contextlib.nullcontext()


async def _seat_bundle_or_403(repo, match_id: str, sub: str) -> tuple[MatchBundle, ArenaSeat]:
    """`_seat_or_403`, from the ONE bundled read the rest of the request reuses.

    The same two answers in the same order -- 404 when the match does not
    exist, 403 when the caller holds no seat -- and the seat is still read off
    the stored seat rows, never off the request."""
    bundle = await repo.get_match_bundle(match_id)
    if bundle is None:
        raise HTTPException(
            status_code=404, detail=_error("No such match.", "match_not_found")
        )
    seat = bundle.seat_for_sub(sub)
    if seat is None:
        raise HTTPException(
            status_code=403,
            detail=_error(
                "You are not a participant in this match.", "not_a_participant"
            ),
        )
    return bundle, seat


class _RouteTiming:
    """Where a request's time went, as a `Server-Timing` header and one log line.

    Server-side stage durations only -- no identity, no payload, no state. The
    header lets a browser's network panel (and the latency driver) split a slow
    action into network versus server; the log line lets a deployment answer
    "how long do commands take" without a tracing stack. Commands log at INFO,
    polls at DEBUG, and anything over the p95 target at WARNING.
    """

    SLOW_MS = 800.0

    def __init__(self) -> None:
        self._start = time.perf_counter()
        self._last = self._start
        self._parts: list[tuple[str, float]] = []

    def mark(self, name: str) -> None:
        now = time.perf_counter()
        self._parts.append((name, (now - self._last) * 1000.0))
        self._last = now

    def finish(self, response: Response, route: str, mode: str, command: Optional[str] = None) -> None:
        total = (time.perf_counter() - self._start) * 1000.0
        response.headers["Server-Timing"] = ", ".join(
            [f"{name};dur={ms:.1f}" for name, ms in self._parts] + [f"total;dur={total:.1f}"]
        )
        level = logging.WARNING if total > self.SLOW_MS else (logging.INFO if route == "command" else logging.DEBUG)
        logger.log(
            level,
            "arena.timing route=%s mode=%s command=%s total_ms=%.1f %s",
            route, mode, command or "-", total,
            " ".join(f"{name}_ms={ms:.1f}" for name, ms in self._parts),
        )


#: How stale a seat's `last_seen_at` may get before a poll refreshes it. It is
#: advisory liveness that nothing forfeits on, so writing it on EVERY poll was a
#: database write per poll for a value nobody reads at that resolution.
_SEAT_TOUCH_INTERVAL = timedelta(seconds=15)


def _view_from_bundle(mode, bundle: MatchBundle, seat: Optional[ArenaSeat]):
    """Project one match for one seat, from a bundle already in hand.

    Note what is not read here: `match.snapshot` never reaches the response. The
    mode's `project` decides what a seat may see, and everything else stays on
    the server.
    """
    match = bundle.match
    seats = bundle.seats
    seat_index = seat.seat_index if seat is not None else None

    public_state: dict = {}
    private_state: dict = {}
    legal: tuple[str, ...] = ()
    if seat_index is not None and mode is not None:
        public_state, private_state, legal = mode.project(match, seats, seat_index)

    turn = bundle.open_turn
    seconds_remaining = None
    turn_seconds_remaining = None
    turn_seq = None
    turn_elapsed_seconds = None
    turn_total_seconds = None
    turn_phase = turn.phase if turn is not None else None
    bot_reply_in_seconds = None
    if turn is not None:
        from app.repositories.arena_protocols import _utc

        # THE OPEN TURN'S CLOCK, FOR EVERY SEAT. See
        # `ArenaMatchView.turn_seconds_remaining` for why a turn deadline is
        # public and why this is not folded into `seconds_remaining`.
        now = _now()
        turn_seconds_remaining = max(
            0.0, (_utc(turn.deadline_at) - now).total_seconds()
        )
        # THE SAME CLOCK, AS A TIMELINE. `opened_at` is stored (it is what the
        # bot driver enforces think time against), so every client derives
        # "how far into this phase are we" from one server instant rather than
        # from when its own fetch happened to land. See `ArenaMatchView`.
        turn_seq = turn.turn_seq
        turn_total_seconds = max(
            0.0, (_utc(turn.deadline_at) - _utc(turn.opened_at)).total_seconds()
        )
        turn_elapsed_seconds = min(
            turn_total_seconds,
            max(0.0, (now - _utc(turn.opened_at)).total_seconds()),
        )
        if seat_index is not None and (
            turn.seat_index is None or turn.seat_index == seat_index
        ):
            seconds_remaining = turn_seconds_remaining
        # WHEN THE BOT ON THE CLOCK WILL MOVE, so the room can read the reply
        # the moment it is due rather than a poll interval late. See
        # `ArenaMatchView.bot_reply_in_seconds`.
        if mode is not None and settings.ARENA_BOTS_ENABLED:
            bot_reply_in_seconds = bot_service.bot_reply_in_seconds(
                mode, match, turn, seats, now
            )

    latest_seq = bundle.latest_seq_for(seat_index)

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
        turn_seconds_remaining=turn_seconds_remaining,
        turn_phase=turn_phase,
        turn_seq=turn_seq,
        turn_elapsed_seconds=turn_elapsed_seconds,
        turn_total_seconds=turn_total_seconds,
        bot_reply_in_seconds=bot_reply_in_seconds,
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


async def _build_view(repo, mode, match: ArenaMatch, seat: Optional[ArenaSeat]):
    """Project a match for one seat when the caller holds no bundle (the entry
    routes, which have just created or joined it). One bundled read."""
    bundle = await repo.get_match_bundle(match.match_id)
    if bundle is None:  # pragma: no cover - the caller just wrote this match
        raise HTTPException(
            status_code=404, detail=_error("No such match.", "match_not_found")
        )
    return _view_from_bundle(mode, bundle, seat)


async def _refetch(repo, match_id: str) -> MatchBundle:
    bundle = await repo.get_match_bundle(match_id)
    if bundle is None:
        raise HTTPException(
            status_code=404, detail=_error("No such match.", "match_not_found")
        )
    return bundle


async def _advance(repo, mode, bundle: MatchBundle, rating_repo=None, timing: Optional[_RouteTiming] = None) -> MatchBundle:
    """Run the clock, then let any bots whose turn it is move.

    Called before serving a match and after a human's command, which is what
    makes both happen without a background worker. Bot driving is gated on
    ARENA_BOTS_ENABLED so a miscalibrated bot can be stopped without taking the
    matches it is already seated in offline -- those simply stall until the
    clock forfeits, which is a defined outcome.

    DECIDES FROM THE BUNDLE, READS ONLY WHEN SOMETHING MOVED. The clock and the
    bot driver both used to begin by re-reading the match and the open turn the
    route had just read; on an ordinary poll -- nothing overdue, no bot due --
    that was four round trips to learn nothing. Now a state change (a timeout,
    an expiry, a bot move) is the only thing that costs a read.
    """
    now = _now()
    match_id = bundle.match.match_id
    match = bundle.match
    if match.is_live() and match.is_expired_at(now):
        await clock.enforce(repo, match_id, mode.reduce if mode else None, now, mode=mode, match=match, turn=bundle.open_turn)
        bundle = await _refetch(repo, match_id)
    elif match.is_live():
        fired = await clock.enforce(
            repo, match_id, mode.reduce if mode else None, now,
            mode=mode, match=match, turn=bundle.open_turn,
        )
        if fired is not None and (fired.accepted or fired.replayed):
            bundle = bundle.after_command(fired) or await _refetch(repo, match_id)
    if timing is not None:
        timing.mark("clock")
    if mode is not None and settings.ARENA_BOTS_ENABLED and bundle.match.is_live():
        moved = await bot_service.drive_pending_bots(
            repo, mode, mode.reduce, match_id, now, preloaded=bundle
        )
        if moved:
            bundle = await _refetch(repo, match_id)
    if timing is not None:
        timing.mark("bots")
    match = bundle.match

    # Rating is settled on the same lazy path as the clock, for the same reason:
    # no background runner exists in this application. `settle_match_rating` is
    # idempotent through a unique index, so being called on every read is the
    # design rather than a cost -- and a flag that is off means "no rating
    # written", never "settlement fails", which is why this cannot raise into
    # the caller's response.
    if rating_repo is not None and settings.ARENA_RATINGS_ENABLED:
        try:
            await arena_rating.settle_match_rating(repo, rating_repo, match, now)
        except Exception:  # pragma: no cover - defensive
            # A rating that could not be written must never cost a player their
            # match view. The result rows are already durable, so the next
            # request retries from the same input.
            logger.exception("arena: rating settlement failed for %s", match_id)
    return bundle


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
            if _mode_enabled(name)
        ],
    )


# ---------------------------------------------------------------------------
# Entry paths
# ---------------------------------------------------------------------------


@router.post(f"{BASE}/matches/practice", response_model=ArenaMatchView)
async def start_practice(
    body: CreateMatchRequest,
    identity: ArenaAuth,
    repo: ArenaRepoDep,
    profile_repo: ProfileRepoDep,
) -> ArenaMatchView:
    """Practice against bots. Starts immediately. Always UNRATED.

    THE ONE ENTRY PATH A LOCAL-PRACTICE SUBJECT MAY USE. Nobody else is seated,
    nothing is rated, and no other player's match can be reached from here --
    the match id it returns is the only one that subject will ever hold a seat
    in. See "Identity" above for why that is a different question from the one
    the queue and private rooms answer.
    """
    _require_practice_access(identity)
    if not settings.ARENA_BOTS_ENABLED:
        # Practice IS a bot match; with bots off there is nothing to start.
        raise HTTPException(
            status_code=403,
            detail=_error("Bot practice is not currently enabled.", "bots_disabled"),
        )
    mode = _entry_mode_or_error(body.mode)
    name = await _display_name(profile_repo, identity.sub)
    async with _repo_session(repo):
        match = await mm.start_practice(repo, mode, identity.sub, name, _now())
        # The seat comes off the stored rows in the one bundled read the view
        # needs anyway, never off the request.
        bundle = await _refetch(repo, match.match_id)
        seat = bundle.seat_for_sub(identity.sub)
        return _view_from_bundle(mode, bundle, seat)


@router.post(f"{BASE}/matches/private", response_model=ArenaMatchView)
async def create_private(
    body: CreateMatchRequest,
    identity: ArenaAuth,
    repo: ArenaRepoDep,
    profile_repo: ProfileRepoDep,
) -> ArenaMatchView:
    """Open a private room. Always UNRATED, and never auto-filled with bots."""
    _require_account_access(identity)
    mode = _entry_mode_or_error(body.mode)
    name = await _display_name(profile_repo, identity.sub)
    try:
        match = await mm.create_private_room(repo, mode, identity.sub, name, _now())
    except SeatUnavailable as exc:
        raise HTTPException(status_code=503, detail=_error(str(exc), "room_unavailable"))
    seat = await repo.get_seat_for_sub(match.match_id, identity.sub)
    return await _build_view(repo, mode, match, seat)


@router.post(f"{BASE}/matches/private/join", response_model=ArenaMatchView)
async def join_private(
    body: JoinRoomRequest,
    request: Request,
    identity: ArenaAuth,
    repo: ArenaRepoDep,
    profile_repo: ProfileRepoDep,
) -> ArenaMatchView:
    """Take a seat in a private room.

    The code grants exactly one thing: the right to seat YOURSELF. It cannot
    submit a command, cannot read another seat's state, and cannot be replayed
    into a second seat -- the storage layer's uniqueness refuses that, not an
    if-statement here.
    """
    _require_account_access(identity)
    _limit_room_joins(request)
    code = body.room_code.strip().upper()
    existing = await repo.find_match_by_room_code(code)
    if existing is None:
        raise HTTPException(
            status_code=404,
            detail=_error("No open room with that code.", "room_not_found"),
        )
    mode = _entry_mode_or_error(existing.mode)
    name = await _display_name(profile_repo, identity.sub)
    try:
        match = await mm.join_private_room(repo, mode, code, identity.sub, name, _now())
    except SeatUnavailable as exc:
        raise HTTPException(status_code=409, detail=_error(str(exc), "seat_unavailable"))
    seat = await repo.get_seat_for_sub(match.match_id, identity.sub)
    return await _build_view(repo, mode, match, seat)


def _waiting_status(mode: str, entry, now: datetime) -> QueueStatusResponse:
    """A `waiting` answer that explains the search honestly: how long, how wide
    the skill band is right now, when it widens, and whether humans are still
    being held out for. See `matchmaking` "Skill bands"."""
    from app.repositories.arena_protocols import _utc

    return QueueStatusResponse(
        status="waiting",
        mode=mode,
        waited_seconds=max(0.0, (now - _utc(entry.joined_at)).total_seconds()),
        still_seeking_humans=entry.prefers_humans_at(now),
        rating_band=mm.rating_band(entry, now),
        rating_band_widens_in_seconds=mm.rating_band_widens_in(entry, now),
    )


@router.post(f"{BASE}/queue/{{mode}}/join", response_model=QueueStatusResponse)
async def join_queue(
    mode: str,
    identity: ArenaAuth,
    repo: ArenaRepoDep,
    profile_repo: ProfileRepoDep,
    rating_repo: ArenaRatingRepoDep,
) -> QueueStatusResponse:
    """Join the public queue. Matches created from it are RATED."""
    _require_account_access(identity)
    if not settings.ARENA_PUBLIC_QUEUE_ENABLED:
        raise HTTPException(
            status_code=403,
            detail=_error("The public queue is not currently open.", "queue_disabled"),
        )
    mode_impl = _entry_mode_or_error(mode)
    now = _now()
    try:
        entry = await mm.join_queue(repo, mode_impl, identity.sub, now)
    except ActiveQueueEntryExists as exc:
        raise HTTPException(
            status_code=409, detail=_error(str(exc), "already_in_queue")
        )

    name = await _display_name(profile_repo, identity.sub)
    match = await mm.try_match(
        repo, mode_impl, entry, {identity.sub: name}, now, rating_repo=rating_repo
    )
    if match is not None:
        return QueueStatusResponse(status="matched", mode=mode, match_id=match.match_id)
    return _waiting_status(mode, entry, now)


@router.get(f"{BASE}/queue/{{mode}}/status", response_model=QueueStatusResponse)
async def queue_status(
    mode: str,
    identity: ArenaAuth,
    repo: ArenaRepoDep,
    profile_repo: ProfileRepoDep,
    rating_repo: ArenaRatingRepoDep,
) -> QueueStatusResponse:
    """Poll while waiting. This is also where a lapsed window turns into a bot
    fill -- the waiting player's own poll is what completes their match, which
    is the same lazy discipline the clock uses and for the same reason."""
    _require_account_access(identity)
    mode_impl = _entry_mode_or_error(mode)
    now = _now()
    entry = await repo.get_queue_entry(identity.sub, mode)
    if entry is None:
        for m in await repo.list_matches_for_sub(identity.sub, limit=5):
            if m.mode == mode and m.is_live():
                return QueueStatusResponse(
                    status="matched", mode=mode, match_id=m.match_id
                )
        return QueueStatusResponse(status="not_in_queue", mode=mode)

    if settings.ARENA_PUBLIC_QUEUE_ENABLED:
        name = await _display_name(profile_repo, identity.sub)
        match = await mm.try_match(
            repo, mode_impl, entry, {identity.sub: name}, now, rating_repo=rating_repo
        )
        if match is not None:
            return QueueStatusResponse(
                status="matched", mode=mode, match_id=match.match_id
            )

    return _waiting_status(mode, entry, now)


#: Which `arena_match_results.detail` keys each mode's board surfaces.
#:
#: The repository is mode-agnostic and takes these as parameters, so adding a
#: mode is a line here rather than a change to a query. Keys are the ones the
#: mode's own settlement writes -- Three-Man Weave's `lineup_peak_score`
#: (three_man_weave/mode.py), the Showdown's `budget_remaining` and
#: `peak3_per_dollar` (twenty_dollar/mode.py).
_MODE_DETAIL_KEYS: dict[str, tuple[str, ...]] = {
    "three_man_weave": ("lineup_peak_score",),
    "three_man_weave_franchise": ("lineup_peak_score",),
    "three_man_weave_decade": ("lineup_peak_score",),
    "twenty_dollar": ("budget_remaining", "peak3_per_dollar"),
    "prime_cut": ("heat_2y", "heat_3y", "heat_5y", "optimal_keeps"),
    "find_the_prime": ("exact_windows", "total_regret"),
}

#: Rated matches before a rating stops being labelled provisional. Matches the
#: placement convention ranked already uses (`placement_states.required_matches`
#: defaults to 7) rather than inventing a second number for the same idea.
_PROVISIONAL_UNTIL = arena_skill.PROVISIONAL_UNTIL


@router.get(f"{BASE}/leaderboard/{{mode}}", response_model=ArenaLeaderboardResponse)
async def leaderboard(
    mode: str,
    repo: ArenaRepoDep,
    standings_repo: ArenaStandingsRepoDep,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> ArenaLeaderboardResponse:
    """The public rating board for one mode -- "Top Players".

    NO AUTH. A public leaderboard is public, and requiring a token to read one
    would make it invisible to exactly the people it exists to attract. What
    that costs is nothing, because the row carries only a handle and
    statistics -- see `ArenaLeaderboardEntry`.

    ONLY PLAYERS WITH A PUBLIC HANDLE APPEAR. A rating exists for every player
    who has finished a rated match, but a board row needs a name, and the only
    name this product will show is the handle a player chose
    (launch-polish IMPLEMENTATION_CONTRACT.md §8). A player without one is rated
    and simply unlisted until they pick a handle -- their rating is not lost and
    their matches still counted.

    `rank` IS THE GLOBAL POSITION among every rated human, unchanged from the
    original contract, so an unlisted player ahead shows as a gap. PAGING IS
    OVER LISTED ROWS (it used to be over all rated rows, which let a page of 50
    hold fewer than 50 names); `total_rated_players` is the count to page
    against, and `population` says how many rated humans the ranks count.

    NEVER A BOT, NEVER A FABRICATED ROW. Bots have no rating row. An empty or
    tiny board is returned as it is, with the counts that say so.
    """
    _require_enabled()
    if not settings.ARENA_LEADERBOARD_ENABLED:
        # Answered rather than 403'd, the same carve-out /readiness has: the web
        # app can render "not open yet" instead of guessing why it got an error.
        return ArenaLeaderboardResponse(leaderboard_enabled=False, mode=mode)

    mode_impl = _mode_or_404(mode)
    return await arena_standings.top_players(
        repo, standings_repo, mode_impl.mode,
        _MODE_DETAIL_KEYS.get(mode_impl.mode, ()), limit, offset,
    )


@router.get(
    f"{BASE}/leaderboard/{{mode}}/around-me", response_model=ArenaAroundMeResponse
)
async def leaderboard_around_me(
    mode: str,
    identity: ArenaAuth,
    repo: ArenaRepoDep,
    standings_repo: ArenaStandingsRepoDep,
    window: int = Query(
        arena_standings.AROUND_ME_DEFAULT_WINDOW,
        ge=1,
        le=arena_standings.AROUND_ME_MAX_WINDOW,
    ),
) -> ArenaAroundMeResponse:
    """"Around You": the caller's standing and the listed players nearest them.

    THE SUBJECT IS THE TOKEN'S. Account access is required because a standing
    is a rated-queue fact and only accounts can enter the rated queue.

    Three honest answers, never a guess (`ArenaAroundMeResponse.status`):
    `not_rated` with no neighbours; `unlisted` -- ranked and counted, with real
    listed neighbours, but not on the board until a handle is chosen; `listed`.
    Neighbours are the nearest LISTED players on each side, so a window is full
    whenever enough listed players exist there; at the top of the board `above`
    is simply empty, at the bottom `below` is.
    """
    _require_account_access(identity)
    if not settings.ARENA_LEADERBOARD_ENABLED:
        return ArenaAroundMeResponse(leaderboard_enabled=False, mode=mode)
    mode_impl = _mode_or_404(mode)
    return await arena_standings.around_me(
        repo, standings_repo, mode_impl.mode, identity.sub,
        _MODE_DETAIL_KEYS.get(mode_impl.mode, ()), window,
        ratings_enabled=settings.ARENA_RATINGS_ENABLED,
    )


@router.get(f"{BASE}/modes/{{mode}}/me", response_model=PersonalRecordResponse)
async def personal_record(
    mode: str,
    identity: ArenaAuth,
    repo: ArenaRepoDep,
    rating_repo: ArenaRatingRepoDep,
    standings_repo: ArenaStandingsRepoDep,
    match_id: Optional[str] = Query(None, max_length=64),
) -> PersonalRecordResponse:
    """The caller's own record in one mode: played, wins, streaks, bests, and
    whether `match_id` was a personal best.

    THE SUBJECT IS THE TOKEN'S, never a parameter, so this can only ever read
    the caller's own results. Practice access suffices for the same reason the
    poll's does: nothing here reaches another person's data.

    A RATING IS REPORTED ONLY WHILE RATINGS ARE WRITTEN. With the flag off there
    is no number to show, and the response says so rather than inventing one.
    """
    _require_practice_access(identity)
    mode_impl = _mode_or_404(mode)
    rows = await repo.list_results_for_sub(mode_impl.mode, identity.sub)
    record = arena_personal.compute_record(
        [
            arena_personal.PersonalResultRow(
                match_id=r.match_id, placement=r.placement, outcome=r.outcome, score=r.score,
                rated=r.rated, seat_count=r.seat_count, detail=r.detail,
            )
            for r in rows
        ],
        detail_keys=_MODE_DETAIL_KEYS.get(mode_impl.mode, ()),
        match_id=match_id,
    )
    rating = provisional = change = None
    if settings.ARENA_RATINGS_ENABLED:
        current = (await rating_repo.get_ratings_for_subs([identity.sub], mode_impl.mode)).get(identity.sub)
        if current is not None:
            rating = round(current.rating, 2)
            provisional = current.rated_matches < _PROVISIONAL_UNTIL
        if match_id and record.match_found:
            for entry in await rating_repo.list_history(identity.sub, mode_impl.mode, limit=200):
                if entry.match_id == match_id:
                    change = round(entry.post_rating - entry.pre_rating, 2)
                    break
    # THE SKILL CARD, for accounts only: a local-practice guest cannot enter
    # the rated queue, so there is no competitive identity to describe. Rank
    # and percentile additionally wait for the public board to be open.
    skill_card = None
    if identity.is_account:
        skill_card = await arena_standings.skill_view(
            repo, standings_repo, mode_impl.mode, identity.sub,
            ratings_enabled=settings.ARENA_RATINGS_ENABLED,
            leaderboard_enabled=settings.ARENA_LEADERBOARD_ENABLED,
        )
    return PersonalRecordResponse(
        mode=mode_impl.mode,
        matches_played=record.matches_played,
        rated_matches=record.rated_matches,
        wins=record.wins,
        podiums=record.podiums,
        current_win_streak=record.current_win_streak,
        longest_win_streak=record.longest_win_streak,
        best_score=record.best_score,
        bests=record.bests,
        match_found=record.match_found,
        match_score=record.match_score,
        match_placement=record.match_placement,
        previous_best_score=record.previous_best_score,
        is_personal_best=record.is_personal_best,
        streak_after_match=record.streak_after_match,
        ratings_enabled=settings.ARENA_RATINGS_ENABLED,
        rating=rating,
        rating_provisional=provisional,
        match_rating_change=change,
        unrated_matches=record.matches_played - record.rated_matches,
        practice_matches=sum(1 for r in rows if r.entry_path == "practice"),
        private_matches=sum(1 for r in rows if r.entry_path == "private_room"),
        skill=skill_card,
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
    identity: ArenaAuth,
    repo: ArenaRepoDep,
    profile_repo: ProfileRepoDep,
    rating_repo: ArenaRatingRepoDep,
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
    _require_account_access(identity)
    _require_bots_enabled()
    mode_impl = _entry_mode_or_error(mode)
    now = _now()

    name = await _display_name(profile_repo, identity.sub)
    match = await mm.fill_queue_with_bots_now(
        repo, mode_impl, identity.sub, {identity.sub: name}, now, rating_repo=rating_repo
    )
    if match is not None:
        return QueueStatusResponse(status="matched", mode=mode, match_id=match.match_id)

    # No waiting entry. Either this is a second press whose first press already
    # created the match, or the caller was never queued. Resolved exactly the way
    # `queue_status` resolves a vanished entry rather than with a second
    # bookkeeping mechanism -- which is also what makes a double-click return
    # the FIRST match instead of seating a second set of bots.
    for m in await repo.list_matches_for_sub(identity.sub, limit=5):
        if m.mode == mode and m.is_live():
            return QueueStatusResponse(status="matched", mode=mode, match_id=m.match_id)
    return QueueStatusResponse(status="not_in_queue", mode=mode)


@router.post(f"{BASE}/matches/{{match_id}}/fill-bots", response_model=ArenaMatchView)
async def fill_room_with_bots(
    match_id: str,
    identity: ArenaAuth,
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
    _require_account_access(identity)
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
    if match.created_by != identity.sub:
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

    mode_impl = _entry_mode_or_error(match.mode)
    try:
        match = await mm.fill_private_room_with_bots(
            repo, mode_impl, match, identity.sub, _now()
        )
    except SeatUnavailable as exc:
        # Also what a double-click gets: the first press consumed the seats.
        raise HTTPException(
            status_code=409, detail=_error(str(exc), "no_empty_seats")
        )

    _, seat = await _seat_or_403(repo, match_id, identity.sub)
    return await _build_view(repo, mode_impl, match, seat)


@router.post(f"{BASE}/queue/{{mode}}/cancel")
async def cancel_queue(mode: str, identity: ArenaAuth, repo: ArenaRepoDep) -> dict:
    _require_account_access(identity)
    return {"cancelled": await repo.cancel_queue_entry(identity.sub, mode)}


# ---------------------------------------------------------------------------
# Playing
# ---------------------------------------------------------------------------


@router.get(f"{BASE}/matches", response_model=MatchHistoryResponse)
async def list_matches(identity: ArenaAuth, repo: ArenaRepoDep) -> MatchHistoryResponse:
    _require_account_access(identity)
    matches = await repo.list_matches_for_sub(identity.sub, limit=20)
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
    match_id: str,
    response: Response,
    identity: ArenaAuth,
    repo: ArenaRepoDep,
    rating_repo: ArenaRatingRepoDep,
) -> ArenaMatchView:
    """THE POLL. Enforces the clock, pumps bots, then serves this seat's view.

    This is the endpoint the authoritative-polling design rests on: everything a
    client needs to render is here, and `state_version` is what it echoes back
    on its next command. A future Supabase Broadcast hint would trigger exactly
    this call and change nothing else.

    `_require_practice_access` rather than the account gate, because THE GATE ON
    THIS ROUTE HAS ALWAYS BEEN `_seat_or_403`: it reads the caller's seat row and
    never a field of the request, so a caller who holds no seat gets a 403 here
    regardless of what kind of identity they carry.
    """
    _require_practice_access(identity)
    timing = _RouteTiming()
    async with _repo_session(repo):
        bundle, seat = await _seat_bundle_or_403(repo, match_id, identity.sub)
        timing.mark("read")
        mode = mode_registry.get(bundle.match.mode) if mode_registry.has(bundle.match.mode) else None
        bundle = await _advance(repo, mode, bundle, rating_repo, timing)
        now = _now()
        if seat.last_seen_at is None or now - _utc_aware(seat.last_seen_at) > _SEAT_TOUCH_INTERVAL:
            await repo.touch_seat(match_id, seat.seat_index, now)
        view = _view_from_bundle(mode, bundle, seat)
    timing.mark("view")
    timing.finish(response, "poll", bundle.match.mode)
    return view


def _utc_aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


@router.post(f"{BASE}/matches/{{match_id}}/commands", response_model=SubmitCommandResponse)
async def submit_command(
    match_id: str,
    body: SubmitCommandRequest,
    response: Response,
    identity: ArenaAuth,
    repo: ArenaRepoDep,
    rating_repo: ArenaRatingRepoDep,
) -> SubmitCommandResponse:
    """THE MUTATION.

    The four required fields: the subject comes from the verified bearer token,
    the timestamp is stamped here from the server clock, and the idempotency key
    and expected version come from the body (both mandatory -- see
    `SubmitCommandRequest`).

    The clock runs FIRST. A command that arrives after its turn expired must lose
    to the timeout rather than beat it by virtue of being the request that
    happened to trigger the sweep.

    Seat-gated, so the practice gate is sufficient here for the same reason it is
    on the poll: `actor_seat_index` comes off the seat row, never off the body.
    """
    _require_practice_access(identity)
    timing = _RouteTiming()
    async with _repo_session(repo):
        bundle, seat = await _seat_bundle_or_403(repo, match_id, identity.sub)
        timing.mark("read")

        try:
            validate_client_command(body.command_type)
        except ValueError as exc:
            raise HTTPException(
                status_code=400, detail=_error(str(exc), "reserved_command")
            )

        mode = _mode_or_404(bundle.match.mode)
        now = _now()
        # The clock runs FIRST, from the bundle: a command that arrives after
        # its turn expired must lose to the timeout rather than beat it.
        fired = await clock.enforce(
            repo, match_id, mode.reduce, now, mode=mode,
            match=bundle.match, turn=bundle.open_turn,
        )
        swept = fired is not None or (bundle.match.is_live() and bundle.match.is_expired_at(now))
        timing.mark("clock")

        request = CommandRequest(
            match_id=match_id,
            idempotency_key=body.idempotency_key,
            command_type=body.command_type,
            payload=body.payload,
            actor_sub=identity.sub,
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
        timing.mark("apply")

        # THE RESPONSE VIEW WITHOUT A RE-READ when the repository reported the
        # state it just wrote. A rejection, a replay, or a clock sweep that ran
        # first leaves the bundle unknowable from here, and those read.
        updated = None if swept else bundle.after_command(outcome)
        if updated is None:
            updated = await _refetch(repo, match_id)
        updated = await _advance(repo, mode, updated, rating_repo, timing)
        view = _view_from_bundle(mode, updated, seat)
    timing.mark("view")
    timing.finish(response, "command", bundle.match.mode, body.command_type)
    return SubmitCommandResponse(
        accepted=outcome.accepted,
        replayed=outcome.replayed,
        rejection_code=outcome.rejection_code,
        message=outcome.rejection_message,
        match=view,
    )


@router.get(f"{BASE}/matches/{{match_id}}/events", response_model=ArenaEventsResponse)
async def get_events(
    match_id: str,
    identity: ArenaAuth,
    repo: ArenaRepoDep,
    after_seq: int = Query(-1, ge=-1),
    limit: int = Query(200, ge=1, le=500),
) -> ArenaEventsResponse:
    """The incremental log for THIS seat.

    `for_seat` is the caller's own seat index from their seat row. It is never
    None on this path -- None is the server view and returns 'server'-visibility
    rows, which no client may see.
    """
    _require_practice_access(identity)
    _match, seat = await _seat_or_403(repo, match_id, identity.sub)
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
    match_id: str, identity: ArenaAuth, repo: ArenaRepoDep
) -> ArenaResultsResponse:
    """Final results. Participant-only, and empty until the match completes.

    A pure read: the settlement is written by the command that ended the match,
    never by somebody looking at it. Peak Draft's `/comparison` wrote a
    settlement on a GET; that shape is deliberately not repeated here, the same
    call `head_to_head.py:48-51` records.
    """
    _require_practice_access(identity)
    match, _seat = await _seat_or_403(repo, match_id, identity.sub)
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
