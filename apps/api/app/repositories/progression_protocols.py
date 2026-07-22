"""Repository protocols for Phase 3.1 progression tables.

Structural subtypes (typing.Protocol) — implementations in
memory_progression.py (tests/dev) and postgres_progression.py (production).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional, Protocol, runtime_checkable


# ---------------------------------------------------------------------------
# Value objects
# ---------------------------------------------------------------------------


@dataclass
class ProgressionEvent:
    """One XP-bearing progression event."""
    id: str
    owner_sub: str
    event_type: str
    source_type: str
    source_id: str
    idempotency_key: str
    policy_version: str
    xp_amount: int
    occurred_at: datetime
    awarded_at: datetime
    metadata: dict = field(default_factory=dict)
    original_owner_sub: Optional[str] = None


@dataclass
class UserProgress:
    """Server-calculated progression aggregate."""
    owner_sub: str
    total_xp: int
    current_level: int
    policy_version: str
    last_progression_at: Optional[datetime]


@dataclass
class PersonalRecord:
    """Current personal best for one (owner, record_type, mode, version_tuple)."""
    id: str
    owner_sub: str
    record_type: str
    mode: str
    lineup_model_version: str
    card_pool_version: str
    ruleset_version: str
    record_value: float
    higher_is_better: bool
    source_result_id: str
    achieved_at: datetime
    previous_record_id: Optional[str] = None


@dataclass
class PersonalRecordEvent:
    """History entry when a record is broken."""
    id: str
    owner_sub: str
    record_type: str
    mode: str
    lineup_model_version: str
    card_pool_version: str
    ruleset_version: str
    new_value: float
    previous_value: Optional[float]
    source_result_id: str
    occurred_at: datetime
    original_owner_sub: Optional[str] = None


@dataclass
class AchievementAward:
    """A single achievement awarded to a user."""
    id: str
    owner_sub: str
    achievement_key: str
    source_type: str
    source_id: str
    awarded_at: datetime
    original_owner_sub: Optional[str] = None


@dataclass
class StreakState:
    """Active streak state for one user."""
    owner_sub: str
    policy_version: str
    current_streak: int
    longest_streak: int
    last_qualifying_date: Optional[date]
    last_qualifying_tz: str
    reserve_count: int
    reserve_cap: int
    last_reserve_earned_at: Optional[datetime]


@dataclass
class StreakEvent:
    """Append-only history of streak transitions."""
    id: str
    owner_sub: str
    event_type: str   # increment|same_day|reserve_consumed|reset|reserve_earned|initialized
    local_date: date
    tz_used: str
    streak_before: int
    streak_after: int
    reserve_before: int
    reserve_after: int
    source_type: Optional[str]
    source_id: Optional[str]
    occurred_at: datetime
    original_owner_sub: Optional[str] = None


# ---------------------------------------------------------------------------
# Repository protocols
# ---------------------------------------------------------------------------


@runtime_checkable
class ProgressionRepository(Protocol):
    """Async throughout — see repositories/protocols.py's GameRepository
    docstring for why (Postgres is inherently async via asyncpg; previously
    this Protocol was sync-declared while postgres_progression.py's methods
    all raised NotImplementedError, so the mismatch never surfaced).
    """

    async def record_event(self, event: ProgressionEvent) -> None: ...
    async def get_event_by_idempotency_key(self, key: str) -> Optional[ProgressionEvent]: ...
    async def list_events(
        self, owner_sub: str, limit: int = 50, before_id: Optional[str] = None
    ) -> list[ProgressionEvent]: ...
    async def get_events_in_window(
        self, owner_sub: str, event_type: str, after: datetime, before: datetime
    ) -> list[ProgressionEvent]: ...
    async def upsert_progress(self, progress: UserProgress) -> None: ...
    async def get_progress(self, owner_sub: str) -> Optional[UserProgress]: ...
    # Claim migration
    async def transfer_events(self, from_sub: str, to_sub: str) -> int: ...


@runtime_checkable
class PersonalRecordRepository(Protocol):
    async def upsert_record(self, record: PersonalRecord) -> None: ...
    async def get_record(
        self, owner_sub: str, record_type: str, mode: str,
        lmv: str, cpv: str, rv: str,
    ) -> Optional[PersonalRecord]: ...
    async def list_records(self, owner_sub: str) -> list[PersonalRecord]: ...
    async def record_event(self, event: PersonalRecordEvent) -> None: ...
    async def transfer_records(self, from_sub: str, to_sub: str) -> int: ...


@runtime_checkable
class AchievementRepository(Protocol):
    async def award_achievement(self, award: AchievementAward) -> bool: ...  # False if already awarded
    async def get_award(self, owner_sub: str, achievement_key: str) -> Optional[AchievementAward]: ...
    async def list_awards(self, owner_sub: str) -> list[AchievementAward]: ...
    async def transfer_awards(self, from_sub: str, to_sub: str) -> int: ...


@runtime_checkable
class StreakRepository(Protocol):
    async def get_streak(self, owner_sub: str) -> Optional[StreakState]: ...
    async def save_streak(self, state: StreakState) -> None: ...
    async def record_streak_event(self, event: StreakEvent) -> None: ...
    async def list_streak_events(
        self, owner_sub: str, limit: int = 50
    ) -> list[StreakEvent]: ...
    async def transfer_streak(self, from_sub: str, to_sub: str) -> bool: ...
