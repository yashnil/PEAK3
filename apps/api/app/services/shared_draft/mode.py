"""SHARED DRAFT, plugged into the Arena foundation.

A TRANSLATION LAYER AND NOTHING ELSE, the split PRIME CUT and The $20 Showdown
use: every rule lives in `nba_peak/shared_draft/`, which depends on neither
FastAPI nor the repositories.

WHAT THIS FILE MUST GET RIGHT
-----------------------------
1. TURNS FOLLOW PHASES. A match OPENS in `arrival`, whose seatless turn is only
   a backstop; the intro's own timed turn opens when the last human seat
   reports `sd_intro_seen`, so its clock is measured from the moment the intro
   is on screen. Each pick is then its own SEAT turn with a full
   `PICK_SECONDS`, opened the instant the previous pick lands -- so a seat's
   clock never starts before its turn does.

2. EVENT VISIBILITY. Every pick is public the moment it is made (the board is
   open information); no score enters any event until the draft is complete.

3. PURITY. No I/O, no clock reads, no mutation of the input: the card pool is
   warmed at import, before the mode registers.
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

from nba_peak.shared_draft import bot as policy
from nba_peak.shared_draft import config as C
from nba_peak.shared_draft import state as rules
from nba_peak.shared_draft.bot import SharedDraftBot
from nba_peak.shared_draft.pool import warm_pool

# Warm everything a reducer or a bot could otherwise read from disk.
warm_pool()

REJECT_UNKNOWN_COMMAND = "unknown_command"
REJECT_NO_SEAT = "not_your_seat"

PHASE_SECONDS: dict[str, float] = {
    C.PHASE_ARRIVAL: C.ARRIVAL_BACKSTOP_SECONDS,
    C.PHASE_INTRO: C.INTRO_SECONDS,
    C.PHASE_PICK: C.PICK_SECONDS,
}

EVENT_INTRO_SEEN = "sd_intro_seen"
EVENT_DRAFT_OPENED = "sd_draft_opened"
EVENT_PICK_MADE = "sd_pick_made"
EVENT_SEAT_FORFEITED = "sd_seat_forfeited"
EVENT_MATCH_COMPLETED = "sd_match_completed"


def _reject(code: str, message: str) -> ReducerOutput:
    return ReducerOutput(accepted=False, rejection_code=code, rejection_message=message)


def _position(state: dict) -> tuple:
    return (state["phase"], state["pick_index"])


class SharedDraftMode:
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
        return C.PICK_SECONDS

    # -- optional foundation hooks -------------------------------------------

    def initial_phase(self) -> str:
        # NOT the intro: its clock would start at match creation, before any
        # client could be showing it.
        return C.PHASE_ARRIVAL

    def initial_turn_seat(self, snapshot: dict) -> Optional[int]:
        return None

    def phase_seconds(self, phase: str) -> float:
        return PHASE_SECONDS.get(phase, C.PICK_SECONDS)

    def phase_accepts_action(self, phase: str) -> bool:
        return phase == C.PHASE_PICK

    def bot_seat_rating(self, seed: int, seat_index: int) -> float:
        return C.BOT_RATING

    def bot_think_seconds(
        self, seed: int, seat_index: int, turn_seq: int, snapshot: Optional[dict] = None
    ) -> float:
        """Shaped by how close the bot's call is: an obvious pick lands fast, a
        toss-up takes a beat longer. Presentation only, deterministic from the
        stored state so every poller computes the same think time."""
        low, high = C.BOT_THINK_RANGE
        difficulty = 0.5
        if snapshot and snapshot.get("phase") == C.PHASE_PICK:
            try:
                public, private, _ = rules.project(snapshot, seat_index, is_bot=True)
                difficulty = policy.deliberation(public, private)
            except Exception:  # pragma: no cover - presentation must never wedge a turn
                difficulty = 0.5
        jitter = random.Random(f"shared_draft:{seed}:think:{seat_index}:{turn_seq}").uniform(0.9, 1.1)
        return min(high, max(low, (low + (high - low) * difficulty) * jitter))

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
            elif command.command_type == C.COMMAND_INTRO_SEEN:
                seat = command.actor_seat_index
                if seat is None:
                    return _reject(REJECT_NO_SEAT, "Only a seat can have the intro on screen.")
                after = rules.intro_seen(before, seat)
                resolution = TURN_RESOLUTION_ACTION
                events.append(EventDraft(event_type=EVENT_INTRO_SEEN, actor_seat_index=seat, payload={"seat_index": seat}))
            elif command.command_type == C.COMMAND_PICK:
                seat = command.actor_seat_index
                if seat is None:
                    return _reject(REJECT_NO_SEAT, "A pick must come from a seat.")
                after = rules.pick(before, seat, command.payload or {})
                resolution = TURN_RESOLUTION_ACTION
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
        for pick in after["picks"][len(before.get("picks", [])):]:
            card = after["board"]["cards"][pick["card_index"]]
            events.append(EventDraft(
                event_type=EVENT_PICK_MADE,
                actor_seat_index=pick["seat_index"],
                payload={**pick, "player_slug": card["player_slug"], "position": card["position"]},
            ))
        if before.get("phase") != C.PHASE_PICK and after["phase"] == C.PHASE_PICK:
            events.append(EventDraft(event_type=EVENT_DRAFT_OPENED, payload={"order": list(after["order"])}))

        if after["phase"] == C.PHASE_COMPLETE:
            return self._complete(after, events, resolution)
        if _position(before) == _position(after):
            # An arrival report that did not complete the table: no new turn.
            return ReducerOutput(accepted=True, snapshot=after, events=tuple(events))
        return ReducerOutput(
            accepted=True,
            snapshot=after,
            events=tuple(events),
            resolve_turn=resolution,
            open_turn=TurnDraft(
                phase=after["phase"],
                deadline_at=data.now + timedelta(seconds=self.phase_seconds(after["phase"])),
                seat_index=rules.current_seat(after),
            ),
        )

    def _complete(self, state: dict, events: list[EventDraft], resolution: str) -> ReducerOutput:
        places = rules.placements(state)
        results = []
        for seat in state["seats"]:
            index = seat["seat_index"]
            placement, outcome = places[index]
            total = rules.roster_total(state, index)
            results.append(ResultDraft(
                seat_index=index,
                placement=placement,
                score=float(total),
                outcome=outcome,
                detail={
                    "roster_total": total,
                    "roster": {slot: (state["board"]["cards"][c]["player_slug"] if c is not None else None)
                               for slot, c in rules.roster(state, index).items()},
                    "auto_picks": sum(1 for p in state["picks"] if p["seat_index"] == index and p["auto"]),
                    "forfeited": seat["forfeited"],
                    "ended_by": state["ended_by"],
                    "ruleset_version": state["ruleset_version"],
                    "board_version": state["board_version"],
                    "model_version": state["model_version"],
                    "latest_season": state["latest_season"],
                },
            ))
        events.append(EventDraft(event_type=EVENT_MATCH_COMPLETED, payload={
            "ended_by": state["ended_by"],
            "placements": {str(i): {"placement": p, "outcome": o} for i, (p, o) in places.items()},
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
        snapshot = match.snapshot or self.initial_snapshot(match.seed, seats)
        seat = next((s for s in seats if s.seat_index == seat_index), None)
        public, private, legal = rules.project(snapshot, seat_index, is_bot=bool(seat and seat.is_bot))
        names = {s.seat_index: s.display_name for s in seats}
        for row in public["seats"]:
            row["display_name"] = names.get(row["seat_index"], "PEAK3 player")
        if not match.is_live():
            # An abandoned match keeps its board readable but accepts nothing.
            legal = ()
        return public, private, legal


mode = SharedDraftMode()
bot = SharedDraftBot()

registry.register(mode)
bot_service.registry.register(bot, for_modes=(C.MODE_ID,))

__all__ = ["SharedDraftMode", "mode", "bot"]
