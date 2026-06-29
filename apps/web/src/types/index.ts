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
