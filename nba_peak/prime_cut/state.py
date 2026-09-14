"""PRIME CUT rules: a pure state machine over one JSON-serialisable snapshot.

PHASES, each a real server turn (the API adapter opens one per phase):

    arrival --(every human seat has the intro on screen | backstop)--> intro
    intro --(clock)--> heat_open --(clock)--> card --(all decided | clock)--> card ...
                                         \\--> card_forced --(clock)--> card ...
    ... 8th card resolves --> heat_reveal --(clock)--> heat_open (next heat)
    ... 8th card of the 3rd heat resolves --> complete

WHY EVERY BEAT IS A PHASE. A visually meaningful state resolved inside the same
call that created it is a state no client can ever observe -- the phantom-lot
defect `twenty_dollar/mode.py` documents. So a card nobody can choose on still
gets `card_forced`, and a heat's scores get `heat_reveal`, each with a deadline.
The same holds for the intro itself: its clock starts only when every human
seat has reported it on screen (`intro_seen`), or at the arrival backstop --
never at match creation, which a slow client could miss entirely. See
`config.ARRIVAL_BACKSTOP_SECONDS`.

DECISIONS. A seat decides once per card and the decision is final. When a
seat's KEEP quota is full every remaining card is a forced CUT (and vice
versa); forced decisions are recorded the moment the card is dealt, marked
`auto: "forced"`. A seat that runs out the clock gets `TIMEOUT_DECISION_ORDER`
(CUT if a cut remains, else KEEP), marked `auto: "timeout"` -- never a decision
that depends on the card.

HIDDEN INFORMATION. `project` is a positive allowlist. A human seat never
receives a card's `prime_score`, `prime_index` or `canonical_rank` until its
heat has resolved, never a card that has not been dealt, and never another
seat's decision on an unresolved heat -- only whether that seat has locked. A
bot seat additionally receives the CURRENT card's score and the scores of cards
already dealt in this heat (its noisy "read" of them happens in `bot.py`), and
nothing from the future.
"""
from __future__ import annotations

import copy
import random
from typing import Iterable, Optional, Sequence

from nba_peak.prime_cut import config as C
from nba_peak.prime_cut import scoring
from nba_peak.prime_cut.board import generate_board
from nba_peak.prime_modes.artifact import ARTIFACT_VERSION, load_artifact

REJECT_BAD_PAYLOAD = "bad_payload"
REJECT_NOT_DECIDING = "not_deciding"
REJECT_WRONG_CARD = "wrong_card"
REJECT_ALREADY_DECIDED = "already_decided"
REJECT_KEEPS_FULL = "keeps_full"
REJECT_CUTS_FULL = "cuts_full"
REJECT_SEAT_FORFEITED = "seat_forfeited"
REJECT_NO_SUCH_SEAT = "no_such_seat"
REJECT_MATCH_COMPLETE = "match_complete"
REJECT_VERSION_MISMATCH = "ruleset_version_mismatch"
REJECT_INTRO_STARTED = "intro_already_started"
REJECT_INTRO_ALREADY_SEEN = "intro_already_seen"

#: Card fields a human may see before the card's heat resolves.
IDENTITY_KEYS = (
    "card_index", "window_id", "player_slug", "player_name", "duration",
    "start_season", "end_season", "seasons",
)


class RuleError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------


def bot_tier_for(seed: int, seat_index: int) -> str:
    """The skill tier a bot in this seat plays at. Seeded, so a replay and the
    rating pinned at seat time (`bot_seat_rating`) agree on it."""
    order = list(C.BOT_TIERS)
    random.Random(f"prime_cut:{seed}:bot-tiers").shuffle(order)
    return order[seat_index % len(order)]


def initial_state(seed: int, seats: Sequence[tuple[int, bool]]) -> dict:
    """`seats` is `(seat_index, is_bot)` for every seat at the table."""
    return {
        "ruleset_version": C.RULESET_VERSION,
        "board_version": C.BOARD_VERSION,
        "artifact_version": ARTIFACT_VERSION,
        "model_version": load_artifact().model_version,
        "seed": seed,
        "seat_count": len(seats),
        "board": generate_board(seed),
        "phase": C.PHASE_ARRIVAL,
        "heat_index": 0,
        "card_index": None,
        "seats": [
            {
                "seat_index": index,
                "is_bot": bool(is_bot),
                "bot_tier": bot_tier_for(seed, index) if is_bot else None,
                "forfeited": False,
                "forfeit_order": None,
                # A bot has no screen to wait for.
                "intro_seen": bool(is_bot),
                "decisions": [[] for _ in C.HEAT_DURATIONS],
            }
            for index, is_bot in sorted(seats)
        ],
        "heat_results": [],
        "forfeit_count": 0,
        "ended_by": None,
    }


def assert_supported(state: dict) -> None:
    if state.get("ruleset_version") != C.RULESET_VERSION:
        raise RuleError(REJECT_VERSION_MISMATCH, "This match was dealt under a different ruleset.")


# ---------------------------------------------------------------------------
# Seat helpers
# ---------------------------------------------------------------------------


def _seat(state: dict, seat_index: int) -> dict:
    for seat in state["seats"]:
        if seat["seat_index"] == seat_index:
            return seat
    raise RuleError(REJECT_NO_SUCH_SEAT, "No such seat.")


def counts(seat: dict, heat_index: int) -> tuple[int, int]:
    decisions = seat["decisions"][heat_index]
    keeps = sum(1 for d in decisions if d["decision"] == C.DECISION_KEEP)
    return keeps, len(decisions) - keeps


def decision_for(seat: dict, heat_index: int, card_index: int) -> Optional[dict]:
    for d in seat["decisions"][heat_index]:
        if d["card_index"] == card_index:
            return d
    return None


def forced_decision(seat: dict, heat_index: int) -> Optional[str]:
    keeps, cuts = counts(seat, heat_index)
    if keeps >= C.KEEPS_PER_HEAT:
        return C.DECISION_CUT
    if cuts >= C.CUTS_PER_HEAT:
        return C.DECISION_KEEP
    return None


def timeout_decision(seat: dict, heat_index: int) -> str:
    keeps, cuts = counts(seat, heat_index)
    for choice in C.TIMEOUT_DECISION_ORDER:
        if choice == C.DECISION_CUT and cuts < C.CUTS_PER_HEAT:
            return C.DECISION_CUT
        if choice == C.DECISION_KEEP and keeps < C.KEEPS_PER_HEAT:
            return C.DECISION_KEEP
    raise AssertionError("a seat with no legal decision was asked for one")  # pragma: no cover


def _record(seat: dict, heat_index: int, card_index: int, decision: str, auto: Optional[str]) -> None:
    seat["decisions"][heat_index].append({"card_index": card_index, "decision": decision, "auto": auto})


def all_decided(state: dict) -> bool:
    h, c = state["heat_index"], state["card_index"]
    return c is not None and all(decision_for(seat, h, c) is not None for seat in state["seats"])


def _arrived(seat: dict) -> bool:
    return seat["is_bot"] or seat["forfeited"] or bool(seat.get("intro_seen"))


def all_arrived(state: dict) -> bool:
    return all(_arrived(seat) for seat in state["seats"])


def undecided_seats(state: dict) -> list[int]:
    h, c = state["heat_index"], state["card_index"]
    if c is None:
        return []
    return [s["seat_index"] for s in state["seats"] if decision_for(s, h, c) is None]


# ---------------------------------------------------------------------------
# Transitions. Each returns a NEW state; the input is never mutated.
# ---------------------------------------------------------------------------


def _deal(state: dict, card_index: int) -> dict:
    state["phase"] = C.PHASE_CARD
    state["card_index"] = card_index
    h = state["heat_index"]
    for seat in state["seats"]:
        if seat["forfeited"]:
            _record(seat, h, card_index, timeout_decision(seat, h), C.AUTO_FORFEIT)
            continue
        forced = forced_decision(seat, h)
        if forced is not None:
            _record(seat, h, card_index, forced, C.AUTO_FORCED)
    if all_decided(state):
        state["phase"] = C.PHASE_CARD_FORCED
    return state


def _resolve_card(state: dict) -> dict:
    h, c = state["heat_index"], state["card_index"]
    if c + 1 < C.CARDS_PER_HEAT:
        return _deal(state, c + 1)
    state["heat_results"].append(scoring.score_heat(state, h))
    state["card_index"] = None
    if h + 1 < len(C.HEAT_DURATIONS):
        state["phase"] = C.PHASE_HEAT_REVEAL
    else:
        state["phase"] = C.PHASE_COMPLETE
        state["ended_by"] = "completed"
    return state


def intro_seen(state: dict, seat_index: int) -> dict:
    """A seat's client reports that the intro is on its screen.

    When every human seat has, the intro's own clock starts. It can neither
    shorten the intro nor deal a card: the only transition it can cause is
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


def decide(state: dict, seat_index: int, decision: str, payload: dict) -> dict:
    """Record one seat's KEEP or CUT on the current card. Raises RuleError."""
    assert_supported(state)
    if state["phase"] == C.PHASE_COMPLETE:
        raise RuleError(REJECT_MATCH_COMPLETE, "The match is over.")
    if state["phase"] != C.PHASE_CARD:
        raise RuleError(REJECT_NOT_DECIDING, "There is no card to decide on right now.")
    try:
        heat_index = int(payload["heat_index"])
        card_index = int(payload["card_index"])
    except (KeyError, TypeError, ValueError):
        raise RuleError(REJECT_BAD_PAYLOAD, "A decision names the heat and card it is for.") from None
    if heat_index != state["heat_index"] or card_index != state["card_index"]:
        raise RuleError(REJECT_WRONG_CARD, "That card is no longer the one on the table.")
    seat = _seat(state, seat_index)
    if seat["forfeited"]:
        raise RuleError(REJECT_SEAT_FORFEITED, "You conceded this match.")
    if decision_for(seat, heat_index, card_index) is not None:
        raise RuleError(REJECT_ALREADY_DECIDED, "Your call on this card is already locked.")
    keeps, cuts = counts(seat, heat_index)
    if decision == C.DECISION_KEEP and keeps >= C.KEEPS_PER_HEAT:
        raise RuleError(REJECT_KEEPS_FULL, "All four KEEP slots are used.")
    if decision == C.DECISION_CUT and cuts >= C.CUTS_PER_HEAT:
        raise RuleError(REJECT_CUTS_FULL, "All four CUTs are used.")
    if decision not in (C.DECISION_KEEP, C.DECISION_CUT):
        raise RuleError(REJECT_BAD_PAYLOAD, "Unknown decision.")

    next_state = copy.deepcopy(state)
    _record(_seat(next_state, seat_index), heat_index, card_index, decision, None)
    if all_decided(next_state):
        next_state = _resolve_card(next_state)
    return next_state


def timeout(state: dict) -> dict:
    """The open phase's clock ran out."""
    assert_supported(state)
    phase = state["phase"]
    next_state = copy.deepcopy(state)
    if phase == C.PHASE_ARRIVAL:
        # The backstop: stop waiting for a seat that never arrived, and run the
        # intro in full for whoever is here. Never straight to a heat.
        next_state["phase"] = C.PHASE_INTRO
        return next_state
    if phase == C.PHASE_INTRO:
        next_state["phase"] = C.PHASE_HEAT_OPEN
        return next_state
    if phase == C.PHASE_HEAT_OPEN:
        return _deal(next_state, 0)
    if phase == C.PHASE_CARD:
        h, c = next_state["heat_index"], next_state["card_index"]
        for seat in next_state["seats"]:
            if decision_for(seat, h, c) is None:
                _record(seat, h, c, timeout_decision(seat, h), C.AUTO_TIMEOUT)
        return _resolve_card(next_state)
    if phase == C.PHASE_CARD_FORCED:
        return _resolve_card(next_state)
    if phase == C.PHASE_HEAT_REVEAL:
        next_state["heat_index"] += 1
        next_state["phase"] = C.PHASE_HEAT_OPEN
        return next_state
    raise RuleError(REJECT_MATCH_COMPLETE, "The match is over.")


def forfeit(state: dict, seat_index: int) -> dict:
    """A seat concedes. It places below every seat that plays on, its remaining
    cards resolve automatically, and when no human is left playing the match
    ends at once -- nobody is kept waiting on a table of bots."""
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
        next_state["card_index"] = None
        next_state["ended_by"] = "forfeit"
        return next_state

    if next_state["phase"] == C.PHASE_ARRIVAL and all_arrived(next_state):
        next_state["phase"] = C.PHASE_INTRO
    if next_state["phase"] == C.PHASE_CARD:
        h, c = next_state["heat_index"], next_state["card_index"]
        if decision_for(seat, h, c) is None:
            _record(seat, h, c, timeout_decision(seat, h), C.AUTO_FORFEIT)
        if all_decided(next_state):
            next_state = _resolve_card(next_state)
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
    if state["phase"] == C.PHASE_CARD and decision_for(seat, state["heat_index"], state["card_index"]) is None:
        keeps, cuts = counts(seat, state["heat_index"])
        if keeps < C.KEEPS_PER_HEAT:
            commands.append(C.COMMAND_KEEP)
        if cuts < C.CUTS_PER_HEAT:
            commands.append(C.COMMAND_CUT)
    commands.append(C.COMMAND_FORFEIT)
    return tuple(commands)


def card_identity(card: dict) -> dict:
    return {key: copy.deepcopy(card[key]) for key in IDENTITY_KEYS}


def _heat_reveal_public(state: dict, result: dict) -> dict:
    heat = state["board"]["heats"][result["heat_index"]]
    scores = {c["card_index"]: c for c in result["cards"]}
    cards = []
    for card in heat["cards"]:
        identity = card_identity(card)
        identity.update(
            prime_score=scores[card["card_index"]]["prime_score"],
            canonical_rank=scores[card["card_index"]]["canonical_rank"],
        )
        cards.append(identity)
    return {
        "heat_index": result["heat_index"],
        "duration": result["duration"],
        "cards": cards,
        "optimal_card_indexes": list(result["optimal_card_indexes"]),
        "cut_line": result["cut_line"],
        "optimal_total": result["optimal_total"],
        "floor_total": result["floor_total"],
        "seats": copy.deepcopy(result["seats"]),
    }


def project(state: dict, seat_index: int, *, is_bot: bool = False) -> tuple[dict, dict, tuple[str, ...]]:
    h = state["heat_index"]
    c = state["card_index"]
    heat = state["board"]["heats"][h] if h < len(state["board"]["heats"]) else None
    heat_live = state["phase"] in (C.PHASE_CARD, C.PHASE_CARD_FORCED, C.PHASE_HEAT_OPEN)

    dealt: list[dict] = []
    if heat is not None and c is not None:
        dealt = [card_identity(card) for card in heat["cards"][: c + 1]]

    seats_public = []
    for seat in state["seats"]:
        locked = bool(c is not None and decision_for(seat, h, c) is not None)
        seats_public.append(
            {
                "seat_index": seat["seat_index"],
                "is_bot": seat["is_bot"],
                "bot_tier": C.BOT_TIER_LABELS[seat["bot_tier"]] if seat["bot_tier"] else None,
                "locked": locked,
                "arrived": _arrived(seat),
                "forfeited": seat["forfeited"],
            }
        )

    public = {
        "ruleset_version": state["ruleset_version"],
        "board_version": state["board_version"],
        "artifact_version": state["artifact_version"],
        "model_version": state["model_version"],
        "phase": state["phase"],
        "heat_index": h,
        "heat_count": len(C.HEAT_DURATIONS),
        "durations": list(C.HEAT_DURATIONS),
        "cards_per_heat": C.CARDS_PER_HEAT,
        "keeps_per_heat": C.KEEPS_PER_HEAT,
        "cuts_per_heat": C.CUTS_PER_HEAT,
        "card_index": c,
        "current_card": dealt[-1] if dealt and heat_live else None,
        "dealt_cards": dealt if heat_live else [],
        "seats": seats_public,
        "heat_results": [_heat_reveal_public(state, r) for r in state["heat_results"]],
        "standings": scoring.standings(state),
        "ended_by": state["ended_by"],
    }

    seat = _seat(state, seat_index)
    keeps, cuts = counts(seat, h) if h < len(C.HEAT_DURATIONS) else (0, 0)
    current = decision_for(seat, h, c) if c is not None else None
    private = {
        "seat_index": seat_index,
        "keeps_used": keeps,
        "cuts_used": cuts,
        "keeps_left": C.KEEPS_PER_HEAT - keeps,
        "cuts_left": C.CUTS_PER_HEAT - cuts,
        # This heat's decisions only while it is live: a finished heat's
        # decisions are in `heat_results`, public to every seat.
        "decisions": copy.deepcopy(seat["decisions"][h]) if heat_live else [],
        "current_decision": copy.deepcopy(current),
        "forced_decision": forced_decision(seat, h) if state["phase"] in (C.PHASE_CARD, C.PHASE_CARD_FORCED) else None,
        "forfeited": seat["forfeited"],
    }
    if is_bot and seat["bot_tier"] and heat is not None and c is not None and state["phase"] == C.PHASE_CARD:
        private["bot_tier"] = seat["bot_tier"]
        private["current_card_score"] = heat["cards"][c]["prime_score"]
        private["seen_card_scores"] = [card["prime_score"] for card in heat["cards"][: c + 1]]
        private["cards_left"] = C.CARDS_PER_HEAT - c
    return public, private, legal_commands(state, seat_index)


def seat_indexes(state: dict) -> Iterable[int]:
    return (s["seat_index"] for s in state["seats"])
