"""Repository protocol conformance suite (Phase 4.0A section G).

Runs the same behavior assertions against every repository's in-memory
implementation AND its real PostgreSQL implementation, so a protocol
guarantee (idempotency, uniqueness, transfer semantics) can never silently
hold for one backend and not the other.

The Postgres half requires a real local Supabase/Postgres instance
(PEAK3_TEST_DATABASE_URL — see supabase/migrations and `supabase start`).
Each Postgres test is marked `supabase_integration` (same marker as
tests/integration/) so the "FastAPI tests (0 skipped)" CI job — which runs
without a database — deselects them entirely with `-m "not supabase_integration"`
rather than reporting them as skipped. The dedicated Supabase-integration CI
job runs them for real (alongside tests/integration/) whenever test-project
secrets are configured. The memory half carries no marker and always runs in
every job. This mirrors tests/integration/conftest.py's "never silently
report as passing" discipline.
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import pytest_asyncio

_repo_root = Path(__file__).resolve().parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from app.core.config import settings
from app.repositories.memory import (
    MemoryChallengeRepository,
    MemoryDailyCompletionRepository,
    MemoryGameRepository,
    MemoryResultSnapshotRepository,
)
from app.repositories.memory_profile import MemoryProfileRepository
from app.repositories.profile_protocols import HandleTakenError
from app.repositories.protocols import ChallengeRecord, DailyCompletion, ResultSnapshot
from app.services.draft import state as state_machine

TEST_DATABASE_URL = os.environ.get("PEAK3_TEST_DATABASE_URL")

try:
    import asyncpg
except ImportError:
    asyncpg = None  # type: ignore[assignment]


def _pg_available() -> bool:
    return bool(TEST_DATABASE_URL) and asyncpg is not None


PG_SKIP_REASON = (
    "PEAK3_TEST_DATABASE_URL not set — Postgres half of the conformance "
    "suite skipped (expected outside a local Supabase / CI run with a real "
    "test database configured; the in-memory half above still ran for real)."
)


@pytest_asyncio.fixture
async def pg_pool():
    if not _pg_available():
        pytest.skip(PG_SKIP_REASON)
    pool = await asyncpg.create_pool(TEST_DATABASE_URL)
    yield pool
    await pool.close()


def _new_game_state():
    return state_machine.create_draft_game(
        mode="apex_1y", board_type="practice", date=None, seed=42,
        signing_secret=settings.SIGNING_SECRET,
    )


# ---------------------------------------------------------------------------
# GameRepository — same behavior on memory and Postgres
# ---------------------------------------------------------------------------

async def _assert_game_repo_conforms(repo) -> None:
    owner = f"user-{uuid.uuid4()}"
    state = _new_game_state()
    state.owner_sub = owner
    game_id = await repo.create_game(state)
    assert game_id

    fetched = await repo.get_game(game_id)
    assert fetched is not None
    assert fetched.owner_sub == owner
    assert fetched.mode == "apex_1y"

    fetched.status = "draft_complete"
    await repo.save_game(fetched)
    refetched = await repo.get_game(game_id)
    assert refetched.status == "draft_complete"
    assert refetched.owner_sub == owner, "save_game must not drop owner_sub"

    new_owner = f"user-{uuid.uuid4()}"
    count = await repo.transfer_owner(owner, new_owner)
    assert count == 1
    transferred = await repo.get_game(game_id)
    assert transferred.owner_sub == new_owner

    assert await repo.get_game(str(uuid.uuid4())) is None


@pytest.mark.asyncio
async def test_memory_game_repo_conforms():
    await _assert_game_repo_conforms(MemoryGameRepository())


@pytest.mark.asyncio
@pytest.mark.supabase_integration
async def test_postgres_game_repo_conforms(pg_pool):
    from app.repositories.postgres import PostgresGameRepository
    await _assert_game_repo_conforms(PostgresGameRepository(pg_pool))


# ---------------------------------------------------------------------------
# ChallengeRepository
# ---------------------------------------------------------------------------

async def _assert_challenge_repo_conforms(repo) -> None:
    from datetime import timedelta

    owner = f"user-{uuid.uuid4()}"
    token_hash = uuid.uuid4().hex[:32]
    now = datetime.now(timezone.utc)
    record = ChallengeRecord(
        token_hash=token_hash,
        challenger_game_id=str(uuid.uuid4()),
        board_id="practice-apex_1y-42",
        mode="apex_1y",
        board_type="practice",
        duration_years=1,
        seed=42,
        date=None,
        created_at=now,
        expires_at=now + timedelta(days=7),
        challenger_snapshot={"selected_cards": [], "lineup_evaluation": None},
        anon_subject_id=owner,
    )
    await repo.store_challenge(record)
    # store_challenge is ON CONFLICT DO NOTHING — must not raise on retry
    await repo.store_challenge(record)

    fetched = await repo.get_challenge(token_hash)
    assert fetched is not None
    assert fetched.anon_subject_id == owner
    assert fetched.settlement is None

    ok = await repo.save_settlement(token_hash, {"outcome": "draw"})
    assert ok is True
    second = await repo.save_settlement(token_hash, {"outcome": "challenger_wins"})
    assert second is False, "settlement must be write-once"

    fetched2 = await repo.get_challenge(token_hash)
    assert fetched2.settlement == {"outcome": "draw"}

    new_owner = f"user-{uuid.uuid4()}"
    count = await repo.transfer_owner(owner, new_owner)
    assert count == 1


@pytest.mark.asyncio
async def test_memory_challenge_repo_conforms():
    await _assert_challenge_repo_conforms(MemoryChallengeRepository())


@pytest.mark.asyncio
@pytest.mark.supabase_integration
async def test_postgres_challenge_repo_conforms(pg_pool):
    from app.repositories.postgres import PostgresChallengeRepository
    await _assert_challenge_repo_conforms(PostgresChallengeRepository(pg_pool))


# ---------------------------------------------------------------------------
# DailyCompletionRepository — first-completion-wins semantics
# ---------------------------------------------------------------------------

async def _assert_daily_completion_repo_conforms(repo) -> None:
    owner = f"user-{uuid.uuid4()}"
    board_id = f"daily-apex_1y-{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc)

    first = DailyCompletion(
        id=str(uuid.uuid4()), owner_sub=owner, board_id=board_id, mode="apex_1y",
        date="2026-06-30", game_id=str(uuid.uuid4()), lineup_peak_rating=70.0,
        draft_efficiency=0.7, board_percentile=30.0, hold_used=False, reframe_used=False,
        completed_at=now, result_snapshot={},
    )
    await repo.record_completion(first)

    duplicate = DailyCompletion(
        id=str(uuid.uuid4()), owner_sub=owner, board_id=board_id, mode="apex_1y",
        date="2026-06-30", game_id=str(uuid.uuid4()), lineup_peak_rating=99.0,
        draft_efficiency=0.99, board_percentile=1.0, hold_used=True, reframe_used=True,
        completed_at=now, result_snapshot={},
    )
    await repo.record_completion(duplicate)

    stored = await repo.get_completion(owner, board_id)
    assert stored.id == first.id, "first completion must win, not be overwritten"

    completions = await repo.list_completions(owner, limit=50)
    assert len([c for c in completions if c.board_id == board_id]) == 1

    other_owner = f"user-{uuid.uuid4()}"
    count = await repo.transfer_owner(owner, other_owner)
    assert count == 1
    assert await repo.get_completion(other_owner, board_id) is not None
    assert await repo.get_completion(owner, board_id) is None


@pytest.mark.asyncio
async def test_memory_daily_completion_repo_conforms():
    await _assert_daily_completion_repo_conforms(MemoryDailyCompletionRepository())


@pytest.mark.asyncio
@pytest.mark.supabase_integration
async def test_postgres_daily_completion_repo_conforms(pg_pool):
    from app.repositories.postgres import PostgresDailyCompletionRepository
    await _assert_daily_completion_repo_conforms(PostgresDailyCompletionRepository(pg_pool))


# ---------------------------------------------------------------------------
# ResultSnapshotRepository — append-only
# ---------------------------------------------------------------------------

async def _assert_result_snapshot_repo_conforms(repo) -> None:
    owner = f"user-{uuid.uuid4()}"
    result_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    result = ResultSnapshot(
        id=result_id, owner_sub=owner, game_id=str(uuid.uuid4()), board_id="practice-apex_1y-1",
        board_type="practice", mode="apex_1y", lineup_peak_rating=80.0, draft_efficiency=0.8,
        board_percentile=20.0, completed_at=now, payload={"selected_cards": []},
    )
    await repo.record_result(result)

    fetched = await repo.get_result(result_id)
    assert fetched is not None
    assert fetched.owner_sub == owner

    results = await repo.list_results(owner, limit=50)
    assert any(r.id == result_id for r in results)

    new_owner = f"user-{uuid.uuid4()}"
    count = await repo.transfer_owner(owner, new_owner)
    assert count == 1
    assert (await repo.get_result(result_id)).owner_sub == new_owner


@pytest.mark.asyncio
async def test_memory_result_snapshot_repo_conforms():
    await _assert_result_snapshot_repo_conforms(MemoryResultSnapshotRepository())


@pytest.mark.asyncio
@pytest.mark.supabase_integration
async def test_postgres_result_snapshot_repo_conforms(pg_pool):
    from app.repositories.postgres import PostgresResultSnapshotRepository
    await _assert_result_snapshot_repo_conforms(PostgresResultSnapshotRepository(pg_pool))


# ---------------------------------------------------------------------------
# ProfileRepository — handle uniqueness + settings
# ---------------------------------------------------------------------------

async def _assert_profile_repo_conforms(repo) -> None:
    sub_a = f"user-{uuid.uuid4()}"
    sub_b = f"user-{uuid.uuid4()}"
    handle = f"conform{uuid.uuid4().hex[:8]}"

    profile = await repo.get_or_create_profile(sub_a)
    assert profile.auth_sub == sub_a
    assert profile.handle is None

    again = await repo.get_or_create_profile(sub_a)
    assert again.id == profile.id, "get_or_create must be idempotent"

    updated = await repo.update_profile(sub_a, {"handle": handle, "display_name": "Conform Test"})
    assert updated.handle == handle
    assert updated.display_name == "Conform Test"

    with pytest.raises(HandleTakenError):
        await repo.update_profile(sub_b, {"handle": handle.upper()})  # case-insensitive collision

    by_handle = await repo.get_profile_by_handle(handle.upper())
    assert by_handle is not None
    assert by_handle.auth_sub == sub_a

    settings_obj = await repo.get_or_create_settings(sub_a)
    assert settings_obj.timezone == "UTC"
    # launch-polish IMPLEMENTATION_CONTRACT.md §2: never chosen -> None,
    # both backends, both before and after an unrelated update.
    assert settings_obj.theme_preference is None
    updated_settings = await repo.update_settings(sub_a, {"timezone": "America/New_York"})
    assert updated_settings.timezone == "America/New_York"
    assert updated_settings.theme_preference is None

    with_theme = await repo.update_settings(sub_a, {"theme_preference": "dark"})
    assert with_theme.theme_preference == "dark"
    assert with_theme.timezone == "America/New_York", "an unrelated update must not reset it"
    reread = await repo.get_or_create_settings(sub_a)
    assert reread.theme_preference == "dark"


@pytest.mark.asyncio
async def test_memory_profile_repo_conforms():
    await _assert_profile_repo_conforms(MemoryProfileRepository())


@pytest.mark.asyncio
@pytest.mark.supabase_integration
async def test_postgres_profile_repo_conforms(pg_pool):
    from app.repositories.postgres_profile import PostgresProfileRepository
    await _assert_profile_repo_conforms(PostgresProfileRepository(pg_pool))


# ---------------------------------------------------------------------------
# ArenaRepository — the multiplayer foundation
#
# The shared assertions below run on BOTH backends. The two-connection
# concurrency tests that follow them are Postgres-only by nature: they exist to
# prove the row lock in `_lock_match` serializes two real database sessions,
# and two asyncio tasks in one process are not two sessions. The in-memory
# equivalents in test_arena_foundation.py exercise the same logic under one
# asyncio.Lock and say so in their own docstrings.
# ---------------------------------------------------------------------------

def _arena_match(seat_count: int = 2, entry_path: str = "public_queue"):
    from app.repositories.arena_protocols import ArenaMatch

    return ArenaMatch(
        match_id=str(uuid.uuid4()),
        mode="conformance_mode",
        mode_version="conf_v1",
        model_version="peak3_v1",
        seat_count=seat_count,
        entry_path=entry_path,
        rated=(entry_path == "public_queue"),
        seed=4242,
        created_by="user-a",
        expires_at=datetime.now(timezone.utc) + timedelta(hours=2),
        snapshot={"n": 0},
    )


def _arena_seats(match_id: str, count: int):
    from app.repositories.arena_protocols import ArenaSeat

    return [
        ArenaSeat(
            match_id=match_id, seat_index=i, occupant_kind="human",
            occupant_sub=f"user-{uuid.uuid4()}", display_name=f"P{i}",
        )
        for i in range(count)
    ]


def _bump_reducer(data):
    """Accepts anything, increments a counter, appends one public and one
    seat-private event so visibility filtering is exercised on both backends."""
    from app.repositories.arena_protocols import EventDraft, ReducerOutput

    return ReducerOutput(
        accepted=True,
        snapshot={"n": data.match.snapshot.get("n", 0) + 1},
        events=(
            EventDraft(event_type="bumped", payload={"by": data.command.actor_seat_index}),
            EventDraft(
                event_type="secret", visibility="seat", visible_to_seat=0,
                payload={"only_for": 0},
            ),
        ),
    )


def _reject_reducer(data):
    from app.repositories.arena_protocols import ReducerOutput

    return ReducerOutput(
        accepted=False, rejection_code="nope", rejection_message="no"
    )


async def _assert_arena_repo_conforms(repo) -> None:
    from app.repositories.arena_protocols import (
        CommandRequest,
        MATCH_STATUS_EXPIRED,
        REJECT_STALE_STATE_VERSION,
        SeatUnavailable,
    )

    now = datetime.now(timezone.utc)
    match = _arena_match(seat_count=3)
    seats = _arena_seats(match.match_id, 2)
    await repo.create_match(match, seats)

    # Three seats are expressible — the reason this domain is not head-to-head.
    stored = await repo.get_match(match.match_id)
    assert stored is not None and stored.seat_count == 3
    assert len(await repo.get_seats(match.match_id)) == 2

    # One seat per subject.
    from app.repositories.arena_protocols import ArenaSeat

    with pytest.raises(SeatUnavailable):
        await repo.add_seat(
            ArenaSeat(
                match_id=match.match_id, seat_index=2, occupant_kind="human",
                occupant_sub=seats[0].occupant_sub,
            )
        )

    # A command advances the version by exactly one.
    def cmd(key, **kw):
        return CommandRequest(
            match_id=match.match_id, idempotency_key=key,
            command_type=kw.pop("command_type", "bump"),
            actor_sub=seats[0].occupant_sub, actor_seat_index=0,
            issued_at=now, **kw,
        )

    first = await repo.apply_command(cmd("conf-key-0001"), _bump_reducer, now)
    assert first.accepted and not first.replayed
    assert first.match.state_version == 1
    assert first.match.snapshot["n"] == 1

    # Replay applies nothing and reports itself.
    replay = await repo.apply_command(cmd("conf-key-0001"), _bump_reducer, now)
    assert replay.accepted and replay.replayed
    assert (await repo.get_match(match.match_id)).state_version == 1
    assert [e.event_type for e in replay.events] == [e.event_type for e in first.events]

    # A stale expected version is refused.
    stale = await repo.apply_command(
        cmd("conf-key-0002", expected_state_version=0), _bump_reducer, now
    )
    assert not stale.accepted and stale.rejection_code == REJECT_STALE_STATE_VERSION

    # A rejection is idempotent and consumes no version.
    r1 = await repo.apply_command(cmd("conf-key-0003"), _reject_reducer, now)
    r2 = await repo.apply_command(cmd("conf-key-0003"), _reject_reducer, now)
    assert r1.rejection_code == r2.rejection_code == "nope"
    assert r2.replayed
    assert (await repo.get_match(match.match_id)).state_version == 1

    # Visibility filtering happens in the repository, identically on both.
    seat0 = await repo.list_events(match.match_id, for_seat=0)
    seat1 = await repo.list_events(match.match_id, for_seat=1)
    assert any(e.event_type == "secret" for e in seat0)
    assert not any(e.event_type == "secret" for e in seat1)
    assert any(e.event_type == "bumped" for e in seat1)

    # Event sequence numbers are dense and ordered.
    server_view = await repo.list_events(match.match_id, for_seat=None)
    assert [e.seq for e in server_view] == list(range(len(server_view)))

    # expire_match is first-write-wins.
    assert await repo.expire_match(match.match_id, now) is True
    assert await repo.expire_match(match.match_id, now) is False
    assert (await repo.get_match(match.match_id)).status == MATCH_STATUS_EXPIRED


@pytest.mark.asyncio
async def test_memory_arena_repo_conforms():
    from app.repositories.arena_memory import MemoryArenaRepository
    await _assert_arena_repo_conforms(MemoryArenaRepository())


@pytest.mark.asyncio
@pytest.mark.supabase_integration
async def test_postgres_arena_repo_conforms(pg_pool):
    from app.repositories.arena_postgres import PostgresArenaRepository
    await _assert_arena_repo_conforms(PostgresArenaRepository(pg_pool))


async def _assert_arena_queue_conforms(repo) -> None:
    from app.repositories.arena_protocols import (
        ActiveQueueEntryExists,
        ArenaQueueEntry,
    )

    now = datetime.now(timezone.utc)
    mode = f"qmode_{uuid.uuid4().hex[:8]}"
    sub_a, sub_b = f"user-{uuid.uuid4()}", f"user-{uuid.uuid4()}"

    def entry(sub, joined=now):
        return ArenaQueueEntry(
            entry_id=str(uuid.uuid4()), owner_sub=sub, mode=mode,
            mode_version="v1", seat_count=2, joined_at=joined,
            human_preference_until=joined + timedelta(seconds=30),
            expires_at=joined + timedelta(minutes=10),
        )

    a = await repo.enqueue(entry(sub_a))
    with pytest.raises(ActiveQueueEntryExists):
        await repo.enqueue(entry(sub_a))

    b = await repo.enqueue(entry(sub_b))
    waiting = await repo.list_waiting_entries(mode, 2, exclude_owner_sub=sub_a)
    assert [e.owner_sub for e in waiting] == [sub_b]

    # Claiming is all-or-nothing.
    match = _arena_match()
    seats = _arena_seats(match.match_id, 2)
    claimed = await repo.claim_entries_into_match(
        [a.entry_id, b.entry_id], match, seats, now
    )
    assert claimed is not None
    assert await repo.get_queue_entry(sub_a, mode) is None

    # A second claim of the same entries loses.
    match2 = _arena_match()
    assert await repo.claim_entries_into_match(
        [a.entry_id, b.entry_id], match2, _arena_seats(match2.match_id, 2), now
    ) is None
    assert await repo.get_match(match2.match_id) is None

    # Sweeping expires only what is past its TTL.
    sub_c = f"user-{uuid.uuid4()}"
    await repo.enqueue(entry(sub_c))
    assert await repo.expire_stale_queue_entries(mode, now) == 0
    assert await repo.expire_stale_queue_entries(
        mode, now + timedelta(minutes=11)
    ) == 1
    assert await repo.get_queue_entry(sub_c, mode) is None

    # -- explicit bot fill ---------------------------------------------------
    # `collapse_human_preference` brings the caller's own window forward so
    # "Fill with bots now" can match immediately. Both backends must agree that
    # it is scoped to one subject and that it only ever moves the window
    # EARLIER -- a backend where a second press pushed the window out would let
    # a double-click extend the wait it was meant to end.
    sub_d, sub_e = f"user-{uuid.uuid4()}", f"user-{uuid.uuid4()}"
    d = await repo.enqueue(entry(sub_d))
    await repo.enqueue(entry(sub_e))

    collapsed = await repo.collapse_human_preference(sub_d, mode, now)
    assert collapsed is not None
    assert collapsed.prefers_humans_at(now) is False
    assert collapsed.owner_sub == sub_d

    # The other player's window is untouched -- one press cannot drag a
    # different waiting player into a bot match.
    other = await repo.get_queue_entry(sub_e, mode)
    assert other is not None
    assert other.prefers_humans_at(now) is True

    # Monotonic: a later call cannot push the window back out.
    again = await repo.collapse_human_preference(
        sub_d, mode, now + timedelta(minutes=5)
    )
    assert again is not None
    assert again.human_preference_until == collapsed.human_preference_until
    assert d.entry_id  # the entry itself is unchanged in identity

    # A subject with no waiting entry gets None rather than an error.
    assert await repo.collapse_human_preference(
        f"user-{uuid.uuid4()}", mode, now
    ) is None


async def _assert_arena_bot_policy_pin_conforms(repo) -> None:
    """`set_bot_policy_version` is first-write-wins on both backends.

    A private room is created with no bots and therefore no policy version; the
    host's later "fill empty seats" is the first moment there is one to record.
    Two concurrent fills must pin ONE value rather than race to overwrite each
    other, which is why the condition lives in the statement.
    """
    match = _arena_match(entry_path="private_room")
    await repo.create_match(match, _arena_seats(match.match_id, 1))
    assert (await repo.get_match(match.match_id)).bot_policy_version is None

    assert await repo.set_bot_policy_version(match.match_id, "policy_v1") is True
    assert (await repo.get_match(match.match_id)).bot_policy_version == "policy_v1"

    # Second write loses and changes nothing.
    assert await repo.set_bot_policy_version(match.match_id, "policy_v2") is False
    assert (await repo.get_match(match.match_id)).bot_policy_version == "policy_v1"

    # An unknown match is False, not an error.
    assert await repo.set_bot_policy_version(str(uuid.uuid4()), "policy_v1") is False


@pytest.mark.asyncio
async def test_memory_arena_bot_policy_pin_conforms():
    from app.repositories.arena_memory import MemoryArenaRepository
    await _assert_arena_bot_policy_pin_conforms(MemoryArenaRepository())


@pytest.mark.asyncio
@pytest.mark.supabase_integration
async def test_postgres_arena_bot_policy_pin_conforms(pg_pool):
    from app.repositories.arena_postgres import PostgresArenaRepository
    await _assert_arena_bot_policy_pin_conforms(PostgresArenaRepository(pg_pool))


@pytest.mark.asyncio
async def test_memory_arena_queue_conforms():
    from app.repositories.arena_memory import MemoryArenaRepository
    await _assert_arena_queue_conforms(MemoryArenaRepository())


@pytest.mark.asyncio
@pytest.mark.supabase_integration
async def test_postgres_arena_queue_conforms(pg_pool):
    from app.repositories.arena_postgres import PostgresArenaRepository
    await _assert_arena_queue_conforms(PostgresArenaRepository(pg_pool))


# ---------------------------------------------------------------------------
# TRUE two-connection concurrency. Postgres only, by nature.
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.supabase_integration
async def test_arena_concurrent_commands_on_one_match_serialize(pg_pool):
    """Two real database sessions, one match, one version.

    Both commands carry DISTINCT idempotency keys (so neither is a replay) and
    the SAME `expected_state_version`. Without `_lock_match`'s `FOR UPDATE`,
    both would read version N, both would pass the version check, and both
    would write N+1 -- one player's move silently overwriting the other's.

    With it, one transaction holds the row until it commits, so the second reads
    N+1 and is refused as stale. Exactly one accepted, exactly one
    `stale_state_version`, and the version advanced by exactly one.

    THIS is the test that justifies the blocking lock. Nothing in the in-memory
    suite can prove it, because two asyncio tasks in one process share one
    connection-less dict guarded by one asyncio.Lock.
    """
    import asyncio as _asyncio

    from app.repositories.arena_postgres import PostgresArenaRepository
    from app.repositories.arena_protocols import (
        CommandRequest,
        REJECT_STALE_STATE_VERSION,
    )

    repo = PostgresArenaRepository(pg_pool)
    now = datetime.now(timezone.utc)
    match = _arena_match()
    seats = _arena_seats(match.match_id, 2)
    await repo.create_match(match, seats)

    def cmd(key, seat):
        return CommandRequest(
            match_id=match.match_id, idempotency_key=key, command_type="bump",
            actor_sub=seats[seat].occupant_sub, actor_seat_index=seat,
            expected_state_version=0, issued_at=now,
        )

    a, b = await _asyncio.gather(
        repo.apply_command(cmd("race-key-0001", 0), _bump_reducer, now),
        repo.apply_command(cmd("race-key-0002", 1), _bump_reducer, now),
    )

    accepted = [o for o in (a, b) if o.accepted]
    rejected = [o for o in (a, b) if not o.accepted]
    assert len(accepted) == 1, "the row lock must serialize concurrent commands"
    assert len(rejected) == 1
    assert rejected[0].rejection_code == REJECT_STALE_STATE_VERSION
    assert (await repo.get_match(match.match_id)).state_version == 1
    assert (await repo.get_match(match.match_id)).snapshot["n"] == 1


@pytest.mark.asyncio
@pytest.mark.supabase_integration
async def test_arena_concurrent_identical_keys_apply_once(pg_pool):
    """The idempotency guarantee across two real sessions: the primary key on
    (match_id, idempotency_key) plus the row lock mean one apply, one replay."""
    import asyncio as _asyncio

    from app.repositories.arena_postgres import PostgresArenaRepository
    from app.repositories.arena_protocols import CommandRequest

    repo = PostgresArenaRepository(pg_pool)
    now = datetime.now(timezone.utc)
    match = _arena_match()
    seats = _arena_seats(match.match_id, 2)
    await repo.create_match(match, seats)

    def cmd():
        return CommandRequest(
            match_id=match.match_id, idempotency_key="dup-key-0001",
            command_type="bump", actor_sub=seats[0].occupant_sub,
            actor_seat_index=0, issued_at=now,
        )

    a, b = await _asyncio.gather(
        repo.apply_command(cmd(), _bump_reducer, now),
        repo.apply_command(cmd(), _bump_reducer, now),
    )
    assert a.accepted and b.accepted
    assert sorted([a.replayed, b.replayed]) == [False, True]
    assert (await repo.get_match(match.match_id)).state_version == 1


@pytest.mark.asyncio
@pytest.mark.supabase_integration
async def test_arena_concurrent_turn_resolution_has_one_winner(pg_pool):
    """The timeout/action race at the storage layer, across two sessions.

    `UPDATE ... WHERE resolved_at IS NULL` must let exactly one caller through.
    """
    import asyncio as _asyncio

    from app.repositories.arena_postgres import PostgresArenaRepository
    from app.repositories.arena_protocols import (
        CommandRequest,
        ReducerOutput,
        TurnDraft,
    )

    repo = PostgresArenaRepository(pg_pool)
    now = datetime.now(timezone.utc)
    match = _arena_match()
    await repo.create_match(match, _arena_seats(match.match_id, 2))

    def open_turn(data):
        return ReducerOutput(
            accepted=True,
            open_turn=TurnDraft(
                phase="play", deadline_at=data.now + timedelta(seconds=30),
                seat_index=0,
            ),
        )

    await repo.apply_command(
        CommandRequest(
            match_id=match.match_id, idempotency_key="open-key-0001",
            command_type="__open__", actor_sub=None, issued_at=now,
        ),
        open_turn, now,
    )

    late = now + timedelta(seconds=31)
    results = await _asyncio.gather(
        repo.resolve_overdue_turn(match.match_id, 0, late, "timeout"),
        repo.resolve_overdue_turn(match.match_id, 0, late, "action"),
        repo.resolve_overdue_turn(match.match_id, 0, late, "timeout"),
    )
    assert sorted(results) == [False, False, True]
    assert await repo.get_open_turn(match.match_id) is None
