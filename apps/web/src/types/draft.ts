// Peak Draft TypeScript types
// The lineup model is EXPERIMENTAL — lineup_peak_rating is not a predicted win total.

export type DraftMode = "apex_1y" | "prime_3y" | "foundation_5y";
export type BoardType = "daily" | "practice" | "challenge" | "ranked";
export type GameStatus =
  | "board_loaded"
  | "round_active"
  | "selection_pending"
  | "hold_pending"
  | "reframe_pending"
  | "action_committed"
  | "draft_complete"
  | "expired";

export type DraftRole =
  | "lead_creator"
  | "guard_wing"
  | "wing_forward"
  | "forward_big"
  | "anchor";

export const DRAFT_ROLES: DraftRole[] = [
  "lead_creator",
  "guard_wing",
  "wing_forward",
  "forward_big",
  "anchor",
];

export const ROLE_LABELS: Record<DraftRole, string> = {
  lead_creator: "Lead Creator",
  guard_wing: "Guard / Wing",
  wing_forward: "Wing / Forward",
  forward_big: "Forward / Big",
  anchor: "Anchor",
};

export const MODE_LABELS: Record<DraftMode, string> = {
  apex_1y: "1Y Apex",
  prime_3y: "3Y Prime",
  foundation_5y: "5Y Foundation",
};

export const MODE_DESCRIPTIONS: Record<DraftMode, string> = {
  apex_1y: "The single greatest season peak",
  prime_3y: "A 3-season window of excellence",
  foundation_5y: "A sustained 5-year peak",
};

export const MODE_COLORS: Record<DraftMode, string> = {
  apex_1y: "var(--apex-coral)",
  prime_3y: "var(--prime-gold)",
  foundation_5y: "var(--foundation-blue)",
};

// v2: 6 dimensions. Each maps to a PEAK3 component field or data_status.
// Removed: peer_quality_adjustment (teammate_adjustment is context, not a lineup capability).
// Data constraint: per-stat breakdowns (defensive rating, rebound rate, block rate, position)
// are not available at the card-profile layer. The 6 dimensions are the maximum defensible
// from the committed dataset. See docs/model/LINEUP_DNA_V2.md.
export interface LineupDNA {
  primary_creation: number;      // ← statistical_impact (advanced metrics incl. defensive)
  scoring_pressure: number;      // ← traditional_production (box score + rebounding + defense box)
  individual_validation: number; // ← individual_recognition (MVP, All-NBA, DPOY, titles)
  postseason_translation: number; // ← postseason_individual_value (includes availability)
  team_context: number;          // ← team_achievement (championship contributions)
  context_completeness: number;  // ← data_status (affects lineup confidence)
}

export const DNA_LABELS: Record<keyof LineupDNA, string> = {
  primary_creation: "Creation",
  scoring_pressure: "Scoring",
  individual_validation: "Validation",
  postseason_translation: "Playoffs",
  team_context: "Team",
  context_completeness: "Data",
};

export interface DraftCard {
  peak_window_id: string;
  player_id: string;
  player_slug: string;
  player_name: string;
  duration_years: number;
  start_season: string;
  end_season: string;
  anchor_season: string;
  individual_peak_score: number;
  individual_peak_rank: number;
  eligible_roles: DraftRole[];
  primary_role: DraftRole | null;
  lineup_dna: LineupDNA;
  data_completeness: string;
  profile_status: string;
}

export interface SelectedCard {
  round: number;
  role: DraftRole;
  card: DraftCard;
}

// Decision replay: the offers shown in a completed round and the choice made.
export interface RoundHistoryEntry {
  round: number;
  reframed: boolean;
  offers: DraftCard[];
  selected_card_id: string;
  role: DraftRole;
}

export interface SynergyItem {
  rule_id: string;
  rule_type: "positive" | "negative";
  title: string;
  description: string;
  triggered: boolean;
  adjustment: number;
}

export interface ReceiptItem {
  id: string;
  item_type: string;
  title: string;
  plain_language: string;
  signed_value: number | null;
  input_ids: string[];
  rule_id: string | null;
  model_version: string;
  confidence: number;
}

export interface LineupEvaluation {
  lineup_peak_rating: number;
  talent_score: number;
  coverage_score: number;
  synergy_total: number;
  final_dna: LineupDNA;
  role_assignments: Record<DraftRole, string>;
  board_optimum: number | null;
  board_floor: number | null;
  draft_efficiency: number | null;
  board_percentile: number | null;
  solver_version: string | null;
  lineup_model_version: string;
  ruleset_version: string;
  completeness: number;
  missing_data_warnings: string[];
  synergy_items: SynergyItem[];
  receipt_items: ReceiptItem[];
}

export interface DraftGameState {
  game_id: string;
  mode: DraftMode;
  duration_years: number;
  board_type: BoardType;
  status: GameStatus;
  current_round: number;
  total_rounds: number;
  current_offers: DraftCard[];
  selected_cards: SelectedCard[];
  round_history: RoundHistoryEntry[];
  open_roles: DraftRole[];
  current_dna: LineupDNA | null;
  hold_available: boolean;
  held_card: DraftCard | null;
  reframe_available: boolean;
  reframed_this_round: boolean;
  hold_used: boolean;
  reframe_used: boolean;
  board_metadata: {
    board_id: string;
    lineup_model_version: string;
    ruleset_version: string;
    card_pool_version: string;
  };
  lineup_evaluation: LineupEvaluation | null;
}

// Local UI state for the draft screen
export type DraftUIPhase =
  | "loading"
  | "error"
  | "selecting"          // choosing from 3 offers
  | "role_select"        // picked a card, choosing role
  | "tool_confirm"       // confirming Hold or Reframe
  | "submitting"         // waiting for server response
  | "complete";          // draft_complete

export interface DraftUIState {
  phase: DraftUIPhase;
  gameState: DraftGameState | null;
  selectedOfferId: string | null;
  pendingRole: DraftRole | null;
  toolMode: "hold" | "reframe" | null;
  errorMessage: string | null;
  isLoadingTool: boolean;
}

export type DraftUIAction =
  | { type: "GAME_LOADED"; gameState: DraftGameState }
  | { type: "SELECT_OFFER"; card_id: string }
  | { type: "DESELECT_OFFER" }
  | { type: "SELECT_ROLE"; role: DraftRole }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_SUCCESS"; gameState: DraftGameState }
  | { type: "SUBMIT_ERROR"; message: string }
  | { type: "OPEN_TOOL"; tool: "hold" | "reframe" }
  | { type: "CANCEL_TOOL" }
  | { type: "TOOL_SUCCESS"; gameState: DraftGameState }
  | { type: "SET_ERROR"; message: string }
  | { type: "RESET" };

// Local persisted draft state (safe to store in localStorage)
export interface LocalDraftProgress {
  active_game_id: string | null;
  active_game_mode: DraftMode | null;
  daily_completions: Record<string, Record<DraftMode, DraftCompletionSummary>>; // date → mode → summary
  practice_history: DraftCompletionSummary[];
  preferred_mode: DraftMode;
}

export interface DraftCompletionSummary {
  game_id: string;
  mode: DraftMode;
  board_type: BoardType;
  completed_at: string;
  lineup_peak_rating: number;
  draft_efficiency: number | null;
  board_percentile: number | null;
  board_id: string;
  hold_used: boolean;
  reframe_used: boolean;
}

// ── Challenge metadata ───────────────────────────────────────────────────────

export interface ChallengeMeta {
  board_id: string;
  mode: DraftMode;
  duration_years: number;
  board_label: string;       // "Jun 29 · 1Y Apex"
  challenger_display: string; // always "A PEAK3 player"
  created_at: string;         // ISO 8601
  expires_at: string;         // ISO 8601
  status: "open" | "expired";
}

// ── Challenge comparison ─────────────────────────────────────────────────────

export interface ComparisonCard {
  round: number;
  role: DraftRole;
  player_name: string;
  individual_peak_score: number;
  anchor_season: string;
}

export interface ComparisonPlayer {
  display_name: string;
  lineup_peak_rating: number;
  talent_score: number;
  coverage_score: number;
  synergy_total: number;
  draft_efficiency: number | null;
  board_percentile: number | null;
  selected_cards: ComparisonCard[];
  final_dna: LineupDNA | null;
  synergy_items: SynergyItem[];
  hold_used: boolean;
  reframe_used: boolean;
}

export type ComparisonOutcome = "challenger_wins" | "recipient_wins" | "draw";

export interface DecisiveFactor {
  factor: string;
  winner: "challenger" | "recipient" | "tied";
  challenger_value: number;
  recipient_value: number;
}

export interface ChallengeComparisonResponse {
  outcome: ComparisonOutcome;
  challenger: ComparisonPlayer;
  recipient: ComparisonPlayer;
  decisive_factors: DecisiveFactor[];
  settled_at: string;
  mode: DraftMode;
  board_label: string;
}

// ── Active draft game (for resumption) ──────────────────────────────────────

export interface ActiveDraftGame {
  game_id: string;
  mode: DraftMode;
  board_type: BoardType;
  board_id: string;
  started_at: string;
}
