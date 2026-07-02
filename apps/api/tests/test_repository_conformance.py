"""Repository protocol conformance suite (Phase 4.0A section G).

Runs the same behavior assertions against every repository's in-memory
implementation AND its real PostgreSQL implementation, so a protocol
guarantee (idempotency, uniqueness, transfer semantics) can never silently
hold for one backend and not the other.

The Postgres half requires a real local Supabase/Postgres instance
(PEAK3_TEST_DATABASE_URL — see supabase/migrations and `supabase start`).
When absent, the Postgres half is skipped with an explicit reason — the
memory half still always runs. This mirrors tests/integration/conftest.py's
"never silently report as passing" discipline.
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timezone
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
    updated_settings = await repo.update_settings(sub_a, {"timezone": "America/New_York"})
    assert updated_settings.timezone == "America/New_York"


@pytest.mark.asyncio
async def test_memory_profile_repo_conforms():
    await _assert_profile_repo_conforms(MemoryProfileRepository())


@pytest.mark.asyncio
async def test_postgres_profile_repo_conforms(pg_pool):
    from app.repositories.postgres_profile import PostgresProfileRepository
    await _assert_profile_repo_conforms(PostgresProfileRepository(pg_pool))
