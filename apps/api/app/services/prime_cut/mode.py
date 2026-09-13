"""PRIME CUT, plugged into the Arena foundation.

A TRANSLATION LAYER AND NOTHING ELSE, the same split The $20 Showdown uses:
every rule lives in `nba_peak/prime_cut/`, which depends on neither FastAPI nor
the repositories.

WHAT THIS FILE MUST GET RIGHT
-----------------------------
1. TURNS FOLLOW PHASES. Whenever the rules move to a new phase OR a new card,
   the open turn is resolved and a fresh one opened with that phase's own
   length. Every turn is seatless: a card is a SIMULTANEOUS decision (every
   seat chooses at once), and the ceremonies are turns nobody plays. A decision
   that does not finish the card leaves the turn open.

2. SIMULTANEOUS-DECISION HOOKS. `simultaneous_action_grace` gives a card the
   same 2 s action grace a seat's own turn has; `simultaneous_bot_think_seconds`
   paces each bot seat on its own tier's range; `phase_accepts_action` keeps
   bots (and the clock's grace) off the ceremonies.

3. EVENT VISIBILITY. A seat's KEEP/CUT is written as a SEAT-visible event; the
   public log records only that the seat LOCKED. A card's score first enters
   the public log in `pc_heat_revealed`, after its heat has resolved.

4. PURITY. No I/O, no clock reads, no mutation of the input: the card pool and
   the bot prior are warmed at import, before the mode registers.
"""
from __future__ import annotations

import random
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
from app.services.arena import bots as bot_service
from app.services.arena.modes import registry

from nba_peak.prime_cut import config as C
from nba_peak.prime_cut import scoring
from nba_peak.prime_cut import state as rules
from nba_peak.prime_cut.bot import PrimeCutBot, prior_scores
from nba_peak.prime_cut.pool import warm_pool

# Warm everything a reducer or a bot could otherwise read from disk.
warm_pool()
for _duration in C.HEAT_DURATIONS:
    prior_scores(_duration)

REJECT_UNKNOWN_COMMAND = "unknown_command"
REJECT_NO_SEAT = "not_your_seat"

PHASE_SECONDS: dict[str, float] = {
    C.PHASE_INTRO: C.INTRO_SECONDS,
    C.PHASE_HEAT_OPEN: C.HEAT_OPEN_SECONDS,
    C.PHASE_CARD: C.CARD_SECONDS,
    C.PHASE_CARD_FORCED: C.FORCED_CARD_SECONDS,
    C.PHASE_HEAT_REVEAL: C.HEAT_REVEAL_SECONDS,
}

EVENT_DECISION = "pc_decision"
EVENT_SEAT_LOCKED = "pc_seat_locked"
EVENT_CARD_DEALT = "pc_card_dealt"
EVENT_CARD_TIMEOUT = "pc_card_timeout"
EVENT_HEAT_OPENED = "pc_heat_opened"
EVENT_HEAT_REVEALED = "pc_heat_revealed"
EVENT_SEAT_FORFEITED = "pc_seat_forfeited"
EVENT_MATCH_COMPLETED = "pc_match_completed"


def _position(state: dict) -> tuple:
    return (state["phase"], state["heat_index"], state["card_index"])


def _reject(code: str, message: str) -> ReducerOutput:
    return ReducerOutput(accepted=False, rejection_code=code, rejection_message=message)


class PrimeCutMode:
    @property
    def mode(self) -> str:
        return C.MODE_ID

    @property
    def mode_version(self) -> str:
        return C.RULESET_VERSION

    @property
    def seat_count(self) -> int:
        return C.SEAT_COUNT

    @property
    def turn_seconds(self) -> float:
        return C.CARD_SECONDS

    # -- optional foundation hooks -------------------------------------------

    def initial_phase(self) -> str:
        return C.PHASE_INTRO

    def phase_seconds(self, phase: str) -> float:
        return PHASE_SECONDS.get(phase, C.CARD_SECONDS)

    def phase_accepts_action(self, phase: str) -> bool:
        return phase == C.PHASE_CARD

    def simultaneous_action_grace(self, phase: str) -> bool:
        return phase == C.PHASE_CARD

    def simultaneous_bot_think_seconds(self, seed: int, seat_index: int, turn_seq: int) -> float:
        tier = rules.bot_tier_for(seed, seat_index)
        low, high = C.BOT_THINK_RANGE[tier]
        return low + random.Random(f"prime_cut:{seed}:think:{seat_index}:{turn_seq}").random() * (high - low)

    def bot_seat_rating(self, seed: int, seat_index: int) -> float:
        return C.BOT_TIER_RATINGS[rules.bot_tier_for(seed, seat_index)]

    def initial_turn_seat(self, snapshot: dict) -> Optional[int]:
        return None

    # -- the contract ----------------------------------------------------------

    def initial_snapshot(self, seed: int, seats: tuple[ArenaSeat, ...]) -> dict:
        return rules.initial_state(seed, [(s.seat_index, s.is_bot) for s in seats])

    def reduce(self, data: ReducerInput) -> ReducerOutput:
        before = data.match.snapshot or {}
        command = data.command
        events: list[EventDraft] = []
        try:
            if command.command_type == COMMAND_TYPE_TIMEOUT:
                after = rules.timeout(before)
                resolution = TURN_RESOLUTION_TIMEOUT
                if before.get("phase") == C.PHASE_CARD:
                    timed_out = [
                        s["seat_index"] for s in after["seats"]
                        if (rules.decision_for(s, before["heat_index"], before["card_index"]) or {}).get("auto") == C.AUTO_TIMEOUT
                    ]
                    events.append(EventDraft(
                        event_type=EVENT_CARD_TIMEOUT,
                        payload={"heat_index": before["heat_index"], "card_index": before["card_index"], "seats": timed_out},
                    ))
            elif command.command_type in (C.COMMAND_KEEP, C.COMMAND_CUT):
                seat = command.actor_seat_index
                if seat is None:
                    return _reject(REJECT_NO_SEAT, "A decision must come from a seat.")
                decision = C.DECISION_KEEP if command.command_type == C.COMMAND_KEEP else C.DECISION_CUT
                after = rules.decide(before, seat, decision, command.payload)
                resolution = TURN_RESOLUTION_ACTION
                coords = {"heat_index": before["heat_index"], "card_index": before["card_index"]}
                events.append(EventDraft(
                    event_type=EVENT_DECISION, actor_seat_index=seat,
                    payload={**coords, "decision": decision},
                    visibility=VISIBILITY_SEAT, visible_to_seat=seat,
                ))
                events.append(EventDraft(
                    event_type=EVENT_SEAT_LOCKED, actor_seat_index=seat,
                    payload={**coords, "seat_index": seat},
                ))
            elif command.command_type == C.COMMAND_FORFEIT:
                seat = command.actor_seat_index
                if seat is None:
                    return _reject(REJECT_NO_SEAT, "A forfeit must come from a seat.")
                after = rules.forfeit(before, seat)
                resolution = TURN_RESOLUTION_ACTION
                events.append(EventDraft(event_type=EVENT_SEAT_FORFEITED, actor_seat_index=seat, payload={"seat_index": seat}))
            else:
                return _reject(REJECT_UNKNOWN_COMMAND, f"Unknown command {command.command_type!r}.")
        except rules.RuleError as exc:
            return _reject(exc.code, exc.message)

        return self._output(before, after, data, events, resolution)

    def _output(
        self, before: dict, after: dict, data: ReducerInput, events: list[EventDraft], resolution: str
    ) -> ReducerOutput:
        moved = _position(before) != _position(after)
        if len(after["heat_results"]) > len(before.get("heat_results", [])):
            result = after["heat_results"][-1]
            events.append(EventDraft(event_type=EVENT_HEAT_REVEALED, payload={
                "heat_index": result["heat_index"],
                "duration": result["duration"],
                "optimal_card_indexes": result["optimal_card_indexes"],
                "seats": [{"seat_index": s["seat_index"], "capture": s["capture"]} for s in result["seats"]],
            }))
        if after["phase"] == C.PHASE_HEAT_OPEN and moved:
            events.append(EventDraft(event_type=EVENT_HEAT_OPENED, payload={
                "heat_index": after["heat_index"], "duration": C.HEAT_DURATIONS[after["heat_index"]],
            }))
        if after["phase"] in (C.PHASE_CARD, C.PHASE_CARD_FORCED) and moved:
            card = after["board"]["heats"][after["heat_index"]]["cards"][after["card_index"]]
            events.append(EventDraft(event_type=EVENT_CARD_DEALT, payload={
                "heat_index": after["heat_index"], "card": rules.card_identity(card),
            }))

        if after["phase"] == C.PHASE_COMPLETE:
            return self._complete(after, events, resolution)
        if not moved:
            return ReducerOutput(accepted=True, snapshot=after, events=tuple(events))
        return ReducerOutput(
            accepted=True,
            snapshot=after,
            events=tuple(events),
            resolve_turn=resolution,
            open_turn=TurnDraft(
                phase=after["phase"],
                deadline_at=data.now + timedelta(seconds=self.phase_seconds(after["phase"])),
                seat_index=None,
            ),
        )

    def _complete(self, state: dict, events: list[EventDraft], resolution: str) -> ReducerOutput:
        placements = scoring.placements(state)
        results = []
        for seat in state["seats"]:
            index = seat["seat_index"]
            totals = scoring.seat_totals(state, index)
            placement, outcome = placements[index]
            detail = {
                "match_score": totals["match_score"],
                "heats_completed": totals["heats_completed"],
                "optimal_keeps": totals["optimal_keeps"],
                "captured_ratio": totals["captured_ratio"],
                "forfeited": seat["forfeited"],
                "bot_tier": seat["bot_tier"],
                "ended_by": state["ended_by"],
                "ruleset_version": state["ruleset_version"],
                "board_version": state["board_version"],
                "artifact_version": state["artifact_version"],
                "model_version": state["model_version"],
            }
            for duration, capture in totals["heat_scores"].items():
                detail[f"heat_{duration}y"] = capture
            results.append(ResultDraft(
                seat_index=index,
                placement=placement,
                score=float(totals["match_score"] or 0.0),
                outcome=outcome,
                detail=detail,
            ))
        events.append(EventDraft(event_type=EVENT_MATCH_COMPLETED, payload={
            "ended_by": state["ended_by"],
            "placements": {str(i): {"placement": p, "outcome": o} for i, (p, o) in placements.items()},
        }))
        return ReducerOutput(
            accepted=True,
            snapshot=state,
            events=tuple(events),
            resolve_turn=resolution,
            open_turn=None,
            status=MATCH_STATUS_COMPLETED,
            results=tuple(results),
        )

    # -- the hidden-information boundary --------------------------------------

    def project(
        self, match: ArenaMatch, seats: tuple[ArenaSeat, ...], seat_index: int
    ) -> tuple[dict, dict, tuple[str, ...]]:
        """Forward to the rules package's own allowlist projection, then add the
        two things only the foundation knows: seat names and completion."""
        snapshot = match.snapshot or self.initial_snapshot(match.seed, seats)
        seat = next((s for s in seats if s.seat_index == seat_index), None)
        public, private, legal = rules.project(snapshot, seat_index, is_bot=bool(seat and seat.is_bot))
        names = {s.seat_index: s.display_name for s in seats}
        for row in public["seats"]:
            row["display_name"] = names.get(row["seat_index"], "PEAK3 player")
        if match.status == MATCH_STATUS_COMPLETED or snapshot.get("phase") == C.PHASE_COMPLETE:
            places = scoring.placements(snapshot)
            public["placements"] = [
                {"seat_index": i, "placement": p, "outcome": o} for i, (p, o) in sorted(places.items())
            ]
        return public, private, legal


mode = PrimeCutMode()
bot = PrimeCutBot()

registry.register(mode)
bot_service.registry.register(bot, for_modes=(C.MODE_ID,))

__all__ = ["PrimeCutMode", "mode", "bot"]
