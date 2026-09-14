/**
 * FIND THE PRIME — this game's reading of the Arena envelope.
 *
 * Mirrors `nba_peak/find_the_prime/state.py::project`. NOTHING HERE IS
 * COMPUTED: round points, regret, the best window and placements are the
 * server's.
 *
 * WHAT IS DELIBERATELY ABSENT from `FindThePrimePrompt` (the pre-lock view): any
 * window score, the best window, a rank, the normalising scale. The rail is
 * drawn from `seasons` and `legal_starts` alone. Scores first appear in
 * `FindThePrimeRoundReveal`, inside `round_results`, after the round resolves.
 */
import type { ArenaMatchView } from "@/types/three-man-weave";

export const FIND_THE_PRIME_MODE = "find_the_prime";

/** Mirrors `nba_peak/find_the_prime/config.py`. Display only. */
export const FIND_THE_PRIME_DECIDE_SECONDS = 20;
export const FIND_THE_PRIME_ROUNDS = 9;
export const FIND_THE_PRIME_MAX_TOTAL = 900;

/** `arrival`: the intro is on screen but its clock waits for every human seat. */
export type FindThePrimePhase = "arrival" | "intro" | "decide" | "reveal" | "complete";

/** Sent once the intro is on screen; accepted only in `arrival`. */
export const FIND_THE_PRIME_COMMAND_INTRO_SEEN = "ftp_intro_seen";
export const FIND_THE_PRIME_COMMAND_STAGE = "ftp_stage";
export const FIND_THE_PRIME_COMMAND_LOCK = "ftp_lock";
export const FIND_THE_PRIME_COMMAND_FORFEIT = "ftp_forfeit";

export interface FindThePrimeSeason {
  season: string;
  season_end: number;
  team: string;
}

export interface FindThePrimePrompt {
  round_index: number;
  duration: number;
  player_slug: string;
  player_name: string;
  seasons: FindThePrimeSeason[];
  /** `season_end` of every season that STARTS a legal window of `duration`. */
  legal_starts: number[];
  career_first_season: string;
  career_last_season: string;
}

export interface FindThePrimeWindow {
  window_id: string;
  start_season: string;
  end_season: string;
  start_season_end: number;
  end_season_end: number;
  prime_score: number;
}

export type FindThePrimeLockedBy = "lock" | "staged_at_timeout" | "no_selection" | "forfeit";

export interface FindThePrimeSeatAnswer {
  seat_index: number;
  round_index: number;
  window_id: string | null;
  start_season_end: number | null;
  prime_score: number | null;
  points: number;
  regret: number;
  found_prime: boolean;
  locked_by: FindThePrimeLockedBy;
}

export interface FindThePrimeRoundReveal extends FindThePrimePrompt {
  windows: FindThePrimeWindow[];
  best_window_id: string;
  equivalent_window_ids: string[];
  best_score: number;
  scale: number;
  seats: FindThePrimeSeatAnswer[];
}

export interface FindThePrimeStanding {
  seat_index: number;
  total: number;
  found_primes: number;
  total_regret: number;
  rounds_scored: number;
  rounds_answered: number;
  average_regret: number | null;
  position: number;
  forfeited: boolean;
}

export interface FindThePrimeSeatPublic {
  seat_index: number;
  display_name: string;
  is_bot: boolean;
  bot_tier: string | null;
  locked: boolean;
  /** This seat has had the intro on screen. Always true for a bot. */
  arrived: boolean;
  forfeited: boolean;
}

export interface FindThePrimePlacement {
  seat_index: number;
  placement: number;
  outcome: "win" | "loss" | "draw";
}

export interface FindThePrimePublicState {
  ruleset_version: string;
  board_version: string;
  artifact_version: string;
  model_version: string;
  phase: FindThePrimePhase;
  round_index: number;
  round_count: number;
  max_match_score: number;
  durations_by_round_played: number[];
  prompt: FindThePrimePrompt | null;
  seats: FindThePrimeSeatPublic[];
  round_results: FindThePrimeRoundReveal[];
  standings: FindThePrimeStanding[];
  ended_by: "completed" | "forfeit" | null;
  placements?: FindThePrimePlacement[];
}

export interface FindThePrimePrivateState {
  seat_index: number;
  staged_start: number | null;
  locked_start: number | null;
  forfeited: boolean;
}

export type FindThePrimeMatchView = ArenaMatchView<FindThePrimePublicState, FindThePrimePrivateState>;
