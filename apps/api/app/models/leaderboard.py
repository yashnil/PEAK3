from pydantic import BaseModel


class ComponentBreakdown(BaseModel):
    statistical_impact: float
    traditional_production: float
    individual_recognition: float
    postseason_individual_value: float
    team_achievement: float
    teammate_adjustment: float


class PeakWindow(BaseModel):
    id: str
    player_id: str
    player_slug: str
    player_name: str
    duration_years: int
    start_season: str
    end_season: str
    anchor_season: str
    rank: int
    prime_score: float
    prime_index: float
    components: ComponentBreakdown
    data_status: str


class LeaderboardResponse(BaseModel):
    rows: list[dict]
    total: int
    duration: int
    offset: int
    limit: int
    metadata: dict


class PlayerSummary(BaseModel):
    player_slug: str
    player_name: str
    best_rank: int
    available_durations: list[int]


class PlayerSearchResponse(BaseModel):
    players: list[PlayerSummary]


class PlayerDetailResponse(BaseModel):
    player_slug: str
    player_name: str
    windows: dict[str, dict]
