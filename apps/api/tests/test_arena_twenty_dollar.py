"""The $20 Showdown mode, against the real foundation types.

WHAT THIS FILE IS AND IS NOT. The auction's RULES are tested in
`tests/twenty_dollar/` at the repository root -- 112 tests that need no
database, no app and no event loop. This file tests only the SEAM: that the
mode satisfies `ArenaMode`, that a `ReducerInput` in produces a correct
`ReducerOutput` out, and above all that nothing the foundation persists or
projects carries a sealed bid.

The leak tests here are written as recursive VALUE searches rather than key
checks. A key assertion (`assert "bid" not in payload`) is passed by any future
field that happens to carry the number, and this is the one place in the mode
where a miss is a cheating bug rather than a crash.
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
    VISIBILITY_SEAT,
    ArenaMatch,
    ArenaSeat,
    CommandRequest,
    ReducerInput,
    project_seat_view,
)
from app.services.twenty_dollar.mode import bot as td_bot
from app.services.twenty_dollar.mode import mode as td_mode
from app.services.arena.modes import ArenaMode

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


def make_match(snapshot=None, seed=4242) -> ArenaMatch:
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
        status=MATCH_STATUS_ACTIVE,
        snapshot=snapshot if snapshot is not None else td_mode.initial_snapshot(seed, SEATS),
    )


def cmd(seat, command_type, payload=None, key="k") -> CommandRequest:
    return CommandRequest(
        match_id="m1", idempotency_key=key, command_type=command_type,
        payload=payload or {}, actor_sub=f"u{seat}", actor_seat_index=seat,
        expected_state_version=0, issued_at=NOW,
    )


TIMEOUT_CMD = CommandRequest(
    match_id="m1", idempotency_key="t", command_type=COMMAND_TYPE_TIMEOUT,
    payload={}, actor_sub=None, actor_seat_index=None,
    expected_state_version=None, issued_at=NOW,
)


def reduce(match, command):
    return td_mode.reduce(
        ReducerInput(match=match, seats=SEATS, open_turn=None, command=command, now=NOW)
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
        assert td_mode.seat_count == 2
        assert td_mode.turn_seconds > 0
        assert td_mode.initial_phase() == "bidding"

    def test_is_registrable_and_retrievable_under_its_name(self):
        """Registration, without depending on global state other tests own.

        The obvious version of this test -- `assert registry.has("twenty_dollar")`
        on the process-wide registry, relying on the import at the top of this
        file having registered it -- PASSES ALONE AND FAILS IN THE SUITE.
        `test_arena_routes.py:129` calls `mode_registry.clear()`, which is a
        legitimate seam that file owns; by the time this class runs, the
        registration is gone.

        That was a bug in this test rather than in the mode or in that seam, so
        the fix is to assert the real property in isolation: this object can be
        registered under its own name and comes back out. Re-registering the
        SAME instance is explicitly allowed (`modes.py:129-131` refuses only a
        DIFFERENT object claiming the name), so this is safe to run whatever
        order the suite happens to take.
        """
        from app.services.arena.modes import ModeRegistry

        isolated = ModeRegistry()
        isolated.register(td_mode)
        assert isolated.has("twenty_dollar")
        assert isolated.get("twenty_dollar") is td_mode
        assert "twenty_dollar" in isolated.names()

    def test_importing_the_module_registers_the_mode(self):
        """The import-time side effect itself, asserted where it is observable.

        Checked against the process registry only if nothing has cleared it --
        otherwise re-imported explicitly, so this documents the behaviour
        without becoming another order-dependent failure.
        """
        import importlib

        from app.services.arena.modes import registry

        if not registry.has("twenty_dollar"):
            importlib.reload(
                importlib.import_module("app.services.twenty_dollar.mode")
            )
        assert registry.has("twenty_dollar")

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


class TestBidding:
    def test_a_bid_is_accepted_and_leaves_the_round_open(self):
        out = reduce(make_match(), cmd(0, "bid", {"amount": 9}))
        assert out.accepted
        assert out.open_turn is None and out.resolve_turn is None

    def test_a_locked_bid_emits_a_seat_visible_event_with_no_amount(self):
        """Events are persisted and replayable, so a public event carrying a
        bid would leak it durably -- past where `project` could help."""
        out = reduce(make_match(), cmd(0, "bid", {"amount": 9}))
        assert len(out.events) == 1
        event = out.events[0]
        assert event.event_type == "bid_locked"
        assert event.visibility == VISIBILITY_SEAT
        assert event.visible_to_seat == 0
        assert 9 not in all_values(event.payload)

    def test_both_locked_resolves_and_opens_a_shared_turn(self):
        first = reduce(make_match(), cmd(0, "bid", {"amount": 9}))
        out = reduce(make_match(snapshot=first.snapshot), cmd(1, "bid", {"amount": 3}))
        assert out.accepted and out.resolve_turn == "action"
        assert out.open_turn is not None
        # seat_index=None means every seat is live on one shared deadline --
        # `project_seat_view` gives them all the same `seconds_remaining`.
        assert out.open_turn.seat_index is None
        assert out.open_turn.deadline_at > NOW

    def test_the_higher_bid_wins_and_pays_its_own_bid(self):
        first = reduce(make_match(), cmd(0, "bid", {"amount": 9}))
        out = reduce(make_match(snapshot=first.snapshot), cmd(1, "bid", {"amount": 3}))
        record = next(e for e in out.events if e.event_type == "round_resolved").payload
        assert record["winner_seat"] == 0
        assert record["price"] == 9

    def test_a_pass_is_exactly_a_zero_bid(self):
        """One code path: two could disagree about what passing means."""
        via_pass = reduce(make_match(), cmd(0, "pass"))
        via_zero = reduce(make_match(), cmd(0, "bid", {"amount": 0}))
        assert via_pass.snapshot["seats"][0] == via_zero.snapshot["seats"][0]

    @pytest.mark.parametrize(
        "payload,expected",
        [({"amount": 20}, "bid_over_max"), ({"amount": -1}, "bid_negative")],
    )
    def test_illegal_bids_are_rejected(self, payload, expected):
        out = reduce(make_match(), cmd(0, "bid", payload))
        assert not out.accepted and out.rejection_code == expected

    def test_a_rejection_writes_nothing(self):
        """A rejected command must not advance the state version or invalidate
        the other client's cached view."""
        out = reduce(make_match(), cmd(0, "bid", {"amount": 20}))
        assert out.snapshot is None
        assert out.events == ()
        assert out.open_turn is None and out.resolve_turn is None

    def test_an_unknown_command_is_rejected(self):
        out = reduce(make_match(), cmd(0, "wiggle"))
        assert not out.accepted and out.rejection_code == "unknown_command"

    def test_a_seatless_command_is_rejected(self):
        out = reduce(
            make_match(),
            CommandRequest(
                match_id="m1", idempotency_key="k", command_type="bid",
                payload={"amount": 1}, actor_sub="stranger", actor_seat_index=None,
                expected_state_version=0, issued_at=NOW,
            ),
        )
        assert not out.accepted and out.rejection_code == "not_your_seat"


class TestTimeout:
    def test_a_double_timeout_sells_nothing_and_advances(self):
        out = td_mode.reduce(
            ReducerInput(match=make_match(), seats=SEATS, open_turn=None,
                         command=TIMEOUT_CMD, now=NOW)
        )
        assert out.accepted and out.resolve_turn == "timeout"
        assert out.snapshot["history"][0]["winner_seat"] is None
        assert out.open_turn is not None

    @pytest.mark.parametrize("locked_seat", [0, 1])
    def test_the_deadline_with_one_seat_locked_settles_in_both_orders(self, locked_seat):
        """The interaction most likely to hide a bug.

        The absent seat must resolve as a $0 pass, the round must settle rather
        than stall, and the locked bidder must pay what they actually bid --
        not receive a discount for the opponent's silence.
        """
        first = reduce(make_match(), cmd(locked_seat, "bid", {"amount": 6}))
        out = td_mode.reduce(
            ReducerInput(match=make_match(snapshot=first.snapshot), seats=SEATS,
                         open_turn=None, command=TIMEOUT_CMD, now=NOW)
        )
        assert out.accepted and out.resolve_turn == "timeout"

        record = out.snapshot["history"][0]
        absent = 1 - locked_seat
        assert record["winner_seat"] == locked_seat
        assert record["price"] == 6, "no discount for the opponent's silence"
        assert record["bids"][absent] == 0
        assert record["timed_out"][absent] is True
        assert record["timed_out"][locked_seat] is False
        # A missed deadline is a pass, never a forfeit.
        assert out.snapshot["seats"][absent]["budget"] == 20
        assert out.snapshot["seats"][absent]["roster"] == []


class TestProjectionDoesNotLeak:
    @pytest.fixture()
    def half_locked(self):
        out = reduce(make_match(), cmd(0, "bid", {"amount": 13}))
        return make_match(snapshot=out.snapshot)

    def test_the_opponents_sealed_bid_is_absent_everywhere(self, half_locked):
        public, private, _ = td_mode.project(half_locked, SEATS, 1)
        assert 13 not in all_values(public)
        assert 13 not in all_values(private)

    def test_your_own_bid_is_visible_to_you(self, half_locked):
        _, private, _ = td_mode.project(half_locked, SEATS, 0)
        assert private["your_bid"] == 13

    def test_lock_status_is_public_but_the_amount_is_not(self, half_locked):
        public, _, _ = td_mode.project(half_locked, SEATS, 1)
        opponent = public["seats"][0]
        assert opponent["locked"] is True
        assert "bid" not in opponent

    def test_the_candidates_score_is_hidden_before_the_round_resolves(self):
        match = make_match()
        from nba_peak.twenty_dollar.pool import get_pool

        card = get_pool().get(match.snapshot["current_candidate"])
        public, private, _ = td_mode.project(match, SEATS, 0)
        assert "prime_score" not in public["candidate"]
        assert card.prime_score not in all_values(public)
        assert card.prime_score not in all_values(private)

    def test_the_seat_view_the_foundation_builds_carries_no_leak(self, half_locked):
        """`SeatView` is what a bot receives; the guarantee has to hold there."""
        public, private, commands = td_mode.project(half_locked, SEATS, 1)
        view = project_seat_view(half_locked, SEATS[1], public, private, commands, None, NOW)
        assert 13 not in all_values(view.public_state) + all_values(view.private_state)

    def test_seat_names_come_from_the_foundation(self, half_locked):
        public, _, _ = td_mode.project(half_locked, SEATS, 0)
        assert public["seat_names"] == ["Alice", "Bob"]


class TestBot:
    def test_the_bot_returns_a_legal_command_from_a_seat_view_alone(self):
        match = make_match()
        public, private, commands = td_mode.project(match, SEATS, 0)
        view = project_seat_view(match, SEATS[0], public, private, commands, None, NOW)
        command = asyncio.run(td_bot.choose(view, random.Random(1)))
        assert command.command_type in view.legal_commands
        if command.command_type == "bid":
            assert 0 <= command.payload["amount"] <= private["max_bid"]

    def test_the_bot_passes_when_it_has_no_legal_move(self):
        match = make_match()
        view = project_seat_view(match, SEATS[0], {}, {}, (), None, NOW)
        command = asyncio.run(td_bot.choose(view, random.Random(1)))
        assert command.command_type == "pass"


class TestFullMatch:
    def test_a_match_played_through_the_reducer_completes_and_settles(self):
        match = make_match(seed=777)
        final = None
        for _ in range(400):
            if match.status == MATCH_STATUS_COMPLETED:
                break
            acted = False
            for seat in (0, 1):
                _, private, legal = td_mode.project(match, SEATS, seat)
                if not legal:
                    continue
                amount = min(private["max_bid"], 4) if private["can_acquire_candidate"] else 0
                out = reduce(match, cmd(seat, "bid" if amount else "pass", {"amount": amount}))
                assert out.accepted, out.rejection_code
                match = make_match(snapshot=out.snapshot, seed=777)
                acted = True
                if out.status == MATCH_STATUS_COMPLETED:
                    match.status, final = MATCH_STATUS_COMPLETED, out
                    break
            if not acted:
                out = td_mode.reduce(
                    ReducerInput(match=match, seats=SEATS, open_turn=None,
                                 command=TIMEOUT_CMD, now=NOW)
                )
                match = make_match(snapshot=out.snapshot, seed=777)
                if out.status == MATCH_STATUS_COMPLETED:
                    match.status, final = MATCH_STATUS_COMPLETED, out

        assert final is not None, "the match never completed"
        assert len(final.results) == 2
        assert sorted(r.placement for r in final.results) in ([1, 2], [1, 1])
        assert all(r.score > 0 for r in final.results)
        assert all(r.detail["model_version"] == "peak3_v1" for r in final.results)
        assert final.open_turn is None

    def test_the_completion_event_carries_the_receipt_and_states_five_components(self):
        match = make_match(seed=777)
        final = None
        for _ in range(400):
            out = td_mode.reduce(
                ReducerInput(match=match, seats=SEATS, open_turn=None,
                             command=TIMEOUT_CMD, now=NOW)
            )
            match = make_match(snapshot=out.snapshot, seed=777)
            if out.status == MATCH_STATUS_COMPLETED:
                final = out
                break
        assert final is not None
        completed = [e for e in final.events if e.event_type == "match_completed"]
        assert len(completed) == 1
        assert completed[0].visibility == VISIBILITY_PUBLIC
        disclosure = completed[0].payload["receipt"]["component_disclosure"]
        assert disclosure["count"] == 5 and disclosure["house_count"] == 6
        assert disclosure["absent"] == ["teammate_adjustment"]
