"""Persistence interface protocols for Phase 4.0 ranked duels.

Grouped into three domains (mirrors infra/migrations/011-015):
  - RankedMatchmakingRepository: queue entries, matches, participants,
    submissions, opponent history
  - RankedRatingRepository: rating periods, settlements, the append-only
    ledger, queue ratings, placement state
  - RankedIntegrityRepository: integrity events, abort allowances

Design note — async throughout: the existing GameRepository/ChallengeRepository
protocols (protocols.py) declare synchronous methods even though
PostgresGameRepository (postgres.py) implements them with `async def`, and
existing call sites (e.g. app/api/v1/history.py) call them without `await`.
That mismatch was found while building this module (see the Phase 4.0 report's
preflight findings) and would silently return unawaited coroutines under a
real database. Ranked repositories are declared `async def` end-to-end here —
including the in-memory implementation, which does no real I/O but keeps one
calling convention — specifically to avoid reproducing that bug.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol, runtime_checkable


# ---------------------------------------------------------------------------
# Value objects
# ---------------------------------------------------------------------------


@dataclass
class QueueEntry:
    id: str
    owner_sub: str
    mode: str
    queue_version: str
    rating_snapshot: float
    rd_snapshot: float
    volatility_snapshot: float
    placement_state: str          # 'placement' | 'established'
    status: str                   # 'waiting' | 'matched' | 'cancelled' | 'expired'
    joined_at: datetime
    search_range_rating: float
    matched_at: datetime | None = None
    cancelled_at: datetime | None = None
    match_id: str | None = None


@dataclass
class RankedMatch:
    id: str
    mode: str
    queue_version: str
    board_snapshot: dict
    board_version_key: str
    rating_algorithm_version: str
    abandonment_policy_version: str
    created_at: datetime
    matched_at: datetime
    deadline: datetime
    status: str
    settlement_status: str
    integrity_status: str
    rating_period_id: str | None = None


@dataclass
class MatchParticipant:
    id: str
    match_id: str
    owner_sub: str
    slot: int
    status: str
    joined_at: datetime
    pre_match_rating: float
    pre_match_rd: float
    pre_match_volatility: float
    game_id: str | None = None
    completed_at: datetime | None = None
    abandonment_state: str = "none"
    post_match_rating: float | None = None
    post_match_rd: float | None = None
    post_match_volatility: float | None = None


@dataclass
class MatchSubmission:
    id: str
    match_id: str
    participant_id: str
    owner_sub: str
    game_id: str
    board_version_key: str
    lineup_evaluation: dict
    solver_version: str
    submitted_at: datetime
    idempotency_key: str


@dataclass
class RatingPeriod:
    id: str
    mode: str
    queue_version: str
    match_id: str
    algorithm_version: str
    opened_at: datetime
    closed_at: datetime | None = None


@dataclass
class RankedSettlement:
    id: str
    match_id: str
    rating_period_id: str
    settlement_algorithm_version: str
    board_version_key: str
    participant_a_sub: str
    participant_b_sub: str
    participant_a_score: float
    participant_b_score: float
    participant_a_solver_version: str
    participant_b_solver_version: str
    outcome: str                     # 'a_win' | 'b_win' | 'draw'
    created_at: datetime
    primary_comparison: str = "lineup_peak_rating"
    participant_a_draft_efficiency: float | None = None
    participant_b_draft_efficiency: float | None = None
    tie_break_used: str | None = None   # 'draft_efficiency' | 'forced_placements' | None
    integrity_decision: str = "clear"
    audit_metadata: dict = field(default_factory=dict)


@dataclass
class RatingLedgerEntry:
    owner_sub: str
    mode: str
    match_id: str
    rating_period_id: str
    pre_rating: float
    pre_rd: float
    pre_volatility: float
    opponent_sub: str
    opponent_pre_rating: float
    opponent_pre_rd: float
    opponent_pre_volatility: float
    outcome: float                 # 1.0 | 0.5 | 0.0
    post_rating: float
    post_rd: float
    post_volatility: float
    algorithm_version: str
    created_at: datetime
    id: int | None = None          # assigned by the repository (immutable sequence)
    entry_type: str = "settlement"  # 'settlement' | 'reversal' | 'inactivity_rd_adjustment'
    reversal_of_entry_id: int | None = None
    reversal_reason: str | None = None


@dataclass
class QueueRating:
    owner_sub: str
    mode: str
    rating: float
    rd: float
    volatility: float
    algorithm_version: str
    valid_rated_matches: int = 0
    established: bool = False
    last_rated_activity_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass
class PlacementState:
    owner_sub: str
    mode: str
    valid_matches_completed: int = 0
    required_matches: int = 7
    established: bool = False
    established_at: datetime | None = None


@dataclass
class OpponentHistoryEntry:
    owner_sub: str
    opponent_sub: str
    mode: str
    match_id: str
    paired_at: datetime


@dataclass
class IntegrityEvent:
    id: str
    event_type: str
    severity: str
    details: dict
    created_at: datetime
    match_id: str | None = None
    owner_sub: str | None = None
    resolved_at: datetime | None = None
    resolution: str | None = None


@dataclass
class AbortAllowance:
    id: str
    owner_sub: str
    granted_at: datetime
    reason: str
    mode: str | None = None
    match_id: str | None = None
    granted_by: str = "service"
    consumed_at: datetime | None = None


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class RankedRepositoryError(RuntimeError):
    """Base class for ranked repository invariant violations."""


class ActiveQueueEntryExists(RankedRepositoryError):
    """Raised when a user tries to join a queue they already have an active entry in."""


class DuplicateSettlement(RankedRepositoryError):
    """Raised when a match already has a settlement recorded."""


class DuplicateLedgerEntry(RankedRepositoryError):
    """Raised when a (owner_sub, match_id) settlement ledger entry already exists."""


# ---------------------------------------------------------------------------
# Repository protocols
# ---------------------------------------------------------------------------


@runtime_checkable
class RankedMatchmakingRepository(Protocol):
    async def join_queue(self, entry: QueueEntry) -> QueueEntry: ...
    async def cancel_queue_entry(self, owner_sub: str, mode: str) -> bool: ...
    async def get_active_queue_entry(self, owner_sub: str, mode: str) -> QueueEntry | None: ...
    async def list_waiting_entries(self, mode: str, exclude_owner_sub: str) -> list[QueueEntry]: ...
    async def recent_opponents(self, owner_sub: str, mode: str, since: datetime) -> set[str]: ...

    async def create_match_atomically(
        self,
        entry_a_id: str,
        entry_b_id: str,
        match: RankedMatch,
        participant_a: MatchParticipant,
        participant_b: MatchParticipant,
    ) -> RankedMatch | None:
        """Attempt to pair two waiting queue entries into a match.

        Returns the created match, or None if either entry was no longer
        'waiting' by the time this executed (i.e. a concurrent pairing
        attempt already claimed one of them). Must be atomic: entries are
        consumed and the match+participants are created in one transaction.
        """
        ...

    async def get_match(self, match_id: str) -> RankedMatch | None: ...
    async def get_participants(self, match_id: str) -> list[MatchParticipant]: ...
    async def get_participant(self, match_id: str, owner_sub: str) -> MatchParticipant | None: ...
    async def set_participant_game(self, match_id: str, owner_sub: str, game_id: str) -> None: ...

    async def set_participant_status(
        self, match_id: str, owner_sub: str, status: str, completed_at: datetime | None = None
    ) -> None: ...

    async def set_participant_post_match_rating(
        self, match_id: str, owner_sub: str, rating: float, rd: float, volatility: float
    ) -> None: ...

    async def record_submission(self, submission: MatchSubmission) -> MatchSubmission:
        """Idempotent on (match_id, idempotency_key): a retried identical
        submission returns the original row rather than erroring or duplicating.
        """
        ...

    async def get_submission(self, match_id: str, owner_sub: str) -> MatchSubmission | None: ...
    async def list_submissions(self, match_id: str) -> list[MatchSubmission]: ...

    async def set_match_status(
        self,
        match_id: str,
        status: str,
        settlement_status: str | None = None,
        integrity_status: str | None = None,
    ) -> None: ...

    async def set_match_rating_period(self, match_id: str, rating_period_id: str) -> None: ...
    async def record_opponent_history(self, entry: OpponentHistoryEntry) -> None: ...
    async def list_active_matches_for_user(self, owner_sub: str) -> list[RankedMatch]: ...
    async def count_pending_matches(self) -> int: ...


@runtime_checkable
class RankedRatingRepository(Protocol):
    async def create_rating_period(self, period: RatingPeriod) -> RatingPeriod: ...
    async def create_settlement(self, settlement: RankedSettlement) -> RankedSettlement: ...
    async def get_settlement(self, match_id: str) -> RankedSettlement | None: ...

    async def commit_settlement(
        self,
        period: RatingPeriod,
        settlement: RankedSettlement,
        ledger_entries: list[RatingLedgerEntry],
        queue_ratings: list[QueueRating],
        placement_states: list[PlacementState],
    ) -> RankedSettlement:
        """Write the rating period, settlement, both ledger entries, both
        updated queue ratings, and both updated placement states in one
        transaction. Raises DuplicateSettlement if the match is already
        settled (idempotent retry safety) rather than partially applying.
        """
        ...

    async def get_queue_rating(self, owner_sub: str, mode: str) -> QueueRating:
        """Returns the current rating, creating the initial default row on
        first access (rating/RD/volatility from GLICKO2_INITIAL_*).
        """
        ...

    async def append_ledger_entry(self, entry: RatingLedgerEntry) -> RatingLedgerEntry: ...
    async def list_ledger_entries(self, owner_sub: str, mode: str) -> list[RatingLedgerEntry]: ...
    async def list_all_ledger_entries(self, mode: str) -> list[RatingLedgerEntry]: ...
    async def update_queue_rating(self, rating: QueueRating) -> None: ...
    async def get_placement_state(self, owner_sub: str, mode: str) -> PlacementState: ...
    async def update_placement_state(self, state: PlacementState) -> None: ...

    async def get_leaderboard(
        self, mode: str, limit: int, after: tuple[float, float, int, str] | None
    ) -> list[QueueRating]:
        """``after``, when given, is the full sort key of the last row on the
        previous page: (rating, rd, valid_rated_matches, owner_sub). Ranking
        order is (rating desc, rd asc, valid_rated_matches desc, owner_sub
        asc) per spec section M — passing only ``rating``+``owner_sub``
        (dropping rd/valid_rated_matches) previously caused the cursor's
        own row to be re-included on the next page whenever two rows shared
        the same rating; encoding the full key here is what makes pages
        genuinely disjoint.
        """
        ...

    async def count_pending_settlements(self) -> int: ...
    async def last_settlement_time(self) -> datetime | None: ...
    async def count_settled_matches(self, mode: str) -> int: ...


@runtime_checkable
class RankedIntegrityRepository(Protocol):
    async def record_integrity_event(self, event: IntegrityEvent) -> IntegrityEvent: ...
    async def list_integrity_events(
        self, owner_sub: str | None = None, match_id: str | None = None
    ) -> list[IntegrityEvent]: ...
    async def has_unresolved_integrity(self, owner_sub: str) -> bool: ...
    async def grant_abort_allowance(self, allowance: AbortAllowance) -> AbortAllowance: ...
    async def consume_abort_allowance(self, owner_sub: str, match_id: str) -> bool: ...
