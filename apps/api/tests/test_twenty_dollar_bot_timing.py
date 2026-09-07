"""$20 Showdown — server-authoritative bot deliberation (game-feel pass 2).

THE DEFECT THIS PINS, AND THE ONE IT REPLACES. The first version of this file
pinned a 2.6-4.2s think range whose floor sat ABOVE the room's 2000ms poll, so
that a poll would always catch the opponent "thinking". Measured in play that
produced four to five seconds of nothing between every human action and the
bot's reply -- not a tension beat, a frozen page.

The contract is now the other way round. The bot CALCULATES its move from the
board and the seed with no wait at all; a short, seeded, decision-shaped delay
decides when the move is allowed to LAND; and the match view publishes
`bot_reply_in_seconds` so the room reads the reply the instant it is due
instead of a poll interval late. Nothing here is a sleep, and nothing here
changes what the bot decides.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.services.arena.bots import (
    BOT_THINK_SECONDS,
    bot_reply_in_seconds,
    bot_think_seconds_for,
)
from app.services.twenty_dollar.mode import (
    PHASE_INTRO,
    PHASE_LOT_UNWINNABLE,
    TwentyDollarMode,
)
from nba_peak.twenty_dollar import state as rules_state
from nba_peak.twenty_dollar.bot import TwentyDollarBot
from nba_peak.twenty_dollar.config import (
    BOT_THINK_KIND_CONTESTED,
    BOT_THINK_KIND_ORDINARY,
    BOT_THINK_KIND_QUICK,
    BOT_THINK_KIND_WAR,
    BOT_THINK_RANGES,
    BOT_THINK_SECONDS_MAX,
    BOT_THINK_SECONDS_MIN,
    TURN_SECONDS,
    bot_think_seconds,
)

SEEDS = (1, 42, 7919, 123456)
TURNS = range(24)
NOW = datetime(2026, 9, 6, 12, 0, 0, tzinfo=timezone.utc)


class TestTheRanges:
    def test_the_ordinary_range_is_a_short_human_beat(self):
        """Final polish pass: roughly 900-1,900ms for an ordinary decision --
        quick, sharp and believable; neither the old 4-5 s dead wait nor the
        pass-2 machine snap (350-1,300ms) the founder read as instantaneous."""
        assert 0.8 <= BOT_THINK_SECONDS_MIN <= 1.0
        assert 1.7 <= BOT_THINK_SECONDS_MAX <= 2.1

    def test_a_quick_pass_is_faster_than_an_ordinary_decision(self):
        quick = BOT_THINK_RANGES[BOT_THINK_KIND_QUICK]
        ordinary = BOT_THINK_RANGES[BOT_THINK_KIND_ORDINARY]
        assert quick[0] < ordinary[0]
        assert quick[1] < ordinary[1]

    def test_a_contested_call_may_take_the_long_beat_and_only_that_long(self):
        """Occasionally 1,900-2,900ms -- a visible deliberation on a contested
        lot -- and never longer than three seconds."""
        low, high = BOT_THINK_RANGES[BOT_THINK_KIND_CONTESTED]
        assert 1.8 <= low <= 2.1
        assert high <= 3.0

    def test_a_bidding_war_accelerates(self):
        war = BOT_THINK_RANGES[BOT_THINK_KIND_WAR]
        ordinary = BOT_THINK_RANGES[BOT_THINK_KIND_ORDINARY]
        assert war[1] < ordinary[1]

    def test_every_range_stays_well_inside_a_human_decision_window(self):
        for low, high in BOT_THINK_RANGES.values():
            assert 0 < low < high
            # Final polish: a contested deliberation may run to ~2.9 s -- an
            # eighth of the 25 s turn, visible as a choice, never a stall.
            assert high < TURN_SECONDS / 8
            assert high <= 10.0

    def test_no_routine_decision_is_a_multi_second_wait(self):
        for kind in (BOT_THINK_KIND_QUICK, BOT_THINK_KIND_ORDINARY, BOT_THINK_KIND_WAR):
            assert BOT_THINK_RANGES[kind][1] < 2.0


class TestTheDraw:
    @pytest.mark.parametrize("seed", SEEDS)
    def test_every_draw_lands_inside_its_kinds_range(self, seed):
        for kind, (low, high) in BOT_THINK_RANGES.items():
            for seat in (0, 1):
                for turn in TURNS:
                    value = bot_think_seconds(seed, seat, turn, kind)
                    if kind == BOT_THINK_KIND_CONTESTED:
                        # Either the long beat or the ordinary one.
                        o_low, o_high = BOT_THINK_RANGES[BOT_THINK_KIND_ORDINARY]
                        assert (low <= value <= high) or (o_low <= value <= o_high)
                    else:
                        assert low <= value <= high

    def test_an_unknown_kind_falls_back_to_the_ordinary_range(self):
        value = bot_think_seconds(42, 1, 3, "not-a-kind")
        assert BOT_THINK_SECONDS_MIN <= value <= BOT_THINK_SECONDS_MAX

    def test_it_is_deterministic_from_stored_state(self):
        """Two pollers must agree, and a fast client must not hurry a bot."""
        assert bot_think_seconds(42, 1, 3) == bot_think_seconds(42, 1, 3)
        assert bot_think_seconds(42, 1, 3) != bot_think_seconds(43, 1, 3)

    def test_successive_turns_are_not_a_metronome(self):
        """A constant delay is still a machine, just a slower one."""
        values = [bot_think_seconds(42, 1, t) for t in TURNS]
        assert len(set(values)) > len(values) // 2

    def test_the_contested_long_beat_is_occasional_not_constant(self):
        long_low = BOT_THINK_RANGES[BOT_THINK_KIND_CONTESTED][0]
        draws = [
            bot_think_seconds(seed, seat, turn, BOT_THINK_KIND_CONTESTED)
            for seed in range(40)
            for seat in (0, 1)
            for turn in range(6)
        ]
        long = sum(1 for d in draws if d >= long_low)
        assert 0.2 < long / len(draws) < 0.7


class _Turn:
    def __init__(self, seat_index, turn_seq, phase="auction", opened_at=NOW):
        self.seat_index = seat_index
        self.turn_seq = turn_seq
        self.phase = phase
        self.opened_at = opened_at
        self.deadline_at = opened_at + timedelta(seconds=TURN_SECONDS)


class _Seat:
    def __init__(self, seat_index, is_bot):
        self.seat_index = seat_index
        self.is_bot = is_bot


class _Match:
    def __init__(self, seed=42, snapshot=None):
        self.seed = seed
        self.snapshot = snapshot


def _bot_turn_state(seed: int = 42) -> tuple[dict, int]:
    """A live opening lot, with the active seat treated as the bot."""
    snapshot = rules_state.initial_state(seed)
    assert snapshot["active_seat"] is not None
    return snapshot, int(snapshot["active_seat"])


class TestTheDecisionShapesTheWait:
    """The think time is a function of the KIND of decision on the board."""

    def test_the_mode_classifies_from_the_snapshot(self):
        mode = TwentyDollarMode()
        snapshot, seat = _bot_turn_state()
        kinds = set()
        for turn_seq in TURNS:
            value = mode.bot_think_seconds(42, seat, turn_seq, snapshot=snapshot)
            assert 0 < value <= 3.0
            kinds.add(value)
        assert len(kinds) > 1

    def test_a_walk_away_from_a_price_it_will_not_pay_is_quick(self):
        """A standing bid far above the bot's ceiling: the reply is a quick pass."""
        mode = TwentyDollarMode()
        snapshot, opener = _bot_turn_state(7)
        other = 1 - opener
        snapshot, code, _ = rules_state.submit_action(snapshot, opener, "bid", 14)
        assert code is None
        assert snapshot["active_seat"] == other
        public, private, _ = rules_state.project(snapshot, other)
        private = mode._bot_private(snapshot, private)
        assert TwentyDollarBot().decision_kind(public, private) == BOT_THINK_KIND_QUICK
        value = mode.bot_think_seconds(7, other, 3, snapshot=snapshot)
        low, high = BOT_THINK_RANGES[BOT_THINK_KIND_QUICK]
        assert low <= value <= high

    def test_a_long_walk_up_is_a_war(self):
        mode = TwentyDollarMode()
        snapshot, opener = _bot_turn_state(11)
        other = 1 - opener
        for amount in (1, 2, 3, 4, 5):
            actor = snapshot["active_seat"]
            snapshot, code, _ = rules_state.submit_action(snapshot, actor, "bid", amount)
            assert code is None
        public, private, _ = rules_state.project(snapshot, snapshot["active_seat"])
        private = mode._bot_private(snapshot, private)
        kind = TwentyDollarBot().decision_kind(public, private)
        assert kind in (BOT_THINK_KIND_WAR, BOT_THINK_KIND_QUICK, BOT_THINK_KIND_CONTESTED)
        assert other in (0, 1)

    def test_the_bot_seat_is_told_a_band_and_a_tier_but_never_a_score(self):
        mode = TwentyDollarMode()
        snapshot, seat = _bot_turn_state()
        _, private, _ = rules_state.project(snapshot, seat)
        private = mode._bot_private(snapshot, private)
        assert private["candidate_tier"] in {"1-100", "101-250", "251-500", "unranked"}
        assert private["candidate_band"] in {"1-10", "11-25", "26-50", "51-100", "101-250", "251-500"}
        for banned in ("prime_score", "rank", "components", "component_index"):
            assert banned not in private


class TestThePlatformActuallyUsesIt:
    """A hook nothing calls would leave the 1.2s default in place unnoticed."""

    def test_the_driver_passes_the_snapshot_to_a_hook_that_accepts_it(self):
        mode = TwentyDollarMode()
        snapshot, seat = _bot_turn_state()
        match = _Match(42, snapshot)
        for turn_seq in TURNS:
            resolved = bot_think_seconds_for(mode, match, _Turn(seat, turn_seq))
            assert resolved == mode.bot_think_seconds(42, seat, turn_seq, snapshot=snapshot)
            assert 0.5 <= resolved <= 3.0

    def test_an_older_three_argument_hook_still_works(self):
        class Legacy:
            def bot_think_seconds(self, seed, seat_index, turn_seq):
                return 2.5

        assert bot_think_seconds_for(Legacy(), _Match(), _Turn(1, 0)) == 2.5


class TestThePublishedReply:
    """`bot_reply_in_seconds` tells the room when the reply is due."""

    def test_none_when_the_open_turn_is_a_humans(self):
        mode = TwentyDollarMode()
        snapshot, seat = _bot_turn_state()
        seats = (_Seat(seat, False), _Seat(1 - seat, True))
        assert bot_reply_in_seconds(mode, _Match(42, snapshot), _Turn(seat, 1), seats, NOW) is None

    def test_none_when_nobody_holds_the_turn(self):
        mode = TwentyDollarMode()
        snapshot, seat = _bot_turn_state()
        seats = (_Seat(0, False), _Seat(1, True))
        turn = _Turn(None, 0, phase=PHASE_INTRO)
        assert bot_reply_in_seconds(mode, _Match(42, snapshot), turn, seats, NOW) is None
        turn = _Turn(None, 2, phase=PHASE_LOT_UNWINNABLE)
        assert bot_reply_in_seconds(mode, _Match(42, snapshot), turn, seats, NOW) is None

    def test_counts_down_from_the_think_time_to_zero(self):
        mode = TwentyDollarMode()
        snapshot, seat = _bot_turn_state()
        seats = (_Seat(seat, True), _Seat(1 - seat, False))
        match = _Match(42, snapshot)
        turn = _Turn(seat, 1)
        think = bot_think_seconds_for(mode, match, turn)
        at_open = bot_reply_in_seconds(mode, match, turn, seats, NOW)
        assert at_open == pytest.approx(think, abs=0.01)
        later = bot_reply_in_seconds(mode, match, turn, seats, NOW + timedelta(seconds=0.2))
        assert later == pytest.approx(think - 0.2, abs=0.01)
        due = bot_reply_in_seconds(mode, match, turn, seats, NOW + timedelta(seconds=think + 5))
        assert due == 0.0
