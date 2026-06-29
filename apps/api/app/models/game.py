from pydantic import BaseModel, Field


class PublicPeakRef(BaseModel):
    peak_id: str
    player_name: str
    player_slug: str
    duration_years: int
    start_season: str
    end_season: str
    anchor_season: str


class PublicDuel(BaseModel):
    id: str
    left: PublicPeakRef
    right: PublicPeakRef
    difficulty: str


class DailyGameResponse(BaseModel):
    date: str
    years: int
    duel_count: int
    duels: list[PublicDuel]
    session_token: str


class EndlessGameResponse(BaseModel):
    seed: int
    years: int
    duel_count: int
    duels: list[PublicDuel]
    session_token: str


class AnswerRequest(BaseModel):
    session_token: str
    duel_id: str
    selected_peak_id: str
    elapsed_ms: int = Field(ge=0, le=300000)
    current_streak: int = Field(ge=0, le=50)


class ComponentComparison(BaseModel):
    winner: float
    loser: float
    winner_leads: bool


class AnswerResponse(BaseModel):
    correct: bool
    winning_peak_id: str
    arena_points_awarded: int
    updated_streak: int
    difficulty: str
    score_gap: float
    winner: dict
    loser: dict
    component_comparison: dict[str, ComponentComparison]
    explanation: str
    selected_correctly: bool
