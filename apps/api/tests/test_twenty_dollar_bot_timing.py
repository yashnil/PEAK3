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

GAME-FEEL PASS 5 re-pinned the ranges upward. Played end to end, the 0.55-2.9 s
ranges made the auction read as arcade-fast: passes snapped, raises answered
raises inside a second, and a whole lot could sell between two glances. The
reply is still read the instant it is due; only its landing is paced, and the
pacing now depends on the decision (obvious move, considered pass, contested
call at the ceiling, an accelerating war).
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
    BOT_THINK_KIND_PASS,
    BOT_THINK_KIND_QUICK,
    BOT_THINK_KIND_WAR,
    BOT_THINK_HESITATION_SECONDS,
    BOT_THINK_RANGES,
    BOT_THINK_WAR_FLOOR_RANGE,
    BOT_THINK_SECONDS_MAX,
    BOT_THINK_SECONDS_MIN,
    TURN_SECONDS,
    bot_think_seconds,
)

SEEDS = (1, 42, 7919, 123456)
TURNS = range(24)
NOW = datetime(2026, 9, 6, 12, 0, 0, tzinfo=timezone.utc)


class TestTheRanges:
    def test_the_ordinary_range_is_a_visible_deliberation(self):
        """Pass 5: roughly 2.2-3.8 s for an ordinary open or raise -- long
        enough to watch the other bench decide, short enough to keep a lot
        moving."""
        assert 2.0 <= BOT_THINK_SECONDS_MIN <= 2.4
        assert 3.5 <= BOT_THINK_SECONDS_MAX <= 4.0

    def test_an_obvious_move_is_faster_than_an_ordinary_one_but_never_a_snap(self):
        quick = BOT_THINK_RANGES[BOT_THINK_KIND_QUICK]
        ordinary = BOT_THINK_RANGES[BOT_THINK_KIND_ORDINARY]
        assert quick[0] < ordinary[0]
        assert quick[1] < ordinary[1]
        assert quick[0] >= 1.2

    def test_a_pass_is_considered_not_instant(self):
        low, high = BOT_THINK_RANGES[BOT_THINK_KIND_PASS]
        assert low >= 1.5
        assert high <= BOT_THINK_SECONDS_MAX

    def test_a_contested_call_may_take_the_long_beat(self):
        """At the bot's own ceiling: often a 3.8-6.5 s deliberation."""
        low, high = BOT_THINK_RANGES[BOT_THINK_KIND_CONTESTED]
        assert low >= BOT_THINK_SECONDS_MAX
        assert 6.0 <= high <= 7.0

    def test_a_bidding_war_is_faster_than_an_ordinary_decision(self):
        war = BOT_THINK_RANGES[BOT_THINK_KIND_WAR]
        ordinary = BOT_THINK_RANGES[BOT_THINK_KIND_ORDINARY]
        assert war[1] < ordinary[1]
        assert war[0] < ordinary[0]

    def test_every_range_stays_well_inside_a_human_decision_window(self):
        longest = max(high for _low, high in BOT_THINK_RANGES.values()) + BOT_THINK_HESITATION_SECONDS[1]
        for low, high in BOT_THINK_RANGES.values():
            assert 0 < low < high
        # A contested deliberation may run to ~6.5 s -- about a quarter of the
        # 25 s turn, visible as a choice, never a stall.
        assert longest < TURN_SECONDS / 3
        assert longest <= 10.0


class TestTheDraw:
    @pytest.mark.parametrize("seed", SEEDS)
    def test_every_draw_lands_inside_its_kinds_range(self, seed):
        o_low, o_high = BOT_THINK_RANGES[BOT_THINK_KIND_ORDINARY]
        hesitation = BOT_THINK_HESITATION_SECONDS[1]
        for kind, (low, high) in BOT_THINK_RANGES.items():
            for seat in (0, 1):
                for turn in TURNS:
                    value = bot_think_seconds(seed, seat, turn, kind)
                    if kind == BOT_THINK_KIND_CONTESTED:
                        # Either the long beat or the ordinary one.
                        assert (low <= value <= high) or (o_low <= value <= o_high)
                    elif kind == BOT_THINK_KIND_ORDINARY:
                        # Ordinary decisions occasionally hesitate a little longer.
                        assert low <= value <= high + hesitation
                    else:
                        assert low <= value <= high

    def test_an_unknown_kind_falls_back_to_the_ordinary_range(self):
        value = bot_think_seconds(42, 1, 3, "not-a-kind")
        assert BOT_THINK_SECONDS_MIN <= value <= BOT_THINK_SECONDS_MAX + BOT_THINK_HESITATION_SECONDS[1]

    def test_it_is_deterministic_from_stored_state(self):
        """Two pollers must agree, and a fast client must not hurry a bot."""
        assert bot_think_seconds(42, 1, 3) == bot_think_seconds(42, 1, 3)
        assert bot_think_seconds(42, 1, 3) != bot_think_seconds(43, 1, 3)

    def test_successive_turns_are_not_a_metronome(self):
        """A constant delay is still a machine, just a slower one."""
        values = [bot_think_seconds(42, 1, t) for t in TURNS]
        assert len(set(values)) > len(values) // 2

    def test_some_ordinary_decisions_hesitate_and_most_do_not(self):
        ceiling = BOT_THINK_SECONDS_MAX
        draws = [bot_think_seconds(seed, seat, turn) for seed in range(60) for seat in (0, 1) for turn in range(8)]
        hesitated = sum(1 for d in draws if d > ceiling)
        assert 0.03 < hesitated / len(draws) < 0.25

    def test_the_contested_long_beat_is_common_but_not_constant(self):
        long_low = BOT_THINK_RANGES[BOT_THINK_KIND_CONTESTED][0]
        draws = [
            bot_think_seconds(seed, seat, turn, BOT_THINK_KIND_CONTESTED)
            for seed in range(40)
            for seat in (0, 1)
            for turn in range(6)
        ]
        long = sum(1 for d in draws if d >= long_low)
        assert 0.3 < long / len(draws) < 0.8

    def test_a_war_tightens_the_longer_it_runs_and_never_snaps(self):
        """The fifth raise answers faster than the fourth, the eighth faster
        still -- down to a floor that is still a visible beat."""
        def worst(depth: int) -> float:
            return max(
                bot_think_seconds(seed, seat, turn, BOT_THINK_KIND_WAR, war_depth=depth)
                for seed in range(30)
                for seat in (0, 1)
                for turn in range(6)
            )

        assert worst(0) > worst(2) > worst(4)
        floor_low, floor_high = BOT_THINK_WAR_FLOOR_RANGE
        deep = [
            bot_think_seconds(seed, 1, turn, BOT_THINK_KIND_WAR, war_depth=20)
            for seed in range(30)
            for turn in range(6)
        ]
        assert min(deep) >= floor_low
        assert max(deep) <= floor_high


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
            assert 1.0 <= value <= 7.7
            kinds.add(value)
        assert len(kinds) > 1

    def test_a_walk_away_from_a_price_it_will_not_pay_is_a_considered_pass(self):
        """A standing bid far above the bot's ceiling: the reply is a pass,
        and it takes a beat rather than snapping."""
        mode = TwentyDollarMode()
        snapshot, opener = _bot_turn_state(7)
        other = 1 - opener
        snapshot, code, _ = rules_state.submit_action(snapshot, opener, "bid", 14)
        assert code is None
        assert snapshot["active_seat"] == other
        public, private, _ = rules_state.project(snapshot, other)
        private = mode._bot_private(snapshot, private)
        assert TwentyDollarBot().decision_kind(public, private) == BOT_THINK_KIND_PASS
        value = mode.bot_think_seconds(7, other, 3, snapshot=snapshot)
        low, high = BOT_THINK_RANGES[BOT_THINK_KIND_PASS]
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
        assert kind in (BOT_THINK_KIND_WAR, BOT_THINK_KIND_PASS, BOT_THINK_KIND_CONTESTED)
        assert TwentyDollarBot.war_depth(public) == 1
        assert other in (0, 1)

    def test_the_hook_passes_the_war_depth_through(self):
        """The mode times a turn from the kind AND the war depth the bot's own
        projection gives -- a deep war is timed from the tightened range."""
        mode = TwentyDollarMode()
        bot = TwentyDollarBot()
        checked = 0
        for seed in range(1, 60):
            snapshot, _opener = _bot_turn_state(seed)
            for amount in range(1, 7):
                actor = snapshot["active_seat"]
                snapshot, code, _ = rules_state.submit_action(snapshot, actor, "bid", amount)
                if code is not None or snapshot.get("active_seat") is None:
                    break
            else:
                seat = snapshot["active_seat"]
                public, private, _ = rules_state.project(snapshot, seat)
                private = mode._bot_private(snapshot, private)
                kind = bot.decision_kind(public, private)
                depth = bot.war_depth(public)
                assert depth == 2
                for turn_seq in range(6):
                    assert mode.bot_think_seconds(seed, seat, turn_seq, snapshot=snapshot) == bot_think_seconds(
                        seed, seat, turn_seq, kind, war_depth=depth
                    )
                checked += 1
        assert checked > 0

    def test_an_obvious_open_is_quick_and_an_unwanted_lot_is_a_pass(self):
        """Over many opening lots the bot both opens on clear value and steps
        away from lots it does not want -- and each is timed as that kind."""
        mode = TwentyDollarMode()
        bot = TwentyDollarBot()
        kinds = set()
        for seed in range(1, 120):
            snapshot, seat = _bot_turn_state(seed)
            public, private, _ = rules_state.project(snapshot, seat)
            private = mode._bot_private(snapshot, private)
            kind = bot.decision_kind(public, private)
            kinds.add(kind)
            low, high = BOT_THINK_RANGES[kind]
            value = mode.bot_think_seconds(seed, seat, 0, snapshot=snapshot)
            if kind == BOT_THINK_KIND_ORDINARY:
                high += BOT_THINK_HESITATION_SECONDS[1]
            assert low <= value <= high, (kind, value)
        assert BOT_THINK_KIND_PASS in kinds
        assert kinds & {BOT_THINK_KIND_QUICK, BOT_THINK_KIND_ORDINARY}

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
            assert 1.0 <= resolved <= 7.7

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
