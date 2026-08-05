"""Arena rating: placement -> pairwise -> Glicko-2, and the invariants around it.

The properties asserted here are the ones a player would dispute if they were
wrong: that a tie is a draw, that private play cannot mint rating, that a
bot-filled rated match uses the bot's pinned calibration, and that the order the
server happened to iterate seats in cannot change anyone's number.
"""
from __future__ import annotations

import pytest

from app.core.config import settings
from app.services.arena.rating import (
    ARENA_RATING_ALGORITHM_VERSION,
    BOT_OPPONENT_RD,
    MAX_RATING_CHANGE_PER_MATCH,
    UnratedMatch,
    pairwise_score,
    rate_match_results,
    rate_seat,
    rating_inputs_for_match,
)
from app.services.ranked.glicko2 import Glicko2Rating, initial_rating


def _seat(index, sub, placement, *, rated=True, was_bot=False, bot_rating=None):
    row = {
        "seat_index": index,
        "placement": placement,
        "rated": rated,
        "was_bot": was_bot,
    }
    if was_bot:
        row["bot_rating"] = bot_rating
    else:
        row["owner_sub"] = sub
    return row


def _weave(p0, p1, p2, **kw):
    return [
        _seat(0, "a", p0, **kw),
        _seat(1, "b", p1, **kw),
        _seat(2, "c", p2, **kw),
    ]


# ---------------------------------------------------------------------------
# Placement -> pairwise
# ---------------------------------------------------------------------------


def test_pairwise_score_is_decided_by_comparing_placements():
    assert pairwise_score(1, 2) == 1.0
    assert pairwise_score(2, 1) == 0.0
    assert pairwise_score(1, 1) == 0.5
    # Standard competition ranking: the seat after a tie for first is 3, and it
    # still LOST to both of them.
    assert pairwise_score(3, 1) == 0.0


def test_a_three_player_result_decomposes_into_every_pairing():
    """First beats second and third; second beats third."""
    inputs = rating_inputs_for_match(_weave(1, 2, 3), {})
    by_seat = {i.seat_index: i for i in inputs}
    assert [o.score for o in by_seat[0].opponents] == [1.0, 1.0]
    assert sorted(o.score for o in by_seat[1].opponents) == [0.0, 1.0]
    assert [o.score for o in by_seat[2].opponents] == [0.0, 0.0]


def test_a_three_way_tie_is_three_draws_and_barely_moves_anyone():
    outs = rate_match_results(_weave(1, 1, 1), {})
    assert all(o.score == 0.5 for out in outs for o in out.opponents)
    for out in outs:
        assert out.post.rating == pytest.approx(out.pre.rating, abs=0.01)


def test_a_shared_first_place_beats_the_third_seat_but_draws_with_the_other():
    """1/1/3 -- the two leaders draw with each other and both beat the third."""
    inputs = rating_inputs_for_match(_weave(1, 1, 3), {})
    by_seat = {i.seat_index: i for i in inputs}
    leader = by_seat[0]
    assert sorted(o.score for o in leader.opponents) == [0.5, 1.0]
    assert [o.score for o in by_seat[2].opponents] == [0.0, 0.0]


def test_the_result_is_symmetric_between_first_and_last():
    outs = {o.seat_index: o for o in rate_match_results(_weave(1, 2, 3), {})}
    gain = outs[0].post.rating - outs[0].pre.rating
    loss = outs[2].pre.rating - outs[2].post.rating
    assert gain == pytest.approx(loss, abs=0.01)
    assert outs[1].post.rating == pytest.approx(outs[1].pre.rating, abs=0.01)


def test_seat_order_cannot_change_the_outcome():
    """Every seat is rated against the ratings as they stood BEFORE the match,
    so shuffling the rows cannot move anyone's number."""
    forward = rate_match_results(_weave(1, 2, 3), {})
    backward = rate_match_results(list(reversed(_weave(1, 2, 3))), {})
    assert {o.seat_index: o.post.rating for o in forward} == {
        o.seat_index: o.post.rating for o in backward
    }


def test_all_of_a_seats_opponents_are_rated_in_one_period():
    """Two opponents in one match must not be applied as two sequential
    matches -- the second would be judged against an already-moved rating."""
    from app.services.ranked.glicko2 import rate_match

    out = [o for o in rate_match_results(_weave(1, 2, 3), {}) if o.seat_index == 0][0]
    sequential = initial_rating()
    for opponent in out.opponents:
        sequential = rate_match(sequential, opponent.rating, opponent.rd, opponent.score)
    assert out.post.rating != pytest.approx(sequential.rating, abs=0.01)


# ---------------------------------------------------------------------------
# The rated invariant
# ---------------------------------------------------------------------------


def test_an_unrated_result_is_refused_rather_than_skipped():
    """Private rooms and practice must fail loudly, not filter out quietly."""
    with pytest.raises(UnratedMatch):
        rate_match_results(_weave(1, 2, 3, rated=False), {})


def test_one_unrated_seat_refuses_the_whole_match():
    rows = _weave(1, 2, 3)
    rows[1]["rated"] = False
    with pytest.raises(UnratedMatch):
        rate_match_results(rows, {})


def test_ratings_are_off_by_default():
    assert settings.ARENA_RATINGS_ENABLED is False
    assert settings.ARENA_LEADERBOARD_ENABLED is False


def test_the_rating_flags_are_not_the_ranked_flags():
    """Own namespace -- a shared flag would make the ranked kill-switch
    ambiguous."""
    assert hasattr(settings, "ARENA_RATINGS_ENABLED")
    assert hasattr(settings, "ARENA_LEADERBOARD_ENABLED")
    assert settings.RANKED_ENABLED is False


# ---------------------------------------------------------------------------
# Bots
# ---------------------------------------------------------------------------


def test_a_bot_opponent_uses_the_rating_pinned_on_its_seat():
    rows = [
        _seat(0, "a", 1),
        _seat(1, None, 2, was_bot=True, bot_rating=1234.5),
    ]
    inputs = rating_inputs_for_match(rows, {})
    assert len(inputs) == 1, "a bot is rated against, never rated"
    opponent = inputs[0].opponents[0]
    assert opponent.rating == 1234.5
    assert opponent.rd == BOT_OPPONENT_RD
    assert opponent.was_bot is True


def test_beating_a_weak_bot_is_worth_almost_nothing_to_a_strong_player():
    """The anti-farming property, and the reason no daily cap is needed."""
    strong = Glicko2Rating(1900.0, 50.0, 0.06)
    rows = [_seat(0, "a", 1), _seat(1, None, 2, was_bot=True, bot_rating=1000.0)]
    out = rate_match_results(rows, {"a": strong})[0]
    assert 0 < out.post.rating - strong.rating < 1.0


def test_a_bot_filled_rated_match_is_marked_as_such():
    rows = [_seat(0, "a", 1), _seat(1, None, 2, was_bot=True, bot_rating=1500.0)]
    assert rate_match_results(rows, {})[0].had_bot_opponent is True


def test_an_all_human_match_is_not_marked_as_bot_filled():
    assert all(o.had_bot_opponent is False for o in rate_match_results(_weave(1, 2, 3), {}))


# ---------------------------------------------------------------------------
# The per-match bound
# ---------------------------------------------------------------------------


def test_ordinary_play_is_never_bounded():
    """The measured envelope in rating.py's constant: established, mid-RD and
    provisional-versus-peers play must all pass through untouched."""
    for pre in (
        Glicko2Rating(1500.0, 50.0, 0.06),
        Glicko2Rating(1500.0, 150.0, 0.06),
        initial_rating(),
    ):
        outs = rate_match_results(_weave(1, 2, 3), {"a": pre, "b": pre, "c": pre})
        assert all(o.bound_applied is False for o in outs), (
            f"the bound must not bite for RD {pre.rd} -- that would silently "
            "replace Glicko-2 with a slower linear system"
        )


def test_the_bound_caps_an_extreme_change_and_records_that_it_did():
    """A provisional player sweeping far-stronger opposition: legitimate, but
    capped, and the uncapped value is kept so the activation is monitorable."""
    rows = _weave(1, 2, 3)
    outs = rate_match_results(
        rows,
        {
            "a": initial_rating(),
            "b": Glicko2Rating(2800.0, 50.0, 0.06),
            "c": Glicko2Rating(2800.0, 50.0, 0.06),
        },
    )
    winner = [o for o in outs if o.seat_index == 0][0]
    assert winner.bound_applied is True
    assert winner.post.rating - winner.pre.rating == pytest.approx(
        MAX_RATING_CHANGE_PER_MATCH, abs=0.01
    )
    assert winner.unbounded_post_rating > winner.post.rating, (
        "the uncapped value must be preserved -- a control whose activations "
        "are invisible cannot be monitored"
    )


def test_the_bound_does_not_touch_rd_or_volatility():
    """Only the visible score is bounded. Clamping RD would claim a certainty
    the algorithm never reached and would distort every later match."""
    rows = _weave(1, 2, 3)
    ratings = {
        "a": initial_rating(),
        "b": Glicko2Rating(2800.0, 50.0, 0.06),
        "c": Glicko2Rating(2800.0, 50.0, 0.06),
    }
    bounded = [o for o in rate_match_results(rows, ratings) if o.seat_index == 0][0]
    assert bounded.bound_applied is True
    unbounded = rate_seat(rating_inputs_for_match(rows, ratings)[0])
    assert bounded.post.rd == unbounded.post.rd
    assert bounded.post.volatility == unbounded.post.volatility


def test_the_algorithm_version_names_both_the_decomposition_and_glicko2():
    assert ARENA_RATING_ALGORITHM_VERSION.startswith("arena_pairwise_v1+")
    assert "glicko2" in ARENA_RATING_ALGORITHM_VERSION.lower()
