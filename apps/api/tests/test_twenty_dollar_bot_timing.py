"""$20 Showdown — server-authoritative bot deliberation.

THE DEFECT THIS PINS. The mode carried no `bot_think_seconds` hook, so the
platform fell back to `arena.bots.BOT_THINK_SECONDS` (1.2s). The room polls
every 2000ms, so a 1.2s deliberation routinely completed inside the SAME poll
that opened the bot's turn: the client rendered the settled raise without ever
rendering the opponent on the clock, and the opponent read as a synchronous
function call rather than as another bidder.

The floor being above the client's poll interval is therefore the load-bearing
property here, not a stylistic preference — Three-Man Weave hit and recorded the
identical bug. The ceiling matters in the other direction: an auction is up to
36 lots of alternating raises, so borrowing the weave's 4-10s range would add
minutes of watching to one match.

Nothing here is a sleep, and nothing here changes what the bot decides.
"""
from __future__ import annotations

import pytest

from app.services.arena.bots import BOT_THINK_SECONDS, bot_think_seconds_for
from app.services.twenty_dollar.mode import TwentyDollarMode
from nba_peak.twenty_dollar.config import (
    BOT_THINK_SECONDS_MAX,
    BOT_THINK_SECONDS_MIN,
    TURN_SECONDS,
    bot_think_seconds,
)

#: `TwentyDollarGame.tsx`'s own `POLL_MS`. Mirrored, not imported — a Python
#: test cannot read the TSX constant, so if that value ever changes this
#: number is the thing that has to change with it, and the assertion below is
#: what will fail loudly rather than the product going quietly back to
#: invisible deliberation.
CLIENT_POLL_SECONDS = 2.0

SEEDS = (1, 42, 7919, 123456)
TURNS = range(24)


class TestTheRange:
    def test_the_floor_is_above_the_rooms_poll_interval(self):
        """The whole point: at least one poll must land while the bot thinks."""
        assert BOT_THINK_SECONDS_MIN > CLIENT_POLL_SECONDS

    def test_it_is_slower_than_the_platform_default_it_replaces(self):
        assert BOT_THINK_SECONDS_MIN > BOT_THINK_SECONDS

    def test_it_stays_well_inside_a_human_decision_window(self):
        # A bot must never eat a meaningful share of the 25s turn clock, and
        # `bot_think_seconds_for` additionally clamps any hook to 10s.
        assert BOT_THINK_SECONDS_MAX < TURN_SECONDS / 4
        assert BOT_THINK_SECONDS_MAX <= 10.0

    def test_it_is_much_shorter_than_three_man_weaves(self):
        """An auction cannot borrow a draft's pacing — see the module docstring."""
        from nba_peak.three_man_weave.config import BOT_THINK_SECONDS_MAX as WEAVE_MAX

        assert BOT_THINK_SECONDS_MAX < WEAVE_MAX


class TestTheDraw:
    @pytest.mark.parametrize("seed", SEEDS)
    def test_every_draw_lands_inside_the_declared_range(self, seed):
        for seat in (0, 1):
            for turn in TURNS:
                value = bot_think_seconds(seed, seat, turn)
                assert BOT_THINK_SECONDS_MIN <= value <= BOT_THINK_SECONDS_MAX

    def test_it_is_deterministic_from_stored_state(self):
        """Two pollers must agree, and a fast client must not hurry a bot."""
        assert bot_think_seconds(42, 1, 3) == bot_think_seconds(42, 1, 3)
        assert bot_think_seconds(42, 1, 3) != bot_think_seconds(43, 1, 3)

    def test_successive_turns_are_not_a_metronome(self):
        """A constant delay is still a machine, just a slower one."""
        values = [bot_think_seconds(42, 1, t) for t in TURNS]
        assert len(set(values)) > len(values) // 2

    def test_the_two_seats_do_not_move_on_the_same_rhythm(self):
        differ = sum(
            1 for t in TURNS if bot_think_seconds(42, 0, t) != bot_think_seconds(42, 1, t)
        )
        assert differ == len(TURNS)


class TestThePlatformActuallyUsesIt:
    """A hook nothing calls would leave the 1.2s default in place unnoticed."""

    class _Turn:
        def __init__(self, seat_index: int, turn_seq: int) -> None:
            self.seat_index = seat_index
            self.turn_seq = turn_seq

    class _Match:
        seed = 42

    def test_the_mode_exposes_the_hook(self):
        assert hasattr(TwentyDollarMode(), "bot_think_seconds")

    def test_the_driver_resolves_to_the_modes_value_not_the_default(self):
        mode = TwentyDollarMode()
        for turn_seq in TURNS:
            resolved = bot_think_seconds_for(mode, self._Match(), self._Turn(1, turn_seq))
            assert resolved == bot_think_seconds(42, 1, turn_seq)
            assert resolved != BOT_THINK_SECONDS
            assert resolved > CLIENT_POLL_SECONDS
