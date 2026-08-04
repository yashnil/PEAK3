"""Bots, and the reason a bot here structurally cannot cheat.

THE GUARANTEE, AND WHERE IT LIVES
----------------------------------
A bot may never inspect a future roll, an unrevealed card, an opposing sealed
bid, or any private client state. That is enforced by TYPE, not by convention:

  * `BotPolicy.choose` accepts a `SeatView` and a `random.Random`. That is the
    entire signature. There is no `ArenaMatch` parameter, no `snapshot`
    parameter, no repository handle, no connection.
  * `SeatView` (`arena_protocols.py`) has no field that holds the authoritative
    state and no method that reaches it. Its `public_state` and `private_state`
    are deep copies produced by the mode's own `project`, and `project` is the
    same function that decides what a HUMAN in that seat sees. A bot therefore
    sees exactly what a human in that seat sees -- not less, and provably not
    more.
  * `BotCommand` carries only `command_type` and `payload`. A bot does not
    choose its own match, seat, idempotency key or timestamp; `drive_bot_seat`
    supplies all four. So a bot cannot address a command at a match or a seat it
    was not asked about, even if its policy tried.

The practical test of a design like this is whether the cheating version fails
to compile rather than failing review. Here it does: a policy that wanted the
full state would have to change `BotPolicy`'s signature, which changes a
protocol in a file a mode author does not own.

BOTS RUN OUTSIDE THE MATCH TRANSACTION
---------------------------------------
`drive_bot_seat` projects a view, calls the policy, and then submits the result
through the same `apply_command` a human uses. The policy is never called while
the match row lock is held -- see `MatchReducer`'s constraint 1: a reducer that
awaits holds the lock across the await. That also means a bot's command is
subject to every check a human's is, including the reducer's legality rules. A
buggy bot produces a rejected command, not an illegal game state.

DETERMINISM
-----------
The RNG is supplied by the driver and seeded from the match seed plus a named
stream, so a bot's choices replay identically. A policy that reached for
`random.random()` would make the match unreproducible; the parameter exists so
it never has to.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Optional

from app.repositories.arena_protocols import (
    ArenaMatch,
    ArenaRepository,
    ArenaSeat,
    BotCommand,
    BotPolicy,
    CommandOutcome,
    CommandRequest,
    MatchReducer,
    SeatView,
    project_seat_view,
)
from app.services.arena.modes import ArenaMode, mode_rng

logger = logging.getLogger(__name__)


class RandomLegalBot:
    """The baseline opponent: picks uniformly from the legal commands it is told.

    Deliberately mode-agnostic and deliberately weak. It exists so the
    foundation can be tested, so a public queue can fill a seat rather than
    stranding a player, and so every mode has a working opponent on day one
    without the foundation knowing any mode's strategy. A mode that wants a
    strong opponent registers its own policy; nothing here has to change.

    It carries NO payload logic, which is the honest limitation: a command that
    needs arguments (a bid amount, a card id) cannot be produced by a policy
    that does not understand the mode. `choose` therefore emits an empty payload
    and relies on the mode's reducer treating a payload-free command as a
    pass/no-op -- which is why `legal_commands` for a mode with parameterised
    moves must include a parameter-free fallback. Stated here rather than
    discovered later: a mode whose only legal commands need arguments will get a
    rejected command from this bot, and should ship its own policy.
    """

    def __init__(
        self,
        bot_id: str = "random_legal_v1",
        policy_version: str = "arena_bot_v1",
        rating: float = 1200.0,
    ) -> None:
        self._bot_id = bot_id
        self._policy_version = policy_version
        self._rating = rating

    @property
    def bot_id(self) -> str:
        return self._bot_id

    @property
    def policy_version(self) -> str:
        return self._policy_version

    @property
    def rating(self) -> float:
        return self._rating

    async def choose(self, view: SeatView, rng: Any) -> BotCommand:
        if not view.legal_commands:
            # No legal move is a real state (a seat that is out, a phase that
            # is not theirs). Returning a no-op rather than raising keeps the
            # driver's error handling for genuine faults.
            return BotCommand(command_type="pass", payload={})
        return BotCommand(command_type=rng.choice(list(view.legal_commands)), payload={})


class BotRegistry:
    """Registered bot policies, by id.

    Separate from `ModeRegistry` because a policy may serve several modes (the
    random baseline does) and because a mode shipping without a bespoke bot is
    the normal case, not a gap.
    """

    def __init__(self) -> None:
        self._policies: dict[str, BotPolicy] = {}
        self._default_by_mode: dict[str, str] = {}

    def register(self, policy: BotPolicy, *, for_modes: tuple[str, ...] = ()) -> None:
        existing = self._policies.get(policy.bot_id)
        if existing is not None and existing is not policy:
            raise ValueError(f"bot {policy.bot_id!r} is already registered")
        self._policies[policy.bot_id] = policy
        for mode in for_modes:
            self._default_by_mode[mode] = policy.bot_id

    def get(self, bot_id: str) -> BotPolicy:
        return self._policies[bot_id]

    def default_for(self, mode: str) -> BotPolicy:
        """The policy a queue fill or a practice match uses for this mode.

        Falls back to the random baseline rather than raising: a mode with no
        registered bot should still be playable against a filler, and a hard
        failure here would surface as "matchmaking is broken" rather than
        "this mode has no clever bot yet".
        """
        bot_id = self._default_by_mode.get(mode)
        if bot_id is not None and bot_id in self._policies:
            return self._policies[bot_id]
        return _FALLBACK_BOT

    def clear(self) -> None:
        """Test seam only."""
        self._policies.clear()
        self._default_by_mode.clear()


_FALLBACK_BOT = RandomLegalBot()

#: Process-wide bot registry, mirroring `modes.registry`.
registry = BotRegistry()


def bot_seat(
    match_id: str,
    seat_index: int,
    policy: BotPolicy,
    display_name: Optional[str] = None,
) -> ArenaSeat:
    """Build the seat row for a bot.

    `bot_rating` is copied onto the seat here, at seat time, rather than looked
    up when a result is scored. A recalibration must not retroactively change
    what a settled rated match was played against -- the same reason ranked pins
    its algorithm version per match rather than reading the current one at
    settlement.
    """
    return ArenaSeat(
        match_id=match_id,
        seat_index=seat_index,
        occupant_kind="bot",
        bot_id=policy.bot_id,
        bot_rating=policy.rating,
        display_name=display_name or f"PEAK3 bot ({policy.bot_id})",
    )


async def drive_bot_seat(
    repo: ArenaRepository,
    mode: ArenaMode,
    reducer: MatchReducer,
    match: ArenaMatch,
    seat: ArenaSeat,
    policy: BotPolicy,
    now: datetime,
    turn_seq: int,
) -> Optional[CommandOutcome]:
    """Let one bot seat act, once.

    Returns the outcome, or None if the seat is not a bot or has nothing legal
    to do.

    THE IDEMPOTENCY KEY IS DERIVED, NOT RANDOM, for the same reason the timeout's
    is (`clock.timeout_idempotency_key`): two requests that both notice it is the
    bot's turn would otherwise each drive the bot, and the bot would move twice.
    Keyed on (match, seat, turn) so a bot moves at most once per turn no matter
    how many pollers notice.
    """
    if not seat.is_bot:
        return None

    seats = tuple(await repo.get_seats(match.match_id))
    public_state, private_state, legal = mode.project(match, seats, seat.seat_index)
    if not legal:
        return None

    open_turn = await repo.get_open_turn(match.match_id)
    view = project_seat_view(
        match=match,
        seat=seat,
        public_state=public_state,
        private_state=private_state,
        legal_commands=legal,
        open_turn=open_turn,
        now=now,
    )

    rng = mode_rng(match.seed, f"bot:{seat.seat_index}:{turn_seq}")
    try:
        decision = await policy.choose(view, rng)
    except Exception:
        # A crashing policy must not wedge the match. The turn stays open and
        # the clock will forfeit it, which is a defined outcome rather than a
        # hang. Logged at exception level: a bot that cannot choose is a fault.
        logger.exception(
            "arena: bot %s failed to choose in match %s", policy.bot_id, match.match_id
        )
        return None

    request = CommandRequest(
        match_id=match.match_id,
        idempotency_key=f"bot:{match.match_id}:{seat.seat_index}:{turn_seq}",
        command_type=decision.command_type,
        payload=dict(decision.payload),
        # A bot acts AS its seat but has no subject: it is not a person and must
        # never be attributable to one. `actor_seat_index` is what the reducer
        # keys on, and it is supplied by this driver rather than by the policy.
        actor_sub=None,
        actor_seat_index=seat.seat_index,
        expected_state_version=match.state_version,
        issued_at=now,
    )
    return await repo.apply_command(request, reducer, now)


async def drive_pending_bots(
    repo: ArenaRepository,
    mode: ArenaMode,
    reducer: MatchReducer,
    match_id: str,
    now: datetime,
    max_steps: int = 12,
) -> int:
    """Advance every bot seat that currently has the turn, until a human is up.

    Returns how many bot commands were accepted.

    BOUNDED BY `max_steps`. A mode whose reducer never advances the turn would
    otherwise spin here forever inside a request. The bound is a guard against a
    mode bug, not an expected limit: in a 3-seat match at most 2 consecutive
    bot turns can occur before a human is up, so reaching 12 means something is
    wrong and the log line says so.

    Called after a human's command and on a poll, so a bot's move appears
    without a background worker -- the same lazy discipline `clock.enforce`
    uses, for the same reason (there is no background runner in this app).
    """
    steps = 0
    for _ in range(max_steps):
        match = await repo.get_match(match_id)
        if match is None or not match.is_live():
            return steps
        turn = await repo.get_open_turn(match_id)
        if turn is None:
            return steps
        seats = await repo.get_seats(match_id)
        if turn.seat_index is None:
            # A simultaneous turn: every bot seat that has not yet acted plays.
            acted = False
            for seat in seats:
                if not seat.is_bot:
                    continue
                outcome = await drive_bot_seat(
                    repo, mode, reducer, match, seat,
                    registry.default_for(match.mode), now, turn.turn_seq,
                )
                if outcome is not None and outcome.accepted and not outcome.replayed:
                    steps += 1
                    acted = True
            if not acted:
                return steps
            continue

        seat = next((s for s in seats if s.seat_index == turn.seat_index), None)
        if seat is None or not seat.is_bot:
            return steps  # a human is up; stop.
        outcome = await drive_bot_seat(
            repo, mode, reducer, match, seat,
            registry.default_for(match.mode), now, turn.turn_seq,
        )
        if outcome is None or not outcome.accepted or outcome.replayed:
            return steps
        steps += 1
    logger.warning(
        "arena: bot driver hit max_steps=%d on match %s -- the mode's reducer "
        "may not be advancing the turn", max_steps, match_id,
    )
    return steps
