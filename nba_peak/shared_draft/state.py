"""SHARED DRAFT rules: a pure state machine over one JSON-serialisable snapshot.

PHASES, each a real server turn (the API adapter opens one per phase):

    arrival --(every human seat has the intro on screen | backstop)--> intro
    intro --(clock)--> pick (seat A) --(pick | clock)--> pick (next seat) ...
    ... the tenth pick --> complete

THE SHARED POOL. One board of `BOARD_SIZE` cards, visible to both seats. A card
either seat drafts is locked out for the other. Each card is dealt at one
position and each seat fills exactly one card per position, so a pick is legal
when the card is still on the board and the seat's slot at that position is
open. With at least two cards per position the draft can never strand a roster
(see `config.CARDS_PER_POSITION`).

THE ORDER. `config.PICK_ORDER` in seat roles; role A is drawn from the seed.

HIDDEN INFORMATION. `project` is a positive allowlist. Nobody sees a card's
PEAK3 score until the draft is complete -- the game is knowing these players,
not reading a number. A BOT seat additionally receives every board card's score
(its stand-in for basketball knowledge, read in `bot.py`, which blunts it).
There is no other secret: every pick is public the instant it is made.

TIMEOUTS never favour the stalling seat: the auto-pick is the first legal card
in BOARD order, and board order is independent of score.
"""
from __future__ import annotations

import copy
import random
from typing import Optional, Sequence

from nba_peak.shared_draft import config as C
from nba_peak.shared_draft.pool import get_latest_season_pool
from nba_peak.twenty_dollar.config import MODEL_VERSION as SHOWDOWN_MODEL_VERSION

REJECT_BAD_PAYLOAD = "bad_payload"
REJECT_NOT_YOUR_TURN = "not_your_turn"
REJECT_NOT_PICKING = "not_picking"
REJECT_CARD_TAKEN = "card_taken"
REJECT_SLOT_FILLED = "slot_filled"
REJECT_NO_SUCH_CARD = "no_such_card"
REJECT_NO_SUCH_SEAT = "no_such_seat"
REJECT_SEAT_FORFEITED = "seat_forfeited"
REJECT_MATCH_COMPLETE = "match_complete"
REJECT_VERSION_MISMATCH = "ruleset_version_mismatch"
REJECT_INTRO_STARTED = "intro_already_started"
REJECT_INTRO_ALREADY_SEEN = "intro_already_seen"
REJECT_WRONG_PICK = "wrong_pick"

#: Card fields every seat may see from the first frame.
IDENTITY_KEYS = ("card_index", "player_slug", "player_name", "position", "peak_season", "team")
#: Card fields revealed to everyone once the draft is complete.
REVEAL_KEYS = ("prime_score", "rank", "components", "row_id")


class RuleError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------


def opener_for(seed: int) -> int:
    """Which seat drafts first (role A). Seeded, so a replay agrees."""
    return random.Random(f"shared_draft:{seed}:opener").randrange(C.SEAT_COUNT)


def pick_order(seed: int) -> list[int]:
    """The seat on the clock for each of the ten picks."""
    a = opener_for(seed)
    b = 1 - a
    return [a if role == 0 else b for role in C.PICK_ORDER]


def generate_board(seed: int) -> dict:
    """The twelve shared cards, a pure function of the seed and the pool.

    Two cards at every position plus `EXTRA_CARDS` more at distinct positions,
    each drawn uniformly from that position's `POSITION_DEPTH` best latest-season
    players. Cards are ordered by position (the board's columns), and within a
    position by a seeded shuffle -- never by score, which is hidden.
    """
    pool = get_latest_season_pool()
    rng = random.Random(f"shared_draft:{seed}:board")
    extras = set(rng.sample(list(C.SLOTS), C.EXTRA_CARDS))
    cards: list[dict] = []
    for slot in C.SLOTS:
        depth = list(pool.depth(slot)[: C.POSITION_DEPTH])
        count = C.CARDS_PER_POSITION + (1 if slot in extras else 0)
        chosen = rng.sample(depth, count)
        for card in chosen:
            cards.append(
                {
                    "player_slug": card.player_slug,
                    "player_name": card.player_name,
                    "position": slot,
                    "peak_season": card.peak_season,
                    "team": card.team,
                    "row_id": card.row_id,
                    "rank": card.rank,
                    "prime_score": card.prime_score,
                    "components": dict(card.components),
                }
            )
    for index, card in enumerate(cards):
        card["card_index"] = index
    return {
        "cards": cards,
        "latest_season": pool.latest_season,
        "model_version": SHOWDOWN_MODEL_VERSION,
    }


def initial_state(seed: int, seats: Sequence[tuple[int, bool]]) -> dict:
    """`seats` is `(seat_index, is_bot)` for both seats."""
    board = generate_board(seed)
    return {
        "ruleset_version": C.RULESET_VERSION,
        "board_version": C.BOARD_VERSION,
        "model_version": board["model_version"],
        "latest_season": board["latest_season"],
        "seed": seed,
        "phase": C.PHASE_ARRIVAL,
        "order": pick_order(seed),
        "pick_index": 0,
        "board": {"cards": board["cards"]},
        "picks": [],
        "seats": [
            {
                "seat_index": index,
                "is_bot": bool(is_bot),
                # A bot has no screen to wait for.
                "intro_seen": bool(is_bot),
                "forfeited": False,
            }
            for index, is_bot in sorted(seats)
        ],
        "ended_by": None,
    }


def assert_supported(state: dict) -> None:
    if state.get("ruleset_version") != C.RULESET_VERSION:
        raise RuleError(REJECT_VERSION_MISMATCH, "This match was dealt under a different ruleset.")


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


def _seat(state: dict, seat_index: int) -> dict:
    for seat in state["seats"]:
        if seat["seat_index"] == seat_index:
            return seat
    raise RuleError(REJECT_NO_SUCH_SEAT, "No such seat.")


def current_seat(state: dict) -> Optional[int]:
    if state["phase"] != C.PHASE_PICK:
        return None
    return state["order"][state["pick_index"]]


def taken_by(state: dict) -> dict[int, int]:
    """card_index -> the seat that drafted it."""
    return {p["card_index"]: p["seat_index"] for p in state["picks"]}


def roster(state: dict, seat_index: int) -> dict[str, Optional[int]]:
    """slot -> drafted card_index (None while open)."""
    cards = state["board"]["cards"]
    slots: dict[str, Optional[int]] = {slot: None for slot in C.SLOTS}
    for pick in state["picks"]:
        if pick["seat_index"] == seat_index:
            slots[cards[pick["card_index"]]["position"]] = pick["card_index"]
    return slots


def open_positions(state: dict, seat_index: int) -> list[str]:
    return [slot for slot, card in roster(state, seat_index).items() if card is None]


def legal_cards(state: dict, seat_index: int) -> list[int]:
    """Cards this seat could draft right now, in board order."""
    taken = taken_by(state)
    need = set(open_positions(state, seat_index))
    return [
        card["card_index"]
        for card in state["board"]["cards"]
        if card["card_index"] not in taken and card["position"] in need
    ]


def _arrived(seat: dict) -> bool:
    return seat["is_bot"] or seat["forfeited"] or bool(seat.get("intro_seen"))


def all_arrived(state: dict) -> bool:
    return all(_arrived(seat) for seat in state["seats"])


def roster_total(state: dict, seat_index: int) -> float:
    cards = state["board"]["cards"]
    return round(
        sum(cards[c]["prime_score"] for c in roster(state, seat_index).values() if c is not None), 6
    )


def component_totals(state: dict, seat_index: int) -> dict[str, float]:
    """The five official weighted contributions, summed over a roster -- a
    report of where its total came from, never a new score."""
    cards = state["board"]["cards"]
    totals: dict[str, float] = {}
    for c in roster(state, seat_index).values():
        if c is None:
            continue
        for key, value in (cards[c].get("components") or {}).items():
            totals[key] = round(totals.get(key, 0.0) + float(value), 6)
    return totals


def placements(state: dict) -> dict[int, tuple[int, str]]:
    """seat_index -> (placement, outcome). A seat that conceded loses outright;
    otherwise the higher roster total wins and equal totals draw."""
    seats = state["seats"]
    forfeited = [s["seat_index"] for s in seats if s["forfeited"]]
    if forfeited:
        return {
            s["seat_index"]: ((2, "loss") if s["forfeited"] else (1, "win")) for s in seats
        }
    totals = {s["seat_index"]: roster_total(state, s["seat_index"]) for s in seats}
    a, b = sorted(totals)
    if totals[a] == totals[b]:
        return {a: (1, "draw"), b: (1, "draw")}
    winner = a if totals[a] > totals[b] else b
    return {seat: ((1, "win") if seat == winner else (2, "loss")) for seat in totals}


# ---------------------------------------------------------------------------
# Transitions. Each returns a NEW state; the input is never mutated.
# ---------------------------------------------------------------------------


def _record(state: dict, seat_index: int, card_index: int, auto: Optional[str]) -> None:
    state["picks"].append(
        {
            "pick_number": state["pick_index"] + 1,
            "seat_index": seat_index,
            "card_index": card_index,
            "auto": auto,
        }
    )
    state["pick_index"] += 1
    if state["pick_index"] >= len(state["order"]):
        state["phase"] = C.PHASE_COMPLETE
        state["ended_by"] = "completed"


def intro_seen(state: dict, seat_index: int) -> dict:
    """A seat's client reports that the intro is on its screen. When every
    human seat has, the intro's own clock starts; nothing else can follow."""
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


def pick(state: dict, seat_index: int, payload: dict) -> dict:
    """Draft one card. `payload` names the card and the pick number it is for,
    so a pick sent for a turn that has already moved on is refused by name."""
    assert_supported(state)
    if state["phase"] == C.PHASE_COMPLETE:
        raise RuleError(REJECT_MATCH_COMPLETE, "The match is over.")
    if state["phase"] != C.PHASE_PICK:
        raise RuleError(REJECT_NOT_PICKING, "The draft has not opened yet.")
    try:
        card_index = int(payload["card_index"])
    except (KeyError, TypeError, ValueError):
        raise RuleError(REJECT_BAD_PAYLOAD, "A pick names the card it takes.") from None
    if "pick_number" in payload:
        try:
            pick_number = int(payload["pick_number"])
        except (TypeError, ValueError):
            raise RuleError(REJECT_BAD_PAYLOAD, "Unreadable pick number.") from None
        if pick_number != state["pick_index"] + 1:
            raise RuleError(REJECT_WRONG_PICK, "That pick has already been made.")
    seat = _seat(state, seat_index)
    if seat["forfeited"]:
        raise RuleError(REJECT_SEAT_FORFEITED, "You conceded this match.")
    if current_seat(state) != seat_index:
        raise RuleError(REJECT_NOT_YOUR_TURN, "It is not your pick.")
    cards = state["board"]["cards"]
    if not 0 <= card_index < len(cards):
        raise RuleError(REJECT_NO_SUCH_CARD, "That card is not on the board.")
    if card_index in taken_by(state):
        raise RuleError(REJECT_CARD_TAKEN, "That player has already been drafted.")
    if cards[card_index]["position"] not in open_positions(state, seat_index):
        raise RuleError(REJECT_SLOT_FILLED, f"Your {cards[card_index]['position']} spot is already filled.")
    next_state = copy.deepcopy(state)
    _record(next_state, seat_index, card_index, None)
    return next_state


def timeout(state: dict) -> dict:
    """The open phase's clock ran out."""
    assert_supported(state)
    phase = state["phase"]
    next_state = copy.deepcopy(state)
    if phase == C.PHASE_ARRIVAL:
        # The backstop: run the intro in full for whoever is here. Never a pick.
        next_state["phase"] = C.PHASE_INTRO
        return next_state
    if phase == C.PHASE_INTRO:
        next_state["phase"] = C.PHASE_PICK
        return next_state
    if phase == C.PHASE_PICK:
        seat = current_seat(next_state)
        legal = legal_cards(next_state, seat)
        if not legal:  # pragma: no cover - two cards per position makes this unreachable
            raise AssertionError("a seat on the clock had no legal pick")
        _record(next_state, seat, legal[0], C.AUTO_TIMEOUT)
        return next_state
    raise RuleError(REJECT_MATCH_COMPLETE, "The match is over.")


def forfeit(state: dict, seat_index: int) -> dict:
    """A seat concedes. In a two-seat draft that ends the match at once: the
    conceding seat loses whatever the rosters say."""
    assert_supported(state)
    if state["phase"] == C.PHASE_COMPLETE:
        raise RuleError(REJECT_MATCH_COMPLETE, "The match is over.")
    if _seat(state, seat_index)["forfeited"]:
        raise RuleError(REJECT_SEAT_FORFEITED, "You already conceded this match.")
    next_state = copy.deepcopy(state)
    _seat(next_state, seat_index)["forfeited"] = True
    next_state["phase"] = C.PHASE_COMPLETE
    next_state["ended_by"] = "forfeit"
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
    if state["phase"] == C.PHASE_PICK and current_seat(state) == seat_index:
        commands.append(C.COMMAND_PICK)
    commands.append(C.COMMAND_FORFEIT)
    return tuple(commands)


def card_identity(card: dict) -> dict:
    return {key: copy.deepcopy(card[key]) for key in IDENTITY_KEYS}


def project(state: dict, seat_index: int, *, is_bot: bool = False) -> tuple[dict, dict, tuple[str, ...]]:
    complete = state["phase"] == C.PHASE_COMPLETE
    taken = taken_by(state)
    pick_numbers = {p["card_index"]: p["pick_number"] for p in state["picks"]}
    cards = []
    for card in state["board"]["cards"]:
        public_card = card_identity(card)
        public_card["drafted_by"] = taken.get(card["card_index"])
        public_card["pick_number"] = pick_numbers.get(card["card_index"])
        if complete:
            for key in REVEAL_KEYS:
                public_card[key] = copy.deepcopy(card[key])
        cards.append(public_card)

    seats_public = []
    for seat in state["seats"]:
        index = seat["seat_index"]
        row = {
            "seat_index": index,
            "is_bot": seat["is_bot"],
            "arrived": _arrived(seat),
            "forfeited": seat["forfeited"],
            "roster": roster(state, index),
            "picks_made": sum(1 for p in state["picks"] if p["seat_index"] == index),
        }
        if complete:
            row["roster_total"] = roster_total(state, index)
            row["component_totals"] = component_totals(state, index)
        seats_public.append(row)

    public = {
        "ruleset_version": state["ruleset_version"],
        "board_version": state["board_version"],
        "model_version": state["model_version"],
        "latest_season": state["latest_season"],
        "phase": state["phase"],
        "slots": list(C.SLOTS),
        "order": list(state["order"]),
        "pick_index": state["pick_index"],
        "pick_count": len(state["order"]),
        "current_seat": current_seat(state),
        "cards": cards,
        "picks": [dict(p) for p in state["picks"]],
        "seats": seats_public,
        "ended_by": state["ended_by"],
    }
    if complete:
        public["placements"] = [
            {"seat_index": i, "placement": p, "outcome": o} for i, (p, o) in sorted(placements(state).items())
        ]

    seat = _seat(state, seat_index)
    private = {
        "seat_index": seat_index,
        "open_positions": open_positions(state, seat_index),
        "legal_cards": legal_cards(state, seat_index) if current_seat(state) == seat_index else [],
        "forfeited": seat["forfeited"],
    }
    if is_bot and not complete:
        # The bot's stand-in for basketball knowledge. Never on a human seat.
        private["card_scores"] = {
            str(card["card_index"]): card["prime_score"] for card in state["board"]["cards"]
        }
    return public, private, legal_commands(state, seat_index)
