"""Pydantic request/response models for Phase 4.0 ranked duels.

No internal database IDs are exposed beyond opaque UUIDs already used as
primary keys elsewhere in the API (matches the existing convention — game_id,
challenge tokens — of treating server-generated UUIDs as the public identity
rather than inventing a second opaque-ID layer).
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class RankedQueueInfo(BaseModel):
    mode: str
    label: str
    queue_version: str
    rating_algorithm_version: str
    placement_count: int


class RankedQueuesResponse(BaseModel):
    queues: list[RankedQueueInfo]
    ranked_enabled: bool
    matchmaking_enabled: bool


class JoinQueueResponse(BaseModel):
    status: str            # "waiting" | "matched"
    mode: str
    queue_entry_id: Optional[str] = None
    match_id: Optional[str] = None


class MatchmakingStatusResponse(BaseModel):
    status: str             # "not_in_queue" | "waiting" | "matched" | "cancelled"
    mode: str
    waited_seconds: Optional[float] = None
    match_id: Optional[str] = None


class RankedParticipantPublic(BaseModel):
    status: str              # board_ready | in_progress | complete | awaiting_opponent | abandoned | protected_abort
    game_id: Optional[str] = None


class RankedMatchPublic(BaseModel):
    match_id: str
    mode: str
    status: str
    settlement_status: str
    deadline: str
    you: RankedParticipantPublic
    opponent_status: str    # "hidden" (pre-settlement) | the opponent's status (post-settlement)


class RatingChange(BaseModel):
    prior_rating: float
    new_rating: float
    delta: float
    prior_rd: float
    new_rd: float


class RankedSettlementView(BaseModel):
    match_id: str
    outcome: str                       # "win" | "loss" | "draw" (from the viewer's perspective)
    your_score: float
    opponent_score: float
    tie_break_used: Optional[str] = None
    rating_change: RatingChange
    placement_progress: Optional[str] = None    # e.g. "Placement 3 of 7" or None once established
    division_change: Optional[str] = None       # e.g. "Rotation -> Starter" only if applicable
    settled_at: str


class PendingSettlementResponse(BaseModel):
    status: str   # "awaiting_opponent" | "settled"
    match_id: str


class QueueRatingResponse(BaseModel):
    mode: str
    established: bool
    rating: Optional[float] = None       # hidden (None) while in placement, per spec K
    rd: Optional[float] = None
    uncertainty_label: str               # human-readable: "still calibrating" | "provisional" | "established"
    valid_rated_matches: int
    division: Optional[str] = None       # only shown once established


class PlacementStateResponse(BaseModel):
    mode: str
    valid_matches_completed: int
    required_matches: int
    established: bool


class RatingHistoryEntry(BaseModel):
    match_id: str
    outcome: str
    pre_rating: float
    post_rating: float
    delta: float
    created_at: str


class RatingHistoryResponse(BaseModel):
    mode: str
    entries: list[RatingHistoryEntry]


class LeaderboardEntry(BaseModel):
    rank: int
    owner_sub: str          # stable pagination key only — never a competitive factor
    rating: float
    rd: float
    division: Optional[str] = None


class LeaderboardResponse(BaseModel):
    mode: str
    enabled: bool
    entries: list[LeaderboardEntry]
    next_cursor: Optional[str] = None
    updated_at: str
    queue_version: str
    rating_algorithm_version: str


class SurroundingRankResponse(BaseModel):
    mode: str
    your_rank: Optional[int] = None
    entries: list[LeaderboardEntry]


class RankedReadinessResponse(BaseModel):
    readiness_level: str
    ranked_enabled: bool
    matchmaking_enabled: bool
    rating_writes_enabled: bool
    public_leaderboard_enabled: bool
    rating_algorithm_version: str
    queue_versions: dict[str, str]
    pending_match_count: int
    pending_rating_count: int
    last_successful_settlement_at: Optional[str] = None
