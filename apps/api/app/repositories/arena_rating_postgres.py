"""PostgreSQL ArenaRatingRepository.

Connects through the API's own pool as the table-owning role, the same as every
other Postgres* repository here (see `20260801100000_rls_gaps.sql:3-18` for why
that means RLS is the second layer and not this layer).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional, Sequence

from app.repositories.arena_rating_protocols import (
    ArenaLeaderboardRow,
    ArenaRating,
    ArenaRatingHistoryEntry,
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


_RATING_COLUMNS = """
    owner_sub, mode, rating, rd, volatility, rated_matches,
    algorithm_version, last_rated_match_at, created_at, updated_at
"""

_HISTORY_COLUMNS = """
    id, owner_sub, mode, match_id, pre_rating, pre_rd, pre_volatility,
    post_rating, post_rd, post_volatility, unbounded_post_rating,
    bound_applied, placement, opponents, had_bot_opponent,
    bot_policy_version, algorithm_version, created_at
"""


def _row_to_rating(row: Any) -> ArenaRating:
    return ArenaRating(
        owner_sub=row["owner_sub"],
        mode=row["mode"],
        rating=float(row["rating"]),
        rd=float(row["rd"]),
        volatility=float(row["volatility"]),
        rated_matches=row["rated_matches"],
        algorithm_version=row["algorithm_version"],
        last_rated_match_at=row["last_rated_match_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_entry(row: Any) -> ArenaRatingHistoryEntry:
    raw = row["opponents"]
    # asyncpg returns JSONB as str unless a codec is registered on the pool --
    # decoded defensively here rather than assuming one is, the same treatment
    # `postgres.py::_json_int_map` gives `ownership_claims.domain_counts`.
    if isinstance(raw, (str, bytes)):
        try:
            raw = json.loads(raw)
        except (ValueError, TypeError):
            raw = []
    return ArenaRatingHistoryEntry(
        entry_id=row["id"],
        owner_sub=row["owner_sub"],
        mode=row["mode"],
        match_id=str(row["match_id"]),
        pre_rating=float(row["pre_rating"]),
        pre_rd=float(row["pre_rd"]),
        pre_volatility=float(row["pre_volatility"]),
        post_rating=float(row["post_rating"]),
        post_rd=float(row["post_rd"]),
        post_volatility=float(row["post_volatility"]),
        unbounded_post_rating=float(row["unbounded_post_rating"]),
        bound_applied=row["bound_applied"],
        placement=row["placement"],
        opponents=list(raw or []),
        had_bot_opponent=row["had_bot_opponent"],
        bot_policy_version=row["bot_policy_version"],
        algorithm_version=row["algorithm_version"],
        created_at=row["created_at"],
    )


class PostgresArenaRatingRepository:
    def __init__(self, pool: Any) -> None:
        _require_asyncpg()
        self._pool = pool

    async def get_ratings_for_subs(
        self, owner_subs: Sequence[str], mode: str
    ) -> dict[str, ArenaRating]:
        if not owner_subs:
            return {}
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                f"""
                SELECT {_RATING_COLUMNS} FROM arena_ratings
                 WHERE mode = $1 AND owner_sub = ANY($2::text[])
                """,
                mode, list(owner_subs),
            )
        return {r["owner_sub"]: _row_to_rating(r) for r in rows}

    async def record_match_rating(
        self,
        entries: Sequence[ArenaRatingHistoryEntry],
        now: Optional[datetime] = None,
    ) -> int:
        if not entries:
            return 0
        now = now or datetime.now(timezone.utc)
        written = 0
        async with self._pool.acquire() as conn:
            # One transaction across the whole match: either every seat's change
            # lands or none does, so a crash between two seats cannot leave a
            # half-rated match.
            async with conn.transaction():
                for entry in entries:
                    # ON CONFLICT DO NOTHING against
                    # arena_rating_history_one_per_player_match_idx -- the INDEX
                    # decides, not a prior SELECT. A check-then-write here is
                    # the race two concurrent settlements both win, and the
                    # damage it does (a rating change applied twice) is the one
                    # players never accept.
                    row = await conn.fetchrow(
                        """
                        INSERT INTO arena_rating_history (
                            owner_sub, mode, match_id, pre_rating, pre_rd,
                            pre_volatility, post_rating, post_rd, post_volatility,
                            unbounded_post_rating, bound_applied, placement,
                            opponents, had_bot_opponent, bot_policy_version,
                            algorithm_version, created_at
                        ) VALUES (
                            $1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12,
                            $13::jsonb,$14,$15,$16,$17
                        )
                        ON CONFLICT (owner_sub, match_id) DO NOTHING
                        RETURNING id
                        """,
                        entry.owner_sub, entry.mode, entry.match_id,
                        entry.pre_rating, entry.pre_rd, entry.pre_volatility,
                        entry.post_rating, entry.post_rd, entry.post_volatility,
                        entry.unbounded_post_rating, entry.bound_applied,
                        entry.placement, json.dumps(entry.opponents),
                        entry.had_bot_opponent, entry.bot_policy_version,
                        entry.algorithm_version, now,
                    )
                    if row is None:
                        # Already rated. Skip the ratings update with it, so a
                        # replay cannot advance a rating without a ledger row
                        # that explains why it moved.
                        continue

                    await conn.execute(
                        """
                        INSERT INTO arena_ratings (
                            owner_sub, mode, rating, rd, volatility,
                            rated_matches, algorithm_version,
                            last_rated_match_at, created_at, updated_at
                        ) VALUES ($1,$2,$3,$4,$5,1,$6,$7,$7,$7)
                        ON CONFLICT (owner_sub, mode) DO UPDATE SET
                            rating              = EXCLUDED.rating,
                            rd                  = EXCLUDED.rd,
                            volatility          = EXCLUDED.volatility,
                            rated_matches       = arena_ratings.rated_matches + 1,
                            algorithm_version   = EXCLUDED.algorithm_version,
                            last_rated_match_at = EXCLUDED.last_rated_match_at,
                            updated_at          = EXCLUDED.updated_at
                        """,
                        entry.owner_sub, entry.mode, entry.post_rating,
                        entry.post_rd, entry.post_volatility,
                        entry.algorithm_version, now,
                    )
                    written += 1
        return written

    async def get_leaderboard_page(
        self, mode: str, limit: int = 50, offset: int = 0
    ) -> list[ArenaLeaderboardRow]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT owner_sub, mode, rating, rd, rated_matches, last_rated_match_at
                  FROM arena_ratings
                 WHERE mode = $1 AND rated_matches > 0
                 ORDER BY rating DESC, rated_matches DESC, owner_sub
                 LIMIT $2 OFFSET $3
                """,
                mode, limit, offset,
            )
        return [
            ArenaLeaderboardRow(
                owner_sub=r["owner_sub"],
                mode=r["mode"],
                rating=float(r["rating"]),
                rd=float(r["rd"]),
                rated_matches=r["rated_matches"],
                last_rated_match_at=r["last_rated_match_at"],
            )
            for r in rows
        ]

    async def list_history(
        self, owner_sub: str, mode: Optional[str] = None, limit: int = 50
    ) -> list[ArenaRatingHistoryEntry]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                f"""
                SELECT {_HISTORY_COLUMNS} FROM arena_rating_history
                 WHERE owner_sub = $1 AND ($2::text IS NULL OR mode = $2)
                 ORDER BY id DESC
                 LIMIT $3
                """,
                owner_sub, mode, limit,
            )
        return [_row_to_entry(r) for r in rows]
