// 82-0 Peak Season / CourtBuilder TypeScript types (Phase 5C vertical slice
// + Phase 5X.4 team/era wheels, real position court, PEAK-based scoring).
// The simulator is EXPERIMENTAL (v0, uncalibrated) -- never a prediction of
// real NBA outcomes. See docs/architecture/ADR-005-arena-pivot-and-courtbuilder.md.
//
// IMPORTANT: SpinCandidate and PendingSelection intentionally have NO score
// or rank field -- the backend never sends one before a pick is locked
// (ADR-005 Decision 6). Do not add one here "for convenience."

export type CourtMode = "apex_1y" | "prime_3y" | "foundation_5y";

export type CourtStatus =
  | "selection_pending"
  | "placement_pending"
  | "rounds_complete"
  | "result_ready";

// 5 position-anchored starter slots (v1 archetype approximation -- see
// nba_peak/perfect_season/positions.py; NOT real NBA position data) + 3
// plain, unrestricted bench slots (Bench 1/2/3 -- deliberately not
// role-flavored labels like "6th Man"/"Wildcard"). Order matters: starters
// first, then bench (mirrors the backend's SLOT_TYPES order in
// nba_peak/perfect_season/config.py).
export const SLOT_TYPES = [
  "PG", "SG", "SF", "PF", "C",
  "bench_1", "bench_2", "bench_3",
] as const;
export type SlotType = (typeof SLOT_TYPES)[number];

export const STARTER_SLOT_TYPES: SlotType[] = ["PG", "SG", "SF", "PF", "C"];
export const BENCH_SLOT_TYPES: SlotType[] = ["bench_1", "bench_2", "bench_3"];

// The 5 decades the era wheel spins across -- fixed by product decision, not
// derived from data coverage (docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md).
export const ERA_LABELS = ["1980s", "1990s", "2000s", "2010s", "2020s"] as const;

// Display-only fit note (nba_peak/perfect_season/positions.py::classify_fit)
// -- never gates whether a placement is legal. "flexible" applies to bench
// slots, which are never position-restricted.
export type RoleFit = "primary" | "secondary" | "off_position" | "flexible";

export const TOTAL_ROUNDS = 8;

// identity_pool_status: canonical_250 | qualifies_1500 | team_year_roster_only | unresolved
// score_status: exact_season_scored | exact_season_unscored | score_unavailable
export type IdentityPoolStatus = "canonical_250" | "qualifies_1500" | "team_year_roster_only" | "unresolved";
export type ScoreStatus = "exact_season_scored" | "exact_season_unscored" | "score_unavailable";

export interface SpinCandidate {
  player_slug: string;
  player_name: string;
  // For legacy peak-window candidates this is the v1 archetype-approximated
  // position; for team_year candidates it is the player's REAL per-season
  // position. Never a score either way. Shown during selection so a player
  // can see "allowed positions" before picking.
  primary_position: SlotType | null;
  secondary_positions: SlotType[];
  // Phase 6C exact-season fields -- present only for team_year candidates.
  team_id?: string | null;
  team_name?: string | null;
  season?: string | null;
  identity_pool_status?: IdentityPoolStatus | null;
  score_status?: ScoreStatus | null;
  // Phase 6E Part B: asset-manifest schema readiness -- always null today
  // (no image URLs are populated anywhere yet), rendered only if a caller
  // ever supplies a value (see PlayerAvatar's imageUrl prop / fallback
  // discipline). Never fabricated, never a scraped binary committed here.
  headshot_url?: string | null;
}

export interface CurrentSpin {
  round_number: number;
  // "team_year": exact-season spins, e.g. era_label="2015-16" -- never mixed
  // with "team_decade"'s ERA_LABELS decade strings on the same board, and
  // (Phase 6C) never "open_pool" either -- team_year boards only ever
  // produce team_year spins now.
  spin_type: "team_decade" | "exact_team_season" | "team_year" | "open_pool";
  franchise_display_name: string | null;
  era_label: string | null;
  candidates: SpinCandidate[];
  // Phase 6C team_year fields.
  team_id?: string | null;
  candidate_source?: string | null; // "exact_team_season" for team_year spins
  data_version?: string | null;
  coverage_mode?: string | null;
}

// Matches an exact-season era_label ("2015-16"), never a decade string.
export const EXACT_SEASON_RE = /^\d{4}-\d{2}$/;

export interface PendingSelection {
  // Exactly one of these two is set, matching which card type this pending
  // selection resolved to -- a PeakWindowCard (peak_window_id) or an exact
  // PlayerSeasonCard (exact_player_season_key). Never both.
  peak_window_id?: string | null;
  exact_player_season_key?: string | null;
  player_name: string;
  team_id?: string | null;
  team_name?: string | null;
  season?: string | null;
  identity_pool_status?: IdentityPoolStatus | null;
  score_status?: ScoreStatus | null;
  primary_position: SlotType | null;
  secondary_positions: SlotType[];
  // slot_type -> fit note, for every currently open slot -- lets the UI show
  // whether the pending pick fits each open spot before it's placed.
  fit_by_open_slot: Record<string, RoleFit>;
}

export interface CourtSlotPublic {
  slot_type: SlotType;
  filled: boolean;
  peak_window_id?: string | null;
  exact_player_season_key?: string | null;
  player_name?: string | null;
  anchor_season?: string | null;
  team_id?: string | null;
  team_name?: string | null;
  season?: string | null;
  identity_pool_status?: IdentityPoolStatus | null;
  score_status?: ScoreStatus | null;
  role_fit?: RoleFit | null;
  // The placed player's own position(s) -- v1 archetype-approximated for
  // peak-window cards, real per-season position for team_year cards. Used
  // to explain an off-position placement ("plays SF"), not just flag it.
  primary_position?: SlotType | null;
  secondary_positions?: SlotType[];
  // Withheld by the server until status === "result_ready" -- always null
  // for a filled slot before then. See ARENA_OVERHAUL_PRODUCT_SPEC.md Sec 3.5.
  individual_peak_score?: number | null;
  individual_peak_rank?: number | null;
  // Team-year mode's reveal-only score -- the real, official per-season
  // PEAK3 prime_score. Null whenever score_status !== "exact_season_scored"
  // (never fabricated, never a career-peak substitute).
  season_score?: number | null;
  resolved_via_spin_id?: string | null;
}

export interface SimulationResultPublic {
  lineup_model_version: string;
  simulator_version: string;
  fit_components: Record<string, number>;
  wins: number;
  losses: number;
  expected_wins: number;
  expected_wins_low: number;
  expected_wins_high: number;
  decisive_factors: string[];
  is_perfect_season: boolean;
  experimental_notice: string;
  // The durable, comparable score (0-100) -- a real mean of the 8 placed
  // cards' own individual_peak_score/season_score values, distinct from the
  // noisier 82-0 record.
  lineup_peak_score: number;
  // "complete" | "incomplete" -- team_year boards only. When "incomplete",
  // at least one placed card has no exact-season score (score_status !==
  // "exact_season_scored"); the UI MUST show "Prototype score incomplete"
  // instead of lineup_peak_score in that case (score substitution/
  // backfilling with a career-peak value is forbidden).
  lineup_score_status: "complete" | "incomplete";
}

export interface ProvisionalRecordRange {
  low_wins: number;
  high_wins: number;
}

// Phase 6E Part D: compact mid-run feedback -- never a hidden score, never a
// "pick this candidate" recommendation. Present only once >=1 slot is
// filled, on team_year boards, before the roster is fully revealed.
export interface LiveBuild {
  placed_count: number;
  total_rounds: number;
  scored_count: number;
  unscored_count: number;
  identity_tags: string[];
  needs: string[];
  provisional_record_range: ProvisionalRecordRange | null;
}

export interface CourtLineupPublicState {
  game_id: string;
  status: CourtStatus;
  mode: CourtMode;
  current_round: number;
  total_rounds: number;
  current_spin: CurrentSpin | null;
  pending_selection: PendingSelection | null;
  slots: CourtSlotPublic[];
  board_seed: number;
  card_pool_version: string;
  board_generator_version: string;
  interim_team_data_version: string | null;
  // Phase 6A receipt fields -- populated only for team+year (generate_team_
  // year_board) boards; null for team_decade/open_pool boards.
  experimental_team_year_data_version?: string | null;
  formula_version?: string | null;
  coverage_mode?: string | null;
  // True only if this board contains a legacy open_pool spin (never true for
  // team_year boards, which never produce one).
  open_pool_enabled: boolean;
  simulation_result: SimulationResultPublic | null;
  live_build: LiveBuild | null;
}

// Duration-aware coverage audit of the interim dataset -- see
// nba_peak/perfect_season/board.py::coverage_summary. Mainly a diagnostic
// (dev script / manual review), not currently rendered in the play UI.
export interface CourtBuilderCoverageBreakdown {
  combinations: number;
  playable: number;
  sparse: number;
  excluded_zero_candidate: number;
}

export interface CourtBuilderCoverageSummary {
  available: boolean;
  mode?: string;
  duration_years?: number;
  total_combinations: number;
  playable_combinations: number;
  sparse_combinations: number;
  excluded_zero_candidate_combinations: number;
  per_era: Record<string, CourtBuilderCoverageBreakdown>;
  per_team: Record<string, CourtBuilderCoverageBreakdown>;
}

export interface CourtBuilderReadiness {
  readiness_level: string;
  courtbuilder_enabled: boolean;
  team_spin_enabled: boolean;
  interim_team_data_version: string;
  interim_team_franchise_count: number;
  // The actual resolvable team-wheel pool -- the spin ceremony cycles
  // through exactly this list, never a broader decorative/fake list.
  interim_team_franchise_names: string[];
  coverage: CourtBuilderCoverageSummary;
  // Phase 6A: experimental team+YEAR engine, independent of the team+decade
  // fields above. season_count is deliberately small in this pass -- see
  // data/game/experimental/player_pool_1500/courtbuilder_team_year.
  // experimental.v0.json's own coverage_note.
  team_year_enabled: boolean;
  experimental_team_year_data_version: string;
  experimental_team_year_franchise_count: number;
  experimental_team_year_franchise_names: string[];
  experimental_team_year_season_count: number;
  experimental_team_year_season_labels: string[];
  // Phase 6C: exact-season-card-required contract + coverage visibility.
  supported_start_season: string;
  supported_end_season: string;
  target_end_season: string;
  total_team_season_count: number;
  rollable_team_season_count: number;
  min_candidates_per_team_season: number;
  max_candidates_per_team_season: number;
  median_candidates_per_team_season: number;
  open_pool_enabled: boolean;
  exact_season_card_required: boolean;
  score_substitution_allowed: boolean;
  peak_card_substitution_allowed: boolean;
  sample_supported_team_seasons: string[];
  low_coverage_team_seasons: string[];
  season_2025_26_coverage_status: string;
  warnings: string[];
}

export const COURT_MODE_LABELS: Record<CourtMode, string> = {
  apex_1y: "1Y Apex",
  prime_3y: "3Y Prime",
  foundation_5y: "5Y Foundation",
};

export const SLOT_LABELS: Record<SlotType, string> = {
  PG: "Point Guard",
  SG: "Shooting Guard",
  SF: "Small Forward",
  PF: "Power Forward",
  C: "Center",
  bench_1: "Bench 1",
  bench_2: "Bench 2",
  bench_3: "Bench 3",
};

export const ROLE_FIT_LABELS: Record<RoleFit, string> = {
  primary: "Primary fit",
  secondary: "Secondary fit",
  off_position: "Off-position",
  flexible: "",
};
