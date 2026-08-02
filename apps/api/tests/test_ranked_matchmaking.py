"""Ranked matchmaking tests (spec V.9-15, section U concurrency items).

Uses the in-memory ranked repositories directly (async) rather than the
dependency_overrides/TestClient pattern, since matchmaking races are most
directly exercised at the service layer with asyncio.gather.
"""
from __future__ import annotations

import asyncio

import pytest

from app.repositories.ranked_memory import (
    MemoryRankedMatchmakingRepository,
    MemoryRankedRatingRepository,
)
from app.repositories.ranked_protocols import ActiveQueueEntryExists
from app.services.ranked import matchmaking as mm


@pytest.fixture
def repos():
    return MemoryRankedMatchmakingRepository(), MemoryRankedRatingRepository()


@pytest.mark.asyncio
async def test_compatible_players_are_paired(repos):
    mmr, rr = repos
    entry_a = await mm.join_queue("alice", "apex_1y", mmr, rr)
    assert await mm.try_match("apex_1y", entry_a, mmr) is None

    entry_b = await mm.join_queue("bob", "apex_1y", mmr, rr)
    match = await mm.try_match("apex_1y", entry_b, mmr)
    assert match is not None
    subs = {p.owner_sub for p in await mmr.get_participants(match.id)}
    assert subs == {"alice", "bob"}


@pytest.mark.asyncio
async def test_same_user_cannot_self_match(repos):
    mmr, rr = repos
    await mm.join_queue("alice", "apex_1y", mmr, rr)
    # Same user cannot even hold two waiting entries in the same queue —
    # the second join is rejected outright (see test below) — and try_match
    # explicitly excludes the joining user's own sub from candidates.
    entry_a2 = await mmr.list_waiting_entries("apex_1y", exclude_owner_sub="alice")
    assert entry_a2 == []


@pytest.mark.asyncio
async def test_duplicate_queue_joins_are_rejected(repos):
    mmr, rr = repos
    await mm.join_queue("alice", "apex_1y", mmr, rr)
    with pytest.raises(ActiveQueueEntryExists):
        await mm.join_queue("alice", "apex_1y", mmr, rr)


@pytest.mark.asyncio
async def test_duplicate_join_after_cancel_succeeds(repos):
    mmr, rr = repos
    await mm.join_queue("alice", "apex_1y", mmr, rr)
    assert await mm.cancel_queue("alice", "apex_1y", mmr) is True
    # No longer an active entry — rejoining must succeed.
    entry = await mm.join_queue("alice", "apex_1y", mmr, rr)
    assert entry.status == "waiting"


@pytest.mark.asyncio
async def test_independent_queues_do_not_conflict(repos):
    mmr, rr = repos
    await mm.join_queue("alice", "apex_1y", mmr, rr)
    # Same user, different queue — must succeed independently.
    entry = await mm.join_queue("alice", "prime_3y", mmr, rr)
    assert entry.mode == "prime_3y"


@pytest.mark.asyncio
async def test_search_range_expands_with_wait_time():
    from datetime import datetime, timedelta, timezone
    from app.repositories.ranked_protocols import QueueEntry

    now = datetime.now(timezone.utc)
    fresh = QueueEntry(
        id="1", owner_sub="a", mode="apex_1y", queue_version="v1", rating_snapshot=1500,
        rd_snapshot=100, volatility_snapshot=0.06, placement_state="established",
        status="waiting", joined_at=now, search_range_rating=100.0,
    )
    stale = QueueEntry(
        id="2", owner_sub="b", mode="apex_1y", queue_version="v1", rating_snapshot=1500,
        rd_snapshot=100, volatility_snapshot=0.06, placement_state="established",
        status="waiting", joined_at=now - timedelta(seconds=200), search_range_rating=100.0,
    )
    assert mm._search_range(stale, now) > mm._search_range(fresh, now)


@pytest.mark.asyncio
async def test_placement_players_match_broadly_regardless_of_rating_gap():
    from datetime import datetime, timezone
    from app.repositories.ranked_protocols import QueueEntry

    now = datetime.now(timezone.utc)
    low = QueueEntry(
        id="1", owner_sub="a", mode="apex_1y", queue_version="v1", rating_snapshot=1000,
        rd_snapshot=350, volatility_snapshot=0.06, placement_state="placement",
        status="waiting", joined_at=now, search_range_rating=100.0,
    )
    high = QueueEntry(
        id="2", owner_sub="b", mode="apex_1y", queue_version="v1", rating_snapshot=2500,
        rd_snapshot=350, volatility_snapshot=0.06, placement_state="placement",
        status="waiting", joined_at=now, search_range_rating=100.0,
    )
    assert mm._compatible(low, high, now) is True


@pytest.mark.asyncio
async def test_established_players_respect_rating_range(repos):
    from datetime import datetime, timezone
    from app.repositories.ranked_protocols import QueueEntry

    now = datetime.now(timezone.utc)
    low = QueueEntry(
        id="1", owner_sub="a", mode="apex_1y", queue_version="v1", rating_snapshot=1000,
        rd_snapshot=50, volatility_snapshot=0.06, placement_state="established",
        status="waiting", joined_at=now, search_range_rating=100.0,
    )
    high = QueueEntry(
        id="2", owner_sub="b", mode="apex_1y", queue_version="v1", rating_snapshot=2500,
        rd_snapshot=50, volatility_snapshot=0.06, placement_state="established",
        status="waiting", joined_at=now, search_range_rating=100.0,
    )
    assert mm._compatible(low, high, now) is False


@pytest.mark.asyncio
async def test_queue_cancellation_before_match_has_no_effect(repos):
    mmr, rr = repos
    await mm.join_queue("alice", "apex_1y", mmr, rr)
    assert await mm.cancel_queue("alice", "apex_1y", mmr) is True
    entry = await mmr.get_active_queue_entry("alice", "apex_1y")
    assert entry is None
    # No leftover waiting entry for bob to be paired against.
    entry_b = await mm.join_queue("bob", "apex_1y", mmr, rr)
    assert await mm.try_match("apex_1y", entry_b, mmr) is None


@pytest.mark.asyncio
async def test_repeated_opponents_are_deprioritized(repos):
    mmr, rr = repos
    # First pairing establishes opponent history.
    entry_a = await mm.join_queue("alice", "apex_1y", mmr, rr)
    await mm.try_match("apex_1y", entry_a, mmr)
    entry_b = await mm.join_queue("bob", "apex_1y", mmr, rr)
    match1 = await mm.try_match("apex_1y", entry_b, mmr)
    assert match1 is not None

    # Now three waiting: alice(again), bob(again), carol — carol should be
    # preferred over the repeat opponent when both are compatible.
    entry_a2 = await mm.join_queue("alice", "apex_1y", mmr, rr)
    entry_carol = await mm.join_queue("carol", "apex_1y", mmr, rr)
    match2 = await mm.try_match("apex_1y", entry_a2, mmr)
    assert match2 is not None
    subs = {p.owner_sub for p in await mmr.get_participants(match2.id)}
    assert subs == {"alice", "carol"}, f"expected alice to avoid repeat opponent bob, got {subs}"


@pytest.mark.asyncio
async def test_repeated_opponent_allowed_when_no_other_candidate(repos):
    mmr, rr = repos
    entry_a = await mm.join_queue("alice", "apex_1y", mmr, rr)
    await mm.try_match("apex_1y", entry_a, mmr)
    entry_b = await mm.join_queue("bob", "apex_1y", mmr, rr)
    await mm.try_match("apex_1y", entry_b, mmr)

    # Only alice and bob in the population — a rematch must still be allowed
    # (spec: cap repeats but never block matching entirely for a small pool).
    entry_a2 = await mm.join_queue("alice", "apex_1y", mmr, rr)
    entry_b2 = await mm.join_queue("bob", "apex_1y", mmr, rr)
    match2 = await mm.try_match("apex_1y", entry_b2, mmr)
    assert match2 is not None


@pytest.mark.asyncio
async def test_concurrent_pairing_creates_exactly_one_match(repos):
    """Two 'workers' racing to pair the same waiting entries must not both succeed."""
    mmr, rr = repos
    entry_a = await mm.join_queue("alice", "apex_1y", mmr, rr)
    entry_b = await mm.join_queue("bob", "apex_1y", mmr, rr)
    entry_c = await mm.join_queue("carol", "apex_1y", mmr, rr)

    results = await asyncio.gather(
        mm.try_match("apex_1y", entry_a, mmr),
        mm.try_match("apex_1y", entry_b, mmr),
        mm.try_match("apex_1y", entry_c, mmr),
    )
    matches = [r for r in results if r is not None]
    assert len({m.id for m in matches}) <= 1
    assert await mmr.count_pending_matches() == len({m.id for m in matches})


@pytest.mark.asyncio
async def test_no_bot_opponents_ranked_pool_only_has_real_waiting_entries(repos):
    """try_match only ever considers rows actually present in
    ranked_queue_entries — there is no synthetic/bot candidate injection
    anywhere in the matchmaking path.
    """
    mmr, rr = repos
    entry_a = await mm.join_queue("alice", "apex_1y", mmr, rr)
    assert await mm.try_match("apex_1y", entry_a, mmr) is None
    assert await mmr.count_pending_matches() == 0


# ---------------------------------------------------------------------------
# Abandoned-entry sweep (QUEUE_ENTRY_TTL)
#
# A queue entry is a durable row and outlives the tab that made it. On a
# persistent database this is not theoretical: the browser e2e suite's first
# joiner was being paired instantly with an entry a previous run had walked
# away from, so it never saw "Waiting for an opponent". These pin the sweep
# that stops that, from both sides -- it must remove the ghost, and it must
# not touch anyone real.
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_an_abandoned_entry_stops_being_a_candidate(repos):
    """The ghost is not merely filtered out of one query -- it is expired.

    Asserted through `try_match` rather than by reading the row back, because
    "does the next joiner get paired with it" is the behaviour that matters.
    """
    mmr, rr = repos
    ghost = await mm.join_queue("ghost", "apex_1y", mmr, rr)
    ghost.joined_at -= mm.QUEUE_ENTRY_TTL * 2
    mmr._queue_entries[ghost.id].joined_at = ghost.joined_at

    live = await mm.join_queue("alice", "apex_1y", mmr, rr)
    assert await mm.try_match("apex_1y", live, mmr) is None, (
        "a joiner was paired with an abandoned entry"
    )
    assert mmr._queue_entries[ghost.id].status == "expired"


@pytest.mark.asyncio
async def test_the_sweep_leaves_a_genuinely_waiting_player_alone(repos):
    """The other half of the rule. A sweep that expired live entries would
    silently break the queue for everyone waiting longer than the interval
    between joins, which is most of them in a small population."""
    mmr, rr = repos
    waiting = await mm.join_queue("alice", "apex_1y", mmr, rr)
    later = await mm.join_queue("bob", "apex_1y", mmr, rr)

    assert mmr._queue_entries[waiting.id].status == "waiting"
    match = await mm.try_match("apex_1y", later, mmr)
    assert match is not None
    assert {p.owner_sub for p in await mmr.get_participants(match.id)} == {"alice", "bob"}


@pytest.mark.asyncio
async def test_the_sweep_is_scoped_to_one_queue(repos):
    """Modes are independent queues, so an apex_1y join must not expire a
    stale prime_3y entry as a side effect -- ratings and boards are per-mode
    and sweeping across them would be one queue's traffic silently clearing
    another's."""
    mmr, rr = repos
    stale_other = await mm.join_queue("ghost", "prime_3y", mmr, rr)
    mmr._queue_entries[stale_other.id].joined_at -= mm.QUEUE_ENTRY_TTL * 2

    await mm.join_queue("alice", "apex_1y", mmr, rr)
    assert mmr._queue_entries[stale_other.id].status == "waiting"

    await mm.join_queue("bob", "prime_3y", mmr, rr)
    assert mmr._queue_entries[stale_other.id].status == "expired"
