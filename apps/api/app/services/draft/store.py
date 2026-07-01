"""Backward-compatible store facade — delegates to the in-memory repository.

Phase 2 API routes and tests import directly from this module.
Phase 3 routes use the dependency-injected repository via core/dependencies.py.

In production (DATABASE_URL set), the lifespan hook injects PostgreSQL repos
through app.state.  This module's singletons are used only in test contexts
where the client fixture does not set app.state.db_pool.
"""
from __future__ import annotations

from app.repositories.memory import MemoryChallengeRepository, MemoryGameRepository
from app.repositories.protocols import ChallengeRecord
from nba_peak.lineup.schemas import DraftGameState

# Re-export ChallengeRecord so existing imports from store still work
__all__ = [
    "ChallengeRecord",
    "create_game",
    "get_game",
    "save_game",
    "delete_game",
    "game_count",
    "store_challenge",
    "get_challenge",
    "save_settlement",
]

# Singletons used by Phase 2 routes and the conftest TestClient.
# They are replaced at startup by PostgreSQL repos when DATABASE_URL is set.
_game_repo = MemoryGameRepository()
_challenge_repo = MemoryChallengeRepository()


def create_game(state: DraftGameState) -> str:
    return _game_repo.create_game(state)


def get_game(game_id: str) -> DraftGameState | None:
    return _game_repo.get_game(game_id)


def save_game(state: DraftGameState) -> None:
    _game_repo.save_game(state)


def delete_game(game_id: str) -> None:
    _game_repo.delete_game(game_id)


def game_count() -> int:
    return _game_repo.game_count()


def store_challenge(record: ChallengeRecord) -> None:
    _challenge_repo.store_challenge(record)


def get_challenge(token_hash: str) -> ChallengeRecord | None:
    return _challenge_repo.get_challenge(token_hash)


def save_settlement(token_hash: str, settlement: dict) -> bool:
    return _challenge_repo.save_settlement(token_hash, settlement)
