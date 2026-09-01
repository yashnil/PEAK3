"""Ranked concurrency tests against a REAL Postgres instance.

public-platform-readiness Batch P4.

WHY THIS FILE EXISTS. Every existing Ranked concurrency test
(test_ranked_concurrency.py, and the concurrency-flavored tests inside
test_ranked_matchmaking.py / test_ranked_settlement.py) runs exclusively
against `MemoryRankedMatchmakingRepository`/`MemoryRankedRatingRepository`.
Those repositories wrap their entire check-then-write sequence in one
`asyncio.Lock`, which trivially serializes "concurrent" `asyncio.gather`
calls within a single test process — it proves the in-memory implementation
is internally consistent, but proves NOTHING about whether the real
`PostgresRankedMatchmakingRepository`/`PostgresRankedRatingRepository`
(what actually runs in production) is race-safe under genuinely concurrent
database transactions. That gap is exactly how
`record_submission`'s idempotency-key race (fixed alongside this file, see
`ranked_postgres.py`'s docstring on that method) went undetected: the
memory-only suite could not have caught it by construction.

This file re-runs the same class of race, driven the same way (real
`asyncio.gather`, real overlapping calls into the service layer), but wired
to real `PostgresRankedMatchmakingRepository`/`PostgresRankedRatingRepository`
instances sharing one connection pool — so two "concurrent" calls are
genuinely two separate Postgres transactions racing, not two coroutines
taking turns under one Python lock.

Marked `supabase_integration`, same discipline as every other real-Postgres
test in this suite: skips with an explicit reason when no test database is
configured, never silently reported as passing.
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from pathlib import Path

import pytest
import pytest_asyncio

_repo_root = Path(__file__).resolve().parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

try:
    import asyncpg
except ImportError:
    asyncpg = None  # type: ignore[assignment]

from app.services.ranked import matchmaking as mm
from app.services.ranked import settlement as settle

pytestmark = pytest.mark.supabase_integration

TEST_DATABASE_URL = os.environ.get("PEAK3_TEST_DATABASE_URL")


def _pg_available() -> bool:
    return bool(TEST_DATABASE_URL) and asyncpg is not None


PG_SKIP_REASON = (
    "PEAK3_TEST_DATABASE_URL not set — real-Postgres Ranked concurrency "
    "tests skipped (expected outside a local Supabase / CI run with a real "
    "test database configured)."
)


@pytest_asyncio.fixture
async def repos():
    if not _pg_available():
        pytest.skip(PG_SKIP_REASON)
    from app.repositories.ranked_postgres import (
        PostgresRankedMatchmakingRepository,
        PostgresRankedRatingRepository,
        ensure_queue_versions_seeded,
    )

    pool = await asyncpg.create_pool(TEST_DATABASE_URL)
    await ensure_queue_versions_seeded(pool)
    # Test isolation: this Postgres instance is shared and persistent across
    # runs (unlike the memory repos, nothing resets it between tests). A
    # 'waiting' row abandoned by an earlier failed/aborted run in this same
    # queue would otherwise be "the longest-waiting compatible candidate"
    # (matchmaking.py's own tie-break) and silently get paired with instead
    # of the two fresh entries a test just created — this bit exactly once
    # while developing these tests (alice paired with a stale leftover "bob"
    # from a prior run, not the "bob" the failing test itself had just
    # created) and looked identical to a real production race until traced.
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM ranked_queue_entries WHERE status = 'waiting'")
    mmr = PostgresRankedMatchmakingRepository(pool)
    rr = PostgresRankedRatingRepository(pool)
    yield mmr, rr
    await pool.close()


def _sub(label: str) -> str:
    """A fresh, real-looking UUID subject per test run — Postgres state
    persists across runs (unlike the memory repos), so fixed names like
    "alice"/"bob" would collide with a prior run's leftover queue entry."""
    return f"{label}-{uuid.uuid4().hex[:12]}"


@pytest.mark.asyncio
async def test_postgres_one_user_cannot_join_the_same_queue_twice_concurrently(repos):
    """Same invariant as the memory-only version of this test
    (test_ranked_concurrency.py), against real Postgres: two genuinely
    concurrent transactions attempting to INSERT a 'waiting' queue row for
    the same (owner_sub, mode) — the partial unique index
    `WHERE status='waiting'` must allow exactly one to succeed."""
    mmr, rr = repos
    alice = _sub("alice")
    results = await asyncio.gather(
        mm.join_queue(alice, "apex_1y", mmr, rr),
        mm.join_queue(alice, "apex_1y", mmr, rr),
        return_exceptions=True,
    )
    successes = [r for r in results if not isinstance(r, Exception)]
    failures = [r for r in results if isinstance(r, Exception)]
    assert len(successes) == 1, f"expected exactly one successful join, got {results}"
    assert len(failures) == 1
    from app.repositories.ranked_protocols import ActiveQueueEntryExists

    assert isinstance(failures[0], ActiveQueueEntryExists)


@pytest.mark.asyncio
async def test_postgres_concurrent_pairing_produces_exactly_one_match(repos):
    """The central P4.3 invariant, against real Postgres: two queue entries
    (alice, bob) exist; two concurrent `try_match` calls — one racing to
    pair alice with bob, one racing to pair bob with alice, mirroring the
    real shape of "A's own join request tries to match, and B's own join
    request tries to match, at nearly the same instant" — must produce
    exactly ONE match with exactly these two participants, never two
    matches and never a participant assigned twice.
    """
    mmr, rr = repos
    alice, bob = _sub("alice"), _sub("bob")
    entry_a = await mm.join_queue(alice, "apex_1y", mmr, rr)
    entry_b = await mm.join_queue(bob, "apex_1y", mmr, rr)

    match_from_a, match_from_b = await asyncio.gather(
        mm.try_match("apex_1y", entry_a, mmr),
        mm.try_match("apex_1y", entry_b, mmr),
    )

    matches = [m for m in (match_from_a, match_from_b) if m is not None]
    assert len(matches) >= 1, "at least one side must have won the pairing race"
    # Both sides either produced the SAME match id, or one produced None
    # because the other already claimed both queue entries.
    match_ids = {m.id for m in matches}
    assert len(match_ids) == 1, f"expected exactly one canonical match, got {match_ids}"

    match_id = match_ids.pop()
    participants = await mmr.get_participants(match_id)
    assert len(participants) == 2
    assert {p.owner_sub for p in participants} == {alice, bob}

    # Neither queue entry is still 'waiting' — both were consumed by the one
    # match, never left dangling or double-consumed.
    assert await mmr.get_active_queue_entry(alice, "apex_1y") is None
    assert await mmr.get_active_queue_entry(bob, "apex_1y") is None


@pytest.mark.asyncio
async def test_postgres_record_submission_concurrent_different_idempotency_keys(repos):
    """Regression test for the exact bug fixed in ranked_postgres.py's
    record_submission this batch: two genuinely concurrent submissions for
    the SAME (match_id, owner_sub) but DIFFERENT idempotency_keys (e.g. a
    slow first request the client retried, both now in flight) must not
    raise — exactly one submission row must exist, and both calls must
    return a MatchSubmission for that same row.
    """
    mmr, rr = repos
    alice, bob = _sub("alice"), _sub("bob")
    entry_a = await mm.join_queue(alice, "apex_1y", mmr, rr)
    await mm.try_match("apex_1y", entry_a, mmr)
    entry_b = await mm.join_queue(bob, "apex_1y", mmr, rr)
    match = await mm.try_match("apex_1y", entry_b, mmr)
    assert match is not None

    lineup_eval = {"lineup_peak_rating": 80.0, "draft_efficiency": 0.8, "solver_version": "v1"}
    results = await asyncio.gather(
        settle.record_submission(
            match.id, alice, str(uuid.uuid4()), match.board_version_key, lineup_eval, "key-one", mmr,
        ),
        settle.record_submission(
            match.id, alice, str(uuid.uuid4()), match.board_version_key, lineup_eval, "key-two", mmr,
        ),
        return_exceptions=True,
    )
    exceptions = [r for r in results if isinstance(r, Exception)]
    assert exceptions == [], f"record_submission must never raise on a concurrent idempotency-key race, got {exceptions}"

    submissions = await mmr.list_submissions(match.id)
    alice_submissions = [s for s in submissions if s.owner_sub == alice]
    assert len(alice_submissions) == 1, "exactly one durable submission row for alice, not two"

    ids = {r.id for r in results}
    assert len(ids) == 1, "both concurrent calls must agree on the same winning submission id"


@pytest.mark.asyncio
async def test_postgres_concurrent_settlement_applies_rating_exactly_once(repos):
    """The central P4.6/P4.7 invariant, against real Postgres: once both
    participants have submitted, two concurrent `attempt_settlement` calls
    for the SAME match (e.g. both players' final-submission requests each
    independently trigger a settlement attempt) must produce exactly one
    settlement and exactly one rating-ledger entry per player — never two,
    never a doubled rating change.
    """
    mmr, rr = repos
    alice, bob = _sub("alice"), _sub("bob")
    entry_a = await mm.join_queue(alice, "apex_1y", mmr, rr)
    await mm.try_match("apex_1y", entry_a, mmr)
    entry_b = await mm.join_queue(bob, "apex_1y", mmr, rr)
    match = await mm.try_match("apex_1y", entry_b, mmr)
    assert match is not None

    await settle.record_submission(
        match.id, alice, str(uuid.uuid4()), match.board_version_key,
        {"lineup_peak_rating": 90.0, "draft_efficiency": 0.9, "solver_version": "v1"}, "k-alice", mmr,
    )
    await settle.record_submission(
        match.id, bob, str(uuid.uuid4()), match.board_version_key,
        {"lineup_peak_rating": 70.0, "draft_efficiency": 0.7, "solver_version": "v1"}, "k-bob", mmr,
    )

    results = await asyncio.gather(
        settle.attempt_settlement(match.id, mmr, rr),
        settle.attempt_settlement(match.id, mmr, rr),
        settle.attempt_settlement(match.id, mmr, rr),
        return_exceptions=True,
    )
    exceptions = [r for r in results if isinstance(r, Exception)]
    assert exceptions == [], f"attempt_settlement must never raise under a concurrent race, got {exceptions}"

    settlements = [r for r in results if r is not None]
    assert len(settlements) >= 1

    stored_settlement = await rr.get_settlement(match.id)
    assert stored_settlement is not None

    alice_ledger = await rr.list_ledger_entries(alice, "apex_1y")
    bob_ledger = await rr.list_ledger_entries(bob, "apex_1y")
    alice_settlement_entries = [e for e in alice_ledger if e.match_id == match.id]
    bob_settlement_entries = [e for e in bob_ledger if e.match_id == match.id]
    assert len(alice_settlement_entries) == 1, "exactly one rating-ledger effect for alice on this match"
    assert len(bob_settlement_entries) == 1, "exactly one rating-ledger effect for bob on this match"

    final_match = await mmr.get_match(match.id)
    assert final_match.status == "settled"
