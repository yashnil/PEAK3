"""MemoryDailyGridResultRepository (Phase 11D).

The in-memory repository is what dev and CI actually run, so its behaviour has
to match the Postgres one's guarantees rather than being a loose stand-in. The
properties under test are exactly the ones the migration encodes as
constraints: one result per (owner, board date, board version), immutable once
written, and owner-scoped.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.repositories.daily_grid_memory import MemoryDailyGridResultRepository
from app.repositories.daily_grid_protocols import DailyGridResult


def make_result(
    owner: str = "user-a",
    board_date: str = "2026-03-14",
    board_version: str = "daily_grid.v2",
    **overrides,
) -> DailyGridResult:
    base = {
        "id": "",
        "owner_sub": owner,
        "board_id": f"daily-grid-v2-{board_date}",
        "board_date": board_date,
        "board_version": board_version,
        "board_theme": "Award Season",
        "score": 640,
        "optimal_total": 800,
        "percent_of_best": 80.0,
        "squares_matching_optimal": 3,
        "incorrect_attempts": 2,
        "elapsed_seconds": 390,
        "played_on_board_date": True,
        "answers": [f"answer-{i}" for i in range(9)],
    }
    base.update(overrides)
    return DailyGridResult(**base)


@pytest.fixture
def repo() -> MemoryDailyGridResultRepository:
    return MemoryDailyGridResultRepository()


@pytest.mark.asyncio
async def test_a_first_save_creates_a_record(repo):
    saved, created = await repo.save_result(make_result())
    assert created is True
    assert saved.id
    assert saved.score == 640
    assert saved.answers == [f"answer-{i}" for i in range(9)]


@pytest.mark.asyncio
async def test_a_second_save_returns_the_existing_record(repo):
    first, _ = await repo.save_result(make_result())
    second, created = await repo.save_result(make_result())
    assert created is False
    assert second.id == first.id


@pytest.mark.asyncio
async def test_a_resave_cannot_overwrite_the_first_attempt(repo):
    """The point of idempotency: the FIRST attempt is the official one. A
    better board submitted for the same day must not replace it, or a player
    could grind until they liked the number."""
    first, _ = await repo.save_result(make_result(score=500))
    again, created = await repo.save_result(make_result(score=999))
    assert created is False
    assert again.score == 500
    assert again.id == first.id
    stored = await repo.get_result("user-a", "2026-03-14", "daily_grid.v2")
    assert stored.score == 500


@pytest.mark.asyncio
async def test_different_owners_have_independent_records(repo):
    a, a_created = await repo.save_result(make_result(owner="user-a", score=100))
    b, b_created = await repo.save_result(make_result(owner="user-b", score=200))
    assert a_created and b_created
    assert a.id != b.id
    assert (await repo.get_result("user-a", "2026-03-14", "daily_grid.v2")).score == 100
    assert (await repo.get_result("user-b", "2026-03-14", "daily_grid.v2")).score == 200


@pytest.mark.asyncio
async def test_one_owner_cannot_read_anothers_record(repo):
    await repo.save_result(make_result(owner="user-a"))
    assert await repo.get_result("user-b", "2026-03-14", "daily_grid.v2") is None
    assert await repo.list_results_for_owner("user-b") == []


@pytest.mark.asyncio
async def test_a_board_version_bump_is_a_new_result_not_a_conflict(repo):
    """A taxonomy revision makes a genuinely different board for the same date,
    so it earns its own record rather than colliding with the old one."""
    _, first = await repo.save_result(make_result(board_version="daily_grid.v2"))
    _, second = await repo.save_result(make_result(board_version="daily_grid.v3"))
    assert first is True
    assert second is True
    assert len(await repo.list_results_for_owner("user-a")) == 2


@pytest.mark.asyncio
async def test_different_dates_are_separate_records(repo):
    await repo.save_result(make_result(board_date="2026-03-14"))
    await repo.save_result(make_result(board_date="2026-03-15"))
    assert len(await repo.list_results_for_owner("user-a")) == 2


@pytest.mark.asyncio
async def test_results_list_newest_board_date_first(repo):
    for date in ("2026-03-12", "2026-03-15", "2026-03-13"):
        await repo.save_result(make_result(board_date=date))
    rows = await repo.list_results_for_owner("user-a")
    assert [r.board_date for r in rows] == ["2026-03-15", "2026-03-13", "2026-03-12"]


@pytest.mark.asyncio
async def test_the_list_honours_its_limit(repo):
    for day in range(1, 11):
        await repo.save_result(make_result(board_date=f"2026-03-{day:02d}"))
    assert len(await repo.list_results_for_owner("user-a", limit=4)) == 4


@pytest.mark.asyncio
async def test_a_replay_is_stored_and_flagged(repo):
    """Replays are recorded honestly rather than rejected, and never promoted
    to a live daily attempt."""
    saved, _ = await repo.save_result(make_result(played_on_board_date=False))
    assert saved.played_on_board_date is False


@pytest.mark.asyncio
async def test_an_absent_elapsed_time_is_allowed(repo):
    """The clock is optional -- a player whose browser lost the start time
    still has a real result."""
    saved, _ = await repo.save_result(make_result(elapsed_seconds=None))
    assert saved.elapsed_seconds is None


@pytest.mark.asyncio
async def test_created_at_defaults_to_now(repo):
    before = datetime.now(timezone.utc) - timedelta(seconds=1)
    saved, _ = await repo.save_result(make_result())
    assert saved.created_at >= before
