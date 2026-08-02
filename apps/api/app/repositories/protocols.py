"""Persistence interface protocols for Peak Draft.

These are structural subtypes (typing.Protocol) so the API and game-domain code
depend on the interface, not on any concrete storage back-end.  Implementations
live in memory.py (tests) and postgres.py (production).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Protocol, runtime_checkable

from nba_peak.lineup.schemas import DraftGameState
from nba_peak.perfect_season.schemas import CourtLineupState


# ---------------------------------------------------------------------------
# Value objects shared across repos
# ---------------------------------------------------------------------------


@dataclass
class ChallengeRecord:
    """Persisted snapshot of a completed challenger game plus board metadata."""
    token_hash: str             # sha256(token)[:32] — storage key
    challenger_game_id: str
    board_id: str
    mode: str
    board_type: str
    duration_years: int
    seed: int | None
    date: str | None            # for daily boards
    created_at: datetime
    expires_at: datetime
    challenger_snapshot: dict   # serialized: selected_cards + lineup_evaluation
    anon_subject_id: str | None = field(default=None)  # owner of the challenger
    settlement: dict | None = field(default=None)       # set on first comparison


@dataclass
class DailyCompletion:
    """Official result record for one user/anon playing one Daily board."""
    id: str                   # opaque UUID
    owner_sub: str            # auth subject (anon or real)
    board_id: str
    mode: str
    date: str                 # YYYY-MM-DD
    game_id: str
    lineup_peak_rating: float
    draft_efficiency: float | None
    board_percentile: float | None
    hold_used: bool
    reframe_used: bool
    completed_at: datetime
    result_snapshot: dict     # full immutable result payload


@dataclass
class ResultSnapshot:
    """Immutable result record — append-only after insert."""
    id: str
    owner_sub: str
    game_id: str
    board_id: str
    board_type: str           # daily | practice | challenge
    mode: str
    lineup_peak_rating: float
    draft_efficiency: float | None
    board_percentile: float | None
    completed_at: datetime
    payload: dict             # full serialized LineupEvaluation + selections


@dataclass
class OwnershipClaim:
    """Audit record: anonymous subject claimed by a real user.

    `anon_subject_id` is UNIQUE in the table (20260630124500_identity.sql), and
    that constraint -- not any application check -- is what makes two browser
    tabs racing the same claim resolve to one winner.

    The three legacy `*_count` fields date from a claim that covered three
    domains. `domain_counts` is the full per-domain breakdown of what a claim
    moved, stored rather than recomputed: `POST /auth/claim` is idempotent, and
    by the time a repeat call arrives the rows have already moved, so a
    recomputed breakdown would report zeros for a claim that really did import
    something. `game_count` keeps its original meaning (every row that left
    `games`); `domain_counts` splits it into its draft and court-lineup halves.
    """
    id: str
    real_user_sub: str
    anon_subject_id: str
    claimed_at: datetime
    game_count: int
    completion_count: int
    challenge_count: int
    domain_counts: dict[str, int] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Repository protocols
# ---------------------------------------------------------------------------


@runtime_checkable
class GameRepository(Protocol):
    """CRUD for DraftGameState objects.

    Async throughout — see ranked_protocols.py's module docstring for why:
    the Postgres implementation is inherently async (asyncpg), and previously
    the sync-declared protocol here let call sites invoke it without
    `await`, silently receiving an unawaited coroutine once Postgres was
    wired in. The in-memory implementation is async too (no real I/O; kept
    for one uniform calling convention across both backends).
    """

    async def create_game(self, state: DraftGameState) -> str: ...
    async def get_game(self, game_id: str) -> DraftGameState | None: ...
    async def save_game(self, state: DraftGameState) -> None: ...
    async def delete_game(self, game_id: str) -> None: ...
    async def game_count(self) -> int: ...
    async def transfer_owner(self, from_sub: str, to_sub: str) -> int:
        """Reassign owner_sub on every game owned by from_sub. Returns count."""
        ...


@runtime_checkable
class ChallengeRepository(Protocol):
    """CRUD for ChallengeRecord objects."""

    async def store_challenge(self, record: ChallengeRecord) -> None: ...
    async def get_challenge(self, token_hash: str) -> ChallengeRecord | None: ...
    async def save_settlement(self, token_hash: str, settlement: dict) -> bool: ...
    async def transfer_owner(self, from_sub: str, to_sub: str) -> int:
        """Reassign anon_subject_id on every challenge owned by from_sub."""
        ...


@runtime_checkable
class DailyCompletionRepository(Protocol):
    """Write-once Daily completion records."""

    async def record_completion(self, completion: DailyCompletion) -> None: ...
    async def get_completion(
        self, owner_sub: str, board_id: str
    ) -> DailyCompletion | None: ...
    async def list_completions(
        self,
        owner_sub: str,
        limit: int = 50,
        before_id: str | None = None,
    ) -> list[DailyCompletion]: ...
    async def transfer_owner(self, from_sub: str, to_sub: str) -> int: ...


@runtime_checkable
class ResultSnapshotRepository(Protocol):
    """Write-once result snapshot records."""

    async def record_result(self, result: ResultSnapshot) -> None: ...
    async def get_result(self, result_id: str) -> ResultSnapshot | None: ...
    async def list_results(
        self,
        owner_sub: str,
        limit: int = 50,
        before_id: str | None = None,
    ) -> list[ResultSnapshot]: ...
    async def transfer_owner(self, from_sub: str, to_sub: str) -> int: ...


@runtime_checkable
class OwnershipClaimRepository(Protocol):
    """Claim records: anonymous → authenticated."""

    async def record_claim(self, claim: OwnershipClaim) -> None: ...
    async def get_claim_by_anon(self, anon_subject_id: str) -> OwnershipClaim | None: ...


@runtime_checkable
class CourtLineupRepository(Protocol):
    """CRUD for CourtLineupState objects (Phase 5C CourtBuilder).

    A deliberately separate, narrower protocol from GameRepository -- the
    court game grammar is a different shape from DraftGameState (soft
    court/bench slots vs. hard offer-rounds), so reusing GameRepository's
    signature directly would couple two unrelated schemas (see
    docs/architecture/PHASE_5_DATA_MODEL.md entity 8's resolved open
    question). The Postgres implementation still reuses the existing
    `games` table (board_type = "perfect_season" discriminator) -- no new
    migration -- it is only the application-facing protocol/typing that is
    separate, not the storage table.
    """

    async def create_lineup(self, state: CourtLineupState) -> str: ...
    async def get_lineup(self, game_id: str) -> CourtLineupState | None: ...
    async def save_lineup(self, state: CourtLineupState) -> None: ...
    async def transfer_owner(self, from_sub: str, to_sub: str) -> int:
        """Reassign owner_sub on every lineup owned by from_sub. Returns count."""
        ...
