"""PRIME CUT scoring: heat capture, match score and placement tie-breaks."""
from __future__ import annotations

import pytest

from nba_peak.prime_cut import config as C
from nba_peak.prime_cut import scoring
from nba_peak.prime_modes.placement import competition_placements


def test_heat_capture_is_zero_to_one_hundred_on_the_board_itself():
    scores = [90.0, 85.0, 80.0, 75.0, 70.0, 65.0, 60.0, 55.0]
    optimal, floor = sum(scores[:4]), sum(scores[4:])
    assert scoring.heat_capture(optimal, optimal, floor) == 100.0
    assert scoring.heat_capture(floor, optimal, floor) == 0.0
    # Swapping the 4th best (75) for the 5th best (70): lose 5 of a 80-point range.
    assert scoring.heat_capture(optimal - 75 + 70, optimal, floor) == pytest.approx(93.75)


def test_a_heat_with_no_spread_cannot_be_scored():
    with pytest.raises(ValueError):
        scoring.heat_capture(200.0, 200.0, 200.0)


def _state_with_heats(heats: list[dict]) -> dict:
    return {
        "seats": [{"seat_index": i, "forfeited": False, "forfeit_order": None} for i in range(4)],
        "heat_results": heats,
    }


def _heat(duration: int, rows: dict[int, tuple[float, int, float]], optimal_total: float = 300.0) -> dict:
    return {
        "duration": duration,
        "optimal_total": optimal_total,
        "seats": [
            {"seat_index": seat, "capture": cap, "optimal_kept": kept, "kept_total": total}
            for seat, (cap, kept, total) in rows.items()
        ],
    }


def test_the_match_score_is_the_plain_mean_of_heats_so_no_duration_dominates():
    state = _state_with_heats([
        _heat(2, {0: (100.0, 4, 300.0), 1: (50.0, 2, 250.0), 2: (0.0, 0, 200.0), 3: (70.0, 3, 280.0)}),
        _heat(3, {0: (40.0, 2, 240.0), 1: (50.0, 2, 250.0), 2: (100.0, 4, 300.0), 3: (70.0, 3, 280.0)}),
        _heat(5, {0: (70.0, 3, 270.0), 1: (50.0, 2, 250.0), 2: (80.0, 3, 290.0), 3: (70.0, 3, 280.0)}),
    ])
    totals = scoring.seat_totals(state, 0)
    assert totals["match_score"] == 70.0
    assert totals["heat_scores"] == {"2": 100.0, "3": 40.0, "5": 70.0}
    assert totals["optimal_keeps"] == 9


def test_tie_breaks_are_optimal_keeps_then_captured_value_then_a_shared_placement():
    state = _state_with_heats([
        _heat(2, {
            0: (80.0, 3, 280.0),   # same score, MORE optimal keeps
            1: (80.0, 2, 290.0),   # same score, fewer optimal keeps, higher value
            2: (80.0, 2, 280.0),   # same score & keeps as 3, lower value
            3: (80.0, 2, 280.0),
        }),
    ])
    # Seats 2 and 3 are identical on every key.
    places = scoring.placements(state)
    assert places[0] == (1, "win")
    assert places[1] == (2, "loss")
    assert places[2] == (3, "loss") and places[3] == (3, "loss")


def test_a_forfeited_seat_places_below_every_seat_that_played_on():
    placements = competition_placements(
        [(0, (99.0,)), (1, (10.0,)), (2, (50.0,)), (3, (98.0,))],
        forfeit_order={0: 1, 3: 0},
    )
    assert placements[2] == (1, "win")
    assert placements[1] == (2, "loss")
    # The later forfeit (seat 0) above the earlier one (seat 3).
    assert placements[0] == (3, "loss")
    assert placements[3] == (4, "loss")


def test_a_tie_for_first_is_a_draw_for_every_seat_in_it():
    placements = competition_placements([(0, (5.0,)), (1, (5.0,)), (2, (4.0,)), (3, (4.0,))])
    assert placements == {0: (1, "draw"), 1: (1, "draw"), 2: (3, "loss"), 3: (3, "loss")}


def test_speed_is_not_a_placement_input():
    # The placement key is exactly (match score, optimal keeps, captured value).
    key = scoring.placement_key({"match_score": 1.0, "optimal_keeps": 2, "captured_ratio": 0.5})
    assert key == (1.0, 2, 0.5)
    assert C.KEEPS_PER_HEAT == 4 and C.CUTS_PER_HEAT == 4
