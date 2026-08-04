"""The $20 Showdown, plugged into the Arena foundation.

A TRANSLATION LAYER AND NOTHING ELSE. Every rule lives in
`nba_peak/twenty_dollar/`, which has no dependency on FastAPI, on the
repositories, or on this package. This module's whole job is to turn a
`ReducerInput` into a call on that package and its answer back into a
`ReducerOutput`.

That split is deliberate. The rules are testable without a database, a match or
an event loop -- 112 tests run against them in a few seconds -- and this file
stays small enough to read in one sitting, which matters because it is where a
mistake would be an integration bug rather than a rules bug.

WHY THIS FILE IS NOT IN `app/services/arena/`. That package is the foundation's:
the mode contract, the clock, the bot driver, matchmaking. Keeping every mode in
its own package instead means ownership is legible from the path rather than
from a filename convention, and it matches `app/services/perfect_season/`.

THE THREE THINGS THIS FILE MUST GET RIGHT
------------------------------------------
1. PROJECTION. `project` forwards `state.project`, which is a positive
   allowlist. Nothing here re-derives or re-adds a field, because a second
   place that builds a payload is a second place a sealed bid can escape.

2. EVENT VISIBILITY. A locked bid is written as a SEAT-VISIBLE event carrying
   no amount. Events are persisted and replayable, so a public event carrying a
   bid would leak it durably -- past the point where `project` could help.

3. PURITY. No I/O, no clock reads, no mutation of the input. The pool is warmed
   at import (`state.warm_pool`) so the first reducer call cannot pay for a
   file read while holding the match's row lock.
"""
from __future__ import annotations

import copy
from datetime import timedelta
from typing import Optional

from app.repositories.arena_protocols import (
    COMMAND_TYPE_TIMEOUT,
    MATCH_STATUS_COMPLETED,
    TURN_RESOLUTION_ACTION,
    TURN_RESOLUTION_TIMEOUT,
    VISIBILITY_PUBLIC,
    VISIBILITY_SEAT,
    ArenaMatch,
    ArenaSeat,
    EventDraft,
    ReducerInput,
    ReducerOutput,
    ResultDraft,
    TurnDraft,
)
from app.services.arena.modes import registry

from nba_peak.twenty_dollar import receipt as receipt_builder
from nba_peak.twenty_dollar import state as rules_state
from nba_peak.twenty_dollar.bot import TwentyDollarBot
from nba_peak.twenty_dollar.config import (
    MODE_ID,
    MODEL_VERSION,
    RULESET_VERSION,
    SEAT_COUNT,
    TURN_SECONDS,
)

#: Warm the committed candidate pool at import. See the module docstring's
#: point 3 -- a reducer must never be the thing that pays for a file read.
rules_state.warm_pool()

REJECT_UNKNOWN_COMMAND = "unknown_command"
REJECT_NO_SEAT = "not_your_seat"


class TwentyDollarMode:
    """`ArenaMode` for the two-player sealed-bid auction."""

    @property
    def mode(self) -> str:
        return MODE_ID

    @property
    def mode_version(self) -> str:
        return RULESET_VERSION

    @property
    def seat_count(self) -> int:
        return SEAT_COUNT

    @property
    def turn_seconds(self) -> float:
        return TURN_SECONDS

    def initial_phase(self) -> str:
        return rules_state.PHASE_BIDDING

    # -- opening state ------------------------------------------------------

    def initial_snapshot(self, seed: int, seats: tuple[ArenaSeat, ...]) -> dict:
        """A pure function of `(seed, seats)`.

        `seats` is used only for its length. Nothing about WHO is seated may
        reach the board: a match whose candidates depended on the occupants
        would not be reproducible from its seed, which is the property the
        whole foundation is built on.
        """
        return rules_state.initial_state(int(seed), len(seats) or SEAT_COUNT)

    # -- the rules ----------------------------------------------------------

    def reduce(self, data: ReducerInput) -> ReducerOutput:
        snapshot = copy.deepcopy(data.match.snapshot or {})
        if not snapshot:
            snapshot = self.initial_snapshot(data.match.seed, data.seats)

        command = data.command
        if command.command_type == COMMAND_TYPE_TIMEOUT:
            return self._resolve(snapshot, data, timed_out=True)

        seat_index = command.actor_seat_index
        if seat_index is None or not (0 <= seat_index < len(snapshot["seats"])):
            return ReducerOutput(
                accepted=False,
                rejection_code=REJECT_NO_SEAT,
                rejection_message="You do not hold a seat in this match.",
            )

        if command.command_type == rules_state.COMMAND_PASS:
            # A PASS IS EXACTLY A $0 BID, and it is converted into one right
            # here rather than handled separately. There is deliberately ONE
            # code path from this point on: two paths could disagree about what
            # passing means, and the disagreement would surface as a settled
            # auction where a pass counted as something other than zero.
            #
            # This is also why the parameter-free `pass` is a PERMANENT
            # property of the mode rather than a stopgap. `RandomLegalBot`
            # emits an empty payload (`bots.py:107-114`), and a bot degrading
            # to a legal pass is the correct failure mode whether or not this
            # mode's own policy is registered.
            amount: object = 0
        elif command.command_type == rules_state.COMMAND_BID:
            amount = (command.payload or {}).get("amount", 0)
        else:
            return ReducerOutput(
                accepted=False,
                rejection_code=REJECT_UNKNOWN_COMMAND,
                rejection_message=f"{command.command_type!r} is not a move in this mode.",
            )

        snapshot, code, message = rules_state.submit_bid(snapshot, seat_index, amount)
        if code is not None:
            # A rejected command writes nothing and does not advance the state
            # version -- one client's bad bid must not invalidate the other's
            # cached view.
            return ReducerOutput(
                accepted=False, rejection_code=code, rejection_message=message
            )

        events = [
            EventDraft(
                event_type="bid_locked",
                # NO AMOUNT. The event stream is persisted and replayable, so a
                # bid written here would outlive every projection that hides
                # it. Only the fact of locking is recorded, which is what the
                # opponent is already allowed to see.
                payload={"seat_index": seat_index},
                actor_seat_index=seat_index,
                visibility=VISIBILITY_SEAT,
                visible_to_seat=seat_index,
            )
        ]

        if rules_state.all_locked(snapshot):
            return self._resolve(snapshot, data, timed_out=False, extra_events=events)

        # The round stays open for the other seat. The turn is NOT resolved and
        # NOT reopened: a simultaneous round is one turn with one shared
        # deadline, so re-opening it here would give the slower seat a fresh
        # clock every time the faster one acted.
        return ReducerOutput(
            accepted=True, snapshot=snapshot, events=tuple(events)
        )

    # -- resolution ---------------------------------------------------------

    def _resolve(
        self,
        snapshot: dict,
        data: ReducerInput,
        *,
        timed_out: bool,
        extra_events: Optional[list[EventDraft]] = None,
    ) -> ReducerOutput:
        """Settle the current candidate and open the next round, or complete."""
        if snapshot.get("phase") == rules_state.PHASE_COMPLETE:
            return ReducerOutput(
                accepted=False,
                rejection_code="match_over",
                rejection_message="This match has already finished.",
            )

        before = len(snapshot.get("history") or [])
        snapshot = rules_state.resolve_round(snapshot)
        settled = (snapshot.get("history") or [])[before:]

        events = list(extra_events or [])
        for record in settled:
            events.append(
                EventDraft(
                    event_type="round_resolved",
                    # Public in full: once a round is settled the amounts and
                    # the card ARE the result, and hiding them would make the
                    # receipt unverifiable.
                    payload=dict(record),
                    visibility=VISIBILITY_PUBLIC,
                )
            )

        if rules_state.is_complete(snapshot):
            return self._complete(snapshot, data, events, timed_out=timed_out)

        return ReducerOutput(
            accepted=True,
            snapshot=snapshot,
            events=tuple(events),
            resolve_turn=TURN_RESOLUTION_TIMEOUT if timed_out else TURN_RESOLUTION_ACTION,
            open_turn=TurnDraft(
                phase=rules_state.PHASE_BIDDING,
                # `seat_index=None` means EVERY seat is live this turn, and
                # `project_seat_view` gives each of them the same
                # `seconds_remaining` (`arena_protocols.py:593-598`). That is
                # exactly what simultaneous sealed bidding needs, and it is why
                # this mode never opens a per-seat turn.
                seat_index=None,
                deadline_at=data.now + timedelta(seconds=self.turn_seconds),
            ),
        )

    def _complete(
        self,
        snapshot: dict,
        data: ReducerInput,
        events: list[EventDraft],
        *,
        timed_out: bool,
    ) -> ReducerOutput:
        built = receipt_builder.build(snapshot)
        settlement = built.get("settlement") or {}
        winner = settlement.get("winner_seat")

        results: list[ResultDraft] = []
        for seat_report in built["seats"]:
            index = seat_report["seat_index"]
            if winner is None:
                placement, outcome = 1, "draw"
            elif index == winner:
                placement, outcome = 1, "win"
            else:
                placement, outcome = 2, "loss"
            results.append(
                ResultDraft(
                    seat_index=index,
                    placement=placement,
                    score=float(seat_report["roster_total"]),
                    outcome=outcome,
                    detail={
                        "spent": seat_report["spent"],
                        "budget_remaining": seat_report["budget_remaining"],
                        "peak3_per_dollar": seat_report["peak3_per_dollar"],
                        "roster": seat_report["roster"],
                        "components": seat_report["components"],
                        # Carried onto the result so a settled match records
                        # which scoring model produced its numbers, rather than
                        # inheriting whatever the default is when it is read.
                        "model_version": built["model_version"],
                    },
                )
            )

        events.append(
            EventDraft(
                event_type="match_completed",
                payload={"receipt": built},
                visibility=VISIBILITY_PUBLIC,
            )
        )
        return ReducerOutput(
            accepted=True,
            snapshot=snapshot,
            events=tuple(events),
            resolve_turn=TURN_RESOLUTION_TIMEOUT if timed_out else TURN_RESOLUTION_ACTION,
            open_turn=None,
            status=MATCH_STATUS_COMPLETED,
            results=tuple(results),
        )

    # -- the hidden-information boundary ------------------------------------

    def project(
        self, match: ArenaMatch, seats: tuple[ArenaSeat, ...], seat_index: int
    ) -> tuple[dict, dict, tuple[str, ...]]:
        """Forward to the rules package's own allowlist projection.

        Deliberately a forward and not a re-implementation. `state.project`
        names every key it emits; adding a second builder here would be a
        second place a newly-added snapshot field could reach a client by
        default, which is the failure mode the whole contract exists to invert.
        """
        snapshot = match.snapshot or self.initial_snapshot(match.seed, seats)
        public, private, commands = rules_state.project(snapshot, seat_index)
        # Display names are the foundation's to know, not the rules package's.
        public["seat_names"] = [seat.display_name for seat in seats]
        return public, private, commands


mode = TwentyDollarMode()
bot = TwentyDollarBot()

registry.register(mode)

__all__ = ["TwentyDollarMode", "mode", "bot"]
