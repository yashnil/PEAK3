"""Pydantic request/response models for the 82-0 Peak Season / CourtBuilder API.

ADR-005 Decision 6, enforced at the type level too: PublicCourtStateResponse
never carries a score/rank field for the current round's candidates -- only
`current_spin.candidates` (name only) and `slots[].individual_peak_score`
(only present once a slot is filled/locked).
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class CreatePerfectSeasonGameRequest(BaseModel):
    mode: str = Field(..., description="apex_1y | prime_3y | foundation_5y")
    seed: Optional[int] = Field(None, description="explicit seed; random if omitted")


class SelectPlayerRequest(BaseModel):
    game_id: str
    player_slug: str = Field(..., description="candidate player_slug from the current spin")
    idempotency_key: Optional[str] = Field(None)


class PlaceCardRequest(BaseModel):
    game_id: str
    slot_type: str = Field(..., description="e.g. starter_1..starter_5, bench_1..bench_3")
    idempotency_key: Optional[str] = Field(None)


class CompleteGameRequest(BaseModel):
    game_id: str


class SpinCandidate(BaseModel):
    player_slug: str
    player_name: str


class CurrentSpinPublic(BaseModel):
    round_number: int
    spin_type: str
    franchise_display_name: Optional[str] = None
    era_label: Optional[str] = None
    candidates: list[SpinCandidate]


class PendingSelectionPublic(BaseModel):
    peak_window_id: str
    player_name: str


class CourtSlotPublic(BaseModel):
    slot_type: str
    filled: bool
    peak_window_id: Optional[str] = None
    player_name: Optional[str] = None
    anchor_season: Optional[str] = None
    individual_peak_score: Optional[float] = None
    individual_peak_rank: Optional[int] = None
    resolved_via_spin_id: Optional[str] = None


class SimulationResultPublic(BaseModel):
    lineup_model_version: str
    simulator_version: str
    fit_components: dict
    wins: int
    losses: int
    expected_wins: float
    expected_wins_low: float
    expected_wins_high: float
    decisive_factors: list[str]
    is_perfect_season: bool
    experimental_notice: str


class PublicCourtStateResponse(BaseModel):
    game_id: str
    status: str
    mode: str
    current_round: int
    total_rounds: int
    current_spin: Optional[CurrentSpinPublic] = None
    pending_selection: Optional[PendingSelectionPublic] = None
    slots: list[CourtSlotPublic]
    board_seed: int
    card_pool_version: str
    board_generator_version: str
    interim_team_data_version: Optional[str] = None
    simulation_result: Optional[SimulationResultPublic] = None


class CourtBuilderReadinessResponse(BaseModel):
    readiness_level: str
    courtbuilder_enabled: bool
    team_spin_enabled: bool
    interim_team_data_version: str
    interim_team_franchise_count: int
