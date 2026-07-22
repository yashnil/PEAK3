"""Glicko-2 reference-vector and property tests (spec V.1-V.8).

test_reference_vector_matches_published_example is the load-bearing test:
it reproduces Mark Glickman's own worked example from "Example of the
Glicko-2 system" verbatim, proving this is the published algorithm and not
a plausible-looking approximation (ADR-004 §6).
"""
from __future__ import annotations

import pytest

from app.services.ranked.glicko2 import (
    Glicko2ConvergenceError,
    Glicko2Opponent,
    Glicko2Rating,
    apply_inactivity_rd_growth,
    initial_rating,
    rate_match,
    rate_period,
)


def test_reference_vector_matches_published_example() -> None:
    """Glickman's paper: player (1500, 200, 0.06) vs three opponents with
    tau=0.5 -> new rating ~1464.06, new RD ~151.52, new volatility ~0.05999.
    """
    player = Glicko2Rating(rating=1500.0, rd=200.0, volatility=0.06)
    opponents = [
        Glicko2Opponent(rating=1400.0, rd=30.0, score=1.0),
        Glicko2Opponent(rating=1550.0, rd=100.0, score=0.0),
        Glicko2Opponent(rating=1700.0, rd=300.0, score=0.0),
    ]

    result = rate_period(player, opponents, tau=0.5)

    assert result.rating == pytest.approx(1464.06, abs=0.01)
    assert result.rd == pytest.approx(151.52, abs=0.01)
    assert result.volatility == pytest.approx(0.05999, abs=0.00001)


def test_determinism_identical_input_identical_output() -> None:
    player = Glicko2Rating(rating=1620.3, rd=88.1, volatility=0.0602)
    args = (1550.0, 120.0, 1.0)

    r1 = rate_match(player, *args)
    r2 = rate_match(player, *args)

    assert r1 == r2


def test_determinism_across_many_repeats() -> None:
    player = Glicko2Rating(rating=1500.0, rd=200.0, volatility=0.06)
    results = {rate_match(player, 1400.0, 30.0, 1.0) for _ in range(50)}
    assert len(results) == 1


def test_win_increases_rating() -> None:
    player = initial_rating()
    result = rate_match(player, opponent_rating=1500.0, opponent_rd=100.0, score=1.0)
    assert result.rating > player.rating


def test_loss_decreases_rating() -> None:
    player = initial_rating()
    result = rate_match(player, opponent_rating=1500.0, opponent_rd=100.0, score=0.0)
    assert result.rating < player.rating


def test_draw_against_equal_opponent_holds_rating_roughly_steady() -> None:
    player = Glicko2Rating(rating=1600.0, rd=60.0, volatility=0.06)
    result = rate_match(player, opponent_rating=1600.0, opponent_rd=60.0, score=0.5)
    assert result.rating == pytest.approx(player.rating, abs=1.0)


def test_win_against_lower_rated_moves_rating_less_than_win_vs_higher_rated() -> None:
    player = Glicko2Rating(rating=1500.0, rd=100.0, volatility=0.06)
    beat_weaker = rate_match(player, opponent_rating=1200.0, opponent_rd=100.0, score=1.0)
    beat_stronger = rate_match(player, opponent_rating=1800.0, opponent_rd=100.0, score=1.0)
    assert (beat_stronger.rating - player.rating) > (beat_weaker.rating - player.rating)


def test_higher_rd_opponent_produces_less_confident_update() -> None:
    """Beating a highly-uncertain (high RD) opponent should move the rating
    less than beating an equally-rated but low-RD (well-established) opponent
    — the win carries less information when the opponent's own rating is
    uncertain.
    """
    player = Glicko2Rating(rating=1500.0, rd=100.0, volatility=0.06)
    vs_confident_opponent = rate_match(player, opponent_rating=1500.0, opponent_rd=30.0, score=1.0)
    vs_uncertain_opponent = rate_match(player, opponent_rating=1500.0, opponent_rd=350.0, score=1.0)

    confident_delta = vs_confident_opponent.rating - player.rating
    uncertain_delta = vs_uncertain_opponent.rating - player.rating
    assert confident_delta > uncertain_delta


def test_provisional_player_moves_more_than_established_player() -> None:
    """A player with high RD (provisional/new) should see a larger rating
    swing from the same result than a low-RD (established) player.
    """
    opponent = (1500.0, 100.0, 1.0)
    provisional = Glicko2Rating(rating=1500.0, rd=300.0, volatility=0.06)
    established = Glicko2Rating(rating=1500.0, rd=50.0, volatility=0.06)

    provisional_result = rate_match(provisional, *opponent)
    established_result = rate_match(established, *opponent)

    provisional_delta = abs(provisional_result.rating - provisional.rating)
    established_delta = abs(established_result.rating - established.rating)
    assert provisional_delta > established_delta


def test_no_games_widens_rd_only() -> None:
    player = Glicko2Rating(rating=1500.0, rd=50.0, volatility=0.06)
    result = rate_period(player, [])
    assert result.rating == player.rating
    assert result.volatility == player.volatility
    assert result.rd > player.rd


def test_inactivity_rd_growth_widens_toward_max_and_never_exceeds_it() -> None:
    player = Glicko2Rating(rating=1500.0, rd=40.0, volatility=0.06)
    grown = apply_inactivity_rd_growth(player, elapsed_days=90.0, c=34.6, rd_max=350.0)
    assert grown.rd > player.rd
    assert grown.rd <= 350.0
    assert grown.rating == player.rating
    assert grown.volatility == player.volatility

    far_future = apply_inactivity_rd_growth(player, elapsed_days=100_000.0, c=34.6, rd_max=350.0)
    assert far_future.rd == 350.0


def test_zero_elapsed_inactivity_is_a_no_op() -> None:
    player = Glicko2Rating(rating=1500.0, rd=50.0, volatility=0.06)
    assert apply_inactivity_rd_growth(player, elapsed_days=0.0, c=34.6, rd_max=350.0) == player


def test_convergence_error_is_explicit_not_silent() -> None:
    """A pathological, near-zero epsilon combined with a tiny max_iterations
    bound must raise rather than return a value that never actually converged.
    """
    player = Glicko2Rating(rating=1500.0, rd=200.0, volatility=0.06)
    with pytest.raises(Glicko2ConvergenceError):
        rate_match(
            player,
            opponent_rating=1900.0,
            opponent_rd=25.0,
            score=1.0,
            epsilon=1e-15,
            max_iterations=1,
        )


def test_invalid_score_rejected() -> None:
    with pytest.raises(ValueError):
        Glicko2Opponent(rating=1500.0, rd=100.0, score=0.75)


def test_invalid_rd_rejected() -> None:
    with pytest.raises(ValueError):
        Glicko2Rating(rating=1500.0, rd=0.0, volatility=0.06)


def test_invalid_volatility_rejected() -> None:
    with pytest.raises(ValueError):
        Glicko2Rating(rating=1500.0, rd=200.0, volatility=0.0)
