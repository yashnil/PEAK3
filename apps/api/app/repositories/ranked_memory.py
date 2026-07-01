"""In-memory ranked repositories — used in tests and local dev without DATABASE_URL.

Async methods do no real I/O but share the calling convention with the
Postgres implementation (see ranked_protocols.py's module docstring for why).
Concurrency primitives (asyncio.Lock) are used exactly where the Postgres
implementation uses row locks / transactions, so the same race conditions
(concurrent queue pairing, duplicate settlement) are genuinely exercised in
tests without a real database.
"""
from __future__ import annotations

import asyncio
import copy
import itertools
from datetime import datetime, timezone

from app.repositories.ranked_protocols import (
    AbortAllowance,
    ActiveQueueEntryExists,
    DuplicateLedgerEntry,
    DuplicateSettlement,
    IntegrityEvent,
    MatchParticipant,
    MatchSubmission,
    OpponentHistoryEntry,
    PlacementState,
    QueueEntry,
    QueueRating,
    RankedMatch,
    RankedSettlement,
    RatingLedgerEntry,
    RatingPeriod,
)
from app.services.ranked.versions import (
    GLICKO2_ALGORITHM_VERSION,
    GLICKO2_INITIAL_RATING,
    GLICKO2_INITIAL_RD,
    GLICKO2_INITIAL_VOLATILITY,
    RANKED_PLACEMENT_MATCH_COUNT,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _leaderboard_sort_key(r: QueueRating) -> tuple[float, float, int, str]:
    """Ranking key per spec section M: rating desc, RD asc, valid-match
    count desc (deterministic tie-break), owner_sub asc (pagination-only,
    never competitive).
    """
    return (-r.rating, r.rd, -r.valid_rated_matches, r.owner_sub)


class MemoryRankedMatchmakingRepository:
    def __init__(self) -> None:
        self._queue_entries: dict[str, QueueEntry] = {}
        self._matches: dict[str, RankedMatch] = {}
        self._participants: dict[str, dict[str, MatchParticipant]] = {}  # match_id -> owner_sub -> participant
        self._submissions: dict[str, dict[str, MatchSubmission]] = {}    # match_id -> owner_sub -> submission
        self._opponent_history: list[OpponentHistoryEntry] = []
        self._lock = asyncio.Lock()

    async def join_queue(self, entry: QueueEntry) -> QueueEntry:
        async with self._lock:
            existing = await self._active_entry_locked(entry.owner_sub, entry.mode)
            if existing is not None:
                raise ActiveQueueEntryExists(
                    f"{entry.owner_sub} already has an active entry in queue {entry.mode}"
                )
            self._queue_entries[entry.id] = copy.deepcopy(entry)
            return copy.deepcopy(entry)

    async def _active_entry_locked(self, owner_sub: str, mode: str) -> QueueEntry | None:
        for e in self._queue_entries.values():
            if e.owner_sub == owner_sub and e.mode == mode and e.status == "waiting":
                return e
        return None

    async def cancel_queue_entry(self, owner_sub: str, mode: str) -> bool:
        async with self._lock:
            entry = await self._active_entry_locked(owner_sub, mode)
            if entry is None:
                return False
            entry.status = "cancelled"
            entry.cancelled_at = _now()
            return True

    async def get_active_queue_entry(self, owner_sub: str, mode: str) -> QueueEntry | None:
        async with self._lock:
            entry = await self._active_entry_locked(owner_sub, mode)
            return copy.deepcopy(entry) if entry else None

    async def list_waiting_entries(self, mode: str, exclude_owner_sub: str) -> list[QueueEntry]:
        async with self._lock:
            return [
                copy.deepcopy(e)
                for e in self._queue_entries.values()
                if e.mode == mode and e.status == "waiting" and e.owner_sub != exclude_owner_sub
            ]

    async def recent_opponents(self, owner_sub: str, mode: str, since: datetime) -> set[str]:
        async with self._lock:
            return {
                h.opponent_sub
                for h in self._opponent_history
                if h.owner_sub == owner_sub and h.mode == mode and h.paired_at >= since
            }

    async def create_match_atomically(
        self,
        entry_a_id: str,
        entry_b_id: str,
        match: RankedMatch,
        participant_a: MatchParticipant,
        participant_b: MatchParticipant,
    ) -> RankedMatch | None:
        async with self._lock:
            entry_a = self._queue_entries.get(entry_a_id)
            entry_b = self._queue_entries.get(entry_b_id)
            if entry_a is None or entry_b is None:
                return None
            if entry_a.status != "waiting" or entry_b.status != "waiting":
                return None

            entry_a.status = "matched"
            entry_a.matched_at = _now()
            entry_a.match_id = match.id
            entry_b.status = "matched"
            entry_b.matched_at = _now()
            entry_b.match_id = match.id

            self._matches[match.id] = copy.deepcopy(match)
            self._participants[match.id] = {
                participant_a.owner_sub: copy.deepcopy(participant_a),
                participant_b.owner_sub: copy.deepcopy(participant_b),
            }
            self._submissions[match.id] = {}
            return copy.deepcopy(match)

    async def get_match(self, match_id: str) -> RankedMatch | None:
        m = self._matches.get(match_id)
        return copy.deepcopy(m) if m else None

    async def get_participants(self, match_id: str) -> list[MatchParticipant]:
        return [copy.deepcopy(p) for p in self._participants.get(match_id, {}).values()]

    async def get_participant(self, match_id: str, owner_sub: str) -> MatchParticipant | None:
        p = self._participants.get(match_id, {}).get(owner_sub)
        return copy.deepcopy(p) if p else None

    async def set_participant_game(self, match_id: str, owner_sub: str, game_id: str) -> None:
        p = self._participants[match_id][owner_sub]
        p.game_id = game_id

    async def set_participant_status(
        self, match_id: str, owner_sub: str, status: str, completed_at: datetime | None = None
    ) -> None:
        p = self._participants[match_id][owner_sub]
        p.status = status
        if completed_at is not None:
            p.completed_at = completed_at

    async def set_participant_post_match_rating(
        self, match_id: str, owner_sub: str, rating: float, rd: float, volatility: float
    ) -> None:
        p = self._participants[match_id][owner_sub]
        p.post_match_rating = rating
        p.post_match_rd = rd
        p.post_match_volatility = volatility

    async def record_submission(self, submission: MatchSubmission) -> MatchSubmission:
        async with self._lock:
            existing = self._submissions.setdefault(submission.match_id, {}).get(submission.owner_sub)
            if existing is not None and existing.idempotency_key == submission.idempotency_key:
                return copy.deepcopy(existing)
            if existing is not None:
                # Same user submitting again with a different key — no-op, return original.
                return copy.deepcopy(existing)
            self._submissions[submission.match_id][submission.owner_sub] = copy.deepcopy(submission)
            return copy.deepcopy(submission)

    async def get_submission(self, match_id: str, owner_sub: str) -> MatchSubmission | None:
        s = self._submissions.get(match_id, {}).get(owner_sub)
        return copy.deepcopy(s) if s else None

    async def list_submissions(self, match_id: str) -> list[MatchSubmission]:
        return [copy.deepcopy(s) for s in self._submissions.get(match_id, {}).values()]

    async def set_match_status(
        self,
        match_id: str,
        status: str,
        settlement_status: str | None = None,
        integrity_status: str | None = None,
    ) -> None:
        m = self._matches[match_id]
        m.status = status
        if settlement_status is not None:
            m.settlement_status = settlement_status
        if integrity_status is not None:
            m.integrity_status = integrity_status

    async def set_match_rating_period(self, match_id: str, rating_period_id: str) -> None:
        self._matches[match_id].rating_period_id = rating_period_id

    async def record_opponent_history(self, entry: OpponentHistoryEntry) -> None:
        self._opponent_history.append(copy.deepcopy(entry))

    async def list_active_matches_for_user(self, owner_sub: str) -> list[RankedMatch]:
        result = []
        for match_id, participants in self._participants.items():
            if owner_sub in participants:
                m = self._matches[match_id]
                if m.status not in ("settled", "cancelled", "expired", "invalidated"):
                    result.append(copy.deepcopy(m))
        return result

    async def count_pending_matches(self) -> int:
        return sum(
            1 for m in self._matches.values()
            if m.status not in ("settled", "cancelled", "expired", "invalidated")
        )


class MemoryRankedRatingRepository:
    def __init__(self) -> None:
        self._periods: dict[str, RatingPeriod] = {}
        self._settlements: dict[str, RankedSettlement] = {}
        self._ledger: list[RatingLedgerEntry] = []
        self._id_counter = itertools.count(1)
        self._queue_ratings: dict[tuple[str, str], QueueRating] = {}
        self._placement_states: dict[tuple[str, str], PlacementState] = {}
        self._lock = asyncio.Lock()

    async def create_rating_period(self, period: RatingPeriod) -> RatingPeriod:
        self._periods[period.id] = copy.deepcopy(period)
        return copy.deepcopy(period)

    async def create_settlement(self, settlement: RankedSettlement) -> RankedSettlement:
        async with self._lock:
            if settlement.match_id in self._settlements:
                raise DuplicateSettlement(f"match {settlement.match_id} is already settled")
            self._settlements[settlement.match_id] = copy.deepcopy(settlement)
            return copy.deepcopy(settlement)

    async def get_settlement(self, match_id: str) -> RankedSettlement | None:
        s = self._settlements.get(match_id)
        return copy.deepcopy(s) if s else None

    async def commit_settlement(
        self,
        period: RatingPeriod,
        settlement: RankedSettlement,
        ledger_entries: list[RatingLedgerEntry],
        queue_ratings: list[QueueRating],
        placement_states: list[PlacementState],
    ) -> RankedSettlement:
        async with self._lock:
            if settlement.match_id in self._settlements:
                raise DuplicateSettlement(f"match {settlement.match_id} is already settled")

            self._periods[period.id] = copy.deepcopy(period)
            self._settlements[settlement.match_id] = copy.deepcopy(settlement)

            for entry in ledger_entries:
                new_entry = copy.deepcopy(entry)
                new_entry.id = next(self._id_counter)
                self._ledger.append(new_entry)

            for rating in queue_ratings:
                rating.updated_at = _now()
                self._queue_ratings[(rating.owner_sub, rating.mode)] = copy.deepcopy(rating)

            for state in placement_states:
                self._placement_states[(state.owner_sub, state.mode)] = copy.deepcopy(state)

            return copy.deepcopy(settlement)

    async def get_queue_rating(self, owner_sub: str, mode: str) -> QueueRating:
        key = (owner_sub, mode)
        if key not in self._queue_ratings:
            self._queue_ratings[key] = QueueRating(
                owner_sub=owner_sub,
                mode=mode,
                rating=GLICKO2_INITIAL_RATING,
                rd=GLICKO2_INITIAL_RD,
                volatility=GLICKO2_INITIAL_VOLATILITY,
                algorithm_version=GLICKO2_ALGORITHM_VERSION,
                valid_rated_matches=0,
                established=False,
                updated_at=_now(),
            )
        return copy.deepcopy(self._queue_ratings[key])

    async def append_ledger_entry(self, entry: RatingLedgerEntry) -> RatingLedgerEntry:
        async with self._lock:
            if entry.entry_type == "settlement":
                for existing in self._ledger:
                    if (
                        existing.entry_type == "settlement"
                        and existing.owner_sub == entry.owner_sub
                        and existing.match_id == entry.match_id
                    ):
                        raise DuplicateLedgerEntry(
                            f"settlement ledger entry already exists for {entry.owner_sub}/{entry.match_id}"
                        )
            new_entry = copy.deepcopy(entry)
            new_entry.id = next(self._id_counter)
            self._ledger.append(new_entry)
            return copy.deepcopy(new_entry)

    async def list_ledger_entries(self, owner_sub: str, mode: str) -> list[RatingLedgerEntry]:
        return sorted(
            (copy.deepcopy(e) for e in self._ledger if e.owner_sub == owner_sub and e.mode == mode),
            key=lambda e: e.id,
        )

    async def list_all_ledger_entries(self, mode: str) -> list[RatingLedgerEntry]:
        return sorted(
            (copy.deepcopy(e) for e in self._ledger if e.mode == mode),
            key=lambda e: e.id,
        )

    async def update_queue_rating(self, rating: QueueRating) -> None:
        rating.updated_at = _now()
        self._queue_ratings[(rating.owner_sub, rating.mode)] = copy.deepcopy(rating)

    async def get_placement_state(self, owner_sub: str, mode: str) -> PlacementState:
        key = (owner_sub, mode)
        if key not in self._placement_states:
            self._placement_states[key] = PlacementState(
                owner_sub=owner_sub,
                mode=mode,
                valid_matches_completed=0,
                required_matches=RANKED_PLACEMENT_MATCH_COUNT,
                established=False,
            )
        return copy.deepcopy(self._placement_states[key])

    async def update_placement_state(self, state: PlacementState) -> None:
        self._placement_states[(state.owner_sub, state.mode)] = copy.deepcopy(state)

    async def get_leaderboard(
        self, mode: str, limit: int, after: tuple[float, float, int, str] | None
    ) -> list[QueueRating]:
        # Ranking key per spec section M: (1) rating desc, (2) RD asc,
        # (3) deterministic valid-match tie-break, (4) owner_sub as a final,
        # non-competitive pagination-stability key.
        ratings = [
            copy.deepcopy(r) for (owner_sub, m), r in self._queue_ratings.items() if m == mode
        ]
        ratings.sort(key=_leaderboard_sort_key)
        if after is not None:
            after_rating, after_rd, after_valid_matches, after_owner_sub = after
            cursor_key = (-after_rating, after_rd, -after_valid_matches, after_owner_sub)
            ratings = [r for r in ratings if _leaderboard_sort_key(r) > cursor_key]
        return ratings[:limit]

    async def count_pending_settlements(self) -> int:
        return 0  # memory impl settles synchronously; nothing is ever left pending

    async def last_settlement_time(self) -> datetime | None:
        if not self._settlements:
            return None
        return max(s.created_at for s in self._settlements.values())

    async def count_settled_matches(self, mode: str) -> int:
        return sum(
            1 for s in self._settlements.values()
            if any(p.mode == mode for p in self._periods.values() if p.id == s.rating_period_id)
        )


class MemoryRankedIntegrityRepository:
    def __init__(self) -> None:
        self._events: list[IntegrityEvent] = []
        self._allowances: list[AbortAllowance] = []

    async def record_integrity_event(self, event: IntegrityEvent) -> IntegrityEvent:
        self._events.append(copy.deepcopy(event))
        return copy.deepcopy(event)

    async def list_integrity_events(
        self, owner_sub: str | None = None, match_id: str | None = None
    ) -> list[IntegrityEvent]:
        result = self._events
        if owner_sub is not None:
            result = [e for e in result if e.owner_sub == owner_sub]
        if match_id is not None:
            result = [e for e in result if e.match_id == match_id]
        return [copy.deepcopy(e) for e in result]

    async def has_unresolved_integrity(self, owner_sub: str) -> bool:
        return any(
            e.owner_sub == owner_sub and e.resolved_at is None and e.severity == "severe"
            for e in self._events
        )

    async def grant_abort_allowance(self, allowance: AbortAllowance) -> AbortAllowance:
        self._allowances.append(copy.deepcopy(allowance))
        return copy.deepcopy(allowance)

    async def consume_abort_allowance(self, owner_sub: str, match_id: str) -> bool:
        for a in self._allowances:
            if a.owner_sub == owner_sub and a.consumed_at is None and (a.match_id is None or a.match_id == match_id):
                a.consumed_at = _now()
                return True
        return False
