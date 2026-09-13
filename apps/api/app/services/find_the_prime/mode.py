"""FIND THE PRIME, plugged into the Arena foundation.

A TRANSLATION LAYER AND NOTHING ELSE. Every rule lives in
`nba_peak/find_the_prime/`. The shape mirrors `app/services/prime_cut/mode.py`:

1. TURNS FOLLOW PHASES. A round's DECIDE turn is a simultaneous decision with
   the foundation's action grace; the intro and every REVEAL are seatless turns
   nobody plays. A stage, or a lock that does not finish the round, leaves the
   turn open.
   A match OPENS in `arrival`, whose turn is only a backstop: the intro's own
   timed turn is opened by the `ftp_intro_seen` that completes the table, so
   its clock is measured from the moment the intro is on screen.

2. STAGING IS PRIVATE. A staged window is written only to the seat's own
   event stream. The public log records that a seat LOCKED, never where.

3. SCORES ENTER THE LOG AT THE REVEAL. `ftp_round_revealed` is the first public
   event to carry a window score, and it is written by the transition that
   resolves the round.

4. PURITY. The prompt pool and scale bounds are warmed at import.
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

from nba_peak.find_the_prime import config as C
from nba_peak.find_the_prime import scoring
from nba_peak.find_the_prime import state as rules
from nba_peak.find_the_prime.bot import FindThePrimeBot
from nba_peak.find_the_prime.pool import warm_pool

warm_pool()

REJECT_UNKNOWN_COMMAND = "unknown_command"
REJECT_NO_SEAT = "not_your_seat"

PHASE_SECONDS: dict[str, float] = {
    C.PHASE_ARRIVAL: C.ARRIVAL_BACKSTOP_SECONDS,
    C.PHASE_INTRO: C.INTRO_SECONDS,
    C.PHASE_DECIDE: C.DECIDE_SECONDS,
    C.PHASE_REVEAL: C.REVEAL_SECONDS,
}

EVENT_STAGED = "ftp_window_staged"
EVENT_LOCKED_PRIVATE = "ftp_window_locked"
EVENT_SEAT_LOCKED = "ftp_seat_locked"
EVENT_ROUND_OPENED = "ftp_round_opened"
EVENT_ROUND_REVEALED = "ftp_round_revealed"
EVENT_INTRO_SEEN = "ftp_intro_seen"
EVENT_SEAT_FORFEITED = "ftp_seat_forfeited"
EVENT_MATCH_COMPLETED = "ftp_match_completed"


def _position(state: dict) -> tuple:
    return (state["phase"], state["round_index"])


def _reject(code: str, message: str) -> ReducerOutput:
    return ReducerOutput(accepted=False, rejection_code=code, rejection_message=message)


class FindThePrimeMode:
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
        return C.DECIDE_SECONDS

    def initial_phase(self) -> str:
        # NOT the intro: its clock would start at match creation, before any
        # client could be showing it. See `config.ARRIVAL_BACKSTOP_SECONDS`.
        return C.PHASE_ARRIVAL

    def phase_seconds(self, phase: str) -> float:
        return PHASE_SECONDS.get(phase, C.DECIDE_SECONDS)

    def phase_accepts_action(self, phase: str) -> bool:
        return phase == C.PHASE_DECIDE

    def simultaneous_action_grace(self, phase: str) -> bool:
        return phase == C.PHASE_DECIDE

    def simultaneous_bot_think_seconds(self, seed: int, seat_index: int, turn_seq: int) -> float:
        low, high = C.BOT_THINK_RANGE[rules.bot_tier_for(seed, seat_index)]
        return low + random.Random(f"find_the_prime:{seed}:think:{seat_index}:{turn_seq}").random() * (high - low)

    def bot_seat_rating(self, seed: int, seat_index: int) -> float:
        return C.BOT_TIER_RATINGS[rules.bot_tier_for(seed, seat_index)]

    def initial_turn_seat(self, snapshot: dict) -> Optional[int]:
        return None

    def initial_snapshot(self, seed: int, seats: tuple[ArenaSeat, ...]) -> dict:
        return rules.initial_state(seed, [(s.seat_index, s.is_bot) for s in seats])

    def reduce(self, data: ReducerInput) -> ReducerOutput:
        before = data.match.snapshot or {}
        command = data.command
        events: list[EventDraft] = []
        seat = command.actor_seat_index
        try:
            if command.command_type == COMMAND_TYPE_TIMEOUT:
                after = rules.timeout(before)
                resolution = TURN_RESOLUTION_TIMEOUT
            elif command.command_type == C.COMMAND_INTRO_SEEN:
                if seat is None:
                    return _reject(REJECT_NO_SEAT, "Only a seat can have the intro on screen.")
                after = rules.intro_seen(before, seat)
                resolution = TURN_RESOLUTION_ACTION
                events.append(EventDraft(event_type=EVENT_INTRO_SEEN, actor_seat_index=seat, payload={"seat_index": seat}))
            elif command.command_type == C.COMMAND_STAGE:
                if seat is None:
                    return _reject(REJECT_NO_SEAT, "A selection must come from a seat.")
                after = rules.stage(before, seat, command.payload)
                resolution = TURN_RESOLUTION_ACTION
                events.append(EventDraft(
                    event_type=EVENT_STAGED, actor_seat_index=seat,
                    payload={"round_index": before["round_index"], "start_season_end": rules._seat(after, seat)["staged"]},
                    visibility=VISIBILITY_SEAT, visible_to_seat=seat,
                ))
            elif command.command_type == C.COMMAND_LOCK:
                if seat is None:
                    return _reject(REJECT_NO_SEAT, "A lock must come from a seat.")
                after = rules.lock(before, seat, command.payload)
                resolution = TURN_RESOLUTION_ACTION
                start = rules._seat(after, seat)["staged"]
                events.append(EventDraft(
                    event_type=EVENT_LOCKED_PRIVATE, actor_seat_index=seat,
                    payload={"round_index": before["round_index"], "start_season_end": start},
                    visibility=VISIBILITY_SEAT, visible_to_seat=seat,
                ))
                events.append(EventDraft(
                    event_type=EVENT_SEAT_LOCKED, actor_seat_index=seat,
                    payload={"round_index": before["round_index"], "seat_index": seat},
                ))
            elif command.command_type == C.COMMAND_FORFEIT:
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

    def _output(self, before: dict, after: dict, data: ReducerInput, events: list[EventDraft], resolution: str) -> ReducerOutput:
        moved = _position(before) != _position(after)
        if len(after["round_results"]) > len(before.get("round_results", [])):
            result = after["round_results"][-1]
            events.append(EventDraft(event_type=EVENT_ROUND_REVEALED, payload={
                "round_index": result["round_index"],
                "duration": result["duration"],
                "best_window_id": result["best_window_id"],
                "seats": [
                    {k: row[k] for k in ("seat_index", "window_id", "points", "found_prime")}
                    for row in result["seats"]
                ],
            }))
        if after["phase"] == C.PHASE_DECIDE and moved:
            prompt = rules.current_round(after)
            events.append(EventDraft(event_type=EVENT_ROUND_OPENED, payload={
                "round_index": after["round_index"],
                "duration": prompt["duration"],
                "player_slug": prompt["player_slug"],
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
            results.append(ResultDraft(
                seat_index=index,
                placement=placement,
                score=float(totals["total"]),
                outcome=outcome,
                detail={
                    "total": totals["total"],
                    "max_total": C.MAX_MATCH_SCORE,
                    "exact_windows": totals["found_primes"],
                    "total_regret": totals["total_regret"],
                    "average_regret": totals["average_regret"],
                    "rounds_scored": totals["rounds_scored"],
                    "rounds_answered": totals["rounds_answered"],
                    "forfeited": seat["forfeited"],
                    "bot_tier": seat["bot_tier"],
                    "ended_by": state["ended_by"],
                    "ruleset_version": state["ruleset_version"],
                    "board_version": state["board_version"],
                    "artifact_version": state["artifact_version"],
                    "model_version": state["model_version"],
                },
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

    def project(self, match: ArenaMatch, seats: tuple[ArenaSeat, ...], seat_index: int) -> tuple[dict, dict, tuple[str, ...]]:
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


mode = FindThePrimeMode()
bot = FindThePrimeBot()

registry.register(mode)
bot_service.registry.register(bot, for_modes=(C.MODE_ID,))

__all__ = ["FindThePrimeMode", "mode", "bot"]
