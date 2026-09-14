"""The $20 Showdown mode, against the real foundation types.

WHAT THIS FILE IS AND IS NOT. The auction's RULES are tested in
`tests/twenty_dollar/` at the repository root -- tests that need no database, no
app and no event loop. This file tests only the SEAM: that the mode satisfies
`ArenaMode`, that a `ReducerInput` in produces a correct `ReducerOutput` out,
that the turn it opens names the seat that must act and carries a fresh
deadline, and that nothing the foundation persists or projects carries the
candidate's hidden score.

The leak tests here are written as recursive VALUE searches rather than key
checks. A key assertion (`assert "prime_score" not in payload`) is passed by any
future field that happens to carry the number, and this is the one place in the
mode where a miss is a cheating bug rather than a crash.
"""
from __future__ import annotations

import asyncio
import copy
import random
from datetime import datetime, timedelta, timezone
from typing import Optional

import pytest

from app.repositories.arena_protocols import (
    COMMAND_TYPE_TIMEOUT,
    MATCH_STATUS_ACTIVE,
    MATCH_STATUS_COMPLETED,
    OCCUPANT_BOT,
    OCCUPANT_HUMAN,
    VISIBILITY_PUBLIC,
    ArenaMatch,
    ArenaSeat,
    ArenaTurn,
    CommandRequest,
    ReducerInput,
    project_seat_view,
)
from app.services.twenty_dollar.mode import (
    ARRIVAL_BACKSTOP_SECONDS,
    COMMAND_INTRO_SEEN,
    PHASE_ARRIVAL,
    REJECT_INTRO_ALREADY_SEEN,
    REJECT_INTRO_STARTED,
    COMMAND_FORFEIT,
    COMMAND_SKIP_INTRO,
    INTRO_SECONDS,
    LOT_FORCED_FILL_SECONDS,
    LOT_UNWINNABLE_SECONDS,
    PHASE_INTRO,
    PHASE_LOT_FORCED_FILL,
    PHASE_LOT_UNWINNABLE,
)
from app.services.twenty_dollar.mode import bot as td_bot
from app.services.twenty_dollar.mode import mode as td_mode
from app.services.arena.modes import ArenaMode, initial_turn_seat

from nba_peak.twenty_dollar import feasibility
from nba_peak.twenty_dollar import state as S
from nba_peak.twenty_dollar.config import ROSTER_SIZE
from nba_peak.twenty_dollar.pool import get_pool

NOW = datetime(2026, 8, 4, 12, 0, 0, tzinfo=timezone.utc)

SEATS = (
    ArenaSeat(
        match_id="m1", seat_index=0, occupant_kind=OCCUPANT_HUMAN,
        occupant_sub="u0", display_name="Alice",
    ),
    ArenaSeat(
        match_id="m1", seat_index=1, occupant_kind=OCCUPANT_HUMAN,
        occupant_sub="u1", display_name="Bob",
    ),
)


def opened_snapshot(seed=4242) -> dict:
    """The opening snapshot as the intro sees it: both bidders arrived. Tests
    about ARRIVAL itself build from `td_mode.initial_snapshot` directly."""
    snapshot = td_mode.initial_snapshot(seed, SEATS)
    snapshot.pop("arrival_open", None)
    snapshot.pop("arrived_seats", None)
    return snapshot


def make_match(snapshot=None, seed=4242, status=MATCH_STATUS_ACTIVE) -> ArenaMatch:
    return ArenaMatch(
        match_id="m1",
        mode=td_mode.mode,
        mode_version=td_mode.mode_version,
        model_version="peak3_v1",
        seat_count=2,
        entry_path="public_queue",
        rated=False,
        seed=seed,
        created_by="u0",
        expires_at=NOW + timedelta(days=1),
        status=status,
        snapshot=snapshot if snapshot is not None else opened_snapshot(seed),
    )


def cmd(seat, command_type, payload=None, key="k-idem-key") -> CommandRequest:
    return CommandRequest(
        match_id="m1", idempotency_key=key, command_type=command_type,
        payload=payload or {}, actor_sub=f"u{seat}", actor_seat_index=seat,
        expected_state_version=0, issued_at=NOW,
    )


TIMEOUT_CMD = CommandRequest(
    match_id="m1", idempotency_key="t-idem-key", command_type=COMMAND_TYPE_TIMEOUT,
    payload={}, actor_sub=None, actor_seat_index=None,
    expected_state_version=None, issued_at=NOW,
)


def reduce(match, command, now=NOW, open_turn=None):
    return td_mode.reduce(
        ReducerInput(
            match=match, seats=SEATS, open_turn=open_turn, command=command, now=now
        )
    )


def intro_turn(seq: int = 0) -> ArenaTurn:
    """The pre-match intro turn: no seat, its own deadline.

    A match now OPENS on this rather than on a live lot, so that the intro is
    not spending the opening bidder's own 25 seconds. See `mode.PHASE_INTRO`.
    """
    return ArenaTurn(
        match_id="m1",
        turn_seq=seq,
        phase=PHASE_INTRO,
        seat_index=None,
        deadline_at=NOW + timedelta(seconds=INTRO_SECONDS),
        opened_at=NOW,
    )


def active(match) -> int:
    return match.snapshot["active_seat"]


def unwinnable_turn(seq: int = 0) -> ArenaTurn:
    """The seatless "nobody can use this candidate" beat.

    Mirrors `intro_turn`: the reducer only routes `COMMAND_TYPE_TIMEOUT` into
    `_resolve_unwinnable_lot` when the OPEN TURN it is handed actually names
    this phase (`reduce`'s `in_unwinnable_beat` check) -- a bare timeout with
    no open turn falls through to `rules_state.timeout_active_seat`, which is
    a no-op when `active_seat` is already `None`. A driver walking a match
    through the reducer past this beat has to construct this turn, exactly as
    the foundation's own clock sweep would have opened it.
    """
    return ArenaTurn(
        match_id="m1",
        turn_seq=seq,
        phase=PHASE_LOT_UNWINNABLE,
        seat_index=None,
        deadline_at=NOW,
        opened_at=NOW,
    )


def forced_fill_turn(seq: int = 0) -> ArenaTurn:
    """`unwinnable_turn`'s sibling for `PHASE_LOT_FORCED_FILL` (PEAK3 Pass 1):
    a position no OTHER still-competing seat could ever have contested,
    parked as a real, observable, seatless beat rather than committed inline
    -- see `mode.py`'s own `PHASE_LOT_FORCED_FILL` comment for why. A driver
    walking a match through the reducer past this beat has to construct this
    turn, exactly as `unwinnable_turn` does for its sibling."""
    return ArenaTurn(
        match_id="m1",
        turn_seq=seq,
        phase=PHASE_LOT_FORCED_FILL,
        seat_index=None,
        deadline_at=NOW,
        opened_at=NOW,
    )


def all_values(node) -> list:
    """Every scalar anywhere in a nested structure."""
    if isinstance(node, dict):
        return [v for x in node.values() for v in all_values(x)]
    if isinstance(node, (list, tuple)):
        return [v for x in node for v in all_values(x)]
    return [node]


class TestContract:
    def test_satisfies_the_arena_mode_protocol(self):
        assert isinstance(td_mode, ArenaMode)

    def test_identity(self):
        assert td_mode.mode == "twenty_dollar"
        assert td_mode.mode_version == "twenty_dollar_v3"
        assert td_mode.seat_count == 2
        assert td_mode.turn_seconds > 0
        # A MATCH OPENS ON THE INTRO, not on a live lot: the competitive intro
        # used to run as a client beat while the server's 25-second deadline
        # was already going, so it spent the player's own decision clock to
        # tell them the rules. It is a real turn now, belonging to no seat.
        # ...and it opens on ARRIVAL before that: the intro's clock waits for
        # both bidders to reach the match (game-feel pass 4).
        assert td_mode.initial_phase() == PHASE_ARRIVAL
        assert td_mode.phase_seconds(PHASE_ARRIVAL) == ARRIVAL_BACKSTOP_SECONDS
        assert td_mode.phase_accepts_action(PHASE_ARRIVAL) is False
        assert td_mode.phase_seconds("intro") == INTRO_SECONDS
        assert td_mode.phase_seconds("auction") == td_mode.turn_seconds
        assert td_mode.phase_accepts_action("intro") is False
        assert td_mode.phase_accepts_action("auction") is True

    def test_is_registrable_and_retrievable_under_its_name(self):
        """Registration, without depending on global state other tests own.

        The obvious version of this test -- `assert registry.has("twenty_dollar")`
        on the process-wide registry, relying on the import at the top of this
        file having registered it -- PASSES ALONE AND FAILS IN THE SUITE.
        `test_arena_routes.py` calls `mode_registry.clear()`, which is a
        legitimate seam that file owns; by the time this class runs, the
        registration is gone.
        """
        from app.services.arena.modes import ModeRegistry

        isolated = ModeRegistry()
        isolated.register(td_mode)
        assert isolated.has("twenty_dollar")
        assert isolated.get("twenty_dollar") is td_mode
        assert "twenty_dollar" in isolated.names()

    def test_importing_the_module_registers_the_mode(self):
        import importlib

        from app.services.arena.modes import registry

        if not registry.has("twenty_dollar"):
            importlib.reload(
                importlib.import_module("app.services.twenty_dollar.mode")
            )
        assert registry.has("twenty_dollar")

    def test_the_modes_bot_is_the_default_policy_for_its_seats(self):
        """THE DEFECT, AS AN ASSERTION.

        The policy existed in v1 and was never registered, so
        `default_for("twenty_dollar")` fell through to `RandomLegalBot`, whose
        EMPTY payload reduces to a pass. Every bot seat passed on every lot.

        Asserted against an ISOLATED registry for the reason
        `test_is_registrable_and_retrievable_under_its_name` gives: several
        files in this suite call `bot_service.registry.clear()` as a legitimate
        seam they own, so reading the process-wide registry here would pass
        alone and fail in the suite. The property being tested is that THIS
        object is what the mode registers, not that a shared global happens to
        still hold it.
        """
        from app.services.arena.bots import BotRegistry, RandomLegalBot

        isolated = BotRegistry()
        assert isinstance(isolated.default_for("twenty_dollar"), RandomLegalBot)
        isolated.register(td_bot, for_modes=("twenty_dollar",))
        assert isolated.default_for("twenty_dollar") is td_bot

    def test_the_bot_seat_name_is_never_an_implementation_label(self):
        """An implementation id once reached the live lobby. The id lives on
        the seat row where ratings need it, and the NAME is authored.

        `bot_seat` called with no `display_name` and no seed (the shape this
        test exercises) is the emergency fallback path -- every live seating
        call in `matchmaking.py` supplies a seed-derived curated name instead
        -- so this only has to prove the fallback label is itself never an
        implementation id, not that it matches the curated pool.
        """
        from app.services.arena.bots import BOT_DISPLAY_NAME, bot_seat

        seat = bot_seat("m1", 1, td_bot, seat_count=2)
        assert seat.display_name == BOT_DISPLAY_NAME
        assert td_bot.bot_id not in seat.display_name
        assert "(" not in seat.display_name
        assert seat.bot_id == td_bot.bot_id  # still recorded, just not shown

    def test_initial_snapshot_is_a_pure_function_of_the_seed(self):
        assert td_mode.initial_snapshot(4242, SEATS) == td_mode.initial_snapshot(4242, SEATS)

    def test_seat_identity_cannot_influence_the_board(self):
        """A match whose candidates depended on WHO was seated would not be
        reproducible from its seed."""
        forward = td_mode.initial_snapshot(4242, SEATS)
        reversed_seats = td_mode.initial_snapshot(4242, tuple(reversed(SEATS)))
        assert forward["current_candidate"] == reversed_seats["current_candidate"]

    def test_the_snapshot_pins_its_own_model_version(self):
        """So a settled match records what it was scored under, rather than
        inheriting whatever the platform default is when it is later read."""
        assert make_match().snapshot["model_version"] == "peak3_v1"

    def test_a_v1_snapshot_is_refused_rather_than_reinterpreted(self):
        stale = td_mode.initial_snapshot(4242, SEATS)
        stale["ruleset_version"] = "twenty_dollar_v1"
        out = reduce(make_match(snapshot=stale), cmd(0, "pass"))
        assert not out.accepted
        assert out.rejection_code == "ruleset_version_mismatch"


class TestOpeningTurnBelongsToTheOpeningBidder:
    """The foundation used to hardcode the first turn onto seat 0.

    THE GUARANTEE IS UNCHANGED AND HAS MOVED ONE STEP LATER. A match now opens
    on the intro, which belongs to NO seat -- so `initial_turn_seat` is `None`
    by design, and the "first turn is the seed's opening bidder" rule is
    asserted on the turn that actually takes an action: the one the intro's end
    opens. That is a stricter place to assert it than a hook's return value,
    because it is the turn a player is really handed.
    """

    def test_the_first_playable_turn_is_the_seeds_opening_bidder(self):
        for seed in (1, 2, 3, 4, 5, 6, 7, 8):
            snapshot = td_mode.initial_snapshot(seed, SEATS)
            out = reduce(
                make_match(snapshot=snapshot, seed=seed),
                TIMEOUT_CMD,
                open_turn=intro_turn(),
            )
            assert out.accepted, (seed, out.rejection_message)
            assert out.open_turn is not None
            assert out.open_turn.phase == "auction"
            assert out.open_turn.seat_index == snapshot["opening_seat"], seed

    def test_the_intro_turn_belongs_to_nobody_so_both_seats_see_its_clock(self):
        # `project_seat_view` publishes `seconds_remaining` to EVERY seat when a
        # turn names none, which is correct here: both players are watching the
        # same intro.
        snapshot = td_mode.initial_snapshot(4242, SEATS)
        assert td_mode.initial_turn_seat(snapshot) is None
        assert initial_turn_seat(td_mode, snapshot) is None

    def test_the_intro_costs_the_opening_bidder_none_of_their_clock(self):
        """THE WHOLE POINT OF THE PHASE.

        The first lot's deadline is measured from the END of the intro, not
        from match creation -- so a player who reads all of it still gets every
        one of their 25 seconds.
        """
        ended = NOW + timedelta(seconds=INTRO_SECONDS)
        out = reduce(make_match(), TIMEOUT_CMD, now=ended, open_turn=intro_turn())
        assert out.accepted
        assert out.open_turn.deadline_at == ended + timedelta(
            seconds=td_mode.turn_seconds
        )
        # Stated the other way round too, because this is the shape of the bug.
        assert out.open_turn.deadline_at != NOW + timedelta(
            seconds=td_mode.turn_seconds
        )

    def test_the_intro_ending_commits_nothing(self):
        """A clock transition, not a game action. If it went through the pass
        path it would burn the opening seat's first move for standing still
        through a beat they were never on the clock for."""
        match = make_match()
        before = copy.deepcopy(match.snapshot)
        out = reduce(match, TIMEOUT_CMD, open_turn=intro_turn())
        assert out.accepted
        assert out.snapshot == before, "the intro changed the game state"
        assert out.events == ()
        assert out.snapshot["current_candidate"] == before["current_candidate"]

    def test_the_intro_cannot_be_skipped_by_either_seat(self):
        """Final polish pass: the intro is a SHARED timeline. Lot 1's clock
        opens for both seats when the intro's own deadline passes -- one seat
        ending it early would start the auction for a partner still reading
        (the same refusal Three-Man Weave makes for `tmw_skip_intro`)."""
        at = NOW + timedelta(seconds=1)
        for seat in (0, 1):
            out = reduce(
                make_match(), cmd(seat, COMMAND_SKIP_INTRO), now=at, open_turn=intro_turn()
            )
            assert not out.accepted
            assert out.rejection_code == "shared_timeline"
            assert out.open_turn is None or out.open_turn.phase == "intro"

    def test_a_skip_outside_the_intro_is_refused(self):
        """Otherwise it would re-open a live auction turn -- resetting
        somebody's clock on demand."""
        out = reduce(make_match(), cmd(0, COMMAND_SKIP_INTRO), open_turn=None)
        assert not out.accepted
        assert out.rejection_code == "no_intro_open"

    def test_nobody_bids_under_the_intro(self):
        match = make_match()
        out = reduce(
            match, cmd(active(match), "bid", {"amount": 4}), open_turn=intro_turn()
        )
        assert not out.accepted
        assert out.rejection_code == "not_your_turn"

    def test_it_is_not_always_seat_zero(self):
        openers = {
            td_mode.initial_snapshot(seed, SEATS)["opening_seat"] for seed in range(40)
        }
        assert openers == {0, 1}


class TestForfeit:
    """C2. Conceding is a SERVER-RESOLVED command, not a navigation.

    A player who abandons a Showdown otherwise leaves the opponent watching a
    clock tick out lot after lot, and leaves a live match on the server that
    the same player rejoins on their next visit.
    """

    def test_a_forfeit_ends_the_match_and_names_the_loser(self):
        match = make_match()
        out = reduce(match, cmd(0, COMMAND_FORFEIT))
        assert out.accepted, out.rejection_message
        assert out.status == MATCH_STATUS_COMPLETED
        assert out.open_turn is None, "a conceded match must leave nobody on a clock"
        outcomes = {r.seat_index: r.outcome for r in out.results}
        assert outcomes == {0: "loss", 1: "win"}
        placements = {r.seat_index: r.placement for r in out.results}
        assert placements == {0: 2, 1: 1}

    def test_either_seat_may_concede_and_the_other_one_wins(self):
        out = reduce(make_match(), cmd(1, COMMAND_FORFEIT))
        assert out.accepted
        assert {r.seat_index: r.outcome for r in out.results} == {0: "win", 1: "loss"}

    def test_conceding_does_not_depend_on_whose_turn_it_is(self):
        """The moment a player is most likely to quit is while WAITING."""
        match = make_match()
        waiting = 1 - active(match)
        out = reduce(match, cmd(waiting, COMMAND_FORFEIT))
        assert out.accepted

    def test_a_conceded_match_cannot_be_revived_by_a_refresh_or_a_second_command(self):
        """It survives a reconnect because the STATUS is what changed, and the
        snapshot records it -- so every later read projects a settled match."""
        out = reduce(make_match(), cmd(0, COMMAND_FORFEIT))
        assert out.snapshot["phase"] == "complete"
        assert out.snapshot["forfeited_by"] == 0
        assert out.snapshot["active_seat"] is None

        settled = make_match(snapshot=out.snapshot, status=MATCH_STATUS_COMPLETED)
        again = reduce(settled, cmd(0, "bid", {"amount": 5}, key="k2"))
        assert not again.accepted
        assert again.rejection_code == "match_over"
        twice = reduce(settled, cmd(1, COMMAND_FORFEIT, key="k3"))
        assert not twice.accepted

    def test_the_receipt_reports_the_real_rosters_and_names_the_concession(self):
        """Conceding does not fabricate a scoreline: only the OUTCOME is
        overridden, and the receipt still shows what was actually bought."""
        match = make_match()
        out = reduce(match, cmd(0, COMMAND_FORFEIT))
        completed = next(
            e for e in out.events if e.event_type == "match_completed"
        )
        assert completed.payload["forfeited_by"] == 0
        assert any(e.event_type == "seat_forfeited" for e in out.events)
        for result in out.results:
            assert result.detail["forfeited"] is (result.seat_index == 0)
            # Real numbers, not zeros.
            assert result.detail["roster"] == []
            assert result.detail["budget_remaining"] > 0

    def test_the_projection_offers_the_concession_while_the_match_is_live(self):
        match = make_match()
        _public, _private, commands = td_mode.project(match, SEATS, 0)
        assert COMMAND_FORFEIT in commands
        out = reduce(match, cmd(0, COMMAND_FORFEIT))
        settled = make_match(snapshot=out.snapshot, status=MATCH_STATUS_COMPLETED)
        _p, _pr, after = td_mode.project(settled, SEATS, 0)
        assert COMMAND_FORFEIT not in after
        assert _p["forfeited_by"] == 0


class TestActions:
    def test_a_bid_hands_the_clock_to_the_opponent_with_a_fresh_deadline(self):
        match = make_match()
        first = active(match)
        out = reduce(match, cmd(first, "bid", {"amount": 4}))
        assert out.accepted
        assert out.resolve_turn == "action"
        assert out.open_turn is not None
        # NAMED SEAT and a NEW deadline. This is what makes the clock fair: the
        # seat that must act gets the full window, measured from now.
        assert out.open_turn.seat_index == 1 - first
        assert out.open_turn.deadline_at == NOW + timedelta(seconds=td_mode.turn_seconds)

    def test_a_newly_opened_turn_cannot_already_be_overdue(self):
        """The reported symptom was a lot advancing before the player could
        act. A deadline is only ever `now + turn_seconds`, so a turn is never
        born expired -- asserted here against the foundation's own predicate."""
        match = make_match()
        out = reduce(match, cmd(active(match), "bid", {"amount": 2}))
        turn = ArenaTurn(
            match_id="m1",
            turn_seq=1,
            phase=out.open_turn.phase,
            seat_index=out.open_turn.seat_index,
            deadline_at=out.open_turn.deadline_at,
            opened_at=NOW,
        )
        assert not turn.is_overdue_at(NOW)
        assert not turn.is_overdue_at(NOW + timedelta(seconds=td_mode.turn_seconds - 1))
        assert turn.is_overdue_at(NOW + timedelta(seconds=td_mode.turn_seconds + 1))

    def test_a_bid_is_a_public_event_carrying_its_amount(self):
        """An open outcry auction where the standing bid were secret would be a
        different game; the opponent has to see it to answer it."""
        match = make_match()
        out = reduce(match, cmd(active(match), "bid", {"amount": 7}))
        event = next(e for e in out.events if e.event_type == "bid_placed")
        assert event.visibility == VISIBILITY_PUBLIC
        assert event.payload["amount"] == 7

    def test_a_pass_after_a_live_bid_awards_the_lot(self):
        match = make_match()
        first = active(match)
        step = reduce(match, cmd(first, "bid", {"amount": 5}))
        out = reduce(make_match(snapshot=step.snapshot), cmd(1 - first, "pass"))
        record = next(e for e in out.events if e.event_type == "lot_resolved").payload
        assert record["winner_seat"] == first
        assert record["price"] == 5

    def test_both_passing_resolves_the_lot_unsold(self):
        match = make_match()
        first = active(match)
        step = reduce(match, cmd(first, "pass"))
        assert step.accepted
        # Still live: the opponent gets an INDEPENDENT decision.
        assert step.open_turn.seat_index == 1 - first
        out = reduce(make_match(snapshot=step.snapshot), cmd(1 - first, "pass"))
        record = next(e for e in out.events if e.event_type == "lot_resolved").payload
        assert record["winner_seat"] is None
        assert record["decided_by"] == "unsold"

    def test_the_seat_off_the_clock_is_refused(self):
        match = make_match()
        out = reduce(match, cmd(1 - active(match), "bid", {"amount": 3}))
        assert not out.accepted and out.rejection_code == "not_your_turn"

    @pytest.mark.parametrize(
        "payload,expected",
        [
            ({"amount": 20}, "bid_over_max"),
            ({"amount": -1}, "bid_too_low"),
            ({"amount": 0}, "bid_too_low"),
        ],
    )
    def test_illegal_bids_are_rejected(self, payload, expected):
        match = make_match()
        out = reduce(match, cmd(active(match), "bid", payload))
        assert not out.accepted and out.rejection_code == expected

    def test_a_rejection_writes_nothing(self):
        """A rejected command must not advance the state version, invalidate
        the other client's cached view, or move anybody's clock."""
        match = make_match()
        out = reduce(match, cmd(active(match), "bid", {"amount": 20}))
        assert out.snapshot is None
        assert out.events == ()
        assert out.open_turn is None and out.resolve_turn is None

    def test_an_unknown_command_is_rejected(self):
        match = make_match()
        out = reduce(match, cmd(active(match), "wiggle"))
        assert not out.accepted and out.rejection_code == "unknown_command"

    def test_a_seatless_command_is_rejected(self):
        out = reduce(
            make_match(),
            CommandRequest(
                match_id="m1", idempotency_key="k-idem-key", command_type="bid",
                payload={"amount": 1}, actor_sub="stranger", actor_seat_index=None,
                expected_state_version=0, issued_at=NOW,
            ),
        )
        assert not out.accepted and out.rejection_code == "not_your_seat"


class TestTimeout:
    def test_a_timeout_passes_only_the_seat_on_the_clock(self):
        match = make_match()
        first = active(match)
        out = td_mode.reduce(
            ReducerInput(match=match, seats=SEATS, open_turn=None,
                         command=TIMEOUT_CMD, now=NOW)
        )
        assert out.accepted and out.resolve_turn == "timeout"
        # The lot is STILL LIVE and the opponent now has the clock. A timeout
        # that passed both seats would resolve a lot nobody declined -- which
        # is exactly what v1's one shared deadline did.
        assert out.snapshot["history"] == []
        assert out.open_turn is not None
        assert out.open_turn.seat_index == 1 - first
        assert out.snapshot["passed"][first] is True
        assert out.snapshot["passed"][1 - first] is False

    def test_a_timeout_after_a_live_bid_awards_the_lot_at_that_bid(self):
        match = make_match()
        first = active(match)
        step = reduce(match, cmd(first, "bid", {"amount": 6}))
        out = td_mode.reduce(
            ReducerInput(match=make_match(snapshot=step.snapshot), seats=SEATS,
                         open_turn=None, command=TIMEOUT_CMD, now=NOW)
        )
        record = out.snapshot["history"][0]
        assert record["winner_seat"] == first
        assert record["price"] == 6, "no discount for the opponent's silence"
        assert record["timed_out"][1 - first] is True
        assert record["timed_out"][first] is False

    def test_a_timeout_is_a_pass_and_never_a_forfeit(self):
        match = make_match()
        first = active(match)
        step = td_mode.reduce(
            ReducerInput(match=match, seats=SEATS, open_turn=None,
                         command=TIMEOUT_CMD, now=NOW)
        )
        out = reduce(make_match(snapshot=step.snapshot), cmd(1 - first, "pass"))
        assert out.snapshot["seats"][first]["budget"] == 20
        assert out.snapshot["seats"][first]["roster"] == []


class TestProjectionDoesNotLeak:
    @pytest.fixture()
    def live_lot(self):
        match = make_match()
        out = reduce(match, cmd(active(match), "bid", {"amount": 4}))
        return make_match(snapshot=out.snapshot)

    def test_the_candidates_score_is_hidden_before_the_lot_resolves(self):
        match = make_match()
        from nba_peak.twenty_dollar.pool import get_pool

        card = get_pool().get(match.snapshot["current_candidate"])
        public, private, _ = td_mode.project(match, SEATS, 0)
        assert "prime_score" not in public["candidate"]
        assert card.prime_score not in all_values(public)
        assert card.prime_score not in all_values(private)
        assert card.rank not in all_values(public)

    def test_the_seat_view_the_foundation_builds_carries_no_leak(self, live_lot):
        """`SeatView` is what a bot receives; the guarantee has to hold there."""
        from nba_peak.twenty_dollar.pool import get_pool

        card = get_pool().get(live_lot.snapshot["current_candidate"])
        public, private, commands = td_mode.project(live_lot, SEATS, 1)
        view = project_seat_view(live_lot, SEATS[1], public, private, commands, None, NOW)
        assert card.prime_score not in (
            all_values(view.public_state) + all_values(view.private_state)
        )

    def test_the_standing_bid_is_public_to_both_seats(self, live_lot):
        for seat_index in (0, 1):
            public, _, _ = td_mode.project(live_lot, SEATS, seat_index)
            assert public["current_bid"] == 4

    def test_seat_names_come_from_the_foundation(self, live_lot):
        public, _, _ = td_mode.project(live_lot, SEATS, 0)
        assert public["seat_names"] == ["Alice", "Bob"]

    def test_seat_bot_flags_come_from_the_foundation(self, live_lot):
        public, _, _ = td_mode.project(live_lot, SEATS, 0)
        assert public["seat_is_bot"] == [False, False]


@pytest.fixture()
def asset_urls_on():
    """The licensing gate, opened for one test.

    `ENABLE_EXTERNAL_ASSET_URLS` defaults to False and that default is a
    licensing decision, not an implementation one -- so it is flipped here and
    restored, never edited in config.
    """
    from app.core.config import settings

    original = settings.ENABLE_EXTERNAL_ASSET_URLS
    settings.ENABLE_EXTERNAL_ASSET_URLS = True
    yield
    settings.ENABLE_EXTERNAL_ASSET_URLS = original


def _resolved_slug() -> str:
    """A qualified candidate the committed manifest actually resolves.

    Chosen from the pool at call time rather than hard-coded: the manifest is
    regenerated by a script that hits the network, and a test pinned to one
    name would fail on a refresh that legitimately dropped that player.
    """
    from nba_peak.perfect_season.assets import get_player_headshot_url
    from nba_peak.twenty_dollar.pool import get_pool

    for card in get_pool().qualified:
        if get_player_headshot_url(card.player_slug):
            return card.player_slug
    raise AssertionError("no qualified candidate resolves in player_assets.v3.json")


class TestPlayerImagery:
    """`headshot_url` on the Showdown's payloads.

    ONE PIPELINE, ONE GATE. Every URL here comes from the committed manifest
    via `nba_peak.perfect_season.assets.get_player_headshot_url` -- the same
    lookup 82-0 uses, keyed on the same `player_slug` -- and only when
    `ENABLE_EXTERNAL_ASSET_URLS` is on. Nothing in this mode fetches, guesses
    or caches an image.
    """

    def test_the_gate_is_shut_by_default(self):
        """THE PRODUCTION POSTURE. With the default settings a live candidate
        carries the field as null, so no PEAK3 page contacts an external host
        and the client draws its medallion."""
        match = make_match()
        public, _, _ = td_mode.project(match, SEATS, 0)
        assert public["candidate"]["headshot_url"] is None

    def test_a_resolved_candidate_carries_the_manifests_own_url(self, asset_urls_on):
        from nba_peak.perfect_season.assets import get_player_headshot_url

        slug = _resolved_slug()
        snapshot = td_mode.initial_snapshot(4242, SEATS)
        snapshot["current_candidate"] = slug
        public, _, _ = td_mode.project(make_match(snapshot=snapshot), SEATS, 0)
        assert public["candidate"]["headshot_url"] == get_player_headshot_url(slug)
        assert public["candidate"]["headshot_url"].startswith("https://")

    def test_an_unresolved_candidate_is_never_given_a_fabricated_url(self, asset_urls_on):
        """Roughly three identities in four have no photograph in the
        manifest. That is a null, not a guessed URL pattern."""
        from nba_peak.perfect_season.assets import get_player_headshot_url
        from nba_peak.twenty_dollar.pool import get_pool

        unresolved = next(
            c.player_slug
            for c in get_pool().qualified
            if get_player_headshot_url(c.player_slug) is None
        )
        snapshot = td_mode.initial_snapshot(4242, SEATS)
        snapshot["current_candidate"] = unresolved
        public, _, _ = td_mode.project(make_match(snapshot=snapshot), SEATS, 0)
        assert public["candidate"]["headshot_url"] is None

    def test_imagery_adds_no_score_to_a_live_candidate(self, asset_urls_on):
        """THE CONSTRAINT THIS PASS COULD HAVE BROKEN. A photograph is
        identity; the score, the rank and the components are the thing being
        bid on. With the gate OPEN the live candidate must still carry exactly
        the allowlist plus the one image field, and the hidden numbers must
        appear nowhere in the projection."""
        from nba_peak.twenty_dollar.pool import get_pool

        slug = _resolved_slug()
        snapshot = td_mode.initial_snapshot(4242, SEATS)
        snapshot["current_candidate"] = slug
        card = get_pool().get(slug)
        public, private, _ = td_mode.project(make_match(snapshot=snapshot), SEATS, 0)
        assert set(public["candidate"]) == {
            "player_slug",
            "player_name",
            "anchor_season",
            "team",
            "positions",
            "headshot_url",
        }
        assert card.prime_score not in all_values(public)
        assert card.prime_score not in all_values(private)
        assert card.rank not in all_values(public)

    def test_rostered_players_carry_their_own_url(self, asset_urls_on):
        from nba_peak.perfect_season.assets import get_player_headshot_url

        slug = _resolved_slug()
        snapshot = td_mode.initial_snapshot(4242, SEATS)
        snapshot["seats"][0]["roster"] = [{"player_slug": slug, "price": 3}]
        public, _, _ = td_mode.project(make_match(snapshot=snapshot), SEATS, 0)
        entry = public["seats"][0]["roster"][0]
        assert entry["headshot_url"] == get_player_headshot_url(slug)

    def test_the_receipts_roster_carries_it_too(self, asset_urls_on):
        """The result screen's two team cards and the itemised receipt read
        different payloads; both must show the same face for the same player."""
        from nba_peak.perfect_season.assets import get_player_headshot_url

        slug = _resolved_slug()
        snapshot = td_mode.initial_snapshot(4242, SEATS)
        snapshot["seats"][0]["roster"] = [{"player_slug": slug, "price": 3}]
        snapshot["phase"] = "complete"
        match = make_match(snapshot=snapshot, status=MATCH_STATUS_COMPLETED)
        public, _, _ = td_mode.project(match, SEATS, 0)
        entry = public["receipt"]["seats"][0]["roster"][0]
        assert entry["headshot_url"] == get_player_headshot_url(slug)

    def test_decorating_history_does_not_write_into_the_stored_snapshot(
        self, asset_urls_on
    ):
        """`state.project` shallow-copies history rows, so their nested
        candidate dict is still the one inside the persisted snapshot. The
        decoration rebuilds those rows instead of mutating them -- otherwise
        projecting a match would quietly edit what the foundation stores."""
        match = make_match()
        first = active(match)
        step = reduce(match, cmd(first, "pass"))
        step = reduce(make_match(snapshot=step.snapshot), cmd(1 - first, "pass", key="k2"))
        settled = make_match(snapshot=step.snapshot)
        assert settled.snapshot["history"], "expected the unsold lot to settle"

        public, _, _ = td_mode.project(settled, SEATS, 0)
        assert "headshot_url" in public["history"][0]["candidate"]
        assert "headshot_url" not in settled.snapshot["history"][0]["candidate"]


class TestBot:
    def test_the_bot_returns_a_legal_command_from_a_seat_view_alone(self):
        match = make_match()
        seat = active(match)
        public, private, commands = td_mode.project(match, SEATS, seat)
        view = project_seat_view(match, SEATS[seat], public, private, commands, None, NOW)
        command = asyncio.run(td_bot.choose(view, random.Random(1)))
        assert command.command_type in view.legal_commands
        if command.command_type == "bid":
            assert private["minimum_bid"] <= command.payload["amount"] <= private["max_bid"]

    def test_the_bot_passes_when_it_has_no_legal_move(self):
        match = make_match()
        view = project_seat_view(match, SEATS[0], {}, {}, (), None, NOW)
        command = asyncio.run(td_bot.choose(view, random.Random(1)))
        assert command.command_type == "pass"

    def test_the_bot_opens_after_the_opponent_passes(self):
        """The independence requirement, at the seam. A human pass leaves the
        lot live and the bot free to take the player at $1."""
        opened = 0
        for seed in range(30):
            match = make_match(seed=seed)
            first = active(match)
            step = reduce(match, cmd(first, "pass"))
            if not step.accepted or step.open_turn is None:
                continue
            after = make_match(snapshot=step.snapshot, seed=seed)
            other = 1 - first
            public, private, commands = td_mode.project(after, SEATS, other)
            view = project_seat_view(after, SEATS[other], public, private, commands, None, NOW)
            command = asyncio.run(td_bot.choose(view, random.Random(seed)))
            if command.command_type == "bid":
                opened += 1
        assert opened > 0, "the bot mirrored the human's pass on every board"


class TestFullMatch:
    def _play(self, seed: int):
        """Drive a whole match through the reducer, one ACTION at a time.

        `active_seat` can legitimately be `None` mid-match now (the
        phantom-lot fix): the rules parked on a candidate neither seat can
        act on, and the mode is holding open the short, seatless
        `PHASE_LOT_UNWINNABLE` beat. That is not match completion -- it is
        walked forward the same way the foundation's own clock sweep would,
        by submitting a timeout against a turn naming that phase.
        """
        match = make_match(seed=seed)
        rng = random.Random(seed)
        final = None
        for step in range(2000):
            seat = active(match)
            if seat is None:
                out = td_mode.reduce(
                    ReducerInput(
                        match=match, seats=SEATS, open_turn=unwinnable_turn(step),
                        command=TIMEOUT_CMD, now=NOW,
                    )
                )
                assert out.accepted, out.rejection_code
                match = make_match(snapshot=out.snapshot, seed=seed)
                if out.status == MATCH_STATUS_COMPLETED:
                    final = out
                    break
                continue
            public, private, legal = td_mode.project(match, SEATS, seat)
            command, payload = td_bot.decide(public, private, rng)
            out = reduce(match, cmd(seat, command, payload, key=f"k-idem-{step:04d}"))
            assert out.accepted, out.rejection_code
            match = make_match(snapshot=out.snapshot, seed=seed)
            if out.status == MATCH_STATUS_COMPLETED:
                final = out
                break
        return final

    def test_a_match_played_through_the_reducer_completes_and_settles(self):
        final = self._play(777)
        assert final is not None, "the match never completed"
        assert len(final.results) == 2
        assert sorted(r.placement for r in final.results) in ([1, 2], [1, 1])
        assert all(r.score > 0 for r in final.results)
        assert all(r.detail["model_version"] == "peak3_v1" for r in final.results)
        assert all(len(r.detail["roster"]) == 5 for r in final.results)
        assert final.open_turn is None

    def test_every_turn_before_completion_names_exactly_one_seat(self):
        """Every per-seat AUCTION turn before completion names exactly one
        seat. The two legitimate exceptions are the seatless
        `PHASE_LOT_UNWINNABLE` beat (the phantom-lot fix -- a candidate
        neither seat can act on) and `PHASE_LOT_FORCED_FILL` (PEAK3 Pass 1 --
        a position no OTHER still-competing seat could ever have contested):
        both open as a real turn belonging to no seat, not a per-seat turn
        with no seat to hand it to. Each beat is walked forward via its own
        timeout, exactly as the foundation's clock sweep would, and is
        asserted here to never masquerade as a normal seat turn.
        """
        match = make_match(seed=555)
        rng = random.Random(555)
        for step in range(2000):
            seat = active(match)
            if seat is None:
                forced_fill = S.is_forced_fill_pending(match.snapshot)
                turn = forced_fill_turn(step) if forced_fill else unwinnable_turn(step)
                out = td_mode.reduce(
                    ReducerInput(
                        match=match, seats=SEATS, open_turn=turn,
                        command=TIMEOUT_CMD, now=NOW,
                    )
                )
                assert out.accepted, out.rejection_code
                if out.status == MATCH_STATUS_COMPLETED:
                    assert out.open_turn is None
                    break
                assert out.open_turn is not None
                assert out.open_turn.phase in ("auction", PHASE_LOT_UNWINNABLE, PHASE_LOT_FORCED_FILL)
                if out.open_turn.phase in (PHASE_LOT_UNWINNABLE, PHASE_LOT_FORCED_FILL):
                    assert out.open_turn.seat_index is None
                else:
                    assert out.open_turn.seat_index in (0, 1)
                match = make_match(snapshot=out.snapshot, seed=555)
                continue
            public, private, _ = td_mode.project(match, SEATS, seat)
            command, payload = td_bot.decide(public, private, rng)
            out = reduce(match, cmd(seat, command, payload, key=f"k-idem-{step:04d}"))
            if out.status == MATCH_STATUS_COMPLETED:
                assert out.open_turn is None
                break
            assert out.open_turn is not None
            if out.open_turn.phase in (PHASE_LOT_UNWINNABLE, PHASE_LOT_FORCED_FILL):
                assert out.open_turn.seat_index is None
            else:
                assert out.open_turn.seat_index in (0, 1)
            assert out.open_turn.deadline_at > NOW
            match = make_match(snapshot=out.snapshot, seed=555)

    def test_the_completion_event_carries_the_receipt_and_states_five_components(self):
        final = self._play(777)
        assert final is not None
        completed = [e for e in final.events if e.event_type == "match_completed"]
        assert len(completed) == 1
        assert completed[0].visibility == VISIBILITY_PUBLIC
        disclosure = completed[0].payload["receipt"]["component_disclosure"]
        assert disclosure["count"] == 5 and disclosure["house_count"] == 6
        assert disclosure["absent"] == ["teammate_adjustment"]

    def test_a_completed_match_projects_its_receipt(self):
        final = self._play(777)
        assert final is not None
        match = make_match(snapshot=final.snapshot, seed=777, status=MATCH_STATUS_COMPLETED)
        public, _, legal = td_mode.project(match, SEATS, 0)
        assert public["receipt"]["settlement"] is not None
        assert legal == ()


# ---------------------------------------------------------------------------
# The phantom-lot fix, at the orchestration seam.
# ---------------------------------------------------------------------------
#
# THE INVARIANT THESE TESTS PROVE, stated once here rather than in each one:
# for every settled lot a receipt reports, there must have been a real,
# observable moment -- reachable by an ordinary client poll, not merely by
# code that never ran -- where that exact candidate was `current_candidate`
# with the match still live. The bug this fixes made that false for any
# candidate neither seat could act on: `_advance_lot` drew it and settled it
# unsold inside one Python call, so no read at any polling cadence could ever
# have caught it live. The fix is `PHASE_LOT_UNWINNABLE`, a real turn that
# belongs to no seat, is readable like any other turn, and resolves only on
# its own short deadline (`_resolve_unwinnable_lot`).
#
# These tests drive the REAL orchestration path -- `td_mode.reduce`, exactly
# as the foundation calls it -- rather than the pure engine tested in
# `tests/twenty_dollar/test_phantom_lot_fix.py`. That file proves the rules;
# this one proves the seam a client actually reads through.


BOT_SEATS = (
    ArenaSeat(
        match_id="m1", seat_index=0, occupant_kind=OCCUPANT_BOT,
        occupant_sub=None, bot_id="td-bot-0", display_name="PEAK3 player",
    ),
    ArenaSeat(
        match_id="m1", seat_index=1, occupant_kind=OCCUPANT_BOT,
        occupant_sub=None, bot_id="td-bot-1", display_name="PEAK3 player",
    ),
)


def _status_after(out) -> str:
    return MATCH_STATUS_COMPLETED if out.status == MATCH_STATUS_COMPLETED else MATCH_STATUS_ACTIVE


def _build_parked_snapshot(seed: int, seats=SEATS) -> tuple[dict, str]:
    """A REAL match, driven forward through `td_mode.reduce` by the shipped
    bot until one seat's roster is full, then hand-parked: the live lot is
    swapped for a real pool candidate that fits none of the still-open seat's
    remaining slots, and `active_seat`/`passed` are set to the shape
    `_advance_lot` used to leave behind on its own.

    WHY HAND-BUILT RATHER THAN FOUND. `_eligible_candidates`
    (`nba_peak/twenty_dollar/state.py`) is the fix for the defect THIS pass
    exists to close: the standard and closeout markets now draw only from
    candidates at least one still-incomplete seat could legally win, so
    `_advance_lot` cannot produce this shape through ordinary play any more --
    a search across seeds that used to find one within the first handful now
    finds none at all (see `tests/twenty_dollar/test_phantom_lot_fix.py`,
    which proves exactly that directly). `_resolve_unwinnable_lot` and
    `_open_turn_for_snapshot` do not care how their precondition arose, so it
    is built directly here, the same way `test_phantom_lot_fix.py`'s
    `_build_parked_state` does at the pure-engine layer -- this is the
    orchestration seam's equivalent proof that the MECHANISM still behaves
    correctly if a snapshot should ever carry the shape again (most plausibly
    one written by a build that predates this fix).

    RETRIED ACROSS A FEW DETERMINISTIC SEED OFFSETS, NOT JUST THE ONE PASSED
    IN -- see `tests/twenty_dollar/test_phantom_lot_fix.py::_build_parked_
    state`'s identical retry for why: intersection-drawn lots (PEAK3 Pass 1)
    can converge a leading roster fast enough that the OTHER seat is still
    very sparse (zero or one players) at the exact moment one side fills,
    which occasionally leaves no candidate in the qualified pool that is both
    outside its naive open slots and provably unacquirable once multi-
    position reassignment is considered. A property of one specific seed's
    play meeting a wide-open roster, not of `can_seat_acquire` or the
    eligibility rule -- retrying a few seeds away finds one where enough
    commitment survived to construct a genuine outsider.
    """
    last_error: Optional[AssertionError] = None
    for attempt in range(6):
        try:
            return _try_build_parked_snapshot(seed + attempt * 100_000, seats)
        except AssertionError as exc:
            last_error = exc
    assert last_error is not None
    raise last_error


#: See `tests/twenty_dollar/test_phantom_lot_fix.py::_MIN_OPEN_SEAT_
#: COMMITMENT`'s identical constant for why "one seat full" alone is not
#: enough to stop on: an empty still-open roster cannot construct an outsider
#: against at all, by definition.
_MIN_OPEN_SEAT_COMMITMENT = 2


def _try_build_parked_snapshot(seed: int, seats) -> tuple[dict, str]:
    match = make_match(seed=seed)
    rng = random.Random(seed ^ 0x20D0)

    def _ready() -> bool:
        sizes = sorted(len(s["roster"]) for s in match.snapshot["seats"])
        return sizes[-1] >= ROSTER_SIZE and _MIN_OPEN_SEAT_COMMITMENT <= sizes[0] < ROSTER_SIZE

    for step in range(2000):
        if _ready():
            break
        seat = active(match)
        if seat is None:
            # A forced-fill park (PEAK3 Pass 1) is an expected beat once
            # rosters' needs diverge, unlike the unwinnable beat this
            # docstring's own history is about -- walk it forward the same
            # way `unwinnable_turn` is walked, via its own timeout.
            assert S.is_forced_fill_pending(match.snapshot), (
                f"seed {seed}: active_seat is None mid-match but no forced-fill "
                "is pending either"
            )
            out = td_mode.reduce(
                ReducerInput(
                    match=match, seats=seats, open_turn=forced_fill_turn(step),
                    command=TIMEOUT_CMD, now=NOW,
                )
            )
            assert out.accepted, out.rejection_code
            if out.status == MATCH_STATUS_COMPLETED:
                raise AssertionError(f"seed {seed}: match completed before any roster filled solo")
            match = make_match(snapshot=out.snapshot, seed=seed)
            continue
        public, private, _ = td_mode.project(match, seats, seat)
        command, payload = td_bot.decide(public, private, rng)
        out = td_mode.reduce(
            ReducerInput(
                match=match, seats=seats,
                open_turn=None, command=cmd(seat, command, payload, key=f"k-idem-{step:04d}"),
                now=NOW,
            )
        )
        assert out.accepted, out.rejection_code
        if out.status == MATCH_STATUS_COMPLETED:
            raise AssertionError(f"seed {seed}: match completed before any roster filled solo")
        match = make_match(snapshot=out.snapshot, seed=seed)
    else:
        raise AssertionError(f"seed {seed}: no roster filled before the guard tripped")

    pool = get_pool()
    snapshot = copy.deepcopy(match.snapshot)
    full_index = next(
        i for i, s in enumerate(snapshot["seats"]) if len(s["roster"]) >= ROSTER_SIZE
    )
    open_index = 1 - full_index
    open_seat = snapshot["seats"][open_index]
    owned = [
        (entry["player_slug"], pool.get(entry["player_slug"]).positions)
        for entry in open_seat["roster"]
    ]
    open_slots = set(feasibility.open_slots_for(owned))
    assert open_slots, f"seed {seed}: the still-incomplete seat has no legal open slot"
    # A COMPLETELY EMPTY ROSTER CANNOT CONSTRUCT AN OUTSIDER, EVER -- see
    # `tests/twenty_dollar/test_phantom_lot_fix.py::_try_build_parked_state`'s
    # identical guard for why. Signalled as a failed attempt so the wrapper
    # retries a different seed offset.
    assert len(open_slots) < ROSTER_SIZE, (
        f"seed {seed}: the still-incomplete seat owns nothing yet -- no outsider is "
        "constructible against a fully open roster"
    )

    gone = {
        entry["player_slug"] for s in snapshot["seats"] for entry in s["roster"]
    } | set(snapshot["offered"])
    # THE AUTHORITATIVE CHECK, NOT THE `open_slots_for(owned)` HEURISTIC --
    # see `test_phantom_lot_fix.py::_build_parked_state`'s identical fix for
    # why: a still-flexible roster (one or two multi-position players) can be
    # legally reassigned to make room for a candidate the naive open-slots
    # snapshot says should not fit, which `can_seat_acquire` accounts for and
    # this heuristic does not.
    outsider = next(
        (
            c
            for c in pool.qualified
            if c.player_slug not in gone
            and not (set(c.positions) & open_slots)
            and not S.can_seat_acquire(snapshot, open_index, c, pool)
        ),
        None,
    )
    assert outsider is not None, (
        f"seed {seed}: no qualified candidate is both outside {open_slots} and "
        "unacquirable by can_seat_acquire"
    )

    snapshot["current_candidate"] = outsider.player_slug
    snapshot["current_candidate_tier"] = "1-100"
    snapshot["offered"].append(outsider.player_slug)
    snapshot["active_seat"] = None
    snapshot["current_bid"] = 0
    snapshot["high_bidder"] = None
    snapshot["lot_bids"] = [0] * len(snapshot["seats"])
    snapshot["lot_actions"] = []
    snapshot["passed"] = [True] * len(snapshot["seats"])
    return snapshot, outsider.player_slug


class TestPhantomLotFixRequestCycle:
    """Part 3.2: the full request-cycle proof.

    A candidate neither seat can act on is drawn mid-match, surfaces as a
    real seatless turn, is readable exactly as any other turn while it is
    open, and settles only once -- via its own deadline -- after which the
    match proceeds normally.
    """

    def test_the_reducer_opens_the_beat_as_a_real_seatless_turn(self):
        snapshot, slug = _build_parked_snapshot(0)
        parked = make_match(snapshot=snapshot, seed=0)
        # `_open_turn_for_snapshot` is the ONE place that decides what turn
        # follows a snapshot the rules engine has already advanced -- every
        # caller that opens a turn after a rules call routes through it, so
        # this is the direct, adapter-level proof that a parked snapshot is
        # ALWAYS surfaced as the seatless beat rather than a normal per-seat
        # turn naming no seat.
        turn_draft = td_mode._open_turn_for_snapshot(
            snapshot,
            ReducerInput(
                match=parked, seats=SEATS, open_turn=None, command=TIMEOUT_CMD, now=NOW
            ),
        )
        assert turn_draft.phase == PHASE_LOT_UNWINNABLE
        assert turn_draft.seat_index is None
        assert turn_draft.deadline_at == NOW + timedelta(seconds=LOT_UNWINNABLE_SECONDS)

        # THE RULE UNDER IT: neither seat could, in fact, act on this
        # candidate -- restated at the rules level so this is not merely
        # trusting the phase name.
        assert slug == snapshot["current_candidate"]
        pool = get_pool()
        candidate = pool.get(slug)
        for seat_index in range(len(snapshot["seats"])):
            assert not S.can_seat_acquire(snapshot, seat_index, candidate, pool)

    def test_a_client_read_during_the_beat_sees_the_parked_candidate_not_a_gap(self):
        """A GET-equivalent projection taken while the beat is open must show
        `current_candidate` populated and `active_seat` null -- a real,
        readable turn, not an internal-only detail and not a silent skip."""
        snapshot, slug = _build_parked_snapshot(1)
        parked = make_match(snapshot=snapshot, seed=1)

        for seat_index in (0, 1):
            public, _private, commands = td_mode.project(parked, SEATS, seat_index)
            assert public["phase"] == "auction"
            assert public["candidate"] is not None
            assert public["candidate"]["player_slug"] == slug
            assert public["active_seat"] is None
            # Nobody has a move on this beat -- conceding is still legal for
            # as long as the match is live (`project`'s own rule), and
            # nothing else is.
            assert commands == (COMMAND_FORFEIT,)
            # And the candidate's hidden score still has not crossed, exactly
            # as it would not have for an ordinary live lot.
            assert "prime_score" not in public["candidate"]

    def test_advancing_past_the_deadline_settles_exactly_one_lot_unsold_then_continues(self):
        """The beat's OWN timeout -- and only it -- settles the lot. One new
        `lot_resolved` event, `decided_by == "unsold"`, for that candidate,
        and the match opens whatever real turn comes next."""
        snapshot, slug = _build_parked_snapshot(2)
        parked = make_match(snapshot=snapshot, seed=2)
        open_turn = unwinnable_turn()
        history_before = len(parked.snapshot["history"])
        deadline = open_turn.deadline_at

        resolved = td_mode.reduce(
            ReducerInput(
                match=parked, seats=SEATS, open_turn=open_turn,
                command=TIMEOUT_CMD, now=deadline,
            )
        )
        assert resolved.accepted, resolved.rejection_code
        assert resolved.resolve_turn == "timeout"

        lot_events = [e for e in resolved.events if e.event_type == "lot_resolved"]
        assert len(lot_events) == 1, "exactly one lot must settle from this beat"
        settled = lot_events[0].payload
        assert settled["candidate"]["player_slug"] == slug
        assert settled["decided_by"] == "unsold"
        assert settled["winner_seat"] is None
        assert settled["price"] == 0

        history_after = resolved.snapshot["history"]
        assert len(history_after) == history_before + 1
        assert history_after[history_before]["candidate"]["player_slug"] == slug

        # The match proceeds normally: complete, a real per-seat turn, or --
        # unluckily but correctly -- another unwinnable beat. Never a dead
        # turn and never a per-seat turn naming no seat.
        if resolved.status == MATCH_STATUS_COMPLETED:
            assert resolved.open_turn is None
        else:
            assert resolved.open_turn is not None
            if resolved.open_turn.phase == PHASE_LOT_UNWINNABLE:
                assert resolved.open_turn.seat_index is None
            else:
                assert resolved.open_turn.phase == "auction"
                assert resolved.open_turn.seat_index in (0, 1)


class TestPhantomLotFixReconnect:
    def test_a_fresh_reconnect_mid_beat_sees_the_identical_parked_state(self):
        """A client that loads the match state fresh WHILE the beat is open
        -- a reconnect, a second tab, a page reload -- must see the same
        parked-but-real state a continuously-connected client saw, not an
        error and not a state that has quietly moved on without an event."""
        snapshot, slug = _build_parked_snapshot(3)
        parked = make_match(snapshot=snapshot, seed=3)

        before = copy.deepcopy(parked.snapshot)
        first_read = td_mode.project(parked, SEATS, 0)

        # A SEPARATE, freshly constructed match object from the same
        # persisted snapshot -- exactly what a reconnecting client's own GET
        # would build server-side, independent of whatever object reference
        # produced the beat in the first place.
        reconnected = make_match(snapshot=copy.deepcopy(snapshot), seed=3)
        second_read = td_mode.project(reconnected, SEATS, 0)

        assert first_read[0] == second_read[0], "a reconnect saw a different public state"
        assert second_read[0]["active_seat"] is None
        assert second_read[0]["candidate"] is not None
        assert second_read[0]["candidate"]["player_slug"] == slug

        # Reading -- polling, reconnecting -- must never itself mutate the
        # persisted snapshot. Only an accepted command may.
        assert parked.snapshot == before

    def test_repeated_reads_of_the_parked_beat_are_idempotent(self):
        """Two polls a client makes seconds apart during the same beat must
        agree with each other, since nothing but the beat's own timeout can
        move this state."""
        snapshot, _slug = _build_parked_snapshot(4)
        parked = make_match(snapshot=snapshot, seed=4)
        first = td_mode.project(parked, SEATS, 1)
        second = td_mode.project(parked, SEATS, 1)
        assert first[0] == second[0]
        assert first[1] == second[1]
        assert first[2] == second[2]


class TestPhantomLotFixBotPractice:
    def test_a_bot_versus_bot_practice_match_completes_normally_through_the_beat(self):
        """Bot practice (both seats bots) must complete with two legal,
        five-player rosters even when the market draws a candidate neither
        bot can act on mid-match -- and neither bot may be asked to act on
        that beat at all (`phase_accepts_action` blocks it; this proves the
        block actually holds for a real match that reaches the beat, not
        merely in isolation)."""
        seed = 5
        snapshot, _slug = _build_parked_snapshot(seed, seats=BOT_SEATS)
        match = make_match(snapshot=snapshot, seed=seed)
        open_turn = unwinnable_turn()
        assert td_mode.phase_accepts_action(open_turn.phase) is False

        rng = random.Random(seed ^ 0x5CA1E)
        beats_seen = 1
        for step in range(2000):
            if match.snapshot.get("phase") == "complete":
                break
            if open_turn.phase == PHASE_LOT_UNWINNABLE:
                out = td_mode.reduce(
                    ReducerInput(
                        match=match, seats=BOT_SEATS, open_turn=open_turn,
                        command=TIMEOUT_CMD, now=open_turn.deadline_at,
                    )
                )
            else:
                seat = active(match)
                # STRUCTURAL PROOF a bot never acts on the seatless beat: this
                # branch, the only place a bot command is ever built, is only
                # reached when the open turn names a real seat.
                assert seat is not None
                public, private, _ = td_mode.project(match, BOT_SEATS, seat)
                command, payload = td_bot.decide(public, private, rng)
                out = td_mode.reduce(
                    ReducerInput(
                        match=match, seats=BOT_SEATS, open_turn=None,
                        command=cmd(seat, command, payload, key=f"k-idem-{step:04d}"),
                        now=NOW,
                    )
                )
            assert out.accepted, out.rejection_code
            if out.status == MATCH_STATUS_COMPLETED:
                match = make_match(snapshot=out.snapshot, seed=seed, status=MATCH_STATUS_COMPLETED)
                break
            assert out.open_turn is not None
            if out.open_turn.phase == PHASE_LOT_UNWINNABLE:
                beats_seen += 1
            match = make_match(snapshot=out.snapshot, seed=seed)
            open_turn = out.open_turn
        else:
            raise AssertionError(f"seed {seed}: bot practice match did not terminate")

        assert match.snapshot["phase"] == "complete"
        assert beats_seen >= 1
        for seat_report in match.snapshot["seats"]:
            assert len(seat_report["roster"]) == 5
            assert seat_report["budget"] >= 0


class TestPhantomLotFixInvariant:
    """Part 3.3: THE PRODUCT OWNER'S INVARIANT, proven directly.

    'For every settled lot visible in a completed/mid-game history, there
    must have been a corresponding surfaced active-lot state in the player's
    observable sequence.'

    Played through the real orchestration path (`td_mode.reduce` plus a
    simulated timeout sweep for the seatless beats -- never the raw pure
    engine), recording every `current_candidate` a client's own poll could
    have read at each step, live, before that candidate's lot appears
    settled in history.
    """

    @staticmethod
    def _play_recording_observations(seed: int):
        match = make_match(seed=seed)
        rng = random.Random(seed ^ 0x0BCE)
        observed: set[tuple[str, object]] = set()

        for step in range(4000):
            # THE CLIENT'S OWN READ, taken before anything this iteration
            # does. This is what makes the recording honest: it is exactly
            # the projection `GET /matches/{id}` would hand back at this
            # instant, for THIS match value, before any further reducer call.
            public, _private, _commands = td_mode.project(match, SEATS, 0)
            if public["candidate"] is not None:
                observed.add((public["candidate"]["player_slug"], public["active_seat"]))
            if public["phase"] == "complete":
                return match, observed

            seat = public["active_seat"]
            if seat is None:
                out = td_mode.reduce(
                    ReducerInput(
                        match=match, seats=SEATS, open_turn=unwinnable_turn(step),
                        command=TIMEOUT_CMD, now=NOW,
                    )
                )
            else:
                _pub, private, _ = td_mode.project(match, SEATS, seat)
                command, payload = td_bot.decide(public, private, rng)
                out = reduce(match, cmd(seat, command, payload, key=f"k-idem-{step:04d}"))
            assert out.accepted, out.rejection_code
            match = make_match(snapshot=out.snapshot, seed=seed, status=_status_after(out))

        raise AssertionError(f"seed {seed}: match did not terminate")

    def test_every_settled_lot_was_observed_live_before_it_settled(self):
        phantom_parked_total = 0
        for seed in (3, 11, 33, 91, 202, 333, 555, 777, 3003, 40404):
            match, observed_slugs_with_seat = self._play_recording_observations(seed)
            observed_slugs = {slug for slug, _active in observed_slugs_with_seat}
            history = match.snapshot["history"]
            auctioned = [r for r in history if r["decided_by"] != S.DECIDED_BY_AUTOFILL]
            assert auctioned, f"seed {seed}: nothing was auctioned"

            for record in auctioned:
                slug = record["candidate"]["player_slug"]
                assert slug in observed_slugs, (
                    f"seed {seed}: lot {record['lot_index']} ({slug}) settled "
                    f"as {record['decided_by']!r} but was never observed as "
                    "the live current lot by any client read -- this is "
                    "exactly the phantom-settled-lot bug the fix removes"
                )

            # A record with NO recorded actions and `decided_by == 'unsold'`
            # is the specific phantom-lot shape: nobody was ever handed a
            # turn to act on it, because neither seat legally could.
            #
            # THIS IS NOW EXPECTED TO BE ZERO, EVERY SEED. Before the
            # eligibility pre-filter (`nba_peak/twenty_dollar/state.py::
            # _eligible_candidates`), this count being positive was the proof
            # the sweep had actually exercised defect 1's fix rather than
            # holding vacuously. After it, `_advance_lot` never draws a
            # candidate neither still-incomplete seat can act on in the first
            # place, so the shape this counts should never occur through
            # ordinary play again -- see `TestPhantomLotFixRequestCycle` /
            # `TestPhantomLotFixReconnect` above for direct, hand-built proof
            # that the RESOLUTION mechanism still behaves correctly on the
            # rare occasions (a pre-fix snapshot, say) it might still see one.
            phantom_parked_total += sum(
                1
                for r in auctioned
                if r["decided_by"] == S.DECIDED_BY_UNSOLD and not r["actions"]
            )

        assert phantom_parked_total == 0, (
            f"{phantom_parked_total} phantom-parked lot(s) occurred through "
            "ordinary play -- the eligibility pre-filter should make this "
            "unreachable; see `nba_peak.twenty_dollar.state._eligible_candidates`"
        )



# ---------------------------------------------------------------------------
# ARRIVAL (game-feel pass 4)
# ---------------------------------------------------------------------------


def arrival_turn(seq: int = 0) -> ArenaTurn:
    return ArenaTurn(
        match_id="m1", turn_seq=seq, phase=PHASE_ARRIVAL, seat_index=None,
        deadline_at=NOW + timedelta(seconds=ARRIVAL_BACKSTOP_SECONDS), opened_at=NOW,
    )


class TestArrival:
    def test_each_human_is_offered_only_the_report_and_conceding(self):
        match = make_match(td_mode.initial_snapshot(4242, SEATS))
        for seat in (0, 1):
            public, _private, legal = td_mode.project(match, SEATS, seat)
            assert set(legal) == {COMMAND_INTRO_SEEN, COMMAND_FORFEIT}, legal
            assert public["arrival"] == {"arrived_seats": []}

    def test_the_intro_starts_from_the_last_report_not_from_creation(self):
        match = make_match(td_mode.initial_snapshot(4242, SEATS))
        late = NOW + timedelta(seconds=12)
        first = td_mode.reduce(ReducerInput(match=match, seats=SEATS, open_turn=arrival_turn(), command=cmd(0, COMMAND_INTRO_SEEN, key="arr-0"), now=late))
        assert first.accepted and first.open_turn is None and first.resolve_turn is None
        assert first.snapshot["arrived_seats"] == [0]
        # The same seat again changes nothing.
        again = td_mode.reduce(ReducerInput(match=make_match(first.snapshot), seats=SEATS, open_turn=arrival_turn(), command=cmd(0, COMMAND_INTRO_SEEN, key="arr-0b"), now=late))
        assert not again.accepted and again.rejection_code == REJECT_INTRO_ALREADY_SEEN
        second = td_mode.reduce(ReducerInput(match=make_match(first.snapshot), seats=SEATS, open_turn=arrival_turn(), command=cmd(1, COMMAND_INTRO_SEEN, key="arr-1"), now=late))
        assert second.accepted
        assert second.open_turn.phase == PHASE_INTRO and second.open_turn.seat_index is None
        assert second.open_turn.deadline_at == late + timedelta(seconds=INTRO_SECONDS)
        assert "arrival_open" not in second.snapshot and "arrived_seats" not in second.snapshot
        # The lot is untouched by arriving.
        assert second.snapshot["current_candidate"] == match.snapshot["current_candidate"]
        assert second.snapshot["history"] == []

    def test_a_report_after_the_intro_started_is_refused_by_name(self):
        out = td_mode.reduce(ReducerInput(match=make_match(), seats=SEATS, open_turn=intro_turn(), command=cmd(0, COMMAND_INTRO_SEEN), now=NOW))
        assert not out.accepted and out.rejection_code == REJECT_INTRO_STARTED

    def test_nobody_bids_or_passes_while_the_table_is_arriving(self):
        match = make_match(td_mode.initial_snapshot(4242, SEATS))
        opener = match.snapshot["active_seat"]
        for command_type, payload in (("bid", {"amount": 1}), ("pass", {})):
            out = td_mode.reduce(ReducerInput(match=match, seats=SEATS, open_turn=arrival_turn(), command=cmd(opener, command_type, payload), now=NOW))
            assert not out.accepted, command_type
            assert out.rejection_code == "not_your_turn", command_type

    def test_a_bot_is_already_at_the_table(self):
        seats = (SEATS[0], ArenaSeat(match_id="m1", seat_index=1, occupant_kind=OCCUPANT_BOT, bot_id="b", bot_rating=1200.0, display_name="Bot"))
        match = make_match(td_mode.initial_snapshot(4242, SEATS))
        _public, _private, legal = td_mode.project(match, seats, 1)
        assert COMMAND_INTRO_SEEN not in legal
        out = td_mode.reduce(ReducerInput(match=match, seats=seats, open_turn=arrival_turn(), command=cmd(0, COMMAND_INTRO_SEEN), now=NOW))
        assert out.accepted and out.open_turn.phase == PHASE_INTRO

    def test_the_backstop_opens_the_intro_never_a_lot(self):
        match = make_match(td_mode.initial_snapshot(4242, SEATS))
        at = NOW + timedelta(seconds=ARRIVAL_BACKSTOP_SECONDS)
        out = td_mode.reduce(ReducerInput(match=match, seats=SEATS, open_turn=arrival_turn(), command=TIMEOUT_CMD, now=at))
        assert out.accepted
        assert out.open_turn.phase == PHASE_INTRO
        assert out.open_turn.deadline_at == at + timedelta(seconds=INTRO_SECONDS)
        assert out.snapshot["history"] == [] and out.snapshot["lot_actions"] == []
