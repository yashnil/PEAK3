"""PostgreSQL-backed PerfectSeasonSavedRunRepository (Phase 9A).

Connects via the API's own service-role asyncpg pool -- same pattern as
every other Postgres* repository in this package (see postgres.py /
leaderboard_postgres.py) and the same "service-role writes/reads, RLS as
defense-in-depth" split documented in
supabase/migrations/20260630130000_ranked_rls.sql. Owner scoping is enforced
here in application code (every query filters on owner_sub); the RLS
policies in the migration are a second, independent layer.

Personal-best tiebreakers are NOT reimplemented in SQL -- get_personal_bests
fetches the owner's runs and ranks them with the shared
saved_run_ranking.py helpers, so dev/CI (in-memory) and production
(Postgres) can never disagree about what "your best run" means. A user's
own run count is bounded in practice and always owner-scoped, so this stays
a small, indexed read rather than a table scan.
"""
from __future__ import annotations

import json
import uuid
from typing import Any, Optional

from app.repositories.saved_run_protocols import PersonalBests, SavedRun
from app.repositories.saved_run_ranking import best_of, is_officially_scored

try:
    import asyncpg  # type: ignore[import]
    _ASYNCPG_AVAILABLE = True
except ImportError:
    _ASYNCPG_AVAILABLE = False


def _require_asyncpg() -> None:
    if not _ASYNCPG_AVAILABLE:
        raise RuntimeError("asyncpg is required for PostgreSQL repositories. Install it: pip install asyncpg")


def _json_list(raw: Any) -> list[dict]:
    """asyncpg returns JSONB as a str unless a codec is registered -- decode
    defensively so this works with or without one."""
    if raw is None:
        return []
    if isinstance(raw, (list, tuple)):
        return list(raw)
    if isinstance(raw, (str, bytes)):
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError):
            return []
        return parsed if isinstance(parsed, list) else []
    return []


def _row_to_run(row: Any) -> SavedRun:
    return SavedRun(
        id=str(row["id"]),
        owner_sub=row["owner_sub"],
        game_id=row["game_id"],
        mode=row["mode"],
        seed=row["seed"],
        wins=row["wins"],
        losses=row["losses"],
        lineup_score=float(row["lineup_score"]),
        score_status=row["score_status"],
        exact_cards_scored=row["exact_cards_scored"],
        total_cards=row["total_cards"],
        leaderboard_eligible=row["leaderboard_eligible"],
        challenge_kind=row["challenge_kind"],
        challenge_date=row["challenge_date"],
        is_perfect_season=row["is_perfect_season"],
        team_respins_used=row["team_respins_used"],
        season_respins_used=row["season_respins_used"],
        roster=_json_list(row["roster"]),
        spin_history=_json_list(row["spin_history"]),
        peak_picks_matched=row["peak_picks_matched"],
        peak_picks_total=row["peak_picks_total"],
        data_version=row["data_version"],
        formula_version=row["formula_version"],
        simulation_version=row["simulation_version"],
        created_at=row["created_at"],
    )


class PostgresPerfectSeasonSavedRunRepository:
    def __init__(self, pool: Any) -> None:
        _require_asyncpg()
        self._pool = pool

    async def save_run(self, run: SavedRun) -> SavedRun:
        existing = await self.get_run_by_game_id(run.owner_sub, run.game_id)
        if existing is not None:
            # Idempotent by (owner_sub, game_id) -- see the protocol's own
            # docstring. The UNIQUE constraint below is the authoritative
            # guard; this check just avoids a pointless failed INSERT on the
            # common double-click path.
            return existing

        run_id = run.id or str(uuid.uuid4())
        async with self._pool.acquire() as conn:
            try:
                await conn.execute(
                    """
                    INSERT INTO perfect_season_saved_runs (
                        id, owner_sub, game_id, mode, seed, wins, losses, lineup_score,
                        score_status, exact_cards_scored, total_cards, leaderboard_eligible,
                        challenge_kind, challenge_date, is_perfect_season,
                        team_respins_used, season_respins_used, roster, spin_history,
                        peak_picks_matched, peak_picks_total,
                        data_version, formula_version, simulation_version, created_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                        $16, $17, $18::jsonb, $19::jsonb, $20, $21, $22, $23, $24, $25
                    )
                    """,
                    run_id, run.owner_sub, run.game_id, run.mode, run.seed, run.wins, run.losses,
                    run.lineup_score, run.score_status, run.exact_cards_scored, run.total_cards,
                    run.leaderboard_eligible, run.challenge_kind, run.challenge_date,
                    run.is_perfect_season, run.team_respins_used, run.season_respins_used,
                    json.dumps(run.roster), json.dumps(run.spin_history),
                    run.peak_picks_matched, run.peak_picks_total,
                    run.data_version, run.formula_version, run.simulation_version, run.created_at,
                )
            except asyncpg.UniqueViolationError:
                # Concurrent double-save -- return whichever write won.
                saved = await self.get_run_by_game_id(run.owner_sub, run.game_id)
                if saved is not None:
                    return saved
                raise
        run.id = run_id
        return run

    async def get_run_by_game_id(self, owner_sub: str, game_id: str) -> Optional[SavedRun]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM perfect_season_saved_runs WHERE owner_sub = $1 AND game_id = $2",
                owner_sub, game_id,
            )
            return _row_to_run(row) if row is not None else None

    async def list_runs_for_owner(self, owner_sub: str, limit: int = 25) -> list[SavedRun]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT * FROM perfect_season_saved_runs
                WHERE owner_sub = $1
                ORDER BY created_at DESC, id DESC
                LIMIT $2
                """,
                owner_sub, limit,
            )
            return [_row_to_run(r) for r in rows]

    async def _all_runs_for_owner(self, owner_sub: str) -> list[SavedRun]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM perfect_season_saved_runs WHERE owner_sub = $1", owner_sub
            )
            return [_row_to_run(r) for r in rows]

    async def get_personal_bests(self, owner_sub: str, recent_limit: int = 5) -> PersonalBests:
        rows = await self._all_runs_for_owner(owner_sub)
        if not rows:
            return PersonalBests()

        scored_rows = [r for r in rows if is_officially_scored(r)]
        best_score_run = max(scored_rows, key=lambda r: r.lineup_score) if scored_rows else None
        daily_rows = [r for r in rows if r.challenge_kind == "daily"]
        recent = sorted(rows, key=lambda r: (r.created_at, r.id), reverse=True)[:recent_limit]

        return PersonalBests(
            total_runs=len(rows),
            best_run=best_of(rows),
            best_wins=max(r.wins for r in rows),
            best_lineup_score=best_score_run.lineup_score if best_score_run else None,
            best_lineup_score_run=best_score_run,
            best_daily_run=best_of(daily_rows),
            perfect_season_count=sum(1 for r in rows if r.is_perfect_season),
            recent_runs=recent,
        )

    async def count_daily_attempts(self, owner_sub: str, challenge_date: str, mode: str) -> int:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT COUNT(*) AS n FROM perfect_season_saved_runs
                WHERE owner_sub = $1 AND challenge_kind = 'daily'
                  AND challenge_date = $2 AND mode = $3
                """,
                owner_sub, challenge_date, mode,
            )
            return int(row["n"]) if row else 0
