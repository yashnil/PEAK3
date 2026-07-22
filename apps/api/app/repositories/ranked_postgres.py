"""PostgreSQL repository implementations for Phase 4.0 ranked duels.

Production implementations backed by asyncpg. Row-level locking
(``FOR UPDATE SKIP LOCKED``) is used for matchmaking pairing so two workers
racing to pair the same queue entry cannot both succeed (spec section U).
Settlement is written in one transaction (``commit_settlement``) so a
settlement, its rating-period row, both ledger entries, and both updated
queue-rating/placement rows either all land or none do.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from app.repositories.ranked_protocols import (
    AbortAllowance,
    ActiveQueueEntryExists,
    DuplicateSettlement,
    IntegrityEvent,
    MatchParticipant,
    MatchSubmission,
    OpponentHistoryEntry,
    PlacementState,
    QueueEntry,
    QueueRating,
    RankedMatch,
    RankedSettlement,
    RatingLedgerEntry,
    RatingPeriod,
)
from app.services.ranked.versions import (
    GLICKO2_ALGORITHM_VERSION,
    GLICKO2_INITIAL_RATING,
    GLICKO2_INITIAL_RD,
    GLICKO2_INITIAL_VOLATILITY,
    RANKED_PLACEMENT_MATCH_COUNT,
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


def _row_to_queue_entry(row: Any) -> QueueEntry:
    return QueueEntry(
        id=str(row["id"]),
        owner_sub=row["owner_sub"],
        mode=row["mode"],
        queue_version=row["queue_version"],
        rating_snapshot=float(row["rating_snapshot"]),
        rd_snapshot=float(row["rd_snapshot"]),
        volatility_snapshot=float(row["volatility_snapshot"]),
        placement_state=row["placement_state"],
        status=row["status"],
        joined_at=row["joined_at"],
        search_range_rating=float(row["search_range_rating"]),
        matched_at=row["matched_at"],
        cancelled_at=row["cancelled_at"],
        match_id=str(row["match_id"]) if row["match_id"] else None,
    )


def _row_to_match(row: Any) -> RankedMatch:
    return RankedMatch(
        id=str(row["id"]),
        mode=row["mode"],
        queue_version=row["queue_version"],
        board_snapshot=json.loads(row["board_snapshot"]) if isinstance(row["board_snapshot"], str) else row["board_snapshot"],
        board_version_key=row["board_version_key"],
        rating_algorithm_version=row["rating_algorithm_version"],
        abandonment_policy_version=row["abandonment_policy_version"],
        created_at=row["created_at"],
        matched_at=row["matched_at"],
        deadline=row["deadline"],
        status=row["status"],
        settlement_status=row["settlement_status"],
        integrity_status=row["integrity_status"],
        rating_period_id=str(row["rating_period_id"]) if row["rating_period_id"] else None,
    )


def _row_to_participant(row: Any) -> MatchParticipant:
    return MatchParticipant(
        id=str(row["id"]),
        match_id=str(row["match_id"]),
        owner_sub=row["owner_sub"],
        slot=row["slot"],
        status=row["status"],
        joined_at=row["joined_at"],
        pre_match_rating=float(row["pre_match_rating"]),
        pre_match_rd=float(row["pre_match_rd"]),
        pre_match_volatility=float(row["pre_match_volatility"]),
        game_id=str(row["game_id"]) if row["game_id"] else None,
        completed_at=row["completed_at"],
        abandonment_state=row["abandonment_state"],
        post_match_rating=float(row["post_match_rating"]) if row["post_match_rating"] is not None else None,
        post_match_rd=float(row["post_match_rd"]) if row["post_match_rd"] is not None else None,
        post_match_volatility=float(row["post_match_volatility"]) if row["post_match_volatility"] is not None else None,
    )


def _row_to_submission(row: Any) -> MatchSubmission:
    return MatchSubmission(
        id=str(row["id"]),
        match_id=str(row["match_id"]),
        participant_id=str(row["participant_id"]),
        owner_sub=row["owner_sub"],
        game_id=str(row["game_id"]),
        board_version_key=row["board_version_key"],
        lineup_evaluation=json.loads(row["lineup_evaluation"]) if isinstance(row["lineup_evaluation"], str) else row["lineup_evaluation"],
        solver_version=row["solver_version"],
        submitted_at=row["submitted_at"],
        idempotency_key=row["idempotency_key"],
    )


class PostgresRankedMatchmakingRepository:
    def __init__(self, pool: Any) -> None:
        _require_asyncpg()
        self._pool = pool

    async def join_queue(self, entry: QueueEntry) -> QueueEntry:
        async with self._pool.acquire() as conn:
            try:
                row = await conn.fetchrow(
                    """
                    INSERT INTO ranked_queue_entries
                        (id, owner_sub, mode, queue_version, rating_snapshot, rd_snapshot,
                         volatility_snapshot, placement_state, status, joined_at, search_range_rating)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    RETURNING *
                    """,
                    entry.id, entry.owner_sub, entry.mode, entry.queue_version,
                    entry.rating_snapshot, entry.rd_snapshot, entry.volatility_snapshot,
                    entry.placement_state, entry.status, entry.joined_at, entry.search_range_rating,
                )
            except asyncpg.UniqueViolationError as exc:
                raise ActiveQueueEntryExists(
                    f"{entry.owner_sub} already has an active entry in queue {entry.mode}"
                ) from exc
            return _row_to_queue_entry(row)

    async def cancel_queue_entry(self, owner_sub: str, mode: str) -> bool:
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                """
                UPDATE ranked_queue_entries SET status = 'cancelled', cancelled_at = NOW()
                WHERE owner_sub = $1 AND mode = $2 AND status = 'waiting'
                """,
                owner_sub, mode,
            )
            return result.endswith("1")

    async def get_active_queue_entry(self, owner_sub: str, mode: str) -> QueueEntry | None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM ranked_queue_entries WHERE owner_sub = $1 AND mode = $2 AND status = 'waiting'",
                owner_sub, mode,
            )
            return _row_to_queue_entry(row) if row else None

    async def list_waiting_entries(self, mode: str, exclude_owner_sub: str) -> list[QueueEntry]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT * FROM ranked_queue_entries
                WHERE mode = $1 AND status = 'waiting' AND owner_sub != $2
                ORDER BY joined_at ASC
                """,
                mode, exclude_owner_sub,
            )
            return [_row_to_queue_entry(r) for r in rows]

    async def recent_opponents(self, owner_sub: str, mode: str, since: datetime) -> set[str]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT opponent_sub FROM ranked_opponent_history WHERE owner_sub = $1 AND mode = $2 AND paired_at >= $3",
                owner_sub, mode, since,
            )
            return {r["opponent_sub"] for r in rows}

    async def create_match_atomically(
        self,
        entry_a_id: str,
        entry_b_id: str,
        match: RankedMatch,
        participant_a: MatchParticipant,
        participant_b: MatchParticipant,
    ) -> RankedMatch | None:
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                # SKIP LOCKED: if a concurrent worker already holds a lock on
                # either row, this returns fewer than 2 rows rather than
                # blocking — the caller then knows this pairing attempt lost
                # the race and must try a different candidate.
                rows = await conn.fetch(
                    """
                    SELECT id FROM ranked_queue_entries
                    WHERE id = ANY($1::uuid[]) AND status = 'waiting'
                    FOR UPDATE SKIP LOCKED
                    """,
                    [entry_a_id, entry_b_id],
                )
                if len(rows) != 2:
                    return None

                await conn.execute(
                    """
                    INSERT INTO ranked_matches
                        (id, mode, queue_version, board_snapshot, board_version_key,
                         rating_algorithm_version, abandonment_policy_version,
                         created_at, matched_at, deadline, status, settlement_status, integrity_status)
                    VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                    """,
                    match.id, match.mode, match.queue_version, json.dumps(match.board_snapshot),
                    match.board_version_key, match.rating_algorithm_version,
                    match.abandonment_policy_version, match.created_at, match.matched_at,
                    match.deadline, match.status, match.settlement_status, match.integrity_status,
                )

                for p in (participant_a, participant_b):
                    await conn.execute(
                        """
                        INSERT INTO ranked_match_participants
                            (id, match_id, owner_sub, slot, status, joined_at,
                             pre_match_rating, pre_match_rd, pre_match_volatility)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                        """,
                        p.id, p.match_id, p.owner_sub, p.slot, p.status, p.joined_at,
                        p.pre_match_rating, p.pre_match_rd, p.pre_match_volatility,
                    )

                await conn.execute(
                    "UPDATE ranked_queue_entries SET status = 'matched', matched_at = NOW(), match_id = $1 WHERE id = $2",
                    match.id, entry_a_id,
                )
                await conn.execute(
                    "UPDATE ranked_queue_entries SET status = 'matched', matched_at = NOW(), match_id = $1 WHERE id = $2",
                    match.id, entry_b_id,
                )

                return match

    async def get_match(self, match_id: str) -> RankedMatch | None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM ranked_matches WHERE id = $1", match_id)
            return _row_to_match(row) if row else None

    async def get_participants(self, match_id: str) -> list[MatchParticipant]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch("SELECT * FROM ranked_match_participants WHERE match_id = $1", match_id)
            return [_row_to_participant(r) for r in rows]

    async def get_participant(self, match_id: str, owner_sub: str) -> MatchParticipant | None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM ranked_match_participants WHERE match_id = $1 AND owner_sub = $2",
                match_id, owner_sub,
            )
            return _row_to_participant(row) if row else None

    async def set_participant_game(self, match_id: str, owner_sub: str, game_id: str) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                "UPDATE ranked_match_participants SET game_id = $1 WHERE match_id = $2 AND owner_sub = $3",
                game_id, match_id, owner_sub,
            )

    async def set_participant_status(
        self, match_id: str, owner_sub: str, status: str, completed_at: datetime | None = None
    ) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                "UPDATE ranked_match_participants SET status = $1, completed_at = COALESCE($2, completed_at) WHERE match_id = $3 AND owner_sub = $4",
                status, completed_at, match_id, owner_sub,
            )

    async def set_participant_post_match_rating(
        self, match_id: str, owner_sub: str, rating: float, rd: float, volatility: float
    ) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE ranked_match_participants
                SET post_match_rating = $1, post_match_rd = $2, post_match_volatility = $3
                WHERE match_id = $4 AND owner_sub = $5
                """,
                rating, rd, volatility, match_id, owner_sub,
            )

    async def record_submission(self, submission: MatchSubmission) -> MatchSubmission:
        async with self._pool.acquire() as conn:
            existing = await conn.fetchrow(
                "SELECT * FROM ranked_match_submissions WHERE match_id = $1 AND owner_sub = $2",
                submission.match_id, submission.owner_sub,
            )
            if existing:
                return _row_to_submission(existing)
            row = await conn.fetchrow(
                """
                INSERT INTO ranked_match_submissions
                    (id, match_id, participant_id, owner_sub, game_id, board_version_key,
                     lineup_evaluation, solver_version, submitted_at, idempotency_key)
                VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
                ON CONFLICT (match_id, idempotency_key) DO UPDATE SET match_id = EXCLUDED.match_id
                RETURNING *
                """,
                submission.id, submission.match_id, submission.participant_id, submission.owner_sub,
                submission.game_id, submission.board_version_key, json.dumps(submission.lineup_evaluation),
                submission.solver_version, submission.submitted_at, submission.idempotency_key,
            )
            return _row_to_submission(row)

    async def get_submission(self, match_id: str, owner_sub: str) -> MatchSubmission | None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM ranked_match_submissions WHERE match_id = $1 AND owner_sub = $2",
                match_id, owner_sub,
            )
            return _row_to_submission(row) if row else None

    async def list_submissions(self, match_id: str) -> list[MatchSubmission]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch("SELECT * FROM ranked_match_submissions WHERE match_id = $1", match_id)
            return [_row_to_submission(r) for r in rows]

    async def set_match_status(
        self,
        match_id: str,
        status: str,
        settlement_status: str | None = None,
        integrity_status: str | None = None,
    ) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE ranked_matches SET
                    status = $1,
                    settlement_status = COALESCE($2, settlement_status),
                    integrity_status = COALESCE($3, integrity_status)
                WHERE id = $4
                """,
                status, settlement_status, integrity_status, match_id,
            )

    async def set_match_rating_period(self, match_id: str, rating_period_id: str) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                "UPDATE ranked_matches SET rating_period_id = $1 WHERE id = $2",
                rating_period_id, match_id,
            )

    async def record_opponent_history(self, entry: OpponentHistoryEntry) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO ranked_opponent_history (owner_sub, opponent_sub, mode, match_id, paired_at)
                VALUES ($1, $2, $3, $4, $5)
                """,
                entry.owner_sub, entry.opponent_sub, entry.mode, entry.match_id, entry.paired_at,
            )

    async def list_active_matches_for_user(self, owner_sub: str) -> list[RankedMatch]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT m.* FROM ranked_matches m
                JOIN ranked_match_participants p ON p.match_id = m.id
                WHERE p.owner_sub = $1
                  AND m.status NOT IN ('settled', 'cancelled', 'expired', 'invalidated')
                """,
                owner_sub,
            )
            return [_row_to_match(r) for r in rows]

    async def count_pending_matches(self) -> int:
        async with self._pool.acquire() as conn:
            return await conn.fetchval(
                "SELECT COUNT(*) FROM ranked_matches WHERE status NOT IN ('settled', 'cancelled', 'expired', 'invalidated')"
            )


class PostgresRankedRatingRepository:
    def __init__(self, pool: Any) -> None:
        _require_asyncpg()
        self._pool = pool

    async def create_rating_period(self, period: RatingPeriod) -> RatingPeriod:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO rating_periods (id, mode, queue_version, match_id, algorithm_version, opened_at)
                VALUES ($1, $2, $3, $4, $5, $6)
                """,
                period.id, period.mode, period.queue_version, period.match_id,
                period.algorithm_version, period.opened_at,
            )
            return period

    async def create_settlement(self, settlement: RankedSettlement) -> RankedSettlement:
        async with self._pool.acquire() as conn:
            try:
                await self._insert_settlement(conn, settlement)
            except asyncpg.UniqueViolationError as exc:
                raise DuplicateSettlement(f"match {settlement.match_id} is already settled") from exc
            return settlement

    async def _insert_settlement(self, conn: Any, settlement: RankedSettlement) -> None:
        await conn.execute(
            """
            INSERT INTO ranked_match_settlements (
                id, match_id, rating_period_id, settlement_algorithm_version, board_version_key,
                primary_comparison, participant_a_sub, participant_b_sub,
                participant_a_score, participant_b_score,
                participant_a_draft_efficiency, participant_b_draft_efficiency,
                participant_a_solver_version, participant_b_solver_version,
                tie_break_used, outcome, integrity_decision, audit_metadata, created_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19)
            """,
            settlement.id, settlement.match_id, settlement.rating_period_id,
            settlement.settlement_algorithm_version, settlement.board_version_key,
            settlement.primary_comparison, settlement.participant_a_sub, settlement.participant_b_sub,
            settlement.participant_a_score, settlement.participant_b_score,
            settlement.participant_a_draft_efficiency, settlement.participant_b_draft_efficiency,
            settlement.participant_a_solver_version, settlement.participant_b_solver_version,
            settlement.tie_break_used, settlement.outcome, settlement.integrity_decision,
            json.dumps(settlement.audit_metadata), settlement.created_at,
        )

    async def get_settlement(self, match_id: str) -> RankedSettlement | None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM ranked_match_settlements WHERE match_id = $1", match_id)
            if not row:
                return None
            return RankedSettlement(
                id=str(row["id"]), match_id=str(row["match_id"]), rating_period_id=str(row["rating_period_id"]),
                settlement_algorithm_version=row["settlement_algorithm_version"], board_version_key=row["board_version_key"],
                participant_a_sub=row["participant_a_sub"], participant_b_sub=row["participant_b_sub"],
                participant_a_score=float(row["participant_a_score"]), participant_b_score=float(row["participant_b_score"]),
                participant_a_solver_version=row["participant_a_solver_version"],
                participant_b_solver_version=row["participant_b_solver_version"],
                outcome=row["outcome"], created_at=row["created_at"],
                primary_comparison=row["primary_comparison"],
                participant_a_draft_efficiency=float(row["participant_a_draft_efficiency"]) if row["participant_a_draft_efficiency"] is not None else None,
                participant_b_draft_efficiency=float(row["participant_b_draft_efficiency"]) if row["participant_b_draft_efficiency"] is not None else None,
                tie_break_used=row["tie_break_used"], integrity_decision=row["integrity_decision"],
                audit_metadata=json.loads(row["audit_metadata"]) if isinstance(row["audit_metadata"], str) else row["audit_metadata"],
            )

    async def get_queue_rating(self, owner_sub: str, mode: str) -> QueueRating:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM queue_ratings WHERE owner_sub = $1 AND mode = $2", owner_sub, mode)
            if row:
                return QueueRating(
                    owner_sub=row["owner_sub"], mode=row["mode"], rating=float(row["rating"]),
                    rd=float(row["rd"]), volatility=float(row["volatility"]),
                    algorithm_version=row["algorithm_version"], valid_rated_matches=row["valid_rated_matches"],
                    established=row["established"], last_rated_activity_at=row["last_rated_activity_at"],
                    updated_at=row["updated_at"],
                )
            return QueueRating(
                owner_sub=owner_sub, mode=mode, rating=GLICKO2_INITIAL_RATING, rd=GLICKO2_INITIAL_RD,
                volatility=GLICKO2_INITIAL_VOLATILITY, algorithm_version=GLICKO2_ALGORITHM_VERSION,
                valid_rated_matches=0, established=False,
            )

    async def append_ledger_entry(self, entry: RatingLedgerEntry) -> RatingLedgerEntry:
        async with self._pool.acquire() as conn:
            return await self._insert_ledger_entry(conn, entry)

    async def _insert_ledger_entry(self, conn: Any, entry: RatingLedgerEntry) -> RatingLedgerEntry:
        row = await conn.fetchrow(
            """
            INSERT INTO rating_ledger_entries (
                owner_sub, mode, match_id, rating_period_id, pre_rating, pre_rd, pre_volatility,
                opponent_sub, opponent_pre_rating, opponent_pre_rd, opponent_pre_volatility,
                outcome, post_rating, post_rd, post_volatility, algorithm_version, entry_type,
                reversal_of_entry_id, reversal_reason, created_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
            RETURNING id
            """,
            entry.owner_sub, entry.mode, entry.match_id, entry.rating_period_id,
            entry.pre_rating, entry.pre_rd, entry.pre_volatility, entry.opponent_sub,
            entry.opponent_pre_rating, entry.opponent_pre_rd, entry.opponent_pre_volatility,
            entry.outcome, entry.post_rating, entry.post_rd, entry.post_volatility,
            entry.algorithm_version, entry.entry_type, entry.reversal_of_entry_id,
            entry.reversal_reason, entry.created_at,
        )
        entry.id = row["id"]
        return entry

    async def list_ledger_entries(self, owner_sub: str, mode: str) -> list[RatingLedgerEntry]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM rating_ledger_entries WHERE owner_sub = $1 AND mode = $2 ORDER BY id ASC",
                owner_sub, mode,
            )
            return [_row_to_ledger_entry(r) for r in rows]

    async def list_all_ledger_entries(self, mode: str) -> list[RatingLedgerEntry]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM rating_ledger_entries WHERE mode = $1 ORDER BY id ASC", mode,
            )
            return [_row_to_ledger_entry(r) for r in rows]

    async def update_queue_rating(self, rating: QueueRating) -> None:
        async with self._pool.acquire() as conn:
            await self._upsert_queue_rating(conn, rating)

    async def _upsert_queue_rating(self, conn: Any, rating: QueueRating) -> None:
        await conn.execute(
            """
            INSERT INTO queue_ratings (owner_sub, mode, rating, rd, volatility, valid_rated_matches,
                                       established, algorithm_version, last_rated_activity_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
            ON CONFLICT (owner_sub, mode) DO UPDATE SET
                rating = EXCLUDED.rating, rd = EXCLUDED.rd, volatility = EXCLUDED.volatility,
                valid_rated_matches = EXCLUDED.valid_rated_matches, established = EXCLUDED.established,
                algorithm_version = EXCLUDED.algorithm_version,
                last_rated_activity_at = EXCLUDED.last_rated_activity_at, updated_at = NOW()
            """,
            rating.owner_sub, rating.mode, rating.rating, rating.rd, rating.volatility,
            rating.valid_rated_matches, rating.established, rating.algorithm_version,
            rating.last_rated_activity_at,
        )

    async def get_placement_state(self, owner_sub: str, mode: str) -> PlacementState:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM placement_states WHERE owner_sub = $1 AND mode = $2", owner_sub, mode)
            if row:
                return PlacementState(
                    owner_sub=row["owner_sub"], mode=row["mode"],
                    valid_matches_completed=row["valid_matches_completed"],
                    required_matches=row["required_matches"], established=row["established"],
                    established_at=row["established_at"],
                )
            return PlacementState(owner_sub=owner_sub, mode=mode, required_matches=RANKED_PLACEMENT_MATCH_COUNT)

    async def update_placement_state(self, state: PlacementState) -> None:
        async with self._pool.acquire() as conn:
            await self._upsert_placement_state(conn, state)

    async def _upsert_placement_state(self, conn: Any, state: PlacementState) -> None:
        await conn.execute(
            """
            INSERT INTO placement_states (owner_sub, mode, valid_matches_completed, required_matches, established, established_at)
            VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT (owner_sub, mode) DO UPDATE SET
                valid_matches_completed = EXCLUDED.valid_matches_completed,
                required_matches = EXCLUDED.required_matches,
                established = EXCLUDED.established,
                established_at = EXCLUDED.established_at
            """,
            state.owner_sub, state.mode, state.valid_matches_completed,
            state.required_matches, state.established, state.established_at,
        )

    async def get_leaderboard(
        self, mode: str, limit: int, after: tuple[float, float, int, str] | None
    ) -> list[QueueRating]:
        # Ranking key per spec section M: rating desc, RD asc, valid-match
        # count desc (deterministic tie-break), owner_sub asc (pagination
        # only). The row-value comparison below must include every column
        # in that exact order — omitting rd/valid_rated_matches previously
        # let a row with a tied rating re-appear across a page boundary.
        async with self._pool.acquire() as conn:
            if after is not None:
                after_rating, after_rd, after_valid_matches, after_owner_sub = after
                rows = await conn.fetch(
                    """
                    SELECT * FROM queue_ratings WHERE mode = $1
                      AND (-rating, rd, -valid_rated_matches, owner_sub) > ($2, $3, $4, $5)
                    ORDER BY rating DESC, rd ASC, valid_rated_matches DESC, owner_sub ASC
                    LIMIT $6
                    """,
                    mode, -after_rating, after_rd, -after_valid_matches, after_owner_sub, limit,
                )
            else:
                rows = await conn.fetch(
                    "SELECT * FROM queue_ratings WHERE mode = $1 ORDER BY rating DESC, rd ASC, valid_rated_matches DESC, owner_sub ASC LIMIT $2",
                    mode, limit,
                )
            return [
                QueueRating(
                    owner_sub=r["owner_sub"], mode=r["mode"], rating=float(r["rating"]), rd=float(r["rd"]),
                    volatility=float(r["volatility"]), algorithm_version=r["algorithm_version"],
                    valid_rated_matches=r["valid_rated_matches"], established=r["established"],
                    last_rated_activity_at=r["last_rated_activity_at"], updated_at=r["updated_at"],
                )
                for r in rows
            ]

    async def count_pending_settlements(self) -> int:
        async with self._pool.acquire() as conn:
            return await conn.fetchval(
                "SELECT COUNT(*) FROM ranked_matches WHERE status = 'settlement_pending'"
            )

    async def last_settlement_time(self) -> datetime | None:
        async with self._pool.acquire() as conn:
            return await conn.fetchval("SELECT MAX(created_at) FROM ranked_match_settlements")

    async def count_settled_matches(self, mode: str) -> int:
        async with self._pool.acquire() as conn:
            return await conn.fetchval(
                "SELECT COUNT(*) FROM ranked_match_settlements s JOIN rating_periods p ON p.id = s.rating_period_id WHERE p.mode = $1",
                mode,
            )

    async def commit_settlement(
        self,
        period: RatingPeriod,
        settlement: RankedSettlement,
        ledger_entries: list[RatingLedgerEntry],
        queue_ratings: list[QueueRating],
        placement_states: list[PlacementState],
    ) -> RankedSettlement:
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    "INSERT INTO rating_periods (id, mode, queue_version, match_id, algorithm_version, opened_at) VALUES ($1,$2,$3,$4,$5,$6)",
                    period.id, period.mode, period.queue_version, period.match_id,
                    period.algorithm_version, period.opened_at,
                )
                try:
                    await self._insert_settlement(conn, settlement)
                except asyncpg.UniqueViolationError as exc:
                    raise DuplicateSettlement(f"match {settlement.match_id} is already settled") from exc

                for entry in ledger_entries:
                    await self._insert_ledger_entry(conn, entry)
                for rating in queue_ratings:
                    await self._upsert_queue_rating(conn, rating)
                for state in placement_states:
                    await self._upsert_placement_state(conn, state)

                await conn.execute(
                    "UPDATE ranked_matches SET status = 'settled', settlement_status = 'settled', rating_period_id = $1 WHERE id = $2",
                    period.id, settlement.match_id,
                )

                return settlement


def _row_to_ledger_entry(row: Any) -> RatingLedgerEntry:
    return RatingLedgerEntry(
        id=row["id"], owner_sub=row["owner_sub"], mode=row["mode"], match_id=str(row["match_id"]),
        rating_period_id=str(row["rating_period_id"]), pre_rating=float(row["pre_rating"]),
        pre_rd=float(row["pre_rd"]), pre_volatility=float(row["pre_volatility"]),
        opponent_sub=row["opponent_sub"], opponent_pre_rating=float(row["opponent_pre_rating"]),
        opponent_pre_rd=float(row["opponent_pre_rd"]), opponent_pre_volatility=float(row["opponent_pre_volatility"]),
        outcome=float(row["outcome"]), post_rating=float(row["post_rating"]), post_rd=float(row["post_rd"]),
        post_volatility=float(row["post_volatility"]), algorithm_version=row["algorithm_version"],
        entry_type=row["entry_type"], reversal_of_entry_id=row["reversal_of_entry_id"],
        reversal_reason=row["reversal_reason"], created_at=row["created_at"],
    )


class PostgresRankedIntegrityRepository:
    def __init__(self, pool: Any) -> None:
        _require_asyncpg()
        self._pool = pool

    async def record_integrity_event(self, event: IntegrityEvent) -> IntegrityEvent:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO ranked_integrity_events (id, match_id, owner_sub, event_type, severity, details, created_at)
                VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
                """,
                event.id, event.match_id, event.owner_sub, event.event_type, event.severity,
                json.dumps(event.details), event.created_at,
            )
            return event

    async def list_integrity_events(
        self, owner_sub: str | None = None, match_id: str | None = None
    ) -> list[IntegrityEvent]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM ranked_integrity_events WHERE ($1::text IS NULL OR owner_sub = $1) AND ($2::uuid IS NULL OR match_id = $2)",
                owner_sub, match_id,
            )
            return [
                IntegrityEvent(
                    id=str(r["id"]), event_type=r["event_type"], severity=r["severity"],
                    details=json.loads(r["details"]) if isinstance(r["details"], str) else r["details"],
                    created_at=r["created_at"], match_id=str(r["match_id"]) if r["match_id"] else None,
                    owner_sub=r["owner_sub"], resolved_at=r["resolved_at"], resolution=r["resolution"],
                )
                for r in rows
            ]

    async def has_unresolved_integrity(self, owner_sub: str) -> bool:
        async with self._pool.acquire() as conn:
            return await conn.fetchval(
                "SELECT EXISTS(SELECT 1 FROM ranked_integrity_events WHERE owner_sub = $1 AND resolved_at IS NULL AND severity = 'severe')",
                owner_sub,
            )

    async def grant_abort_allowance(self, allowance: AbortAllowance) -> AbortAllowance:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO ranked_abort_allowances (id, owner_sub, mode, match_id, granted_at, granted_by, reason)
                VALUES ($1,$2,$3,$4,$5,$6,$7)
                """,
                allowance.id, allowance.owner_sub, allowance.mode, allowance.match_id,
                allowance.granted_at, allowance.granted_by, allowance.reason,
            )
            return allowance

    async def consume_abort_allowance(self, owner_sub: str, match_id: str) -> bool:
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                """
                UPDATE ranked_abort_allowances SET consumed_at = NOW()
                WHERE id = (
                    SELECT id FROM ranked_abort_allowances
                    WHERE owner_sub = $1 AND consumed_at IS NULL AND (match_id IS NULL OR match_id = $2)
                    ORDER BY granted_at ASC LIMIT 1
                )
                """,
                owner_sub, match_id,
            )
            return result.endswith("1")


async def create_ranked_pool(database_url: str) -> Any:
    _require_asyncpg()
    return await asyncpg.create_pool(database_url)


def new_id() -> str:
    return str(uuid.uuid4())
