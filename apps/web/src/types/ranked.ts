/**
 * Types for Phase 4.0 ranked duels. Server-shape interfaces mirror
 * apps/api/app/models/ranked.py field-for-field (snake_case, matching the
 * FastAPI/Pydantic response — same convention as types/draft.ts).
 */
import type { DraftGameState } from "./draft";

export type RankedMode = "apex_1y" | "prime_3y" | "foundation_5y";

export const RANKED_MODES: RankedMode[] = ["apex_1y", "prime_3y", "foundation_5y"];

export const RANKED_MODE_LABELS: Record<RankedMode, string> = {
  apex_1y: "1Y Apex",
  prime_3y: "3Y Prime",
  foundation_5y: "5Y Foundation",
};

// ── Queues ──────────────────────────────────────────────────────────────

export interface RankedQueueInfo {
  mode: RankedMode;
  label: string;
  queue_version: string;
  rating_algorithm_version: string;
  placement_count: number;
}

export interface RankedQueuesResponse {
  queues: RankedQueueInfo[];
  ranked_enabled: boolean;
  matchmaking_enabled: boolean;
}

export interface JoinQueueResponse {
  status: "waiting" | "matched";
  mode: RankedMode;
  queue_entry_id: string | null;
  match_id: string | null;
}

export interface MatchmakingStatusResponse {
  status: "not_in_queue" | "waiting" | "matched" | "cancelled";
  mode: RankedMode;
  waited_seconds: number | null;
  match_id: string | null;
}

// ── Match + game ────────────────────────────────────────────────────────

export type RankedParticipantStatus =
  | "board_ready"
  | "in_progress"
  | "complete"
  | "awaiting_opponent"
  | "abandoned"
  | "protected_abort";

export interface RankedMatchPublic {
  match_id: string;
  mode: RankedMode;
  status: string;
  settlement_status: string;
  deadline: string;
  you: { status: RankedParticipantStatus; game_id: string | null };
  opponent_status: string; // "hidden" pre-settlement
}

// The ranked game itself reuses the exact Draft game-state shape — same
// board/round/offer contract, same hidden-information guarantees.
export type RankedGameState = DraftGameState;

// ── Settlement ──────────────────────────────────────────────────────────

export interface RatingChange {
  prior_rating: number;
  new_rating: number;
  delta: number;
  prior_rd: number;
  new_rd: number;
}

export interface RankedSettlementView {
  match_id: string;
  outcome: "win" | "loss" | "draw";
  your_score: number;
  opponent_score: number;
  tie_break_used: string | null;
  rating_change: RatingChange;
  placement_progress: string | null;
  division_change: string | null;
  settled_at: string;
}

export interface PendingSettlementResponse {
  status: "awaiting_opponent" | "settled";
  match_id: string;
}

export type RankedSettlementOrPending = RankedSettlementView | PendingSettlementResponse;

export function isSettled(r: RankedSettlementOrPending): r is RankedSettlementView {
  return "outcome" in r;
}

// ── Rating / placement / history ───────────────────────────────────────

export interface QueueRatingResponse {
  mode: RankedMode;
  established: boolean;
  rating: number | null; // hidden during placements
  rd: number | null;
  uncertainty_label: string;
  valid_rated_matches: number;
  division: string | null;
}

export interface PlacementStateResponse {
  mode: RankedMode;
  valid_matches_completed: number;
  required_matches: number;
  established: boolean;
}

export interface RatingHistoryEntry {
  match_id: string;
  outcome: "win" | "loss" | "draw";
  pre_rating: number;
  post_rating: number;
  delta: number;
  created_at: string;
}

export interface RatingHistoryResponse {
  mode: RankedMode;
  entries: RatingHistoryEntry[];
}

// ── Leaderboard ─────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  rank: number;
  owner_sub: string;
  rating: number;
  rd: number;
  division: string | null;
}

export interface LeaderboardResponse {
  mode: RankedMode;
  enabled: boolean;
  entries: LeaderboardEntry[];
  next_cursor: string | null;
  updated_at: string;
  queue_version: string;
  rating_algorithm_version: string;
}

export interface SurroundingRankResponse {
  mode: RankedMode;
  your_rank: number | null;
  entries: LeaderboardEntry[];
}

// ── Readiness ───────────────────────────────────────────────────────────

export interface RankedReadinessResponse {
  readiness_level: "disabled" | "simulation_only" | "internal_alpha" | "closed_alpha" | "public_beta";
  ranked_enabled: boolean;
  matchmaking_enabled: boolean;
  rating_writes_enabled: boolean;
  public_leaderboard_enabled: boolean;
  rating_algorithm_version: string;
  queue_versions: Record<string, string>;
  pending_match_count: number;
  pending_rating_count: number;
  last_successful_settlement_at: string | null;
}

// ── Local UI state ──────────────────────────────────────────────────────

export type RankedUIPhase =
  | "loading"
  | "queue_idle"
  | "queue_waiting"
  | "matched"
  | "playing"
  | "awaiting_opponent"
  | "settled"
  | "error";

export interface RankedUIState {
  phase: RankedUIPhase;
  mode: RankedMode | null;
  matchId: string | null;
  gameState: RankedGameState | null;
  settlement: RankedSettlementView | null;
  errorMessage: string | null;
  waitedSeconds: number;
}

export type RankedUIAction =
  | { type: "SET_MODE"; mode: RankedMode }
  | { type: "QUEUE_JOINED"; result: JoinQueueResponse }
  | { type: "QUEUE_WAIT_TICK"; waitedSeconds: number }
  | { type: "QUEUE_CANCELLED" }
  | { type: "MATCHED"; matchId: string }
  | { type: "GAME_LOADED"; gameState: RankedGameState }
  | { type: "AWAITING_OPPONENT" }
  | { type: "SETTLED"; settlement: RankedSettlementView }
  | { type: "SET_ERROR"; message: string }
  | { type: "RESET" };
