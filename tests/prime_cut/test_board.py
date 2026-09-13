"""PRIME CUT boards: deterministic, fair to every seat, and worth playing."""
from __future__ import annotations

import statistics

import pandas as pd
import pytest

from nba_peak.prime_cut import config as C
from nba_peak.prime_cut.board import (
    BoardGenerationError,
    generate_board,
    heat_quality,
)
from nba_peak.prime_cut.pool import get_pool
from nba_peak.prime_modes.artifact import REPO_ROOT, load_artifact

SEEDS = range(0, 1500)


@pytest.fixture(scope="module")
def boards():
    return {seed: generate_board(seed) for seed in SEEDS}


def test_the_same_seed_deals_the_same_board():
    assert generate_board(123456) == generate_board(123456)


def test_a_different_seed_deals_a_different_board():
    a = [c["window_id"] for h in generate_board(1)["heats"] for c in h["cards"]]
    b = [c["window_id"] for h in generate_board(2)["heats"] for c in h["cards"]]
    assert a != b


def test_every_generated_heat_passes_the_quality_gate(boards):
    for seed, board in boards.items():
        assert [h["duration"] for h in board["heats"]] == [2, 3, 5]
        used: set[str] = set()
        for heat in board["heats"]:
            cards = heat["cards"]
            assert [c["card_index"] for c in cards] == list(range(C.CARDS_PER_HEAT))
            quality = heat_quality(
                [c["prime_score"] for c in cards],
                [c["canonical_rank"] for c in cards],
                [c["player_slug"] for c in cards],
            )
            assert quality.ok, (seed, heat["heat_index"], quality.reasons)
            assert heat["generation"]["attempt"] < C.MAX_GENERATION_ATTEMPTS
            players = {c["player_slug"] for c in cards}
            assert not players & used, f"seed {seed}: a player repeated across heats"
            used |= players
            assert len({c["window_id"] for c in cards}) == C.CARDS_PER_HEAT


def test_generation_never_comes_close_to_its_attempt_budget(boards):
    worst = max(h["generation"]["attempt"] for b in boards.values() for h in b["heats"])
    assert worst < C.MAX_GENERATION_ATTEMPTS // 10


def test_the_deal_order_carries_no_information_about_strength(boards):
    # Position of the heat's best card, averaged over many seeds, must sit near
    # the middle of eight (3.5). A generator that dealt strength in order would
    # land near 0 or 7.
    positions = []
    for board in boards.values():
        for heat in board["heats"]:
            best = max(heat["cards"], key=lambda c: c["prime_score"])
            positions.append(best["card_index"])
    assert abs(statistics.mean(positions) - 3.5) < 0.25


def test_the_cut_line_threshold_is_derived_from_the_real_score_distribution():
    distribution = load_artifact().metadata["distribution"]
    worst_adjacent_p90 = max(distribution[str(n)]["board_adjacent_gap"]["p90"] for n in C.HEAT_DURATIONS)
    # A cut line must be wider than the gap between neighbouring players on the
    # canonical board nine times in ten, for every duration.
    assert C.CUT_LINE_MIN_GAP >= worst_adjacent_p90


def test_cards_are_canonical_best_windows_of_fully_covered_careers(boards):
    artifact = load_artifact()
    csvs = {n: pd.read_csv(REPO_ROOT / "leaderboards" / f"top_250_{n}_year_prime.csv") for n in C.HEAT_DURATIONS}
    for board in list(boards.values())[:200]:
        for heat in board["heats"]:
            n = heat["duration"]
            for card in heat["cards"]:
                career = artifact.player(card["player_slug"])
                assert career.career_fully_covered
                best = career.best(n)
                assert card["window_id"] == best.window_id
                assert card["prime_score"] == best.prime_score
                assert card["canonical_rank"] <= C.POOL_RANK_CAP
                row = csvs[n][csvs[n]["Player"] == career.player_name].iloc[0]
                assert float(row["Prime display"]) == card["prime_score"]
                assert int(row["Rank"]) == card["canonical_rank"]


def test_the_pool_excludes_truncated_careers():
    for n in C.HEAT_DURATIONS:
        slugs = {c.player_slug for c in get_pool(n)}
        assert "kareem-abdul-jabbar" not in slugs
        assert len(slugs) >= 3 * C.CARDS_PER_HEAT


@pytest.mark.parametrize(
    "scores, ranks, players, reason",
    [
        ([90, 85, 80, 70.5, 70.0, 60, 55, 50], [30] * 8, list("abcdefgh"), "ambiguous_cut_line"),
        # A valid 1.2-point cut line, but only 6.0 points between the top and
        # bottom fours -- too narrow for capture to mean anything.
        ([60.0, 59.9, 59.8, 59.7, 58.5, 58.4, 58.3, 58.2], [60] * 8, list("abcdefgh"), "insufficient_spread"),
        ([95, 94, 93, 92, 60, 59, 58, 57], [60] * 8, list("abcdefgh"), "no_close_decisions"),
        ([90, 85, 80, 75, 72, 68, 64, 60], [1, 2, 3, 4, 50, 60, 70, 80], list("abcdefgh"), "too_many_marquee_peaks"),
        ([90, 85, 80, 75, 72, 68, 64, 60], [30] * 8, list("abcdefga"), "duplicate_player"),
    ],
)
def test_the_quality_gate_rejects_each_kind_of_bad_heat(scores, ranks, players, reason):
    quality = heat_quality(scores, ranks, players)
    assert not quality.ok
    assert reason in quality.reasons


def test_an_impossible_constraint_fails_loudly_rather_than_dealing_a_bad_heat(monkeypatch):
    monkeypatch.setattr(C, "CUT_LINE_MIN_GAP", 1_000.0)
    monkeypatch.setattr(C, "MAX_GENERATION_ATTEMPTS", 5)
    with pytest.raises(BoardGenerationError):
        generate_board(7)
