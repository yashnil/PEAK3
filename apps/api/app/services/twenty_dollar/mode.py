"""The $20 Showdown, plugged into the Arena foundation.

A TRANSLATION LAYER AND NOTHING ELSE. Every rule lives in
`nba_peak/twenty_dollar/`, which has no dependency on FastAPI, on the
repositories, or on this package. This module's whole job is to turn a
`ReducerInput` into a call on that package and its answer back into a
`ReducerOutput`.

That split is deliberate. The rules are testable without a database, a match or
an event loop, and this file stays small enough to read in one sitting, which
matters because it is where a mistake would be an integration bug rather than a
rules bug.

WHY THIS FILE IS NOT IN `app/services/arena/`. That package is the foundation's:
the mode contract, the clock, the bot driver, matchmaking. Keeping every mode in
its own package instead means ownership is legible from the path rather than
from a filename convention, and it matches `app/services/perfect_season/`.

THE FOUR THINGS THIS FILE MUST GET RIGHT
-----------------------------------------
1. PROJECTION. `project` forwards `state.project`, which is a positive
   allowlist. Nothing here re-derives or re-adds a field, because a second
   place that builds a payload is a second place a hidden score can escape.

2. PER-SEAT TURNS. Every accepted action resolves the open turn and opens a new
   one NAMING THE SEAT THAT MUST ACT NEXT, with a deadline of `now +
   turn_seconds`. That is what makes the clock fair, and it is the direct fix
   for the reported defect where a lot advanced before the player had a usable
   window: v1 opened ONE simultaneous turn per round whose deadline had been
   running since before the client rendered, and whose expiry passed BOTH
   seats. Here a deadline exists only for the seat on the clock and starts when
   that seat's turn is created.

3. EVENT VISIBILITY. A bid is public the instant it is made -- this is an open
   outcry auction -- so `bid_placed` is a public event carrying the amount.
   What is never written to the log before its lot resolves is the candidate's
   score; events are persisted and replayable, so a leak there would outlive
   every projection that hides it.

4. PURITY. No I/O, no clock reads, no mutation of the input. The pool is warmed
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
    ArenaMatch,
    ArenaSeat,
    EventDraft,
    ReducerInput,
    ReducerOutput,
    ResultDraft,
    TurnDraft,
)
from app.services.arena import bots as bot_service
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
#: point 4 -- a reducer must never be the thing that pays for a file read.
rules_state.warm_pool()

REJECT_UNKNOWN_COMMAND = "unknown_command"
REJECT_NO_SEAT = "not_your_seat"

EVENT_BID_PLACED = "bid_placed"
EVENT_PASSED = "seat_passed"
EVENT_LOT_RESOLVED = "lot_resolved"
EVENT_MATCH_COMPLETED = "match_completed"


class TwentyDollarMode:
    """`ArenaMode` for the two-player ascending auction."""

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
        return rules_state.PHASE_AUCTION

    # -- opening state ------------------------------------------------------

    def initial_snapshot(self, seed: int, seats: tuple[ArenaSeat, ...]) -> dict:
        """A pure function of `(seed, seats)`.

        `seats` is used only for its length. Nothing about WHO is seated may
        reach the board: a match whose candidates depended on the occupants
        would not be reproducible from its seed, which is the property the
        whole foundation is built on.
        """
        return rules_state.initial_state(int(seed), len(seats) or SEAT_COUNT)

    def initial_turn_seat(self, snapshot: dict) -> Optional[int]:
        """Which seat the FIRST turn belongs to.

        The opening bidder is drawn from the match seed (brief rule 4), so it
        is not always seat 0 -- and the foundation used to hardcode seat 0 when
        opening play. That mismatch meant seat 1 could be the opener according
        to the rules while the clock belonged to seat 0, which is exactly how a
        player ends up watching a turn they were never given expire.
        """
        return snapshot.get("active_seat")

    # -- the rules ----------------------------------------------------------

    def reduce(self, data: ReducerInput) -> ReducerOutput:
        snapshot = copy.deepcopy(data.match.snapshot or {})
        if not snapshot:
            snapshot = self.initial_snapshot(data.match.seed, data.seats)

        try:
            rules_state.assert_supported_version(snapshot)
        except rules_state.RulesetVersionMismatch as exc:
            # Refused rather than reinterpreted: a v1 sealed-bid snapshot has
            # no active seat and a tie token this ruleset does not honour.
            return ReducerOutput(
                accepted=False,
                rejection_code=rules_state.REJECT_VERSION_MISMATCH,
                rejection_message=str(exc),
            )

        if snapshot.get("phase") == rules_state.PHASE_COMPLETE:
            return ReducerOutput(
                accepted=False,
                rejection_code="match_over",
                rejection_message="This match has already finished.",
            )

        command = data.command
        before = len(snapshot.get("history") or [])

        if command.command_type == COMMAND_TYPE_TIMEOUT:
            actor = snapshot.get("active_seat")
            snapshot = rules_state.timeout_active_seat(snapshot)
            events: list[EventDraft] = [
                EventDraft(
                    event_type=EVENT_PASSED,
                    payload={"seat_index": actor, "timed_out": True},
                    actor_seat_index=actor,
                    visibility=VISIBILITY_PUBLIC,
                )
            ]
            return self._finish(snapshot, data, events, before, timed_out=True)

        seat_index = command.actor_seat_index
        if seat_index is None or not (0 <= seat_index < len(snapshot["seats"])):
            return ReducerOutput(
                accepted=False,
                rejection_code=REJECT_NO_SEAT,
                rejection_message="You do not hold a seat in this match.",
            )

        if command.command_type == rules_state.COMMAND_PASS:
            amount: object = 0
        elif command.command_type == rules_state.COMMAND_BID:
            amount = (command.payload or {}).get("amount", 0)
        else:
            return ReducerOutput(
                accepted=False,
                rejection_code=REJECT_UNKNOWN_COMMAND,
                rejection_message=f"{command.command_type!r} is not a move in this mode.",
            )

        snapshot, code, message = rules_state.submit_action(
            snapshot, seat_index, command.command_type, amount
        )
        if code is not None:
            # A rejected command writes nothing and does not advance the state
            # version -- one client's bad bid must not invalidate the other's
            # cached view, and must not move anybody's clock.
            return ReducerOutput(
                accepted=False, rejection_code=code, rejection_message=message
            )

        if command.command_type == rules_state.COMMAND_BID:
            events = [
                EventDraft(
                    event_type=EVENT_BID_PLACED,
                    # THE AMOUNT IS PUBLIC. An open outcry auction where the
                    # standing bid were secret would be a different game, and
                    # the opponent has to see it to answer it.
                    payload={"seat_index": seat_index, "amount": int(amount)},
                    actor_seat_index=seat_index,
                    visibility=VISIBILITY_PUBLIC,
                )
            ]
        else:
            events = [
                EventDraft(
                    event_type=EVENT_PASSED,
                    payload={"seat_index": seat_index, "timed_out": False},
                    actor_seat_index=seat_index,
                    visibility=VISIBILITY_PUBLIC,
                )
            ]

        return self._finish(snapshot, data, events, before, timed_out=False)

    # -- turn plumbing ------------------------------------------------------

    def _finish(
        self,
        snapshot: dict,
        data: ReducerInput,
        events: list[EventDraft],
        history_before: int,
        *,
        timed_out: bool,
    ) -> ReducerOutput:
        """Emit any lot that settled, then hand the clock to the next seat."""
        settled = (snapshot.get("history") or [])[history_before:]
        for record in settled:
            events.append(
                EventDraft(
                    event_type=EVENT_LOT_RESOLVED,
                    # Public in full: once a lot is settled the amounts and the
                    # card ARE the result, and hiding them would make the
                    # receipt unverifiable.
                    payload=dict(record),
                    visibility=VISIBILITY_PUBLIC,
                )
            )

        resolution = TURN_RESOLUTION_TIMEOUT if timed_out else TURN_RESOLUTION_ACTION

        if rules_state.is_complete(snapshot):
            return self._complete(snapshot, data, events, resolution)

        return ReducerOutput(
            accepted=True,
            snapshot=snapshot,
            events=tuple(events),
            resolve_turn=resolution,
            open_turn=TurnDraft(
                phase=rules_state.PHASE_AUCTION,
                # NAMED SEAT, NEW DEADLINE. The seat that must act next gets a
                # full `turn_seconds` measured from this instant, and no other
                # seat is on a clock at all. `project_seat_view` therefore
                # reports `seconds_remaining` to exactly one seat, and a
                # timeout can only ever pass that seat.
                seat_index=snapshot.get("active_seat"),
                deadline_at=data.now + timedelta(seconds=self.turn_seconds),
            ),
        )

    def _complete(
        self,
        snapshot: dict,
        data: ReducerInput,
        events: list[EventDraft],
        resolution: str,
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
                event_type=EVENT_MATCH_COMPLETED,
                payload={"receipt": built},
                visibility=VISIBILITY_PUBLIC,
            )
        )
        return ReducerOutput(
            accepted=True,
            snapshot=snapshot,
            events=tuple(events),
            resolve_turn=resolution,
            open_turn=None,
            status=MATCH_STATUS_COMPLETED,
            results=tuple(results),
        )

    # -- player imagery ------------------------------------------------------

    @staticmethod
    def _headshot(player_slug: str) -> Optional[str]:
        """This identity's photograph URL, or None.

        THE SAME PIPELINE 82-0 USES, not a second one: the committed manifest
        `data/game/assets/player_assets.v3.json`, read through
        `perfect_season.assets.get_player_headshot_url`, keyed on the same
        `player_slug` this mode already speaks, and behind the same
        `ENABLE_EXTERNAL_ASSET_URLS` gate. A mode that resolved its own images
        would be a second source of truth for the one thing the licensing gate
        exists to control.

        None is an ordinary answer, not an error. The manifest resolves 125 of
        the 500 identities this mode can offer (25.0%) -- resolution needs a
        current roster entry, so historical players are largely absent -- and
        `PlayerAvatar` draws its medallion for the rest in exactly the same box,
        so a missing photograph costs no layout.
        """
        from app.core.config import settings

        if not settings.ENABLE_EXTERNAL_ASSET_URLS:
            return None
        from nba_peak.perfect_season.assets import get_player_headshot_url

        return get_player_headshot_url(player_slug)

    def _add_imagery(self, public: dict) -> dict:
        """Attach `headshot_url` to every identity in an already-built
        projection, and to nothing else.

        DELIBERATELY A POST-PASS AT THE FOUNDATION BOUNDARY, not a change to
        `state.project`. The rules package is pure -- no I/O, no settings read --
        and the licensing gate lives in `app.core.config`; threading a flag into
        the state machine so it could look up a file would give the pure module
        both. This walks the keys the allowlist already emitted and adds one
        field per identity, so it can add nothing the projection did not already
        publish and cannot become a second place a snapshot field reaches a
        client by default.

        NO SCORE CROSSES HERE. The only key written is `headshot_url`, on the
        live candidate, on rostered players (whose price and score are public
        the moment a lot settles), on settled history lots and on the receipt.
        The live candidate keeps exactly the identity fields
        `Candidate.public_dict` allowed.

        History records are rebuilt rather than mutated: `state.project`
        shallow-copies them, so their nested `candidate` dict is still the one
        inside the stored snapshot.
        """
        candidate = public.get("candidate")
        if candidate:
            candidate["headshot_url"] = self._headshot(candidate["player_slug"])

        for seat in public.get("seats") or []:
            for entry in seat.get("roster") or []:
                entry["headshot_url"] = self._headshot(entry["player_slug"])

        history = public.get("history") or []
        public["history"] = [
            {
                **record,
                "candidate": {
                    **record["candidate"],
                    "headshot_url": self._headshot(record["candidate"]["player_slug"]),
                },
            }
            if record.get("candidate")
            else record
            for record in history
        ]

        receipt = public.get("receipt")
        if receipt:
            for seat_report in receipt.get("seats") or []:
                for entry in seat_report.get("roster") or []:
                    entry["headshot_url"] = self._headshot(entry["player_slug"])

        return public

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
        public["seat_is_bot"] = [seat.is_bot for seat in seats]

        # A COARSE TIER, FOR BOT SEATS ONLY.
        #
        # A human bidder brings knowledge the projection cannot carry -- they
        # know roughly where a candidate sits among all-time peaks. A bot has
        # none, so without some proxy it either bids the same for everyone or
        # has to be given the hidden score, and the second of those would make
        # the auction unwinnable rather than merely hard.
        #
        # What crosses is the three-band draw label (`1-100` / `101-250` /
        # `251-500`) the lot was already drawn from. It cannot rank two players
        # inside a band, so between two top-100 peaks the bot is guessing
        # exactly as a casual human would; and it is added HERE, at the
        # foundation boundary where seat occupancy is known, rather than in
        # `state.project`, so the rules package has no code path that could
        # give it to a person.
        seat = next((s for s in seats if s.seat_index == seat_index), None)
        if seat is not None and seat.is_bot:
            private["candidate_tier"] = snapshot.get("current_candidate_tier")
        if match.status == MATCH_STATUS_COMPLETED:
            # The receipt is built from the same settled snapshot the results
            # rows came from, so the two cannot disagree.
            public["receipt"] = receipt_builder.build(snapshot)
        # LAST, so it decorates the receipt too and so nothing after it can
        # add a key it has not seen.
        return self._add_imagery(public), private, commands


mode = TwentyDollarMode()
bot = TwentyDollarBot()

registry.register(mode)

#: REGISTERED HERE, beside the mode. `bots.registry.default_for` falls back to
#: `RandomLegalBot` when a mode has no policy, and that baseline emits an EMPTY
#: payload -- which this mode's reducer can only read as a pass. The policy
#: existed in v1 and was never registered, so every bot seat passed on every
#: lot. That is the defect; this line is the fix, and
#: `test_arena_twenty_dollar.py` asserts the resolved policy is this object.
bot_service.registry.register(bot, for_modes=(MODE_ID,))

__all__ = ["TwentyDollarMode", "mode", "bot"]
