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
import {
  ActiveNode,
  BattleLanePublic,
  BattlePublic,
  DraftOffer,
  LaneField,
  LaneProfileEntry,
  LaneToken,
  MapAct,
  NodeType,
  ReceiptLaneProfileEntry,
  Role,
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
      updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : "",
    };
  } catch {
    return null;
  }
}

export function saveActiveRun(
  state: Pick<RunPublicState, "run_id" | "seed" | "run_type">,
  now: Date = new Date(),
): void {
  if (typeof window === "undefined") return;
  const payload: StoredActiveRun = {
    schema_version: RUN_THE_TABLE_SCHEMA_VERSION,
    run_id: state.run_id,
    seed: state.seed,
    run_type: state.run_type,
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
// Labels
// ---------------------------------------------------------------------------

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  draft_room: "Draft Room",
  trade_desk: "Trade Desk",
  film_room: "Film Room",
  rest_bank: "Rest / Bank",
};

export const NODE_TYPE_BLURBS: Record<NodeType, string> = {
  draft_room: "Three priced cards. Buy one into a legal slot, or pass.",
  trade_desk: "Swap a card off the roster for one of three incoming, with a refund.",
  film_room: "Scout the offers ahead, or bank credits instead.",
  rest_bank: "Recover a life, or bank credits instead.",
};

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
 * Flattens `state.map` into the vertical 3-act ladder the left rail renders:
 * `STAGES_PER_ACT` stage rows then one boss row, per act.
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
// Roster
// ---------------------------------------------------------------------------

export function filledCount(slots: RosterSlotPublic[]): number {
  return slots.filter((s) => s.card !== null).length;
}

/** Roster pips for the sticky mobile tray: one entry per slot, starters first. */
export function rosterPips(state: Pick<RunPublicState, "starters" | "bench">): {
  slot_id: string;
  filled: boolean;
  is_starter: boolean;
}[] {
  return [...state.starters, ...state.bench].map((s) => ({
    slot_id: s.slot_id,
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

/** One sentence per lane, for the `aria-live` region and the skip-to-end view. */
export function laneSentence(lane: BattleLanePublic): string {
  const winner =
    lane.winner === "player" ? "You win" : lane.winner === "opponent" ? "They win" : "Tied";
  return `${lane.label}: ${lane.player_score.toFixed(1)} to ${lane.opponent_score.toFixed(
    1,
  )}. ${winner}${lane.tie_broken_by_rule ? " (boss rule broke the tie)" : ""}.`;
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

/** The colour a signed delta should read in. Neutral at exactly zero — a "0"
 *  painted green would claim a gain that did not happen. */
export function signedColorVar(value: number): string {
  if (value > 0) return "var(--correct)";
  if (value < 0) return "var(--incorrect)";
  return "var(--text-muted)";
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
  const lines: string[] = ["PEAK3 — RUN THE TABLE", receipt.headline];
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
