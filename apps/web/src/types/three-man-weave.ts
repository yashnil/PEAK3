/**
 * Types for THREE-MAN WEAVE and the mode-agnostic Arena envelope it rides in.
 *
 * `ArenaMatchView` mirrors `apps/api/app/models/arena.py`. `public_state` and
 * `private_state` are declared `unknown` there on purpose (the foundation is
 * mode-agnostic); the mode-specific shapes below are this game's reading of
 * them, applied at the client boundary and nowhere else.
 *
 * NOTHING HERE IS COMPUTED. Every number in these types came from the server:
 * PEAK3 scores, placements, legality, the ranking score. The client's job is
 * to render them and to say plainly which one decided the match.
 */

// ---------------------------------------------------------------------------
// Arena envelope
// ---------------------------------------------------------------------------

export interface ArenaSeatPublic {
  seat_index: number;
  display_name: string;
  is_bot: boolean;
  status: string;
  bot_rating: number | null;
}

export interface ArenaMatchView<TPublic = TmwPublicState, TPrivate = TmwPrivateState> {
  match_id: string;
  mode: string;
  mode_version: string;
  model_version: string;
  status: string;
  /** Echo this back as `expected_state_version` on the next command. */
  state_version: number;
  seat_count: number;
  entry_path: string;
  rated: boolean;
  your_seat_index: number | null;
  seats: ArenaSeatPublic[];
  public_state: TPublic;
  private_state: TPrivate;
  legal_commands: string[];
  current_turn_seat_index: number | null;
  /** A DURATION, not a deadline — the server keeps the authoritative instant. */
  seconds_remaining: number | null;
  latest_event_seq: number;
  room_code: string | null;
}

export interface ArenaEventView {
  seq: number;
  event_type: string;
  actor_seat_index: number | null;
  payload: Record<string, unknown>;
  state_version_after: number;
  created_at: string;
}

export interface ArenaEventsResponse {
  match_id: string;
  events: ArenaEventView[];
  latest_seq: number;
}

export interface SubmitCommandResponse {
  accepted: boolean;
  /** True when the key was already recorded and NOTHING was applied. A replay
   * must never be counted as a fresh acceptance. */
  replayed: boolean;
  rejection_code: string | null;
  message: string | null;
  match: ArenaMatchView;
}

export interface ArenaReadiness {
  readiness_level: string;
  arena_enabled: boolean;
  public_queue_enabled: boolean;
  bots_enabled: boolean;
  modes: string[];
}

export interface ArenaResultView {
  seat_index: number;
  display_name: string;
  placement: number;
  score: number;
  outcome: "win" | "loss" | "draw";
  was_bot: boolean;
  detail: TmwResultDetail;
}

export interface ArenaResultsResponse {
  match_id: string;
  mode: string;
  rated: boolean;
  results: ArenaResultView[];
}

// ---------------------------------------------------------------------------
// Three-Man Weave
// ---------------------------------------------------------------------------

export const TMW_MODE = "three_man_weave";
export const TMW_COMMAND_PICK = "tmw_pick";

export const TMW_STARTER_SLOTS = ["PG", "SG", "SF", "PF", "C"] as const;
export const TMW_BENCH_SLOTS = ["bench_1"] as const;
export const TMW_SLOT_TYPES = [...TMW_STARTER_SLOTS, ...TMW_BENCH_SLOTS] as const;

export type TmwStarterSlot = (typeof TMW_STARTER_SLOTS)[number];
export type TmwSlotType = (typeof TMW_SLOT_TYPES)[number];

export const TMW_SLOT_LABELS: Record<TmwSlotType, string> = {
  PG: "Point guard",
  SG: "Shooting guard",
  SF: "Small forward",
  PF: "Power forward",
  C: "Center",
  bench_1: "Bench",
};

/** How an appearance was established. A traded stint is a real appearance and
 * is labelled as one rather than being quietly presented as a full season. */
export type TmwAppearanceVia = "direct_team_season" | "traded_team_stint";

export interface TmwEligibilitySeason {
  season: string;
  team_code: string;
  games_played: number | null;
  via: TmwAppearanceVia;
}

/** WHY this player is legal for this roll. Never carries a score. */
export interface TmwEligibility {
  franchise_id: string;
  franchise_display_name: string;
  decade: string;
  seasons: TmwEligibilitySeason[];
}

/** WHAT this player is worth: their best PEAK3 season anywhere in the drafted
 * decade. Deliberately a separate object from `TmwEligibility` — they are
 * different claims about different seasons. */
export interface TmwScoringCard {
  season: string;
  team_id: string;
  team_name: string;
  prime_score: number;
  score_source: "exact_team_stint" | "exact_season_aggregate";
  is_multi_team_season: boolean;
  formula_version: string;
}

export interface TmwPlayer {
  player_slug: string;
  player_name: string;
  eligibility: TmwEligibility;
  scoring_card: TmwScoringCard | null;
}

export interface TmwPick extends TmwPlayer {
  seat_index: number;
  round_number: number;
  slot_type: TmwSlotType;
  franchise_id: string;
  decade: string;
}

export interface TmwRoll {
  round_number: number;
  roll_id: string;
  franchise_id: string;
  franchise_display_name: string;
  decade: string;
  eligible_slugs: string[];
  candidates: TmwPlayer[];
}

export interface TmwRoster {
  seat_index: number;
  slots: Record<string, TmwPick | null>;
  complete: boolean;
}

export type TmwScoreStatus = "complete" | "incomplete";

export interface TmwFitComponents {
  talent_core: number;
  bench_strength: number;
  positional_fit: number;
  creation_coverage: number;
  scoring_coverage: number;
  postseason_pedigree: number;
  team_context_depth: number;
}

export interface TmwRosterEvaluation {
  tmw_adapter_version: string;
  lineup_model_version: string;
  simulator_version: string;
  formula_version: string;
  /** The comparator. `null` when the roster could not be scored — NEVER 0. */
  ranking_score: number | null;
  lineup_peak_score: number | null;
  score_status: TmwScoreStatus;
  unscored_slots: string[];
  fit_components: TmwFitComponents;
  wins: number;
  losses: number;
  expected_wins: number;
  expected_wins_low: number;
  expected_wins_high: number;
  is_perfect_season: boolean;
  decisive_factors: string[];
  best_pick: string | null;
  structural_weakness: string | null;
  structural_weakness_detail: string | null;
  weakness_framing: string | null;
  experimental_notice: string;
  cards: unknown[];
}

export interface TmwPublicState {
  mode_version: string;
  formula_version: string;
  slot_types: TmwSlotType[];
  total_rounds: number;
  current_round: number | null;
  current_seat: number | null;
  is_complete: boolean;
  rosters: TmwRoster[];
  drafted_identities: string[];
  used_roll_ids: string[];
  /** The CURRENT roll only. A future roll is not filtered out here — it does
   * not exist yet, because feasibility depends on live draft state. */
  current_roll: TmwRoll | null;
  results?: Record<string, TmwRosterEvaluation>;
  error?: string;
}

export interface TmwPrivateState {
  seat_index: number;
  open_slots?: TmwSlotType[];
  /** player_slug -> the open slots THIS seat could put them in. */
  legal_picks?: Record<string, TmwSlotType[]>;
}

/** `arena_match_results.detail` as this mode writes it. */
export interface TmwResultDetail {
  score_status: TmwScoreStatus;
  lineup_peak_score: number | null;
  wins: number;
  losses: number;
  expected_wins: number;
  fit_components: TmwFitComponents;
  best_pick: string | null;
  structural_weakness: string | null;
  tmw_adapter_version: string;
  lineup_model_version: string;
  simulator_version: string;
  formula_version: string;
}

export type TmwMatchView = ArenaMatchView<TmwPublicState, TmwPrivateState>;
