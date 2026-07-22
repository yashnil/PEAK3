"""PostgreSQL progression repository implementations using asyncpg.

Real, complete implementations — this module was previously a stub where
every method raised NotImplementedError (see
docs/architecture/REPOSITORY_WIRING_AUDIT.md). Matches the async Protocol
declarations in progression_protocols.py and the SQL schema in
supabase/migrations/20260630125000_progression.sql through
20260630125300_streaks.sql.
"""
from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any, Optional

from app.repositories.progression_protocols import (
    AchievementAward,
    PersonalRecord,
    PersonalRecordEvent,
    ProgressionEvent,
    StreakEvent,
    StreakState,
    UserProgress,
)

try:
    import asyncpg  # type: ignore[import]
    _ASYNCPG_AVAILABLE = True
except ImportError:
    _ASYNCPG_AVAILABLE = False


def _require_asyncpg() -> None:
    if not _ASYNCPG_AVAILABLE:
        raise RuntimeError(
            "asyncpg is required for PostgreSQL repositories. Install it: pip install asyncpg"
        )


def _row_to_progression_event(row: Any) -> ProgressionEvent:
    return ProgressionEvent(
        id=str(row["id"]),
        owner_sub=row["owner_sub"],
        event_type=row["event_type"],
        source_type=row["source_type"],
        source_id=row["source_id"],
        idempotency_key=row["idempotency_key"],
        policy_version=row["policy_version"],
        xp_amount=row["xp_amount"],
        occurred_at=row["occurred_at"],
        awarded_at=row["awarded_at"],
        metadata=json.loads(row["metadata"]) if isinstance(row["metadata"], str) else row["metadata"],
        original_owner_sub=row["original_owner_sub"],
    )


class PostgresProgressionRepository:
    def __init__(self, pool: Any) -> None:
        _require_asyncpg()
        self._pool = pool

    async def record_event(self, event: ProgressionEvent) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO progression_events (
                    id, owner_sub, event_type, source_type, source_id, idempotency_key,
                    policy_version, xp_amount, occurred_at, awarded_at, metadata, original_owner_sub
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
                ON CONFLICT (idempotency_key) DO NOTHING
                """,
                event.id, event.owner_sub, event.event_type, event.source_type, event.source_id,
                event.idempotency_key, event.policy_version, event.xp_amount, event.occurred_at,
                event.awarded_at, json.dumps(event.metadata), event.original_owner_sub,
            )

    async def get_event_by_idempotency_key(self, key: str) -> Optional[ProgressionEvent]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM progression_events WHERE idempotency_key = $1", key)
        return _row_to_progression_event(row) if row else None

    async def list_events(
        self, owner_sub: str, limit: int = 50, before_id: Optional[str] = None
    ) -> list[ProgressionEvent]:
        async with self._pool.acquire() as conn:
            if before_id:
                rows = await conn.fetch(
                    """
                    SELECT * FROM progression_events WHERE owner_sub = $1
                      AND occurred_at < (SELECT occurred_at FROM progression_events WHERE id = $2)
                    ORDER BY occurred_at DESC LIMIT $3
                    """,
                    owner_sub, before_id, limit,
                )
            else:
                rows = await conn.fetch(
                    "SELECT * FROM progression_events WHERE owner_sub = $1 ORDER BY occurred_at DESC LIMIT $2",
                    owner_sub, limit,
                )
        return [_row_to_progression_event(r) for r in rows]

    async def get_events_in_window(
        self, owner_sub: str, event_type: str, after: datetime, before: datetime
    ) -> list[ProgressionEvent]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT * FROM progression_events
                WHERE owner_sub = $1 AND event_type = $2 AND occurred_at >= $3 AND occurred_at <= $4
                ORDER BY occurred_at DESC
                """,
                owner_sub, event_type, after, before,
            )
        return [_row_to_progression_event(r) for r in rows]

    async def upsert_progress(self, progress: UserProgress) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO user_progress (owner_sub, total_xp, current_level, policy_version, last_progression_at, updated_at)
                VALUES ($1,$2,$3,$4,$5,NOW())
                ON CONFLICT (owner_sub) DO UPDATE SET
                    total_xp = EXCLUDED.total_xp,
                    current_level = EXCLUDED.current_level,
                    policy_version = EXCLUDED.policy_version,
                    last_progression_at = EXCLUDED.last_progression_at,
                    updated_at = NOW()
                """,
                progress.owner_sub, progress.total_xp, progress.current_level,
                progress.policy_version, progress.last_progression_at,
            )

    async def get_progress(self, owner_sub: str) -> Optional[UserProgress]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM user_progress WHERE owner_sub = $1", owner_sub)
        if row is None:
            return None
        return UserProgress(
            owner_sub=row["owner_sub"], total_xp=row["total_xp"], current_level=row["current_level"],
            policy_version=row["policy_version"], last_progression_at=row["last_progression_at"],
        )

    async def transfer_events(self, from_sub: str, to_sub: str) -> int:
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                """
                UPDATE progression_events
                SET owner_sub = $2, original_owner_sub = COALESCE(original_owner_sub, $1)
                WHERE owner_sub = $1
                """,
                from_sub, to_sub,
            )
        return int(result.split()[-1])


class PostgresPersonalRecordRepository:
    def __init__(self, pool: Any) -> None:
        _require_asyncpg()
        self._pool = pool

    async def upsert_record(self, record: PersonalRecord) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO personal_records (
                    id, owner_sub, record_type, mode, lineup_model_version, card_pool_version,
                    ruleset_version, record_value, higher_is_better, source_result_id, achieved_at, previous_record_id
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                ON CONFLICT (owner_sub, record_type, mode, lineup_model_version, card_pool_version, ruleset_version)
                DO UPDATE SET
                    record_value = EXCLUDED.record_value,
                    higher_is_better = EXCLUDED.higher_is_better,
                    source_result_id = EXCLUDED.source_result_id,
                    achieved_at = EXCLUDED.achieved_at,
                    previous_record_id = EXCLUDED.previous_record_id
                """,
                record.id, record.owner_sub, record.record_type, record.mode,
                record.lineup_model_version, record.card_pool_version, record.ruleset_version,
                record.record_value, record.higher_is_better, record.source_result_id,
                record.achieved_at, record.previous_record_id,
            )

    async def get_record(
        self, owner_sub: str, record_type: str, mode: str, lmv: str, cpv: str, rv: str,
    ) -> Optional[PersonalRecord]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT * FROM personal_records
                WHERE owner_sub = $1 AND record_type = $2 AND mode = $3
                  AND lineup_model_version = $4 AND card_pool_version = $5 AND ruleset_version = $6
                """,
                owner_sub, record_type, mode, lmv, cpv, rv,
            )
        return _row_to_personal_record(row) if row else None

    async def list_records(self, owner_sub: str) -> list[PersonalRecord]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch("SELECT * FROM personal_records WHERE owner_sub = $1", owner_sub)
        return [_row_to_personal_record(r) for r in rows]

    async def record_event(self, event: PersonalRecordEvent) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO personal_record_events (
                    id, owner_sub, record_type, mode, lineup_model_version, card_pool_version,
                    ruleset_version, new_value, previous_value, source_result_id, occurred_at, original_owner_sub
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                """,
                event.id, event.owner_sub, event.record_type, event.mode,
                event.lineup_model_version, event.card_pool_version, event.ruleset_version,
                event.new_value, event.previous_value, event.source_result_id, event.occurred_at,
                event.original_owner_sub,
            )

    async def transfer_records(self, from_sub: str, to_sub: str) -> int:
        """Merge anon records into the real user, keeping the better value
        per (record_type, mode, version_tuple) — matches
        MemoryPersonalRecordRepository.transfer_records's semantics.
        """
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                anon_records = await conn.fetch("SELECT * FROM personal_records WHERE owner_sub = $1", from_sub)
                count = 0
                for row in anon_records:
                    anon = _row_to_personal_record(row)
                    real = await conn.fetchrow(
                        """
                        SELECT * FROM personal_records
                        WHERE owner_sub = $1 AND record_type = $2 AND mode = $3
                          AND lineup_model_version = $4 AND card_pool_version = $5 AND ruleset_version = $6
                        """,
                        to_sub, anon.record_type, anon.mode,
                        anon.lineup_model_version, anon.card_pool_version, anon.ruleset_version,
                    )
                    real_value = float(real["record_value"]) if real else None
                    is_better = (
                        real is None
                        or (anon.higher_is_better and anon.record_value > real_value)
                        or (not anon.higher_is_better and anon.record_value < real_value)
                    )
                    if is_better:
                        await conn.execute(
                            """
                            INSERT INTO personal_records (
                                id, owner_sub, record_type, mode, lineup_model_version, card_pool_version,
                                ruleset_version, record_value, higher_is_better, source_result_id, achieved_at
                            ) VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                            ON CONFLICT (owner_sub, record_type, mode, lineup_model_version, card_pool_version, ruleset_version)
                            DO UPDATE SET record_value = EXCLUDED.record_value, achieved_at = EXCLUDED.achieved_at,
                                source_result_id = EXCLUDED.source_result_id
                            """,
                            to_sub, anon.record_type, anon.mode, anon.lineup_model_version,
                            anon.card_pool_version, anon.ruleset_version, anon.record_value,
                            anon.higher_is_better, anon.source_result_id, anon.achieved_at,
                        )
                        count += 1
                    await conn.execute("DELETE FROM personal_records WHERE id = $1", anon.id)
        return count


def _row_to_personal_record(row: Any) -> PersonalRecord:
    return PersonalRecord(
        id=str(row["id"]), owner_sub=row["owner_sub"], record_type=row["record_type"], mode=row["mode"],
        lineup_model_version=row["lineup_model_version"], card_pool_version=row["card_pool_version"],
        ruleset_version=row["ruleset_version"], record_value=float(row["record_value"]),
        higher_is_better=row["higher_is_better"], source_result_id=row["source_result_id"],
        achieved_at=row["achieved_at"], previous_record_id=str(row["previous_record_id"]) if row["previous_record_id"] else None,
    )


class PostgresAchievementRepository:
    def __init__(self, pool: Any) -> None:
        _require_asyncpg()
        self._pool = pool

    async def award_achievement(self, award: AchievementAward) -> bool:
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                """
                INSERT INTO achievement_awards (id, owner_sub, achievement_key, source_type, source_id, awarded_at, original_owner_sub)
                VALUES ($1,$2,$3,$4,$5,$6,$7)
                ON CONFLICT (owner_sub, achievement_key) DO NOTHING
                """,
                award.id, award.owner_sub, award.achievement_key, award.source_type,
                award.source_id, award.awarded_at, award.original_owner_sub,
            )
        return result.endswith("1")

    async def get_award(self, owner_sub: str, achievement_key: str) -> Optional[AchievementAward]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM achievement_awards WHERE owner_sub = $1 AND achievement_key = $2",
                owner_sub, achievement_key,
            )
        return _row_to_award(row) if row else None

    async def list_awards(self, owner_sub: str) -> list[AchievementAward]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch("SELECT * FROM achievement_awards WHERE owner_sub = $1", owner_sub)
        return [_row_to_award(r) for r in rows]

    async def transfer_awards(self, from_sub: str, to_sub: str) -> int:
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                anon_awards = await conn.fetch("SELECT * FROM achievement_awards WHERE owner_sub = $1", from_sub)
                count = 0
                for row in anon_awards:
                    a = _row_to_award(row)
                    result = await conn.execute(
                        """
                        INSERT INTO achievement_awards (id, owner_sub, achievement_key, source_type, source_id, awarded_at, original_owner_sub)
                        VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6)
                        ON CONFLICT (owner_sub, achievement_key) DO NOTHING
                        """,
                        to_sub, a.achievement_key, a.source_type, a.source_id, a.awarded_at, from_sub,
                    )
                    if result.endswith("1"):
                        count += 1
                    await conn.execute("DELETE FROM achievement_awards WHERE id = $1", a.id)
        return count


def _row_to_award(row: Any) -> AchievementAward:
    return AchievementAward(
        id=str(row["id"]), owner_sub=row["owner_sub"], achievement_key=row["achievement_key"],
        source_type=row["source_type"], source_id=row["source_id"], awarded_at=row["awarded_at"],
        original_owner_sub=row["original_owner_sub"],
    )


class PostgresStreakRepository:
    def __init__(self, pool: Any) -> None:
        _require_asyncpg()
        self._pool = pool

    async def get_streak(self, owner_sub: str) -> Optional[StreakState]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM streak_states WHERE owner_sub = $1", owner_sub)
        return _row_to_streak_state(row) if row else None

    async def save_streak(self, state: StreakState) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO streak_states (
                    owner_sub, policy_version, current_streak, longest_streak,
                    last_qualifying_date, last_qualifying_tz, reserve_count, reserve_cap,
                    last_reserve_earned_at, updated_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
                ON CONFLICT (owner_sub) DO UPDATE SET
                    policy_version = EXCLUDED.policy_version,
                    current_streak = EXCLUDED.current_streak,
                    longest_streak = EXCLUDED.longest_streak,
                    last_qualifying_date = EXCLUDED.last_qualifying_date,
                    last_qualifying_tz = EXCLUDED.last_qualifying_tz,
                    reserve_count = EXCLUDED.reserve_count,
                    reserve_cap = EXCLUDED.reserve_cap,
                    last_reserve_earned_at = EXCLUDED.last_reserve_earned_at,
                    updated_at = NOW()
                """,
                state.owner_sub, state.policy_version, state.current_streak, state.longest_streak,
                state.last_qualifying_date, state.last_qualifying_tz, state.reserve_count,
                state.reserve_cap, state.last_reserve_earned_at,
            )

    async def record_streak_event(self, event: StreakEvent) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO streak_events (
                    id, owner_sub, event_type, local_date, tz_used, streak_before, streak_after,
                    reserve_before, reserve_after, source_type, source_id, occurred_at, original_owner_sub
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                """,
                event.id, event.owner_sub, event.event_type, event.local_date, event.tz_used,
                event.streak_before, event.streak_after, event.reserve_before, event.reserve_after,
                event.source_type, event.source_id, event.occurred_at, event.original_owner_sub,
            )

    async def list_streak_events(self, owner_sub: str, limit: int = 50) -> list[StreakEvent]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM streak_events WHERE owner_sub = $1 ORDER BY occurred_at DESC LIMIT $2",
                owner_sub, limit,
            )
        return [_row_to_streak_event(r) for r in rows]

    async def transfer_streak(self, from_sub: str, to_sub: str) -> bool:
        """Merge the anon streak into the real user's, using the same
        merge_streak_states policy as the in-memory implementation.
        """
        from app.services.progression.streak_service import StreakState as SvcStreak, merge_streak_states

        async with self._pool.acquire() as conn:
            async with conn.transaction():
                anon_row = await conn.fetchrow("SELECT * FROM streak_states WHERE owner_sub = $1", from_sub)
                if anon_row is None:
                    return False
                anon_state = _row_to_streak_state(anon_row)
                real_row = await conn.fetchrow("SELECT * FROM streak_states WHERE owner_sub = $1", to_sub)
                real_state = _row_to_streak_state(real_row) if real_row else None

                def _to_svc(s: StreakState) -> SvcStreak:
                    return SvcStreak(
                        owner_sub=s.owner_sub, policy_version=s.policy_version,
                        current_streak=s.current_streak, longest_streak=s.longest_streak,
                        last_qualifying_date=s.last_qualifying_date, last_qualifying_tz=s.last_qualifying_tz,
                        reserve_count=s.reserve_count, reserve_cap=s.reserve_cap,
                        last_reserve_earned_at=s.last_reserve_earned_at,
                    )

                svc_anon = _to_svc(anon_state)
                svc_real = _to_svc(real_state) if real_state else _to_svc(StreakState(
                    owner_sub=to_sub, policy_version=anon_state.policy_version, current_streak=0,
                    longest_streak=0, last_qualifying_date=None, last_qualifying_tz="UTC",
                    reserve_count=0, reserve_cap=anon_state.reserve_cap, last_reserve_earned_at=None,
                ))
                merged = merge_streak_states(svc_anon, svc_real)

                await conn.execute(
                    """
                    INSERT INTO streak_states (
                        owner_sub, policy_version, current_streak, longest_streak,
                        last_qualifying_date, last_qualifying_tz, reserve_count, reserve_cap,
                        last_reserve_earned_at, updated_at
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
                    ON CONFLICT (owner_sub) DO UPDATE SET
                        policy_version = EXCLUDED.policy_version, current_streak = EXCLUDED.current_streak,
                        longest_streak = EXCLUDED.longest_streak, last_qualifying_date = EXCLUDED.last_qualifying_date,
                        last_qualifying_tz = EXCLUDED.last_qualifying_tz, reserve_count = EXCLUDED.reserve_count,
                        reserve_cap = EXCLUDED.reserve_cap, last_reserve_earned_at = EXCLUDED.last_reserve_earned_at,
                        updated_at = NOW()
                    """,
                    to_sub, merged.policy_version, merged.current_streak, merged.longest_streak,
                    merged.last_qualifying_date, merged.last_qualifying_tz, merged.reserve_count,
                    merged.reserve_cap, merged.last_reserve_earned_at,
                )
                await conn.execute("DELETE FROM streak_states WHERE owner_sub = $1", from_sub)
        return True


def _row_to_streak_state(row: Any) -> StreakState:
    return StreakState(
        owner_sub=row["owner_sub"], policy_version=row["policy_version"],
        current_streak=row["current_streak"], longest_streak=row["longest_streak"],
        last_qualifying_date=row["last_qualifying_date"], last_qualifying_tz=row["last_qualifying_tz"],
        reserve_count=row["reserve_count"], reserve_cap=row["reserve_cap"],
        last_reserve_earned_at=row["last_reserve_earned_at"],
    )


def _row_to_streak_event(row: Any) -> StreakEvent:
    return StreakEvent(
        id=str(row["id"]), owner_sub=row["owner_sub"], event_type=row["event_type"],
        local_date=row["local_date"], tz_used=row["tz_used"], streak_before=row["streak_before"],
        streak_after=row["streak_after"], reserve_before=row["reserve_before"], reserve_after=row["reserve_after"],
        source_type=row["source_type"], source_id=row["source_id"], occurred_at=row["occurred_at"],
        original_owner_sub=row["original_owner_sub"],
    )
