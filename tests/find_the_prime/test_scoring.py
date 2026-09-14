"""FIND THE PRIME scoring: closeness in canonical score, never a cliff."""
from __future__ import annotations

import pytest

from nba_peak.find_the_prime import board as BD
from nba_peak.find_the_prime import config as C
from nba_peak.find_the_prime import scoring as SC
from nba_peak.prime_modes.placement import competition_placements


def test_the_exact_best_window_scores_the_maximum():
    assert SC.round_score(95.0, 95.0, 20.0) == (100.0, 0.0, True)


def test_an_effectively_tied_window_scores_the_maximum_and_counts_as_found():
    points, regret, found = SC.round_score(95.0, 95.0 - C.EQUIVALENT_REGRET, 20.0)
    assert points == 100.0 and found and regret == pytest.approx(C.EQUIVALENT_REGRET)


def test_a_slightly_mistimed_strong_window_still_scores_well():
    points, _, found = SC.round_score(95.0, 93.0, 20.0)
    assert points == 90.0 and not found


def test_a_clearly_wrong_part_of_the_career_loses_meaningful_points():
    assert SC.round_score(95.0, 80.0, 20.0)[0] == 25.0
    assert SC.round_score(95.0, 60.0, 20.0)[0] == 0.0


def test_score_is_monotone_in_canonical_score_with_no_cliffs():
    previous = None
    for tenths in range(0, 400):
        chosen = 95.0 - tenths / 10
        points = SC.round_score(95.0, chosen, 20.0)[0]
        if previous is not None:
            assert points <= previous
            # Outside the equivalence band's one upward rounding, a 0.1-point
            # canonical difference moves the round by at most half a point.
            if tenths / 10 > C.EQUIVALENT_REGRET + 0.1:
                assert previous - points <= 0.5 + 1e-9
        previous = points


def test_a_non_positive_scale_cannot_be_scored():
    with pytest.raises(ValueError):
        SC.round_score(90.0, 80.0, 0.0)


def test_no_answer_scores_zero_with_the_maximum_regret():
    round_ = BD.generate_board(5)["rounds"][0]
    answer = SC.score_answer(round_, None)
    assert answer["points"] == 0.0 and not answer["found_prime"]
    assert answer["regret"] == pytest.approx(round_["best_score"] - round_["floor"], abs=1e-4)
    worst = min(round_["windows"], key=lambda w: w["prime_score"])
    assert SC.score_answer(round_, worst["start_season_end"])["regret"] <= answer["regret"]


def _state(rows: dict[int, list[tuple[float, bool, float]]]) -> dict:
    rounds = len(next(iter(rows.values())))
    return {
        "seats": [{"seat_index": i, "forfeited": False, "forfeit_order": None} for i in rows],
        "round_results": [
            {"seats": [
                {"seat_index": i, "points": rows[i][r][0], "found_prime": rows[i][r][1], "regret": rows[i][r][2],
                 "window_id": "w"}
                for i in rows
            ]}
            for r in range(rounds)
        ],
    }


def test_tie_breaks_are_found_primes_then_lower_regret_then_a_shared_placement():
    state = _state({
        0: [(100.0, True, 0.0), (50.0, False, 10.0)],   # 150, 1 found
        1: [(90.0, False, 1.0), (60.0, False, 8.0)],    # 150, 0 found, regret 9
        2: [(80.0, False, 2.0), (70.0, False, 5.0)],    # 150, 0 found, regret 7 -> above seat 1
        3: [(80.0, False, 2.0), (70.0, False, 5.0)],    # identical to seat 2
    })
    places = SC.placements(state)
    assert places[0] == (1, "win")
    assert places[2] == (2, "loss") and places[3] == (2, "loss")
    assert places[1] == (4, "loss")


def test_the_match_maximum_is_nine_hundred():
    assert C.MAX_MATCH_SCORE == 900.0 and C.ROUND_COUNT == 9
    assert competition_placements([(0, (900.0, 9, 0.0))]) == {0: (1, "win")}
