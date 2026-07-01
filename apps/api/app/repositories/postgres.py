"""PostgreSQL repository implementations using asyncpg.

These are the production implementations.  They require DATABASE_URL to be set.
The API startup code injects these when DATABASE_URL is available.

Async implementations using asyncpg connection pools.  All methods are
async even though the Protocol uses sync signatures — FastAPI resolves
this transparently via dependency injection with async dependencies.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from nba_peak.lineup.schemas import DraftGameState

from .protocols import (
    ChallengeRecord,
    DailyCompletion,
    OwnershipClaim,
    ResultSnapshot,
)

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


class PostgresGameRepository:
    """PostgreSQL-backed game store using asyncpg connection pool."""

    def __init__(self, pool: Any) -> None:
        _require_asyncpg()
        self._pool = pool

    async def create_game(self, state: DraftGameState) -> str:
        from nba_peak.lineup.schemas import DraftGameState as _GS
        game_id = str(uuid.uuid4())
        state.game_id = game_id
        payload = _serialize_game_state(state)
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO games (id, owner_sub, board_id, mode, board_type, status, payload, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """,
                game_id,
                payload.get("anon_subject_id"),
                state.board.board_id,
                state.mode,
                state.board.board_type,
                state.status,
                json.dumps(payload),
                datetime.now(timezone.utc),
            )
        return game_id

    async def get_game(self, game_id: str) -> DraftGameState | None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT payload FROM games WHERE id = $1", game_id
            )
        if row is None:
            return None
        return _deserialize_game_state(json.loads(row["payload"]))

    async def save_game(self, state: DraftGameState) -> None:
        payload = _serialize_game_state(state)
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE games
                SET payload = $2, status = $3, updated_at = $4
                WHERE id = $1
                """,
                state.game_id,
                json.dumps(payload),
                state.status,
                datetime.now(timezone.utc),
            )

    async def delete_game(self, game_id: str) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute("DELETE FROM games WHERE id = $1", game_id)

    async def game_count(self) -> int:
        async with self._pool.acquire() as conn:
            return await conn.fetchval("SELECT COUNT(*) FROM games")


class PostgresChallengeRepository:
    """PostgreSQL-backed challenge store."""

    def __init__(self, pool: Any) -> None:
        _require_asyncpg()
        self._pool = pool

    async def store_challenge(self, record: ChallengeRecord) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO challenges (
                    token_hash, challenger_game_id, board_id, mode, board_type,
                    duration_years, seed, date, created_at, expires_at,
                    challenger_snapshot, anon_subject_id
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                ON CONFLICT (token_hash) DO NOTHING
                """,
                record.token_hash,
                record.challenger_game_id,
                record.board_id,
                record.mode,
                record.board_type,
                record.duration_years,
                record.seed,
                record.date,
                record.created_at,
                record.expires_at,
                json.dumps(record.challenger_snapshot),
                record.anon_subject_id,
            )

    async def get_challenge(self, token_hash: str) -> ChallengeRecord | None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM challenges WHERE token_hash = $1", token_hash
            )
        if row is None:
            return None
        return ChallengeRecord(
            token_hash=row["token_hash"],
            challenger_game_id=row["challenger_game_id"],
            board_id=row["board_id"],
            mode=row["mode"],
            board_type=row["board_type"],
            duration_years=row["duration_years"],
            seed=row["seed"],
            date=row["date"],
            created_at=row["created_at"],
            expires_at=row["expires_at"],
            challenger_snapshot=json.loads(row["challenger_snapshot"]),
            anon_subject_id=row["anon_subject_id"],
            settlement=json.loads(row["settlement"]) if row["settlement"] else None,
        )

    async def save_settlement(self, token_hash: str, settlement: dict) -> bool:
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                """
                UPDATE challenges
                SET settlement = $2, settled_at = $3
                WHERE token_hash = $1 AND settlement IS NULL
                """,
                token_hash,
                json.dumps(settlement),
                datetime.now(timezone.utc),
            )
        return result != "UPDATE 0"


class PostgresDailyCompletionRepository:
    """PostgreSQL-backed daily completion store."""

    def __init__(self, pool: Any) -> None:
        _require_asyncpg()
        self._pool = pool

    async def record_completion(self, completion: DailyCompletion) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO daily_completions (
                    id, owner_sub, board_id, mode, date, game_id,
                    lineup_peak_rating, draft_efficiency, board_percentile,
                    hold_used, reframe_used, completed_at, result_snapshot
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                ON CONFLICT (owner_sub, board_id) DO NOTHING
                """,
                completion.id,
                completion.owner_sub,
                completion.board_id,
                completion.mode,
                completion.date,
                completion.game_id,
                completion.lineup_peak_rating,
                completion.draft_efficiency,
                completion.board_percentile,
                completion.hold_used,
                completion.reframe_used,
                completion.completed_at,
                json.dumps(completion.result_snapshot),
            )

    async def get_completion(
        self, owner_sub: str, board_id: str
    ) -> DailyCompletion | None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT * FROM daily_completions
                WHERE owner_sub = $1 AND board_id = $2
                """,
                owner_sub,
                board_id,
            )
        if row is None:
            return None
        return _row_to_daily_completion(row)

    async def list_completions(
        self,
        owner_sub: str,
        limit: int = 50,
        before_id: str | None = None,
    ) -> list[DailyCompletion]:
        async with self._pool.acquire() as conn:
            if before_id:
                rows = await conn.fetch(
                    """
                    SELECT * FROM daily_completions
                    WHERE owner_sub = $1
                      AND completed_at < (SELECT completed_at FROM daily_completions WHERE id = $2)
                    ORDER BY completed_at DESC
                    LIMIT $3
                    """,
                    owner_sub,
                    before_id,
                    limit,
                )
            else:
                rows = await conn.fetch(
                    """
                    SELECT * FROM daily_completions
                    WHERE owner_sub = $1
                    ORDER BY completed_at DESC
                    LIMIT $2
                    """,
                    owner_sub,
                    limit,
                )
        return [_row_to_daily_completion(r) for r in rows]


class PostgresResultSnapshotRepository:
    """PostgreSQL-backed result snapshot store."""

    def __init__(self, pool: Any) -> None:
        _require_asyncpg()
        self._pool = pool

    async def record_result(self, result: ResultSnapshot) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO result_snapshots (
                    id, owner_sub, game_id, board_id, board_type, mode,
                    lineup_peak_rating, draft_efficiency, board_percentile,
                    completed_at, payload
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                ON CONFLICT (id) DO NOTHING
                """,
                result.id,
                result.owner_sub,
                result.game_id,
                result.board_id,
                result.board_type,
                result.mode,
                result.lineup_peak_rating,
                result.draft_efficiency,
                result.board_percentile,
                result.completed_at,
                json.dumps(result.payload),
            )

    async def get_result(self, result_id: str) -> ResultSnapshot | None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM result_snapshots WHERE id = $1", result_id
            )
        if row is None:
            return None
        return _row_to_result_snapshot(row)

    async def list_results(
        self,
        owner_sub: str,
        limit: int = 50,
        before_id: str | None = None,
    ) -> list[ResultSnapshot]:
        async with self._pool.acquire() as conn:
            if before_id:
                rows = await conn.fetch(
                    """
                    SELECT * FROM result_snapshots
                    WHERE owner_sub = $1
                      AND completed_at < (SELECT completed_at FROM result_snapshots WHERE id = $2)
                    ORDER BY completed_at DESC
                    LIMIT $3
                    """,
                    owner_sub,
                    before_id,
                    limit,
                )
            else:
                rows = await conn.fetch(
                    """
                    SELECT * FROM result_snapshots
                    WHERE owner_sub = $1
                    ORDER BY completed_at DESC
                    LIMIT $2
                    """,
                    owner_sub,
                    limit,
                )
        return [_row_to_result_snapshot(r) for r in rows]


class PostgresOwnershipClaimRepository:
    """PostgreSQL-backed ownership claim store."""

    def __init__(self, pool: Any) -> None:
        _require_asyncpg()
        self._pool = pool

    async def record_claim(self, claim: OwnershipClaim) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO ownership_claims (
                    id, real_user_sub, anon_subject_id, claimed_at,
                    game_count, completion_count, challenge_count
                ) VALUES ($1,$2,$3,$4,$5,$6,$7)
                ON CONFLICT (anon_subject_id) DO NOTHING
                """,
                claim.id,
                claim.real_user_sub,
                claim.anon_subject_id,
                claim.claimed_at,
                claim.game_count,
                claim.completion_count,
                claim.challenge_count,
            )

    async def get_claim_by_anon(self, anon_subject_id: str) -> OwnershipClaim | None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM ownership_claims WHERE anon_subject_id = $1",
                anon_subject_id,
            )
        if row is None:
            return None
        return OwnershipClaim(
            id=str(row["id"]),
            real_user_sub=row["real_user_sub"],
            anon_subject_id=row["anon_subject_id"],
            claimed_at=row["claimed_at"],
            game_count=row["game_count"],
            completion_count=row["completion_count"],
            challenge_count=row["challenge_count"],
        )


# ---------------------------------------------------------------------------
# Pool factory
# ---------------------------------------------------------------------------


async def create_pool(database_url: str) -> Any:
    """Create an asyncpg connection pool.  Called once at API startup."""
    _require_asyncpg()
    return await asyncpg.create_pool(database_url, min_size=2, max_size=10)


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _serialize_game_state(state: DraftGameState) -> dict:
    """Serialize DraftGameState to a plain dict suitable for JSONB storage."""
    import dataclasses
    return dataclasses.asdict(state) if hasattr(state, "__dataclass_fields__") else state.__dict__


def _deserialize_game_state(payload: dict) -> DraftGameState:
    """Deserialize a JSONB payload back to DraftGameState.

    The Board sub-object and card profiles are reconstructed from the stored
    board snapshot so the state machine can operate on them as usual.
    """
    from nba_peak.lineup.schemas import DraftGameState as _GS
    # Full reconstruction from persisted payload
    # In practice the Board is re-generated from the payload's seed/date/mode
    # rather than stored in full — see note below.
    raise NotImplementedError(
        "Full DraftGameState deserialization requires the board snapshot stored "
        "separately in board_snapshots. This implementation is deferred to "
        "Phase 3.1 when the board_snapshots table is fully wired."
    )


def _row_to_daily_completion(row: Any) -> DailyCompletion:
    return DailyCompletion(
        id=str(row["id"]),
        owner_sub=row["owner_sub"],
        board_id=row["board_id"],
        mode=row["mode"],
        date=row["date"],
        game_id=row["game_id"],
        lineup_peak_rating=float(row["lineup_peak_rating"]),
        draft_efficiency=float(row["draft_efficiency"]) if row["draft_efficiency"] is not None else None,
        board_percentile=float(row["board_percentile"]) if row["board_percentile"] is not None else None,
        hold_used=bool(row["hold_used"]),
        reframe_used=bool(row["reframe_used"]),
        completed_at=row["completed_at"],
        result_snapshot=json.loads(row["result_snapshot"]),
    )


def _row_to_result_snapshot(row: Any) -> ResultSnapshot:
    return ResultSnapshot(
        id=str(row["id"]),
        owner_sub=row["owner_sub"],
        game_id=row["game_id"],
        board_id=row["board_id"],
        board_type=row["board_type"],
        mode=row["mode"],
        lineup_peak_rating=float(row["lineup_peak_rating"]),
        draft_efficiency=float(row["draft_efficiency"]) if row["draft_efficiency"] is not None else None,
        board_percentile=float(row["board_percentile"]) if row["board_percentile"] is not None else None,
        completed_at=row["completed_at"],
        payload=json.loads(row["payload"]),
    )
