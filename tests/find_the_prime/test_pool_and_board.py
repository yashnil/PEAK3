"""FIND THE PRIME prompts: who may be asked, how each scales, and the deal."""
from __future__ import annotations

from collections import Counter
from statistics import median

import pytest

from nba_peak.find_the_prime import board as BD
from nba_peak.find_the_prime import config as C
from nba_peak.find_the_prime import pool as P
from nba_peak.prime_modes.artifact import load_artifact


@pytest.mark.parametrize("duration", P.DURATIONS)
def test_every_prompt_is_a_fully_covered_recognisable_varied_career(duration):
    prompts = P.prompts(duration)
    assert len(prompts) >= 3 * C.ROUND_COUNT  # far more than one match could use
    for prompt in prompts:
        career = load_artifact().player(prompt.player_slug)
        assert career.career_fully_covered
        assert prompt.canonical_rank <= C.POOL_RANK_CAP
        assert len(prompt.windows) >= C.MIN_WINDOWS[duration]
        scores = [w.prime_score for w in prompt.windows]
        assert max(scores) - median(scores) >= C.MIN_BEST_OVER_MEDIAN
        assert prompt.best.prime_score == max(scores)


def test_near_identical_careers_and_truncated_careers_are_never_asked():
    for duration in P.DURATIONS:
        slugs = {p.player_slug for p in P.prompts(duration)}
        # PEAK3 rates Jordan's 3Y windows 92.75-95.54: a coin flip, not a question.
        assert "michael-jordan" not in slugs
        assert "kareem-abdul-jabbar" not in slugs


def test_scale_bounds_are_derived_from_the_eligible_pool_and_pinned():
    # Pinned so a new artifact version cannot move scoring silently; update
    # these together with the design doc if the artifact is rebuilt.
    assert P.scale_bounds(2) == pytest.approx((20.469, 38.555), abs=0.01)
    assert P.scale_bounds(3) == pytest.approx((13.417, 31.6725), abs=0.01)
    assert P.scale_bounds(5) == pytest.approx((9.59, 26.4125), abs=0.01)
    for duration in P.DURATIONS:
        low, high = P.scale_bounds(duration)
        for prompt in P.prompts(duration):
            assert low <= P.scale_for(prompt) <= high


def test_the_equivalence_band_is_derived_from_the_real_score_distribution():
    gaps = [load_artifact().metadata["distribution"][str(n)]["board_adjacent_gap"]["p90"] for n in (2, 3, 5)]
    assert min(gaps) <= C.EQUIVALENT_REGRET <= max(gaps)


def test_a_board_is_nine_rounds_three_per_duration_with_no_repeated_player():
    for seed in range(400):
        board = BD.generate_board(seed)
        rounds = board["rounds"]
        assert [r["round_index"] for r in rounds] == list(range(9))
        assert Counter(r["duration"] for r in rounds) == {2: 3, 3: 3, 5: 3}
        assert len({r["player_slug"] for r in rounds}) == 9
        for r in rounds:
            assert r["best_window_id"] in r["equivalent_window_ids"]
            starts = [w["start_season_end"] for w in r["windows"]]
            assert starts == sorted(starts)
            assert all(w["end_season_end"] - w["start_season_end"] == r["duration"] - 1 for w in r["windows"])


def test_the_same_seed_deals_the_same_board_and_order_is_seeded():
    assert BD.generate_board(31337) == BD.generate_board(31337)
    orders = {tuple(r["duration"] for r in BD.generate_board(seed)["rounds"]) for seed in range(60)}
    assert len(orders) > 20  # the duration order genuinely varies by seed


def test_a_dealt_round_carries_everything_needed_to_score_it_forever():
    round_ = BD.generate_board(8)["rounds"][0]
    for key in ("windows", "best_window_id", "equivalent_window_ids", "best_score", "floor", "scale"):
        assert key in round_
    assert round_["floor"] == min(w["prime_score"] for w in round_["windows"])
