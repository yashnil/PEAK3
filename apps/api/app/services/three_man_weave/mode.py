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
from nba_peak.three_man_weave.autopick import auto_pick
from nba_peak.three_man_weave.bot import ThreeManWeaveBot, archetype_names
from nba_peak.three_man_weave.config import (
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

MODE_NAME = "three_man_weave"

#: How long one pick gets. Six rounds x three seats = 18 turns, so this sets
#: the worst-case match length at about 13 minutes of pure thinking time.
TURN_SECONDS = 45.0

PHASE_PICK = "pick"

COMMAND_PICK = "tmw_pick"
#: Repositioning your OWN roster. Does not consume a turn -- see
#: `draft.rearrange` for why that is a rule rather than a convenience.
COMMAND_REARRANGE = "tmw_rearrange"

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


class ThreeManWeaveMode:
    """The `ArenaMode` implementation. Stateless -- one instance is registered
    process-wide and every method is a pure function of its arguments."""

    # -- identity ---------------------------------------------------------
    @property
    def mode(self) -> str:
        return MODE_NAME

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
        return PHASE_PICK

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

        Archetypes rather than "PEAK3 Bot 1" and "PEAK3 Bot 2", which read as
        placeholders in a mode whose whole surface is otherwise full of real
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
        state = D.create_match(seed, participants=len(seats) or PARTICIPANT_COUNT)
        state = self._open_round(state)
        return self._to_snapshot(state)

    # -- rules ------------------------------------------------------------
    def reduce(self, data: ReducerInput) -> ReducerOutput:
        """Apply one command. Pure: no I/O, no clock, no input mutation.

        `data.now` is used for deadlines; `datetime.now()` is never called, so
        a replay produces the same verdict as the original.
        """
        command = data.command
        snapshot = data.match.snapshot or {}

        stored_version = snapshot.get("ruleset_version")
        if stored_version and stored_version != RULESET_VERSION:
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

        if command.command_type == COMMAND_TYPE_TIMEOUT:
            return self._reduce_timeout(data, state)
        if command.command_type == COMMAND_PICK:
            return self._reduce_pick(data, state)
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
        """Resolve an expired turn with the deterministic auto-pick.

        A timeout never skips a turn: a skipped pick would leave that seat a
        slot short and make its roster unscoreable, so the seat is given the
        pick `autopick.auto_pick` computes -- a pure function of (state, seed)
        that any node recomputes identically.
        """
        seat_index = state.current_seat
        if seat_index is None:
            return _reject(REJECT_MATCH_COMPLETE, "The match is already complete")

        choice = auto_pick(state, get_index())
        if choice is None:
            return _reject(
                REJECT_NO_LEGAL_PICK,
                f"seat {seat_index} has no legal selection -- roll feasibility should "
                "have made this unreachable",
            )
        return self._commit(
            data, state, seat_index, choice.player_slug, choice.slot_type, timed_out=True
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
                            slug, current_roll.franchise_id, current_roll.decade
                        )
                        for slug in current_roll.eligible_slugs
                        if slug not in drafted
                    ],
                }
                if current_roll
                else None
            ),
        }
        if state.is_complete and snapshot.get("results"):
            public_state["results"] = snapshot["results"]

        # `private_state` holds only THIS seat's own derivations. There is no
        # per-seat secret in a draft, so nothing here is denied to anyone --
        # it is a convenience, not a confidence.
        private_state: dict = {"seat_index": seat_index}
        legal_commands: tuple[str, ...] = ()
        if 0 <= seat_index < len(state.rosters):
            roster = state.roster(seat_index)
            private_state["open_slots"] = list(roster.open_slots())
            private_state["assignment"] = {
                slot: (pick.player_slug if pick else None)
                for slot, pick in roster.slots.items()
            }
            # Repositioning your own roster is legal whenever the match is
            # live, on or off the clock -- it takes nothing from anybody.
            if not state.is_complete and roster.picks():
                legal_commands = (COMMAND_REARRANGE,)

            if state.current_seat == seat_index and current_roll is not None:
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
        bands = current_edges(picks_by_seat, get_index(), state.match_seed)
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

    def _candidate_public(self, player_slug: str, franchise_id: str, decade: str) -> dict:
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
            "eligibility": self._eligibility_public(player_slug, franchise_id, decade),
            # The positions they may legally start at ON THIS CARD -- a rule
            # of the game and the thing a drafter reasons about, carrying no
            # valuation. Season-grain, not career-grain: the card is what the
            # roster will be scored on, so it is what legality follows.
            "positions": sorted(
                self._card_positions(player_slug, franchise_id, decade)
            ),
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


#: The single registered instance.
mode = ThreeManWeaveMode()

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

    bot_service.registry.register(bot, for_modes=(MODE_NAME,))
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
    "COMMAND_PICK",
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
