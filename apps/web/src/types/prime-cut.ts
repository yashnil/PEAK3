/**
 * PRIME CUT — this game's reading of the Arena envelope.
 *
 * Mirrors `nba_peak/prime_cut/state.py::project` and
 * `apps/api/app/services/prime_cut/mode.py::project`. NOTHING HERE IS COMPUTED:
 * heat capture, the optimal four, the match score and placements all arrive
 * from the server.
 *
 * WHAT IS DELIBERATELY ABSENT from every LIVE type: a card's `prime_score`,
 * `prime_index` or canonical rank. The server does not send them until the
 * card's heat has resolved, so `PrimeCutCard` has no field to hold one; only
 * `PrimeCutRevealCard`, which appears inside `heat_results`, does.
 */
import type { ArenaMatchView } from "@/types/three-man-weave";

export const PRIME_CUT_MODE = "prime_cut";

/** Mirrors `nba_peak/prime_cut/config.py`. Display-only denominators; every
 *  live clock is the server's `turn_seconds_remaining`. */
export const PRIME_CUT_CARD_SECONDS = 12;
export const PRIME_CUT_CARDS_PER_HEAT = 8;
export const PRIME_CUT_KEEPS = 4;
export const PRIME_CUT_CUTS = 4;

export type PrimeCutPhase = "intro" | "heat_open" | "card" | "card_forced" | "heat_reveal" | "complete";
export type PrimeCutDecision = "keep" | "cut";
export type PrimeCutAuto = "forced" | "timeout" | "forfeit" | null;

export const PRIME_CUT_COMMAND_KEEP = "pc_keep";
export const PRIME_CUT_COMMAND_CUT = "pc_cut";
export const PRIME_CUT_COMMAND_FORFEIT = "pc_forfeit";

export interface PrimeCutSeason {
  season: string;
  /** A team abbreviation, or "Multiple teams" for a traded season. */
  team: string;
}

/** A card as any seat may see it before its heat resolves. */
export interface PrimeCutCard {
  card_index: number;
  window_id: string;
  player_slug: string;
  player_name: string;
  duration: number;
  start_season: string;
  end_season: string;
  seasons: PrimeCutSeason[];
}

/** A card after its heat has resolved. */
export interface PrimeCutRevealCard extends PrimeCutCard {
  prime_score: number;
  canonical_rank: number;
}

export interface PrimeCutDecisionRecord {
  card_index: number;
  decision: PrimeCutDecision;
  auto: PrimeCutAuto;
}

export interface PrimeCutHeatSeatResult {
  seat_index: number;
  capture: number;
  kept_card_indexes: number[];
  cut_card_indexes: number[];
  optimal_kept: number;
  kept_total: number;
  decisions: PrimeCutDecisionRecord[];
  strongest_correct_keep: number | null;
  weakest_keep: number;
  costliest_cut: number | null;
  best_call: number | null;
}

export interface PrimeCutHeatResult {
  heat_index: number;
  duration: number;
  cards: PrimeCutRevealCard[];
  optimal_card_indexes: number[];
  cut_line: number;
  optimal_total: number;
  floor_total: number;
  seats: PrimeCutHeatSeatResult[];
}

export interface PrimeCutStanding {
  seat_index: number;
  /** Keyed by duration: {"2": 88.5, "3": 71.2}. */
  heat_scores: Record<string, number>;
  heats_completed: number;
  match_score: number | null;
  optimal_keeps: number;
  captured_ratio: number | null;
  position: number;
  forfeited: boolean;
}

export interface PrimeCutSeatPublic {
  seat_index: number;
  display_name: string;
  is_bot: boolean;
  /** "Rotation" / "Starter" / "All-Star" / "MVP" for a bot, else null. */
  bot_tier: string | null;
  /** This seat has decided the current card. Never WHAT it decided. */
  locked: boolean;
  forfeited: boolean;
}

export interface PrimeCutPlacement {
  seat_index: number;
  placement: number;
  outcome: "win" | "loss" | "draw";
}

export interface PrimeCutPublicState {
  ruleset_version: string;
  board_version: string;
  artifact_version: string;
  model_version: string;
  phase: PrimeCutPhase;
  heat_index: number;
  heat_count: number;
  durations: number[];
  cards_per_heat: number;
  keeps_per_heat: number;
  cuts_per_heat: number;
  card_index: number | null;
  current_card: PrimeCutCard | null;
  dealt_cards: PrimeCutCard[];
  seats: PrimeCutSeatPublic[];
  heat_results: PrimeCutHeatResult[];
  standings: PrimeCutStanding[];
  ended_by: "completed" | "forfeit" | null;
  placements?: PrimeCutPlacement[];
}

export interface PrimeCutPrivateState {
  seat_index: number;
  keeps_used: number;
  cuts_used: number;
  keeps_left: number;
  cuts_left: number;
  decisions: PrimeCutDecisionRecord[];
  current_decision: PrimeCutDecisionRecord | null;
  forced_decision: PrimeCutDecision | null;
  forfeited: boolean;
}

export type PrimeCutMatchView = ArenaMatchView<PrimeCutPublicState, PrimeCutPrivateState>;
