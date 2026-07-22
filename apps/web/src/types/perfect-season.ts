// 82-0 Peak Season / CourtBuilder TypeScript types (Phase 5C vertical slice).
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

export const SLOT_TYPES = [
  "starter_1", "starter_2", "starter_3", "starter_4", "starter_5",
  "bench_1", "bench_2", "bench_3",
] as const;
export type SlotType = (typeof SLOT_TYPES)[number];

export const TOTAL_ROUNDS = 8;

export interface SpinCandidate {
  player_slug: string;
  player_name: string;
}

export interface CurrentSpin {
  round_number: number;
  spin_type: "team_decade" | "exact_team_season" | "open_pool";
  franchise_display_name: string | null;
  era_label: string | null;
  candidates: SpinCandidate[];
}

export interface PendingSelection {
  peak_window_id: string;
  player_name: string;
}

export interface CourtSlotPublic {
  slot_type: SlotType;
  filled: boolean;
  peak_window_id?: string | null;
  player_name?: string | null;
  anchor_season?: string | null;
  individual_peak_score?: number | null;
  individual_peak_rank?: number | null;
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
  simulation_result: SimulationResultPublic | null;
}

export interface CourtBuilderReadiness {
  readiness_level: string;
  courtbuilder_enabled: boolean;
  team_spin_enabled: boolean;
  interim_team_data_version: string;
  interim_team_franchise_count: number;
}

export const COURT_MODE_LABELS: Record<CourtMode, string> = {
  apex_1y: "1Y Apex",
  prime_3y: "3Y Prime",
  foundation_5y: "5Y Foundation",
};

export const SLOT_LABELS: Record<SlotType, string> = {
  starter_1: "Starter 1",
  starter_2: "Starter 2",
  starter_3: "Starter 3",
  starter_4: "Starter 4",
  starter_5: "Starter 5",
  bench_1: "Bench 1",
  bench_2: "Bench 2",
  bench_3: "Bench 3",
};
