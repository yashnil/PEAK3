"""THREE-MAN WEAVE as an `ArenaMode` plug-in.

THIS MODULE IS AN ADAPTER AND NOTHING ELSE. Every rule lives in
`nba_peak/three_man_weave/`, which is a pure library with no database, no
FastAPI and no clock. This file translates between that library and the Arena
foundation's contract (`app/services/arena/modes.py`), and holds no game logic
of its own. It deliberately lives outside `app/services/arena/`, which is
mode-agnostic and owned by the foundation.

THE HIDDEN-INFORMATION BOUNDARY: FUTURE ROLLS DO NOT EXIST YET
---------------------------------------------------------------
`project` must not show any seat a future franchise x decade roll -- that is
this mode's equivalent of an unrevealed sealed bid. The design makes the leak
impossible rather than merely forbidden: a roll is not pre-generated and then
hidden, it is **not determined until the round opens**.

That falls out of the rules rather than being a defensive choice. Roll
feasibility depends on the live draft state -- who has already been taken,
which slots each seat still has open, whether all three rosters can still be
completed -- so a round-6 roll cannot be computed at match creation even in
principle. The snapshot therefore holds exactly one roll (the current one) and
the ids of those already used. There is no future-roll field to leak, forget
to strip, or accidentally serialise.

Determinism survives intact: each roll is drawn from
`stream_rng(seed, f"roll:{round_number}")` against the state at that moment, so
replaying the same commands reproduces the same rolls.

TMW HAS NO PER-SEAT SECRETS
----------------------------
A draft is open information: every pick is visible to everyone the instant it
is made. `private_state` therefore carries only this seat's own convenience
derivations (its open slots, which candidates are legal FOR IT), never a fact
another seat is denied. The hidden-information boundary here is temporal, not
per-seat.

WHY THE INDEX IS WARMED AT IMPORT
----------------------------------
`MatchReducer` forbids I/O, because a reducer runs inside the match
transaction holding a row lock (`arena_protocols.py`, MatchReducer constraint
1). The eligibility index reads a parquet and a JSON on first use, so it is
built at module import -- when this mode registers -- and never lazily inside
`reduce`. Warming it here is the difference between one 0.8s load at startup
and one 0.8s load while holding a lock that every player in that match is
waiting on.
"""
from __future__ import annotations

import functools
from collections import OrderedDict
from datetime import timedelta
from typing import Optional

from app.repositories.arena_protocols import (
    COMMAND_TYPE_TIMEOUT,
    MATCH_STATUS_ACTIVE,
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

from nba_peak.franchises import franchise_display_name
from nba_peak.perfect_season.career_positions import career_positions
from nba_peak.perfect_season.exact_season import TEAM_ID_TO_NAME
from nba_peak.three_man_weave import draft as D
from nba_peak.three_man_weave import feasibility as F
from nba_peak.three_man_weave.autopick import auto_pick_options
from nba_peak.three_man_weave.bot import ThreeManWeaveBot, archetype_names
from nba_peak.three_man_weave.config import (
    COMPATIBLE_RULESET_VERSIONS,
    ELIGIBILITY_INDEX_VERSION,
    FORMULA_VERSION,
    PARTICIPANT_COUNT,
    ROUNDS,
    RULESET_VERSION,
    SLOT_TYPES,
    bot_think_seconds,
    human_seat_index,
    stream_rng,
)
from nba_peak.three_man_weave.eligibility import get_index
from nba_peak.three_man_weave.evaluation import (
    EvaluationError,
    current_edges,
    evaluate_roster,
    placements,
)
from nba_peak.three_man_weave.positions import card_starter_positions
from nba_peak.three_man_weave.variants import (
    VARIANT_DECADE,
    VARIANT_FRANCHISE,
    VARIANT_STANDARD,
    Constraint,
    choose_constraint,
    constraint_roll,
    viable_constraints,
)

MODE_NAME = "three_man_weave"
#: FRANCHISE DRAFT and DECADE DRAFT: the same game under one constraint for all
#: eighteen picks (`nba_peak.three_man_weave.variants`). Registered as their own
#: mode ids so a queue never pairs players who chose different rules and each
#: ruleset keeps its own rating ladder; the implementation is this one class.
MODE_FRANCHISE = "three_man_weave_franchise"
MODE_DECADE = "three_man_weave_decade"
VARIANT_MODE_IDS: dict[str, str] = {
    VARIANT_STANDARD: MODE_NAME,
    VARIANT_FRANCHISE: MODE_FRANCHISE,
    VARIANT_DECADE: MODE_DECADE,
}

#: How long one pick gets. Six rounds x three seats = 18 turns, so this sets
#: the worst-case match length at about 13 minutes of pure thinking time.
TURN_SECONDS = 45.0

PHASE_PICK = "pick"
#: The franchise x decade ceremony, as a REAL SERVER TURN.
#:
#: The reveal used to be a 2,270 ms client `setTimeout` that gated the pick
#: overlay while the server's 45-second deadline -- stamped when the turn
#: opened -- was already running. A player leading a round therefore lost the
#: ceremony's whole duration off a clock they could watch counting down behind
#: an overlay that would not open. The first repair simply refused to show the
#: ceremony on rounds the human led, which removed the race by removing the
#: product requirement.
#:
#: This is the honest fix. A round opens a turn in `PHASE_REVEAL`: it belongs
#: to NO seat, carries its own server deadline, and accepts no command. When it
#: expires the foundation's own sweep fires a timeout, and this mode answers it
#: by opening the pick turn with a FULL `TURN_SECONDS`. So the ceremony is
#: server-authoritative, identical for bot-led and human-led rounds, costs the
#: human nothing, and reconstructs correctly on reconnect because it is state
#: rather than an animation a client happens to be part-way through.
PHASE_REVEAL = "reveal"

#: THE CEREMONY'S LENGTH, in seconds -- ONE SHARED BEAT, EVERY ROUND.
#:
#: `clock.enforce` charges no action-grace to a turn nobody can act on, so this
#: is the whole wall-clock duration rather than a floor. It is sized for a
#: short, recurring game beat rather than a cinematic: a round card, the
#: franchise and decade reels accelerating, decelerating and locking, and a
#: hold long enough for the settled pair to be read before the pick clock
#: opens. The roll stays printed on the board and in the pick surface's own
#: header afterwards, so the hold does not have to carry the whole round.
#:
#: IT COSTS THE DRAFTER NOTHING. The reveal is its own server turn; the pick
#: turn is opened afterwards with a FULL `TURN_SECONDS` measured from the
#: moment the reveal ended (`_open_pick_turn`), so ceremony time is never
#: decision time.
#:
#: IT CANNOT BE SKIPPED, BY ANYONE. The roll is one shared fact revealed to
#: all three seats at once; a per-seat "skip" put the seats on different
#: presentations of the same turn (one player watching the reel while another
#: had already ended it for the table). The whole timeline of a match --
#: briefing, reveal, pick -- is now server-timed and identical for every
#: client; clients animate against `turn_elapsed_seconds` and never decide
#: when a phase ends. See `reduce` for the refused commands.
#:
#: 4.0, FROM 3.0 (pre-deploy polish). Three seconds held a 0.55 s round card,
#: a 1.2 s reel, a 0.3 s lock and about a second of hold, and the round card
#: was gone before it registered. The client's ceremony now spends the window
#: as: ROUND card ~1.5 s, an armed beat, the reels, a 0.4 s lock, then a hold
#: on the pair until this deadline opens the pick turn (`PeakV2TMWReveal`).
#: Still one shared server window for every seat; nothing per-seat changed.
#:
#: 1.5, FROM 4.0 (game-feel pass 4). The reveal is information, not a pause:
#: four seconds between every round of an 18-pick draft was dead air in front
#: of the pick. The ceremony is now one slate -- round, franchise x decade, the
#: round's pick order -- with reels that lock by 0.86 s and resolve at 1.0 s,
#: and half a second of the settled pair before this deadline opens the pick
#: (`PeakV2TMWReveal`, `TMW_REVEAL_SECONDS`, which mirrors this value).
REVEAL_SECONDS = 1.5

#: Round one's ceremony window. It used to carry the matchup card as well and
#: so ran longer; the matchup card is now the briefing phase's own
#: (`PHASE_INTRO` below), so the opening reveal is the same beat as every
#: later one. Kept as its own name because `_open_ceremony_turn` is a
#: different code path from `_commit`, and the two lengths being equal is a
#: decision rather than a coincidence.
OPENING_REVEAL_SECONDS = REVEAL_SECONDS

#: THE PRE-MATCH BRIEFING, AS A REAL, SHORT, SERVER-TIMED TURN -- and the ONLY
#: phase a match may open on.
#:
#: WHAT IT IS. When the last seat is filled the match enters this phase
#: (`initial_phase`) for `INTRO_SECONDS`: the title card, the three seats with
#: the viewer marked, the objective. It belongs to no seat, accepts no command
#: from anybody (human or bot) and ends on its OWN deadline by opening round
#: one's ceremony (`_open_ceremony_turn`), exactly the way the ceremony's own
#: end opens the pick turn. Every client renders the same phase against the
#: same server clock (`turn_elapsed_seconds`), so three players enter the
#: match together rather than each on their own dismissal.
#:
#: WHAT IT REPLACED. The briefing used to be a client dialog with a
#: "Enter the draft room" button that sent `tmw_skip_intro`, which ended the
#: phase for the whole table on ONE player's click while the other two were
#: still reading -- the players were no longer entering the match together.
#: Because the dialog had no auto-dismiss, the phase then needed a 30-minute
#: backstop that ABANDONED the match rather than advancing it. A timed phase
#: needs neither: nothing waits on a click, so nothing can be stranded on one.
#:
#: WHY THE TIMEOUT ADVANCES HERE (unlike the old backstop). Reaching this
#: phase's deadline no longer means "nobody is here"; it means the briefing
#: has been shown. Advancing is the same safe transition the ceremony's own
#: timeout already makes, and the pick clock that eventually follows is still
#: opened with a full window measured from the END of the reveal, never from
#: match creation.
PHASE_INTRO = "intro"

#: How long the briefing is on screen. T0 -> T0 + INTRO_SECONDS, then the
#: round-one ceremony. Short enough to read once and not resent on the tenth
#: match; long enough that three seat names and one objective line are
#: actually legible.
INTRO_SECONDS = 4.0

#: THE ARRIVAL PHASE -- the ONLY phase a match opens on (game-feel pass 4).
#:
#: THE DEFECT. The briefing's clock used to start at match creation. A client
#: that reached the match late -- a cold route compile, a slow network, a queue
#: handoff -- found the 4-second briefing partly or wholly spent on the server,
#: and was dropped into the round-one ceremony or the draft without ever seeing
#: who it was playing. The browser latency run reproduced it on an ordinary
#: 750 ms connection: the first read landed 2.3 s into the 4 s briefing.
#:
#: THE FIX is the one PRIME CUT and FIND THE PRIME proved. A match opens in a
#: seatless `arrival` turn: the briefing is on every client's screen but its
#: clock has not started. Each HUMAN seat's client sends `tmw_intro_seen` once
#: it has rendered the briefing (bots count as already arrived), and the
#: briefing's own `INTRO_SECONDS` turn opens when the last human has done so --
#: measured from that instant. Nothing can be drafted during arrival.
#:
#: THE BACKSTOP is for a human who never arrives (a closed tab in a private
#: room). It opens the BRIEFING, never gameplay, so whoever is at the table
#: still gets all of it.
PHASE_ARRIVAL = "arrival"
ARRIVAL_BACKSTOP_SECONDS = 20.0
#: A human seat's client has the briefing on screen. Accepted only in arrival,
#: once per seat; a repeat or a late report is refused by name (replay-safe).
COMMAND_INTRO_SEEN = "tmw_intro_seen"
EVENT_INTRO_SEEN = "tmw_intro_seen"
REJECT_INTRO_STARTED = "intro_already_started"
REJECT_INTRO_ALREADY_SEEN = "intro_already_seen"

#: FORMER client commands, kept as names so a stale client is refused with a
#: specific reason rather than "unknown command". Neither is accepted from
#: any seat any more -- see `REJECT_SHARED_TIMELINE` and `reduce`.
COMMAND_SKIP_INTRO = "tmw_skip_intro"
COMMAND_SKIP_REVEAL = "tmw_skip_reveal"

COMMAND_PICK = "tmw_pick"
#: Repositioning your OWN roster. Does not consume a turn -- see
#: `draft.rearrange` for why that is a rule rather than a convenience.
COMMAND_REARRANGE = "tmw_rearrange"
#: Record (or clear) a not-yet-committed candidate/slot choice for the seat on
#: the clock. Does not consume a turn -- see `draft.stage_pick`. Payload is
#: either `{"player_slug": ..., "slot_type": ...}` to stage, or `{"clear":
#: true}` to drop the staged choice without drafting it (CHANGE SELECTION).
COMMAND_STAGE_PICK = "tmw_stage_pick"

EVENT_ROLL_REVEALED = "tmw_roll_revealed"
EVENT_PICK_MADE = "tmw_pick_made"
EVENT_REARRANGED = "tmw_rearranged"
EVENT_MATCH_SCORED = "tmw_match_scored"

# Rejection codes. Machine-readable so a route answers without string-matching.
REJECT_UNKNOWN_COMMAND = "unknown_command"
REJECT_NOT_YOUR_TURN = "not_your_turn"
REJECT_NOT_YOUR_ROSTER = "not_your_roster"
REJECT_NO_ROLL = "no_roll"
REJECT_MATCH_COMPLETE = "match_complete"
REJECT_BAD_PAYLOAD = "bad_payload"
REJECT_NO_LEGAL_PICK = "no_legal_pick"
REJECT_NO_FEASIBLE_ROLL = "no_feasible_roll"
REJECT_VERSION_MISMATCH = "ruleset_version_mismatch"
#: A seat tried to end a shared, server-timed phase (the briefing or the
#: ceremony) early. The match timeline is one object for the whole table.
REJECT_SHARED_TIMELINE = "shared_timeline"


class ThreeManWeaveMode:
    """The `ArenaMode` implementation. Stateless -- one instance per ruleset is
    registered process-wide and every method is a pure function of its
    arguments. `variant` selects the standard game or a one-constraint draft."""

    def __init__(self, variant: str = VARIANT_STANDARD) -> None:
        if variant not in VARIANT_MODE_IDS:
            raise ValueError(f"unknown Three-Man Weave variant {variant!r}")
        self.variant = variant

    # -- identity ---------------------------------------------------------
    @property
    def mode(self) -> str:
        return VARIANT_MODE_IDS[self.variant]

    @property
    def mode_version(self) -> str:
        return RULESET_VERSION

    @property
    def seat_count(self) -> int:
        return PARTICIPANT_COUNT

    @property
    def turn_seconds(self) -> float:
        return TURN_SECONDS

    def initial_phase(self) -> str:
        # EVERY match opens on ARRIVAL: the briefing is on screen but its clock
        # waits for the table -- see `PHASE_ARRIVAL`. Arrival opens the
        # briefing (`PHASE_INTRO`), whose own timeout opens round one's
        # `PHASE_REVEAL`, exactly the way the ceremony's own end opens the pick.
        return PHASE_ARRIVAL

    def phase_seconds(self, phase: str) -> float:
        """How long a turn in this phase lasts.

        Neither the briefing nor the ceremony is a decision, so neither gets
        the decision window. Round one's turn is opened by MATCHMAKING rather
        than by this reducer, and without this hook it was stamped with
        `turn_seconds` -- so the first reveal of every match ran for 45
        seconds while rounds two through six correctly ran for
        `REVEAL_SECONDS`.

        AND BECAUSE ONLY THE FIRST TURN COMES THROUGH HERE, this is also
        where the pre-match briefing (`PHASE_INTRO`) and the opening
        ceremony's own window are both looked up: they are the only phases
        matchmaking ever opens directly. Every later round is opened by
        `_commit` (a round boundary) or by the intro's own timeout
        (`_open_ceremony_turn`) with their own constant.
        """
        if phase == PHASE_ARRIVAL:
            return ARRIVAL_BACKSTOP_SECONDS
        if phase == PHASE_INTRO:
            return INTRO_SECONDS
        if phase == PHASE_REVEAL:
            return OPENING_REVEAL_SECONDS
        return TURN_SECONDS

    def phase_accepts_action(self, phase: str) -> bool:
        """Whether a seat -- human or bot -- may play on a turn in this phase.

        Read by `arena.bots.drive_pending_bots`. Without it the driver reads a
        seatless turn as a SIMULTANEOUS one and lets every bot act, so the bots
        would draft underneath the briefing or the ceremony and either would
        be over before anybody saw it.
        """
        return phase not in (PHASE_ARRIVAL, PHASE_INTRO, PHASE_REVEAL)

    def initial_turn_seat(self, snapshot: dict) -> Optional[int]:
        """Neither the briefing nor the ceremony belongs to a seat, so the
        first turn names none.

        The foundation seats the first turn from this hook; returning None is
        what makes `seconds_remaining` publish to EVERY seat, which is correct
        here -- all three participants are watching the same briefing (and,
        later, the same reveal).
        """
        return None

    # -- optional foundation hooks ----------------------------------------
    def human_seat_index(self, seed: int) -> int:
        """Which seat a solo human takes against bots. Seeded, not always 0.

        An optional `ArenaMode` hook: the foundation calls it when it exists
        and seats the human at 0 otherwise, so a two-seat mode is unaffected
        by this mode's need. See `config.human_seat_index` for why the fixed
        seat was a real problem rather than a cosmetic one.
        """
        return human_seat_index(seed, PARTICIPANT_COUNT)

    def bot_think_seconds(self, seed: int, seat_index: int, turn_seq: int) -> float:
        """How long a bot seat appears to deliberate. Seeded, 4-10 seconds.

        Presentation only, and the foundation enforces it against the turn's
        stored `opened_at`. Never the human turn clock: three seats at 45
        seconds each turned a six-round draft into a quarter of an hour of
        watching nothing happen.

        THE FLOOR IS ABOVE THE CLIENT'S POLL INTERVAL, deliberately. At the
        previous 1-5 seconds a bot frequently moved inside the same two-second
        poll that opened its turn, so a client rendered the settled pick
        without ever rendering the seat on the clock -- the deliberation the
        turn-status surface is built around was, in practice, unobservable.
        """
        return bot_think_seconds(seed, seat_index, turn_seq)

    def bot_display_names(self, seed: int, count: int) -> tuple[str, ...]:
        """Distinct, human-facing names for this match's bot seats.

        Archetypes rather than a numbered generic placeholder, which reads as
        unfinished work in a mode whose whole surface is otherwise full of real
        people's names. Never a real player's name -- see `bot.py`.
        """
        return archetype_names(seed, count)

    # -- opening state ----------------------------------------------------
    def initial_snapshot(self, seed: int, seats: tuple[ArenaSeat, ...]) -> dict:
        """The opening state: empty rosters plus round 1's roll.

        A pure function of `(seed, seats)` given the committed data files --
        the eligibility index is immutable and versioned, and its version is
        recorded in the snapshot so a match built against a different index
        is detectable rather than silently reinterpreted.
        """
        participants = len(seats) or PARTICIPANT_COUNT
        # THE ONE CONSTRAINT, drawn once from the seed (a variant only).
        constraint: Optional[Constraint] = (
            None if self.variant == VARIANT_STANDARD else choose_constraint(self.variant, seed, participants)
        )
        state = D.create_match(seed, participants=participants, constraint=constraint)
        state = self._open_round(state)
        snapshot = self._to_snapshot(state)
        # ARRIVAL BOOKKEEPING, carried only until the briefing opens: every
        # later snapshot is rebuilt by `_to_snapshot`, which does not carry it.
        snapshot["arrival_open"] = True
        snapshot["arrived_seats"] = []
        return snapshot

    # -- rules ------------------------------------------------------------
    def reduce(self, data: ReducerInput) -> ReducerOutput:
        """Apply one command. Pure: no I/O, no clock, no input mutation.

        `data.now` is used for deadlines; `datetime.now()` is never called, so
        a replay produces the same verdict as the original.
        """
        command = data.command
        snapshot = data.match.snapshot or {}

        stored_version = snapshot.get("ruleset_version")
        if stored_version and stored_version not in COMPATIBLE_RULESET_VERSIONS:
            # Refused rather than reinterpreted -- the same call
            # `run_the_table.state.assert_version_compatible` makes.
            return _reject(
                REJECT_VERSION_MISMATCH,
                f"snapshot was written under {stored_version!r}, this build is {RULESET_VERSION!r}",
            )

        try:
            state = D.DraftState.from_dict(snapshot)
        except (KeyError, TypeError, ValueError) as exc:
            return _reject(REJECT_BAD_PAYLOAD, f"unreadable snapshot: {exc}")

        if state.is_complete:
            return _reject(REJECT_MATCH_COMPLETE, "The match is already complete")

        in_intro = data.open_turn is not None and data.open_turn.phase == PHASE_INTRO
        in_arrival = data.open_turn is not None and data.open_turn.phase == PHASE_ARRIVAL

        if command.command_type == COMMAND_TYPE_TIMEOUT and in_arrival:
            # THE BACKSTOP: a human never reported. Open the BRIEFING for
            # whoever is here -- never a ceremony, never a pick.
            return self._open_intro_turn(data, state, TURN_RESOLUTION_TIMEOUT, events=())
        if command.command_type == COMMAND_INTRO_SEEN:
            return self._reduce_intro_seen(data, snapshot, state, in_arrival)

        if command.command_type == COMMAND_TYPE_TIMEOUT:
            # A TIMEOUT ON THE BRIEFING IS THE BRIEFING ENDING: it opens round
            # one's ceremony with a full window measured from this instant.
            # See `PHASE_INTRO` for why this is now the same safe transition
            # the ceremony's own expiry makes. Handled first, before the
            # reveal check below, since a match can be in only one of the two
            # seatless phases at a time.
            if in_intro:
                return self._open_ceremony_turn(data, state)
            # A timeout ON THE CEREMONY is not a forfeit -- it is the ceremony
            # ending. Handled before `_reduce_timeout`, which would otherwise
            # auto-pick for a seat that has not been given its turn yet.
            if data.open_turn is not None and data.open_turn.phase == PHASE_REVEAL:
                return self._open_pick_turn(data, state)
            return self._reduce_timeout(data, state)
        if command.command_type in (COMMAND_SKIP_INTRO, COMMAND_SKIP_REVEAL):
            # THE TIMELINE IS SHARED. No seat may end the briefing or the
            # ceremony for the table; both phases end on their own server
            # deadline for every client at once. Refused with a specific
            # code so a stale client can say why rather than "unknown".
            return _reject(
                REJECT_SHARED_TIMELINE,
                "The match timeline is shared by every seat and cannot be skipped.",
            )
        # NOBODY ACTS UNDER THE BRIEFING, human or bot -- the bot driver is
        # also stopped upstream by `phase_accepts_action`; this is the rule
        # itself, so a command that arrives by any other route is refused
        # rather than relying on the driver having been polite. Checked once,
        # ahead of every other command, rather than duplicated per command
        # type: the briefing is exactly as blocking as the ceremony is for
        # `tmw_pick` below, and a future command must not have to remember to
        # add this check itself.
        if in_intro or in_arrival:
            return _reject(
                REJECT_NOT_YOUR_TURN,
                "The pre-match briefing has not been dismissed yet.",
            )
        if command.command_type == COMMAND_PICK:
            # NOBODY DRAFTS UNDER THE CEREMONY, human or bot. The bot driver is
            # also stopped upstream by `phase_accepts_action`; this is the rule
            # itself, so a command that arrives by any other route is refused
            # rather than relying on the driver having been polite.
            if data.open_turn is not None and data.open_turn.phase == PHASE_REVEAL:
                return _reject(
                    REJECT_NOT_YOUR_TURN,
                    "The franchise and decade are still being revealed.",
                )
            return self._reduce_pick(data, state)
        if command.command_type == COMMAND_STAGE_PICK:
            # NOBODY STAGES UNDER THE CEREMONY either -- there is nothing to
            # place a candidate against yet (the pick panel is not open), and
            # a stage that outlived the ceremony would carry into a turn it
            # was never validated for.
            if data.open_turn is not None and data.open_turn.phase == PHASE_REVEAL:
                return _reject(
                    REJECT_NOT_YOUR_TURN,
                    "The franchise and decade are still being revealed.",
                )
            return self._reduce_stage_pick(data, state)
        if command.command_type == COMMAND_REARRANGE:
            return self._reduce_rearrange(data, state)
        return _reject(
            REJECT_UNKNOWN_COMMAND, f"{command.command_type!r} is not a Three-Man Weave command"
        )

    def _reduce_pick(self, data: ReducerInput, state: D.DraftState) -> ReducerOutput:
        command = data.command
        seat_index = command.actor_seat_index
        if seat_index is None or seat_index != state.current_seat:
            return _reject(
                REJECT_NOT_YOUR_TURN,
                f"It is seat {state.current_seat}'s turn, not seat {seat_index}'s",
            )

        payload = command.payload or {}
        player_slug = payload.get("player_slug")
        slot_type = payload.get("slot_type")
        placements_payload = payload.get("placements")

        if not isinstance(player_slug, str):
            return _reject(REJECT_BAD_PAYLOAD, "payload requires a string 'player_slug'")
        if slot_type is not None and not isinstance(slot_type, str):
            return _reject(REJECT_BAD_PAYLOAD, "'slot_type' must be a string when given")
        if placements_payload is not None:
            if not isinstance(placements_payload, dict) or not all(
                isinstance(key, str) and isinstance(value, str)
                for key, value in placements_payload.items()
            ):
                return _reject(
                    REJECT_BAD_PAYLOAD,
                    "'placements' must map slot names to player slugs",
                )
        if slot_type is None and placements_payload is None:
            return _reject(
                REJECT_BAD_PAYLOAD,
                "payload requires 'slot_type', a full 'placements' arrangement, or both",
            )

        return self._commit(
            data,
            state,
            seat_index,
            player_slug,
            slot_type,
            timed_out=False,
            placements=placements_payload,
        )

    def _reduce_rearrange(self, data: ReducerInput, state: D.DraftState) -> ReducerOutput:
        """Reposition a seat's own roster. NEVER resolves or opens a turn.

        Returning `resolve_turn=None, open_turn=None` leaves the open turn
        exactly as it was (`arena_memory.apply_command` only touches a turn
        when a reducer asks it to), so a seat tidying its lineup while another
        seat is on the clock cannot shorten, extend or steal that clock. The
        state version still advances, which is what makes a concurrent stale
        pick fail its `expected_state_version` check rather than landing on a
        roster that has moved underneath it.
        """
        command = data.command
        seat_index = command.actor_seat_index
        if seat_index is None or not (0 <= seat_index < len(state.rosters)):
            return _reject(REJECT_NOT_YOUR_ROSTER, "That seat is not in this match")

        payload = command.payload or {}
        placements_payload = payload.get("placements")
        if not isinstance(placements_payload, dict) or not all(
            isinstance(key, str) and isinstance(value, str)
            for key, value in placements_payload.items()
        ):
            return _reject(
                REJECT_BAD_PAYLOAD, "'placements' must map slot names to player slugs"
            )

        try:
            new_state = D.rearrange(state, get_index(), seat_index, placements_payload)
        except D.DraftError as exc:
            return _reject(exc.code, exc.message)

        return ReducerOutput(
            accepted=True,
            snapshot=self._to_snapshot(new_state),
            events=(
                EventDraft(
                    event_type=EVENT_REARRANGED,
                    actor_seat_index=seat_index,
                    visibility=VISIBILITY_PUBLIC,
                    payload={
                        "seat_index": seat_index,
                        "assignment": {
                            slot: (pick.player_slug if pick else None)
                            for slot, pick in new_state.roster(seat_index).slots.items()
                        },
                    },
                ),
            ),
            resolve_turn=None,
            open_turn=None,
            status=None,
        )

    def _reduce_timeout(self, data: ReducerInput, state: D.DraftState) -> ReducerOutput:
        """Resolve an expired turn: draft the staged choice, or fall back.

        A timeout never skips a turn: a skipped pick would leave that seat a
        slot short and make its roster unscoreable.

        IF THE SEAT ON THE CLOCK HAS A LEGAL STAGED CHOICE, THAT IS WHAT
        TIMES OUT INTO THE ROSTER -- not the deterministic-but-deliberately-
        below-median `autopick` fallback. A staged choice is a player's own
        decision, made and left on the board; timing out on it must draft
        exactly what they chose, never something else. This is also what
        makes staging safe to ship at all: the original incident this
        replaces (a visibly-selected pick silently overwritten by autopick,
        see `PickOverlay.tsx`'s prior 3.2 fix) cannot recur, because the
        timeout now agrees with the staged selection instead of ignoring it.
        Re-validated with `staged_pick_is_still_legal` rather than trusted,
        because the seat on the clock may `rearrange` its own roster between
        staging and timing out.

        WITH NOTHING LEGAL STAGED, the fallback is exactly what it always
        was: `autopick.auto_pick`, a pure function of (state, seed) that any
        node recomputes identically.
        """
        seat_index = state.current_seat
        if seat_index is None:
            return _reject(REJECT_MATCH_COMPLETE, "The match is already complete")

        staged = state.staged_pick
        if staged is not None and D.staged_pick_is_still_legal(state, get_index(), staged):
            committed = self._commit(
                data, state, seat_index, staged.player_slug, staged.slot_type, timed_out=True
            )
            if committed.accepted:
                return committed

        # EVERY FALLBACK, IN ORDER, UNTIL THE RULES ACCEPT ONE. A timeout that
        # tried a single choice and was refused (the last pick of a round must
        # leave the next round a feasible roll) was refused again on every
        # read, and the match never moved again. The first accepted choice is
        # still the deterministic v1-shaped auto-pick whenever that one is legal.
        refused: Optional[ReducerOutput] = None
        for choice in auto_pick_options(state, get_index()):
            committed = self._commit(
                data, state, seat_index, choice.player_slug, choice.slot_type,
                timed_out=True, placements=choice.placements,
            )
            if committed.accepted:
                return committed
            refused = refused or committed
        if refused is not None:
            return refused
        return _reject(
            REJECT_NO_LEGAL_PICK,
            f"seat {seat_index} has no legal selection -- roll feasibility and the "
            "round-keeper rule should have made this unreachable",
        )

    def _reduce_stage_pick(self, data: ReducerInput, state: D.DraftState) -> ReducerOutput:
        """Stage (or clear) the acting seat's not-yet-committed choice.

        NEVER RESOLVES OR OPENS A TURN -- the same contract `_reduce_rearrange`
        documents: `resolve_turn=None, open_turn=None` leaves the open turn
        exactly as it was, so staging cannot shorten, extend or steal anyone's
        clock. The state version still advances (a new snapshot is always
        returned), which is what makes a concurrent stale action -- a pick or
        another stage against an older version -- fail its
        `expected_state_version` check rather than silently landing on a board
        that has moved underneath it.
        """
        command = data.command
        seat_index = command.actor_seat_index
        if seat_index is None or seat_index != state.current_seat:
            return _reject(
                REJECT_NOT_YOUR_TURN,
                f"It is seat {state.current_seat}'s turn, not seat {seat_index}'s",
            )

        payload = command.payload or {}
        if payload.get("clear"):
            new_state = D.clear_staged_pick(state)
            return ReducerOutput(
                accepted=True,
                snapshot=self._to_snapshot(new_state),
                events=(),
                resolve_turn=None,
                open_turn=None,
                status=None,
            )

        player_slug = payload.get("player_slug")
        slot_type = payload.get("slot_type")
        if not isinstance(player_slug, str) or not isinstance(slot_type, str):
            return _reject(
                REJECT_BAD_PAYLOAD,
                "payload requires string 'player_slug' and 'slot_type', or {'clear': true}",
            )

        try:
            new_state = D.stage_pick(state, get_index(), seat_index, player_slug, slot_type)
        except D.DraftError as exc:
            return _reject(exc.code, exc.message)

        return ReducerOutput(
            accepted=True,
            snapshot=self._to_snapshot(new_state),
            events=(),
            resolve_turn=None,
            open_turn=None,
            status=None,
        )

    def _commit(
        self,
        data: ReducerInput,
        state: D.DraftState,
        seat_index: int,
        player_slug: str,
        slot_type: Optional[str],
        timed_out: bool,
        placements: Optional[dict] = None,
    ) -> ReducerOutput:
        """Apply one validated selection and advance the match.

        The pick and any rearrangement it needs are ONE call into
        `D.apply_pick`, which validates the resulting roster as a whole. There
        is no ordering in which a caller could commit the draft and lose the
        repositioning, because there is only one commit.
        """
        try:
            state = D.apply_pick(
                state,
                get_index(),
                player_slug,
                slot_type,
                seat_index=seat_index,
                placements=placements,
                # WHO DECIDED, RECORDED ON THE PICK ITSELF. The client is not
                # allowed to infer a timeout from transport shape any more
                # (see `DraftPick.resolution`), so the one place that knows
                # writes it down.
                resolution=(
                    TURN_RESOLUTION_TIMEOUT if timed_out else TURN_RESOLUTION_ACTION
                ),
            )
        except D.DraftError as exc:
            return _reject(exc.code, exc.message)

        committed = state.picks[-1]
        events: list[EventDraft] = [
            EventDraft(
                event_type=EVENT_PICK_MADE,
                actor_seat_index=seat_index,
                visibility=VISIBILITY_PUBLIC,
                payload={
                    "player_slug": player_slug,
                    # The slot the pick ACTUALLY landed on. With an arrangement
                    # in the payload that can differ from what the client
                    # nominated, and the event has to record what happened.
                    "slot_type": committed.slot_type,
                    "rearranged": bool(placements),
                    "round_number": committed.round_number,
                    "franchise_id": committed.franchise_id,
                    "decade": committed.decade,
                    "resolution": TURN_RESOLUTION_TIMEOUT if timed_out else TURN_RESOLUTION_ACTION,
                },
            )
        ]
        resolution = TURN_RESOLUTION_TIMEOUT if timed_out else TURN_RESOLUTION_ACTION

        if state.is_complete:
            return self._complete(data, state, events, resolution)

        # A new round needs a roll, drawn against the state as it now stands.
        opened_round = state.current_roll is None
        if state.current_roll is None:
            try:
                state = self._open_round(state)
            except _NoFeasibleRoll as exc:
                return _reject(REJECT_NO_FEASIBLE_ROLL, str(exc))
            roll = state.current_roll
            assert roll is not None
            events.append(
                EventDraft(
                    event_type=EVENT_ROLL_REVEALED,
                    visibility=VISIBILITY_PUBLIC,
                    payload={
                        "round_number": roll.round_number,
                        "roll_id": roll.roll_id,
                        "franchise_id": roll.franchise_id,
                        "franchise_display_name": roll.franchise_display_name,
                        "decade": roll.decade,
                        "eligible_count": len(roll.eligible_slugs),
                    },
                )
            )

        # A ROUND THAT JUST OPENED GOES TO THE CEREMONY, NOT TO A SEAT.
        # `opened_round` is true exactly when this command drew a new roll, so
        # the reveal fires once per round and mid-round picks hand straight to
        # the next seat.
        # A VARIANT'S CONSTRAINT WAS SPUN ONCE, before round one; its later
        # rounds hand straight to the next seat. The standard game spins
        # every round.
        if opened_round and state.constraint is None:
            return ReducerOutput(
                accepted=True,
                snapshot=self._to_snapshot(state),
                events=tuple(events),
                resolve_turn=resolution,
                open_turn=TurnDraft(
                    phase=PHASE_REVEAL,
                    seat_index=None,
                    deadline_at=data.now + timedelta(seconds=REVEAL_SECONDS),
                ),
                status=MATCH_STATUS_ACTIVE,
            )

        return ReducerOutput(
            accepted=True,
            snapshot=self._to_snapshot(state),
            events=tuple(events),
            resolve_turn=resolution,
            open_turn=TurnDraft(
                phase=PHASE_PICK,
                seat_index=state.current_seat,
                deadline_at=data.now + timedelta(seconds=TURN_SECONDS),
            ),
            status=MATCH_STATUS_ACTIVE,
        )

    def _reduce_intro_seen(
        self, data: ReducerInput, snapshot: dict, state: D.DraftState, in_arrival: bool
    ) -> ReducerOutput:
        """A human seat's client has the briefing on screen.

        Records the seat; when every HUMAN seat has reported, opens the
        briefing's own timed turn from THIS instant. Bots never report: they
        are at the table by construction. Refused by name when the briefing is
        already running or this seat already reported, so a retried or
        duplicated report changes nothing.
        """
        seat_index = data.command.actor_seat_index
        seat = next((s for s in data.seats if s.seat_index == seat_index), None)
        if seat is None or seat.is_bot:
            return _reject(REJECT_NOT_YOUR_ROSTER, "Only a player's own client can report arriving.")
        if not in_arrival or not snapshot.get("arrival_open"):
            return _reject(REJECT_INTRO_STARTED, "The briefing is already running.")
        arrived = set(snapshot.get("arrived_seats") or [])
        if seat_index in arrived:
            return _reject(REJECT_INTRO_ALREADY_SEEN, "The briefing is already on your screen.")
        arrived.add(seat_index)
        event = EventDraft(
            event_type=EVENT_INTRO_SEEN,
            actor_seat_index=seat_index,
            visibility=VISIBILITY_PUBLIC,
            payload={"seat_index": seat_index},
        )
        humans = {s.seat_index for s in data.seats if not s.is_bot}
        if humans <= arrived:
            return self._open_intro_turn(data, state, TURN_RESOLUTION_ACTION, events=(event,))
        waiting = dict(snapshot)
        waiting["arrived_seats"] = sorted(arrived)
        return ReducerOutput(
            accepted=True,
            snapshot=waiting,
            events=(event,),
            resolve_turn=None,
            open_turn=None,
            status=None,
        )

    def _open_intro_turn(
        self, data: ReducerInput, state: D.DraftState, resolution: str, events: tuple
    ) -> ReducerOutput:
        """Arrival is over: open the briefing with its FULL `INTRO_SECONDS`,
        measured from now. The snapshot drops the arrival bookkeeping and is
        otherwise unchanged -- no pick, no redraw."""
        return ReducerOutput(
            accepted=True,
            snapshot=self._to_snapshot(state),
            events=events,
            resolve_turn=resolution,
            open_turn=TurnDraft(
                phase=PHASE_INTRO,
                seat_index=None,
                deadline_at=data.now + timedelta(seconds=INTRO_SECONDS),
            ),
            status=MATCH_STATUS_ACTIVE,
        )

    def _open_ceremony_turn(self, data: ReducerInput, state: D.DraftState) -> ReducerOutput:
        """End the briefing and open round one's ceremony with a FULL window.

        REACHED ONLY BY THE BRIEFING'S OWN DEADLINE (its timeout, swept by the
        foundation's clock). `data.now` is the instant the sweep fired, so the
        ceremony's `OPENING_REVEAL_SECONDS` window is measured from THIS
        moment, never from match creation, and every client sees the same
        transition at the same server instant.

        The snapshot is unchanged: the briefing ending is a clock transition,
        not a game event. Round one's roll already exists (drawn at match
        creation by `initial_snapshot`, for the same determinism reason
        `_open_round` documents), so nothing here redraws it or mutates any
        roster.
        """
        return ReducerOutput(
            accepted=True,
            snapshot=self._to_snapshot(state),
            events=(),
            resolve_turn=TURN_RESOLUTION_ACTION,
            open_turn=TurnDraft(
                phase=PHASE_REVEAL,
                seat_index=None,
                deadline_at=data.now + timedelta(seconds=OPENING_REVEAL_SECONDS),
            ),
            status=MATCH_STATUS_ACTIVE,
        )

    def _open_pick_turn(self, data: ReducerInput, state: D.DraftState) -> ReducerOutput:
        """End the ceremony and hand the first seat a FULL decision window.

        THE POINT OF THE WHOLE PHASE. `data.now` is the instant the sweep fired,
        so the pick deadline is `now + TURN_SECONDS` measured from the end of
        the reveal -- not from when the round opened. A human leading a round
        watches the same ceremony a bot-led round shows and then receives every
        one of their 45 seconds. Nothing here consults a client.

        The snapshot is unchanged: a ceremony ending is a clock transition, not
        a game event, so no pick is made, no roll is redrawn, and a replay of
        this command produces the identical turn.
        """
        return ReducerOutput(
            accepted=True,
            snapshot=self._to_snapshot(state),
            events=(),
            resolve_turn=TURN_RESOLUTION_ACTION,
            open_turn=TurnDraft(
                phase=PHASE_PICK,
                seat_index=state.current_seat,
                deadline_at=data.now + timedelta(seconds=TURN_SECONDS),
            ),
            status=MATCH_STATUS_ACTIVE,
        )

    def _complete(
        self,
        data: ReducerInput,
        state: D.DraftState,
        events: list[EventDraft],
        resolution: str,
    ) -> ReducerOutput:
        """Score every roster and settle the match."""
        index = get_index()
        try:
            evaluations = [
                (roster.seat_index, evaluate_roster(roster.slots, index, state.match_seed))
                for roster in state.rosters
            ]
        except EvaluationError as exc:  # pragma: no cover - defensive
            return _reject(exc.code, exc.message)

        # THE INVARIANT, ASSERTED RATHER THAN ASSUMED.
        #
        # `arena_match_results.score` is NOT NULL, so an unscoreable roster
        # would have to be stored as 0.0 -- a number that ranks last and looks
        # deliberate. That must never be written, because the results table is
        # APPEND-ONLY AND IMMUTABLE (20260804100000_arena_foundation.sql:541-551:
        # "a settled result is evidence, and evidence that can be edited is not
        # evidence"). A wrong 0.0 there can never be corrected, only explained.
        #
        # Today this cannot fire: `eligibility` only ever offers identities
        # with a real scored season in the drafted decade, so every completed
        # roster is fully scored. That is exactly why it is asserted here --
        # if the eligibility invariant is ever weakened, this fails loudly at
        # the boundary instead of silently minting a permanent 0.0.
        #
        # Raising rather than returning a rejection is deliberate: the reducer
        # runs inside the match transaction, so raising rolls the whole thing
        # back and NOTHING partial is written. A rejection would leave the
        # match settled-but-wrong or stuck with a half-written result set.
        unscoreable = [
            (seat_index, evaluation.unscored_slots)
            for seat_index, evaluation in evaluations
            if evaluation.ranking_score is None
        ]
        if unscoreable:
            raise UnscoreableRoster(
                "Refusing to settle Three-Man Weave with an unscoreable roster: "
                f"{unscoreable!r}. `arena_match_results.score` is NOT NULL and the row is "
                "immutable once written, so a placeholder 0.0 would be permanent. This means "
                "the eligibility invariant (every offered identity has a scored season in the "
                "drafted decade) has been broken upstream."
            )

        table = placements(evaluations)
        by_seat = dict(evaluations)

        results: list[ResultDraft] = []
        for seat_index, evaluation in evaluations:
            placement, outcome = table[seat_index]
            results.append(
                ResultDraft(
                    seat_index=seat_index,
                    placement=placement,
                    # Guaranteed non-None by the assertion above.
                    score=round(evaluation.ranking_score, 4),
                    outcome=outcome,
                    detail={
                        "score_status": evaluation.score_status,
                        # The comparator, named for what it is. NO PROJECTED
                        # RECORD is carried: the 82-0 record projection is
                        # calibrated for eight cards and this roster has six,
                        # so a "68-14" here would be a claim this mode cannot
                        # stand behind. See evaluation.py's module docstring.
                        "lineup_score": evaluation.lineup_score,
                        "mean_season_score": evaluation.mean_season_score,
                        "fit_components": evaluation.fit_components,
                        "best_pick": evaluation.best_pick,
                        "decisive_pick": evaluation.decisive_pick,
                        "tmw_adapter_version": evaluation.tmw_adapter_version,
                        "lineup_model_version": evaluation.lineup_model_version,
                        "simulator_version": evaluation.simulator_version,
                        "formula_version": evaluation.formula_version,
                    },
                )
            )

        events.append(
            EventDraft(
                event_type=EVENT_MATCH_SCORED,
                visibility=VISIBILITY_PUBLIC,
                payload={
                    "placements": {
                        str(seat): {"placement": place, "outcome": outcome}
                        for seat, (place, outcome) in table.items()
                    },
                    "scores": {
                        str(seat): by_seat[seat].ranking_score for seat, _ in evaluations
                    },
                },
            )
        )

        snapshot = self._to_snapshot(state)
        snapshot["results"] = {
            str(seat_index): evaluation.as_dict() for seat_index, evaluation in evaluations
        }
        return ReducerOutput(
            accepted=True,
            snapshot=snapshot,
            events=tuple(events),
            resolve_turn=resolution,
            open_turn=None,
            status=MATCH_STATUS_COMPLETED,
            results=tuple(results),
        )

    # -- projection -------------------------------------------------------
    def project(
        self, match: ArenaMatch, seats: tuple[ArenaSeat, ...], seat_index: int
    ) -> tuple[dict, dict, tuple[str, ...]]:
        """`(public_state, private_state, legal_commands)` for one seat.

        THE ONLY ROLL THAT APPEARS IS THE CURRENT ONE. Future rolls are not
        filtered out here -- they do not exist in the snapshot at all (see
        this module's docstring), so there is nothing to strip and no way for
        a later edit to this method to start leaking them.
        """
        snapshot = match.snapshot or {}
        try:
            state = D.DraftState.from_dict(snapshot)
        except (KeyError, TypeError, ValueError):
            return {"error": "unreadable_snapshot"}, {}, ()

        drafted = state.drafted_identities()
        current_roll = state.current_roll

        public_state = {
            "mode_version": RULESET_VERSION,
            "formula_version": snapshot.get("formula_version", FORMULA_VERSION),
            "slot_types": list(SLOT_TYPES),
            "total_rounds": ROUNDS,
            "current_round": state.current_round,
            "current_seat": state.current_seat,
            "is_complete": state.is_complete,
            # Every pick is public the instant it is made -- a draft is open
            # information. What is NOT public is any future roll.
            "rosters": [self._roster_public(roster) for roster in state.rosters],
            "drafted_identities": sorted(drafted),
            "used_roll_ids": list(state.used_roll_ids),
            # ORDINAL ONLY, and marked live. See `_current_edge`.
            "current_edge": self._current_edge(state),
            "current_roll": (
                {
                    **current_roll.as_dict(),
                    # A variant's open dimension, named for people rather than
                    # as the placeholder key the snapshot stores.
                    **(
                        {
                            "variant": state.constraint.kind,
                            **(
                                {"decade": "All decades"}
                                if state.constraint.kind == VARIANT_FRANCHISE
                                else {}
                            ),
                        }
                        if state.constraint is not None
                        else {}
                    ),
                    # THE FULL ELIGIBLE POOL, in the roll's own sorted order --
                    # never narrowed to whichever players suit the asking
                    # seat's open slots, and never ordered by a score. Already
                    # filtered by the identity lock, so a taken player is
                    # absent rather than merely marked.
                    #
                    # NO SCORING CARD CROSSES HERE. Until a pick is confirmed a
                    # candidate is a name, an eligibility record and a set of
                    # positions; the season and the number are published the
                    # instant they are drafted (`_pick_public`). Hiding them is
                    # the mode's product rule, and the reason the list can be
                    # ordered by anything at all -- an order by score would put
                    # the number back whether or not it was printed.
                    "candidates": [
                        self._candidate_public(
                            slug, *state.card_key(slug), constraint=state.constraint
                        )
                        for slug in current_roll.eligible_slugs
                        if slug not in drafted
                    ],
                }
                if current_roll
                else None
            ),
        }
        public_state["variant"] = self.variant
        if state.constraint is not None:
            # The constraint, never its resolved cards: which season (and so
            # which decade or franchise) a candidate is scored on stays on the
            # server until the pick is made, exactly as in the standard game.
            public_state["constraint"] = state.constraint.public_dict()
        if state.is_complete and snapshot.get("results"):
            public_state["results"] = snapshot["results"]
        if snapshot.get("arrival_open"):
            # Who is already at the table, so a room can say who it waits on.
            public_state["arrival"] = {"arrived_seats": list(snapshot.get("arrived_seats") or [])}

        # `private_state` holds only THIS seat's own derivations. There is no
        # per-seat secret in a draft, so nothing here is denied to anyone --
        # it is a convenience, not a confidence.
        private_state: dict = {"seat_index": seat_index}
        legal_commands: tuple[str, ...] = ()
        seat_row = next((s for s in seats if s.seat_index == seat_index), None)
        if (
            match.is_live()
            and snapshot.get("arrival_open")
            and seat_row is not None
            and not seat_row.is_bot
            and seat_index not in (snapshot.get("arrived_seats") or [])
        ):
            return public_state, private_state, (COMMAND_INTRO_SEEN,)
        if 0 <= seat_index < len(state.rosters):
            roster = state.roster(seat_index)
            private_state["open_slots"] = list(roster.open_slots())
            private_state["assignment"] = {
                slot: (pick.player_slug if pick else None)
                for slot, pick in roster.slots.items()
            }
            # Repositioning your own roster is legal whenever the match is
            # live, on or off the clock -- it takes nothing from anybody.
            # `match.is_live()` (not just `state.is_complete`) gates this: an
            # ABANDONED match (the foundation's own status) leaves the snapshot
            # completely untouched -- still round one's original roll, still
            # zero picks made -- so `state.is_complete` alone would not catch
            # it, and a stale client would be told a pick was legal for a
            # match `apply_command` will refuse outright. `is_live` is a
            # METHOD on `ArenaMatch`, not a property -- called here, not
            # merely referenced, so this is the actual boolean and not an
            # always-truthy bound-method object.
            if match.is_live() and not state.is_complete and roster.picks():
                legal_commands = (COMMAND_REARRANGE,)

            if match.is_live() and state.current_seat == seat_index and current_roll is not None:
                fits = D.candidate_fits(state, get_index(), seat_index)
                private_state["candidate_fits"] = {
                    slug: fit.as_dict() for slug, fit in sorted(fits.items())
                }
                # `legal_picks` is retained beside the fits: it is the strict
                # "fits an open slot right now" answer, and a surface that only
                # wants the simple case should not have to interpret a plan.
                options = D.legal_picks(state, get_index(), seat_index)
                private_state["legal_picks"] = {
                    slug: list(slots) for slug, slots in sorted(options.items())
                }
                if any(fit.selectable for fit in fits.values()):
                    legal_commands = (COMMAND_PICK,) + legal_commands
                # THE STAGED CHOICE IS PRIVATE, not published on `public_state`
                # like a pick is. A draft's picks are open information the
                # instant they are made -- but a staged, uncommitted choice is
                # a player's in-progress thinking, which this mode has never
                # exposed to opponents. It survives a same-seat refresh (it is
                # part of the persisted snapshot) but is only ever handed back
                # to the seat that made it.
                private_state["staged_pick"] = (
                    state.staged_pick.as_dict() if state.staged_pick else None
                )
                legal_commands = (COMMAND_STAGE_PICK,) + legal_commands

        return public_state, private_state, legal_commands

    # -- the live edge -----------------------------------------------------
    def _current_edge(self, state: D.DraftState) -> dict:
        """An ORDINAL, temporary reading of who is ahead. No totals.

        Publishing partial totals would be publishing a number that is not
        comparable to the final one -- an unfinished roster scores an empty
        bench as zero rather than as absent -- and players would reasonably
        read the two as the same scale. So only the band crosses, and it is
        flagged `is_live` so a surface has to say it is provisional.

        Computed at EQUAL DEPTH across seats (see `evaluation.current_edges`),
        so a seat is never shown as "Leading" for the sole reason that the
        snake has just given it an extra pick.
        """
        if state.is_complete:
            return {"is_live": False, "compared_after_picks": 0, "seats": {}}
        picks_by_seat = {
            roster.seat_index: list(roster.picks()) for roster in state.rosters
        }
        depth = min((len(picks) for picks in picks_by_seat.values()), default=0)
        # MEMOIZED ON THE PICKS (game-feel pass 4). The bands are a pure
        # function of the seed and every seat's picks, but computing them runs
        # the lineup evaluator over each roster -- 97% of a 24-45 ms projection
        # -- and a projection runs on every poll, every command response and
        # every bot's view, while the picks change a few times a minute.
        key = (
            state.match_seed,
            tuple(
                sorted(
                    (
                        roster.seat_index,
                        tuple(
                            sorted(
                                (p.round_number, p.slot_type, p.player_slug, p.franchise_id, p.decade)
                                for p in roster.picks()
                            )
                        ),
                    )
                    for roster in state.rosters
                )
            ),
        )
        bands = _EDGE_CACHE.get(key)
        if bands is None:
            bands = current_edges(picks_by_seat, get_index(), state.match_seed)
            _EDGE_CACHE[key] = bands
            while len(_EDGE_CACHE) > _EDGE_CACHE_SIZE:
                _EDGE_CACHE.popitem(last=False)
        else:
            _EDGE_CACHE.move_to_end(key)
        return {
            "is_live": True,
            "compared_after_picks": depth,
            "seats": {str(seat): band for seat, band in sorted(bands.items())},
        }

    # -- display enrichment ------------------------------------------------
    #
    # WHY SCORES ARE HIDDEN UNTIL A PICK IS CONFIRMED.
    #
    # An earlier ruleset published every candidate's exact PEAK3 score during
    # the draft, on the argument that a draft is open information. It is -- but
    # the score is not information about the BOARD, it is the answer to the
    # question the board is asking. With it visible, the list sorted itself
    # into a leaderboard and the whole game was "take the top row", which is
    # also why the surface used to sort by it. Nothing about the era, the
    # franchise or the roster shape mattered.
    #
    # So a candidate is a name, an eligibility record and a set of positions
    # until they are drafted, and the exact season and score are published the
    # moment they are -- on the pick, in the feed, and on the final receipt.
    # The reveal is not delayed indefinitely and nothing is ever withheld from
    # one seat and shown to another: the boundary is temporal, exactly like the
    # one on future rolls.

    def _scoring_card_public(
        self, player_slug: str, franchise_id: str, decade: str
    ) -> Optional[dict]:
        card = get_index().scoring_card(player_slug, franchise_id, decade)
        if card is None:
            return None
        return {
            "season": card.season,
            # ALWAYS the rolled franchise's own code, aggregate or not. The
            # aggregate token is a fact about where the SCORE is recorded, not
            # about who the player suited up for, and printing it as the team
            # is how a card ends up labelled "2TM".
            "team_id": card.resolve_team_id,
            "team_name": TEAM_ID_TO_NAME.get(card.resolve_team_id, card.resolve_team_id),
            "prime_score": round(card.prime_score, 1),
            # Surfaced, never hidden: about 5% of scoring cards land on a
            # traded season whose score exists only at whole-season aggregate
            # grain. The UI labels it rather than presenting it as a
            # single-team number.
            "score_source": card.score_source,
            "is_multi_team_season": card.is_multi_team_season,
            "formula_version": card.formula_version,
        }

    @staticmethod
    def _headshot(player_slug: str) -> Optional[str]:
        """This identity's headshot URL, or None.

        THE SAME PIPELINE 82-0 USES, not a second one: the committed manifest
        `data/game/assets/player_assets.v3.json`, read through
        `perfect_season.assets.get_player_headshot_url`, keyed on the same
        `player_slug` this mode already speaks, and behind the same
        `ENABLE_EXTERNAL_ASSET_URLS` gate. A mode that resolved its own images
        would be a second source of truth for the one thing the licensing gate
        exists to control.

        None is an ordinary answer, not an error. The manifest resolves about a
        fifth of this mode's pool -- resolution needs a current roster entry, so
        historical players are largely absent -- and `PlayerAvatar` renders its
        medallion for the rest without a layout shift.
        """
        from app.core.config import settings

        if not settings.ENABLE_EXTERNAL_ASSET_URLS:
            return None
        from nba_peak.perfect_season.assets import get_player_headshot_url

        return get_player_headshot_url(player_slug)

    def _card_positions(
        self, player_slug: str, franchise_id: str, decade: str
    ) -> frozenset[str]:
        """The starting positions THIS card supports.

        Read from the card's own season rather than from the identity's
        career, so the labels a drafter reasons about are the same facts the
        reducer enforces. When the two were allowed to differ, the panel
        offered Russell Westbrook at small forward and the reducer agreed.
        """
        card = get_index().scoring_card(player_slug, franchise_id, decade)
        if card is None:
            return frozenset()
        return card_starter_positions(player_slug, card.season)

    def _eligibility_public(self, player_slug: str, franchise_id: str, decade: str) -> dict:
        """The evidence that makes this pick legal for this roll.

        Kept structurally separate from the scoring card in the payload,
        because they are different claims about different seasons and the UI
        is required to show them as two labelled facts. Collapsing them here
        would make that impossible downstream.
        """
        evidence = get_index().evidence(player_slug, franchise_id, decade)
        return {
            "franchise_id": franchise_id,
            "franchise_display_name": franchise_display_name(franchise_id) or franchise_id,
            "decade": decade,
            "seasons": [
                {
                    "season": appearance.season,
                    "team_code": appearance.team_code,
                    "games_played": appearance.games_played,
                    "via": appearance.via,
                }
                for appearance in evidence
            ],
        }

    def _candidate_public(
        self, player_slug: str, franchise_id: str, decade: str, constraint: Optional[Constraint] = None
    ) -> dict:
        """An UNDRAFTED candidate: everything except what they are worth.

        Deliberately a different function from `_player_public` rather than the
        same one with a flag. A flag is a thing a caller can forget to pass;
        two functions mean the pre-pick payload has no code path that can reach
        a scoring card at all.
        """
        index = get_index()
        return {
            "player_slug": player_slug,
            "player_name": index.player_name(player_slug) or player_slug,
            "eligibility": (
                _constraint_eligibility(player_slug, constraint.kind, constraint.value, constraint.label)
                if constraint is not None
                else self._eligibility_public(player_slug, franchise_id, decade)
            ),
            # The positions they may legally start at ON THIS CARD -- a rule
            # of the game and the thing a drafter reasons about, carrying no
            # valuation. Season-grain, not career-grain: the card is what the
            # roster will be scored on, so it is what legality follows.
            "positions": sorted(
                self._card_positions(player_slug, franchise_id, decade)
            ),
            "headshot_url": self._headshot(player_slug),
        }

    def _player_public(self, player_slug: str, franchise_id: str, decade: str) -> dict:
        """A DRAFTED player: the full card, score included.

        Only ever reached from `_pick_public`, i.e. only for a selection that
        has already been committed.
        """
        index = get_index()
        return {
            "player_slug": player_slug,
            "player_name": index.player_name(player_slug) or player_slug,
            "eligibility": self._eligibility_public(player_slug, franchise_id, decade),
            "positions": sorted(
                self._card_positions(player_slug, franchise_id, decade)
            ),
            "headshot_url": self._headshot(player_slug),
            "scoring_card": self._scoring_card_public(player_slug, franchise_id, decade),
        }

    def _pick_public(self, pick) -> dict:
        entry = pick.as_dict()
        entry.update(self._player_public(pick.player_slug, pick.franchise_id, pick.decade))
        return entry

    def _roster_public(self, roster) -> dict:
        return {
            "seat_index": roster.seat_index,
            "slots": {
                slot: (self._pick_public(pick) if pick is not None else None)
                for slot, pick in roster.slots.items()
            },
            "complete": roster.is_complete(),
        }

    # -- helpers ----------------------------------------------------------
    def _open_round(self, state: D.DraftState) -> D.DraftState:
        """Draw and set the roll for the round that is about to be played.

        Drawn against the CURRENT state, which is why it cannot be computed in
        advance: feasibility depends on who is already taken and which slots
        each seat still has open.
        """
        round_number = state.current_round
        if round_number is None:  # pragma: no cover - callers check is_complete
            return state
        if state.constraint is not None:
            # A variant's pool is the constraint itself; completability is kept
            # pick by pick (`draft.round_keepers`), so there is nothing to draw.
            return D.set_roll(
                state, constraint_roll(state.constraint, round_number, state.drafted_identities())
            )
        roll = F.roll_next(
            get_index(),
            state.rosters,
            state.drafted_identities(),
            round_number,
            stream_rng(state.match_seed, f"roll:{round_number}"),
            frozenset(state.used_roll_ids),
        )
        if roll is None:
            raise _NoFeasibleRoll(
                f"no feasible franchise x decade roll remains for round {round_number}"
            )
        return D.set_roll(state, roll)

    def _to_snapshot(self, state: D.DraftState) -> dict:
        snapshot = state.as_dict()
        snapshot["ruleset_version"] = RULESET_VERSION
        snapshot["eligibility_index_version"] = ELIGIBILITY_INDEX_VERSION
        snapshot["formula_version"] = FORMULA_VERSION
        return snapshot


#: `ThreeManWeaveMode._current_edge`'s memo: (seed, picks) -> bands. Bounded
#: LRU; an entry is a handful of short strings.
_EDGE_CACHE: "OrderedDict[tuple, dict]" = OrderedDict()
_EDGE_CACHE_SIZE = 2048


@functools.lru_cache(maxsize=4096)
def _constraint_eligibility(player_slug: str, kind: str, value: str, label: str) -> dict:
    """A variant candidate's eligibility evidence: every season with the
    franchise (Franchise Draft) or in the decade (Decade Draft). Public facts
    about where a player played -- deliberately NOT narrowed to the season the
    card resolves to, which would reveal where their best PEAK3 season sits."""
    index = get_index()
    seasons: list[dict] = []
    for franchise_id, decade in index.rolls():
        if kind == VARIANT_FRANCHISE and franchise_id != value:
            continue
        if kind == VARIANT_DECADE and decade != value:
            continue
        for appearance in index.evidence(player_slug, franchise_id, decade):
            seasons.append(
                {
                    "season": appearance.season,
                    "team_code": appearance.team_code,
                    "games_played": appearance.games_played,
                    "via": appearance.via,
                }
            )
    seasons.sort(key=lambda row: (row["season"], row["team_code"]))
    return {
        "franchise_id": value if kind == VARIANT_FRANCHISE else "ANY",
        "franchise_display_name": label if kind == VARIANT_FRANCHISE else "All franchises",
        "decade": value if kind == VARIANT_DECADE else "any",
        "seasons": seasons,
    }


class _NoFeasibleRoll(RuntimeError):
    """Raised internally when the validated roll space is exhausted."""


class UnscoreableRoster(RuntimeError):
    """A completed roster has no comparable score.

    A BUG SIGNAL, NOT A GAME STATE, which is why it is a distinct public type
    rather than a rejection code: a rejection is something a player can cause
    and a route can report, whereas this can only happen if the eligibility
    invariant has been broken in code. It exists so that failure is loud and
    greppable instead of a permanent 0.0 in an immutable results row -- see
    the comment at its raise site.
    """


def _reject(code: str, message: str) -> ReducerOutput:
    return ReducerOutput(accepted=False, rejection_code=code, rejection_message=message)


#: The registered instances: the standard game and its two one-constraint drafts.
mode = ThreeManWeaveMode()
franchise_mode = ThreeManWeaveMode(VARIANT_FRANCHISE)
decade_mode = ThreeManWeaveMode(VARIANT_DECADE)

#: The mode's own bot policy. Registered beside the mode below.
bot = ThreeManWeaveBot()


def register(registry_obj: Optional[object] = None) -> ThreeManWeaveMode:
    """Register this mode, defaulting to the process-wide registry.

    IDEMPOTENT. `ModeRegistry.register` only refuses a name already held by a
    DIFFERENT object, and `mode` below is a module-level singleton, so
    registering it repeatedly -- at import, again from a test, again after an
    `importlib.reload` -- is a no-op rather than a collision.

    Explicit rather than discovered: no filesystem scan, no entry points,
    matching `ModeRegistry`'s own stated discipline that a mode appearing
    because a file was copied into a directory is a deployment surprise.
    """
    if registry_obj is None:
        from app.services.arena.modes import registry as default_registry

        registry_obj = default_registry
    registry_obj.register(mode)  # type: ignore[attr-defined]
    registry_obj.register(franchise_mode)  # type: ignore[attr-defined]
    registry_obj.register(decade_mode)  # type: ignore[attr-defined]
    return mode


def register_bot() -> ThreeManWeaveBot:
    """Register this mode's drafting policy as the default for its bot seats.

    WITHOUT THIS LINE the foundation falls back to `RandomLegalBot`, which emits
    an EMPTY payload -- and `tmw_pick` needs a slug and a slot. Every bot seat
    therefore submitted an invalid command, was rejected, and sat until the
    45-second clock forfeited its turn to the auto-pick. Registration is the
    whole fix, and `test_three_man_weave_mode.py` asserts the resolved policy is
    this object rather than the baseline.
    """
    from app.services.arena import bots as bot_service

    bot_service.registry.register(bot, for_modes=(MODE_NAME, MODE_FRANCHISE, MODE_DECADE))
    return bot


def warm_caches() -> None:
    """Load every committed data file this mode reads, at import time.

    WHY THIS IS NOT OPTIONAL. `MatchReducer` forbids I/O because a reducer
    runs inside the match transaction holding the row lock: a read that
    happens there is a read every player in that match waits on. Both caches
    below are lazy by default, so without this call the FIRST match to reach
    each one pays for it under the lock.

    Two distinct caches, and warming only the first is a trap I walked into:

      * `eligibility.get_index()` -- reads the scored parquet and the
        13.6k-row all-seasons JSON.
      * `career_positions` -- reads the SAME JSON plus the regular parquet,
        and is NOT warmed by the index (the index does not consult positions
        at all). It is reached from `positions.is_legal`, i.e. from inside
        `reduce` on the first legality check of the process.

    READS COMMITTED FILES ONLY. No database, no network, no environment
    configuration: all four paths are tracked in git
    (`cache/processed/{scored,regular}_1980_2026.parquet`,
    `data/game/experimental/player_pool_1500/{all_seasons_for_identities,
    traded_player_team_stints}.v1.json`). Importing this module is therefore
    safe at API startup with no services available.
    """
    get_index()
    # The one-constraint drafts' viable constraints (a pool resolution and a
    # completability matching per franchise and decade) -- once, here, not on
    # the first match's creation.
    viable_constraints(VARIANT_FRANCHISE)
    viable_constraints(VARIANT_DECADE)
    # A real lookup, not a private cache poke -- this goes through
    # `career_positions()`'s own build path, so it warms whatever that
    # function actually populates rather than whatever it populated when this
    # line was written.
    career_positions("lebron-james")


# Import-time side effects, in this order: load the data, then announce the
# mode. Registering a mode whose caches had failed to load would advertise a
# mode that cannot serve a request.
warm_caches()
register()
register_bot()

__all__ = [
    "MODE_DECADE",
    "MODE_FRANCHISE",
    "decade_mode",
    "franchise_mode",
    "ARRIVAL_BACKSTOP_SECONDS",
    "COMMAND_INTRO_SEEN",
    "PHASE_ARRIVAL",
    "COMMAND_PICK",
    "COMMAND_STAGE_PICK",
    "COMMAND_SKIP_INTRO",
    "COMMAND_SKIP_REVEAL",
    "INTRO_SECONDS",
    "OPENING_REVEAL_SECONDS",
    "REVEAL_SECONDS",
    "PHASE_INTRO",
    "PHASE_REVEAL",
    "ThreeManWeaveBot",
    "bot",
    "register_bot",
    "EVENT_MATCH_SCORED",
    "EVENT_PICK_MADE",
    "EVENT_ROLL_REVEALED",
    "MODE_NAME",
    "PHASE_PICK",
    "TURN_SECONDS",
    "ThreeManWeaveMode",
    "UnscoreableRoster",
    "mode",
    "register",
    "warm_caches",
]
