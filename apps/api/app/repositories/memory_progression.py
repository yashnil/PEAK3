"""In-memory progression repository implementations — dev/test fallback.

These must NEVER be used in production when DATABASE_URL is set.
All stores are module-level singletons so tests share state within a session
unless explicitly reset.
"""
from __future__ import annotations

import threading
from copy import deepcopy
from datetime import date, datetime
from typing import Optional

from .progression_protocols import (
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


class MemoryProgressionRepository:
    """Thread-safe in-memory progression event + user_progress store."""

    def __init__(self) -> None:
        self._events: dict[str, ProgressionEvent] = {}           # id → event
        self._idem_index: dict[str, str] = {}                    # idempotency_key → id
        self._progress: dict[str, UserProgress] = {}             # owner_sub → progress
        self._lock = threading.Lock()

    async def record_event(self, event: ProgressionEvent) -> None:
        with self._lock:
            if event.idempotency_key in self._idem_index:
                return  # idempotent: already recorded
            self._events[event.id] = deepcopy(event)
            self._idem_index[event.idempotency_key] = event.id

    async def get_event_by_idempotency_key(self, key: str) -> Optional[ProgressionEvent]:
        with self._lock:
            eid = self._idem_index.get(key)
            if eid is None:
                return None
            return deepcopy(self._events[eid])

    async def list_events(
        self, owner_sub: str, limit: int = 50, before_id: Optional[str] = None
    ) -> list[ProgressionEvent]:
        with self._lock:
            results = [
                deepcopy(e) for e in self._events.values()
                if e.owner_sub == owner_sub
            ]
        results.sort(key=lambda e: e.occurred_at, reverse=True)
        if before_id:
            try:
                idx = next(i for i, e in enumerate(results) if e.id == before_id)
                results = results[idx + 1:]
            except StopIteration:
                pass
        return results[:limit]

    async def get_events_in_window(
        self, owner_sub: str, event_type: str, after: datetime, before: datetime
    ) -> list[ProgressionEvent]:
        with self._lock:
            return [
                deepcopy(e) for e in self._events.values()
                if e.owner_sub == owner_sub
                and e.event_type == event_type
                and after <= e.occurred_at <= before
            ]

    async def upsert_progress(self, progress: UserProgress) -> None:
        with self._lock:
            self._progress[progress.owner_sub] = deepcopy(progress)

    async def get_progress(self, owner_sub: str) -> Optional[UserProgress]:
        with self._lock:
            p = self._progress.get(owner_sub)
            return deepcopy(p) if p else None

    async def transfer_events(self, from_sub: str, to_sub: str) -> int:
        count = 0
        with self._lock:
            to_update = [e for e in self._events.values() if e.owner_sub == from_sub]
            for e in to_update:
                e.original_owner_sub = e.original_owner_sub or from_sub
                e.owner_sub = to_sub
                count += 1
        return count


class MemoryPersonalRecordRepository:
    """Thread-safe in-memory personal record store."""

    def __init__(self) -> None:
        self._records: dict[str, PersonalRecord] = {}   # composite key → record
        self._events: list[PersonalRecordEvent] = []
        self._lock = threading.Lock()

    def _key(self, owner_sub: str, record_type: str, mode: str,
             lmv: str, cpv: str, rv: str) -> str:
        return f"{owner_sub}:{record_type}:{mode}:{lmv}:{cpv}:{rv}"

    async def upsert_record(self, record: PersonalRecord) -> None:
        k = self._key(
            record.owner_sub, record.record_type, record.mode,
            record.lineup_model_version, record.card_pool_version, record.ruleset_version,
        )
        with self._lock:
            self._records[k] = deepcopy(record)

    async def get_record(
        self, owner_sub: str, record_type: str, mode: str,
        lmv: str, cpv: str, rv: str,
    ) -> Optional[PersonalRecord]:
        k = self._key(owner_sub, record_type, mode, lmv, cpv, rv)
        with self._lock:
            r = self._records.get(k)
            return deepcopy(r) if r else None

    async def list_records(self, owner_sub: str) -> list[PersonalRecord]:
        with self._lock:
            return [
                deepcopy(r) for r in self._records.values()
                if r.owner_sub == owner_sub
            ]

    async def record_event(self, event: PersonalRecordEvent) -> None:
        with self._lock:
            self._events.append(deepcopy(event))

    async def transfer_records(self, from_sub: str, to_sub: str) -> int:
        """Merge records from from_sub to to_sub, keeping the better value."""
        count = 0
        with self._lock:
            anon_records = {k: r for k, r in self._records.items() if r.owner_sub == from_sub}
            for anon_key, anon_r in anon_records.items():
                real_key = self._key(
                    to_sub, anon_r.record_type, anon_r.mode,
                    anon_r.lineup_model_version, anon_r.card_pool_version, anon_r.ruleset_version,
                )
                real_r = self._records.get(real_key)
                is_better = (
                    real_r is None
                    or (anon_r.higher_is_better and anon_r.record_value > real_r.record_value)
                    or (not anon_r.higher_is_better and anon_r.record_value < real_r.record_value)
                )
                if is_better:
                    new_r = deepcopy(anon_r)
                    new_r.owner_sub = to_sub
                    new_r.original_owner_sub = from_sub  # type: ignore[attr-defined]
                    self._records[real_key] = new_r
                    count += 1
                # Remove the anon-keyed record
                del self._records[anon_key]
        return count


class MemoryAchievementRepository:
    """Thread-safe in-memory achievement award store."""

    def __init__(self) -> None:
        self._awards: dict[str, AchievementAward] = {}  # "owner_sub:key" → award
        self._lock = threading.Lock()

    async def award_achievement(self, award: AchievementAward) -> bool:
        k = f"{award.owner_sub}:{award.achievement_key}"
        with self._lock:
            if k in self._awards:
                return False  # already awarded
            self._awards[k] = deepcopy(award)
            return True

    async def get_award(self, owner_sub: str, achievement_key: str) -> Optional[AchievementAward]:
        k = f"{owner_sub}:{achievement_key}"
        with self._lock:
            a = self._awards.get(k)
            return deepcopy(a) if a else None

    async def list_awards(self, owner_sub: str) -> list[AchievementAward]:
        with self._lock:
            return [
                deepcopy(a) for a in self._awards.values()
                if a.owner_sub == owner_sub
            ]

    async def transfer_awards(self, from_sub: str, to_sub: str) -> int:
        count = 0
        with self._lock:
            to_transfer = [a for a in self._awards.values() if a.owner_sub == from_sub]
            for a in to_transfer:
                old_key = f"{from_sub}:{a.achievement_key}"
                new_key = f"{to_sub}:{a.achievement_key}"
                if new_key not in self._awards:
                    new_a = deepcopy(a)
                    new_a.owner_sub = to_sub
                    new_a.original_owner_sub = from_sub  # type: ignore[attr-defined]
                    self._awards[new_key] = new_a
                    count += 1
                del self._awards[old_key]
        return count


class MemoryStreakRepository:
    """Thread-safe in-memory streak state and event store."""

    def __init__(self) -> None:
        self._states: dict[str, StreakState] = {}       # owner_sub → state
        self._events: list[StreakEvent] = []
        self._lock = threading.Lock()

    async def get_streak(self, owner_sub: str) -> Optional[StreakState]:
        with self._lock:
            s = self._states.get(owner_sub)
            return deepcopy(s) if s else None

    async def save_streak(self, state: StreakState) -> None:
        with self._lock:
            self._states[state.owner_sub] = deepcopy(state)

    async def record_streak_event(self, event: StreakEvent) -> None:
        with self._lock:
            self._events.append(deepcopy(event))

    async def list_streak_events(
        self, owner_sub: str, limit: int = 50
    ) -> list[StreakEvent]:
        with self._lock:
            results = [deepcopy(e) for e in self._events if e.owner_sub == owner_sub]
        results.sort(key=lambda e: e.occurred_at, reverse=True)
        return results[:limit]

    async def transfer_streak(self, from_sub: str, to_sub: str) -> bool:
        """Move the anon streak to the real user and apply merge policy."""
        from app.services.progression.streak_service import merge_streak_states
        with self._lock:
            anon_state = self._states.get(from_sub)
            if anon_state is None:
                return False
            real_state = self._states.get(to_sub)
            # Create a service-layer StreakState for merge (protocol vs service dataclasses differ)
            from app.services.progression.streak_service import StreakState as SvcStreak
            def _to_svc(s: StreakState) -> SvcStreak:
                return SvcStreak(
                    owner_sub=s.owner_sub,
                    policy_version=s.policy_version,
                    current_streak=s.current_streak,
                    longest_streak=s.longest_streak,
                    last_qualifying_date=s.last_qualifying_date,
                    last_qualifying_tz=s.last_qualifying_tz,
                    reserve_count=s.reserve_count,
                    reserve_cap=s.reserve_cap,
                    last_reserve_earned_at=s.last_reserve_earned_at,
                )
            svc_anon = _to_svc(anon_state)
            svc_real = _to_svc(real_state) if real_state else _to_svc(StreakState(
                owner_sub=to_sub,
                policy_version=anon_state.policy_version,
                current_streak=0,
                longest_streak=0,
                last_qualifying_date=None,
                last_qualifying_tz="UTC",
                reserve_count=0,
                reserve_cap=anon_state.reserve_cap,
                last_reserve_earned_at=None,
            ))
            merged = merge_streak_states(svc_anon, svc_real)
            # Convert back to repo StreakState
            self._states[to_sub] = StreakState(
                owner_sub=to_sub,
                policy_version=merged.policy_version,
                current_streak=merged.current_streak,
                longest_streak=merged.longest_streak,
                last_qualifying_date=merged.last_qualifying_date,
                last_qualifying_tz=merged.last_qualifying_tz,
                reserve_count=merged.reserve_count,
                reserve_cap=merged.reserve_cap,
                last_reserve_earned_at=merged.last_reserve_earned_at,
            )
            del self._states[from_sub]
            return True
