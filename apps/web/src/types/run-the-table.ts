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

import type { DailyWindowPayload } from "@/lib/daily-time";

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
  /**
   * v3: this offer is the card a paid Reserve a Card put on the board, and
   * `cost` is therefore the price it was RESERVED at rather than today's.
   * Optional so a payload from an older API still type-checks.
   */
  reserved?: boolean;
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
  /** True for the last act's boss — the only one a win in which clears the
   *  table. Server-derived, so no client compares `act` to a literal. */
  is_final?: boolean;
  /**
   * The boss slate is fixed by the ruleset and the seed: no clock, no model
   * inference, no opponent assembled live. Published so the reveal can say so
   * outright rather than implying otherwise.
   */
  deterministic?: boolean;
  /** v4: whether this act's LINEUP has been generated yet. False before the
   *  act begins -- a boss is built against the roster that will face it, so
   *  until then there is no five to reveal and none to scout. Distinct from
   *  `revealed`, which asks whether an EXISTING lineup is being shown. */
  locked?: boolean;
  /** This boss's win condition. A boss rule may raise it above the default
   *  (`BOSS_LANES_TO_WIN`), for both sides. */
  lanes_to_win?: number;
}

// ---------------------------------------------------------------------------
// Battles
// ---------------------------------------------------------------------------

/** One lane's top contributor, on their OWN terms — never the lineup rating
 *  shown beside them. `own_lane_index_value` is the CARD's own `lane_index`
 *  in this lane (SCORE_RECONCILIATION.md §1/§2, SYNTHESIS_CONTRACT.md §1:
 *  "No individual player label may visually own a roster-wide number").
 *  `public.py::_own_lane_value` sends a narrow `{name, own_lane_index_value}`,
 *  not the full card; if a surface ever needs more of that card (window,
 *  season, cost) that is a new field to request, never a reason to revive
 *  the full-dict `player_top_card`/`opponent_top_card` aliases that task #18
 *  retired. Narrowness is the point: the full card carried a `prime_score`
 *  that sat one line from the lineup rating and invited exactly the
 *  individual-owns-a-roster-number misread this overhaul exists to fix. */
export interface LaneTopContributor {
  name: string;
  own_lane_index_value: number;
}

export interface BattleLanePublic {
  lane: LaneField;
  label: string;
  token: LaneToken;
  winner: LaneWinner;
  margin: number;
  tie_broken_by_rule: boolean;
  // -- contract field names (SYNTHESIS_CONTRACT.md §2.3) --------------------
  /** The bench-weighted lineup rating for this lane — a roster-wide MEAN,
   *  never an individual's value. Rendered as "YOUR LINEUP RATING". */
  player_lineup_rating: number;
  /** Same, for the boss's lineup. Rendered as "BOSS LINEUP RATING". */
  boss_lineup_rating: number;
  /** The lane rating BEFORE any Scout & Prepare bonus — the first addend of
   *  the expandable-receipt sum. */
  pre_perk_rating: number;
  /** The Scout & Prepare bonus actually applied to this lane (0 if none was
   *  prepared here) — the second addend. */
  perk_adjustment: number;
  /** The residual `battle.resolve_battle` computes so the three addends sum
   *  to `final_rating` with zero client recomputation and no rounding drift
   *  to explain — the third addend, never independently derived here. */
  bench_adjustment: number;
  /** By construction, `pre_perk_rating + bench_adjustment + perk_adjustment`
   *  — always numerically equal to `player_lineup_rating`, published under
   *  its own contract name because it is the SUM the expandable receipt
   *  displays, not merely a repeat of the rating above it. */
  final_rating: number;
  top_contributor: LaneTopContributor | null;
  opponent_top_contributor: LaneTopContributor | null;
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
  /** How many lanes an outright win took here — 3 normally, more under a boss
   *  rule that raises it for both sides. */
  lanes_to_win?: number;
  /** lane -> the published preparation the player brought into this battle. */
  lane_bonuses?: Partial<Record<LaneField, number>>;
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export interface NodeChoice {
  id: string;
  label: string;
  description: string;
  /** `rest_bank`'s "recover_life" at full lives, and the two priced Scout &
   *  Prepare branches when they are unavailable. */
  disabled?: boolean;
  /** v3: what a priced choice costs, in credits. `0` for a free branch. */
  cost?: number;
  /** v3: the engine's stable reason code when `disabled` is true. */
  unavailable_reason?: string | null;
}

// ---------------------------------------------------------------------------
// v3 — credit sinks (spec §4)
// ---------------------------------------------------------------------------

/**
 * `CREDIT_SINKS[id]` in `nba_peak/run_the_table/config.py`, as the node is
 * offering it right now.
 *
 * NO PRICE IS EVER RESTATED IN TYPESCRIPT. `cost`, `limit` and `summary` all
 * arrive on the payload with the exact values the engine charges, which is the
 * only arrangement in which the button's label cannot drift from the debit.
 *
 * `available` and `affordable` are deliberately separate so a locked control
 * can be SHOWN with its reason rather than hidden — that is how a player learns
 * the sink exists. `selectable` is the conjunction, so a button binds to one
 * boolean.
 */
export interface CreditSink {
  id: "market_refresh" | "reserve_card" | "role_focus" | "emergency_recovery";
  name: string;
  cost: number;
  summary: string;
  /** Human phrase from the config, e.g. "1 per node". */
  limit: string;
  /** Node types this sink is offered at. */
  offered_at: NodeType[];
  available: boolean;
  affordable: boolean;
  selectable: boolean;
  /** Stable code: "refresh_limit" | "insufficient_credits" | "lives_full" |
   *  "recovery_limit" | "role_focus_active" | "reservation_active". */
  unavailable_reason: string | null;
  used: number;
  /** null when the limit is not a count (one live reservation at a time). */
  limit_total: number | null;
  remaining: number | null;
}

// ---------------------------------------------------------------------------
// v3 — Scout & Prepare (spec §5)
// ---------------------------------------------------------------------------

export interface ScoutLaneProjection {
  lane: LaneField;
  label: string;
  opponent_score: number;
  player_score: number;
  margin: number;
  projected_winner: LaneWinner;
}

/** One capped lane preparation. `would_flip` is the whole reason this node is
 *  no longer dead content: it says, before the player commits, whether 2.5
 *  points actually changes a lane result in the fight they are about to take. */
export interface ScoutPreparation {
  lane: LaneField;
  label: string;
  bonus: number;
  margin_before: number;
  margin_after: number;
  would_flip: boolean;
}

/** `bosses.scout_report()`. Every number here is one the player could already
 *  reproduce from the lane profiles the UI shows — scouting buys the work. */
export interface ScoutReport {
  boss_id: string;
  name: string;
  tagline: string;
  act: number;
  rule_id: string | null;
  rule: BossRule | null;
  lane_margin_threshold: number;
  lanes_to_win: number;
  lanes: ScoutLaneProjection[];
  strongest_lanes: LaneField[];
  weakest_lane: LaneField;
  projected_lanes_won: number;
  projected_lanes_lost: number;
  projected_summed_margin: number;
  projection: "win" | "loss" | "win_on_margin" | "loss_on_margin" | "draw";
  preparations: ScoutPreparation[];
  starter_mean: number;
}

export interface ReserveCandidate {
  card_id: string;
  player_name: string;
  anchor_season: string;
  prime_score: number;
  /** The price the reservation locks in. Charged at that number in the next
   *  Draft Room even if a perk changes later. */
  locked_cost: number;
  modifiers: CostModifier[];
  legal_slots: string[];
}

/** One of `SCOUT_CHOICES`, as `state.scout_and_prepare_options` returns it. */
export interface ScoutChoice {
  id: "scout_boss" | "shape_market" | "reserve_card";
  name: string;
  cost: number;
  available: boolean;
  unavailable_reason: string | null;
  summary?: string;
  /** scout_boss only. */
  prep_bonus?: number;
  report?: ScoutReport | null;
  /** shape_market only. */
  roles?: Role[];
  /** reserve_card only. */
  candidates?: ReserveCandidate[];
}

export interface ScoutBlock {
  node_id: string;
  choice_ids: string[];
  prep_bonus: number;
  lanes: { lane: LaneField; label: string; token: LaneToken }[];
  roles: Role[];
  choices: ScoutChoice[];
}

// ---------------------------------------------------------------------------
// v3 — reveals (spec §3)
// ---------------------------------------------------------------------------

/** One slot of a reveal, as the SERVER preselected it. The client animates to
 *  this; it never rolls its own card. */
export interface RevealSlot {
  order: number;
  slot_id: string;
  /** Present on the opening-roster reveal; the boss reveal is slot ids only. */
  label?: string;
  role?: Role | null;
  is_starter?: boolean;
  card_id: string;
  player_name: string;
  anchor_season: string;
  window?: string;
  prime_score: number;
  base_cost?: number;
}

/** The published slot order, cards withheld. Safe before a single reveal. */
export interface RevealSlotOrder {
  order: number;
  slot_id: string;
  label?: string;
}

export interface RevealTrack {
  revealed: number;
  total: number;
  complete: boolean;
  order: RevealSlotOrder[];
  revealed_slots: RevealSlot[];
  /** The authoritative next card, or null once the reveal is complete. */
  next_slot: RevealSlot | null;
  /** Skip-all is offered only after the first card is on the table. */
  can_skip: boolean;
  remaining: number;
}

export interface BossRevealTrack extends RevealTrack {
  act: number;
  boss_id: string;
  name: string;
  tagline: string;
  rule: BossRule | null;
  source: string;
  /** Always true. The slate is a pure function of the ruleset and the seed. */
  deterministic: boolean;
}

export interface RunReveal {
  roster: RevealTrack;
  /** Null until the boss is revealed — before that there is no block at all,
   *  not an empty lineup. */
  boss: BossRevealTrack | null;
}

// ---------------------------------------------------------------------------
// v3 — what is armed right now
// ---------------------------------------------------------------------------

export interface PendingPrep {
  lane: LaneField;
  label: string;
  bonus: number;
  act: number;
}

export interface ActiveRoleFocus {
  role: Role;
  acquired_act: number;
  acquired_stage: number;
  consumed_node_id: string | null;
}

export interface ActiveReservation {
  card_id: string;
  locked_cost: number;
  locked_modifiers: CostModifier[];
  reserved_act: number;
  reserved_stage: number;
  offered_node_id: string | null;
  status: "live" | "offered" | "used" | "expired";
}

export interface SinkSpendRow {
  sink_id: string;
  cost: number;
  act: number;
  stage: number;
  [key: string]: unknown;
}

export interface ArmedEffects {
  prep: PendingPrep | null;
  prep_bonus: number;
  role_focus: ActiveRoleFocus | null;
  reserved_card: ActiveReservation | null;
  scouted_boss_acts: number[];
  emergency_recoveries_used: number;
  emergency_recoveries_max: number;
  sink_spend: SinkSpendRow[];
  sink_spend_total: number;
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
  // -- v3 -------------------------------------------------------------------
  /** The sinks THIS node offers, priced and gated. Empty on a node that offers
   *  none. Optional so a payload from an older API still type-checks. */
  credit_sinks?: CreditSink[];
  /** film_room only — the three Scout & Prepare branches in full. */
  scout?: ScoutBlock;
  /** draft_room | trade_desk — the role a paid Role Focus is guaranteeing on
   *  this board, or null. */
  role_focus?: Role | null;
  /** draft_room | trade_desk — how many times this market has been refreshed. */
  refreshes_used?: number;
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

/**
 * DEPRECATED — the pre-§2.3 receipt line.
 *
 * `signed_value` was a single overloaded column carrying four different things
 * (a lane count, a PEAK3 point delta, a bare `0`, and a credit holding) and it
 * doubled as the colour channel. `receipt.py:235` emitted
 * `"signed_value": -state.credits` — negating a HOLDING purely so a shared
 * `signedColorVar()` helper would paint it red — so the receipt printed
 * "Finished holding 68 unspent credits" beside `-68.0`, two blocks below a
 * Credits section that said `finished holding 68`.
 *
 * Kept because completed v1 receipts are still readable and must stay so.
 * New receipts carry `items` instead; see `ReceiptItem`.
 */
export interface ReceiptReason {
  kind: "lane_strength" | "lane_weakness" | "acquisition" | "economy";
  text: string;
  signed_value: number;
}

/** Plan §2.3. Colour comes from `kind` and from nothing else. */
export type ReceiptItemKind = "benefit" | "cost" | "neutral" | "record";

export type ReceiptItemUnit = "credits" | "score" | "lanes" | "percentage";

/**
 * One semantic line of the run receipt (plan §2.3).
 *
 * `value` is always the TRUE MAGNITUDE, unnegated: "Finished holding 68
 * unspent credits" is `{kind:"neutral", value:68, unit:"credits"}` — 68, not
 * −68, and not red. A sign in this payload means the quantity is genuinely
 * signed, never that a renderer wanted a colour.
 *
 * `display` overrides formatting when a unit needs it ("3 of 5 lanes").
 */
export interface ReceiptItem {
  kind: ReceiptItemKind;
  label: string;
  value?: number;
  unit?: ReceiptItemUnit;
  display?: string;
}

/**
 * Plan §2.2's outcome taxonomy — exactly three values.
 *
 * `"RUN COMPLETE"` is retired: it was printed for a 0-for-3 losing run, which
 * is victory framing on a defeat.
 */
export type RunOutcome = "table_cleared" | "ended_at_final_boss" | "ended_in_act";

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
  /**
   * Plan §2.2. Optional so a v1 receipt saved before the taxonomy existed
   * still type-checks and still renders — `runOutcome()` derives it.
   */
  outcome?: RunOutcome;
  headline: string;
  story: string;
  ran_the_table: boolean;
  /** Plan §2.2's clear condition, once the engine emits it. Falls back to
   *  `ran_the_table` on an older receipt. */
  table_cleared?: boolean;
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
  /**
   * §2.3's semantic lines. Optional: the engine keeps `reasons` as a
   * deprecated alias for one release, and old saved receipts have only that,
   * so the renderer falls back rather than blanking the section.
   */
  items?: ReceiptItem[];
  /** DEPRECATED — see `ReceiptReason`. Optional so a §2.3-only receipt is
   *  legal too. */
  reasons?: ReceiptReason[];
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
  /**
   * The act whose boss must be BEATEN to clear the table. Always `acts_total`
   * today; published separately so nothing compares `act` to a literal.
   */
  final_boss_act?: number;
  /** `ROSTER_SIZE` — 5 starters + 2 bench. Drives the reveal's slot count. */
  roster_size?: number;
  /**
   * v3 reveals. Optional so a client built against an older API still
   * type-checks and simply skips the reveal surfaces.
   */
  reveal?: RunReveal;
  /** v3: preparation / role focus / reservation currently armed. */
  armed?: ArmedEffects;
  /** v3: the published price list, for a run-level rules panel. */
  credit_sinks?: CreditSink[];
  action_count: number;
  /** v4 restart surface. `abandoned` and `concluded` are different questions:
   *  an abandoned run is over but was never PLAYED to a conclusion, so it has
   *  no receipt and earns nothing. `can_restart` is a rules fact the server
   *  owns -- a daily is a single attempt and offers no restart at all. */
  abandoned?: boolean;
  abandoned_at?: string | null;
  successor_run_id?: string | null;
  concluded?: boolean;
  can_restart?: boolean;
  restart_blocked_reason?: string | null;
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
  /** The whole run shape, published so the client never hardcodes it. */
  run_shape?: {
    acts: number;
    stages_per_act: number;
    node_choices_per_stage: number;
    decision_nodes: number;
    battles: number;
    final_boss_act: number;
    roster_size: number;
    outcomes: string[];
  };
  /** v3's four published prices. */
  credit_sinks?: CreditSink[];
  scout_and_prepare?: {
    choices: string[];
    prep_bonus: number;
    reserve_choices_offered: number;
  };
  economy: {
    starting_credits: number;
    starting_lives: number;
    max_lives: number;
    comeback_credits: number;
    trade_refund_pct: number;
    price_formula: string;
    rest_credits?: number;
    boss_win_credits?: number;
    market_refresh_cost?: number;
    emergency_recovery_cost?: number;
    emergency_recovery_max_per_run?: number;
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

/** `GET /run-the-table/daily` — `daily_descriptor()` in daily.py, plus the
 *  frozen daily-window block every daily response in the app now embeds
 *  (plan §2.1, `DailyWindow.to_payload()`). */
export interface DailyDescriptor {
  date: string;
  run_id: string;
  seed: number;
  ruleset_version: string;
  /** Optional so a client built against an older API still type-checks; the
   *  countdown simply does not arm. */
  daily?: DailyWindowPayload;
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
  | "advance"
  | "market_refresh"
  | "emergency_recovery"
  | "reveal";

/** `action_reveal`'s targets. */
export type RevealTarget = "roster" | "boss";

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
  /**
   * Scout & Prepare. Which extra field a branch needs is the ENGINE's rule:
   * `scout_boss` needs `lane`, `shape_market` needs `role`, `reserve_card`
   * needs `card_id`. Sending the wrong one is a 409 with a named reason rather
   * than a silent no-op, so this union stays one member and the server decides.
   */
  | {
      action_type: "film_room";
      choice: string;
      lane?: LaneField;
      role?: Role;
      card_id?: string;
    }
  | { action_type: "rest_bank"; choice: string }
  | { action_type: "resolve_boss" }
  | { action_type: "advance" }
  | { action_type: "market_refresh" }
  | { action_type: "emergency_recovery" }
  | { action_type: "reveal"; target: RevealTarget; count: number };

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
  /**
   * `RunPublicState.date` — the daily key the SERVER assigned this run, or
   * null for a standard/challenge run.
   *
   * Added because the pointer had no date at all, `getRun` happily returns 200
   * for yesterday's daily, and `shouldClearStoredRun` only clears on
   * 404/409/410 — so an unfinished daily from yesterday was silently resumed
   * today, and every day after that, and the start gate never appeared again.
   * `isStaleDailyPointer()` in `lib/run-the-table-state.ts` is the check.
   *
   * Optional in practice: a pointer written before this field existed parses
   * with `run_date: null`, which a daily pointer cannot prove is today, so it
   * is discarded — exactly the runs the bug had stranded.
   */
  run_date: string | null;
  updated_at: string;
}
