"""PostgreSQL progression repository implementations.

These are placeholders for when DATABASE_URL is configured in production.
The async asyncpg pool is provided by app.state.db_pool.

Full SQL implementation follows the same patterns as postgres.py.
The in-memory implementations (memory_progression.py) are functionally
complete for all tests and development usage.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from app.repositories.progression_protocols import (
    AchievementAward,
    AchievementRepository,
    PersonalRecord,
    PersonalRecordEvent,
    PersonalRecordRepository,
    ProgressionEvent,
    ProgressionRepository,
    StreakEvent,
    StreakRepository,
    StreakState,
    UserProgress,
)


class PostgresProgressionRepository:
    def __init__(self, pool) -> None:
        self._pool = pool

    def record_event(self, event: ProgressionEvent) -> None:
        raise NotImplementedError("PostgresProgressionRepository requires async context")

    def get_event_by_idempotency_key(self, key: str) -> Optional[ProgressionEvent]:
        raise NotImplementedError

    def list_events(self, owner_sub: str, limit: int = 50, before_id: Optional[str] = None) -> list[ProgressionEvent]:
        raise NotImplementedError

    def get_events_in_window(self, owner_sub: str, event_type: str, after: datetime, before: datetime) -> list[ProgressionEvent]:
        raise NotImplementedError

    def upsert_progress(self, progress: UserProgress) -> None:
        raise NotImplementedError

    def get_progress(self, owner_sub: str) -> Optional[UserProgress]:
        raise NotImplementedError

    def transfer_events(self, from_sub: str, to_sub: str) -> int:
        raise NotImplementedError


class PostgresPersonalRecordRepository:
    def __init__(self, pool) -> None:
        self._pool = pool

    def upsert_record(self, record: PersonalRecord) -> None:
        raise NotImplementedError

    def get_record(self, owner_sub: str, record_type: str, mode: str, lmv: str, cpv: str, rv: str) -> Optional[PersonalRecord]:
        raise NotImplementedError

    def list_records(self, owner_sub: str) -> list[PersonalRecord]:
        raise NotImplementedError

    def record_event(self, event: PersonalRecordEvent) -> None:
        raise NotImplementedError

    def transfer_records(self, from_sub: str, to_sub: str) -> int:
        raise NotImplementedError


class PostgresAchievementRepository:
    def __init__(self, pool) -> None:
        self._pool = pool

    def award_achievement(self, award: AchievementAward) -> bool:
        raise NotImplementedError

    def get_award(self, owner_sub: str, achievement_key: str) -> Optional[AchievementAward]:
        raise NotImplementedError

    def list_awards(self, owner_sub: str) -> list[AchievementAward]:
        raise NotImplementedError

    def transfer_awards(self, from_sub: str, to_sub: str) -> int:
        raise NotImplementedError


class PostgresStreakRepository:
    def __init__(self, pool) -> None:
        self._pool = pool

    def get_streak(self, owner_sub: str) -> Optional[StreakState]:
        raise NotImplementedError

    def save_streak(self, state: StreakState) -> None:
        raise NotImplementedError

    def record_streak_event(self, event: StreakEvent) -> None:
        raise NotImplementedError

    def list_streak_events(self, owner_sub: str, limit: int = 50) -> list[StreakEvent]:
        raise NotImplementedError

    def transfer_streak(self, from_sub: str, to_sub: str) -> bool:
        raise NotImplementedError
