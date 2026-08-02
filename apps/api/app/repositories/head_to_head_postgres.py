"""PostgreSQL-backed HeadToHeadRepository.

Connects via the API's own service-role asyncpg pool -- the same pattern as
every other Postgres* repository here, and the same "service-role
reads/writes, RLS as an independent second layer" split documented in
supabase/migrations/20260630130000_ranked_rls.sql. Participant scoping is
enforced in application code (`api/v1/head_to_head._participant_or_403`); the
policies in supabase/migrations/20260801160000_head_to_head.sql, plus that
migration's REVOKE, are the layer that holds if this file is ever wrong.

WHERE THE UNIQUENESS LIVES. Three invariants are enforced by INDEXES rather
than by read-then-write, because every one of them is a race two browser tabs
can both win:

* `head_to_head_participants_role_uniq (match_id, role)` -- a third player
  cannot join;
* `head_to_head_participants_pkey (match_id, participant_sub)` -- one seat per
  person, which is also what stops the creator accepting their own invite;
* `head_to_head_matches_rematch_uniq (rematch_of, creator_sub)` -- one rematch
  per source match per creator.

`set_participant_result` and `settle` are FIRST-WRITE-WINS by `WHERE result IS
NULL` / `WHERE settlement IS NULL` in the UPDATE itself rather than by an
if-statement above it, so a second tab's submission cannot replace a settled
number with a different one.

JSONB is decoded defensively (asyncpg returns JSONB as `str` unless a codec is
registered on the pool) -- the same guard daily_grid_postgres.py uses.
"""
from __future__ import annotations

import json
from datetime import date as _date, datetime
from typing import Any, Optional

from app.repositories.head_to_head_protocols import (
    MATCH_STATUS_COMPLETE,
    HeadToHeadMatch,
    HeadToHeadParticipant,
    ParticipantSlotTaken,
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


def _to_date(value: Optional[str]) -> Optional[_date]:
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%d").date()


def _from_date(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, _date):
        return value.isoformat()
    return str(value)


def _json_obj(raw: Any) -> Optional[dict]:
    if raw is None:
        return None
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, (str, bytes)):
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError):
            return None
        return parsed if isinstance(parsed, dict) else None
    return None


def _row_to_match(row: Any) -> HeadToHeadMatch:
    return HeadToHeadMatch(
        match_id=str(row["match_id"]),
        invite_hash=row["invite_hash"],
        creator_sub=row["creator_sub"],
        seed=int(row["seed"]),
        source_run_type=row["source_run_type"],
        source_run_date=_from_date(row["source_run_date"]),
        engine_version=row["engine_version"],
        ruleset_version=row["ruleset_version"],
        card_pool_version=row["card_pool_version"],
        fairness=_json_obj(row["fairness"]) or {},
        status=row["status"],
        expires_at=row["expires_at"],
        settlement=_json_obj(row["settlement"]),
        settled_at=row["settled_at"],
        rematch_of=str(row["rematch_of"]) if row["rematch_of"] else None,
        created_at=row["created_at"],
    )


def _row_to_participant(row: Any) -> HeadToHeadParticipant:
    return HeadToHeadParticipant(
        match_id=str(row["match_id"]),
        participant_sub=row["participant_sub"],
        role=row["role"],
        run_id=row["run_id"],
        status=row["status"],
        result=_json_obj(row["result"]),
        submitted_at=row["submitted_at"],
        joined_at=row["joined_at"],
    )


_MATCH_COLUMNS = """
    match_id, invite_hash, creator_sub, seed, source_run_type, source_run_date,
    engine_version, ruleset_version, card_pool_version, fairness, status,
    expires_at, settlement, settled_at, rematch_of, created_at
"""


class PostgresHeadToHeadRepository:
    def __init__(self, pool: Any) -> None:
        _require_asyncpg()
        self._pool = pool

    async def create_match(
        self, match: HeadToHeadMatch, creator: HeadToHeadParticipant
    ) -> HeadToHeadMatch:
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                try:
                    await conn.execute(
                        f"""
                        INSERT INTO head_to_head_matches ({_MATCH_COLUMNS})
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
                                $11, $12, NULL, NULL, $13, $14)
                        """,
                        match.match_id, match.invite_hash, match.creator_sub,
                        match.seed, match.source_run_type,
                        _to_date(match.source_run_date), match.engine_version,
                        match.ruleset_version, match.card_pool_version,
                        json.dumps(match.fairness), match.status,
                        match.expires_at, match.rematch_of, match.created_at,
                    )
                except asyncpg.UniqueViolationError:
                    # Only reachable through the rematch index: a double-click
                    # on Rematch. Return the one that already exists rather
                    # than minting a second board for the same pairing.
                    if match.rematch_of:
                        existing = await self.find_rematch(
                            match.rematch_of, match.creator_sub
                        )
                        if existing is not None:
                            return existing
                    raise
                await conn.execute(
                    """
                    INSERT INTO head_to_head_participants (
                        match_id, participant_sub, role, run_id, status,
                        result, submitted_at, joined_at
                    ) VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6)
                    """,
                    match.match_id, creator.participant_sub, creator.role,
                    creator.run_id, creator.status, creator.joined_at,
                )
        return match

    async def get_match(self, match_id: str) -> Optional[HeadToHeadMatch]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                f"SELECT {_MATCH_COLUMNS} FROM head_to_head_matches WHERE match_id = $1",
                match_id,
            )
        return _row_to_match(row) if row else None

    async def find_match_by_invite(self, invite_hash: str) -> Optional[HeadToHeadMatch]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                f"SELECT {_MATCH_COLUMNS} FROM head_to_head_matches WHERE invite_hash = $1",
                invite_hash,
            )
        return _row_to_match(row) if row else None

    async def get_participant(
        self, match_id: str, participant_sub: str
    ) -> Optional[HeadToHeadParticipant]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT match_id, participant_sub, role, run_id, status, result,
                       submitted_at, joined_at
                FROM head_to_head_participants
                WHERE match_id = $1 AND participant_sub = $2
                """,
                match_id, participant_sub,
            )
        return _row_to_participant(row) if row else None

    async def get_participants(self, match_id: str) -> list[HeadToHeadParticipant]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT match_id, participant_sub, role, run_id, status, result,
                       submitted_at, joined_at
                FROM head_to_head_participants
                WHERE match_id = $1
                ORDER BY (role <> 'creator'), joined_at
                """,
                match_id,
            )
        return [_row_to_participant(r) for r in rows]

    async def add_participant(
        self, participant: HeadToHeadParticipant
    ) -> HeadToHeadParticipant:
        async with self._pool.acquire() as conn:
            try:
                await conn.execute(
                    """
                    INSERT INTO head_to_head_participants (
                        match_id, participant_sub, role, run_id, status,
                        result, submitted_at, joined_at
                    ) VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6)
                    """,
                    participant.match_id, participant.participant_sub,
                    participant.role, participant.run_id, participant.status,
                    participant.joined_at,
                )
            except asyncpg.UniqueViolationError as exc:
                raise ParticipantSlotTaken(str(exc))
        return participant

    async def set_participant_result(
        self, match_id: str, participant_sub: str, result: dict
    ) -> HeadToHeadParticipant:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE head_to_head_participants
                   SET result = $3::jsonb,
                       status = 'complete',
                       submitted_at = NOW()
                 WHERE match_id = $1
                   AND participant_sub = $2
                   AND result IS NULL
                """,
                match_id, participant_sub, json.dumps(result),
            )
        stored = await self.get_participant(match_id, participant_sub)
        if stored is None:
            raise KeyError(f"No participant {participant_sub!r} in match {match_id!r}")
        return stored

    async def set_match_status(self, match_id: str, status: str) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE head_to_head_matches
                   SET status = $2
                 WHERE match_id = $1 AND status <> $3
                """,
                match_id, status, MATCH_STATUS_COMPLETE,
            )

    async def settle(self, match_id: str, settlement: dict) -> HeadToHeadMatch:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE head_to_head_matches
                   SET settlement = $2::jsonb,
                       settled_at = NOW(),
                       status = $3
                 WHERE match_id = $1 AND settlement IS NULL
                """,
                match_id, json.dumps(settlement), MATCH_STATUS_COMPLETE,
            )
        stored = await self.get_match(match_id)
        if stored is None:
            raise KeyError(f"No match {match_id!r}")
        return stored

    async def list_matches_for_sub(
        self, participant_sub: str, limit: int = 20
    ) -> list[HeadToHeadMatch]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                f"""
                SELECT {_MATCH_COLUMNS}
                  FROM head_to_head_matches m
                 WHERE EXISTS (
                     SELECT 1 FROM head_to_head_participants p
                      WHERE p.match_id = m.match_id AND p.participant_sub = $1
                 )
                 ORDER BY m.created_at DESC
                 LIMIT $2
                """,
                participant_sub, limit,
            )
        return [_row_to_match(r) for r in rows]

    async def find_rematch(
        self, rematch_of: str, creator_sub: str
    ) -> Optional[HeadToHeadMatch]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                f"""
                SELECT {_MATCH_COLUMNS} FROM head_to_head_matches
                 WHERE rematch_of = $1 AND creator_sub = $2
                """,
                rematch_of, creator_sub,
            )
        return _row_to_match(row) if row else None
