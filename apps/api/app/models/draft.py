"""Pydantic request/response models for Peak Draft API."""
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


class CreateDraftGameRequest(BaseModel):
    mode: str = Field(..., description="apex_1y | prime_3y | foundation_5y")
    board_type: str = Field("practice", description="daily | practice | challenge")
    date: Optional[str] = Field(None, description="YYYY-MM-DD for daily boards")
    seed: Optional[int] = Field(None, description="explicit seed for practice/challenge")
    challenge_token: Optional[str] = Field(None, description="token to reproduce a challenge board")


class SelectCardRequest(BaseModel):
    game_id: str
    card_id: str = Field(..., description="peak_window_id of selected card")
    role: str = Field(..., description="eligible role to fill")
    idempotency_key: Optional[str] = Field(None)


class UseHoldRequest(BaseModel):
    game_id: str
    card_id: str = Field(..., description="peak_window_id of card to hold")
    idempotency_key: Optional[str] = Field(None)


class UseReframeRequest(BaseModel):
    game_id: str
    idempotency_key: Optional[str] = Field(None)


class DraftActionRequest(BaseModel):
    """Unified action endpoint body."""
    game_id: str
    action: str = Field(..., description="select_card | use_hold | use_reframe | confirm")
    card_id: Optional[str] = Field(None)
    role: Optional[str] = Field(None)
    idempotency_key: Optional[str] = Field(None)


class PublicGameStateResponse(BaseModel):
    """Public game state returned to the client."""
    game_id: str
    mode: str
    duration_years: int
    board_type: str
    status: str
    current_round: int
    total_rounds: int
    current_offers: list[dict]
    selected_cards: list[dict]
    round_history: list[dict] = []
    open_roles: list[str]
    current_dna: Optional[dict] = None
    hold_available: bool
    held_card: Optional[dict] = None
    reframe_available: bool
    reframed_this_round: bool
    hold_used: bool
    reframe_used: bool
    board_metadata: dict
    lineup_evaluation: Optional[dict] = None


class CreateChallengeRequest(BaseModel):
    game_id: str
    include_spoilers: bool = Field(False)


class ChallengeResponse(BaseModel):
    challenge_token: str
    public_url_path: str
    board_id: str
    mode: str
    spoiler_free: bool


class DraftMetaResponse(BaseModel):
    supported_modes: list[str]
    mode_descriptions: dict[str, str]
    roles: list[str]
    dna_dimensions: list[str]
    lineup_model_version: str
    ruleset_version: str
    card_pool_version: str
    experimental_notice: str
