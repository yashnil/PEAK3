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


class CancelSelectionRequest(BaseModel):
    game_id: str


class PlaceCardRequest(BaseModel):
    game_id: str
    slot_type: str = Field(..., description="PG | SG | SF | PF | C | bench_1 | bench_2 | bench_3")
    idempotency_key: Optional[str] = Field(None)


class CompleteGameRequest(BaseModel):
    game_id: str


class SpinCandidate(BaseModel):
    player_slug: str
    player_name: str
    # v1 archetype-approximated position eligibility (never a score) --
    # shown during selection so a player can see "allowed positions" before
    # picking, per docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md Sec 6.4b.
    primary_position: Optional[str] = None
    secondary_positions: list[str] = []


class CurrentSpinPublic(BaseModel):
    round_number: int
    spin_type: str
    franchise_display_name: Optional[str] = None
    era_label: Optional[str] = None
    candidates: list[SpinCandidate]


class PendingSelectionPublic(BaseModel):
    peak_window_id: str
    player_name: str
    primary_position: Optional[str] = None
    secondary_positions: list[str] = []
    # slot_type -> "primary" | "secondary" | "off_position" | "flexible" for
    # every currently open slot -- lets the UI show whether the pending pick
    # fits each open court/bench spot before it's placed (never blocking).
    fit_by_open_slot: dict[str, str] = {}


class CourtSlotPublic(BaseModel):
    slot_type: str
    filled: bool
    peak_window_id: Optional[str] = None
    player_name: Optional[str] = None
    anchor_season: Optional[str] = None
    # "primary" | "secondary" | "off_position" | "flexible" -- display-only
    # position/role fit note (nba_peak.perfect_season.positions.classify_fit),
    # set once the slot is filled; never gates placement legality.
    role_fit: Optional[str] = None
    # The placed player's own v1 archetype-approximated position(s) -- lets
    # the UI explain an off-position placement ("plays SF") rather than
    # just flagging it, never a score.
    primary_position: Optional[str] = None
    secondary_positions: list[str] = []
    # Withheld until the roster is fully locked and simulated (status ==
    # "result_ready") -- see app/services/perfect_season/state.py::
    # get_public_state's "Deferred reveal" docstring. Always None before
    # that, even for an already-filled slot.
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
    lineup_peak_score: float = 0.0


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
    # Phase 6A receipt fields -- populated only for generate_team_year_board()
    # boards (team+YEAR engine); None for team_decade/open_pool boards.
    experimental_team_year_data_version: Optional[str] = None
    formula_version: Optional[str] = None
    coverage_mode: Optional[str] = None
    simulation_result: Optional[SimulationResultPublic] = None


class CourtBuilderCoverageSummary(BaseModel):
    """Per-mode (duration-aware) audit of interim-dataset candidate depth --
    see nba_peak.perfect_season.board.coverage_summary's docstring. Exists
    so coverage gaps are an inspectable API response, not something only
    discoverable by reading the interim dataset or board generator source."""
    available: bool
    mode: Optional[str] = None
    duration_years: Optional[int] = None
    total_combinations: int = 0
    playable_combinations: int = 0
    sparse_combinations: int = 0
    excluded_zero_candidate_combinations: int = 0
    per_era: dict[str, dict[str, int]] = {}
    per_team: dict[str, dict[str, int]] = {}


class CourtBuilderReadinessResponse(BaseModel):
    readiness_level: str
    courtbuilder_enabled: bool
    team_spin_enabled: bool
    interim_team_data_version: str
    interim_team_franchise_count: int
    # The actual resolvable team-wheel pool -- the frontend spin ceremony
    # cycles through exactly this list, never a broader decorative list that
    # includes franchises no spin could ever land on.
    interim_team_franchise_names: list[str] = []
    # Coverage audit for the requested mode (defaults to apex_1y) -- total/
    # playable/sparse/excluded combination counts plus per-era and per-team
    # breakdowns. See CourtBuilderCoverageSummary.
    coverage: CourtBuilderCoverageSummary
    # Phase 6A: experimental team+YEAR (exact season) engine, independent of
    # the team+decade fields above. season_count is intentionally small in
    # this pass (see data/game/experimental/player_pool_1500/
    # courtbuilder_team_year.experimental.v0.json's own coverage_note) --
    # never presented as broad/official coverage.
    team_year_enabled: bool = False
    experimental_team_year_data_version: str = "unavailable"
    experimental_team_year_franchise_count: int = 0
    experimental_team_year_franchise_names: list[str] = []
    experimental_team_year_season_count: int = 0
    experimental_team_year_season_labels: list[str] = []
