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
    BOT_THINK_KIND_ORDINARY,
    MODE_ID,
    MODEL_VERSION,
    RULESET_VERSION,
    SEAT_COUNT,
    TURN_SECONDS,
    bot_think_seconds,
    rank_band,
)

#: Warm the committed candidate pool at import. See the module docstring's
#: point 4 -- a reducer must never be the thing that pays for a file read.
rules_state.warm_pool()

REJECT_UNKNOWN_COMMAND = "unknown_command"
REJECT_NO_SEAT = "not_your_seat"
REJECT_NOT_INTRO = "no_intro_open"
REJECT_SHARED_TIMELINE = "shared_timeline"
REJECT_NOT_YOUR_TURN = "not_your_turn"

#: THE PRE-MATCH INTRO, AS A REAL SERVER TURN.
#:
#: THE DEFECT. The room showed a competitive intro -- who you are playing, what
#: a market skip is, what the budget is -- as a client-side beat, while the
#: server had already stamped the first lot's 25-second deadline. So the intro
#: was spending the player's own decision clock to tell them the rules, and the
#: client could only paper over it: `affordableBeat` truncates or skips the
#: intro whenever the human's remaining window would drop below
#: `MIN_DECISION_SECONDS`. That is an honest workaround for a clock the client
#: does not own, and it means the intro is shortest exactly when the player is
#: newest to the mode.
#:
#: THE FIX IS THE ONE THREE-MAN WEAVE ALREADY USES for its franchise x decade
#: ceremony: a real turn, in its own phase, belonging to NO seat and accepting
#: no action from anybody. When it ends -- by its own deadline or because a
#: player skipped it -- the first auction turn is opened with a FULL
#: `TURN_SECONDS` measured from that instant. The intro therefore costs the
#: player nothing at all, plays identically for both seats, and reconstructs
#: correctly on reload because it is state rather than an animation a client
#: happens to be part-way through.
PHASE_INTRO = "intro"

#: How long the intro holds. Long enough to read four lines, per the pass's
#: "approximately 4-5 seconds"; skippable from the first frame.
INTRO_SECONDS = 4.5

#: End the intro early. See `_open_first_lot`.
COMMAND_SKIP_INTRO = "showdown_skip_intro"

#: THE ARRIVAL PHASE -- the ONLY phase a match opens on (game-feel pass 4).
#:
#: The intro's 4.5 s clock used to start at match creation, so a client that
#: reached the match late watched the intro partly spent, or never saw it. As
#: in Three-Man Weave and the Prime modes, a match now opens in a seatless
#: `arrival` turn: the intro is on screen, its clock waits, each HUMAN seat's
#: client reports `showdown_intro_seen` after rendering it (a bot seat is
#: already there), and the intro's own turn opens when the last human has --
#: from that instant. The backstop opens the INTRO, never a lot.
PHASE_ARRIVAL = "arrival"
ARRIVAL_BACKSTOP_SECONDS = 20.0
COMMAND_INTRO_SEEN = "showdown_intro_seen"
EVENT_INTRO_SEEN = "showdown_intro_seen"
REJECT_INTRO_STARTED = "intro_already_started"
REJECT_INTRO_ALREADY_SEEN = "intro_already_seen"

#: THE "NOBODY CAN USE THIS CANDIDATE" BEAT, AS A REAL SERVER TURN.
#:
#: THE BUG THIS FIXES (phantom settled lots). The market draws from all 500
#: qualified players regardless of either roster, so a candidate neither seat
#: can legally acquire is common, not rare, once rosters start filling
#: position needs. `nba_peak.twenty_dollar.state._advance_lot` used to settle
#: that candidate as unsold INSIDE THE SAME CALL that drew it -- so
#: `current_candidate` was set and cleared again before this file, or any
#: client poll, ever had a chance to observe it. A player reporting a star
#: appearing in "Settled Lots" that they never saw live and never had a
#: chance to bid on was reporting exactly that, correctly, every time.
#:
#: THE FIX IS THE SAME PATTERN `PHASE_INTRO` ALREADY ESTABLISHES: a real turn,
#: in its own phase, belonging to NO seat, accepting no action from anybody,
#: that resolves only on its own (short) deadline. `_advance_lot` now stops
#: instead of resolving inline (`rules_state.is_unwinnable_lot_pending`), this
#: phase surfaces that exact candidate as `current_candidate` for a genuine,
#: externally observable beat, and only ITS OWN timeout actually settles it
#: (`_resolve_unwinnable_lot`, calling `rules_state.resolve_unwinnable_lot`).
#: The candidate was always going to be unsold -- nobody could ever have bid
#: on it, by the rules -- but now every settled lot in history corresponds to
#: a state the client actually had the opportunity to observe as current,
#: which is the literal invariant this fixes.
PHASE_LOT_UNWINNABLE = "lot_unwinnable"

#: Short on purpose: nobody is deciding anything during this beat, so it
#: should not cost either player real time, but it has to be long enough that
#: an ordinary poll cadence can actually land inside it at least once.
LOT_UNWINNABLE_SECONDS = 1.6

#: THE "NO OTHER ROSTER COULD EVER CONTEST THIS" BEAT, AS A REAL SERVER TURN.
#: `PHASE_LOT_UNWINNABLE`'s own sibling, for `rules_state.LOT_KIND_
#: FORCED_FILL` rather than for a candidate nobody at all could use. The
#: Pass 1 brief's fix for the "$20 Showdown becomes a near-free acquisition"
#: defect is `nba_peak.twenty_dollar.state._park_forced_fill`: normal lots now
#: draw from the INTERSECTION of every still-incomplete seat's legal wins, and
#: the moment that intersection is empty while something is still winnable by
#: SOMEONE, one stranded position settles outside the ordinary bid/raise
#: auction rather than opening as a lot only one side could ever act on.
#:
#: THIS PHASE EXISTS FOR THE SAME REASON `PHASE_LOT_UNWINNABLE` DOES: an
#: earlier version of `_park_forced_fill` committed the assignment inline, the
#: instant the intersection was found empty -- which is the phantom-lot bug
#: again, reopened (`tests/twenty_dollar/test_phantom_lot_fix.py` caught it:
#: a player settled `forced_fill` in history without ever being observed as
#: `current_candidate` on any read). The fix is the identical pattern: a real
#: turn, in its own phase, belonging to no seat, accepting no action from
#: anybody, that resolves only on its own (short) deadline
#: (`_resolve_forced_fill`, calling `rules_state.resolve_forced_fill`).
PHASE_LOT_FORCED_FILL = "lot_forced_fill"

#: Short for the same reason `LOT_UNWINNABLE_SECONDS` is: nobody is deciding
#: anything, so this should not cost either player real time, but has to be
#: long enough that an ordinary poll cadence can land inside it at least once.
LOT_FORCED_FILL_SECONDS = 1.6

EVENT_BID_PLACED = "bid_placed"
EVENT_PASSED = "seat_passed"
EVENT_LOT_RESOLVED = "lot_resolved"
EVENT_MATCH_COMPLETED = "match_completed"
EVENT_FORFEIT = "seat_forfeited"

#: Concede the match. See `_forfeit`.
COMMAND_FORFEIT = "showdown_forfeit"


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
        """A match opens on ARRIVAL, then the intro, never a live lot. See
        `PHASE_ARRIVAL` and `PHASE_INTRO`."""
        return PHASE_ARRIVAL

    def phase_seconds(self, phase: str) -> float:
        """How long a turn in this phase lasts.

        The intro is not a decision, so it does not get the decision window.
        Matchmaking opens the first turn and reads this hook; every later turn
        is opened by `_finish` with `turn_seconds`.
        """
        if phase == PHASE_ARRIVAL:
            return ARRIVAL_BACKSTOP_SECONDS
        return INTRO_SECONDS if phase == PHASE_INTRO else self.turn_seconds

    def bot_think_seconds(
        self,
        seed: int,
        seat_index: int,
        turn_seq: int,
        snapshot: Optional[dict] = None,
    ) -> float:
        """How long the bot seat appears to deliberate before its move lands.

        CALCULATE FIRST, PRESENT SECOND. The move itself is already decided
        by the policy from the board; this only chooses how long the reply
        waits to LAND, so it reads as another bidder and not as a function
        call. The wait is a function of the KIND of decision (see
        `TwentyDollarBot.decision_kind` and `config.BOT_THINK_RANGES`): an
        obvious raise lands after a short beat, a pass is considered rather
        than snapped, a call right at the bot's ceiling often takes a long
        one, and a bidding war accelerates the longer it runs.

        `snapshot` is the match's stored state, passed by the foundation's
        driver (`bots.bot_think_seconds_for`) when the hook accepts it. From it
        the bot's OWN projection is rebuilt -- exactly the dicts `choose` will
        see, band included -- so the classification and the decision agree.
        Without a snapshot (an older caller) the ordinary range applies.

        Presentation only. The foundation enforces the result against the
        turn's stored `opened_at`, so every poller agrees on when the move
        lands and a fast client cannot hurry it along.
        """
        kind = BOT_THINK_KIND_ORDINARY
        war_depth = 0
        if snapshot:
            try:
                public, private, _ = rules_state.project(snapshot, seat_index)
                private = self._bot_private(snapshot, private)
                kind = bot.decision_kind(public, private)
                war_depth = bot.war_depth(public)
            except Exception:  # pragma: no cover - presentation must not wedge a turn
                kind, war_depth = BOT_THINK_KIND_ORDINARY, 0
        return bot_think_seconds(seed, seat_index, turn_seq, kind, war_depth=war_depth)

    @staticmethod
    def _bot_private(snapshot: dict, private: dict) -> dict:
        """The two coarse quality hints a BOT seat -- and only a bot seat --
        is told about the live candidate. See `project`."""
        private["candidate_tier"] = snapshot.get("current_candidate_tier")
        slug = snapshot.get("current_candidate")
        if slug:
            pool = rules_state.warm_pool()
            if pool.has(slug):
                private["candidate_band"] = rank_band(pool.get(slug).rank)
        return private

    def phase_accepts_action(self, phase: str) -> bool:
        """Whether a seat -- human or bot -- may play on a turn in this phase.

        Read by `arena.bots.drive_pending_bots`. Without it the driver reads
        the intro's `seat_index is None` as a SIMULTANEOUS turn and lets the bot
        bid underneath an intro nobody has finished reading. `PHASE_LOT_
        UNWINNABLE` and `PHASE_LOT_FORCED_FILL` are the same shape of turn for
        the same reason: both belong to no seat, and a bot must not "act" on
        a beat where nobody -- bot or human -- has anything to decide.
        """
        return phase not in (PHASE_ARRIVAL, PHASE_INTRO, PHASE_LOT_UNWINNABLE, PHASE_LOT_FORCED_FILL)

    # -- opening state ------------------------------------------------------

    def initial_snapshot(self, seed: int, seats: tuple[ArenaSeat, ...]) -> dict:
        """A pure function of `(seed, seats)`.

        `seats` is used only for its length. Nothing about WHO is seated may
        reach the board: a match whose candidates depended on the occupants
        would not be reproducible from its seed, which is the property the
        whole foundation is built on.
        """
        state = rules_state.initial_state(int(seed), len(seats) or SEAT_COUNT)
        # ARRIVAL BOOKKEEPING, removed when the intro opens (`_open_intro`).
        state["arrival_open"] = True
        state["arrived_seats"] = []
        return state

    def initial_turn_seat(self, snapshot: dict) -> Optional[int]:
        """Which seat the FIRST turn belongs to: NOBODY.

        The match opens on the intro (`PHASE_INTRO`), which belongs to no seat
        -- which is also what makes the foundation publish `seconds_remaining`
        to BOTH participants, correct here because both are watching the same
        intro.

        The opening bidder is still drawn from the match seed (brief rule 4)
        and is still `snapshot["active_seat"]`; `_open_first_lot` hands the
        clock to exactly that seat when the intro ends. The foundation used to
        hardcode seat 0 when opening play, which meant seat 1 could be the
        opener according to the rules while the clock belonged to seat 0 -- a
        player watching a turn they were never given expire. That is why the
        first auction turn is seated from the snapshot rather than from a
        constant, and it remains so.
        """
        return None

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
        in_intro = data.open_turn is not None and data.open_turn.phase == PHASE_INTRO
        in_arrival = data.open_turn is not None and data.open_turn.phase == PHASE_ARRIVAL
        in_unwinnable_beat = (
            data.open_turn is not None and data.open_turn.phase == PHASE_LOT_UNWINNABLE
        )
        in_forced_fill_beat = (
            data.open_turn is not None and data.open_turn.phase == PHASE_LOT_FORCED_FILL
        )

        if command.command_type == COMMAND_TYPE_TIMEOUT and in_arrival:
            # THE BACKSTOP: a human never reported. The INTRO opens, in full.
            return self._open_intro(snapshot, data, TURN_RESOLUTION_TIMEOUT, ())

        if command.command_type == COMMAND_TYPE_TIMEOUT:
            # A TIMEOUT ON THE INTRO IS NOT A PASS -- it is the intro ending.
            # Handled before the pass path, which would otherwise burn the
            # opening seat's first action for standing still through a beat
            # they were never on the clock for.
            if in_intro:
                return self._open_first_lot(snapshot, data)
            # A TIMEOUT ON THE "NOBODY CAN USE THIS CANDIDATE" BEAT IS ALSO
            # NOT A PASS -- there is no seat to pass. It is that beat ending,
            # which is what actually settles the lot (the phantom-lot fix).
            if in_unwinnable_beat:
                return self._resolve_unwinnable_lot(snapshot, data)
            # SAME SHAPE, FOR A FORCED-FILL PARK: not a pass either -- it is
            # the beat ending, which is what actually AWARDS the stranded
            # position (see `PHASE_LOT_FORCED_FILL`'s own comment).
            if in_forced_fill_beat:
                return self._resolve_forced_fill(snapshot, data)
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

        if command.command_type == COMMAND_INTRO_SEEN:
            return self._intro_seen(snapshot, data, seat_index, in_arrival)

        if command.command_type == COMMAND_SKIP_INTRO:
            # THE INTRO IS A SHARED TIMELINE (final polish pass). Both seats
            # watch the same pre-match beat and the first lot's clock opens for
            # both at the same instant, on the intro's own deadline. One seat
            # ending it early would start the auction for a partner still
            # reading -- the same reason Three-Man Weave refuses
            # `tmw_skip_intro`. The command stays registered so an old client
            # gets a named refusal rather than a 404.
            return ReducerOutput(
                accepted=False,
                rejection_code=REJECT_SHARED_TIMELINE if in_intro else REJECT_NOT_INTRO,
                rejection_message=(
                    "The intro is shared by both seats and ends on its own clock."
                    if in_intro
                    else "There is no intro to skip."
                ),
            )

        if command.command_type == COMMAND_FORFEIT:
            return self._forfeit(snapshot, data, seat_index)

        # NOBODY BIDS UNDER THE INTRO. The bot driver is also stopped upstream
        # by `phase_accepts_action`; this is the rule itself, so a command
        # arriving by any other route is refused rather than relying on the
        # driver having been polite.
        if in_intro or in_arrival:
            return ReducerOutput(
                accepted=False,
                rejection_code=REJECT_NOT_YOUR_TURN,
                rejection_message="The match has not started yet.",
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

    # -- arrival --------------------------------------------------------------

    def _intro_seen(
        self, snapshot: dict, data: ReducerInput, seat_index: int, in_arrival: bool
    ) -> ReducerOutput:
        """A human seat's client has the intro on screen. When every human
        seat has, the intro's own clock starts now. Refused by name when the
        intro already runs or this seat already reported (replay-safe)."""
        seat = next((s for s in data.seats if s.seat_index == seat_index), None)
        if seat is None or seat.is_bot:
            return ReducerOutput(
                accepted=False, rejection_code=REJECT_NO_SEAT,
                rejection_message="Only a player's own client can report arriving.",
            )
        if not in_arrival or not snapshot.get("arrival_open"):
            return ReducerOutput(
                accepted=False, rejection_code=REJECT_INTRO_STARTED,
                rejection_message="The intro is already running.",
            )
        arrived = set(snapshot.get("arrived_seats") or [])
        if seat_index in arrived:
            return ReducerOutput(
                accepted=False, rejection_code=REJECT_INTRO_ALREADY_SEEN,
                rejection_message="The intro is already on your screen.",
            )
        arrived.add(seat_index)
        event = EventDraft(
            event_type=EVENT_INTRO_SEEN,
            payload={"seat_index": seat_index},
            actor_seat_index=seat_index,
            visibility=VISIBILITY_PUBLIC,
        )
        snapshot["arrived_seats"] = sorted(arrived)
        if {s.seat_index for s in data.seats if not s.is_bot} <= arrived:
            return self._open_intro(snapshot, data, TURN_RESOLUTION_ACTION, (event,))
        return ReducerOutput(accepted=True, snapshot=snapshot, events=(event,))

    def _open_intro(
        self, snapshot: dict, data: ReducerInput, resolution: str, events: tuple
    ) -> ReducerOutput:
        """Arrival is over: the intro opens with its full `INTRO_SECONDS` from
        now. No lot moves, no seat is charged anything."""
        snapshot.pop("arrival_open", None)
        snapshot.pop("arrived_seats", None)
        return ReducerOutput(
            accepted=True,
            snapshot=snapshot,
            events=events,
            resolve_turn=resolution,
            open_turn=TurnDraft(
                phase=PHASE_INTRO,
                seat_index=None,
                deadline_at=data.now + timedelta(seconds=INTRO_SECONDS),
            ),
        )

    # -- intro --------------------------------------------------------------

    def _open_first_lot(self, snapshot: dict, data: ReducerInput) -> ReducerOutput:
        """End the intro and hand the opening seat a FULL decision window.

        THE POINT OF THE WHOLE PHASE. `data.now` is the instant the intro ended
        -- by its own deadline or because somebody skipped it -- so the first
        lot's deadline is measured from there rather than from match creation.
        The intro therefore costs the opening bidder nothing.

        A CLOCK TRANSITION, NOT A GAME EVENT. The snapshot is returned
        unchanged: no bid, no pass, no lot advance, no event. That is what makes
        it safe to replay (the foundation's timeout key is deterministic per
        turn) and what stops a player being charged an action for a beat they
        were never on the clock for.
        """
        return ReducerOutput(
            accepted=True,
            snapshot=snapshot,
            events=(),
            resolve_turn=TURN_RESOLUTION_ACTION,
            # Almost always a normal per-seat auction turn for the opening
            # bidder (the SEED's, not seat 0 -- see `initial_turn_seat`). In
            # the edge case where the very first candidate drawn is already
            # unwinnable by both seats, `_open_turn_for_snapshot` opens the
            # seatless beat instead of a per-seat turn with no seat.
            open_turn=self._open_turn_for_snapshot(snapshot, data),
        )

    def _open_turn_for_snapshot(self, snapshot: dict, data: ReducerInput) -> TurnDraft:
        """The one place that decides what turn comes next, given a snapshot
        the rules engine has already fully advanced for the current lot.

        Centralizing this is what makes the phantom-lot fix actually hold:
        every caller that opens a turn after a rules call (`_open_first_lot`,
        `_finish`, `_resolve_unwinnable_lot`, `_resolve_forced_fill`) goes
        through here, so a candidate neither seat can act on is NEVER handed a
        normal per-seat turn (which would have no seat to belong to) and is
        ALWAYS surfaced as the short, seatless `PHASE_LOT_UNWINNABLE` beat
        instead -- and a forced-fill assignment is ALWAYS surfaced as
        `PHASE_LOT_FORCED_FILL` rather than committed silently. The two checks
        are mutually exclusive by construction (`rules_state.is_unwinnable_
        lot_pending` explicitly excludes a forced-fill park; see its own
        comment), so the order between them here does not matter -- checked in
        this order only because the unwinnable beat existed first.
        """
        if rules_state.is_unwinnable_lot_pending(snapshot):
            return TurnDraft(
                phase=PHASE_LOT_UNWINNABLE,
                seat_index=None,
                deadline_at=data.now + timedelta(seconds=LOT_UNWINNABLE_SECONDS),
            )
        if rules_state.is_forced_fill_pending(snapshot):
            return TurnDraft(
                phase=PHASE_LOT_FORCED_FILL,
                seat_index=None,
                deadline_at=data.now + timedelta(seconds=LOT_FORCED_FILL_SECONDS),
            )
        return TurnDraft(
            phase=rules_state.PHASE_AUCTION,
            seat_index=snapshot.get("active_seat"),
            deadline_at=data.now + timedelta(seconds=self.turn_seconds),
        )

    def _resolve_unwinnable_lot(self, snapshot: dict, data: ReducerInput) -> ReducerOutput:
        """The seatless `PHASE_LOT_UNWINNABLE` beat has run its own (short)
        course. Settle it unsold now -- nobody was ever on the clock for it,
        so this is not a timeout in the ordinary sense -- and open whatever
        comes next, which may itself be another unwinnable beat if the
        following draw is ALSO unusable by both rosters. That is an ordinary,
        if unlucky, sequence, not a special case: each one is still a real
        beat the client observes before it resolves.
        """
        before = len(snapshot.get("history") or [])
        snapshot = rules_state.resolve_unwinnable_lot(snapshot)
        events: list[EventDraft] = []
        for record in (snapshot.get("history") or [])[before:]:
            events.append(
                EventDraft(
                    event_type=EVENT_LOT_RESOLVED,
                    payload=dict(record),
                    visibility=VISIBILITY_PUBLIC,
                )
            )

        if rules_state.is_complete(snapshot):
            return self._complete(snapshot, data, events, TURN_RESOLUTION_TIMEOUT)

        return ReducerOutput(
            accepted=True,
            snapshot=snapshot,
            events=tuple(events),
            resolve_turn=TURN_RESOLUTION_TIMEOUT,
            open_turn=self._open_turn_for_snapshot(snapshot, data),
        )

    def _resolve_forced_fill(self, snapshot: dict, data: ReducerInput) -> ReducerOutput:
        """The seatless `PHASE_LOT_FORCED_FILL` beat has run its own (short)
        course. Award the parked assignment now -- nobody was ever on the
        clock for it, so this is not a timeout in the ordinary sense -- and
        open whatever comes next, which may itself be another forced-fill (or
        unwinnable) beat. Mirrors `_resolve_unwinnable_lot` exactly; the only
        difference is which rules-layer function actually commits.
        """
        before = len(snapshot.get("history") or [])
        snapshot = rules_state.resolve_forced_fill(snapshot)
        events: list[EventDraft] = []
        for record in (snapshot.get("history") or [])[before:]:
            events.append(
                EventDraft(
                    event_type=EVENT_LOT_RESOLVED,
                    payload=dict(record),
                    visibility=VISIBILITY_PUBLIC,
                )
            )

        if rules_state.is_complete(snapshot):
            return self._complete(snapshot, data, events, TURN_RESOLUTION_TIMEOUT)

        return ReducerOutput(
            accepted=True,
            snapshot=snapshot,
            events=tuple(events),
            resolve_turn=TURN_RESOLUTION_TIMEOUT,
            open_turn=self._open_turn_for_snapshot(snapshot, data),
        )

    # -- forfeit ------------------------------------------------------------

    def _forfeit(
        self, snapshot: dict, data: ReducerInput, seat_index: int
    ) -> ReducerOutput:
        """Concede the match. Resolves SERVER-SIDE and ends it immediately.

        WHY IT IS A COMMAND AND NOT A NAVIGATION. A player who abandons a
        Showdown mid-auction otherwise leaves the opponent watching a clock tick
        out lot after lot; and a client that merely navigated away would leave
        a live match on the server that the same player rejoins on their next
        visit. Both are the same bug -- a match whose real state is "over"
        while the server still thinks it is running.
        Because it is an ordinary command it takes the match row lock like any
        other, so it CANNOT corrupt an in-flight auction action: whichever
        arrives first runs to completion, and if the forfeit lands first the
        bid that follows finds a completed match and is refused.
        It is also why a forfeit SURVIVES A RECONNECT and can never be revived
        by a refresh: the match status is `completed` in the database, so every
        subsequent read -- from either seat, from any tab -- projects a settled
        receipt rather than a live board.

        THE RECEIPT IS THE REAL ONE. Forfeiting does not fabricate a scoreline:
        the rosters are scored exactly as they stand, so the receipt shows what
        was actually bought. Only the OUTCOME is overridden -- the conceding
        seat loses regardless of what the boards would have said -- because
        that is what conceding means.
        """
        built = receipt_builder.build(snapshot)
        results: list[ResultDraft] = []
        for seat_report in built["seats"]:
            index = seat_report["seat_index"]
            conceded = index == seat_index
            results.append(
                ResultDraft(
                    seat_index=index,
                    placement=2 if conceded else 1,
                    score=float(seat_report["roster_total"]),
                    outcome="loss" if conceded else "win",
                    detail={
                        "spent": seat_report["spent"],
                        "budget_remaining": seat_report["budget_remaining"],
                        "peak3_per_dollar": seat_report["peak3_per_dollar"],
                        "roster": seat_report["roster"],
                        "components": seat_report["components"],
                        "model_version": built["model_version"],
                        # NAMED ON THE RESULT, so the receipt can say why the
                        # match ended rather than presenting a half-built
                        # roster as if the auction had run its course.
                        "forfeited": conceded,
                    },
                )
            )

        # The snapshot records the concession so a projection built from it --
        # on reconnect, in another tab, days later -- says the same thing.
        settled = copy.deepcopy(snapshot)
        settled["phase"] = rules_state.PHASE_COMPLETE
        settled["forfeited_by"] = seat_index
        settled["active_seat"] = None

        return ReducerOutput(
            accepted=True,
            snapshot=settled,
            events=(
                EventDraft(
                    event_type=EVENT_FORFEIT,
                    payload={"seat_index": seat_index},
                    actor_seat_index=seat_index,
                    visibility=VISIBILITY_PUBLIC,
                ),
                EventDraft(
                    event_type=EVENT_MATCH_COMPLETED,
                    payload={"receipt": built, "forfeited_by": seat_index},
                    visibility=VISIBILITY_PUBLIC,
                ),
            ),
            resolve_turn=TURN_RESOLUTION_ACTION,
            open_turn=None,
            status=MATCH_STATUS_COMPLETED,
            results=tuple(results),
        )

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

        # NAMED SEAT, NEW DEADLINE -- ORDINARILY. The seat that must act next
        # gets a full `turn_seconds` measured from this instant, and no other
        # seat is on a clock at all. `project_seat_view` therefore reports
        # `seconds_remaining` to exactly one seat, and a timeout can only ever
        # pass that seat. But the rules call that produced this snapshot may
        # have advanced onto a candidate NEITHER seat can act on (the
        # phantom-lot fix) -- `_open_turn_for_snapshot` is what makes sure
        # that case gets the short seatless beat instead of a per-seat turn
        # naming no seat.
        return ReducerOutput(
            accepted=True,
            snapshot=snapshot,
            events=tuple(events),
            resolve_turn=resolution,
            open_turn=self._open_turn_for_snapshot(snapshot, data),
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
        # CONCEDING IS LEGAL FOR AS LONG AS THE MATCH IS LIVE, and is therefore
        # NOT a function of whose turn it is -- a player abandoning a match is
        # most likely to do it while waiting on somebody else. Added at the
        # foundation boundary because the rules package knows nothing about
        # match status; `_forfeit` re-checks it, so this is a hint to the
        # client and not the gate.
        seat_row = next((s for s in seats if s.seat_index == seat_index), None)
        if snapshot.get("arrival_open") and match.is_live():
            # During arrival a human seat's only move is reporting it has the
            # intro on screen (and conceding, below). No bid, no pass.
            commands = ()
            if seat_row is not None and not seat_row.is_bot and seat_index not in (snapshot.get("arrived_seats") or []):
                commands = (COMMAND_INTRO_SEEN,)
            public["arrival"] = {"arrived_seats": list(snapshot.get("arrived_seats") or [])}
        if snapshot.get("phase") != rules_state.PHASE_COMPLETE:
            commands = tuple(commands) + (COMMAND_FORFEIT,)
        # Named so a surface can say the match ended by concession rather than
        # presenting a half-built roster as a finished auction.
        public["forfeited_by"] = snapshot.get("forfeited_by")
        # Display names are the foundation's to know, not the rules package's.
        public["seat_names"] = [seat.display_name for seat in seats]
        public["seat_is_bot"] = [seat.is_bot for seat in seats]

        # A COARSE TIER AND A COARSE RANK BAND, FOR BOT SEATS ONLY.
        #
        # A human bidder brings knowledge the projection cannot carry -- they
        # know roughly where a candidate sits among all-time peaks, and the
        # rankings page is public. A bot has none, so without some proxy it
        # either bids the same for everyone or has to be given the hidden
        # score, and the second of those would make the auction unwinnable
        # rather than merely hard.
        #
        # What crosses is the three-band draw label (`1-100` / `101-250` /
        # `251-500`) the lot was drawn from, and the six-way rank band from
        # `config.BOT_RANK_BANDS`. Neither can rank two players inside a band,
        # neither is the score, and both are added HERE, at the foundation
        # boundary where seat occupancy is known, rather than in
        # `state.project`, so the rules package has no code path that could
        # give them to a person.
        seat = next((s for s in seats if s.seat_index == seat_index), None)
        if seat is not None and seat.is_bot:
            private = self._bot_private(snapshot, private)
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

__all__ = [
    "ARRIVAL_BACKSTOP_SECONDS",
    "COMMAND_INTRO_SEEN",
    "PHASE_ARRIVAL",
    "TwentyDollarMode",
    "mode",
    "bot",
]
