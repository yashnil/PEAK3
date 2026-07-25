"""FastAPI dependency injection for repositories and authentication.

Production:
  - DATABASE_URL set → PostgreSQL-backed repositories
  - DEBUG=False + no DATABASE_URL → startup error

Development / tests:
  - DATABASE_URL unset + DEBUG=True → in-memory repositories (with warning)
"""
from __future__ import annotations

import warnings
from functools import lru_cache
from typing import Annotated

from fastapi import Depends, Request

from app.core.config import settings
from app.repositories.memory import (
    MemoryChallengeRepository,
    MemoryCourtLineupRepository,
    MemoryDailyCompletionRepository,
    MemoryGameRepository,
    MemoryOwnershipClaimRepository,
    MemoryResultSnapshotRepository,
)
from app.repositories.memory_progression import (
    MemoryAchievementRepository,
    MemoryPersonalRecordRepository,
    MemoryProgressionRepository,
    MemoryStreakRepository,
)
from app.repositories.protocols import (
    ChallengeRepository,
    CourtLineupRepository,
    DailyCompletionRepository,
    GameRepository,
    OwnershipClaimRepository,
    ResultSnapshotRepository,
)
from app.repositories.progression_protocols import (
    AchievementRepository,
    PersonalRecordRepository,
    ProgressionRepository,
    StreakRepository,
)
from app.repositories.memory_profile import MemoryProfileRepository
from app.repositories.profile_protocols import ProfileRepository
from app.repositories.ranked_memory import (
    MemoryRankedIntegrityRepository,
    MemoryRankedMatchmakingRepository,
    MemoryRankedRatingRepository,
)
from app.repositories.ranked_protocols import (
    RankedIntegrityRepository,
    RankedMatchmakingRepository,
    RankedRatingRepository,
)
from app.repositories.leaderboard_memory import MemoryPerfectSeasonLeaderboardRepository
from app.repositories.leaderboard_protocols import PerfectSeasonLeaderboardRepository

# ---------------------------------------------------------------------------
# Singleton in-memory stores (only used when DATABASE_URL is unset in dev)
# ---------------------------------------------------------------------------

_memory_game_repo = MemoryGameRepository()
_memory_court_lineup_repo = MemoryCourtLineupRepository()
_memory_challenge_repo = MemoryChallengeRepository()
_memory_daily_completion_repo = MemoryDailyCompletionRepository()
_memory_result_snapshot_repo = MemoryResultSnapshotRepository()
_memory_ownership_claim_repo = MemoryOwnershipClaimRepository()
_memory_progression_repo = MemoryProgressionRepository()
_memory_record_repo = MemoryPersonalRecordRepository()
_memory_achievement_repo = MemoryAchievementRepository()
_memory_streak_repo = MemoryStreakRepository()
_memory_profile_repo = MemoryProfileRepository()

# Ranked repositories are always async (see ranked_protocols.py docstring), so
# the in-memory singletons below are shared across requests just like the
# other memory repos above — no per-request state, safe under asyncio's
# single-threaded event loop plus this module's internal asyncio.Lock use.
_memory_ranked_matchmaking_repo = MemoryRankedMatchmakingRepository()
_memory_ranked_rating_repo = MemoryRankedRatingRepository()
_memory_ranked_integrity_repo = MemoryRankedIntegrityRepository()
_memory_perfect_season_leaderboard_repo = MemoryPerfectSeasonLeaderboardRepository()


# ---------------------------------------------------------------------------
# Repository providers
# ---------------------------------------------------------------------------


def get_game_repo(request: Request) -> GameRepository:
    """Return the active GameRepository (Postgres or in-memory)."""
    pool = getattr(request.app.state, "db_pool", None)
    if pool is not None:
        from app.repositories.postgres import PostgresGameRepository
        return PostgresGameRepository(pool)
    _warn_memory_repo("GameRepository")
    return _memory_game_repo


def get_court_lineup_repo(request: Request) -> CourtLineupRepository:
    """Return the active CourtLineupRepository (Postgres or in-memory).

    Not registered in app.core.repository_registry.REPOSITORY_DOMAINS yet --
    CourtBuilder is feature-flagged off by default (COURTBUILDER_ENABLED)
    and this is a Phase 5C vertical slice, not yet promoted to the same
    production-readiness gate as the domains ranked/history depend on. See
    docs/implementation/PHASE_5_COURTBUILDER_VERTICAL_SLICE.md.
    """
    pool = getattr(request.app.state, "db_pool", None)
    if pool is not None:
        from app.repositories.postgres import PostgresCourtLineupRepository
        return PostgresCourtLineupRepository(pool)
    _warn_memory_repo("CourtLineupRepository")
    return _memory_court_lineup_repo


def get_challenge_repo(request: Request) -> ChallengeRepository:
    pool = getattr(request.app.state, "db_pool", None)
    if pool is not None:
        from app.repositories.postgres import PostgresChallengeRepository
        return PostgresChallengeRepository(pool)
    _warn_memory_repo("ChallengeRepository")
    return _memory_challenge_repo


def get_daily_completion_repo(request: Request) -> DailyCompletionRepository:
    pool = getattr(request.app.state, "db_pool", None)
    if pool is not None:
        from app.repositories.postgres import PostgresDailyCompletionRepository
        return PostgresDailyCompletionRepository(pool)
    _warn_memory_repo("DailyCompletionRepository")
    return _memory_daily_completion_repo


def get_result_snapshot_repo(request: Request) -> ResultSnapshotRepository:
    pool = getattr(request.app.state, "db_pool", None)
    if pool is not None:
        from app.repositories.postgres import PostgresResultSnapshotRepository
        return PostgresResultSnapshotRepository(pool)
    _warn_memory_repo("ResultSnapshotRepository")
    return _memory_result_snapshot_repo


def get_ownership_claim_repo(request: Request) -> OwnershipClaimRepository:
    pool = getattr(request.app.state, "db_pool", None)
    if pool is not None:
        from app.repositories.postgres import PostgresOwnershipClaimRepository
        return PostgresOwnershipClaimRepository(pool)
    _warn_memory_repo("OwnershipClaimRepository")
    return _memory_ownership_claim_repo


def get_progression_repo(request: Request) -> ProgressionRepository:
    pool = getattr(request.app.state, "db_pool", None)
    if pool is not None:
        from app.repositories.postgres_progression import PostgresProgressionRepository
        return PostgresProgressionRepository(pool)
    _warn_memory_repo("ProgressionRepository")
    return _memory_progression_repo


def get_record_repo(request: Request) -> PersonalRecordRepository:
    pool = getattr(request.app.state, "db_pool", None)
    if pool is not None:
        from app.repositories.postgres_progression import PostgresPersonalRecordRepository
        return PostgresPersonalRecordRepository(pool)
    _warn_memory_repo("PersonalRecordRepository")
    return _memory_record_repo


def get_achievement_repo(request: Request) -> AchievementRepository:
    pool = getattr(request.app.state, "db_pool", None)
    if pool is not None:
        from app.repositories.postgres_progression import PostgresAchievementRepository
        return PostgresAchievementRepository(pool)
    _warn_memory_repo("AchievementRepository")
    return _memory_achievement_repo


def get_streak_repo(request: Request) -> StreakRepository:
    pool = getattr(request.app.state, "db_pool", None)
    if pool is not None:
        from app.repositories.postgres_progression import PostgresStreakRepository
        return PostgresStreakRepository(pool)
    _warn_memory_repo("StreakRepository")
    return _memory_streak_repo


def get_profile_repo(request: Request) -> ProfileRepository:
    pool = getattr(request.app.state, "db_pool", None)
    if pool is not None:
        from app.repositories.postgres_profile import PostgresProfileRepository
        return PostgresProfileRepository(pool)
    _warn_memory_repo("ProfileRepository")
    return _memory_profile_repo


def get_ranked_matchmaking_repo(request: Request) -> RankedMatchmakingRepository:
    pool = getattr(request.app.state, "db_pool", None)
    if pool is not None:
        from app.repositories.ranked_postgres import PostgresRankedMatchmakingRepository
        return PostgresRankedMatchmakingRepository(pool)
    _warn_memory_repo("RankedMatchmakingRepository")
    return _memory_ranked_matchmaking_repo


def get_ranked_rating_repo(request: Request) -> RankedRatingRepository:
    pool = getattr(request.app.state, "db_pool", None)
    if pool is not None:
        from app.repositories.ranked_postgres import PostgresRankedRatingRepository
        return PostgresRankedRatingRepository(pool)
    _warn_memory_repo("RankedRatingRepository")
    return _memory_ranked_rating_repo


def get_ranked_integrity_repo(request: Request) -> RankedIntegrityRepository:
    pool = getattr(request.app.state, "db_pool", None)
    if pool is not None:
        from app.repositories.ranked_postgres import PostgresRankedIntegrityRepository
        return PostgresRankedIntegrityRepository(pool)
    _warn_memory_repo("RankedIntegrityRepository")
    return _memory_ranked_integrity_repo


def get_perfect_season_leaderboard_repo(request: Request) -> PerfectSeasonLeaderboardRepository:
    """Return the active PerfectSeasonLeaderboardRepository (Postgres or
    in-memory) -- Phase 6G Part E. Same in-memory-fallback discipline as
    every other repository here; the leaderboard route itself gates on
    PEAK3_COURTBUILDER_LEADERBOARD_ENABLED (default off) before this is
    ever reached, so the in-memory fallback in dev/CI is expected, not a
    misconfiguration."""
    pool = getattr(request.app.state, "db_pool", None)
    if pool is not None:
        from app.repositories.leaderboard_postgres import PostgresPerfectSeasonLeaderboardRepository
        return PostgresPerfectSeasonLeaderboardRepository(pool)
    _warn_memory_repo("PerfectSeasonLeaderboardRepository")
    return _memory_perfect_season_leaderboard_repo


def _warn_memory_repo(name: str) -> None:
    if not settings.DEBUG:
        raise RuntimeError(
            f"{name}: DATABASE_URL is required in production. "
            "Set the PEAK3_DATABASE_URL environment variable."
        )
    warnings.warn(
        f"{name} is using the in-memory fallback because DATABASE_URL is not set. "
        "State will be lost on restart. Set PEAK3_DATABASE_URL for durable persistence.",
        stacklevel=3,
    )


# ---------------------------------------------------------------------------
# Typed dependency aliases
# ---------------------------------------------------------------------------

GameRepoDep = Annotated[GameRepository, Depends(get_game_repo)]
CourtLineupRepoDep = Annotated[CourtLineupRepository, Depends(get_court_lineup_repo)]
ChallengeRepoDep = Annotated[ChallengeRepository, Depends(get_challenge_repo)]
DailyCompletionRepoDep = Annotated[DailyCompletionRepository, Depends(get_daily_completion_repo)]
ResultSnapshotRepoDep = Annotated[ResultSnapshotRepository, Depends(get_result_snapshot_repo)]
OwnershipClaimRepoDep = Annotated[OwnershipClaimRepository, Depends(get_ownership_claim_repo)]
ProgressionRepoDep = Annotated[ProgressionRepository, Depends(get_progression_repo)]
RecordRepoDep = Annotated[PersonalRecordRepository, Depends(get_record_repo)]
AchievementRepoDep = Annotated[AchievementRepository, Depends(get_achievement_repo)]
StreakRepoDep = Annotated[StreakRepository, Depends(get_streak_repo)]
ProfileRepoDep = Annotated[ProfileRepository, Depends(get_profile_repo)]
RankedMatchmakingRepoDep = Annotated[RankedMatchmakingRepository, Depends(get_ranked_matchmaking_repo)]
RankedRatingRepoDep = Annotated[RankedRatingRepository, Depends(get_ranked_rating_repo)]
RankedIntegrityRepoDep = Annotated[RankedIntegrityRepository, Depends(get_ranked_integrity_repo)]
PerfectSeasonLeaderboardRepoDep = Annotated[
    PerfectSeasonLeaderboardRepository, Depends(get_perfect_season_leaderboard_repo)
]
