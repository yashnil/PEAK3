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
import random
from datetime import datetime, timedelta, timezone

import pytest

from app.repositories.arena_protocols import (
    COMMAND_TYPE_TIMEOUT,
    MATCH_STATUS_ACTIVE,
    MATCH_STATUS_COMPLETED,
    OCCUPANT_HUMAN,
    VISIBILITY_PUBLIC,
    ArenaMatch,
    ArenaSeat,
    ArenaTurn,
    CommandRequest,
    ReducerInput,
    project_seat_view,
)
from app.services.twenty_dollar.mode import bot as td_bot
from app.services.twenty_dollar.mode import mode as td_mode
from app.services.arena.modes import ArenaMode, initial_turn_seat

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
        snapshot=snapshot if snapshot is not None else td_mode.initial_snapshot(seed, SEATS),
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


def reduce(match, command, now=NOW):
    return td_mode.reduce(
        ReducerInput(match=match, seats=SEATS, open_turn=None, command=command, now=now)
    )


def active(match) -> int:
    return match.snapshot["active_seat"]


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
        assert td_mode.initial_phase() == "auction"

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
        """"PEAK3 bot (random_legal_v1)" reached the live lobby. The id lives on
        the seat row where ratings need it, and the NAME is authored."""
        from app.services.arena.bots import bot_seat

        seat = bot_seat("m1", 1, td_bot, seat_count=2)
        assert seat.display_name == "PEAK3 Bot"
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
    """The foundation used to hardcode the first turn onto seat 0."""

    def test_the_mode_names_the_first_seat(self):
        for seed in (1, 2, 3, 4, 5, 6, 7, 8):
            snapshot = td_mode.initial_snapshot(seed, SEATS)
            assert td_mode.initial_turn_seat(snapshot) == snapshot["opening_seat"]

    def test_the_foundation_seam_asks_the_mode(self):
        snapshot = td_mode.initial_snapshot(4242, SEATS)
        assert initial_turn_seat(td_mode, snapshot) == snapshot["opening_seat"]

    def test_it_is_not_always_seat_zero(self):
        openers = {
            td_mode.initial_snapshot(seed, SEATS)["opening_seat"] for seed in range(40)
        }
        assert openers == {0, 1}


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
        """Drive a whole match through the reducer, one ACTION at a time."""
        match = make_match(seed=seed)
        rng = random.Random(seed)
        final = None
        for step in range(2000):
            seat = active(match)
            if seat is None:
                break
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
        match = make_match(seed=555)
        rng = random.Random(555)
        for step in range(2000):
            seat = active(match)
            if seat is None:
                break
            public, private, _ = td_mode.project(match, SEATS, seat)
            command, payload = td_bot.decide(public, private, rng)
            out = reduce(match, cmd(seat, command, payload, key=f"k-idem-{step:04d}"))
            if out.status == MATCH_STATUS_COMPLETED:
                assert out.open_turn is None
                break
            assert out.open_turn is not None
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
