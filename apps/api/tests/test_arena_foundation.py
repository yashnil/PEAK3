"""Arena foundation: state machine, idempotency, versioning, clock, bots.

Runs against the in-memory backend, which is the backend the whole unit suite
uses (`scripts/ci/api-unit-tests.sh:22`). The Postgres half of every guarantee
asserted here is covered by `test_arena_conformance.py`, which runs the SAME
assertions against a real database and is marked `supabase_integration`.

A NOTE ON WHAT A SINGLE-PROCESS TEST CAN AND CANNOT PROVE. The tests below that
launch two coroutines with `asyncio.gather` exercise interleaving on one event
loop under one `asyncio.Lock`. That is a real test of the memory backend's
serialization and of the idempotency logic, and it is NOT a test of PostgreSQL
row locking -- two asyncio tasks in one process are not two database sessions.
The genuine two-connection race is
`test_arena_conformance.py::test_concurrent_commands_on_one_match_serialize`,
which opens two asyncpg connections and is skipped without a database. Stated
here so a green run of this file is not mistaken for evidence about Postgres.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.repositories.arena_memory import MemoryArenaRepository
from app.repositories.arena_protocols import (
    COMMAND_TYPE_TIMEOUT,
    MATCH_STATUS_ACTIVE,
    MATCH_STATUS_COMPLETED,
    MATCH_STATUS_EXPIRED,
    MATCH_STATUS_FORMING,
    REJECT_MATCH_EXPIRED,
    REJECT_MATCH_NOT_LIVE,
    REJECT_STALE_STATE_VERSION,
    TURN_RESOLUTION_ACTION,
    TURN_RESOLUTION_TIMEOUT,
    VISIBILITY_PUBLIC,
    VISIBILITY_SEAT,
    VISIBILITY_SERVER,
    ArenaMatch,
    ArenaSeat,
    CommandRequest,
    EventDraft,
    ReducerInput,
    ReducerOutput,
    ResultDraft,
    SeatUnavailable,
    TurnDraft,
    project_seat_view,
    validate_client_command,
)
from app.services.arena import clock

NOW = datetime(2026, 8, 4, 12, 0, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Fixtures -- a deliberately trivial two-seat "mode" with one hidden field
# ---------------------------------------------------------------------------


def _match(
    seat_count: int = 2,
    entry_path: str = "public_queue",
    status: str = MATCH_STATUS_ACTIVE,
    expires_in: timedelta = timedelta(hours=2),
) -> ArenaMatch:
    return ArenaMatch(
        match_id=str(uuid.uuid4()),
        mode="test_mode",
        mode_version="test_v1",
        model_version="peak3_v1",
        seat_count=seat_count,
        entry_path=entry_path,
        rated=(entry_path == "public_queue"),
        seed=4242,
        created_by="user-a",
        expires_at=NOW + expires_in,
        status=status,
        created_at=NOW,
        updated_at=NOW,
        snapshot={"plays": [], "secret": {}},
    )


def _seats(match_id: str, count: int = 2) -> list[ArenaSeat]:
    return [
        ArenaSeat(
            match_id=match_id,
            seat_index=i,
            occupant_kind="human",
            occupant_sub=f"user-{chr(ord('a') + i)}",
            display_name=f"Player {i}",
        )
        for i in range(count)
    ]


def counting_reducer(data: ReducerInput) -> ReducerOutput:
    """Accepts `play`, appends to a list, opens the next turn. Records a
    seat-private value so visibility filtering has something to hide."""
    if data.command.command_type == "illegal":
        return ReducerOutput(
            accepted=False, rejection_code="illegal_move",
            rejection_message="No.",
        )
    snapshot = {
        "plays": list(data.match.snapshot.get("plays", []))
        + [data.command.command_type],
        "secret": dict(data.match.snapshot.get("secret", {})),
    }
    seat = data.command.actor_seat_index
    if seat is not None:
        snapshot["secret"][str(seat)] = f"seat-{seat}-secret"
    return ReducerOutput(
        accepted=True,
        snapshot=snapshot,
        events=(
            EventDraft(event_type="played", actor_seat_index=seat, payload={"n": 1}),
            EventDraft(
                event_type="sealed", actor_seat_index=seat,
                visibility=VISIBILITY_SEAT, visible_to_seat=seat or 0,
                payload={"hidden": "bid"},
            ),
        ),
        resolve_turn=TURN_RESOLUTION_ACTION,
        open_turn=TurnDraft(
            phase="play", deadline_at=data.now + timedelta(seconds=30), seat_index=0
        ),
    )


def timeout_reducer(data: ReducerInput) -> ReducerOutput:
    return ReducerOutput(
        accepted=True,
        snapshot={**data.match.snapshot, "timed_out": True},
        events=(EventDraft(event_type="turn_timeout"),),
        resolve_turn=TURN_RESOLUTION_TIMEOUT,
        status=MATCH_STATUS_COMPLETED,
        results=(
            ResultDraft(seat_index=0, placement=1, score=1.0, outcome="win"),
            ResultDraft(seat_index=1, placement=2, score=0.0, outcome="loss"),
        ),
    )


async def _live_match(repo: MemoryArenaRepository, seat_count: int = 2):
    m = _match(seat_count=seat_count)
    await repo.create_match(m, _seats(m.match_id, seat_count))
    # Open a turn so the clock has something to enforce.
    await repo.apply_command(
        CommandRequest(
            match_id=m.match_id, idempotency_key="open-0001",
            command_type="__open__", actor_sub=None, issued_at=NOW,
        ),
        lambda d: ReducerOutput(
            accepted=True,
            open_turn=TurnDraft(
                phase="play", deadline_at=NOW + timedelta(seconds=30), seat_index=0
            ),
        ),
        NOW,
    )
    return await repo.get_match(m.match_id)


def _cmd(match_id: str, key: str, **kw) -> CommandRequest:
    """Build a CommandRequest from a short, readable test label.

    `key` is a LABEL ("k-1", "t"), not a realistic idempotency key. The schema
    requires 8..128 characters (`arena_match_commands_idempotency_key_check`)
    and both backends now enforce it, so the label is padded into a valid key
    here rather than lengthened at ~40 call sites where it would only make the
    tests harder to read.

    The padding is deterministic and label-derived, so two different labels
    still produce two different keys and an idempotent REPLAY of the same label
    still produces the same key -- which is the property every test using this
    helper is actually asserting.
    """
    return CommandRequest(
        match_id=match_id,
        idempotency_key=f"{key}-testkey-{len(key):02d}" if len(key) < 8 else key,
        command_type=kw.pop("command_type", "play"),
        actor_sub=kw.pop("actor_sub", "user-a"),
        actor_seat_index=kw.pop("actor_seat_index", 0),
        issued_at=kw.pop("issued_at", NOW),
        **kw,
    )


# ---------------------------------------------------------------------------
# Seats -- the N-seat generalization
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_three_seats_are_expressible():
    """The whole reason this domain exists rather than reusing head-to-head,
    whose UNIQUE (match_id, role) over a two-value CHECK caps arity at two."""
    repo = MemoryArenaRepository()
    m = _match(seat_count=3)
    await repo.create_match(m, _seats(m.match_id, 3))
    assert [s.seat_index for s in await repo.get_seats(m.match_id)] == [0, 1, 2]


@pytest.mark.asyncio
async def test_a_subject_cannot_hold_two_seats():
    repo = MemoryArenaRepository()
    m = _match(seat_count=3)
    await repo.create_match(m, _seats(m.match_id, 2))
    with pytest.raises(SeatUnavailable):
        await repo.add_seat(
            ArenaSeat(
                match_id=m.match_id, seat_index=2,
                occupant_kind="human", occupant_sub="user-a",
            )
        )


@pytest.mark.asyncio
async def test_a_match_cannot_exceed_its_seat_count():
    repo = MemoryArenaRepository()
    m = _match(seat_count=2)
    await repo.create_match(m, _seats(m.match_id, 2))
    with pytest.raises(SeatUnavailable):
        await repo.add_seat(
            ArenaSeat(
                match_id=m.match_id, seat_index=2,
                occupant_kind="human", occupant_sub="user-z",
            )
        )


# ---------------------------------------------------------------------------
# Optimistic concurrency
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_state_version_advances_by_exactly_one_per_accepted_command():
    repo = MemoryArenaRepository()
    m = await _live_match(repo)
    before = m.state_version
    out = await repo.apply_command(
        _cmd(m.match_id, "k-0001", expected_state_version=before),
        counting_reducer, NOW,
    )
    assert out.accepted and out.match.state_version == before + 1


@pytest.mark.asyncio
async def test_a_stale_expected_version_is_rejected():
    repo = MemoryArenaRepository()
    m = await _live_match(repo)
    await repo.apply_command(
        _cmd(m.match_id, "k-0001", expected_state_version=m.state_version),
        counting_reducer, NOW,
    )
    out = await repo.apply_command(
        _cmd(m.match_id, "k-0002", expected_state_version=m.state_version),
        counting_reducer, NOW,
    )
    assert not out.accepted
    assert out.rejection_code == REJECT_STALE_STATE_VERSION


@pytest.mark.asyncio
async def test_a_rejected_command_does_not_consume_a_state_version():
    """A rejection must not invalidate every other client's cached version --
    the reason `arena_match_commands_version_monotonic` permits equality."""
    repo = MemoryArenaRepository()
    m = await _live_match(repo)
    before = m.state_version
    out = await repo.apply_command(
        _cmd(m.match_id, "k-0001", command_type="illegal"), counting_reducer, NOW
    )
    assert not out.accepted
    assert (await repo.get_match(m.match_id)).state_version == before


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_replayed_key_applies_nothing_and_reports_replayed():
    repo = MemoryArenaRepository()
    m = await _live_match(repo)
    first = await repo.apply_command(_cmd(m.match_id, "k-0001"), counting_reducer, NOW)
    version_after_first = (await repo.get_match(m.match_id)).state_version
    second = await repo.apply_command(_cmd(m.match_id, "k-0001"), counting_reducer, NOW)

    assert first.accepted and not first.replayed
    assert second.accepted and second.replayed
    assert (await repo.get_match(m.match_id)).state_version == version_after_first
    # The replay returns the ORIGINAL events, not an empty list -- a client
    # cannot otherwise distinguish a replay from "accepted but did nothing".
    assert [e.event_type for e in second.events] == [e.event_type for e in first.events]


@pytest.mark.asyncio
async def test_a_rejection_is_idempotent_too():
    """A client retrying a network timeout on an illegal move must get the same
    answer, or it cannot tell whether its first attempt landed."""
    repo = MemoryArenaRepository()
    m = await _live_match(repo)
    first = await repo.apply_command(
        _cmd(m.match_id, "k-0001", command_type="illegal"), counting_reducer, NOW
    )
    second = await repo.apply_command(
        _cmd(m.match_id, "k-0001", command_type="illegal"), counting_reducer, NOW
    )
    assert first.rejection_code == second.rejection_code == "illegal_move"
    assert second.replayed


@pytest.mark.asyncio
async def test_two_concurrent_identical_keys_apply_once():
    repo = MemoryArenaRepository()
    m = await _live_match(repo)
    a, b = await asyncio.gather(
        repo.apply_command(_cmd(m.match_id, "k-0001"), counting_reducer, NOW),
        repo.apply_command(_cmd(m.match_id, "k-0001"), counting_reducer, NOW),
    )
    assert sorted([a.replayed, b.replayed]) == [False, True]
    assert (await repo.get_match(m.match_id)).state_version == m.state_version + 1


@pytest.mark.asyncio
async def test_two_concurrent_distinct_keys_both_apply_and_serialize():
    repo = MemoryArenaRepository()
    m = await _live_match(repo)
    a, b = await asyncio.gather(
        repo.apply_command(_cmd(m.match_id, "k-0001"), counting_reducer, NOW),
        repo.apply_command(_cmd(m.match_id, "k-0002"), counting_reducer, NOW),
    )
    assert a.accepted and b.accepted
    assert (await repo.get_match(m.match_id)).state_version == m.state_version + 2
    # Event sequence numbers are dense and unique -- no two commands claimed
    # the same seq.
    events = await repo.list_events(m.match_id, for_seat=None)
    seqs = [e.seq for e in events]
    assert seqs == sorted(seqs) == list(range(len(seqs)))


# ---------------------------------------------------------------------------
# Liveness and the clock
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_command_against_a_finished_match_is_rejected():
    repo = MemoryArenaRepository()
    m = await _live_match(repo)
    await repo.expire_match(m.match_id, NOW)
    out = await repo.apply_command(_cmd(m.match_id, "k-0001"), counting_reducer, NOW)
    assert out.rejection_code == REJECT_MATCH_NOT_LIVE


@pytest.mark.asyncio
async def test_a_command_past_the_match_clock_is_rejected():
    repo = MemoryArenaRepository()
    m = await _live_match(repo)
    out = await repo.apply_command(
        _cmd(m.match_id, "k-0001"), counting_reducer, NOW + timedelta(hours=3)
    )
    assert out.rejection_code == REJECT_MATCH_EXPIRED


@pytest.mark.asyncio
async def test_the_match_clock_actually_fires():
    """The defect this whole module exists not to repeat: ranked stores a
    deadline and never compares it, so no ranked match has ever expired."""
    repo = MemoryArenaRepository()
    m = await _live_match(repo)
    await clock.enforce(repo, m.match_id, counting_reducer, NOW + timedelta(hours=3))
    assert (await repo.get_match(m.match_id)).status == MATCH_STATUS_EXPIRED


@pytest.mark.asyncio
async def test_the_turn_clock_actually_fires():
    repo = MemoryArenaRepository()
    m = await _live_match(repo)
    out = await clock.enforce(
        repo, m.match_id, timeout_reducer, NOW + timedelta(seconds=31)
    )
    assert out is not None and out.accepted
    turn = (await repo.get_open_turn(m.match_id))
    assert turn is None  # resolved
    assert (await repo.get_match(m.match_id)).status == MATCH_STATUS_COMPLETED


@pytest.mark.asyncio
async def test_the_clock_does_not_fire_early():
    repo = MemoryArenaRepository()
    m = await _live_match(repo)
    assert await clock.enforce(
        repo, m.match_id, timeout_reducer, NOW + timedelta(seconds=29)
    ) is None
    assert (await repo.get_match(m.match_id)).status == MATCH_STATUS_ACTIVE


@pytest.mark.asyncio
async def test_an_action_that_beat_the_timeout_is_not_undone_by_it():
    """THE RACE. The player played at T+29; the sweep runs at T+31 and must not
    forfeit the turn the player already legitimately resolved."""
    repo = MemoryArenaRepository()
    m = await _live_match(repo)
    played = await repo.apply_command(
        _cmd(m.match_id, "k-0001", issued_at=NOW + timedelta(seconds=29)),
        counting_reducer, NOW + timedelta(seconds=29),
    )
    assert played.accepted

    # The sweep now fires for the ORIGINAL turn, which the play already closed.
    out = await clock.enforce(
        repo, m.match_id, timeout_reducer, NOW + timedelta(seconds=31)
    )
    # A new turn was opened by the play, and it is not yet overdue, so nothing
    # fires at all. The match is still active and still has the player's move.
    match = await repo.get_match(m.match_id)
    assert match.status == MATCH_STATUS_ACTIVE
    assert match.snapshot["plays"] == ["play"]
    assert "timed_out" not in match.snapshot


@pytest.mark.asyncio
async def test_a_stale_timeout_for_a_resolved_turn_is_refused():
    """`guard_timeout` directly: a timeout naming turn 0 must be refused once
    turn 0 has been resolved, even though the match is live and the command is
    otherwise well-formed."""
    repo = MemoryArenaRepository()
    m = await _live_match(repo)
    await repo.apply_command(_cmd(m.match_id, "k-0001"), counting_reducer, NOW)

    guarded = clock.guard_timeout(timeout_reducer, turn_seq=0)
    out = await repo.apply_command(
        CommandRequest(
            match_id=m.match_id,
            idempotency_key=clock.timeout_idempotency_key(m.match_id, 0),
            command_type=COMMAND_TYPE_TIMEOUT, actor_sub=None,
            issued_at=NOW + timedelta(seconds=31),
        ),
        guarded, NOW + timedelta(seconds=31),
    )
    assert not out.accepted
    assert out.rejection_code == clock.REJECT_TURN_ALREADY_RESOLVED


@pytest.mark.asyncio
async def test_two_concurrent_sweeps_fire_one_timeout():
    """Two sweeps, one forfeit.

    The loser may lose in either of two places, and the test accepts both
    because which one it hits is a scheduling detail rather than a guarantee:

      * it re-reads the match AFTER the winner committed, finds no open turn,
        and returns None without issuing a command at all; or
      * it issues the command and the deterministic idempotency key makes it a
        replay at the storage layer.

    What IS guaranteed, and what this asserts, is that exactly one timeout was
    applied: the version advanced by one, and one `turn_timeout` event exists.
    """
    repo = MemoryArenaRepository()
    m = await _live_match(repo)
    late = NOW + timedelta(seconds=31)
    a, b = await asyncio.gather(
        clock.enforce(repo, m.match_id, timeout_reducer, late),
        clock.enforce(repo, m.match_id, timeout_reducer, late),
    )
    applied = [o for o in (a, b) if o is not None and o.accepted and not o.replayed]
    assert len(applied) == 1, "exactly one sweep may forfeit the turn"
    assert (await repo.get_match(m.match_id)).state_version == m.state_version + 1
    events = await repo.list_events(m.match_id, for_seat=None)
    assert sum(e.event_type == "turn_timeout" for e in events) == 1


@pytest.mark.asyncio
async def test_resolve_overdue_turn_has_exactly_one_winner():
    repo = MemoryArenaRepository()
    m = await _live_match(repo)
    late = NOW + timedelta(seconds=31)
    results = await asyncio.gather(
        repo.resolve_overdue_turn(m.match_id, 0, late, TURN_RESOLUTION_TIMEOUT),
        repo.resolve_overdue_turn(m.match_id, 0, late, TURN_RESOLUTION_TIMEOUT),
        repo.resolve_overdue_turn(m.match_id, 0, late, TURN_RESOLUTION_TIMEOUT),
    )
    assert sorted(results) == [False, False, True]


@pytest.mark.asyncio
async def test_expire_match_has_exactly_one_winner():
    repo = MemoryArenaRepository()
    m = await _live_match(repo)
    results = await asyncio.gather(
        repo.expire_match(m.match_id, NOW),
        repo.expire_match(m.match_id, NOW),
    )
    assert sorted(results) == [False, True]


# ---------------------------------------------------------------------------
# Hidden information
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_seat_visible_events_are_filtered_per_seat():
    repo = MemoryArenaRepository()
    m = await _live_match(repo)
    await repo.apply_command(
        _cmd(m.match_id, "k-0001", actor_seat_index=0), counting_reducer, NOW
    )
    seat0 = await repo.list_events(m.match_id, for_seat=0)
    seat1 = await repo.list_events(m.match_id, for_seat=1)

    assert any(e.event_type == "sealed" for e in seat0)
    assert not any(e.event_type == "sealed" for e in seat1)
    # The public event reaches both.
    assert any(e.event_type == "played" for e in seat1)


@pytest.mark.asyncio
async def test_server_visibility_events_reach_no_seat():
    repo = MemoryArenaRepository()
    m = await _live_match(repo)

    def audit_reducer(data):
        return ReducerOutput(
            accepted=True,
            snapshot=data.match.snapshot,
            events=(
                EventDraft(event_type="audit", visibility=VISIBILITY_SERVER,
                           payload={"seed_consumed": 7}),
            ),
        )

    await repo.apply_command(_cmd(m.match_id, "k-0001"), audit_reducer, NOW)
    for seat in (0, 1):
        assert not any(
            e.event_type == "audit"
            for e in await repo.list_events(m.match_id, for_seat=seat)
        )
    # The server view still has it -- it exists for audit.
    assert any(
        e.event_type == "audit"
        for e in await repo.list_events(m.match_id, for_seat=None)
    )


def test_seat_view_carries_no_path_to_authoritative_state():
    """The structural half of the anti-cheat guarantee: a `SeatView` has no
    field holding the match, the snapshot, the other seats, or a repository."""
    m = _match()
    seat = _seats(m.match_id)[0]
    view = project_seat_view(
        match=m, seat=seat, public_state={"visible": 1},
        private_state={"mine": 2}, legal_commands=("play",),
        open_turn=None, now=NOW,
    )
    fields = set(view.__dataclass_fields__)
    for forbidden in ("match", "snapshot", "seats", "repo", "repository", "conn"):
        assert forbidden not in fields
    # And the copies are deep -- mutating the view cannot reach stored state.
    view.public_state["visible"] = 999
    assert m.snapshot.get("visible") is None


def test_seat_view_deep_copies_its_inputs():
    m = _match()
    seat = _seats(m.match_id)[0]
    public = {"nested": {"v": 1}}
    view = project_seat_view(
        match=m, seat=seat, public_state=public, private_state={},
        legal_commands=(), open_turn=None, now=NOW,
    )
    view.public_state["nested"]["v"] = 999
    assert public["nested"]["v"] == 1


def test_a_client_cannot_issue_a_server_command():
    """Without this, a client could POST `__timeout__` against an opponent's
    turn and forfeit it on demand."""
    with pytest.raises(ValueError):
        validate_client_command(COMMAND_TYPE_TIMEOUT)
    validate_client_command("play")  # ordinary commands are fine


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_results_are_written_once_and_carry_the_rated_flag():
    repo = MemoryArenaRepository()
    m = await _live_match(repo)
    await clock.enforce(repo, m.match_id, timeout_reducer, NOW + timedelta(seconds=31))
    results = await repo.get_results(m.match_id)
    assert [r.placement for r in results] == [1, 2]
    assert all(r.rated for r in results)  # public_queue -> rated
    assert all(not r.was_bot for r in results)


@pytest.mark.asyncio
async def test_a_second_completion_cannot_rewrite_a_settled_result():
    repo = MemoryArenaRepository()
    m = await _live_match(repo)
    await clock.enforce(repo, m.match_id, timeout_reducer, NOW + timedelta(seconds=31))
    before = await repo.get_results(m.match_id)

    # Force another completion attempt with inverted placements.
    def inverted(data):
        return ReducerOutput(
            accepted=True, snapshot=data.match.snapshot,
            status=MATCH_STATUS_COMPLETED,
            results=(
                ResultDraft(seat_index=0, placement=2, score=0.0, outcome="loss"),
                ResultDraft(seat_index=1, placement=1, score=1.0, outcome="win"),
            ),
        )

    await repo.apply_command(_cmd(m.match_id, "k-9999"), inverted, NOW)
    assert [(r.seat_index, r.placement) for r in await repo.get_results(m.match_id)] == [
        (r.seat_index, r.placement) for r in before
    ]
