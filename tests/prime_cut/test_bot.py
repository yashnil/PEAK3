"""PRIME CUT bots: ordered skill, deterministic, and blind to the future."""
from __future__ import annotations

import asyncio
import copy
import random
import statistics
from types import SimpleNamespace

from nba_peak.prime_cut import bot as B
from nba_peak.prime_cut import config as C
from nba_peak.prime_cut import scoring
from nba_peak.prime_cut import state as S
from tests.prime_cut.conftest import coin_policy, play_match, tier_policy


def _captures(policies, tiers, seeds):
    by_seat = {i: [] for i in range(len(policies))}
    for seed in seeds:
        final = play_match(seed, policies, tiers=tiers)
        for heat in final["heat_results"]:
            for row in heat["seats"]:
                by_seat[row["seat_index"]].append(row["capture"])
    return by_seat


def test_mean_heat_capture_is_strictly_ordered_by_tier_and_no_tier_is_perfect():
    tiers = list(C.BOT_TIERS)
    means = {t: [] for t in tiers}
    coin = []
    for rotation in range(4):
        order = tiers[rotation:] + tiers[:rotation]
        by_seat = _captures([tier_policy(t) for t in order], order, range(700 + rotation * 100, 740 + rotation * 100))
        for seat, tier in enumerate(order):
            means[tier].extend(by_seat[seat])
    coin_by_seat = _captures([coin_policy] * 4, None, range(3000, 3040))
    for values in coin_by_seat.values():
        coin.extend(values)

    averages = [statistics.mean(means[t]) for t in tiers]
    assert averages == sorted(averages), dict(zip(tiers, averages))
    assert averages[0] > statistics.mean(coin) + 10  # the weakest bot still plays basketball
    assert averages[-1] < 95  # the strongest still misses
    perfect_rate = sum(1 for v in means["mvp"] if v == 100.0) / len(means["mvp"])
    assert perfect_rate < 0.5


def test_the_same_view_and_seed_make_the_same_call():
    state = S.initial_state(55, [(i, True) for i in range(4)])
    while state["phase"] != C.PHASE_CARD:
        state = S.timeout(state)
    public, private, legal = S.project(state, 1, is_bot=True)
    view = SimpleNamespace(public_state=public, private_state=private, legal_commands=legal)
    calls = {
        asyncio.run(B.PrimeCutBot().choose(view, random.Random("same-seed"))).command_type
        for _ in range(5)
    }
    assert len(calls) == 1


def test_a_bot_decision_does_not_change_when_only_undealt_cards_change():
    state = S.initial_state(77, [(i, True) for i in range(4)])
    while state["phase"] != C.PHASE_CARD:
        state = S.timeout(state)
    altered = copy.deepcopy(state)
    for card in altered["board"]["heats"][0]["cards"][1:]:
        card["prime_score"] = 99.99
    for heat in altered["board"]["heats"][1:]:
        for card in heat["cards"]:
            card["prime_score"] = 1.0
    for seat in (1, 2, 3):
        a = S.project(state, seat, is_bot=True)
        b = S.project(altered, seat, is_bot=True)
        assert a == b
        for _ in range(3):
            view_a = SimpleNamespace(public_state=a[0], private_state=a[1], legal_commands=a[2])
            view_b = SimpleNamespace(public_state=b[0], private_state=b[1], legal_commands=b[2])
            assert (
                asyncio.run(B.PrimeCutBot().choose(view_a, random.Random(seat))).command_type
                == asyncio.run(B.PrimeCutBot().choose(view_b, random.Random(seat))).command_type
            )


def test_a_forced_card_is_taken_without_a_read():
    view = SimpleNamespace(
        public_state={"heat_index": 0, "card_index": 6, "durations": [2, 3, 5]},
        private_state={},  # no score at all -- a forced call must not need one
        legal_commands=(C.COMMAND_CUT, C.COMMAND_FORFEIT),
    )
    command = asyncio.run(B.PrimeCutBot().choose(view, random.Random(1)))
    assert command.command_type == C.COMMAND_CUT
    assert command.payload == {"heat_index": 0, "card_index": 6}


def test_bot_tiers_are_seeded_and_every_tier_is_used():
    assert S.bot_tier_for(123, 2) == S.bot_tier_for(123, 2)
    tiers = {S.bot_tier_for(seed, seat) for seed in range(30) for seat in range(4)}
    assert tiers == set(C.BOT_TIERS)
    # Four seats at one table get four distinct tiers.
    assert len({S.bot_tier_for(9, seat) for seat in range(4)}) == 4


def test_tier_ratings_are_ordered_like_tier_strength():
    ratings = [C.BOT_TIER_RATINGS[t] for t in C.BOT_TIERS]
    assert ratings == sorted(ratings) and len(set(ratings)) == len(ratings)
    assert scoring  # placement helpers used by the rating pass are importable
