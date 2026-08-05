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

/**
 * `GET /arena/readiness`.
 *
 * `modes` IS AN ARRAY OF OBJECTS, not of strings. This file declared
 * `modes: string[]` while the server has published `[{id, seat_count}]` since
 * the seat count moved server-side, and TypeScript could not catch the
 * disagreement because nothing here is generated from the API. The consequence
 * was silent and total: `readiness.modes.includes("three_man_weave")` compared
 * a string against objects, returned false on every deployment, and the
 * Three-Man Weave page rendered "not available on this deployment yet" no
 * matter what the server said.
 *
 * Re-exported from `arena-lobby-api` rather than re-declared, so there is one
 * shape for one endpoint and the next change cannot make two of them again.
 */
export type { ArenaModeInfo, ArenaReadiness } from "@/lib/arena-lobby-api";

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
/** Repositioning your OWN roster. Does not consume a turn. */
export const TMW_COMMAND_REARRANGE = "tmw_rearrange";

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

/** WHAT this player is worth: their best PEAK3 season FOR THE ROLLED FRANCHISE
 * in the rolled decade. Deliberately a separate object from `TmwEligibility` —
 * they are different claims about different seasons of the same tenure.
 *
 * PRESENT ONLY ON A DRAFTED PICK. An undrafted candidate carries no scoring
 * card at all (see `TmwCandidatePublic`), because publishing it turned the
 * candidate list into a leaderboard with one correct row. */
export interface TmwScoringCard {
  season: string;
  team_id: string;
  team_name: string;
  prime_score: number;
  score_source: "exact_team_stint" | "exact_season_aggregate";
  is_multi_team_season: boolean;
  formula_version: string;
}

/** An UNDRAFTED candidate. Name, why they are legal, and where they play.
 *
 * The absence of `scoring_card` is the type doing product work: a component
 * cannot render a pre-pick score because there is no field to read. */
export interface TmwCandidatePublic {
  player_slug: string;
  player_name: string;
  eligibility: TmwEligibility;
  /** Canonical starter positions, from the model's own position data. */
  positions: string[];
}

/** A DRAFTED player: the candidate payload plus the card they are scored on. */
export interface TmwPlayer extends TmwCandidatePublic {
  scoring_card: TmwScoringCard | null;
}

export interface TmwPick extends TmwPlayer {
  seat_index: number;
  round_number: number;
  slot_type: TmwSlotType;
  franchise_id: string;
  decade: string;
}

/** How a candidate relates to one seat's roster right now. */
export const TMW_FITS_NOW = "fits_now";
export const TMW_FITS_AFTER_REARRANGEMENT = "fits_after_rearrangement";
export const TMW_NO_LEGAL_ARRANGEMENT = "no_legal_arrangement";

export type TmwFitState =
  | typeof TMW_FITS_NOW
  | typeof TMW_FITS_AFTER_REARRANGEMENT
  | typeof TMW_NO_LEGAL_ARRANGEMENT;

export interface TmwPlanMove {
  player_slug: string;
  from_slot: TmwSlotType;
  to_slot: TmwSlotType;
}

/** The server's verdict AND, where one is needed, its plan.
 *
 * `plan` is a COMPLETE final assignment rather than a diff, and it is echoed
 * back verbatim on the command — so the arrangement committed is the one the
 * server said was legal, not a client re-derivation of it. */
export interface TmwCandidateFit {
  player_slug: string;
  state: TmwFitState;
  direct_slots: TmwSlotType[];
  plan: Record<string, string> | null;
  moves: TmwPlanMove[];
  reason: string | null;
}

export interface TmwRoll {
  round_number: number;
  roll_id: string;
  franchise_id: string;
  franchise_display_name: string;
  decade: string;
  eligible_slugs: string[];
  /** THE WHOLE ELIGIBLE POOL for this roll, minus already-drafted identities,
   * in the roll's own sorted order. Never narrowed to this seat's open slots
   * and never ordered by a score. */
  candidates: TmwCandidatePublic[];
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

/** The pick whose removal costs the roster the most lineup quality.
 * Measured by leave-one-out against the same evaluator, never asserted. */
export interface TmwDecisivePick {
  slot_type: TmwSlotType;
  player_slug: string;
  player_name: string;
  season: string;
  team_id: string;
  round_number: number;
  lineup_quality_drop: number;
}

export interface TmwRosterEvaluation {
  tmw_adapter_version: string;
  lineup_model_version: string;
  simulator_version: string;
  formula_version: string;
  /** The comparator. `null` when the roster could not be scored — NEVER 0. */
  ranking_score: number | null;
  /** The same number, named for what it IS: the 82-0 model's lineup-quality
   * index over these six cards. */
  lineup_score: number | null;
  /** The mean of the six season scores. SECONDARY — it decides nothing, and a
   * surface must never present it as the result. */
  mean_season_score: number | null;
  score_status: TmwScoreStatus;
  unscored_slots: string[];
  fit_components: TmwFitComponents;
  best_pick: string | null;
  decisive_pick: TmwDecisivePick | null;
  experimental_notice: string;
  cards: unknown[];
}

/** The ordinal, temporary read on who is ahead mid-draft. NEVER a total. */
export const TMW_EDGE_BANDS = [
  "leading",
  "close_behind",
  "needs_a_response",
  "level",
] as const;
export type TmwEdgeBand = (typeof TMW_EDGE_BANDS)[number];

export interface TmwCurrentEdge {
  is_live: boolean;
  /** Every seat is compared on its first N picks, so a seat is never shown as
   * leading purely because the snake just gave it an extra turn. */
  compared_after_picks: number;
  seats: Record<string, TmwEdgeBand>;
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
  current_edge?: TmwCurrentEdge;
  results?: Record<string, TmwRosterEvaluation>;
  error?: string;
}

export interface TmwPrivateState {
  seat_index: number;
  open_slots?: TmwSlotType[];
  /** slot -> the player occupying it, or null. This seat's roster as the
   * server sees it, which is what a rearrangement has to be built from. */
  assignment?: Record<string, string | null>;
  /** player_slug -> the open slots THIS seat could put them in RIGHT NOW.
   * The strict subset of `candidate_fits`; kept because a surface that only
   * wants the simple case should not have to interpret a plan. */
  legal_picks?: Record<string, TmwSlotType[]>;
  /** player_slug -> fit verdict, for EVERY candidate on the roll. */
  candidate_fits?: Record<string, TmwCandidateFit>;
}

/** `arena_match_results.detail` as this mode writes it. */
export interface TmwResultDetail {
  score_status: TmwScoreStatus;
  /** The comparator. NO PROJECTED RECORD accompanies it: the 82-0 record
   * projection is calibrated for eight cards and this mode plays six, so the
   * mode reports the index it is derived from and not a win total. */
  lineup_score: number | null;
  mean_season_score: number | null;
  fit_components: TmwFitComponents;
  best_pick: string | null;
  decisive_pick: TmwDecisivePick | null;
  tmw_adapter_version: string;
  lineup_model_version: string;
  simulator_version: string;
  formula_version: string;
}

export type TmwMatchView = ArenaMatchView<TmwPublicState, TmwPrivateState>;
