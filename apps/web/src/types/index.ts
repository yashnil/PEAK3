// Core PEAK3 types — mirroring the API response schemas

export interface PeakWindowComponents {
  statistical_impact: number;
  traditional_production: number;
  individual_recognition: number;
  postseason_individual_value: number;
  team_achievement: number;
  teammate_adjustment: number;
}

export interface PeakWindow {
  id: string;
  player_id: string;
  player_slug: string;
  player_name: string;
  duration_years: number;
  start_season: string;
  end_season: string;
  anchor_season: string;
  rank: number;
  prime_score: number;
  prime_index: number;
  components: PeakWindowComponents;
  data_status: string;
}

// Public duel card shown before answer (no scores/ranks)
export interface DuelCard {
  player_name: string;
  player_slug: string;
  duration_years: number;
  start_season: string;
  end_season: string;
  anchor_season: string;
  peak_id: string;
}

export interface Duel {
  id: string;
  left: DuelCard;
  right: DuelCard;
  difficulty: "Comfortable" | "Tricky" | "Brutal" | "Photo Finish";
}

export interface ComponentComparison {
  winner: number;
  loser: number;
  winner_leads: boolean;
}

export interface AnswerResponse {
  correct: boolean;
  winning_peak_id: string;
  arena_points_awarded: number;
  updated_streak: number;
  difficulty: string;
  score_gap: number;
  winner: PeakWindow;
  loser: PeakWindow;
  component_comparison: Record<string, ComponentComparison>;
  explanation: string;
  selected_correctly: boolean;
}

export interface DailyChallenge {
  date: string;
  years: number;
  duel_count: number;
  duels: Duel[];
  session_token: string;
}

export interface EndlessSession {
  seed: number;
  years: number;
  duel_count: number;
  duels: Duel[];
  session_token: string;
}

export interface LeaderboardRow {
  id: string;
  player_id: string;
  player_slug: string;
  player_name: string;
  duration_years: number;
  start_season: string;
  end_season: string;
  anchor_season: string;
  rank: number;
  prime_score: number;
  prime_index: number;
  components: PeakWindowComponents;
  data_status: string;
}

export interface LeaderboardResponse {
  rows: LeaderboardRow[];
  total: number;
  duration: number;
  offset: number;
  limit: number;
  metadata: DatasetMetadata;
}

// Phase 6D: Peak section top-1000 (broader universe than the 250-pool
// LeaderboardRow/LeaderboardResponse above -- deliberately a separate,
// simpler shape, never merged with the canonical leaderboard types).
export interface PeakRow {
  rank: number;
  player_slug: string;
  player_name: string;
  window_label: string;
  anchor_season: string;
  team: string | null;
  prime_score: number;
  data_completeness: string;
  // Phase 6E Part B: asset-manifest schema readiness, always null today.
  headshot_url?: string | null;
}

export interface PeaksResponse {
  window: "1y" | "2y" | "3y" | "5y";
  duration_years: number;
  dataset_version: string;
  formula_version: string;
  model_version: string;
  model_label: string;
  is_default_model: boolean;
  supported_start_season: string;
  supported_end_season: string;
  universe_identity_count: number;
  total_available: number;
  rows: PeakRow[];
}

// ---------------------------------------------------------------------------
// Phase 9B: Single Seasons board (/api/v1/seasons).
//
// A THIRD, deliberately different shape: one row per SEASON rather than per
// player, so a player appears as many times as they have top-1000 seasons.
// Never merged with LeaderboardRow (canonical 250-pool) or PeakRow (best window
// per player) -- the whole value of this board is that it does NOT dedupe.
// ---------------------------------------------------------------------------
export interface SeasonRow {
  rank: number;
  season_id: string;
  player_slug: string;
  player_name: string;
  season: string;
  team: string | null;
  is_multi_team_season: boolean;
  prime_score: number | null;
  prime_index: number | null;
  /** The season's own MPG. Every served row clears the published minutes floor. */
  season_mpg: number | null;
  season_in_progress: boolean;
}

export interface SeasonsResponse {
  dataset_version: string;
  formula_version: string;
  model_version: string;
  model_label: string;
  is_default_model: boolean;
  supported_start_season: string;
  supported_end_season: string;
  universe_identity_count: number;
  total_scored_seasons: number;
  allows_repeated_players: boolean;
  min_season_mpg: number;
  excluded_low_minute_seasons: number;
  serving_gate_note: string;
  effective_tie_threshold: number;
  total_available: number;
  offset: number;
  limit: number;
  rows: SeasonRow[];
}

/** One official weighted component, exactly as the API published it. `null`
 *  means the API did not supply the value -- the UI must say so, never zero. */
export interface ScoreExplainComponent {
  component: string;
  contribution: number | null;
  weight: number | null;
  /** Percentile of this contribution against the full scored population. */
  percentile: number | null;
}

/** Gap to an adjacent rank. Sub-threshold gaps are presented as ties. */
export interface SeasonExplainMargin {
  rank: number;
  player_name: string;
  season: string;
  prime_index: number;
  gap: number;
  effectively_tied: boolean;
}

export interface SeasonExplain {
  season_id: string;
  player_slug: string;
  player_name: string;
  season: string;
  team: string | null;
  is_multi_team_season: boolean;
  window_type: string;
  rank: number;
  prime_score: number | null;
  prime_index: number | null;
  components: ScoreExplainComponent[];
  score_split: {
    regular_season: number | null;
    regular_season_components: string[];
    postseason: number | null;
    recognition: number | null;
    team_achievement: number | null;
    non_regular_season: number | null;
  };
  season_mpg: number | null;
  teammate_adjustment: number | null;
  strongest_components: string[];
  weakest_components: string[];
  recognition: {
    awards: string | null;
    mvp_vote_share: number | null;
    dpoy_vote_share: number | null;
  };
  team_context: {
    championship: number | null;
    finals_appearance: number | null;
    made_playoffs: number | null;
    n_teams: number | null;
  };
  postseason: {
    games: number | null;
    minutes: number | null;
    series_count: number | null;
    availability: string | null;
  };
  role_and_sample: {
    games_played: number | null;
    minutes_total: number | null;
    minutes_per_game: number | null;
    role: string | null;
    season_complete: number | null;
    season_progress_pct: number | null;
  };
  data_completeness: {
    burden: string | null;
    team_share: string | null;
    mvp_vote: string | null;
    dpoy_vote: string | null;
  };
  caveats: string[];
  margins: {
    above: SeasonExplainMargin | null;
    below: SeasonExplainMargin | null;
  };
  effective_tie_threshold: number;
  min_season_mpg: number;
}

export interface SeasonExplainResponse {
  season_id: string;
  explain: SeasonExplain;
}

// ---------------------------------------------------------------------------
// Phase 9C: the rankings-section contract.
//
// Two boards only -- Peak Windows (one row per player) and Single Seasons (one
// row per season, repeated players expected). Both boards publish the SAME row
// shape, which is what lets one table, one sort model and one explain modal
// serve both. The canonical 250-pool board is gone: it was a subset of Peak
// Windows with less data attached.
//
// `RankingRow*Payload` is the wire shape and is deliberately permissive -- every
// added field is optional so the UI keeps working against an API that has not
// yet shipped the full block. `RankingRow` is the normalized shape the UI
// renders, where "absent" is always an explicit `null` (never 0, never a guess).
// ---------------------------------------------------------------------------

export type RankingComponentKey =
  | "statistical_impact"
  | "traditional_production"
  | "individual_recognition"
  | "postseason_individual_value"
  | "team_achievement";

/** Which of the two boards a row came from. Also selects the explain endpoint. */
export type RankingBoardId = "peakWindows" | "seasons";

export type RankingComponentValues = Record<RankingComponentKey, number | null>;

/** Population percentiles, plus the percentile of the total score itself. */
export type RankingPercentiles = Record<RankingComponentKey | "total", number | null>;

export interface RankingRow {
  rank: number;
  row_id: string;
  player_slug: string;
  player_name: string;
  /** "1990-91", "1988-89 – 1990-91", … whatever the board calls this row. */
  label: string;
  team: string | null;
  prime_score: number | null;
  prime_index: number | null;
  /** `null` when the board does not publish contributions at all. */
  components: RankingComponentValues | null;
  percentiles: RankingPercentiles | null;
  mpg: number | null;
  data_completeness: string | null;
  headshot_url: string | null;
  season_in_progress: boolean;
}

export interface RankingRowPayload {
  rank: number;
  player_slug: string;
  player_name: string;
  row_id?: string | null;
  /** Legacy identifiers, still accepted so the table survives a mid-flight API. */
  season_id?: string | null;
  peak_id?: string | null;
  label?: string | null;
  window_label?: string | null;
  season?: string | null;
  team?: string | null;
  prime_score?: number | null;
  prime_index?: number | null;
  components?: Partial<Record<RankingComponentKey, number | null>> | null;
  percentiles?: Partial<Record<RankingComponentKey | "total", number | null>> | null;
  mpg?: number | null;
  season_mpg?: number | null;
  data_completeness?: string | null;
  data_status?: string | null;
  headshot_url?: string | null;
  season_in_progress?: boolean | null;
}

/** Board-level provenance. Every field optional: a board that omits one simply
 *  renders one fewer line of provenance rather than a fabricated one. */
export interface RankingBoardMeta {
  dataset_version: string | null;
  formula_version: string | null;
  /** Which scoring model produced these rows, e.g. "peak3_v1". */
  model_version: string | null;
  /** Short human label for that model, e.g. "PEAK3 v2 (preview)". */
  model_label: string | null;
  /** False when the board is being previewed under a non-default model. */
  is_default_model: boolean;
  supported_start_season: string | null;
  supported_end_season: string | null;
  total_available: number | null;
  universe_identity_count: number | null;
  serving_gate_note: string | null;
  effective_tie_threshold: number | null;
  min_season_mpg: number | null;
  /** SHA-256 of the ranking artifact the API process actually loaded. This is
   *  the provenance value the page can show without trusting a file mtime --
   *  mtime skew between `leaderboards/` and the generated boards is exactly
   *  what produced a false "the rankings are stale" report. */
  artifact_digest: string | null;
  /** Pass-through from the artifact. `build_top_peaks.py` does not yet write
   *  one, so this is routinely null; it is deliberately NOT back-filled from a
   *  file mtime. See docs/implementation/RANKINGS_SYNC_REPORT.md. */
  generated_at: string | null;
}

export interface RankingBoardPayload {
  rows: RankingRowPayload[];
  dataset_version?: string | null;
  formula_version?: string | null;
  model_version?: string | null;
  model_label?: string | null;
  is_default_model?: boolean | null;
  supported_start_season?: string | null;
  supported_end_season?: string | null;
  total_available?: number | null;
  universe_identity_count?: number | null;
  serving_gate_note?: string | null;
  effective_tie_threshold?: number | null;
  min_season_mpg?: number | null;
  artifact_digest?: string | null;
  generated_at?: string | null;
}

export interface RankingBoardData {
  rows: RankingRow[];
  meta: RankingBoardMeta;
}

/** One clickable neighbour in the explain block. Clicking it pivots the modal
 *  onto that row (same board, so the same explain endpoint serves it). */
export interface RankingComparison {
  row_id: string;
  label: string;
  prime_score: number | null;
  rank: number;
  player_name?: string | null;
  /** Signed score difference vs. the row being explained, when published. */
  delta?: number | null;
}

export interface RankingExplainSeasonStats {
  games?: number | null;
  mpg?: number | null;
  ppg?: number | null;
  rpg?: number | null;
  apg?: number | null;
  ts_pct?: number | null;
  per?: number | null;
  bpm?: number | null;
  ws?: number | null;
  // Phase 12A: already present in the served block, now typed because the
  // component receipts cite them (see lib/rankings-receipts.ts). All optional
  // for the same reason as the fields above -- a row that lacks one omits the
  // clause rather than printing a placeholder.
  obpm?: number | null;
  dbpm?: number | null;
  vorp?: number | null;
  ws_per_48?: number | null;
  usg_pct?: number | null;
  ts_plus?: number | null;
  pts_per_75?: number | null;
  ast_per_75?: number | null;
  pts_per_100?: number | null;
  trb_per_100?: number | null;
  ast_per_100?: number | null;
  minutes_total?: number | null;
}

/** The context blocks are typed loosely on purpose: the modal renders whichever
 *  keys arrive non-null and omits the section when none do, so an API that adds
 *  or drops a field never produces an empty block or an invented one. */
export type RankingExplainBlock = Record<string, string | number | boolean | null | string[]>;

export interface RankingExplain extends RankingRow {
  window_type: string;
  seasons_in_window: string[];
  /** THE authoritative weights. Never hardcoded in TypeScript. */
  weights: Partial<Record<RankingComponentKey, number>>;
  teammate_adjustment: number | null;
  score_split: {
    regular_season: number | null;
    postseason: number | null;
    recognition: number | null;
    team: number | null;
  };
  strongest_components: string[];
  weakest_components: string[];
  season_stats: RankingExplainSeasonStats | null;
  recognition: RankingExplainBlock | null;
  postseason: RankingExplainBlock | null;
  team_context: RankingExplainBlock | null;
  role_and_sample: RankingExplainBlock | null;
  comparisons: {
    same_player: RankingComparison[];
    similar_scores: RankingComparison[];
    same_season_peers: RankingComparison[];
  };
  caveats: string[];
  /** Which scoring model produced this block. */
  model_version: string | null;
  /** Why THIS season is the one on the board. Present on 1Y rows; the 3Y/5Y
   *  windows already span several seasons so there is nothing to explain. */
  anchor_selection: RankingAnchorSelection | null;
}

/** A season the board's anchor narrowly beat, and what made it iconic. */
export interface NearbyIconicSeason {
  season: string;
  prime_score: number | null;
  /** How far the anchor beat it by, in prime_score points. Always positive. */
  margin: number | null;
  /** e.g. ["champion", "Finals MVP", "MVP"]. */
  markers: string[];
}

export interface RankingAnchorSelection {
  /** How the anchor was chosen, e.g. "highest-scoring single season". */
  basis: string | null;
  nearby_iconic_seasons: NearbyIconicSeason[];
}

export interface DatasetMetadata {
  schema_version: string;
  model_version: string;
  generated_at: string;
  source_commit: string;
  supported_durations: number[];
  player_count: number;
  peak_window_count: number;
  source_artifacts: string[];
}

export interface PlayerSearchResult {
  player_slug: string;
  player_name: string;
  best_rank: number;
  available_durations: number[];
}

export interface PlayerSearchResponse {
  players: PlayerSearchResult[];
}

export interface PlayerProfile {
  player_slug: string;
  player_name: string;
  windows: Partial<Record<string, PeakWindow>>;
}

// Game state types

export type GameMode = "daily" | "endless";
export type DuelPhase = "picking" | "revealing" | "complete";

export interface DuelResult {
  duel_id: string;
  selected_peak_id: string;
  correct: boolean;
  arena_points_awarded: number;
  difficulty: string;
  score_gap: number;
  answer_response: AnswerResponse;
}

export interface GameState {
  mode: GameMode;
  years: number;
  date?: string;
  seed?: number;
  session_token: string;
  duels: Duel[];
  current_index: number;
  phase: DuelPhase;
  results: DuelResult[];
  total_arena_points: number;
  current_streak: number;
  best_streak: number;
  selected_peak_id: string | null;
  current_answer: AnswerResponse | null;
  is_submitting: boolean;
  error: string | null;
}

// Progress persistence

export interface DailyCompletion {
  date: string;
  years: number;
  correct: number;
  total: number;
  arena_points: number;
  best_streak: number;
  results: Array<{
    correct: boolean;
    difficulty: string;
  }>;
  completed_at: string;
}

export interface LocalProgress {
  schema_version: number;
  daily_completions: Record<string, DailyCompletion>;
  endless_high_score: number;
  endless_best_streak: number;
  lifetime_attempts: number;
  lifetime_correct: number;
  preferred_duration: number;
  settings: {
    reduced_motion: boolean;
  };
}

// Methodology types

export interface MethodologyComponent {
  id: string;
  label: string;
  weight: number;
  weight_pct: number;
  short_description: string;
  long_description: string;
  key_inputs: string[];
  common_misconceptions: string[];
}

export interface Methodology {
  weights: Record<string, number>;
  components: MethodologyComponent[];
  teammate_adjustment: {
    id: string;
    label: string;
    description: string;
    range: [number, number];
  };
  calibration: {
    description: string;
    raw_label: string;
    display_label: string;
  };
  window_aggregation: {
    description: string;
    weights: Record<string, number[]>;
  };
}
