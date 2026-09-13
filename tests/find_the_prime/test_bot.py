"""FIND THE PRIME bots: ordered skill, plausible mistakes, no future sight."""
from __future__ import annotations

import asyncio
import copy
import random
import statistics
from types import SimpleNamespace

from nba_peak.find_the_prime import bot as B
from nba_peak.find_the_prime import config as C
from nba_peak.find_the_prime import state as S
from tests.find_the_prime.conftest import coin_policy, play_match, tier_policy


def _round_points(policies, tiers, seeds):
    by_seat = {i: [] for i in range(len(policies))}
    found = {i: [] for i in range(len(policies))}
    for seed in seeds:
        final = play_match(seed, policies, tiers=tiers)
        for result in final["round_results"]:
            for row in result["seats"]:
                by_seat[row["seat_index"]].append(row["points"])
                found[row["seat_index"]].append(row["found_prime"])
    return by_seat, found


def test_mean_round_points_are_strictly_ordered_by_tier_and_the_best_bot_is_beatable():
    tiers = list(C.BOT_TIERS)
    points = {t: [] for t in tiers}
    found = {t: [] for t in tiers}
    for rotation in range(4):
        order = tiers[rotation:] + tiers[:rotation]
        by_seat, by_found = _round_points([tier_policy(t) for t in order], order, range(900 + rotation * 50, 930 + rotation * 50))
        for seat, tier in enumerate(order):
            points[tier].extend(by_seat[seat])
            found[tier].extend(by_found[seat])
    coin, _ = _round_points([coin_policy] * 4, None, range(5000, 5030))

    means = [statistics.mean(points[t]) for t in tiers]
    assert means == sorted(means), dict(zip(tiers, means))
    assert means[0] > statistics.mean(v for seat in coin.values() for v in seat) + 5
    assert means[-1] < 95
    assert sum(found["mvp"]) / len(found["mvp"]) < 0.6


def test_a_weak_bot_misplaces_the_prime_by_a_plausible_stretch_not_at_random():
    # Compare how far (in seasons) Rotation and coin picks land from the best start.
    def distances(policy):
        out = []
        for seed in range(40):
            final = play_match(7000 + seed, [policy] * 4, tiers=["rotation"] * 4)
            for result in final["round_results"]:
                round_ = final["board"]["rounds"][result["round_index"]]
                for row in result["seats"]:
                    out.append(abs(row["start_season_end"] - round_["best_start_season_end"]))
        return statistics.mean(out)

    assert distances(tier_policy("rotation")) < distances(coin_policy)


def test_the_same_view_and_seed_make_the_same_pick():
    state = S.initial_state(99, [(i, True) for i in range(4)])
    state = S.timeout(state)
    public, private, legal = S.project(state, 1, is_bot=True)
    view = SimpleNamespace(public_state=public, private_state=private, legal_commands=legal)
    picks = {asyncio.run(B.FindThePrimeBot().choose(view, random.Random("seed"))).payload["start_season_end"] for _ in range(5)}
    assert len(picks) == 1


def test_a_bot_pick_does_not_change_when_only_future_rounds_change():
    state = S.timeout(S.initial_state(123, [(i, True) for i in range(4)]))
    altered = copy.deepcopy(state)
    for round_ in altered["board"]["rounds"][1:]:
        for window in round_["windows"]:
            window["prime_score"] = 1.0
    for seat in (1, 2, 3):
        a = S.project(state, seat, is_bot=True)
        b = S.project(altered, seat, is_bot=True)
        assert a == b


def test_bot_ratings_are_ordered_like_bot_strength():
    ratings = [C.BOT_TIER_RATINGS[t] for t in C.BOT_TIERS]
    assert ratings == sorted(ratings) and len(set(ratings)) == len(ratings)
    assert len({S.bot_tier_for(11, seat) for seat in range(4)}) == 4
