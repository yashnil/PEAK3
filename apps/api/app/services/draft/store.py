"""Ephemeral in-memory game store for Peak Draft.

Games are stored in a process-level dict. They are lost on server restart, which
is acceptable for Phase 2 without a database. The store is replaced with a Redis
or Supabase adapter in Phase 3.

Security: the game_id is a random 128-bit token. Private board state (future
offers, reframe branches, solver optimum) is never in any client payload.
"""
from __future__ import annotations

import secrets
import threading
from datetime import datetime, timedelta, timezone

from nba_peak.lineup.schemas import DraftGameState

# In-memory game store
_games: dict[str, DraftGameState] = {}
_lock = threading.Lock()

GAME_TTL_HOURS = 24


def create_game(state: DraftGameState) -> str:
    """Store a new game and return its game_id."""
    game_id = secrets.token_urlsafe(16)
    state.game_id = game_id
    with _lock:
        _games[game_id] = state
    return game_id


def get_game(game_id: str) -> DraftGameState | None:
    with _lock:
        state = _games.get(game_id)
    if state is None:
        return None
    # Check TTL
    created = datetime.fromisoformat(state.created_at)
    if datetime.now(timezone.utc) - created > timedelta(hours=GAME_TTL_HOURS):
        with _lock:
            _games.pop(game_id, None)
        return None
    return state


def save_game(state: DraftGameState) -> None:
    with _lock:
        _games[state.game_id] = state


def delete_game(game_id: str) -> None:
    with _lock:
        _games.pop(game_id, None)


def game_count() -> int:
    with _lock:
        return len(_games)
