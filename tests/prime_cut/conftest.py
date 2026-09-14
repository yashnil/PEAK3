"""A pure driver for PRIME CUT matches, shared by the rules tests.

`play_match` walks the state machine exactly the way the Arena foundation
does: a clock expiry is `state.timeout`, a decision is `state.decide`, and bot
seats decide through `bot.decide_keep` reading ONLY their own projection.
"""
from __future__ import annotations

import random
from typing import Callable, Optional

from nba_peak.prime_cut import bot as B
from nba_peak.prime_cut import config as C
from nba_peak.prime_cut import state as S

Policy = Callable[[dict, dict, tuple, random.Random], str]


def tier_policy(tier: str) -> Policy:
    def choose(public: dict, private: dict, legal: tuple, rng: random.Random) -> str:
        cmds = [c for c in legal if c in (C.COMMAND_KEEP, C.COMMAND_CUT)]
        if len(cmds) == 1:
            return cmds[0]
        keep = B.decide_keep(
            tier=tier,
            duration=public["durations"][public["heat_index"]],
            current_score=private["current_card_score"],
            seen_scores=list(private["seen_card_scores"]),
            keeps_left=private["keeps_left"],
            cards_left=private["cards_left"],
            rng=rng,
        )
        return C.COMMAND_KEEP if keep else C.COMMAND_CUT

    return choose


def coin_policy(public: dict, private: dict, legal: tuple, rng: random.Random) -> str:
    return rng.choice([c for c in legal if c in (C.COMMAND_KEEP, C.COMMAND_CUT)])


def keep_first_policy(public: dict, private: dict, legal: tuple, rng: random.Random) -> str:
    return C.COMMAND_KEEP if C.COMMAND_KEEP in legal else C.COMMAND_CUT


def to_decision(command: str) -> str:
    return C.DECISION_KEEP if command == C.COMMAND_KEEP else C.DECISION_CUT


def play_match(
    seed: int,
    policies: list[Policy],
    *,
    tiers: Optional[list[str]] = None,
    on_state: Optional[Callable[[dict], None]] = None,
) -> dict:
    """Play one full match; every seat is a bot seat with the given policy."""
    state = S.initial_state(seed, [(i, True) for i in range(len(policies))])
    if tiers:
        for seat, tier in zip(state["seats"], tiers):
            seat["bot_tier"] = tier
    turn = 0
    while state["phase"] != C.PHASE_COMPLETE:
        if on_state:
            on_state(state)
        if state["phase"] != C.PHASE_CARD:
            state = S.timeout(state)
            turn += 1
            continue
        seat_index = S.undecided_seats(state)[0]
        public, private, legal = S.project(state, seat_index, is_bot=True)
        rng = random.Random(f"test:{seed}:{seat_index}:{turn}")
        command = policies[seat_index](public, private, legal, rng)
        before = (state["heat_index"], state["card_index"])
        state = S.decide(
            state,
            seat_index,
            to_decision(command),
            {"heat_index": public["heat_index"], "card_index": public["card_index"]},
        )
        if (state["heat_index"], state["card_index"]) != before:
            turn += 1
    return state


def find_values(obj, predicate) -> list:
    """Every leaf value (or dict key) anywhere in `obj` for which predicate holds."""
    found = []
    if isinstance(obj, dict):
        for key, value in obj.items():
            if predicate(key):
                found.append(key)
            found.extend(find_values(value, predicate))
    elif isinstance(obj, (list, tuple)):
        for value in obj:
            found.extend(find_values(value, predicate))
    elif predicate(obj):
        found.append(obj)
    return found
