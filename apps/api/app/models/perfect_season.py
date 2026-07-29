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


class RespinRequest(BaseModel):
    """Phase 6G Part C: body for both /respin-team and /respin-season --
    identical shape to CancelSelectionRequest (just a game_id confirmation),
    kept as its own type so the two respin kinds don't share a request
    model by coincidence."""
    game_id: str


class PlaceCardRequest(BaseModel):
    game_id: str
    slot_type: str = Field(..., description="PG | SG | SF | PF | C | bench_1 | bench_2 | bench_3")
    idempotency_key: Optional[str] = Field(None)


class CompleteGameRequest(BaseModel):
    game_id: str


class SubmitRunRequest(BaseModel):
    """Phase 6G Part E: the ONLY client-controlled input to a leaderboard
    submission is which completed game to submit -- every scored/roster
    field is recomputed server-side from the saved game state, never taken
    from the request body (Part E: 'Client must never submit arbitrary
    wins/score')."""
    game_id: str


class PerfectSeasonRunPublic(BaseModel):
    id: str
    display_name: str
    mode: str
    game_type: str
    seed: int
    wins: int
    losses: int
    lineup_score: float
    score_status: str
    exact_cards_scored: int
    total_cards: int
    team_respins_used: int
    season_respins_used: int
    data_version: Optional[str] = None
    formula_version: Optional[str] = None
    simulation_version: Optional[str] = None
    created_at: str


class LeaderboardResponse(BaseModel):
    leaderboard_enabled: bool
    runs: list[PerfectSeasonRunPublic] = []
    next_cursor: Optional[str] = None


class MyRunsResponse(BaseModel):
    runs: list[PerfectSeasonRunPublic] = []


class SpinCandidate(BaseModel):
    player_slug: str
    player_name: str
    # v1 archetype-approximated position eligibility (never a score) --
    # shown during selection so a player can see "allowed positions" before
    # picking, per docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md Sec 6.4b.
    # For team_year candidates, this is the player's REAL per-season
    # position (nba_peak.perfect_season.positions.parse_real_position), not
    # an archetype approximation.
    primary_position: Optional[str] = None
    secondary_positions: list[str] = []
    # Phase 6C: exact team-season identity fields. None for team_decade/
    # exact_team_season/open_pool candidates (those resolve via the legacy
    # peak-window card path); always set for team_year candidates.
    team_id: Optional[str] = None
    team_name: Optional[str] = None
    season: Optional[str] = None
    # canonical_250 | qualifies_1500 | team_year_roster_only | unresolved
    identity_pool_status: Optional[str] = None
    # exact_season_scored | exact_season_unscored | score_unavailable --
    # never a score/rank itself (ADR-005 Decision 6), only whether one
    # exists.
    score_status: Optional[str] = None
    # Phase 7A Part A: exact_team_stint | exact_season_aggregate | roster_only_unscored
    score_source: Optional[str] = None
    # Phase 6F/7A: populated from data/game/assets/player_assets.v3.json
    # (ESPN + NBA_CDN providers) ONLY when Settings.ENABLE_EXTERNAL_ASSET_URLS
    # is true (default off) -- None otherwise, and the frontend falls back
    # to initials for a None/missing URL either way (PlayerAvatar's
    # imageUrl prop).
    headshot_url: Optional[str] = None


class CurrentSpinPublic(BaseModel):
    round_number: int
    spin_type: str
    franchise_display_name: Optional[str] = None
    era_label: Optional[str] = None
    candidates: list[SpinCandidate]
    # Phase 6C team_year fields -- None for team_decade/exact_team_season/
    # open_pool spins.
    team_id: Optional[str] = None
    candidate_source: Optional[str] = None  # "exact_team_season" for team_year spins
    data_version: Optional[str] = None
    coverage_mode: Optional[str] = None
    # Phase 6F Part C: only populated when Settings.ENABLE_EXTERNAL_ASSET_URLS
    # is true (default off).
    team_logo_url: Optional[str] = None
    # Phase 7A Part C: RUN-LEVEL respin budget (never resets per round --
    # 3 team + 3 season for the whole 8-round attempt) -- only populated
    # for team_year spins, since respins reroll the team+season reel that
    # only team_year mode has. None for team_decade/exact_team_season/
    # open_pool spins, which don't support respins at all.
    team_respins_used: Optional[int] = None
    team_respins_max: Optional[int] = None
    season_respins_used: Optional[int] = None
    season_respins_max: Optional[int] = None


class PendingSelectionPublic(BaseModel):
    # Exactly one of peak_window_id / exact_player_season_key is set,
    # matching which card type this pending selection resolved to.
    peak_window_id: Optional[str] = None
    exact_player_season_key: Optional[str] = None
    player_name: str
    team_id: Optional[str] = None
    team_name: Optional[str] = None
    season: Optional[str] = None
    identity_pool_status: Optional[str] = None
    score_status: Optional[str] = None
    # Phase 7A Part A: exact_team_stint | exact_season_aggregate | roster_only_unscored
    score_source: Optional[str] = None
    primary_position: Optional[str] = None
    secondary_positions: list[str] = []
    # slot_type -> "primary" | "secondary" | "off_position" | "flexible" for
    # every currently open slot -- lets the UI show whether the pending pick
    # fits each open court/bench spot before it's placed (never blocking).
    fit_by_open_slot: dict[str, str] = {}
    # Phase 6F Part C: only populated when Settings.ENABLE_EXTERNAL_ASSET_URLS
    # is true (default off).
    headshot_url: Optional[str] = None


class CourtSlotPublic(BaseModel):
    slot_type: str
    filled: bool
    peak_window_id: Optional[str] = None
    exact_player_season_key: Optional[str] = None
    player_name: Optional[str] = None
    anchor_season: Optional[str] = None
    team_id: Optional[str] = None
    team_name: Optional[str] = None
    season: Optional[str] = None
    identity_pool_status: Optional[str] = None
    score_status: Optional[str] = None
    # Phase 7A Part A: exact_team_stint | exact_season_aggregate | roster_only_unscored
    score_source: Optional[str] = None
    # "primary" | "secondary" | "off_position" | "flexible" -- display-only
    # position/role fit note (nba_peak.perfect_season.positions.classify_fit
    # / classify_fit_from_position), set once the slot is filled; never
    # gates placement legality.
    role_fit: Optional[str] = None
    # The placed player's own position(s) -- v1 archetype-approximated for
    # peak-window cards, real per-season position for team_year cards. Lets
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
    # Team_year mode's reveal-only score -- the real, official per-season
    # PEAK3 prime_score, never a career-peak substitute. None if score_status
    # != "exact_season_scored" (not fabricated).
    season_score: Optional[float] = None
    resolved_via_spin_id: Optional[str] = None
    # Phase 6F Part C: only populated when Settings.ENABLE_EXTERNAL_ASSET_URLS
    # is true (default off).
    headshot_url: Optional[str] = None
    # Phase 8F: the placed card's real team logo (team_year/exact-season
    # slots only -- peak-window slots have no single team attached). Same
    # ENABLE_EXTERNAL_ASSET_URLS gate as headshot_url.
    team_logo_url: Optional[str] = None


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
    # "complete" | "incomplete" -- team_year boards only ("complete" always
    # for legacy peak-window boards, whose cards are always scored). The UI
    # must show "Prototype score incomplete" instead of lineup_peak_score
    # when this is "incomplete" (score_substitution_allowed=false: an
    # incomplete score is reported as incomplete, never backfilled with a
    # career-peak or approximate value).
    lineup_score_status: str = "complete"
    # Phase 6F Part F: server-computed result explanation -- best_pick is the
    # highest real-score contributor; structural_weakness prioritizes roster
    # CONSTRUCTION issues (named off-position starters, missing wing/big
    # coverage, thin bench) over "whichever legend scored lowest". Phase 8H:
    # now computed for BOTH the exact-season and legacy career-peak-window
    # paths (nba_peak.perfect_season.simulation._structural_weakness is the
    # legacy-path counterpart of _structural_weakness_exact) -- previously
    # only the exact-season path had this depth.
    best_pick: Optional[str] = None
    structural_weakness: Optional[str] = None
    # Phase 8 pre-loop polish: one-sentence explainer for structural_weakness
    # (see nba_peak.perfect_season.simulation._COMPONENT_EXPLAINERS) -- e.g.
    # clarifies that "thin bench depth" is relative to the starters' own
    # 0-100 all-time-peak scores, not a real-world judgment on the players.
    # None when the weakness text is already self-explanatory or for legacy
    # peak-window boards (same scope as structural_weakness itself).
    structural_weakness_detail: Optional[str] = None
    # Phase 7A Part F: "weakness" | "ceiling_limiter" -- drives whether the
    # UI prefixes structural_weakness with "Weakness:" or "Ceiling limiter:".
    weakness_framing: Optional[str] = None
    # Phase 8H: "what PEAK3 would have picked" post-run recap -- see
    # nba_peak.perfect_season.schemas.SimulationResult.peak_picks_recap and
    # state.py::_compute_peak_picks_recap for the full contract. Only ever
    # populated once result_ready (the same reveal gate as every other
    # score-bearing field here).
    peak_picks_recap: Optional[list[dict]] = None


class ProvisionalRecordRange(BaseModel):
    low_wins: int
    high_wins: int


class LiveBuildPublic(BaseModel):
    """Phase 6E Part D: compact mid-run feedback. Never includes a hidden
    score, never names which open-round candidate to pick."""
    placed_count: int
    total_rounds: int
    scored_count: int
    unscored_count: int
    identity_tags: list[str] = []
    needs: list[str] = []
    provisional_record_range: Optional[ProvisionalRecordRange] = None
    # Phase 7A Part E: "early_projection" | "narrowing_projection" |
    # "ready_to_simulate" -- drives the UI copy so a wide early-round
    # range never reads as a confident prediction.
    projection_confidence: str = "early_projection"


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
    # Phase 6C: true only if this board actually contains an open_pool spin
    # (legacy team_decade path only, when the interim dataset can't fill all
    # rounds) -- always false for team_year boards, which never produce
    # open_pool spins. Named to match the readiness endpoint's
    # open_pool_enabled for consistency.
    open_pool_enabled: bool = False
    simulation_result: Optional[SimulationResultPublic] = None
    live_build: Optional[LiveBuildPublic] = None
    # Phase 6G Part C: every respin this attempt has used, across all
    # rounds -- {"round": int, "kind": "team"|"season", "from_team": str,
    # "from_season": str, "to_team": str, "to_season": str}. Part of the
    # data receipt; also read by the leaderboard submission path (Part E).
    respin_history: list[dict] = []
    # Phase 7A Part C: explicit run-level counters for the data receipt --
    # always present (unlike current_spin.team_respins_used, which is only
    # set while a team_year spin is active).
    team_respins_used_total: int = 0
    team_respins_remaining_total: int = 3
    season_respins_used_total: int = 0
    season_respins_remaining_total: int = 3


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
    # Phase 6D: experimental team+YEAR (exact season) engine, independent of
    # the team+decade fields above. Broad coverage as of v2 (1,310 rollable
    # team-seasons, 40 franchises, 1979-80..2025-26 -- see
    # data/game/experimental/player_pool_1500/
    # courtbuilder_team_year.experimental.v3.json's own coverage_note) --
    # still labeled experimental, not the canonical/official CourtBuilder mode.
    team_year_enabled: bool = False
    experimental_team_year_data_version: str = "unavailable"
    experimental_team_year_franchise_count: int = 0
    experimental_team_year_franchise_names: list[str] = []
    experimental_team_year_season_count: int = 0
    experimental_team_year_season_labels: list[str] = []

    # Phase 6C: exact-season-card-required contract + team-season coverage
    # visibility -- see nba_peak.perfect_season.board.experimental_team_year_summary.
    supported_start_season: str = "1979-80"
    supported_end_season: str = "2025-26"
    target_end_season: str = "2025-26"
    total_team_season_count: int = 0
    rollable_team_season_count: int = 0
    min_candidates_per_team_season: int = 0
    max_candidates_per_team_season: int = 0
    median_candidates_per_team_season: float = 0.0
    open_pool_enabled: bool = False
    exact_season_card_required: bool = True
    score_substitution_allowed: bool = False
    peak_card_substitution_allowed: bool = False
    sample_supported_team_seasons: list[str] = []
    low_coverage_team_seasons: list[str] = []
    season_2025_26_coverage_status: str = "not_covered"
    warnings: list[str] = []
    # Phase 6D: explicit spinner coverage lists -- teams_represented_in_spinner
    # is the franchise_ids_represented from the v2 dataset (identical set to
    # experimental_team_year_franchise_names above, different key name to
    # match the Phase 6D task's exact field naming); seasons_represented_in_
    # spinner is every season_label with at least one rollable team-season.
    supported_franchise_count: int = 0
    teams_represented_in_spinner: list[str] = []
    seasons_represented_in_spinner: list[str] = []
