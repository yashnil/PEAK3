"""Shared fixtures and drivers for the ascending-auction tests.

`play_match` is here rather than in one test module because four modules need
it and a second copy is a second thing that can stop matching the rules.
"""
from __future__ import annotations

import random
from typing import Callable, Optional

import pytest

from nba_peak.twenty_dollar import feasibility, rules
from nba_peak.twenty_dollar import state as S
from nba_peak.twenty_dollar.bot import TwentyDollarBot
from nba_peak.twenty_dollar.config import ROSTER_SIZE, SLOTS
from nba_peak.twenty_dollar.pool import get_pool


@pytest.fixture(scope="session")
def pool():
    return get_pool()


#: A strategy takes `(state, seat_index, pool, rng)` and returns
#: `(command, amount)`.
Strategy = Callable[[dict, int, object, random.Random], "tuple[str, int]"]


def always_pass(state, seat_index, pool, rng):
    """Decline everything that CAN be declined.

    Not "always pass" any more, because a pass is no longer always legal: a
    seat out of market skips facing a candidate it could use, with nothing
    bid, must open. That is the rule the skip economy exists to create, so the
    driver honours it rather than submitting a command the server refuses --
    the resulting line (skip five times, then open at the minimum forever) IS
    the maximally passive strategy under v3, and is what the termination tests
    want to exercise.
    """
    if S.COMMAND_PASS in S.legal_commands(state, seat_index, pool):
        return S.COMMAND_PASS, 0
    return S.COMMAND_BID, rules.minimum_bid(state["current_bid"])


def always_min_raise(state, seat_index, pool, rng):
    """Bid the minimum legal increment forever. The most aggressive legal line,
    and the one that most reliably exhausts a budget -- which is what makes it
    the right driver for the solvency invariant."""
    if S.COMMAND_BID not in S.legal_commands(state, seat_index, pool):
        return S.COMMAND_PASS, 0
    return S.COMMAND_BID, rules.minimum_bid(state["current_bid"])


def random_legal(state, seat_index, pool, rng):
    commands = S.legal_commands(state, seat_index, pool)
    if S.COMMAND_BID not in commands:
        return S.COMMAND_PASS, 0
    if rng.random() < 0.35 and S.COMMAND_PASS in commands:
        return S.COMMAND_PASS, 0
    seat = state["seats"][seat_index]
    floor = rules.minimum_bid(state["current_bid"])
    ceiling = rules.max_legal_bid(seat["budget"], len(seat["roster"]))
    if floor > ceiling:
        return S.COMMAND_PASS, 0
    return S.COMMAND_BID, rng.randint(floor, ceiling)


def bot_strategy(
    bot: Optional[TwentyDollarBot] = None, *, with_tier: bool = True
) -> Strategy:
    """Drive a seat with the shipped policy, exactly as the server drives it.

    `with_tier` mirrors what `app/services/twenty_dollar/mode.py::project` does
    for a BOT seat and only for a bot seat: it adds the coarse draw-tier label
    to the private projection. Reproducing it here matters -- without it these
    tests would be calibrating a bot that values every candidate identically,
    which is not the bot that ships.

    Pass `with_tier=False` to assert the opposite property: that a policy
    handed a human seat's projection still plays legally, just blindly.
    """
    policy = bot or TwentyDollarBot()

    def play(state, seat_index, pool, rng):
        public, private, _ = S.project(state, seat_index, pool)
        if with_tier:
            private = {**private, "candidate_tier": state.get("current_candidate_tier")}
        command, payload = policy.decide(public, private, rng)
        return command, int(payload.get("amount", 0))

    return play


def play_match(
    seed: int,
    pool,
    strategy: Strategy = random_legal,
    seat_strategies: Optional[dict[int, Strategy]] = None,
    max_actions: int = 4000,
) -> dict:
    """Drive one full match, one ACTION at a time. Returns the terminal state.

    One action at a time is the whole point: an ascending auction has exactly
    one seat on the clock, and a driver that looped over seats would be testing
    a game nobody plays.
    """
    state = S.initial_state(seed=seed)
    rng = random.Random(seed ^ 0x5EED)
    actions = 0
    while not S.is_complete(state):
        actions += 1
        assert actions < max_actions, "match did not terminate"
        seat_index = state["active_seat"]
        assert seat_index is not None, "a live match always has a seat on the clock"
        play = (seat_strategies or {}).get(seat_index, strategy)
        command, amount = play(state, seat_index, pool, rng)
        _, code, message = S.submit_action(state, seat_index, command, amount, pool)
        assert code is None, f"unexpected rejection {code}: {message}"
    return state


def assert_terminal_state_is_legal(state, pool):
    for seat in state["seats"]:
        assert len(seat["roster"]) == ROSTER_SIZE
        assert seat["budget"] >= 0
        owned = [
            (entry["player_slug"], pool.get(entry["player_slug"]).positions)
            for entry in seat["roster"]
        ]
        fit = feasibility.evaluate(owned, (), require_future=False)
        assert fit.feasible, "a completed roster has no legal seating"
        assert len(set(fit.assignment.values())) == ROSTER_SIZE
        assert set(fit.assignment) == set(SLOTS)
    # No player may appear on both rosters.
    slugs = [e["player_slug"] for seat in state["seats"] for e in seat["roster"]]
    assert len(slugs) == len(set(slugs))
