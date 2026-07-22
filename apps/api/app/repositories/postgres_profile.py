"""PostgreSQL ProfileRepository implementation using asyncpg.

Production implementation. Requires DATABASE_URL. The `profiles` table's
partial unique index on lower(handle) (see supabase/migrations) is the
source of truth for handle uniqueness — this class catches the resulting
UniqueViolationError and raises HandleTakenError rather than racing a
check-then-insert against it.
"""
from __future__ import annotations

from typing import Any

from app.repositories.profile_protocols import HandleTakenError, Profile, UserSettings

try:
    import asyncpg  # type: ignore[import]
    _ASYNCPG_AVAILABLE = True
except ImportError:
    _ASYNCPG_AVAILABLE = False


def _require_asyncpg() -> None:
    if not _ASYNCPG_AVAILABLE:
        raise RuntimeError(
            "asyncpg is required for PostgreSQL repositories. "
            "Install it: pip install asyncpg"
        )


def _row_to_profile(row) -> Profile:
    return Profile(
        id=str(row["id"]),
        auth_sub=row["auth_sub"],
        handle=row["handle"],
        display_name=row["display_name"],
        bio=row["bio"],
        region=row["region"],
        avatar_key=row["avatar_key"],
        is_public=row["is_public"],
        history_public=row["history_public"],
        joined_at=row["joined_at"],
    )


def _row_to_settings(row) -> UserSettings:
    return UserSettings(
        profile_id=str(row["profile_id"]),
        timezone=row["timezone"],
        reduced_motion=row["reduced_motion"],
    )


class PostgresProfileRepository:
    """PostgreSQL-backed profile + settings store."""

    def __init__(self, pool: Any) -> None:
        _require_asyncpg()
        self._pool = pool

    async def get_or_create_profile(self, auth_sub: str) -> Profile:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO profiles (auth_sub)
                VALUES ($1)
                ON CONFLICT (auth_sub) DO UPDATE SET auth_sub = EXCLUDED.auth_sub
                RETURNING *
                """,
                auth_sub,
            )
        return _row_to_profile(row)

    async def update_profile(self, auth_sub: str, updates: dict) -> Profile:
        # Ensure a row exists first (cheap upsert, no-op if already present).
        await self.get_or_create_profile(auth_sub)

        fields: list[str] = []
        values: list[Any] = []
        idx = 1

        if "handle" in updates and updates["handle"] is not None:
            fields.append(f"handle = ${idx}")
            values.append(updates["handle"].lower())
            idx += 1
        for field in ("display_name", "bio", "region", "avatar_key", "is_public", "history_public"):
            if field in updates and updates[field] is not None:
                fields.append(f"{field} = ${idx}")
                values.append(updates[field])
                idx += 1

        if not fields:
            async with self._pool.acquire() as conn:
                row = await conn.fetchrow("SELECT * FROM profiles WHERE auth_sub = $1", auth_sub)
            return _row_to_profile(row)

        fields.append("updated_at = NOW()")
        values.append(auth_sub)
        query = f"UPDATE profiles SET {', '.join(fields)} WHERE auth_sub = ${idx} RETURNING *"

        try:
            async with self._pool.acquire() as conn:
                row = await conn.fetchrow(query, *values)
        except asyncpg.UniqueViolationError:
            raise HandleTakenError(updates.get("handle"))
        return _row_to_profile(row)

    async def get_profile_by_handle(self, handle: str) -> Profile | None:
        normalized = handle.strip().lower()
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM profiles WHERE lower(handle) = $1", normalized
            )
        return _row_to_profile(row) if row is not None else None

    async def get_or_create_settings(self, auth_sub: str) -> UserSettings:
        profile = await self.get_or_create_profile(auth_sub)
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO user_settings (profile_id)
                VALUES ($1)
                ON CONFLICT (profile_id) DO UPDATE SET profile_id = EXCLUDED.profile_id
                RETURNING *
                """,
                profile.id,
            )
        return _row_to_settings(row)

    async def update_settings(self, auth_sub: str, updates: dict) -> UserSettings:
        profile = await self.get_or_create_profile(auth_sub)
        await self.get_or_create_settings(auth_sub)

        fields: list[str] = []
        values: list[Any] = []
        idx = 1
        if updates.get("timezone") is not None:
            fields.append(f"timezone = ${idx}")
            values.append(updates["timezone"])
            idx += 1
        if updates.get("reduced_motion") is not None:
            fields.append(f"reduced_motion = ${idx}")
            values.append(updates["reduced_motion"])
            idx += 1

        if not fields:
            async with self._pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT * FROM user_settings WHERE profile_id = $1", profile.id
                )
            return _row_to_settings(row)

        fields.append("updated_at = NOW()")
        values.append(profile.id)
        query = f"UPDATE user_settings SET {', '.join(fields)} WHERE profile_id = ${idx} RETURNING *"
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(query, *values)
        return _row_to_settings(row)
