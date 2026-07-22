"""In-memory repository implementations — for unit tests and development fallback.

These must NEVER be used as the production default when DATABASE_URL is set.

All methods are async (no real I/O — see protocols.py's GameRepository
docstring for why the whole game/challenge/history repository graph is
async end-to-end, matching the pattern already established for ranked).
"""
from __future__ import annotations

import secrets
import threading
from datetime import datetime, timedelta, timezone

from nba_peak.lineup.schemas import DraftGameState

from .protocols import (
    ChallengeRecord,
    DailyCompletion,
    DailyCompletionRepository,
    GameRepository,
    ChallengeRepository,
    OwnershipClaim,
    OwnershipClaimRepository,
    ResultSnapshot,
    ResultSnapshotRepository,
)

GAME_TTL_HOURS = 24


class MemoryGameRepository:
    """Thread-safe in-memory game store."""

    def __init__(self) -> None:
        self._games: dict[str, DraftGameState] = {}
        self._lock = threading.Lock()

    async def create_game(self, state: DraftGameState) -> str:
        game_id = secrets.token_urlsafe(16)
        state.game_id = game_id
        with self._lock:
            self._games[game_id] = state
        return game_id

    async def get_game(self, game_id: str) -> DraftGameState | None:
        with self._lock:
            state = self._games.get(game_id)
        if state is None:
            return None
        created = datetime.fromisoformat(state.created_at)
        if datetime.now(timezone.utc) - created > timedelta(hours=GAME_TTL_HOURS):
            with self._lock:
                self._games.pop(game_id, None)
            return None
        return state

    async def save_game(self, state: DraftGameState) -> None:
        with self._lock:
            self._games[state.game_id] = state

    async def delete_game(self, game_id: str) -> None:
        with self._lock:
            self._games.pop(game_id, None)

    async def game_count(self) -> int:
        with self._lock:
            return len(self._games)

    async def transfer_owner(self, from_sub: str, to_sub: str) -> int:
        count = 0
        with self._lock:
            for state in self._games.values():
                if state.owner_sub == from_sub:
                    state.owner_sub = to_sub
                    count += 1
        return count


class MemoryChallengeRepository:
    """Thread-safe in-memory challenge store."""

    def __init__(self) -> None:
        self._challenges: dict[str, ChallengeRecord] = {}
        self._lock = threading.Lock()

    async def store_challenge(self, record: ChallengeRecord) -> None:
        with self._lock:
            self._challenges[record.token_hash] = record

    async def get_challenge(self, token_hash: str) -> ChallengeRecord | None:
        with self._lock:
            now = datetime.now(timezone.utc)
            expired_keys = [
                k for k, v in self._challenges.items() if now > v.expires_at
            ]
            for k in expired_keys:
                self._challenges.pop(k, None)
            return self._challenges.get(token_hash)

    async def save_settlement(self, token_hash: str, settlement: dict) -> bool:
        with self._lock:
            record = self._challenges.get(token_hash)
            if record is None or record.settlement is not None:
                return False
            record.settlement = settlement
            return True

    async def transfer_owner(self, from_sub: str, to_sub: str) -> int:
        count = 0
        with self._lock:
            for record in self._challenges.values():
                if record.anon_subject_id == from_sub:
                    record.anon_subject_id = to_sub
                    count += 1
        return count


class MemoryDailyCompletionRepository:
    """Thread-safe in-memory daily completion store."""

    def __init__(self) -> None:
        self._completions: dict[str, DailyCompletion] = {}
        self._lock = threading.Lock()

    def _key(self, owner_sub: str, board_id: str) -> str:
        return f"{owner_sub}:{board_id}"

    async def record_completion(self, completion: DailyCompletion) -> None:
        key = self._key(completion.owner_sub, completion.board_id)
        with self._lock:
            # Idempotent: first completion wins
            if key not in self._completions:
                self._completions[key] = completion

    async def get_completion(
        self, owner_sub: str, board_id: str
    ) -> DailyCompletion | None:
        key = self._key(owner_sub, board_id)
        with self._lock:
            return self._completions.get(key)

    async def list_completions(
        self,
        owner_sub: str,
        limit: int = 50,
        before_id: str | None = None,
    ) -> list[DailyCompletion]:
        with self._lock:
            results = [
                c for c in self._completions.values() if c.owner_sub == owner_sub
            ]
        results.sort(key=lambda c: c.completed_at, reverse=True)
        if before_id:
            # naive cursor: skip until we find before_id then return rest
            try:
                idx = next(i for i, c in enumerate(results) if c.id == before_id)
                results = results[idx + 1:]
            except StopIteration:
                pass
        return results[:limit]

    async def transfer_owner(self, from_sub: str, to_sub: str) -> int:
        count = 0
        with self._lock:
            to_move = [
                (k, c) for k, c in self._completions.items() if c.owner_sub == from_sub
            ]
            for old_key, completion in to_move:
                new_key = self._key(to_sub, completion.board_id)
                if new_key in self._completions:
                    # Real user already has an official completion for this
                    # board — the anon one is dropped (first-wins semantics
                    # match the UNIQUE(owner_sub, board_id) constraint).
                    del self._completions[old_key]
                    continue
                completion.owner_sub = to_sub
                self._completions[new_key] = completion
                del self._completions[old_key]
                count += 1
        return count


class MemoryResultSnapshotRepository:
    """Thread-safe in-memory result snapshot store."""

    def __init__(self) -> None:
        self._results: dict[str, ResultSnapshot] = {}
        self._lock = threading.Lock()

    async def record_result(self, result: ResultSnapshot) -> None:
        with self._lock:
            # Immutable: first write wins
            if result.id not in self._results:
                self._results[result.id] = result

    async def get_result(self, result_id: str) -> ResultSnapshot | None:
        with self._lock:
            return self._results.get(result_id)

    async def list_results(
        self,
        owner_sub: str,
        limit: int = 50,
        before_id: str | None = None,
    ) -> list[ResultSnapshot]:
        with self._lock:
            results = [
                r for r in self._results.values() if r.owner_sub == owner_sub
            ]
        results.sort(key=lambda r: r.completed_at, reverse=True)
        if before_id:
            try:
                idx = next(i for i, r in enumerate(results) if r.id == before_id)
                results = results[idx + 1:]
            except StopIteration:
                pass
        return results[:limit]

    async def transfer_owner(self, from_sub: str, to_sub: str) -> int:
        count = 0
        with self._lock:
            for result in self._results.values():
                if result.owner_sub == from_sub:
                    result.owner_sub = to_sub
                    count += 1
        return count


class MemoryOwnershipClaimRepository:
    """Thread-safe in-memory ownership claim store."""

    def __init__(self) -> None:
        self._claims: dict[str, OwnershipClaim] = {}
        self._lock = threading.Lock()

    async def record_claim(self, claim: OwnershipClaim) -> None:
        with self._lock:
            self._claims[claim.anon_subject_id] = claim

    async def get_claim_by_anon(self, anon_subject_id: str) -> OwnershipClaim | None:
        with self._lock:
            return self._claims.get(anon_subject_id)
