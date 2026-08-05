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


async def _assert_arena_rating_conforms(repo, match_ids: list[str]) -> None:
    """The rating ledger's guarantees, identical on both backends.

    The one that matters most is idempotency: a settlement replayed -- by a
    retry, a redeploy mid-settle, or the lazy `_advance` path calling it on
    every read -- must write nothing the second time. A backend where it wrote
    twice would double a rating change, which is the single class of bug in a
    rating system that players notice and never accept.
    """
    from app.repositories.arena_rating_protocols import ArenaRatingHistoryEntry

    mode = f"rmode_{uuid.uuid4().hex[:8]}"
    sub_a, sub_b = f"user-{uuid.uuid4()}", f"user-{uuid.uuid4()}"
    # Real match ids supplied by the caller: `arena_rating_history.match_id` is
    # a FOREIGN KEY into arena_matches on Postgres, so a random UUID is rejected
    # there while the memory backend would happily accept it. The conformance
    # suite exists to surface exactly that kind of divergence, and did.
    match_id, second = match_ids[0], match_ids[1]

    def entry(sub, match, *, pre=1500.0, post=1560.0, placement=1, bot=False):
        return ArenaRatingHistoryEntry(
            owner_sub=sub, mode=mode, match_id=match,
            pre_rating=pre, pre_rd=350.0, pre_volatility=0.06,
            post_rating=post, post_rd=290.0, post_volatility=0.06,
            unbounded_post_rating=post, bound_applied=False,
            placement=placement, had_bot_opponent=bot,
            bot_policy_version="policy_v1" if bot else None,
            algorithm_version="test_v1",
            opponents=[{"opponent_seat": 1, "score": 1.0, "was_bot": bot}],
        )

    # Nothing yet -- absent, not defaulted. The caller owns the starting rating.
    assert await repo.get_ratings_for_subs([sub_a], mode) == {}

    written = await repo.record_match_rating(
        [entry(sub_a, match_id, post=1560.0),
         entry(sub_b, match_id, post=1440.0, placement=2)]
    )
    assert written == 2

    ratings = await repo.get_ratings_for_subs([sub_a, sub_b], mode)
    assert ratings[sub_a].rating == pytest.approx(1560.0)
    assert ratings[sub_a].rated_matches == 1
    assert ratings[sub_b].rating == pytest.approx(1440.0)

    # THE REPLAY. Same match, same players -- nothing written, and critically
    # the rating does NOT advance a second time.
    assert await repo.record_match_rating(
        [entry(sub_a, match_id, post=9999.0),
         entry(sub_b, match_id, post=1.0, placement=2)]
    ) == 0
    replayed = await repo.get_ratings_for_subs([sub_a, sub_b], mode)
    assert replayed[sub_a].rating == pytest.approx(1560.0)
    assert replayed[sub_a].rated_matches == 1, "a replay must not count a match twice"

    # A different match does advance.
    assert await repo.record_match_rating([entry(sub_a, second, pre=1560.0, post=1600.0)]) == 1
    after = await repo.get_ratings_for_subs([sub_a], mode)
    assert after[sub_a].rating == pytest.approx(1600.0)
    assert after[sub_a].rated_matches == 2

    # Leaderboard order: rating desc, then matches desc, then sub -- total, so
    # paging cannot repeat or skip.
    board = await repo.get_leaderboard_page(mode, limit=10)
    assert [r.owner_sub for r in board] == [sub_a, sub_b]
    assert board[0].rated_matches == 2

    # History is newest-first and carries the pairwise decomposition.
    history = await repo.list_history(sub_a, mode)
    assert len(history) == 2
    assert history[0].match_id == second
    assert history[0].opponents and history[0].opponents[0]["score"] == 1.0

    # An empty batch is a no-op, not an error.
    assert await repo.record_match_rating([]) == 0


async def _assert_arena_player_stats_conforms(repo) -> None:
    """Leaderboard statistics, identical on both backends.

    WRITTEN BECAUSE THE TWO IMPLEMENTATIONS ARE GENUINELY DIFFERENT -- one is a
    Python loop over dicts, the other a SQL aggregate with a correlated EXISTS
    for the bot-composition flag and a separate JSONB pass per detail key.
    Nothing about "these compute the same thing" is obvious from reading them,
    and a leaderboard that disagrees with the match history it was derived from
    is the failure this prevents.

    The properties that matter and are easy to get wrong in exactly one backend:
    only RATED results count; the player's own bot flag is irrelevant (what
    matters is whether the MATCH contained a bot); and a detail key that is
    absent or non-numeric is skipped rather than counted as zero.
    """
    from app.repositories.arena_protocols import ArenaResult, ReducerOutput, ResultDraft

    mode = "conformance_mode"
    sub = f"user-{uuid.uuid4()}"
    other = f"user-{uuid.uuid4()}"

    async def finish(*, rated: bool, placement: int, outcome: str, score: float,
                     detail: dict, with_bot: bool):
        from app.repositories.arena_protocols import (
            MATCH_STATUS_COMPLETED, ArenaSeat, CommandRequest,
        )
        match = _arena_match(seat_count=2,
                             entry_path="public_queue" if rated else "private_room")
        seats = [
            ArenaSeat(match_id=match.match_id, seat_index=0, occupant_kind="human",
                      occupant_sub=sub, display_name="P0"),
            ArenaSeat(match_id=match.match_id, seat_index=1,
                      occupant_kind="bot" if with_bot else "human",
                      occupant_sub=None if with_bot else other,
                      bot_id="b1" if with_bot else None,
                      bot_rating=1500.0 if with_bot else None,
                      display_name="P1"),
        ]
        await repo.create_match(match, seats)

        def _complete(data):
            return ReducerOutput(
                accepted=True,
                status=MATCH_STATUS_COMPLETED,
                results=(
                    ResultDraft(seat_index=0, placement=placement, score=score,
                                outcome=outcome, detail=detail),
                    ResultDraft(seat_index=1, placement=3 - placement,
                                score=score - 1, outcome="loss", detail={}),
                ),
            )

        await repo.apply_command(
            CommandRequest(
                # >= 8 chars: arena_match_commands CHECK. The memory backend does not
                # enforce that length rule, so a short key passes there and fails
                # on Postgres -- found by this test on its first run.
                match_id=match.match_id, idempotency_key=f"finish-{match.match_id[:8]}",
                command_type="__finish__", actor_sub=None,
                expected_state_version=None,
                issued_at=datetime.now(timezone.utc),
            ),
            _complete, datetime.now(timezone.utc),
        )
        return match.match_id

    # Two rated wins (one against a bot), one rated loss, one UNRATED win that
    # must not be counted at all.
    await finish(rated=True, placement=1, outcome="win", score=100.0,
                 detail={"lineup_peak_score": 80.0}, with_bot=False)
    await finish(rated=True, placement=1, outcome="win", score=90.0,
                 detail={"lineup_peak_score": 70.0}, with_bot=True)
    await finish(rated=True, placement=2, outcome="loss", score=50.0,
                 detail={"lineup_peak_score": 40.0}, with_bot=False)
    await finish(rated=False, placement=1, outcome="win", score=999.0,
                 detail={"lineup_peak_score": 999.0}, with_bot=False)

    stats = await repo.get_player_stats(mode, [sub], ("lineup_peak_score",))
    st = stats[sub]

    assert st.rated_matches == 3, "the unrated match must not be counted"
    assert st.wins == 2
    assert st.losses == 1
    assert st.draws == 0
    # seat_count 2 -> top half is first place only.
    assert st.podiums == 2
    assert st.average_placement == pytest.approx((1 + 1 + 2) / 3, abs=0.001)

    assert st.score_avg == pytest.approx(80.0, abs=0.01)   # (100+90+50)/3
    assert st.score_best == pytest.approx(100.0, abs=0.01)
    assert st.detail_averages["lineup_peak_score"] == pytest.approx(
        (80.0 + 70.0 + 40.0) / 3, abs=0.01
    )
    assert st.detail_bests["lineup_peak_score"] == pytest.approx(80.0, abs=0.01)

    # Composition: one of the three rated matches contained a bot. This is a
    # per-MATCH property, not the player's own was_bot -- which is always false
    # for a human seat and would give 0/3 if confused for it.
    assert st.matches_with_bots == 1
    assert st.matches_all_human == 2

    # A subject with no matches is present and zeroed, not missing -- the route
    # indexes into this dict per leaderboard row.
    empty = await repo.get_player_stats(mode, [f"user-{uuid.uuid4()}"], ())
    assert len(empty) == 1
    assert next(iter(empty.values())).rated_matches == 0


@pytest.mark.asyncio
async def test_memory_arena_player_stats_conforms():
    from app.repositories.arena_memory import MemoryArenaRepository
    await _assert_arena_player_stats_conforms(MemoryArenaRepository())


@pytest.mark.asyncio
@pytest.mark.supabase_integration
async def test_postgres_arena_player_stats_conforms(pg_pool):
    from app.repositories.arena_postgres import PostgresArenaRepository
    await _assert_arena_player_stats_conforms(PostgresArenaRepository(pg_pool))


@pytest.mark.asyncio
async def test_memory_arena_rating_conforms():
    from app.repositories.arena_rating_memory import MemoryArenaRatingRepository
    await _assert_arena_rating_conforms(
        MemoryArenaRatingRepository(), [str(uuid.uuid4()), str(uuid.uuid4())]
    )


@pytest.mark.asyncio
@pytest.mark.supabase_integration
async def test_postgres_arena_rating_conforms(pg_pool):
    from app.repositories.arena_postgres import PostgresArenaRepository
    from app.repositories.arena_rating_postgres import PostgresArenaRatingRepository

    arena = PostgresArenaRepository(pg_pool)
    ids = []
    for _ in range(2):
        match = _arena_match()
        await arena.create_match(match, _arena_seats(match.match_id, 2))
        ids.append(match.match_id)
    await _assert_arena_rating_conforms(PostgresArenaRatingRepository(pg_pool), ids)


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
