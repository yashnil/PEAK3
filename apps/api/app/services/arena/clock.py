"""Server-authoritative deadlines, and the sweep that actually fires them.

THE DEFECT THIS MODULE EXISTS NOT TO REPEAT
--------------------------------------------
`ranked_matches.deadline` is written by matchmaking
(`services/ranked/matchmaking.py:195`), stored, read back and serialized to the
client -- and never compared against anything, anywhere. Six references, none of
them a comparison. So a ranked match's 48-hour clock has never once expired a
match, and the `'expired'` and `'forfeited'` values in that table's status CHECK
have never been written by any code path. The deadline looks enforced from the
outside: the API returns it, the UI could count down against it, and nothing
happens when it passes.

A deadline that is stored but not compared is worse than no deadline, because
every reader assumes it works. So this module is small, and every path that
touches a match calls it.

LAZY, NOT BACKGROUND -- AND WHY THAT IS ENOUGH
-----------------------------------------------
There is no background task runner in this application: no APScheduler, no
Celery, no cron, no `BackgroundTasks`, and no `asyncio.create_task` in
application code. Inventing one for this would be a new deployment surface on a
single-instance Railway service with no shared broker, and the failure mode of a
worker that silently stops is exactly the invisible-non-enforcement being fixed.

Ranked reached the same conclusion for its queue TTL and wrote it down
(`services/ranked/matchmaking.py:66-68`): "This is a sweep on join, not a
background worker ... the only moment the staleness matters is the moment
someone is about to be paired." The same is true here, with one addition: a
turn's expiry matters to the OPPONENT, who is polling. So the sweep runs on
every read of a match as well as every write, which means the player waiting on
a timeout is the one whose own polling fires it. The only match whose clock does
not advance is one nobody is looking at, and a match nobody is looking at has
nobody waiting on it.

HOW THE TIMEOUT/ACTION RACE IS SETTLED
---------------------------------------
A timeout is an ordinary command. It goes through `apply_command` like every
other, so it takes the same match row lock and is serialized against the action
that might beat it. Two things then make the outcome correct rather than merely
likely:

  * The lock SERIALIZES them. Whichever transaction takes the row lock first
    runs to completion before the other starts, so there is no interleaving.
  * `timeout_idempotency_key` is DETERMINISTIC per (match, turn). Two concurrent
    sweeps issue the identical key, so the second is a replay and applies
    nothing -- it cannot double-forfeit.
  * `guard_timeout` refuses a timeout whose turn is no longer the open one. If
    the player's action won the race, it resolved turn N and opened turn N+1; the
    timeout for turn N then arrives, sees a different open turn, and is rejected
    as `turn_already_resolved`.

The third is the one that makes the first two sufficient. Without it, a timeout
that lost the race would still be a well-formed command against a live match and
would forfeit the turn the player had just legitimately played.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from app.repositories.arena_protocols import (
    COMMAND_TYPE_TIMEOUT,
    TURN_RESOLUTION_TIMEOUT,
    ArenaRepository,
    CommandOutcome,
    CommandRequest,
    MatchReducer,
    ReducerInput,
    ReducerOutput,
)

logger = logging.getLogger(__name__)

#: Rejection code for a timeout whose turn somebody already resolved.
REJECT_TURN_ALREADY_RESOLVED = "turn_already_resolved"

#: HOW LONG A TURN STAYS ANSWERABLE AFTER ITS DEADLINE, in seconds.
#:
#: Not slack in the rules and not a second clock: the visible countdown still
#: runs to `deadline_at`, and `seconds_remaining` never includes this. It is
#: the allowance for the two delays between a player deciding and the server
#: hearing about it -- the age of the poll their countdown was seeded from, and
#: the request's own flight time.
#:
#: WHY IT HAS TO EXIST. `submit_command` enforces the clock BEFORE applying a
#: command, so that a genuinely late action loses to the timeout instead of
#: beating it by being the request that triggered the sweep. That ordering is
#: right and is kept. With a zero-width window it also destroyed actions the
#: player had every reason to believe were in time: a scripted reproduction
#: against the real repository showed a `$2` bid submitted 120 ms past the
#: deadline swept away, the lot awarded to the bot at `$1`, and the human's
#: command rejected as `stale_state_version` -- the exact failure reported from
#: manual testing.
#:
#: 2.0 seconds covers a 2-second poll interval that has just lapsed plus a
#: normal round trip. It is deliberately not larger: a window long enough to
#: hide a genuinely abandoned turn would make the opponent wait for a player
#: who is not there.
#:
#: IT CANNOT BE USED TO ACT TWICE. The turn resolves the instant any action
#: lands, and `guard_timeout` refuses a timeout whose turn is no longer open.
#: It is measured against the SERVER clock only; no field in a request body can
#: move it.
ACTION_GRACE_SECONDS = 2.0


def timeout_idempotency_key(match_id: str, turn_seq: int) -> str:
    """The key a timeout for this exact turn always carries.

    DETERMINISTIC ON PURPOSE. A random key per sweep would let two concurrent
    sweeps each apply a timeout to the same turn -- the second would find the
    turn resolved and be rejected by `guard_timeout`, so the state would still be
    correct, but the match would carry two command rows and two rejection
    records for one event, and a third sweep could race in the window between
    them. A fixed key makes the second sweep a replay at the storage layer,
    which is where a race should be settled rather than in a rule.
    """
    return f"timeout:{match_id}:{turn_seq}"


def guard_timeout(reducer: MatchReducer, turn_seq: int) -> MatchReducer:
    """Wrap a mode reducer so it only sees a timeout for the turn still open.

    Applied by the foundation rather than by each mode, because a mode that
    forgot this check would forfeit a turn the player had already legitimately
    played -- the single worst bug this subsystem could have, and not one that
    should depend on every future mode author remembering a rule.
    """

    def _guarded(data: ReducerInput) -> ReducerOutput:
        if data.open_turn is None or data.open_turn.turn_seq != turn_seq:
            return ReducerOutput(
                accepted=False,
                rejection_code=REJECT_TURN_ALREADY_RESOLVED,
                rejection_message=(
                    "That turn was already resolved by a play or an earlier sweep."
                ),
            )
        return reducer(data)

    return _guarded


async def enforce(
    repo: ArenaRepository,
    match_id: str,
    reducer: Optional[MatchReducer],
    now: datetime,
) -> Optional[CommandOutcome]:
    """Advance one match's clock. Call before serving or mutating it.

    Returns the timeout's `CommandOutcome` if one fired, else None.

    `reducer` may be None when the caller has no mode module (an unregistered or
    retired mode). The match clock is still enforced in that case -- an expired
    match is expired regardless of whether anything can still interpret its
    rules -- but the turn timeout is skipped, because resolving a turn without
    the mode's own rules would produce a state the mode could not read back.
    """
    match = await repo.get_match(match_id)
    if match is None or not match.is_live():
        return None

    # 1. The match's own clock outranks the turn clock: an expired match has no
    #    meaningful next turn, and firing a timeout first would append an event
    #    to a match that is about to be closed anyway.
    if match.is_expired_at(now):
        if await repo.expire_match(match_id, now):
            logger.info("arena: match %s expired at its own deadline", match_id)
        return None

    # 2. The turn clock, plus the action grace window. See
    #    `ACTION_GRACE_SECONDS` for why a turn is not swept the instant its
    #    deadline passes, and why that is not slack in the rules.
    turn = await repo.get_open_turn(match_id)
    if turn is None or reducer is None:
        return None
    # THE GRACE WINDOW PROTECTS A LATE ACTION, so a turn that accepts no action
    # does not get one. A mode may open a turn nobody is on the clock for --
    # Three-Man Weave's franchise x decade reveal is one -- and there charging
    # the two-second allowance would simply make every ceremony two seconds
    # longer than the mode asked for, with nothing to protect.
    grace = ACTION_GRACE_SECONDS if turn.seat_index is not None else 0.0
    if not turn.is_overdue_at(now, grace):
        return None

    request = CommandRequest(
        match_id=match_id,
        idempotency_key=timeout_idempotency_key(match_id, turn.turn_seq),
        command_type=COMMAND_TYPE_TIMEOUT,
        payload={"turn_seq": turn.turn_seq, "seat_index": turn.seat_index},
        # Server-issued: no actor, and therefore no expected version. See
        # `apply_command`'s docstring for why a timeout carries no version.
        actor_sub=None,
        actor_seat_index=turn.seat_index,
        expected_state_version=None,
        issued_at=now,
    )
    outcome = await repo.apply_command(
        request, guard_timeout(reducer, turn.turn_seq), now
    )
    if outcome.accepted and not outcome.replayed:
        logger.info(
            "arena: match %s turn %d timed out (seat %s)",
            match_id, turn.turn_seq, turn.seat_index,
        )
    return outcome


async def sweep_mode(
    repo: ArenaRepository,
    mode: Optional[str],
    reducer_for: "callable",
    now: datetime,
    limit: int = 50,
) -> int:
    """Advance the clock on every overdue match, optionally scoped to one mode.

    Returns how many matches had something fire. Bounded by `limit` so one call
    cannot turn into an unbounded scan; the next call picks up the remainder,
    and since this only ever runs inside a request, an unbounded version would
    be a request that gets slower the worse the backlog is.

    `reducer_for` maps a mode name to its reducer, or None -- passed in rather
    than importing the registry so this module stays testable without one.
    """
    fired = 0
    for match_id in await repo.list_overdue_matches(mode, now, limit):
        match = await repo.get_match(match_id)
        if match is None:
            continue
        try:
            outcome = await enforce(repo, match_id, reducer_for(match.mode), now)
        except Exception:
            # One bad match must not stop the sweep for every other. Logged at
            # exception level because a match that cannot be advanced is stuck
            # for its players, which is a real fault rather than noise.
            logger.exception("arena: sweep failed for match %s", match_id)
            continue
        if outcome is not None and outcome.accepted and not outcome.replayed:
            fired += 1
    return fired


def timeout_resolution() -> str:
    """The resolution a mode should return from a timeout reduction.

    Exposed so a mode does not have to import the vocabulary constant to do the
    single most common thing a timeout reducer does.
    """
    return TURN_RESOLUTION_TIMEOUT
