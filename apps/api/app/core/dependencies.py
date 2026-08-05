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
from app.repositories.saved_run_memory import MemoryPerfectSeasonSavedRunRepository
from app.repositories.saved_run_protocols import PerfectSeasonSavedRunRepository
from app.repositories.daily_grid_memory import MemoryDailyGridResultRepository
from app.repositories.daily_grid_protocols import DailyGridResultRepository
from app.repositories.run_the_table_memory import MemoryRunTheTableRunRepository
from app.repositories.run_the_table_protocols import RunTheTableRunRepository
from app.repositories.head_to_head_memory import MemoryHeadToHeadRepository
from app.repositories.head_to_head_protocols import HeadToHeadRepository
from app.repositories.peak_duel_daily_memory import MemoryPeakDuelDailyResultRepository
from app.repositories.peak_duel_daily_protocols import PeakDuelDailyResultRepository
from app.repositories.arena_memory import MemoryArenaRepository
from app.repositories.arena_protocols import ArenaRepository
from app.repositories.arena_rating_memory import MemoryArenaRatingRepository
from app.repositories.arena_rating_protocols import ArenaRatingRepository

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
_memory_perfect_season_saved_run_repo = MemoryPerfectSeasonSavedRunRepository()
_memory_daily_grid_result_repo = MemoryDailyGridResultRepository()
_memory_run_the_table_run_repo = MemoryRunTheTableRunRepository()
_memory_head_to_head_repo = MemoryHeadToHeadRepository()
_memory_peak_duel_daily_result_repo = MemoryPeakDuelDailyResultRepository()
_memory_arena_repo = MemoryArenaRepository()
_memory_arena_rating_repo = MemoryArenaRatingRepository()


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

    Registered in app.core.repository_registry.REPOSITORY_DOMAINS. It was
    previously left out on the grounds that CourtBuilder is a feature-flagged
    Phase 5C vertical slice (see
    docs/implementation/PHASE_5_COURTBUILDER_VERTICAL_SLICE.md), but that made
    the registry's own docstring false and, worse, exempted a wired domain from
    assert_production_ready's durability check -- a flag that is off today can
    be turned on without anyone re-reading this comment, and the check exists
    precisely so nothing reaches production on the in-memory fallback.
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


def get_perfect_season_saved_run_repo(request: Request) -> PerfectSeasonSavedRunRepository:
    """Return the active PerfectSeasonSavedRunRepository (Postgres or
    in-memory) -- Phase 9A personal history/personal bests. Same
    in-memory-fallback discipline as every other repository here.

    Unlike the leaderboard repo, this one is NOT behind a feature flag:
    saving your own completed run to your own history is core retention
    behavior, not an opt-in competitive feature. It still always requires a
    signed-in account at the route level."""
    pool = getattr(request.app.state, "db_pool", None)
    if pool is not None:
        from app.repositories.saved_run_postgres import PostgresPerfectSeasonSavedRunRepository
        return PostgresPerfectSeasonSavedRunRepository(pool)
    _warn_memory_repo("PerfectSeasonSavedRunRepository")
    return _memory_perfect_season_saved_run_repo


def get_daily_grid_result_repo(request: Request) -> DailyGridResultRepository:
    """Return the active DailyGridResultRepository (Postgres or in-memory) --
    Phase 11D official daily results. Same in-memory-fallback discipline as
    every other repository here.

    Not behind a feature flag, for the same reason the saved-run repo is not:
    saving your own completed board to your own record is core retention
    behavior, not an opt-in competitive feature. It still always requires a
    signed-in account at the route level, and anonymous players keep the
    localStorage archive instead."""
    pool = getattr(request.app.state, "db_pool", None)
    if pool is not None:
        from app.repositories.daily_grid_postgres import PostgresDailyGridResultRepository
        return PostgresDailyGridResultRepository(pool)
    _warn_memory_repo("DailyGridResultRepository")
    return _memory_daily_grid_result_repo


def get_run_the_table_run_repo(request: Request) -> RunTheTableRunRepository:
    """Return the active RunTheTableRunRepository (Postgres or in-memory).

    Same in-memory-fallback discipline as every other repository here. Not
    behind a feature flag, for the same reason the saved-run and daily-grid
    repos are not: a run in progress is the player's own state, and losing it
    on a restart is a durability question, not a product-gating one.

    Unlike most repositories here, the overwhelmingly common owner is
    ANONYMOUS (a signed `peak3_anon` cookie subject). RUN THE TABLE requires no
    account to play, so this repo must be wired and durable even for players
    who never sign in -- which is exactly why it is registered in
    app.core.repository_registry.REPOSITORY_DOMAINS rather than left out the
    way the Phase 5C CourtBuilder slice was."""
    pool = getattr(request.app.state, "db_pool", None)
    if pool is not None:
        from app.repositories.run_the_table_postgres import PostgresRunTheTableRunRepository
        return PostgresRunTheTableRunRepository(pool)
    _warn_memory_repo("RunTheTableRunRepository")
    return _memory_run_the_table_run_repo


def get_head_to_head_repo(request: Request) -> HeadToHeadRepository:
    """Return the active HeadToHeadRepository (Postgres or in-memory).

    Same in-memory-fallback discipline as every other repository here, and
    registered in app.core.repository_registry.REPOSITORY_DOMAINS for the same
    reason: a head-to-head is a record between two accounts, and one that only
    ever lived in a dict would be a match the server forgot on restart --
    including its settled result."""
    pool = getattr(request.app.state, "db_pool", None)
    if pool is not None:
        from app.repositories.head_to_head_postgres import PostgresHeadToHeadRepository
        return PostgresHeadToHeadRepository(pool)
    _warn_memory_repo("HeadToHeadRepository")
    return _memory_head_to_head_repo


def get_peak_duel_daily_result_repo(request: Request) -> PeakDuelDailyResultRepository:
    """Return the active PeakDuelDailyResultRepository (Postgres or in-memory).

    Same in-memory-fallback discipline as every other repository here. Like
    RUN THE TABLE and unlike most repositories in this module, the owner here
    is very often ANONYMOUS -- Peak Duel Daily needs no account to play, and
    recording a guest's attempt under their signed anon-cookie subject is
    precisely what makes it claimable when they sign in later. That is why it
    is registered in app.core.repository_registry.REPOSITORY_DOMAINS: an
    attempt that only ever lived in memory would be a daily result the server
    forgot on restart."""
    pool = getattr(request.app.state, "db_pool", None)
    if pool is not None:
        from app.repositories.peak_duel_daily_postgres import (
            PostgresPeakDuelDailyResultRepository,
        )
        return PostgresPeakDuelDailyResultRepository(pool)
    _warn_memory_repo("PeakDuelDailyResultRepository")
    return _memory_peak_duel_daily_result_repo


def get_arena_repo(request: Request) -> ArenaRepository:
    """Return the active ArenaRepository (Postgres or in-memory).

    Same in-memory-fallback discipline as every other repository here, and
    registered in app.core.repository_registry.REPOSITORY_DOMAINS for the same
    reason head_to_head is: a match is a record between two or three accounts,
    and one that only ever lived in a dict would be a match the server forgot on
    restart -- mid-turn, with a clock running, and with a rated result owed to
    whoever was winning.
    """
    pool = getattr(request.app.state, "db_pool", None)
    if pool is not None:
        from app.repositories.arena_postgres import PostgresArenaRepository
        return PostgresArenaRepository(pool)
    _warn_memory_repo("ArenaRepository")
    return _memory_arena_repo


def get_arena_rating_repo(request: Request) -> ArenaRatingRepository:
    """Return the active ArenaRatingRepository (Postgres or in-memory).

    Registered in REPOSITORY_DOMAINS for the sharpest version of the reason the
    arena repo is: a match lost to a restart can be replayed from its results,
    but a rating that silently reverted is a number the player watched go up and
    then go back down with nothing to point at.
    """
    pool = getattr(request.app.state, "db_pool", None)
    if pool is not None:
        from app.repositories.arena_rating_postgres import PostgresArenaRatingRepository
        return PostgresArenaRatingRepository(pool)
    _warn_memory_repo("ArenaRatingRepository")
    return _memory_arena_rating_repo


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
PerfectSeasonSavedRunRepoDep = Annotated[
    PerfectSeasonSavedRunRepository, Depends(get_perfect_season_saved_run_repo)
]
DailyGridResultRepoDep = Annotated[
    DailyGridResultRepository, Depends(get_daily_grid_result_repo)
]
RunTheTableRunRepoDep = Annotated[
    RunTheTableRunRepository, Depends(get_run_the_table_run_repo)
]
PeakDuelDailyResultRepoDep = Annotated[
    PeakDuelDailyResultRepository, Depends(get_peak_duel_daily_result_repo)
]
HeadToHeadRepoDep = Annotated[HeadToHeadRepository, Depends(get_head_to_head_repo)]
ArenaRepoDep = Annotated[ArenaRepository, Depends(get_arena_repo)]
ArenaRatingRepoDep = Annotated[ArenaRatingRepository, Depends(get_arena_rating_repo)]
