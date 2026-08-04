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
from app.repositories.leaderboard_memory import MemoryPerfectSeasonLeaderboardRepository
from app.repositories.leaderboard_protocols import (
    DuplicateRunSubmission,
    PerfectSeasonRun,
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
# PerfectSeasonLeaderboardRepository
#
# WHY THIS EXISTS. `PostgresPerfectSeasonLeaderboardRepository` had NO
# real-database coverage of any kind: every leaderboard test in the suite
# (18 of them) exercises the in-memory implementation, so the code path that
# actually runs in production -- the one behind the public 82-0 board -- was
# asserted about only through its stand-in. That is the gap this closes.
#
# It is not hypothetical. A leaderboard write that silently fails, or a row
# written with `is_public` false, or a `lineup_score` float rejected by
# asyncpg's NUMERIC codec, would each produce exactly one symptom -- an empty
# public board after a successful-looking submission -- and every existing
# test would still pass. (Those three specific hypotheses were checked by hand
# and are NOT bugs today; this test is what keeps that true.)
# ---------------------------------------------------------------------------


def _leaderboard_run(owner_sub: str, *, game_id: str, wins: int, score: float,
                     team_respins: int = 0, season_respins: int = 0,
                     mode: str = "apex_1y") -> PerfectSeasonRun:
    return PerfectSeasonRun(
        id="",
        owner_sub=owner_sub,
        display_name="conformancehandle",
        mode=mode,
        game_id=game_id,
        seed=7,
        wins=wins,
        losses=82 - wins,
        lineup_score=score,
        score_status="complete",
        exact_cards_scored=8,
        total_cards=8,
        team_respins_used=team_respins,
        season_respins_used=season_respins,
        roster_card_keys=[f"card-{i}" for i in range(8)],
    )


async def _purge_leaderboard_rows(pool, owner_sub: str) -> None:
    """Delete only this test's own rows.

    Unlike every other table this suite touches, `perfect_season_runs` backs a
    PUBLIC board, so a leftover conformance row would sit on a developer's
    local leaderboard permanently. Scoped strictly to the random `owner_sub`
    this test generated, so it can never reach real data.
    """
    await pool.execute(
        "DELETE FROM perfect_season_run_cards WHERE run_id IN "
        "(SELECT id FROM perfect_season_runs WHERE owner_sub = $1)",
        owner_sub,
    )
    await pool.execute("DELETE FROM perfect_season_runs WHERE owner_sub = $1", owner_sub)


async def _assert_leaderboard_repo_conforms(repo, owner_sub: str) -> None:
    prefix = uuid.uuid4().hex[:8]
    # Four runs chosen to exercise EVERY level of the sort key in one pass:
    # wins desc, then lineup_score desc, then (team+season) respins asc.
    # `b` ties `a` on wins AND score and differs only by respins; `d` ties on
    # wins and differs only by score; `c` loses on wins despite the best score.
    a = _leaderboard_run(owner_sub, game_id=f"{prefix}-a", wins=70, score=70.0)
    b = _leaderboard_run(owner_sub, game_id=f"{prefix}-b", wins=70, score=70.0,
                         team_respins=1, season_respins=1)
    d = _leaderboard_run(owner_sub, game_id=f"{prefix}-d", wins=70, score=60.0)
    c = _leaderboard_run(owner_sub, game_id=f"{prefix}-c", wins=65, score=90.0)

    saved_a = await repo.submit_run(a)
    assert saved_a.id, "submit_run must assign an id"
    # The single most load-bearing default in this file: a run submitted
    # through the product is public unless its owner later hides it. If this
    # ever became False the board would be empty while every write "succeeded".
    assert saved_a.is_public is True

    for run in (b, d, c):
        await repo.submit_run(run)

    # 1. Round-trip by game_id, including the roster written to the child table.
    found = await repo.get_run_by_game_id(f"{prefix}-a")
    assert found is not None
    assert found.id == saved_a.id
    assert found.roster_card_keys == [f"card-{i}" for i in range(8)], \
        "roster card keys must round-trip in slot order"

    # 2. A submitted run is on the public board immediately -- no visibility
    #    step, no delay, no extra flag to flip.
    board = await repo.get_leaderboard(mode="apex_1y", limit=500, cursor=None)
    mine = [r for r in board if r.owner_sub == owner_sub]
    assert len(mine) == 4, "every submitted run must appear on the public board"

    # 3. The sort contract, asserted on this test's own rows only so it holds
    #    on a shared local database that already has unrelated runs in it.
    assert [r.game_id for r in mine] == [f"{prefix}-a", f"{prefix}-b",
                                         f"{prefix}-d", f"{prefix}-c"], (
        "expected wins desc, then lineup_score desc, then fewer respins first"
    )

    # 4. A run that used respins is on the board exactly like one that did not
    #    (launch-polish IMPLEMENTATION_CONTRACT.md §7 -- respins are normal
    #    play and were never a reason to exclude a run).
    respin_run = next(r for r in mine if r.game_id == f"{prefix}-b")
    assert respin_run.team_respins_used == 1
    assert respin_run.season_respins_used == 1

    # 5. The mode identifier written is the one the board queries. `mode` is a
    #    canonical id (apex_1y / prime_3y / foundation_5y), never the
    #    user-facing word "Standard" -- a write/read mismatch here is
    #    indistinguishable from an empty board.
    unfiltered = await repo.get_leaderboard(mode=None, limit=500, cursor=None)
    assert any(r.id == saved_a.id for r in unfiltered)
    other_mode = await repo.get_leaderboard(mode="prime_3y", limit=500, cursor=None)
    assert not any(r.owner_sub == owner_sub for r in other_mode), \
        "mode must actually filter, not be ignored"

    # 6. One completed game produces exactly one entry, forever.
    with pytest.raises(DuplicateRunSubmission):
        await repo.submit_run(
            _leaderboard_run(owner_sub, game_id=f"{prefix}-a", wins=82, score=99.0)
        )

    # 7. Personal placement uses the same ordering as the board.
    placement = await repo.get_personal_placement(owner_sub, "apex_1y")
    assert placement is not None
    rank, best = placement
    assert best.game_id == f"{prefix}-a"
    assert rank >= 1

    # 8. Hiding a run removes it from the public board but never from the
    #    owner's own history.
    hidden = await repo.set_visibility(saved_a.id, owner_sub, False)
    assert hidden is not None and hidden.is_public is False
    board_after = await repo.get_leaderboard(mode="apex_1y", limit=500, cursor=None)
    assert not any(r.id == saved_a.id for r in board_after)
    own = await repo.list_runs_for_owner(owner_sub)
    assert any(r.id == saved_a.id for r in own), "hiding must not delete"

    # 9. Visibility is owner-scoped: a stranger holding the run id cannot flip
    #    it. Possessing an id never grants mutation rights (app/core/ownership.py).
    assert await repo.set_visibility(saved_a.id, f"stranger-{uuid.uuid4()}", True) is None

    # 10. Guest-claim transfer moves ownership only.
    moved_to = f"claimed-{uuid.uuid4()}"
    try:
        moved = await repo.transfer_owner(owner_sub, moved_to)
        assert moved == 4
        assert len(await repo.list_runs_for_owner(owner_sub)) == 0
        transferred = await repo.list_runs_for_owner(moved_to)
        assert len(transferred) == 4
        assert all(r.display_name == "conformancehandle" for r in transferred), \
            "transfer must not rewrite the submitted display name"
    finally:
        # Hand the rows back so the caller's cleanup (which keys on the
        # original owner_sub) still finds all four.
        await repo.transfer_owner(moved_to, owner_sub)


@pytest.mark.asyncio
async def test_memory_perfect_season_leaderboard_repo_conforms():
    await _assert_leaderboard_repo_conforms(
        MemoryPerfectSeasonLeaderboardRepository(), f"conformance-{uuid.uuid4()}"
    )


@pytest.mark.asyncio
@pytest.mark.supabase_integration
async def test_postgres_perfect_season_leaderboard_repo_conforms(pg_pool):
    from app.repositories.leaderboard_postgres import (
        PostgresPerfectSeasonLeaderboardRepository,
    )

    owner_sub = f"conformance-{uuid.uuid4()}"
    try:
        await _assert_leaderboard_repo_conforms(
            PostgresPerfectSeasonLeaderboardRepository(pg_pool), owner_sub
        )
    finally:
        await _purge_leaderboard_rows(pg_pool, owner_sub)
