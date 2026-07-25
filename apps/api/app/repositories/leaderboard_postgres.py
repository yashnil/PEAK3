"""PostgreSQL-backed PerfectSeasonLeaderboardRepository (Phase 6G Part E).

Connects via the API's own service-role asyncpg pool -- same pattern as
every other Postgres* repository in this package (see postgres.py) and the
same "service-role writes/reads, RLS as defense-in-depth" split documented
in supabase/migrations/20260630130000_ranked_rls.sql. Public/private and
filter logic (mode, no-respin-only) is enforced here in application code,
not delegated to RLS.
"""
from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime
from typing import Any, Optional

from app.repositories.leaderboard_protocols import DuplicateRunSubmission, PerfectSeasonRun

try:
    import asyncpg  # type: ignore[import]
    _ASYNCPG_AVAILABLE = True
except ImportError:
    _ASYNCPG_AVAILABLE = False


def _require_asyncpg() -> None:
    if not _ASYNCPG_AVAILABLE:
        raise RuntimeError("asyncpg is required for PostgreSQL repositories. Install it: pip install asyncpg")


def _encode_cursor(row: dict) -> str:
    total_respins = row["team_respins_used"] + row["season_respins_used"]
    key = [row["wins"], float(row["lineup_score"]), total_respins, row["created_at"].isoformat(), str(row["id"])]
    return base64.urlsafe_b64encode(json.dumps(key).encode()).decode()


def _decode_cursor(cursor: str) -> tuple:
    wins, score, respins, created_at, run_id = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
    return wins, score, respins, created_at, run_id


def _row_to_run(row: Any) -> PerfectSeasonRun:
    return PerfectSeasonRun(
        id=str(row["id"]),
        owner_sub=row["owner_sub"],
        display_name=row["display_name"],
        mode=row["mode"],
        game_id=row["game_id"],
        seed=row["seed"],
        wins=row["wins"],
        losses=row["losses"],
        lineup_score=float(row["lineup_score"]),
        score_status=row["score_status"],
        exact_cards_scored=row["exact_cards_scored"],
        total_cards=row["total_cards"],
        team_respins_used=row["team_respins_used"],
        season_respins_used=row["season_respins_used"],
        roster_card_keys=[],  # populated separately (see get_leaderboard/list_runs_for_owner)
        data_version=row["data_version"],
        formula_version=row["formula_version"],
        simulation_version=row["simulation_version"],
        is_public=row["is_public"],
        created_at=row["created_at"],
        game_type=row["game_type"],
    )


class PostgresPerfectSeasonLeaderboardRepository:
    def __init__(self, pool: Any) -> None:
        _require_asyncpg()
        self._pool = pool

    async def submit_run(self, run: PerfectSeasonRun) -> PerfectSeasonRun:
        run_id = run.id or str(uuid.uuid4())
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                try:
                    await conn.execute(
                        """
                        INSERT INTO perfect_season_runs (
                            id, owner_sub, display_name, mode, game_type, game_id, seed,
                            wins, losses, lineup_score, score_status, exact_cards_scored,
                            total_cards, team_respins_used, season_respins_used,
                            data_version, formula_version, simulation_version, is_public, created_at
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
                        )
                        """,
                        run_id, run.owner_sub, run.display_name, run.mode, run.game_type, run.game_id, run.seed,
                        run.wins, run.losses, run.lineup_score, run.score_status, run.exact_cards_scored,
                        run.total_cards, run.team_respins_used, run.season_respins_used,
                        run.data_version, run.formula_version, run.simulation_version, run.is_public, run.created_at,
                    )
                except asyncpg.UniqueViolationError:
                    raise DuplicateRunSubmission(f"game_id '{run.game_id}' was already submitted")

                for i, card_key in enumerate(run.roster_card_keys):
                    await conn.execute(
                        "INSERT INTO perfect_season_run_cards (run_id, slot_index, card_key) VALUES ($1, $2, $3)",
                        run_id, i, card_key,
                    )
        run.id = run_id
        return run

    async def get_run_by_game_id(self, game_id: str) -> Optional[PerfectSeasonRun]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM perfect_season_runs WHERE game_id = $1", game_id)
            if row is None:
                return None
            run = _row_to_run(row)
            cards = await conn.fetch(
                "SELECT card_key FROM perfect_season_run_cards WHERE run_id = $1 ORDER BY slot_index", row["id"]
            )
            run.roster_card_keys = [c["card_key"] for c in cards]
            return run

    async def get_leaderboard(
        self, mode: Optional[str], no_respin_only: bool, limit: int, cursor: Optional[str]
    ) -> list[PerfectSeasonRun]:
        conditions = ["is_public = TRUE"]
        params: list[Any] = []
        if mode:
            params.append(mode)
            conditions.append(f"mode = ${len(params)}")
        if no_respin_only:
            conditions.append("team_respins_used = 0 AND season_respins_used = 0")

        cursor_clause = ""
        if cursor:
            # Keyset (not OFFSET) pagination on the exact ORDER BY below --
            # wins/lineup_score are DESC, so both sides of the row
            # comparison negate them to express "strictly after the cursor
            # row" as a single ascending ROW(...) > ROW(...) comparison
            # (standard Postgres row-wise lexicographic comparison).
            wins, score, respins, created_at, run_id = _decode_cursor(cursor)
            params.extend([wins, score, respins, created_at, run_id])
            n = len(params)
            cursor_clause = (
                f"AND (-wins, -lineup_score, (team_respins_used + season_respins_used), created_at, id::text) "
                f"> (-${n - 4}, -${n - 3}, ${n - 2}, ${n - 1}::timestamptz, ${n})"
            )

        params.append(limit)
        query = f"""
            SELECT * FROM perfect_season_runs
            WHERE {" AND ".join(conditions)} {cursor_clause}
            ORDER BY wins DESC, lineup_score DESC, (team_respins_used + season_respins_used) ASC, created_at ASC
            LIMIT ${len(params)}
        """
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(query, *params)
            return [_row_to_run(r) for r in rows]

    async def list_runs_for_owner(self, owner_sub: str) -> list[PerfectSeasonRun]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM perfect_season_runs WHERE owner_sub = $1 ORDER BY created_at DESC", owner_sub
            )
            return [_row_to_run(r) for r in rows]
