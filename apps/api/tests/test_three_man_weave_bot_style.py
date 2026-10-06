"""tmw_bot_v4: the adapter hands each BOT seat a seeded drafting style.

`bot_style` lives in a bot seat's private projection only: a human seat never
receives it (it is not a secret, but it is bot plumbing, not UI), and a seat's
style is a pure function of (match seed, seat) so every poller -- and a
replay -- drives the same bot.
"""
from __future__ import annotations

from nba_peak.three_man_weave.bot import SEAT_STYLES, style_for_seat

from app.services.three_man_weave.mode import mode

from .test_three_man_weave_mode import _match, _seats, _through_arrival


def test_bot_seats_get_a_seeded_style_and_humans_never_do():
    seats = _seats(bot_indexes=(1, 2))
    for seed in (1, 4242, 90210):
        snapshot = _through_arrival(mode.initial_snapshot(seed, seats))
        match = _match(snapshot, seed=seed)
        _public, human, _legal = mode.project(match, seats, 0)
        assert "bot_style" not in human
        for seat in (1, 2):
            _public, private, _legal = mode.project(match, seats, seat)
            assert private["bot_style"] in SEAT_STYLES
            assert private["bot_style"] == style_for_seat(seed, seat)
            # Stable across polls.
            assert mode.project(match, seats, seat)[1]["bot_style"] == private["bot_style"]


def test_style_is_not_in_any_public_projection():
    seats = _seats(bot_indexes=(1, 2))
    match = _match(_through_arrival(mode.initial_snapshot(7, seats)), seed=7)
    for seat in range(3):
        public, _private, _legal = mode.project(match, seats, seat)
        assert "bot_style" not in str(public)
