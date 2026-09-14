"""A pure driver for FIND THE PRIME matches, shared by the rules tests.

Walks the state machine the way the Arena foundation does: clock expiry is
`state.timeout`, a lock is `state.lock`, and bot seats choose through
`bot.choose_start` reading ONLY their own projection.
"""
from __future__ import annotations

import random
from typing import Callable, Optional

from nba_peak.find_the_prime import bot as B
from nba_peak.find_the_prime import config as C
from nba_peak.find_the_prime import state as S

#: (public, private, rng) -> start_season_end, or None to leave the seat silent.
Policy = Callable[[dict, dict, random.Random], Optional[int]]


def tier_policy(tier: str) -> Policy:
    def choose(public: dict, private: dict, rng: random.Random) -> Optional[int]:
        return B.choose_start(tier=tier, window_scores=private["window_scores"], rng=rng)

    return choose


def coin_policy(public: dict, private: dict, rng: random.Random) -> Optional[int]:
    return rng.choice(public["prompt"]["legal_starts"])


def first_window_policy(public: dict, private: dict, rng: random.Random) -> Optional[int]:
    return public["prompt"]["legal_starts"][0]


def silent_policy(public: dict, private: dict, rng: random.Random) -> Optional[int]:
    return None


def play_match(
    seed: int,
    policies: list[Policy],
    *,
    tiers: Optional[list[str]] = None,
    on_state: Optional[Callable[[dict], None]] = None,
) -> dict:
    state = S.initial_state(seed, [(i, True) for i in range(len(policies))])
    if tiers:
        for seat, tier in zip(state["seats"], tiers):
            seat["bot_tier"] = tier
    turn = 0
    while state["phase"] != C.PHASE_COMPLETE:
        if on_state:
            on_state(state)
        if state["phase"] != C.PHASE_DECIDE:
            state = S.timeout(state)
            turn += 1
            continue
        progressed = False
        for seat in list(state["seats"]):
            index = seat["seat_index"]
            if S._seat(state, index)["locked"] is not None or S._seat(state, index)["forfeited"]:
                continue
            public, private, _ = S.project(state, index, is_bot=True)
            start = policies[index](public, private, random.Random(f"test:{seed}:{index}:{turn}"))
            if start is None:
                continue
            state = S.lock(state, index, {"round_index": public["round_index"], "start_season_end": start})
            progressed = True
            if state["phase"] != C.PHASE_DECIDE:
                break
        if state["phase"] == C.PHASE_DECIDE and not S.all_locked(state):
            # Somebody stayed silent: the clock resolves the round.
            state = S.timeout(state)
        elif not progressed and state["phase"] == C.PHASE_DECIDE:
            state = S.timeout(state)
        turn += 1
    return state


def find_values(obj, predicate) -> list:
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
