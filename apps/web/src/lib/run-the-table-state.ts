/**
 * RUN THE TABLE client state: localStorage persistence, screen derivation, and
 * the pure formatting/derivation helpers the components need.
 *
 * Everything here is pure or a trivially guarded localStorage wrapper, so it
 * unit-tests without a DOM and without a running API. The three storage
 * functions each guard `typeof window === "undefined"` because this module is
 * imported from components that render during SSR.
 *
 * NOTHING in this file computes a PEAK3 score, a card price, a discount, a
 * lane value or a battle result. The only arithmetic is counting lanes the
 * server already awarded and formatting numbers the server already sent.
 */
import { analytics, type AnalyticsEvent } from "@/lib/analytics";
import { ordinal, ordinalFixed } from "@/lib/ordinal";
import {
  ActiveNode,
  BattleLanePublic,
  BattlePublic,
  CostModifier,
  DraftOffer,
  LaneField,
  LaneProfileEntry,
  LaneToken,
  LANE_FIELDS,
  MapAct,
  NodeType,
  ReceiptItem,
  ReceiptItemKind,
  ReceiptLaneProfileEntry,
  ReceiptReason,
  RevealTrack,
  Role,
  RunOutcome,
  RosterSlotPublic,
  RunPublicState,
  RunReceipt,
  RunStatus,
  RunType,
  RUN_THE_TABLE_SCHEMA_VERSION,
  RUN_THE_TABLE_STORAGE_KEY,
  StoredActiveRun,
  TradeIncoming,
  TradeOutgoingOption,
} from "@/types/run-the-table";

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const RUN_TYPES: readonly RunType[] = ["standard", "daily", "challenge"];

/**
 * Reads the stored active run. Returns null — never throws — for a missing
 * key, blocked storage, unparseable JSON, a schema-version mismatch, or a
 * payload missing any required field. Callers treat null as "show the start
 * gate", which is also the correct behaviour after a ruleset bump.
 *
 * Hardened the same way as `lib/progress.ts` and `lib/daily-grid-state.ts`:
 * a corrupt localStorage entry can never be the reason a player cannot play.
 */
export function loadActiveRun(): StoredActiveRun | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(RUN_THE_TABLE_STORAGE_KEY);
  } catch {
    return null; // storage blocked (private mode, disabled cookies)
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredActiveRun>;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.schema_version !== RUN_THE_TABLE_SCHEMA_VERSION) return null;
    if (typeof parsed.run_id !== "string" || parsed.run_id.length === 0) return null;
    if (typeof parsed.seed !== "number" || !Number.isFinite(parsed.seed)) return null;
    if (!RUN_TYPES.includes(parsed.run_type as RunType)) return null;
    return {
      schema_version: RUN_THE_TABLE_SCHEMA_VERSION,
      run_id: parsed.run_id,
      seed: parsed.seed,
      run_type: parsed.run_type as RunType,
      // A pointer written before `run_date` existed reads as null, which
      // `isStaleDailyPointer` treats as "cannot prove it is today".
      run_date: typeof parsed.run_date === "string" && parsed.run_date ? parsed.run_date : null,
      updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : "",
    };
  } catch {
    return null;
  }
}

export function saveActiveRun(
  state: Pick<RunPublicState, "run_id" | "seed" | "run_type" | "date">,
  now: Date = new Date(),
): void {
  if (typeof window === "undefined") return;
  const payload: StoredActiveRun = {
    schema_version: RUN_THE_TABLE_SCHEMA_VERSION,
    run_id: state.run_id,
    seed: state.seed,
    run_type: state.run_type,
    // The SERVER's daily key for this run, never a browser-computed date.
    run_date: state.date ?? null,
    updated_at: now.toISOString(),
  };
  try {
    window.localStorage.setItem(RUN_THE_TABLE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota exceeded or storage blocked — the run still plays, it just will
    // not survive a refresh. Never break the game over this.
  }
}

export function clearActiveRun(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(RUN_THE_TABLE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Should a failed resume clear the stored pointer?
 *
 * 404 (the run is gone) and 409 (the saved run's version tuple no longer
 * matches the live ruleset) both mean the pointer is unusable forever — drop
 * it and show the start gate. A 500 or a network failure is transient: keep
 * the pointer so a retry can still find the run.
 */
export function shouldClearStoredRun(status: number): boolean {
  return status === 404 || status === 409 || status === 410;
}

/**
 * Is this stored pointer a DAILY run from a day that is over?
 *
 * The stale-daily bug in full: `StoredActiveRun` carried no date, `GET
 * /runs/{id}` returns 200 for yesterday's daily (it is a perfectly valid run),
 * and `shouldClearStoredRun` only fires on 404/409/410 — so the resume path
 * had nothing to notice with. An unfinished daily was therefore resumed today,
 * and tomorrow, forever, and the start gate never appeared again.
 *
 * `todayDailyKey` is the SERVER's, from the daily descriptor
 * (`GET /run-the-table/daily`), never a browser-computed date: the reset is a
 * timezone boundary the server owns (plan §2.1), and a client that computes it
 * itself is the class of bug §4 exists to remove. When the descriptor could not
 * be fetched, `todayDailyKey` is null and this returns FALSE — a network
 * failure must never throw away a run the player is mid-way through.
 *
 * Standard and challenge runs are never stale: they belong to no day.
 */
export function isStaleDailyPointer(
  stored: StoredActiveRun | null,
  todayDailyKey: string | null | undefined,
): boolean {
  if (!stored) return false;
  if (stored.run_type !== "daily") return false;
  if (!todayDailyKey) return false;
  return stored.run_date !== todayDailyKey;
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

/** `_MAX_ID_LENGTH` in apps/api/app/models/run_the_table.py. A longer key is
 *  rejected by the request model, so it is capped here rather than discovered
 *  as a 422 on the one action a player most wants to be safe. */
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

/**
 * One key per user gesture. Buying a card is not idempotent by nature, so the
 * key is what stops a double click from spending twice; it must therefore be
 * generated when the gesture happens and reused across retries of that same
 * gesture, never regenerated per request.
 *
 * The nonce leads so that truncating a long `label` (a card id plus a slot id
 * can be long) can never cost the key its uniqueness.
 */
export function makeIdempotencyKey(runId: string, label: string, nonce?: string): string {
  const unique =
    nonce ??
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  return `${unique}:${runId}:${label}`.slice(0, MAX_IDEMPOTENCY_KEY_LENGTH);
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

export type RunScreen =
  | "system_select"
  | "node_select"
  | "node_active"
  | "boss_preview"
  | "battle"
  | "result";

/** The decision surface a status maps to. One status, one screen — this is
 *  the single place the mapping lives, so a reload lands on the same screen. */
export function screenForStatus(status: RunStatus): RunScreen {
  switch (status) {
    case "system_select":
      return "system_select";
    case "node_select":
      return "node_select";
    case "node_active":
      return "node_active";
    case "boss_ready":
      return "boss_preview";
    case "boss_resolved":
      return "battle";
    case "complete":
    case "failed":
      return "result";
  }
}

export function isTerminal(status: RunStatus): boolean {
  return status === "complete" || status === "failed";
}

// ---------------------------------------------------------------------------
// Reveals (v3, spec §3)
// ---------------------------------------------------------------------------

/**
 * Should the opening-roster reveal be on screen instead of the first decision?
 *
 * Gated on the SERVER's `reveal.roster.complete`, never on a browser flag, so a
 * refresh mid-reveal resumes exactly where it stopped rather than replaying it
 * — which is the whole reason the progress lives in run state.
 *
 * Only before act 1: a run resumed at act 3 has long since met its roster, and
 * an unfinished reveal there is a curiosity, not a screen. A payload from an
 * older API carries no `reveal` block at all and simply never shows it.
 */
export function needsOpeningReveal(
  state: Pick<RunPublicState, "status" | "act" | "reveal">,
): boolean {
  const roster = state.reveal?.roster;
  if (!roster) return false;
  return state.act === 1 && state.status === "system_select" && !roster.complete;
}

/**
 * Should the boss reveal be on screen instead of the boss briefing?
 *
 * Only at `boss_ready` — the payload carries no boss reveal block before the
 * boss is revealed, so this can never fire early.
 */
export function needsBossReveal(
  state: Pick<RunPublicState, "status" | "reveal">,
): boolean {
  const boss = state.reveal?.boss;
  if (!boss) return false;
  return state.status === "boss_ready" && !boss.complete;
}

/**
 * The `count` a "skip all" press should send.
 *
 * Sends what is actually left rather than a fixed number: the engine saturates
 * either way, but sending the true remainder keeps the recorded action honest
 * about how many cards the player skipped.
 */
export function skipAllCount(track: Pick<RevealTrack, "total" | "revealed">): number {
  return Math.max(1, track.total - track.revealed);
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  draft_room: "Draft Room",
  trade_desk: "Trade Desk",
  // `film_room` is the ENGINE's stable node-type id and is deliberately
  // unchanged — every switch in the API and the client resolves on it. Its
  // player-facing identity under rtt_ruleset_v3 is "Scout & Prepare", because
  // the node no longer does anything the old name described. Kept identical to
  // `NODE_TYPE_COPY.film_room.label`, which the copy test pins.
  film_room: "Scout & Prepare",
  rest_bank: "Rest / Bank",
};

/* `NODE_TYPE_BLURBS` used to live here. It was exported, rendered by nothing,
 * and was a second, unmaintained copy of the node descriptions that
 * `run-the-table-copy.ts::NODE_TYPE_COPY` owns — so a copy fix could land in
 * one and not the other with nothing to catch it. Deleted; `NODE_TYPE_COPY`
 * is the single source of node prose. `NODE_TYPE_LABELS` above stays: it is
 * the short label the map and the ladder render. */

export const ROLE_LABELS: Record<Role, string> = {
  lead_creator: "Lead Creator",
  guard_wing: "Guard / Wing",
  wing_forward: "Wing / Forward",
  forward_big: "Forward / Big",
  anchor: "Anchor",
};

export const ROLE_COLOR_VARS: Record<Role, string> = {
  lead_creator: "var(--role-lead-creator)",
  guard_wing: "var(--role-guard-wing)",
  wing_forward: "var(--role-wing-forward)",
  forward_big: "var(--role-forward-big)",
  anchor: "var(--role-anchor)",
};

/**
 * `SYSTEMS[].name` from nba_peak/run_the_table/config.py, mirrored.
 *
 * Same reason `ROLE_LABELS` and `LANE_TOKEN_BY_FIELD` are mirrored: the payload
 * that carries a cost modifier (`card_public().cost_modifiers`) sends only the
 * `system_id`, never the display name, and a `RunCardPublic` has no access to
 * `state.systems`. The NUMBERS in a modifier are entirely the server's — this
 * map only supplies the words.
 */
export const SYSTEM_LABELS: Record<string, string> = {
  moneyball: "Moneyball",
  deep_rotation: "Deep Rotation",
  no_hardware: "No Hardware",
  two_way_value: "Two-Way Value",
  trade_machine: "Trade Machine",
  veteran_minimum: "Veteran Minimum",
};

/** A System's display name. Falls back to a readable de-slugged form so an id
 *  this build has never heard of still reads as words, never as a raw enum. */
export function systemLabel(systemId: string): string {
  if (SYSTEM_LABELS[systemId]) return SYSTEM_LABELS[systemId];
  return systemId
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * One cost modifier as human copy: `"Moneyball · −20% (24 → 19)"`.
 *
 * THIS IS THE `[object Object]` FIX. `cost_modifiers` is
 * `list[dict]` on the server (`pricing.price_for`), was typed `string[]` on the
 * client, and was rendered with `.join(" · ")` — which stringifies each object
 * as `[object Object]`. It fired for `moneyball`, `no_hardware` and
 * `two_way_value` (3 of the 6 selectable Systems) on every card in the Draft
 * Room and on both Trade Desk columns.
 *
 * U+2212 MINUS SIGN, not a hyphen: this is a signed quantity, and a hyphen at
 * `text-[10px]` next to a digit reads as a dash. U+2192 for the arrow.
 */
export function formatCostModifier(mod: CostModifier): string {
  return `${systemLabel(mod.system_id)} · −${mod.discount_pct}% (${mod.before} → ${mod.after})`;
}

/** Every modifier on a card, as sentences. Empty array when nothing applied. */
export function describeCostModifiers(mods: readonly CostModifier[]): string[] {
  return mods.map(formatCostModifier);
}

/**
 * What `overall_percentile` is a percentile OF — stated, because an unlabelled
 * "75.1th pct" on a card is a number the player cannot act on.
 *
 * VERIFIED against the server, not assumed: `cards.build_pool()` computes
 * `overall_pcts = _percentile_ranks(prime_scores)` over `selected`, which is
 * every 3-year card profile that is not `excluded` and has at least one
 * eligible role (`nba_peak/run_the_table/cards.py:143-201`). So the denominator
 * is the RUN THE TABLE eligible card pool — NOT "all PEAK3 3-year peak
 * windows", which would include every excluded and role-less window and is a
 * different, larger set. Saying the wrong denominator would be a fabricated
 * claim about the model.
 */
export const OVERALL_PERCENTILE_BASIS =
  "of the Run the Table card pool — every eligible PEAK3 3-year peak window";

/** The short form the card itself prints. Still names the denominator — an
 *  unlabelled percentile is the defect this replaces — just in fewer words,
 *  with the full basis carried in the card's sr-only sentence. */
export const OVERALL_PERCENTILE_SHORT_BASIS = "of the card pool";

/**
 * "75.1st percentile of the Run the Table card pool …".
 *
 * `overall_percentile` arrives already ×100 and rounded to 1dp; it is never
 * recomputed here. The ordinal comes from `lib/ordinal.ts` — this function used
 * to append `"th"` unconditionally, so every card in the game rendered
 * `75.1th`, `21.0th`, `1.0th`.
 */
export function percentileSentence(overallPercentile: number): string {
  return `${ordinalFixed(overallPercentile, 1)} percentile ${OVERALL_PERCENTILE_BASIS}`;
}

/** "75.1st percentile of the card pool" — the on-card form. */
export function percentileShort(overallPercentile: number): string {
  return `${ordinalFixed(overallPercentile, 1)} percentile ${OVERALL_PERCENTILE_SHORT_BASIS}`;
}

/** Slot label for a roster slot: the role for a starter, "Bench 1/2" below. */
export function slotLabel(slot: Pick<RosterSlotPublic, "slot_id" | "role" | "is_starter">): string {
  if (slot.role && slot.role in ROLE_LABELS) return ROLE_LABELS[slot.role];
  const match = /^bench_(\d+)$/.exec(slot.slot_id);
  if (match) return `Bench ${match[1]}`;
  return slot.slot_id;
}

/** The `--comp-*` custom property for a lane token. Lane colour is never
 *  chosen by the component; it is always this lookup on the server's token. */
export function laneColorVar(token: LaneToken): string {
  return `var(--comp-${token})`;
}

/**
 * `LANE_LABELS` from nba_peak/run_the_table/config.py, mirrored.
 *
 * Needed because `RunCardPublic.lane_index` / `.lane_percentiles` are bare
 * `Record<LaneField, number>` — the only lane payloads on the API that carry no
 * `label`, unlike `LaneProfileEntry`. The NUMBERS are always the server's.
 *
 * `postseason_individual_value` → "Playoff Rate Impact" and `team_achievement`
 * → "Team Result" are the pinned user-facing labels (`component-labels.test.ts`);
 * the canonical field names above them are never renamed.
 */
export const LANE_LABELS: Record<LaneField, string> = {
  statistical_impact: "Statistical Impact",
  traditional_production: "Traditional Production",
  individual_recognition: "Individual Recognition",
  postseason_individual_value: "Playoff Rate Impact",
  team_achievement: "Team Result",
};

/** `LANE_TOKENS` from config.py, mirrored so the RECEIPT's lane profile — the
 *  one payload that omits `token` — can still be drawn in the right colours. */
export const LANE_TOKEN_BY_FIELD: Record<LaneField, LaneToken> = {
  statistical_impact: "si",
  traditional_production: "tp",
  individual_recognition: "rec",
  postseason_individual_value: "po",
  team_achievement: "team",
};

/** Adapts `receipt.lane_profile` (no `token`) to the shape LaneProfile draws. */
export function receiptLaneProfile(entries: ReceiptLaneProfileEntry[]): LaneProfileEntry[] {
  return entries.map((e) => ({
    lane: e.lane,
    label: e.label,
    token: LANE_TOKEN_BY_FIELD[e.lane],
    value: e.value,
  }));
}

// ---------------------------------------------------------------------------
// Card shape — strongest lane, weakest lane, profile label
// ---------------------------------------------------------------------------

/**
 * The one-word shape of a card, per lane, when that lane is its strongest.
 *
 * These are DISPLAY labels for the card's own silhouette, not renames: the
 * five frozen component labels are still what `LANE_LABELS` prints beside the
 * numbers, and `component-labels.test.ts` still pins them app-wide.
 */
export const LANE_PROFILE_LABELS: Record<LaneField, string> = {
  statistical_impact: "Impact-heavy",
  traditional_production: "Production-heavy",
  individual_recognition: "Award-heavy",
  postseason_individual_value: "Playoff-heavy",
  team_achievement: "Team-heavy",
};

export const BALANCED_PROFILE_LABEL = "Balanced";

/**
 * How level the five lane percentiles must be before a card reads "Balanced".
 *
 * DISPLAY ONLY. It mirrors `config.TWO_WAY_BALANCE_MAX_SPREAD` — the engine's
 * own definition of a balanced card, and the one the player will meet again in
 * the Two-Way Value perk's published rule — so the word on the card and the
 * word in the perk mean the same thing. It changes no price and no lane value;
 * the card's cost is whatever `card_public()` sent.
 */
export const BALANCED_LANE_SPREAD_MAX = 28;

export interface CardLaneRank {
  lane: LaneField;
  label: string;
  token: LaneToken;
  /** `lane_percentiles[lane]` — the server's number, never recomputed. */
  percentile: number;
}

export interface CardLaneSummary {
  strongest: CardLaneRank;
  weakest: CardLaneRank;
  /** `"Balanced"`, `"Impact-heavy"`, `"Playoff-heavy"`, … */
  profile: string;
  /** `strongest.percentile - weakest.percentile`, for the balance test. */
  spread: number;
}

/**
 * What `RunTheTableGame` remembers from the current act's Scout & Prepare
 * report, purely for later PRESENTATION — see that component's `scoutIntel`
 * docstring for why it exists and why it is never a second source of truth
 * for anything server-authoritative. Shared here so `RunHUD`, `DraftRoom`
 * and `TradeDesk` all type it identically without importing a game-shell
 * component from each other.
 */
export interface ScoutIntel {
  bossId: string;
  bossName: string;
  weakestLane: LaneField;
  weakestLabel: string;
}

/**
 * A card's strongest lane, weakest lane and one-word profile.
 *
 * Pure reading and comparison of `lane_percentiles`, which the engine already
 * computed and scaled 0-100 (`cards.build_pool`). Nothing here derives a PEAK3
 * value, a price or a battle result — it only says which of the five numbers
 * the server sent is the largest and which is the smallest.
 *
 * Ties resolve to `LANE_FIELDS` order, which is the engine's own order, so the
 * answer is deterministic for a card whose lanes are level.
 */
export function cardLaneSummary(
  lanePercentiles: Record<LaneField, number>,
): CardLaneSummary {
  const ranks: CardLaneRank[] = LANE_FIELDS.map((lane) => ({
    lane,
    label: LANE_LABELS[lane],
    token: LANE_TOKEN_BY_FIELD[lane],
    percentile: lanePercentiles?.[lane] ?? 0,
  }));
  let strongest = ranks[0];
  let weakest = ranks[0];
  for (const r of ranks) {
    if (r.percentile > strongest.percentile) strongest = r;
    if (r.percentile < weakest.percentile) weakest = r;
  }
  const spread = strongest.percentile - weakest.percentile;
  return {
    strongest,
    weakest,
    profile:
      spread <= BALANCED_LANE_SPREAD_MAX
        ? BALANCED_PROFILE_LABEL
        : LANE_PROFILE_LABELS[strongest.lane],
    spread,
  };
}

// ---------------------------------------------------------------------------
// Map ladder
// ---------------------------------------------------------------------------

export interface LadderRow {
  key: string;
  kind: "stage" | "boss";
  act: number;
  /** Stage rows only. */
  stage: number | null;
  state: string;
  label: string;
  sublabel: string;
  scouted: boolean;
}

/**
 * Flattens `state.map` into the vertical ladder the left rail renders:
 * `STAGES_PER_ACT` stage rows then one boss row, per act.
 *
 * NO ACT COUNT IS ASSUMED — it iterates `map`, which the server sizes from
 * `config.ACTS` (5 under rtt_ruleset_v3). The docstring used to say "3-act",
 * which was two rulesets stale by the time anyone read it.
 *
 * A stage the player has not reached shows only its SHAPE (which node types
 * were on offer) — never their content. That restriction is enforced by the
 * server (`_map_public` sends nothing else); this function must not invent
 * anything past it.
 */
export function ladderRows(map: MapAct[]): LadderRow[] {
  const rows: LadderRow[] = [];
  for (const act of map) {
    for (const stage of act.stages) {
      const chosen = stage.chosen_node_type ? NODE_TYPE_LABELS[stage.chosen_node_type] : null;
      const shape = stage.option_types.map((t) => NODE_TYPE_LABELS[t]).join(" or ");
      rows.push({
        key: `a${act.act}s${stage.stage}`,
        kind: "stage",
        act: act.act,
        stage: stage.stage,
        state: stage.state,
        label: `Act ${act.act} · Stage ${stage.stage}`,
        sublabel: chosen ?? shape,
        scouted: stage.scouted,
      });
    }
    rows.push({
      key: `a${act.act}boss`,
      kind: "boss",
      act: act.act,
      stage: null,
      state: act.boss.state,
      label: `Act ${act.act} Boss`,
      sublabel: act.boss.name,
      scouted: false,
    });
  }
  return rows;
}

/** How far through the run the player is, for the mobile progress strip.
 *  Counts resolved stage rows and decided boss rows out of every row. */
export function ladderProgress(map: MapAct[]): { done: number; total: number } {
  const rows = ladderRows(map);
  const done = rows.filter((r) =>
    r.kind === "stage" ? r.state === "done" : ["won", "lost", "drawn"].includes(r.state),
  ).length;
  return { done, total: rows.length };
}

// ---------------------------------------------------------------------------
// Node narrowing
// ---------------------------------------------------------------------------

export function draftOffers(node: ActiveNode | null): DraftOffer[] {
  return node?.node_type === "draft_room" ? (node.offers ?? []) : [];
}

export function tradeIncoming(node: ActiveNode | null): TradeIncoming[] {
  return node?.node_type === "trade_desk" ? (node.incoming ?? []) : [];
}

export function tradeOutgoing(node: ActiveNode | null): TradeOutgoingOption[] {
  return node?.node_type === "trade_desk" ? (node.outgoing_options ?? []) : [];
}

/**
 * Whether a trade pairing is legal: the incoming card must list the outgoing
 * slot among the slots the SERVER said are legal for it. The client never
 * re-derives role eligibility; it only reads `legal_slots`.
 */
export function isTradeLegal(incoming: TradeIncoming, outgoingSlotId: string): boolean {
  return incoming.legal_slots.includes(outgoingSlotId);
}

/** Net credits for a pairing, from the two numbers the server already sent.
 *  Positive means it costs the player; negative means it pays. */
export function tradeNetCost(incoming: TradeIncoming, outgoing: TradeOutgoingOption): number {
  return incoming.cost - outgoing.refund;
}

// ---------------------------------------------------------------------------
// Trade Desk transaction model
// ---------------------------------------------------------------------------

/**
 * The Trade Desk's whole ephemeral state: at most ONE outgoing slot and at most
 * ONE incoming card.
 *
 * It used to be two independent `useState`s inside `TradeDesk.tsx` where
 * neither handler cleared the other column, `<TradeDesk>` was rendered with no
 * `key` so nothing reset on a node change, and the border ternary let
 * `selected` outrank `compatible` — so a card that had become illegal was
 * painted accent-gold, carried a red "Not eligible" badge and still reported
 * `aria-pressed="true"` at the same time. Modelling the pair as one value, in a
 * pure module, is what makes "only the actually selected cards are highlighted"
 * testable rather than aspirational.
 */
export interface TradeSelection {
  outgoingSlotId: string | null;
  incomingCardId: string | null;
}

export const EMPTY_TRADE_SELECTION: TradeSelection = {
  outgoingSlotId: null,
  incomingCardId: null,
};

/**
 * Pick (or unpick) the player being sent out.
 *
 * Changing the outgoing slot re-asks the SERVER's `legal_slots` for the
 * currently-picked incoming card and drops that pick if the new slot is not on
 * the list. This is the rule that stopped the desk from ever showing a
 * highlighted, illegal, still-`aria-pressed` pairing.
 */
export function chooseOutgoing(
  selection: TradeSelection,
  slotId: string,
  incoming: readonly TradeIncoming[],
): TradeSelection {
  // Toggling the same slot off clears the whole transaction: an incoming pick
  // with no outgoing slot has no price, no legality and no meaning.
  if (selection.outgoingSlotId === slotId) return EMPTY_TRADE_SELECTION;

  const picked = incoming.find((c) => c.card_id === selection.incomingCardId) ?? null;
  const keepIncoming = picked !== null && isTradeLegal(picked, slotId);
  return {
    outgoingSlotId: slotId,
    incomingCardId: keepIncoming ? selection.incomingCardId : null,
  };
}

/** Pick (or unpick) the incoming player. Never touches the outgoing pick, so
 *  it can never highlight an unrelated offer. */
export function chooseIncoming(selection: TradeSelection, cardId: string): TradeSelection {
  return {
    outgoingSlotId: selection.outgoingSlotId,
    incomingCardId: selection.incomingCardId === cardId ? null : cardId,
  };
}

export function clearTradeSelection(): TradeSelection {
  return EMPTY_TRADE_SELECTION;
}

/** Whether a control may be pressed, and the ONE concise sentence explaining
 *  it when it may not. `reason` is null exactly when `eligible` is true. */
export interface TradeEligibility {
  eligible: boolean;
  reason: string | null;
}

const ELIGIBLE: TradeEligibility = { eligible: true, reason: null };

/**
 * Can this incoming card be brought in for the currently-picked slot?
 *
 * With no outgoing slot picked yet nothing is ineligible — legality only
 * exists relative to a slot — so every card stays live and the player is never
 * shown a disabled control they cannot explain.
 */
export function incomingEligibility(
  card: TradeIncoming,
  outgoing: TradeOutgoingOption | null,
): TradeEligibility {
  if (!outgoing) return ELIGIBLE;
  if (isTradeLegal(card, outgoing.slot_id)) return ELIGIBLE;
  return {
    eligible: false,
    reason: `Cannot play ${slotLabel(outgoing)}`,
  };
}

/**
 * What choosing this outgoing slot would do to the incoming pick already made.
 *
 * DELIBERATELY NOT an eligibility check. The outgoing column is Step 1 — going
 * back to it must always be possible, and it RESETS Step 2 by design
 * (`chooseOutgoing` drops an incompatible incoming pick). Disabling the
 * outgoing column on the incoming pick made the mandated "changing the
 * outgoing player clears an incompatible incoming selection" rule literally
 * unreachable: the click that was supposed to trigger the clear was itself
 * blocked. Caught by `trade-desk.test.tsx`.
 *
 * So this returns an ADVISORY sentence — shown in a neutral tone, never an
 * error tone — or null when nothing would be lost.
 */
export function outgoingAdvisory(
  slot: TradeOutgoingOption,
  incoming: TradeIncoming | null,
): string | null {
  if (!incoming) return null;
  if (isTradeLegal(incoming, slot.slot_id)) return null;
  return `Picking this clears ${incoming.player_name}`;
}

/**
 * How many of THIS node's incoming offers the server considers legal for a slot.
 *
 * Reads `legal_slots` — the server's own list — and never re-derives role
 * eligibility.
 */
export function legalIncomingCountFor(
  slot: TradeOutgoingOption,
  incoming: TradeIncoming[],
): number {
  return incoming.filter((card) => isTradeLegal(card, slot.slot_id)).length;
}

/**
 * The dead-end warning for an outgoing slot no offer on the board can fill.
 *
 * A real trade board can offer three players and still have a roster slot none
 * of them may legally take. Before this existed the player found that out the
 * only way available: pick the slot, watch all three incoming cards go
 * disabled, and back out. That is precisely the "trial-and-error to discover
 * role legality" the brief bans, and it is why this is computed for EVERY
 * outgoing card up front rather than only for the selected one.
 *
 * Returns null when at least one legal replacement exists, so the common case
 * stays uncluttered.
 */
export function outgoingDeadEnd(
  slot: TradeOutgoingOption,
  incoming: TradeIncoming[],
): string | null {
  if (incoming.length === 0) return null;
  if (legalIncomingCountFor(slot, incoming) > 0) return null;
  return `No one on this board can play ${slotLabel(slot)}`;
}

/** One lane's change from swapping these two cards into the same slot. */
export interface TradeLaneDelta {
  lane: LaneField;
  label: string;
  token: LaneToken;
  outgoing: number;
  incoming: number;
  delta: number;
}

/**
 * The Review step.
 *
 * Everything on it is arithmetic over numbers the server already sent:
 * `incoming.cost`, `outgoing.refund`, `state.credits`, and the two cards'
 * `lane_index` values. Nothing here re-derives a price, a refund percentage, a
 * role eligibility or a PEAK3 score.
 */
export interface TradeReview {
  outgoing: TradeOutgoingOption;
  incoming: TradeIncoming;
  slotLabel: string;
  refund: number;
  cost: number;
  net: number;
  creditsBefore: number;
  creditsAfter: number;
  /** The outgoing card's primary role, and the incoming card's. */
  roleBefore: string;
  roleAfter: string;
  /** `incoming.legal_slots.includes(outgoing.slot_id)` — the server's list. */
  legal: boolean;
  affordable: boolean;
  /** Null when the trade can be confirmed. */
  blockedReason: string | null;
  laneDeltas: TradeLaneDelta[];
}

/**
 * Per-lane change from swapping `outgoing` out for `incoming` in one slot.
 *
 * Uses `lane_index` — the 0-100 rescale the engine's own `lane_score` consumes
 * — so this is the same scale the battle compares on. It is deliberately
 * described in the UI as the CARD's change, not the roster's: the roster total
 * also depends on starter/bench weighting, and only the server recomputes that.
 */
export function tradeLaneDeltas(
  outgoing: TradeOutgoingOption,
  incoming: TradeIncoming,
): TradeLaneDelta[] {
  return LANE_FIELDS.map((lane) => {
    const before = outgoing.card.lane_index[lane] ?? 0;
    const after = incoming.lane_index[lane] ?? 0;
    return {
      lane,
      label: LANE_LABELS[lane],
      token: LANE_TOKEN_BY_FIELD[lane],
      outgoing: before,
      incoming: after,
      delta: after - before,
    };
  });
}

/** The review for a complete selection, or null while one half is missing. */
export function buildTradeReview(
  node: ActiveNode | null,
  selection: TradeSelection,
  credits: number,
): TradeReview | null {
  const incoming =
    tradeIncoming(node).find((c) => c.card_id === selection.incomingCardId) ?? null;
  const outgoing =
    tradeOutgoing(node).find((s) => s.slot_id === selection.outgoingSlotId) ?? null;
  if (!incoming || !outgoing) return null;

  const legal = isTradeLegal(incoming, outgoing.slot_id);
  const net = tradeNetCost(incoming, outgoing);
  const affordable = net <= credits;
  const label = slotLabel(outgoing);

  return {
    outgoing,
    incoming,
    slotLabel: label,
    refund: outgoing.refund,
    cost: incoming.cost,
    net,
    creditsBefore: credits,
    creditsAfter: credits - net,
    roleBefore: ROLE_LABELS[outgoing.card.primary_role] ?? outgoing.card.primary_role,
    roleAfter: ROLE_LABELS[incoming.primary_role] ?? incoming.primary_role,
    legal,
    affordable,
    blockedReason: !legal
      ? `${incoming.player_name} is not eligible for ${label}.`
      : !affordable
        ? `Not enough credits — this trade needs ${net} and you hold ${credits}.`
        : null,
    laneDeltas: tradeLaneDeltas(outgoing, incoming),
  };
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export function filledCount(slots: RosterSlotPublic[]): number {
  return slots.filter((s) => s.card !== null).length;
}

/** Roster pips for the sticky mobile tray: one entry per slot, starters first.
 *  `role` is carried through (not just `slot_id`) so a caller can build a real
 *  label via `slotLabel()` rather than read the raw slot id — see P5-F5. */
export function rosterPips(state: Pick<RunPublicState, "starters" | "bench">): {
  slot_id: string;
  role: Role | null;
  filled: boolean;
  is_starter: boolean;
}[] {
  return [...state.starters, ...state.bench].map((s) => ({
    slot_id: s.slot_id,
    role: s.role,
    filled: s.card !== null,
    is_starter: s.is_starter,
  }));
}

// ---------------------------------------------------------------------------
// Battle
// ---------------------------------------------------------------------------

/** The battle for the act the player just resolved, or the most recent one. */
export function currentBattle(state: RunPublicState): BattlePublic | null {
  if (state.battles.length === 0) return null;
  const forAct = state.battles.filter((b) => b.act === state.act);
  return forAct.length > 0 ? forAct[forAct.length - 1] : state.battles[state.battles.length - 1];
}

// ---------------------------------------------------------------------------
// Pre-boss briefing (an ESTIMATE, and labelled as one everywhere it is shown)
// ---------------------------------------------------------------------------

export type LaneFavour = "you" | "boss" | "level";

export interface LaneProjection {
  lane: LaneField;
  label: string;
  token: LaneToken;
  player: number;
  opponent: number;
  /** `player - opponent`. Positive means the lane currently leans your way. */
  margin: number;
  favour: LaneFavour;
}

export interface BossBriefing {
  lanes: LaneProjection[];
  /** Leaning your way, widest margin first. */
  favouredYou: LaneProjection[];
  /** Leaning theirs, widest margin first. */
  favouredBoss: LaneProjection[];
  /** Inside `LANE_LEVEL_EPSILON` — too close to call before the battle. */
  level: LaneProjection[];
}

/**
 * Below this, a lane is reported "too close to call" rather than as a lean.
 *
 * A display threshold, not the engine's decision rule: `battle.resolve_battle`
 * rounds to `LANE_ROUNDING` and compares with `LANE_EPSILON` (1e-6), so it
 * genuinely does separate lanes this tight. Calling a 0.3-point gap a
 * "favoured lane" on a pre-battle screen would overstate what the comparison
 * can tell the player.
 */
export const LANE_LEVEL_EPSILON = 0.5;

/**
 * Which lanes currently lean which way, before a battle is resolved.
 *
 * THIS IS AN ESTIMATE AND EVERY SURFACE THAT RENDERS IT MUST SAY SO. Both
 * profiles are the server's own `roster_lane_profile` outputs, but they are not
 * computed under identical conditions: `public_state()` builds the PLAYER's
 * profile with `bench_weight_for(systems, None)` — no boss rule — while
 * `boss_public()` builds the BOSS's with `bench_weight_for(systems,
 * boss.rule_id)`. A rule that fixes the bench weight (`strength_in_numbers`,
 * `top_heavy`) therefore applies to the boss's displayed numbers and not to
 * yours, and the real battle applies it to both. Tie-breaks the rule may own
 * are not modelled here at all.
 *
 * So this is presentation of numbers already on the client, not a prediction
 * and emphatically not a simulation: no possession, no randomness, no model
 * inference. Returns null when the boss is unscouted and has no lane profile.
 */
export function bossBriefing(
  playerLanes: readonly LaneProfileEntry[],
  bossLanes: readonly LaneProfileEntry[] | null | undefined,
): BossBriefing | null {
  if (!bossLanes || bossLanes.length === 0) return null;
  const bossByLane = new Map(bossLanes.map((l) => [l.lane, l]));
  const lanes: LaneProjection[] = [];
  for (const entry of playerLanes) {
    const opp = bossByLane.get(entry.lane);
    if (!opp) continue;
    const margin = entry.value - opp.value;
    lanes.push({
      lane: entry.lane,
      label: entry.label,
      token: entry.token,
      player: entry.value,
      opponent: opp.value,
      margin,
      favour:
        Math.abs(margin) < LANE_LEVEL_EPSILON ? "level" : margin > 0 ? "you" : "boss",
    });
  }
  if (lanes.length === 0) return null;
  const byMargin = (a: LaneProjection, b: LaneProjection) =>
    Math.abs(b.margin) - Math.abs(a.margin);
  return {
    lanes,
    favouredYou: lanes.filter((l) => l.favour === "you").sort(byMargin),
    favouredBoss: lanes.filter((l) => l.favour === "boss").sort(byMargin),
    level: lanes.filter((l) => l.favour === "level"),
  };
}

export interface SeriesCount {
  player: number;
  opponent: number;
  ties: number;
}

/**
 * The running series count after `count` lanes have been revealed. Pure
 * counting of `winner` values the server decided — the client never decides a
 * lane, and never breaks a tie.
 */
export function runningSeries(lanes: BattleLanePublic[], count: number): SeriesCount {
  const upto = lanes.slice(0, Math.max(0, Math.min(count, lanes.length)));
  return {
    player: upto.filter((l) => l.winner === "player").length,
    opponent: upto.filter((l) => l.winner === "opponent").length,
    ties: upto.filter((l) => l.winner === "tie").length,
  };
}

export const DECIDED_BY_LABELS: Record<string, string> = {
  lanes: "Decided on lanes won",
  summed_margin: "Tied on lanes — decided on summed lane margin",
  roster_total: "Tied on lanes and margin — decided on overall roster total",
  exact_draw: "Dead even on every tiebreak",
};

/** The verdict stamp. Present in the DOM at t=0 so nothing a screen reader or
 *  an impatient player needs is gated behind an animation. */
export function battleVerdict(battle: BattlePublic): { stamp: string; detail: string } {
  const stamp =
    battle.outcome === "win" ? "VICTORY" : battle.outcome === "loss" ? "DEFEAT" : "DRAW";
  const detail = `${battle.player_lanes_won}–${battle.opponent_lanes_won} on lanes. ${
    DECIDED_BY_LABELS[battle.decided_by] ?? "Decided on lanes won"
  }.`;
  return { stamp, detail };
}

/**
 * The lane that settled the battle, and one sentence saying why.
 *
 * Pure counting over `winner` values the SERVER already decided, in the order
 * the server sent them: the first lane at which either side reaches
 * `lanesToWin` is the decisive one. When neither side gets there, the engine's
 * own `decided_by` is the answer and no lane is decisive — this function says
 * so rather than nominating one.
 *
 * Nothing here decides a lane, breaks a tie, or re-derives an outcome.
 */
export function decisiveLane(
  battle: BattlePublic,
  lanesToWin: number,
): { lane: BattleLanePublic | null; sentence: string } {
  if (lanesToWin > 0) {
    let player = 0;
    let opponent = 0;
    for (const lane of battle.lanes) {
      if (lane.winner === "player") player += 1;
      else if (lane.winner === "opponent") opponent += 1;
      if (player >= lanesToWin) {
        return {
          lane,
          sentence: `${lane.label} was the ${ordinal(
            lanesToWin,
          )} lane you won — that is where the battle was settled.`,
        };
      }
      if (opponent >= lanesToWin) {
        return {
          lane,
          sentence: `${lane.label} was their ${ordinal(
            lanesToWin,
          )} lane — that is where the battle was settled.`,
        };
      }
    }
  }
  return {
    lane: null,
    sentence: `Neither side took ${lanesToWin} lanes. ${
      DECIDED_BY_LABELS[battle.decided_by] ?? "Decided on lanes won"
    }.`,
  };
}

/**
 * One sentence per lane, for the `aria-live` region and the skip-to-end view.
 *
 * Names the lineup rating as a rating (never "score" or "total" — see
 * `LANE_RATING_LABELS`) and, when the engine sent one, the top contributor's
 * OWN value separately — so a screen-reader user reaches the same two
 * distinctly-attributed numbers a sighted player now sees on the lane row,
 * never the pre-fix reading where one number could be mistaken for a named
 * player's score.
 */
export function laneSentence(lane: BattleLanePublic): string {
  const winner =
    lane.winner === "player" ? "You win" : lane.winner === "opponent" ? "They win" : "Tied";
  const contributorClause =
    lane.top_contributor && lane.opponent_top_contributor
      ? ` Top contributor: ${lane.top_contributor.name} ${lane.top_contributor.own_lane_index_value.toFixed(
          1,
        )} vs ${lane.opponent_top_contributor.name} ${lane.opponent_top_contributor.own_lane_index_value.toFixed(
          1,
        )}.`
      : "";
  return `${lane.label} lineup rating: ${lane.player_lineup_rating.toFixed(
    1,
  )} to ${lane.boss_lineup_rating.toFixed(1)}. ${winner}${
    lane.tie_broken_by_rule ? " (boss rule broke the tie)" : ""
  }.${contributorClause}`;
}

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------

/** "+3.4" / "-3.4" / "0.0" — the receipt is a signed-delta document, so the
 *  sign is never dropped on a positive. */
export function formatSigned(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  const fixed = value.toFixed(digits);
  return value > 0 ? `+${fixed}` : fixed;
}

export function formatCredits(value: number): string {
  return `${value}`;
}

/**
 * The colour a SIGNED DELTA should read in. Neutral at exactly zero — a "0"
 * painted green would claim a gain that did not happen.
 *
 * Correct wherever the sign genuinely IS the semantic: the Trade Desk's "Net
 * credit change", a lane delta, a PEAK3 score delta on an acquisition. It is
 * NOT how receipt lines are coloured — see `receiptItemColorVar`. Reaching for
 * this helper on a receipt line is what made `receipt.py` negate a credit
 * HOLDING to force it red.
 */
export function signedColorVar(value: number): string {
  if (value > 0) return "var(--correct)";
  if (value < 0) return "var(--incorrect)";
  return "var(--text-muted)";
}

// ---------------------------------------------------------------------------
// Semantic receipt items (plan §2.3)
// ---------------------------------------------------------------------------

/**
 * Colour by MEANING, never by the sign of a number.
 *
 * The bug this replaces: `receipt.py:235` emitted `"signed_value":
 * -state.credits`, negating a holding so a shared `signedColorVar()` would
 * paint it red — and the component printed the same field it coloured with. So
 * "Finished holding 68 unspent credits" rendered as a red −68.0, two blocks
 * below a Credits section that said `finished holding 68`. Under §2.3 that item
 * is `{kind:"neutral", value:68, unit:"credits"}`: 68, not −68, not red.
 */
export const RECEIPT_ITEM_COLOR_VARS: Record<ReceiptItemKind, string> = {
  benefit: "var(--correct)",
  cost: "var(--incorrect)",
  neutral: "var(--text-muted)",
  /** Accent-neutral: a record is a fact, not a gain or a loss. */
  record: "var(--text-secondary)",
};

export function receiptItemColorVar(kind: ReceiptItemKind): string {
  return RECEIPT_ITEM_COLOR_VARS[kind] ?? RECEIPT_ITEM_COLOR_VARS.neutral;
}

/**
 * The value column for one receipt item.
 *
 * `display` wins when the engine supplied one (`"3 of 5 lanes"`). Otherwise the
 * magnitude is printed as-is — never re-signed, never negated — because the
 * `label` already says whether it was spent, held, won or lost, and `kind`
 * already carries the colour. An item with no `value` and no `display` renders
 * an em dash rather than "undefined" or an accidental `0`.
 */
export function formatReceiptItem(item: ReceiptItem): string {
  if (item.display) return item.display;
  if (typeof item.value !== "number" || !Number.isFinite(item.value)) return "—";
  const v = item.value;
  switch (item.unit) {
    case "credits":
    case "lanes":
      return `${Math.round(v)}`;
    case "percentage":
      return `${v.toFixed(1)}%`;
    case "score":
      return v.toFixed(1);
    default:
      return Number.isInteger(v) ? `${v}` : v.toFixed(1);
  }
}

/**
 * How a deprecated `reasons[]` row maps onto a `kind`.
 *
 * `acquisition` is the one row whose `signed_value` is a genuinely signed PEAK3
 * delta, so it is classified by its sign. `economy` is deliberately NEUTRAL:
 * it is the row the engine negated, and a v1 receipt carries no way to tell a
 * holding from a spend — so it is shown as a plain magnitude in the muted tone
 * rather than re-asserting the colour that was wrong in the first place.
 */
const LEGACY_REASON_KIND: Record<ReceiptReason["kind"], ReceiptItemKind | "signed"> = {
  lane_strength: "benefit",
  lane_weakness: "cost",
  acquisition: "signed",
  economy: "neutral",
};

/** One deprecated `reasons[]` row as a §2.3 item. */
export function receiptItemFromReason(reason: ReceiptReason): ReceiptItem {
  const mapped = LEGACY_REASON_KIND[reason.kind] ?? "neutral";
  const kind: ReceiptItemKind =
    mapped !== "signed"
      ? mapped
      : reason.signed_value > 0
        ? "benefit"
        : reason.signed_value < 0
          ? "cost"
          : "neutral";
  return {
    kind,
    label: reason.text,
    // The TRUE MAGNITUDE. `Math.abs` is what un-does the engine's negation on
    // an old saved receipt, so a v1 holding stops rendering as a red minus.
    value: Math.abs(reason.signed_value),
  };
}

/**
 * The receipt's explanation lines, whichever contract the receipt was saved
 * under.
 *
 * Prefers §2.3's `items`. Falls back to the deprecated `reasons[]` so a
 * completed v1 receipt stays readable (plan §2.4), and returns an empty array
 * when a receipt has neither — the caller renders its "not enough happened to
 * explain" line rather than an empty box.
 */
export function receiptItems(
  receipt: Pick<RunReceipt, "items" | "reasons">,
): ReceiptItem[] {
  if (receipt.items && receipt.items.length > 0) return receipt.items;
  return (receipt.reasons ?? []).map(receiptItemFromReason);
}

// ---------------------------------------------------------------------------
// Outcome taxonomy (plan §2.2)
// ---------------------------------------------------------------------------

export const RUN_OUTCOME_VERDICTS: Record<RunOutcome, string> = {
  table_cleared: "TABLE CLEARED",
  ended_at_final_boss: "RUN ENDED AT THE FINAL BOSS",
  // `{n}` is filled by `runVerdict`.
  ended_in_act: "RUN ENDED IN ACT",
};

const RUN_OUTCOMES: readonly RunOutcome[] = [
  "table_cleared",
  "ended_at_final_boss",
  "ended_in_act",
];

/** The act the run stopped in: the last act that actually saw a battle. */
export function endedInAct(receipt: Pick<RunReceipt, "battles">): number {
  const acts = receipt.battles.map((b) => b.act).filter((a) => Number.isFinite(a));
  return acts.length > 0 ? Math.max(...acts) : 1;
}

/**
 * Which of the three §2.2 outcomes this receipt represents.
 *
 * Trusts the engine's own `outcome` when it is there. Derives it otherwise, so
 * a v1 receipt saved before the taxonomy existed still renders honest framing
 * instead of the retired `"RUN COMPLETE"` — which was printed for a 0-for-3
 * losing run, and is the specific thing the spec forbids.
 *
 * `actsTotal` is `state.acts_total` where the caller has it. WITHOUT it, the
 * result is the weaker claim: a receipt alone cannot tell "lost the final
 * boss" from "lost the act-2 boss and ran out of lives", because it does not
 * carry how many acts the run had. So an unknown `actsTotal` yields
 * `ended_in_act`, which is true of both — never `ended_at_final_boss`, which
 * would be an assertion the data does not support.
 */
export function runOutcome(
  receipt: Pick<RunReceipt, "outcome" | "ran_the_table" | "table_cleared" | "battles">,
  actsTotal?: number | null,
): RunOutcome {
  if (receipt.outcome && RUN_OUTCOMES.includes(receipt.outcome)) return receipt.outcome;
  if (receipt.table_cleared ?? receipt.ran_the_table) return "table_cleared";
  if (typeof actsTotal !== "number" || actsTotal <= 0) return "ended_in_act";
  return receipt.battles.some((b) => b.act === actsTotal)
    ? "ended_at_final_boss"
    : "ended_in_act";
}

/**
 * The verdict stamp: `TABLE CLEARED`, `RUN ENDED AT THE FINAL BOSS`, or
 * `RUN ENDED IN ACT {n}`.
 *
 * The engine's own `verdict` string is used verbatim once it also sends an
 * `outcome` — that is the §2.2 contract, and the engine is the one that knows
 * `{n}`. A receipt with no `outcome` is a v1 receipt whose verdict may be the
 * retired `"RUN COMPLETE"`, so the string is re-derived rather than reprinted.
 */
export function runVerdict(
  receipt: Pick<
    RunReceipt,
    "verdict" | "outcome" | "ran_the_table" | "table_cleared" | "battles"
  >,
  actsTotal?: number | null,
): string {
  const outcome = runOutcome(receipt, actsTotal);
  if (receipt.outcome && receipt.verdict && receipt.verdict.trim()) {
    return receipt.verdict.trim();
  }
  if (outcome === "ended_in_act") {
    return `${RUN_OUTCOME_VERDICTS.ended_in_act} ${endedInAct(receipt)}`;
  }
  return RUN_OUTCOME_VERDICTS[outcome];
}

/** The stamp colour. A near-miss at the final boss is neither a win nor the
 *  same thing as running out of lives in act 2, so it gets its own tone. */
export function outcomeColorVar(outcome: RunOutcome): string {
  switch (outcome) {
    case "table_cleared":
      return "var(--correct)";
    case "ended_at_final_boss":
      return "var(--peak-accent)";
    default:
      return "var(--incorrect)";
  }
}

// ---------------------------------------------------------------------------
// Share text
// ---------------------------------------------------------------------------

export const RUN_SHARE_URL = "peak3.app/arena/run-the-table";

/**
 * The copyable run summary.
 *
 * Says only what the receipt proves: the verdict, the record, the roster the
 * player finished with, the run MVP and the seed. No rank and no percentile —
 * there is no global RUN THE TABLE leaderboard, so either would be a number
 * the sharer cannot themselves see.
 */
export function buildRunShareText(receipt: RunReceipt, url = RUN_SHARE_URL): string {
  // `runVerdict`, not `receipt.verdict`: a v1 receipt can still carry the
  // retired "RUN COMPLETE", and a shared 0-for-3 run must not read as a win.
  const lines: string[] = ["PEAK3 — RUN THE TABLE", runVerdict(receipt), receipt.headline];
  lines.push(`Record: ${receipt.record} · ${receipt.lives_remaining} lives left`);
  if (receipt.systems.length > 0) {
    lines.push(`Systems: ${receipt.systems.map((s) => s.name).join(" + ")}`);
  }
  if (receipt.run_mvp) {
    lines.push(
      `Run MVP: ${receipt.run_mvp.player_name} ${receipt.run_mvp.anchor_season} (${formatSigned(
        receipt.run_mvp.marginal_contribution,
      )} roster total)`,
    );
  }
  if (receipt.best_acquisition) {
    lines.push(
      `Best buy: ${receipt.best_acquisition.player_name} for ${receipt.best_acquisition.cost} credits`,
    );
  }
  lines.push(`Credits: ${receipt.credits_spent} spent, ${receipt.credits_remaining} left`);
  lines.push(`Seed ${receipt.seed}`);
  lines.push(url);
  return lines.join("\n");
}

/**
 * `${origin}/arena/run-the-table?c=${token}` — the canonical RUN THE TABLE
 * challenge link. Falls back to a relative path during SSR, where there is no
 * origin.
 *
 * NOT `/c/${token}`. That route is Peak Draft's challenge page: it resolves the
 * token through `/api/v1/draft/challenges/{token}/meta`, which cannot recognise
 * a RUN THE TABLE token, so every link built that way showed the recipient a
 * not-found screen. `/arena/run-the-table` reads its token from `?c=` and the
 * API's `public_url_path` returns exactly this same shape.
 *
 * `encodeURIComponent` is belt-and-braces: the token is base64url plus a "."
 * separator, all of which are unreserved, so this is a no-op today and stays
 * correct if the token format ever changes.
 */
export const CHALLENGE_PATH = "/arena/run-the-table";

export function challengeUrl(token: string, origin?: string): string {
  const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  const path = `${CHALLENGE_PATH}?c=${encodeURIComponent(token)}`;
  return base ? `${base}${path}` : path;
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/**
 * RUN THE TABLE's own analytics events.
 *
 * Declared HERE rather than in `lib/analytics.ts` so this feature owns its own
 * event vocabulary. `ExtendedAnalyticsEvent` is the union a future consumer
 * should type against; `trackRunTheTable` is the only place the widening cast
 * lives, and it is a cast purely because `AnalyticsEvent` is a closed union in
 * a file this feature does not own.
 *
 * DO NOT include: raw tokens, future offers, or anything the player has not
 * already been shown. `seed` is deliberately included — it is public by
 * design (see nba_peak/run_the_table/daily.py) and is what makes a run
 * reproducible.
 */
export type RunTheTableAnalyticsEvent =
  | { type: "rtt_run_started"; run_type: RunType; seed: number }
  | { type: "rtt_run_resumed"; run_type: RunType; status: RunStatus }
  | { type: "rtt_system_selected"; system_id: string }
  | { type: "rtt_node_chosen"; node_type: NodeType; act: number; stage: number }
  | { type: "rtt_offer_viewed"; node_type: NodeType; offer_count: number }
  | { type: "rtt_acquisition"; cost: number; veteran_minimum: boolean; act: number }
  | { type: "rtt_offer_passed"; node_type: NodeType; act: number }
  | { type: "rtt_trade"; net_cost: number; act: number }
  | { type: "rtt_boss_started"; act: number; boss_id: string }
  | { type: "rtt_boss_completed"; act: number; boss_id: string; outcome: string }
  | { type: "rtt_run_completed"; record: string; ran_the_table: boolean }
  | { type: "rtt_run_failed"; record: string; act: number }
  | { type: "rtt_shared"; surface: string }
  | { type: "rtt_challenge_created" }
  | { type: "rtt_run_it_back"; run_type: RunType };

export type ExtendedAnalyticsEvent = AnalyticsEvent | RunTheTableAnalyticsEvent;

export function trackRunTheTable(event: RunTheTableAnalyticsEvent): void {
  // `analytics.track` is typed against the closed `AnalyticsEvent` union in a
  // file this feature must not edit. The cast widens exactly once, here; every
  // call site stays fully typed against RunTheTableAnalyticsEvent.
  analytics.track(event as unknown as AnalyticsEvent);
}
