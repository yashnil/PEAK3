/**
 * RUN THE TABLE wire types.
 *
 * Derived FIELD-FOR-FIELD from `apps/api/app/services/run_the_table/public.py`
 * (`public_state`, `ruleset_meta`, `card_public`, `boss_public`,
 * `_battle_public`) and `nba_peak/run_the_table/receipt.py::build_receipt`.
 * That module is the single source of truth for what the browser may see; if
 * a field is not in there it does not belong in here.
 *
 * Nothing in this file (or anywhere in the RUN THE TABLE client) derives a
 * PEAK3 score, a price, a discount or a lane value. Every number the UI prints
 * arrived on one of these payloads with the exact value the engine used.
 */

// ---------------------------------------------------------------------------
// Lanes — the five canonical PEAK3 component lanes
// ---------------------------------------------------------------------------

/** `LANE_FIELDS` in nba_peak/run_the_table/config.py. */
export type LaneField =
  | "statistical_impact"
  | "traditional_production"
  | "individual_recognition"
  | "postseason_individual_value"
  | "team_achievement";

/** `LANE_TOKENS` — maps 1:1 onto the `--comp-*` design tokens. */
export type LaneToken = "si" | "tp" | "rec" | "po" | "team";

export const LANE_FIELDS: readonly LaneField[] = [
  "statistical_impact",
  "traditional_production",
  "individual_recognition",
  "postseason_individual_value",
  "team_achievement",
] as const;

/** `ROLES` in config.py. Ordered exactly as the engine orders them. */
export type Role =
  | "lead_creator"
  | "guard_wing"
  | "wing_forward"
  | "forward_big"
  | "anchor";

// ---------------------------------------------------------------------------
// Status / enum-ish string unions
// ---------------------------------------------------------------------------

export type RunStatus =
  | "system_select"
  | "node_select"
  | "node_active"
  | "boss_ready"
  | "boss_resolved"
  | "complete"
  | "failed";

export type RunType = "standard" | "daily" | "challenge";

export type NodeType = "draft_room" | "trade_desk" | "film_room" | "rest_bank";

export type StageState = "done" | "current" | "locked";

export type BossState = "won" | "lost" | "drawn" | "current" | "locked";

export type LaneWinner = "player" | "opponent" | "tie";

export type BattleOutcome = "win" | "loss" | "draw";

export type DecidedBy = "lanes" | "summed_margin" | "roster_total" | "exact_draw";

export const TERMINAL_STATUSES: readonly RunStatus[] = ["complete", "failed"] as const;

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/**
 * One entry of `price_for()`'s `applied` list
 * (`nba_peak/run_the_table/pricing.py:74-86`).
 *
 * This type existed only as a lie until now: `cost_modifiers` was declared
 * `string[]`, so `RunCard.tsx` did `cost_modifiers.join(" · ")` on an array of
 * OBJECTS and printed `[object Object]` on every discounted card. `tsc` never
 * flagged it because the declared type said the elements were strings, and the
 * server side is a bare `Optional[dict]` (`apps/api/app/models/run_the_table.py:162`)
 * so nothing coerced it either.
 *
 * `before`/`after` are whole credits, already rounded by the engine.
 * `discount_pct` is an integer percentage (e.g. `35`, not `0.35`).
 */
export interface CostModifier {
  /** `SYSTEMS[].id` — "moneyball" | "no_hardware" | "two_way_value". */
  system_id: string;
  discount_pct: number;
  before: number;
  after: number;
}

/** `card_public()`. `cost_modifiers` is the engine's own explanation of how
 *  `cost` was reached from `base_cost` — the UI renders it, never recomputes it. */
export interface RunCardPublic {
  card_id: string;
  player_name: string;
  player_slug: string;
  start_season: string;
  end_season: string;
  anchor_season: string;
  window_label: string;
  prime_score: number;
  /** Already multiplied by 100 and rounded to 1dp server-side. */
  overall_percentile: number;
  eligible_roles: Role[];
  primary_role: Role;
  lane_index: Record<LaneField, number>;
  lane_percentiles: Record<LaneField, number>;
  base_cost: number;
  cost: number;
  cost_modifiers: CostModifier[];
  refund_value: number;
}

/** A draft-room offer: `card_public()` plus the affordability/legality fields
 *  `_active_node_public` adds for `node_type === "draft_room"`. */
export interface DraftOffer extends RunCardPublic {
  veteran_minimum_eligible: boolean;
  effective_cost: number;
  legal_slots: string[];
  affordable: boolean;
  selectable: boolean;
  blocked_reason: string | null;
}

/** An incoming trade card: `card_public()` plus legal slots. */
export interface TradeIncoming extends RunCardPublic {
  legal_slots: string[];
}

export interface TradeOutgoingOption {
  slot_id: string;
  role: Role | null;
  is_starter: boolean;
  card: RunCardPublic;
  refund: number;
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export interface RosterSlotPublic {
  slot_id: string;
  role: Role | null;
  is_starter: boolean;
  card: RunCardPublic | null;
}

// ---------------------------------------------------------------------------
// Systems and boss rules
// ---------------------------------------------------------------------------

export interface SystemPublic {
  id: string;
  name: string;
  summary: string;
  /** "price" | "battle" | "economy" — kept as a string; the UI only labels it. */
  affects: string;
}

export interface BossRule {
  id: string;
  name: string;
  summary: string;
}

// ---------------------------------------------------------------------------
// Lane profiles
// ---------------------------------------------------------------------------

/** `public_state().lane_profile` entry. */
export interface LaneProfileEntry {
  lane: LaneField;
  label: string;
  token: LaneToken;
  value: number;
  /** Present on the player's own profile and on `ruleset_meta().lanes`;
   *  absent on a boss's `lane_profile`. */
  peak3_weight?: number;
}

// ---------------------------------------------------------------------------
// Bosses
// ---------------------------------------------------------------------------

/** `boss_public()`. Everything below `revealed` only arrives once the player
 *  has reached the boss or scouted it — never speculate past it. */
export interface BossPublic {
  boss_id: string;
  name: string;
  tagline: string;
  act: number;
  rule: BossRule | null;
  source: string;
  revealed: boolean;
  starters?: RunCardPublic[];
  bench?: RunCardPublic[];
  lane_profile?: LaneProfileEntry[];
  roster_total?: number;
}

// ---------------------------------------------------------------------------
// Battles
// ---------------------------------------------------------------------------

export interface BattleLanePublic {
  lane: LaneField;
  label: string;
  token: LaneToken;
  player_score: number;
  opponent_score: number;
  winner: LaneWinner;
  margin: number;
  tie_broken_by_rule: boolean;
  player_top_card: RunCardPublic | null;
  opponent_top_card: RunCardPublic | null;
}

export interface BattlePublic {
  boss_id: string;
  act: number;
  outcome: BattleOutcome;
  decided_by: DecidedBy;
  player_lanes_won: number;
  opponent_lanes_won: number;
  ties: number;
  summed_margin: number;
  player_roster_total: number;
  opponent_roster_total: number;
  bench_weight: number;
  rule_id: string | null;
  credits_awarded: number;
  lives_after: number;
  lanes: BattleLanePublic[];
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export interface NodeChoice {
  id: string;
  label: string;
  description: string;
  /** Only `rest_bank`'s "recover_life" choice carries this. */
  disabled?: boolean;
}

export interface StageOption {
  node_id: string;
  node_type: NodeType;
  title: string;
  summary: string;
}

/** `_active_node_public()`. The optional blocks are mutually exclusive by
 *  `node_type`; helpers in `lib/run-the-table-state.ts` narrow them. */
export interface ActiveNode {
  node_id: string;
  node_type: NodeType;
  title: string;
  summary: string;
  // draft_room
  offers?: DraftOffer[];
  can_pass?: boolean;
  // trade_desk
  incoming?: TradeIncoming[];
  outgoing_options?: TradeOutgoingOption[];
  can_decline?: boolean;
  // film_room | rest_bank
  choices?: NodeChoice[];
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

export interface MapStage {
  act: number;
  stage: number;
  state: StageState;
  chosen_node_id: string | null;
  chosen_node_type: NodeType | null;
  option_types: NodeType[];
  scouted: boolean;
}

export interface MapAct {
  act: number;
  stages: MapStage[];
  boss: {
    boss_id: string;
    name: string;
    state: BossState;
  };
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

/** `version_tuple()` in config.py — all four strings, always present. */
export interface RunVersions {
  engine_version: string;
  ruleset_version: string;
  card_pool_version: string;
  peak3_model_version: string;
}

// ---------------------------------------------------------------------------
// Receipt
// ---------------------------------------------------------------------------

export interface ReceiptCardSummary {
  card_id: string;
  player_name: string;
  player_slug: string;
  anchor_season: string;
  window: string;
  prime_score: number;
  base_cost: number;
}

export interface ReceiptRosterEntry extends ReceiptCardSummary {
  slot_id: string;
  role: Role | null;
}

export interface ReceiptContribution extends ReceiptCardSummary {
  marginal_contribution: number;
  is_starter: boolean;
}

export interface ReceiptAcquisition extends ReceiptCardSummary {
  cost: number;
  score_delta: number;
  value_per_credit: number;
  replaced: ReceiptCardSummary | null;
  act: number;
}

export interface ReceiptTrade {
  incoming: ReceiptCardSummary;
  outgoing: ReceiptCardSummary;
  net_cost: number;
  score_delta: number;
  act: number;
}

export interface ReceiptClosestBattle {
  boss_id: string;
  act: number;
  outcome: BattleOutcome;
  /** Already formatted "3-2" by the engine. */
  lanes: string;
  tightest_lane_margin: number;
  summed_margin: number;
}

export interface ReceiptReason {
  kind: "lane_strength" | "lane_weakness" | "acquisition" | "economy";
  text: string;
  signed_value: number;
}

export interface ReceiptLaneProfileEntry {
  lane: LaneField;
  label: string;
  value: number;
  lanes_won: number;
}

export interface ReceiptBattleSummary {
  act: number;
  boss_id: string;
  outcome: BattleOutcome;
  decided_by: DecidedBy;
  player_lanes_won: number;
  opponent_lanes_won: number;
  rule_id: string | null;
}

/** `build_receipt()`. Present only while `status` is terminal. */
export interface RunReceipt {
  verdict: string;
  headline: string;
  story: string;
  ran_the_table: boolean;
  bosses_defeated: number;
  battles_lost: number;
  record: string;
  lives_remaining: number;
  systems: { id: string; name: string; summary: string }[];
  starters: ReceiptRosterEntry[];
  bench: ReceiptRosterEntry[];
  lane_profile: ReceiptLaneProfileEntry[];
  roster_total: number;
  strongest_lane: { lane: LaneField; label: string; value: number };
  weakest_lane: { lane: LaneField; label: string; value: number };
  run_mvp: ReceiptContribution | null;
  marginal_contributions: ReceiptContribution[];
  best_acquisition: ReceiptAcquisition | null;
  best_trade: ReceiptTrade | null;
  closest_battle: ReceiptClosestBattle | null;
  credits_spent: number;
  credits_refunded: number;
  credits_remaining: number;
  starting_credits: number;
  reasons: ReceiptReason[];
  battles: ReceiptBattleSummary[];
  seed: number;
  run_type: RunType;
  date: string | null;
  versions: RunVersions;
}

// ---------------------------------------------------------------------------
// The run payload
// ---------------------------------------------------------------------------

/** `public_state()` — the whole client payload, replaced wholesale after
 *  every action (server-authoritative; see CourtBuilder.tsx for the pattern). */
export interface RunPublicState {
  run_id: string;
  seed: number;
  run_type: RunType;
  date: string | null;
  status: RunStatus;
  act: number;
  stage: number;
  acts_total: number;
  stages_per_act: number;
  /**
   * `LANES_TO_WIN` — how many of the five lanes decide a battle.
   *
   * Added to `public_state()` by this pass so the boss preview and the battle
   * screen can state the win condition BEFORE the reveal without hardcoding a
   * rule the engine owns. Optional here so a client built against an older API
   * still type-checks and simply omits the sentence.
   */
  lanes_to_win?: number;
  credits: number;
  lives: number;
  max_lives: number;
  starting_credits: number;
  starters: RosterSlotPublic[];
  bench: RosterSlotPublic[];
  systems: SystemPublic[];
  pending_system_offer: SystemPublic[] | null;
  stage_options: StageOption[] | null;
  active_node: ActiveNode | null;
  next_boss: BossPublic | null;
  map: MapAct[];
  battles: BattlePublic[];
  lane_profile: LaneProfileEntry[];
  roster_total: number;
  bench_weight: number;
  veteran_minimum_used_this_act: boolean;
  action_count: number;
  receipt: RunReceipt | null;
  versions: RunVersions;
  created_at: string;
  last_action_at: string;
}

// ---------------------------------------------------------------------------
// ruleset_meta()
// ---------------------------------------------------------------------------

export interface RulesetLane {
  lane: LaneField;
  label: string;
  token: LaneToken;
  peak3_weight: number;
  pool_min: number;
  pool_max: number;
}

export interface RulesetMeta {
  versions: RunVersions;
  lanes: RulesetLane[];
  systems: SystemPublic[];
  boss_rules: BossRule[];
  roster: { starters: number; bench: number; roles: Role[] };
  economy: {
    starting_credits: number;
    starting_lives: number;
    max_lives: number;
    comeback_credits: number;
    trade_refund_pct: number;
    price_formula: string;
  };
  battle: {
    starter_weight: number;
    bench_weight: number;
    lanes_to_win: number;
    tie_break_order: string[];
  };
  card_pool: {
    duration_years: number;
    card_count: number;
    excluded_count: number;
    prime_score_min: number;
    prime_score_max: number;
  };
}

// ---------------------------------------------------------------------------
// readiness / daily / challenge
// ---------------------------------------------------------------------------

/**
 * `GET /run-the-table/readiness`. Everything past `enabled` is optional so a
 * leaner or richer readiness payload can never blank the page — the start gate
 * treats an absent field as "unknown", not as "broken".
 */
export interface RunReadiness {
  enabled: boolean;
  daily_enabled?: boolean;
  readiness_level?: "disabled" | "internal_dev" | "internal_alpha" | "public_beta";
  versions?: RunVersions;
  /** `available: false` is a real, expected state on a fresh clone — the card
   *  pool is built from generated artifacts (`make build-game-data`). Readiness
   *  reports it rather than erroring so the UI can tell "turned off" from
   *  "data not built" from "broken". */
  card_pool?: {
    available: boolean;
    duration_years?: number | null;
    card_count?: number | null;
    excluded_count?: number | null;
    prime_score_min?: number | null;
    prime_score_max?: number | null;
    error?: string | null;
  };
  note?: string | null;
}

/** `GET /run-the-table/daily` — `daily_descriptor()` in daily.py. */
export interface DailyDescriptor {
  date: string;
  run_id: string;
  seed: number;
  ruleset_version: string;
}

/** `POST /run-the-table/runs/{run_id}/challenge`.
 *
 *  Field names mirror the existing Peak Draft challenge endpoint
 *  (`POST /api/v1/draft/challenges`), which returns the same pair. */
export interface ChallengeResponse {
  challenge_token: string;
  /** Server-rendered path, always `/arena/run-the-table?c={token}` — NOT
   *  `/c/{token}`, which is Peak Draft's challenge route and cannot resolve a
   *  RUN THE TABLE token. The client still falls back to
   *  building it from the token so a missing field cannot yield "undefined" in
   *  a copied link. */
  public_url_path?: string | null;
  seed?: number;
  expires_at?: string | null;
}

// ---------------------------------------------------------------------------
// Action wire shapes
// ---------------------------------------------------------------------------

export type RunActionType =
  | "select_system"
  | "choose_node"
  | "draft_buy"
  | "draft_pass"
  | "trade"
  | "decline_trade"
  | "film_room"
  | "rest_bank"
  | "resolve_boss"
  | "advance";

export type RunActionBody =
  | { action_type: "select_system"; system_id: string }
  | { action_type: "choose_node"; node_id: string }
  | {
      action_type: "draft_buy";
      card_id: string;
      slot_id: string;
      use_veteran_minimum: boolean;
    }
  | { action_type: "draft_pass" }
  | { action_type: "trade"; outgoing_slot_id: string; incoming_card_id: string }
  | { action_type: "decline_trade" }
  | { action_type: "film_room"; choice: string }
  | { action_type: "rest_bank"; choice: string }
  | { action_type: "resolve_boss" }
  | { action_type: "advance" };

// ---------------------------------------------------------------------------
// localStorage
// ---------------------------------------------------------------------------

export const RUN_THE_TABLE_STORAGE_KEY = "peak3.run-the-table.active";
export const RUN_THE_TABLE_SCHEMA_VERSION = 1;

export interface StoredActiveRun {
  schema_version: number;
  run_id: string;
  seed: number;
  run_type: RunType;
  updated_at: string;
}
