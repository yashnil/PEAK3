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
from typing import Any, Optional, Sequence

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


#: The product's name for the house opponent. USER-FACING, and the only string
#: any surface may show for a bot seat.
BOT_DISPLAY_NAME = "PEAK3 Bot"

#: The one difficulty every mode currently ships. Rendered as a chip beside the
#: name by the surfaces that want it; never part of `display_name` itself,
#: because a roster panel reading "PEAK3 Bot · Standard 2" is worse than
#: "PEAK3 Bot 2".
BOT_DIFFICULTY_LABEL = "Standard"


def bot_display_name(seat_index: int, seat_count: int) -> str:
    """What a bot seat is CALLED, when its mode has no opinion.

    NEVER DERIVED FROM `bot_id`. The lobby shipped "PEAK3 bot (random_legal_v1)"
    because the seat's name was built by interpolating the policy id, so an
    internal identifier -- one that also happened to name the wrong policy --
    became the thing players read. The name is authored here, the id stays on
    `ArenaSeat.bot_id` where results and ratings need it, and there is no
    format string anywhere that can put the two together again.

    Numbered only when a match seats more than one bot, so a two-seat game says
    "PEAK3 Bot" rather than "PEAK3 Bot 1".
    """
    if seat_count <= 2:
        return BOT_DISPLAY_NAME
    return f"{BOT_DISPLAY_NAME} {seat_index}"


def bot_seat_names(mode, seed: int, seat_indexes: Sequence[int]) -> dict[int, str]:
    """seat_index -> display name, for every bot seat in one match.

    A MODE MAY NAME ITS OWN BOTS. In a two-seat auction "PEAK3 Bot" is exactly
    right: there is one opponent and nothing to disambiguate. In a three-seat
    draft, "PEAK3 Bot 1" and "PEAK3 Bot 2" sit in a pick feed next to Michael
    Jordan and Larry Bird and read as unfinished work, so Three-Man Weave
    supplies seeded basketball archetypes instead.

    Named for the WHOLE MATCH AT ONCE rather than seat by seat, because
    distinctness is the requirement -- two seats drawing independently could
    both land on the same archetype, and a per-seat hook could not notice.

    Falls back to `bot_display_name` if the mode has no hook, if the hook
    fails, or if it returns too few names: a bot with no name is a bug the
    player sees, so the default is always available.
    """
    default = {
        index: bot_display_name(index, getattr(mode, "seat_count", len(seat_indexes)))
        for index in seat_indexes
    }
    hook = getattr(mode, "bot_display_names", None)
    if hook is None or not seat_indexes:
        return default
    try:
        names = tuple(hook(seed, len(seat_indexes)))
    except Exception:  # pragma: no cover - a broken hook must not block play
        logger.exception("arena: bot naming hook failed for mode %r", getattr(mode, "mode", "?"))
        return default
    if len(names) < len(seat_indexes) or len(set(names)) != len(names):
        return default
    return {index: names[position] for position, index in enumerate(sorted(seat_indexes))}


def bot_seat(
    match_id: str,
    seat_index: int,
    policy: BotPolicy,
    display_name: Optional[str] = None,
    seat_count: int = 2,
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
        display_name=display_name or bot_display_name(seat_index, seat_count),
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

    if decision is None:
        # The policy has no legal move. A real state (a mode that offered a
        # command it cannot parameterise, a roll with nothing takeable), and
        # NOT one to sit on: `drive_pending_bots` escalates it to the turn's
        # own timeout resolution rather than letting the clock spend a full
        # human turn on a seat that has already decided it cannot act.
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


#: How long a bot "thinks" before its move lands, in seconds.
#:
#: NOT A DIFFICULTY SETTING AND NOT A FULL TURN. Two behaviours were wrong
#: without it, in opposite directions. With no delay, a bot moved inside the
#: same request that opened its turn, so a whole lot could resolve between two
#: frames and the player saw a settled result they never watched happen. With
#: the human turn timer instead, a three-seat draft against two bots spent 45
#: seconds per bot pick and took a quarter of an hour of waiting.
#:
#: A short delay, enforced against `turn.opened_at`, gives the move somewhere to
#: be seen: the client polls every couple of seconds, so the board renders the
#: bot on the clock, then renders its move. No background worker is involved --
#: the poll that notices the delay has elapsed is the one that drives the bot,
#: exactly the lazy discipline `clock.enforce` uses.
BOT_THINK_SECONDS = 1.2


def bot_think_seconds_for(mode, match, turn) -> float:
    """How long THIS bot takes on THIS turn.

    A mode may vary it -- Three-Man Weave draws 1-5 seconds per (seat, turn)
    from the match seed, so three bot seats do not all move on the same
    metronome, which is what made a draft feel like a script rather than a
    room. Deterministic from stored state, so every poller computes the same
    answer and a fast client cannot hurry a bot along.
    """
    hook = getattr(mode, "bot_think_seconds", None)
    if hook is None or turn is None or turn.seat_index is None:
        return BOT_THINK_SECONDS
    try:
        seconds = float(hook(match.seed, turn.seat_index, turn.turn_seq))
    except Exception:  # pragma: no cover - a broken hook must not wedge a turn
        return BOT_THINK_SECONDS
    # Clamped so a mode cannot accidentally park a bot past the human clock.
    return max(0.0, min(seconds, 10.0))


def bot_may_act_at(turn, now: datetime, think_seconds: float = BOT_THINK_SECONDS) -> bool:
    """Has this bot's thinking time elapsed?

    Compared against `arena_turns.opened_at`, which is stored, so two pollers
    racing agree -- and so a client cannot shorten it by polling faster.
    """
    from app.repositories.arena_protocols import _utc

    return (now - _utc(turn.opened_at)).total_seconds() >= think_seconds


async def _resolve_stalled_bot_turn(
    repo: ArenaRepository,
    reducer: MatchReducer,
    match_id: str,
    turn_seq: int,
    now: datetime,
    seat_index: int,
) -> bool:
    """Close a bot's turn through the mode's own timeout path. Returns whether
    anything was applied.

    Reuses `clock.guard_timeout` and `clock.timeout_idempotency_key` rather
    than inventing a second resolution: the guard refuses a timeout whose turn
    is no longer the open one, and the derived key makes two concurrent pollers
    a replay instead of a double resolution. Both properties are exactly what
    this needs, and duplicating them here is how they drift.

    Imported inside the function because `clock` and `bots` are peers in the
    foundation package and a module-level import either way would make the
    ordering matter.
    """
    from app.repositories.arena_protocols import COMMAND_TYPE_TIMEOUT
    from app.services.arena import clock

    logger.warning(
        "arena: bot seat %d produced no legal move in match %s turn %d; "
        "resolving the turn now instead of holding the clock",
        seat_index, match_id, turn_seq,
    )
    outcome = await repo.apply_command(
        CommandRequest(
            match_id=match_id,
            idempotency_key=clock.timeout_idempotency_key(match_id, turn_seq),
            command_type=COMMAND_TYPE_TIMEOUT,
            payload={"turn_seq": turn_seq, "seat_index": seat_index},
            actor_sub=None,
            actor_seat_index=seat_index,
            expected_state_version=None,
            issued_at=now,
        ),
        clock.guard_timeout(reducer, turn_seq),
        now,
    )
    return bool(outcome.accepted and not outcome.replayed)


async def drive_pending_bots(
    repo: ArenaRepository,
    mode: ArenaMode,
    reducer: MatchReducer,
    match_id: str,
    now: datetime,
    max_steps: int = 12,
) -> int:
    """Advance every bot seat whose turn has come AND whose think time elapsed.

    Returns how many bot commands were accepted.

    A bot whose think time has not elapsed is left alone and the loop STOPS
    rather than skipping to another seat: turns are sequential, so nothing
    behind it can legally move either, and continuing would spin.

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
        if not bot_may_act_at(turn, now, bot_think_seconds_for(mode, match, turn)):
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
        if outcome is None or not outcome.accepted:
            if outcome is not None and outcome.replayed:
                return steps  # already moved this turn; nothing further to do.
            # A BOT MUST NEVER STALL THE MATCH. Its policy produced nothing, or
            # produced something the reducer refused. Leaving the turn open
            # would spend a full human-length clock on a seat that has already
            # failed to act -- eighteen of those is how a Three-Man Weave
            # practice draft took thirteen minutes. The turn is resolved NOW
            # through the mode's own timeout path, which every mode already
            # implements and which produces a defined, deterministic outcome
            # (Three-Man Weave's auto-pick; the Showdown's pass).
            resolved = await _resolve_stalled_bot_turn(
                repo, reducer, match_id, turn.turn_seq, now, seat.seat_index
            )
            if not resolved:
                return steps
            steps += 1
            continue
        if outcome.replayed:
            return steps
        steps += 1
    logger.warning(
        "arena: bot driver hit max_steps=%d on match %s -- the mode's reducer "
        "may not be advancing the turn", max_steps, match_id,
    )
    return steps
