"""Ranked matchmaking (ADR-004 §2, §13; spec section F).

Asynchronous queue: joining creates a durable ranked_queue_entries row.
Pairing is attempted synchronously right after a join (no separate worker
process in closed alpha — population is small enough that this is
sufficient, and it keeps the concurrency story simple: the only race is two
requests attempting to pair the same waiting entry, which
``create_match_atomically``'s row-locking/SKIP LOCKED handles).

Matching inputs: queue, rating, RD/placement state, wait time, recent
opponent history, queue-version compatibility. Never: XP, level, streak,
achievements, payment, Daily activity, or any hidden handicap (ADR-004,
non-negotiable separation).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from app.repositories.ranked_protocols import (
    MatchParticipant,
    OpponentHistoryEntry,
    QueueEntry,
    RankedMatch,
    RankedMatchmakingRepository,
    RankedRatingRepository,
)
from app.services.ranked.board import (
    board_to_dict,
    generate_ranked_board,
    ranked_board_version_key,
)
from app.services.ranked.versions import (
    GLICKO2_ALGORITHM_VERSION,
    RANKED_QUEUE_MODES,
    RANKED_QUEUE_VERSION,
)

# Matchmaking parameters (closed-alpha values; would move into
# ranked_queue_versions.matchmaking_params for a production release with a
# real matchmaking-tuning workflow).
BASE_SEARCH_RANGE = 100.0
SEARCH_RANGE_GROWTH_PER_SECOND = 5.0
MAX_SEARCH_RANGE = 1000.0
REPEAT_OPPONENT_WINDOW = timedelta(hours=2)
MATCH_DEADLINE = timedelta(hours=48)


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def join_queue(
    owner_sub: str,
    mode: str,
    matchmaking_repo: RankedMatchmakingRepository,
    rating_repo: RankedRatingRepository,
) -> QueueEntry:
    if mode not in RANKED_QUEUE_MODES:
        raise ValueError(f"Unknown ranked mode '{mode}'")

    rating = await rating_repo.get_queue_rating(owner_sub, mode)
    placement = await rating_repo.get_placement_state(owner_sub, mode)

    entry = QueueEntry(
        id=str(uuid.uuid4()),
        owner_sub=owner_sub,
        mode=mode,
        queue_version=RANKED_QUEUE_VERSION,
        rating_snapshot=rating.rating,
        rd_snapshot=rating.rd,
        volatility_snapshot=rating.volatility,
        placement_state="established" if placement.established else "placement",
        status="waiting",
        joined_at=_now(),
        search_range_rating=BASE_SEARCH_RANGE,
    )
    return await matchmaking_repo.join_queue(entry)


async def cancel_queue(
    owner_sub: str, mode: str, matchmaking_repo: RankedMatchmakingRepository
) -> bool:
    return await matchmaking_repo.cancel_queue_entry(owner_sub, mode)


def _search_range(entry: QueueEntry, now: datetime) -> float:
    elapsed = max(0.0, (now - entry.joined_at).total_seconds())
    return min(MAX_SEARCH_RANGE, BASE_SEARCH_RANGE + SEARCH_RANGE_GROWTH_PER_SECOND * elapsed)


def _compatible(a: QueueEntry, b: QueueEntry, now: datetime) -> bool:
    # Placement-state entries match broadly regardless of rating range
    # (spec F: "allow broad placement matching").
    if a.placement_state == "placement" or b.placement_state == "placement":
        return True
    allowed_range = max(_search_range(a, now), _search_range(b, now))
    return abs(a.rating_snapshot - b.rating_snapshot) <= allowed_range


async def try_match(
    mode: str,
    entry: QueueEntry,
    matchmaking_repo: RankedMatchmakingRepository,
) -> RankedMatch | None:
    """Attempt to pair ``entry`` (just joined) with a compatible waiting
    opponent. Returns the created match, or None if no compatible opponent
    is currently waiting (entry remains in the queue).
    """
    now = _now()
    candidates = await matchmaking_repo.list_waiting_entries(mode, exclude_owner_sub=entry.owner_sub)
    if not candidates:
        return None

    recent = await matchmaking_repo.recent_opponents(entry.owner_sub, mode, since=now - REPEAT_OPPONENT_WINDOW)

    compatible = [c for c in candidates if _compatible(entry, c, now)]
    if not compatible:
        return None

    # Prefer opponents not faced recently; fall back to allowing a repeat if
    # that is the only option (small alpha population — spec F: cap repeats
    # but do not block matching entirely).
    non_repeat = [c for c in compatible if c.owner_sub not in recent]
    pool = non_repeat if non_repeat else compatible
    # Longest-waiting compatible candidate first (fairness).
    pool.sort(key=lambda c: c.joined_at)

    for candidate in pool:
        match = await _create_match(mode, entry, candidate, matchmaking_repo)
        if match is not None:
            return match
        # Lost the race (candidate was claimed concurrently) — try the next one.
    return None


async def _create_match(
    mode: str,
    entry_a: QueueEntry,
    entry_b: QueueEntry,
    matchmaking_repo: RankedMatchmakingRepository,
) -> RankedMatch | None:
    match_id = str(uuid.uuid4())
    board = generate_ranked_board(mode, match_id)
    now = _now()

    match = RankedMatch(
        id=match_id,
        mode=mode,
        queue_version=RANKED_QUEUE_VERSION,
        board_snapshot=board_to_dict(board),
        board_version_key=ranked_board_version_key(board),
        rating_algorithm_version=GLICKO2_ALGORITHM_VERSION,
        abandonment_policy_version="ranked_abandon_policy_v1",
        created_at=now,
        matched_at=now,
        deadline=now + MATCH_DEADLINE,
        status="matched",
        settlement_status="pending",
        integrity_status="clear",
    )
    participant_a = MatchParticipant(
        id=str(uuid.uuid4()), match_id=match_id, owner_sub=entry_a.owner_sub, slot=0,
        status="board_ready", joined_at=now,
        pre_match_rating=entry_a.rating_snapshot, pre_match_rd=entry_a.rd_snapshot,
        pre_match_volatility=entry_a.volatility_snapshot,
    )
    participant_b = MatchParticipant(
        id=str(uuid.uuid4()), match_id=match_id, owner_sub=entry_b.owner_sub, slot=1,
        status="board_ready", joined_at=now,
        pre_match_rating=entry_b.rating_snapshot, pre_match_rd=entry_b.rd_snapshot,
        pre_match_volatility=entry_b.volatility_snapshot,
    )

    created = await matchmaking_repo.create_match_atomically(
        entry_a.id, entry_b.id, match, participant_a, participant_b
    )
    if created is None:
        return None

    await matchmaking_repo.record_opponent_history(
        OpponentHistoryEntry(owner_sub=entry_a.owner_sub, opponent_sub=entry_b.owner_sub, mode=mode, match_id=match_id, paired_at=now)
    )
    await matchmaking_repo.record_opponent_history(
        OpponentHistoryEntry(owner_sub=entry_b.owner_sub, opponent_sub=entry_a.owner_sub, mode=mode, match_id=match_id, paired_at=now)
    )
    return created


__all__ = ["cancel_queue", "join_queue", "try_match"]
