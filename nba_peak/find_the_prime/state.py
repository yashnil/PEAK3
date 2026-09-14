"""FIND THE PRIME rules: a pure state machine over one snapshot.

PHASES, each a real server turn:

    arrival --(every human seat has the intro on screen | backstop)--> intro
    intro --(clock)--> decide(r) --(all locked | clock)--> reveal(r) --(clock)--> decide(r+1)
    ... reveal(8) --(clock)--> complete

The last round gets its reveal too. The ridge is the teaching moment of the
mode, and completing the match inside the call that resolved round nine would
skip straight past it -- the phantom-state defect this repository has fixed
before.

ARRIVAL. The intro's clock does not start at match creation: it starts when
every human seat has reported the intro on screen (`intro_seen`), or at the
arrival backstop. Nothing in `arrival` is gameplay, so a slow client can be
late to the table without the match moving underneath it. See
`config.ARRIVAL_BACKSTOP_SECONDS`.

ANSWERING. A seat may STAGE a start season as often as it likes (the bracket on
the rail), and LOCK once. Both carry the round index and must name the start of
a window that exists for this player at this duration. When the clock (plus
grace) runs out: a seat with a STAGED window has it locked for them (the
Arena's established staged-choice policy, as Three-Man Weave's staged pick);
a seat with nothing staged has NO ANSWER for the round, worth 0 -- the best
window is never chosen on anyone's behalf.

HIDDEN INFORMATION. Before a round's reveal, a human seat receives the player,
the duration, the career seasons with team labels, and the list of legal start
seasons. Never a window score, never which window is best, never a rank, never
another seat's staged or locked window (only whether they have locked), and
never a future round. A bot seat additionally receives the CURRENT round's
window scores, which `bot.py` misreads by its tier.
"""
from __future__ import annotations

import copy
import random
from typing import Optional, Sequence

from nba_peak.find_the_prime import config as C
from nba_peak.find_the_prime import scoring
from nba_peak.find_the_prime.board import generate_board
from nba_peak.prime_modes.artifact import ARTIFACT_VERSION, load_artifact

REJECT_BAD_PAYLOAD = "bad_payload"
REJECT_NOT_DECIDING = "not_deciding"
REJECT_WRONG_ROUND = "wrong_round"
REJECT_INVALID_WINDOW = "invalid_window"
REJECT_ALREADY_LOCKED = "already_locked"
REJECT_SEAT_FORFEITED = "seat_forfeited"
REJECT_NO_SUCH_SEAT = "no_such_seat"
REJECT_MATCH_COMPLETE = "match_complete"
REJECT_VERSION_MISMATCH = "ruleset_version_mismatch"
REJECT_INTRO_STARTED = "intro_already_started"
REJECT_INTRO_ALREADY_SEEN = "intro_already_seen"


class RuleError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def bot_tier_for(seed: int, seat_index: int) -> str:
    order = list(C.BOT_TIERS)
    random.Random(f"find_the_prime:{seed}:bot-tiers").shuffle(order)
    return order[seat_index % len(order)]


def initial_state(seed: int, seats: Sequence[tuple[int, bool]]) -> dict:
    return {
        "ruleset_version": C.RULESET_VERSION,
        "board_version": C.BOARD_VERSION,
        "artifact_version": ARTIFACT_VERSION,
        "model_version": load_artifact().model_version,
        "seed": seed,
        "seat_count": len(seats),
        "board": generate_board(seed),
        "phase": C.PHASE_ARRIVAL,
        "round_index": 0,
        "seats": [
            {
                "seat_index": index,
                "is_bot": bool(is_bot),
                "bot_tier": bot_tier_for(seed, index) if is_bot else None,
                "forfeited": False,
                "forfeit_order": None,
                # A bot has no screen to wait for.
                "intro_seen": bool(is_bot),
                "staged": None,
                "locked": None,
                "answers": [],
            }
            for index, is_bot in sorted(seats)
        ],
        "round_results": [],
        "forfeit_count": 0,
        "ended_by": None,
    }


def assert_supported(state: dict) -> None:
    if state.get("ruleset_version") != C.RULESET_VERSION:
        raise RuleError(REJECT_VERSION_MISMATCH, "This match was dealt under a different ruleset.")


def _seat(state: dict, seat_index: int) -> dict:
    for seat in state["seats"]:
        if seat["seat_index"] == seat_index:
            return seat
    raise RuleError(REJECT_NO_SUCH_SEAT, "No such seat.")


def current_round(state: dict) -> dict:
    return state["board"]["rounds"][state["round_index"]]


def legal_starts(round_: dict) -> list[int]:
    return [w["start_season_end"] for w in round_["windows"]]


def _done(seat: dict) -> bool:
    return seat["forfeited"] or seat["locked"] is not None


def all_locked(state: dict) -> bool:
    return all(_done(seat) for seat in state["seats"])


def _arrived(seat: dict) -> bool:
    return seat["is_bot"] or seat["forfeited"] or bool(seat.get("intro_seen"))


def all_arrived(state: dict) -> bool:
    return all(_arrived(seat) for seat in state["seats"])


def intro_seen(state: dict, seat_index: int) -> dict:
    """A seat's client reports that the intro is on its screen.

    When every human seat has, the intro's own clock starts. It can neither
    shorten the intro nor start a round: the only transition it can cause is
    `arrival` -> `intro`.
    """
    assert_supported(state)
    if state["phase"] == C.PHASE_COMPLETE:
        raise RuleError(REJECT_MATCH_COMPLETE, "The match is over.")
    if state["phase"] != C.PHASE_ARRIVAL:
        raise RuleError(REJECT_INTRO_STARTED, "The intro is already running.")
    seat = _seat(state, seat_index)
    if seat["forfeited"]:
        raise RuleError(REJECT_SEAT_FORFEITED, "You conceded this match.")
    if _arrived(seat):
        raise RuleError(REJECT_INTRO_ALREADY_SEEN, "The intro is already on your screen.")
    next_state = copy.deepcopy(state)
    _seat(next_state, seat_index)["intro_seen"] = True
    if all_arrived(next_state):
        next_state["phase"] = C.PHASE_INTRO
    return next_state


def _parse(state: dict, payload: dict) -> int:
    try:
        round_index = int(payload["round_index"])
        start = int(payload["start_season_end"])
    except (KeyError, TypeError, ValueError):
        raise RuleError(REJECT_BAD_PAYLOAD, "An answer names its round and its start season.") from None
    if round_index != state["round_index"]:
        raise RuleError(REJECT_WRONG_ROUND, "That round is over.")
    if start not in legal_starts(current_round(state)):
        raise RuleError(REJECT_INVALID_WINDOW, "That is not a window of this career at this length.")
    return start


def _check_can_answer(state: dict, seat_index: int) -> dict:
    assert_supported(state)
    if state["phase"] == C.PHASE_COMPLETE:
        raise RuleError(REJECT_MATCH_COMPLETE, "The match is over.")
    if state["phase"] != C.PHASE_DECIDE:
        raise RuleError(REJECT_NOT_DECIDING, "There is no prompt to answer right now.")
    seat = _seat(state, seat_index)
    if seat["forfeited"]:
        raise RuleError(REJECT_SEAT_FORFEITED, "You conceded this match.")
    if seat["locked"] is not None:
        raise RuleError(REJECT_ALREADY_LOCKED, "Your window for this round is locked.")
    return seat


def stage(state: dict, seat_index: int, payload: dict) -> dict:
    _check_can_answer(state, seat_index)
    start = _parse(state, payload)
    next_state = copy.deepcopy(state)
    _seat(next_state, seat_index)["staged"] = start
    return next_state


def lock(state: dict, seat_index: int, payload: dict) -> dict:
    _check_can_answer(state, seat_index)
    start = _parse(state, payload)
    next_state = copy.deepcopy(state)
    seat = _seat(next_state, seat_index)
    seat["staged"] = start
    seat["locked"] = {"start_season_end": start, "locked_by": C.LOCKED_BY_PLAYER}
    if all_locked(next_state):
        _reveal(next_state)
    return next_state


def _reveal(state: dict) -> None:
    round_ = current_round(state)
    rows = []
    for seat in state["seats"]:
        locked = seat["locked"]
        if locked is None:
            answer = scoring.score_answer(round_, None)
            answer["locked_by"] = C.NO_ANSWER_FORFEIT if seat["forfeited"] else C.NO_ANSWER_TIMEOUT
        else:
            answer = scoring.score_answer(round_, locked["start_season_end"])
            answer["locked_by"] = locked["locked_by"]
        answer["seat_index"] = seat["seat_index"]
        answer["round_index"] = round_["round_index"]
        seat["answers"].append({k: answer[k] for k in ("round_index", "start_season_end", "window_id", "points", "regret", "found_prime", "locked_by")})
        rows.append(answer)
    state["round_results"].append({
        "round_index": round_["round_index"],
        "duration": round_["duration"],
        "player_slug": round_["player_slug"],
        "best_window_id": round_["best_window_id"],
        "equivalent_window_ids": list(round_["equivalent_window_ids"]),
        "seats": rows,
    })
    state["phase"] = C.PHASE_REVEAL


def timeout(state: dict) -> dict:
    assert_supported(state)
    phase = state["phase"]
    next_state = copy.deepcopy(state)
    if phase == C.PHASE_ARRIVAL:
        # The backstop: stop waiting for a seat that never arrived, and run the
        # intro in full for whoever is here. Never straight to a round.
        next_state["phase"] = C.PHASE_INTRO
        return next_state
    if phase == C.PHASE_INTRO:
        next_state["phase"] = C.PHASE_DECIDE
        return next_state
    if phase == C.PHASE_DECIDE:
        for seat in next_state["seats"]:
            if seat["locked"] is None and not seat["forfeited"] and seat["staged"] is not None:
                seat["locked"] = {"start_season_end": seat["staged"], "locked_by": C.LOCKED_BY_STAGED_TIMEOUT}
        _reveal(next_state)
        return next_state
    if phase == C.PHASE_REVEAL:
        if next_state["round_index"] + 1 >= C.ROUND_COUNT:
            next_state["phase"] = C.PHASE_COMPLETE
            next_state["ended_by"] = "completed"
            return next_state
        next_state["round_index"] += 1
        next_state["phase"] = C.PHASE_DECIDE
        for seat in next_state["seats"]:
            seat["staged"] = None
            seat["locked"] = None
        return next_state
    raise RuleError(REJECT_MATCH_COMPLETE, "The match is over.")


def forfeit(state: dict, seat_index: int) -> dict:
    assert_supported(state)
    if state["phase"] == C.PHASE_COMPLETE:
        raise RuleError(REJECT_MATCH_COMPLETE, "The match is over.")
    if _seat(state, seat_index)["forfeited"]:
        raise RuleError(REJECT_SEAT_FORFEITED, "You already conceded this match.")
    next_state = copy.deepcopy(state)
    seat = _seat(next_state, seat_index)
    seat["forfeited"] = True
    seat["forfeit_order"] = next_state["forfeit_count"]
    next_state["forfeit_count"] += 1
    if not any(not s["is_bot"] and not s["forfeited"] for s in next_state["seats"]):
        next_state["phase"] = C.PHASE_COMPLETE
        next_state["ended_by"] = "forfeit"
        return next_state
    if next_state["phase"] == C.PHASE_ARRIVAL and all_arrived(next_state):
        next_state["phase"] = C.PHASE_INTRO
    if next_state["phase"] == C.PHASE_DECIDE and all_locked(next_state):
        _reveal(next_state)
    return next_state


# ---------------------------------------------------------------------------
# Legality and projection
# ---------------------------------------------------------------------------


def legal_commands(state: dict, seat_index: int) -> tuple[str, ...]:
    if state["phase"] == C.PHASE_COMPLETE:
        return ()
    seat = _seat(state, seat_index)
    if seat["forfeited"]:
        return ()
    commands: list[str] = []
    if state["phase"] == C.PHASE_ARRIVAL and not _arrived(seat):
        commands.append(C.COMMAND_INTRO_SEEN)
    if state["phase"] == C.PHASE_DECIDE and seat["locked"] is None:
        commands += [C.COMMAND_STAGE, C.COMMAND_LOCK]
    commands.append(C.COMMAND_FORFEIT)
    return tuple(commands)


def _prompt_public(round_: dict) -> dict:
    """What anyone may know BEFORE the reveal: who, how long, which seasons."""
    return {
        "round_index": round_["round_index"],
        "duration": round_["duration"],
        "player_slug": round_["player_slug"],
        "player_name": round_["player_name"],
        "seasons": copy.deepcopy(round_["seasons"]),
        "legal_starts": legal_starts(round_),
        "career_first_season": round_["seasons"][0]["season"],
        "career_last_season": round_["seasons"][-1]["season"],
    }


def _round_reveal_public(state: dict, result: dict) -> dict:
    round_ = state["board"]["rounds"][result["round_index"]]
    public = _prompt_public(round_)
    public.update(
        windows=[
            {k: w[k] for k in ("window_id", "start_season", "end_season", "start_season_end", "end_season_end", "prime_score")}
            for w in round_["windows"]
        ],
        best_window_id=result["best_window_id"],
        equivalent_window_ids=list(result["equivalent_window_ids"]),
        best_score=round_["best_score"],
        scale=round_["scale"],
        seats=copy.deepcopy(result["seats"]),
    )
    return public


def project(state: dict, seat_index: int, *, is_bot: bool = False) -> tuple[dict, dict, tuple[str, ...]]:
    phase = state["phase"]
    r = state["round_index"]
    round_ = state["board"]["rounds"][r]
    live = phase in (C.PHASE_DECIDE, C.PHASE_REVEAL)

    seats_public = [
        {
            "seat_index": s["seat_index"],
            "is_bot": s["is_bot"],
            "bot_tier": C.BOT_TIER_LABELS[s["bot_tier"]] if s["bot_tier"] else None,
            "locked": phase == C.PHASE_DECIDE and s["locked"] is not None,
            "arrived": _arrived(s),
            "forfeited": s["forfeited"],
        }
        for s in state["seats"]
    ]
    public = {
        "ruleset_version": state["ruleset_version"],
        "board_version": state["board_version"],
        "artifact_version": state["artifact_version"],
        "model_version": state["model_version"],
        "phase": phase,
        "round_index": r,
        "round_count": C.ROUND_COUNT,
        "max_match_score": C.MAX_MATCH_SCORE,
        "durations_by_round_played": [res["duration"] for res in state["round_results"]],
        "prompt": _prompt_public(round_) if live else None,
        "seats": seats_public,
        "round_results": [_round_reveal_public(state, res) for res in state["round_results"]],
        "standings": scoring.standings(state),
        "ended_by": state["ended_by"],
    }

    seat = _seat(state, seat_index)
    private = {
        "seat_index": seat_index,
        "staged_start": seat["staged"] if phase == C.PHASE_DECIDE else None,
        "locked_start": (seat["locked"] or {}).get("start_season_end") if phase == C.PHASE_DECIDE else None,
        "forfeited": seat["forfeited"],
    }
    if is_bot and seat["bot_tier"] and phase == C.PHASE_DECIDE:
        private["bot_tier"] = seat["bot_tier"]
        private["window_scores"] = [[w["start_season_end"], w["prime_score"]] for w in round_["windows"]]
    return public, private, legal_commands(state, seat_index)
