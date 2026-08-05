"""The mode plug-in contract, and the registry of live modes.

THIS IS THE SEAM. Everything in `app/services/arena/` and
`app/repositories/arena_*` is mode-agnostic; everything a specific game knows
lives behind `ArenaMode`. Three-Man Weave and The $20 Showdown each implement
this protocol in their own module and register it; neither touches the
foundation, and the foundation imports neither.

A mode supplies four things and nothing else:

  1. `initial_snapshot` -- the opening state, derived from the seed.
  2. `reduce`          -- the rules, as a pure function (see `MatchReducer`).
  3. `project`         -- what one seat may see, which is the hidden-information
                          boundary for both humans and bots.
  4. `turn_duration`   -- how long a seat gets, which the foundation turns into
                          an enforced deadline.

WHY `project` IS PART OF THE CONTRACT RATHER THAN A ROUTE'S JOB. A route that
serialized `match.snapshot` directly would ship every sealed bid and every
unrevealed card to every client, and no amount of care in the foundation could
prevent it -- the foundation does not know which keys are secret. Making the
projection the mode's own required method means the default is "nothing is
visible until the mode says so", instead of "everything is visible unless a
route remembers to strip it". That inversion is the entire lesson of
`api/v1/head_to_head.py:183-201`, where returning a stored dict verbatim leaked
the opponent's run id out of a settled receipt.
"""
from __future__ import annotations

import random
from typing import Optional, Protocol, runtime_checkable

from app.repositories.arena_protocols import (
    ArenaMatch,
    ArenaSeat,
    ReducerInput,
    ReducerOutput,
    TurnDraft,
)


@runtime_checkable
class ArenaMode(Protocol):
    """One game, plugged into the Arena foundation."""

    @property
    def mode(self) -> str:
        """The stable identifier, lower snake_case. Stored on every match and
        constrained by `arena_matches.mode`'s shape CHECK."""
        ...

    @property
    def mode_version(self) -> str:
        """This ruleset's version. Pinned per match at creation; a match whose
        version has moved is refused rather than reinterpreted."""
        ...

    @property
    def seat_count(self) -> int:
        """How many seats a match of this mode has."""
        ...

    @property
    def turn_seconds(self) -> float:
        """How long one turn lasts. The foundation converts this into a stored,
        enforced `arena_turns.deadline_at`; a mode never computes a deadline
        itself, so no mode can accidentally ship a turn with no clock."""
        ...

    def initial_snapshot(self, seed: int, seats: tuple[ArenaSeat, ...]) -> dict:
        """The opening state, a pure function of `(seed, seats)`.

        Generated content is NOT persisted anywhere but here, and this is
        derived from the seed on demand -- the same rule
        `20260731090000_run_the_table.sql:14-19` states: a second copy of a
        derivable truth can only ever drift from the first.
        """
        ...

    def initial_phase(self) -> str:
        """The phase name the first turn opens in."""
        ...

    def reduce(self, data: ReducerInput) -> ReducerOutput:
        """The rules. Pure -- no I/O, no clock, no mutation of the input. The
        three constraints and why they exist are in `MatchReducer`'s docstring;
        this method IS a `MatchReducer`."""
        ...

    def project(
        self, match: ArenaMatch, seats: tuple[ArenaSeat, ...], seat_index: int
    ) -> tuple[dict, dict, tuple[str, ...]]:
        """Return `(public_state, private_state, legal_commands)` for one seat.

        `public_state` is what every seat may see. `private_state` is what THIS
        seat may additionally see. `legal_commands` is what this seat may issue
        right now.

        MUST NOT leak another seat's hidden state into either dict. This is the
        one method in the whole contract where a bug is a cheating bug rather
        than a crash, which is why the foundation's own tests assert the
        projection of a seat with hidden state does not contain another seat's
        secret for every registered mode.
        """
        ...

    # -- OPTIONAL HOOKS ----------------------------------------------------
    #
    # Everything above is required. The three below are not part of the
    # Protocol's structural contract and are read with `getattr` by the
    # functions that want them (`human_seat_for`, `bot_seat_names`,
    # `bot_think_seconds_for`), so a mode that does not care about seating,
    # bot naming or bot pacing simply does not define them and gets the
    # foundation's defaults. Making them required would force every mode --
    # including a future two-seat one where seat order is meaningless -- to
    # write a method whose only job is to return the default.
    #
    #   def human_seat_index(self, seed: int) -> int
    #       Which seat a solo human occupies against bots. Default 0.
    #
    #   def bot_display_names(self, seed: int, count: int) -> tuple[str, ...]
    #       Distinct human-facing names for this match's bot seats. Default is
    #       `bots.bot_display_name` ("PEAK3 Bot", numbered past two seats).
    #
    #   def bot_think_seconds(self, seed: int, seat_index: int, turn_seq: int) -> float
    #       How long a bot appears to deliberate. Default `BOT_THINK_SECONDS`.


def human_seat_for(mode: ArenaMode, seed: int) -> int:
    """Which seat a solo human takes in a bot-filled match of `mode`.

    Clamped into range here rather than trusted, so a mode returning a seat
    that does not exist produces the first seat instead of an IndexError deep
    inside match creation.
    """
    hook = getattr(mode, "human_seat_index", None)
    if hook is None:
        return 0
    try:
        index = int(hook(seed))
    except Exception:  # pragma: no cover - a broken hook must not block play
        return 0
    return index if 0 <= index < mode.seat_count else 0


class ModeNotRegistered(KeyError):
    """No mode module is registered under that name.

    A distinct type rather than a bare KeyError so a route can answer 404
    `unknown_mode` without catching every KeyError a reducer might raise.
    """


class ModeRegistry:
    """The set of modes this process can serve.

    Registration is explicit and happens at import of the mode's own module --
    there is no filesystem scan and no entry-point discovery, because a mode
    appearing because a file was copied into a directory is a deployment
    surprise rather than a feature.
    """

    def __init__(self) -> None:
        self._modes: dict[str, ArenaMode] = {}

    def register(self, mode: ArenaMode) -> None:
        existing = self._modes.get(mode.mode)
        if existing is not None and existing is not mode:
            # Refused rather than overwritten: two modules claiming one name is
            # a bug in whichever imported second, and silently taking the last
            # writer would make which rules ran depend on import order.
            raise ValueError(
                f"mode {mode.mode!r} is already registered by {type(existing).__name__}"
            )
        self._modes[mode.mode] = mode

    def get(self, mode: str) -> ArenaMode:
        try:
            return self._modes[mode]
        except KeyError:
            raise ModeNotRegistered(mode) from None

    def has(self, mode: str) -> bool:
        return mode in self._modes

    def names(self) -> tuple[str, ...]:
        return tuple(sorted(self._modes))

    def clear(self) -> None:
        """Test seam only. Never called by application code."""
        self._modes.clear()


#: The process-wide registry. One instance, mirroring `dataset_store`'s shape.
registry = ModeRegistry()


def mode_rng(seed: int, stream: str) -> random.Random:
    """A `random.Random` for one named stream of one match.

    ONE GENERATOR PER NAMED STREAM, keyed by a descriptive string, so adding a
    new stream cannot shift the numbers an existing one produces. Copied
    directly from `nba_peak/run_the_table/generation.py:45-46`, whose module
    docstring gives the full argument -- and which is why an RTT seed still
    produces the same board after new generation code was added.
    """
    return random.Random(f"arena:{seed}:{stream}")


def initial_turn_seat(mode: ArenaMode, snapshot: dict) -> Optional[int]:
    """Which seat the FIRST turn of a match belongs to.

    OPTIONAL PART OF THE CONTRACT, resolved here rather than required of every
    mode. A mode that opens on seat 0 -- Three-Man Weave, whose snake order
    starts at A -- needs to say nothing. A mode whose first actor is decided by
    the seed implements `initial_turn_seat(snapshot)` and returns it.

    This function exists because `matchmaking._open_play` used to hardcode
    `seat_index=0`. For The $20 Showdown that was wrong half the time: the
    opening bidder is drawn from the match seed, so the rules could say seat 1
    must act while the clock belonged to seat 0 -- a seat with no legal move
    holding a deadline, and an opener with a legal move holding none. Neither
    player could act, and the turn expired against the wrong person.

    A mode returning None means "no seat in particular", which the foundation
    stores as a simultaneous turn.
    """
    hook = getattr(mode, "initial_turn_seat", None)
    if hook is None:
        return 0
    return hook(snapshot)


def turn_deadline(mode: ArenaMode, opened_at) -> TurnDraft:
    """Helper for the common 'open the next turn for this seat' case.

    Exists so `deadline_at` is always `opened_at + mode.turn_seconds` computed
    in one place. A mode that computed its own could ship a turn whose deadline
    is in the past, which `arena_turns_deadline_after_open` would reject at the
    database -- a 500 rather than a playable game.
    """
    from datetime import timedelta

    return TurnDraft(
        phase=mode.initial_phase(),
        deadline_at=opened_at + timedelta(seconds=mode.turn_seconds),
    )
