/**
 * API client for Head-to-Head RUN THE TABLE.
 *
 * Two credentials are in play here and they are not interchangeable:
 *
 * * A BEARER TOKEN for everything that identifies an account. Head-to-head is
 *   account-backed by design (spec §6: "an authenticated user creates"), and
 *   the API answers 401 without one. `lib/ranked-api.ts` makes the same call
 *   for the same reason.
 * * `credentials: "include"` as well, because the RUN THE TABLE routes these
 *   flows hand off to are anonymous-first and read the `peak3_anon` cookie.
 *   Sending both costs nothing and means a caller never has to know which of
 *   the two a given route will use.
 *
 * This module NEVER computes a PEAK3 score, a winner, a tie-break or a credit
 * efficiency. Every one of those is decided by the server -- see
 * `apps/api/app/services/head_to_head.py`, which is the single place the
 * winner order exists. What is rendered here is what the server sent.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export class HeadToHeadAPIError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "HeadToHeadAPIError";
    this.status = status;
    this.code = code;
  }
}

/** FastAPI sends `detail` as either a plain string or `{error_code, message}`. */
function parseErrorDetail(detail: unknown, status: number): { message: string; code?: string } {
  if (typeof detail === "string") return { message: detail };
  if (detail && typeof detail === "object") {
    const d = detail as { error_code?: string; message?: string };
    return { message: d.message || `HTTP ${status}`, code: d.error_code };
  }
  return { message: `HTTP ${status}` };
}

async function h2hFetch<T>(
  path: string,
  token: string | null,
  init: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1${path}`, {
      credentials: "include",
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
    });
  } catch {
    // A network-level failure is not an HTTP status. Status 0 lets a caller
    // tell "the API is not running" apart from "the API said no".
    throw new HeadToHeadAPIError(0, "Could not reach the PEAK3 API.", "network_unavailable");
  }
  const json = await res.json().catch(() => ({ detail: "Unknown error" }));
  if (!res.ok) {
    const { message, code } = parseErrorDetail((json as { detail?: unknown }).detail, res.status);
    throw new HeadToHeadAPIError(res.status, message, code);
  }
  return json as T;
}

// ---------------------------------------------------------------------------
// Types — the consumer-side declaration of the API's payloads.
// ---------------------------------------------------------------------------

export interface WinnerOrderLevel {
  position: number;
  level: string;
  label: string;
  higher_wins: boolean;
}

export interface HeadToHeadRules {
  rules_version: string;
  winner_order: WinnerOrderLevel[];
  credit_efficiency_rule: {
    id: string;
    formula: string;
    higher_is_better: boolean;
    rounding_decimals: number;
    includes: string[];
    excludes: string[];
    zero_spend: string;
  };
  active_play_time: {
    definition: string;
    min_margin_seconds: number;
    excludes: string[];
    note: string;
  };
  fairness: {
    pinned_at_creation: string[];
    rechecked_at: string[];
    randomness: string;
  };
  daily_attempts: string;
}

/** The result metrics for one side. `run_id` is present only for your own. */
export interface ComparisonResult {
  table_cleared: boolean;
  bosses_defeated: number;
  final_act_reached: number;
  lives_remaining: number;
  lane_differential: number;
  roster_peak3_total: number;
  credits_spent: number;
  credits_refunded: number;
  net_credits_committed: number;
  credit_efficiency: number;
  active_play_seconds: number;
  outcome: string;
  run_id?: string | null;
  completed_at?: string | null;
}

export interface SettlementLevel {
  level: string;
  label: string;
  higher_wins: boolean;
  creator: number | boolean;
  opponent: number | boolean;
  verdict: "creator" | "opponent" | "tied" | "not_consulted" | "tied_within_margin";
  margin_seconds?: number;
}

export interface Settlement {
  winner: "creator" | "opponent" | "draw";
  decided_by: string | null;
  levels: SettlementLevel[];
  rules_version: string;
  credit_efficiency_rule: string;
}

export interface ParticipantView {
  role: "creator" | "opponent";
  display_name: string;
  status: string;
  run_id?: string | null;
  result?: ComparisonResult | null;
}

export interface HeadToHeadMatchView {
  match_id: string;
  status: "open" | "in_progress" | "complete";
  seed: number;
  versions: Record<string, string>;
  created_at: string;
  expires_at: string;
  expired: boolean;
  rematch_of?: string | null;
  you: ParticipantView;
  opponent?: ParticipantView | null;
  /** `"hidden"` until both sides have submitted. Never a partial spoiler. */
  opponent_status: string;
  both_complete: boolean;
  settlement?: Settlement | null;
}

export interface InviteDescriptor {
  match_id?: string | null;
  creator_display_name: string;
  status: string;
  playable: boolean;
  ruleset_version: string;
  versions: Record<string, string>;
  expires_at: string;
  expired: boolean;
  your_role?: string | null;
  seats_taken: number;
}

export interface HeadToHeadCreated {
  match_id: string;
  invite_token: string;
  invite_url_path: string;
  expires_at: string;
  seed: number;
  versions: Record<string, string>;
  fairness: Record<string, unknown>;
}

export interface HeadToHeadReceipt {
  match_id: string;
  seed: number;
  versions: Record<string, string>;
  creator: { role: string; display_name: string; result: ComparisonResult | null };
  opponent: { role: string; display_name: string; result: ComparisonResult | null };
  settlement: Settlement;
  your_role: "creator" | "opponent";
  your_outcome: "won" | "lost" | "draw";
}

export interface HeadToHeadHistoryEntry {
  match_id: string;
  status: string;
  created_at: string;
  your_role: "creator" | "opponent";
  opponent_display_name?: string | null;
  /** `null` until the match settles — history is spoiler-safe too. */
  your_outcome?: "won" | "lost" | "draw" | null;
  decided_by?: string | null;
}

const BASE = "/run-the-table/h2h";

export const headToHeadApi = {
  /** The published winner order. No account needed — it is a rules document. */
  getRules: () => h2hFetch<HeadToHeadRules>(`${BASE}/rules`, null),

  /** Mint a head-to-head from a run you own. */
  create: (runId: string, token: string) =>
    h2hFetch<HeadToHeadCreated>(`${BASE}`, token, {
      method: "POST",
      body: JSON.stringify({ run_id: runId }),
    }),

  /** The spoiler-safe invite landing payload. Readable without an account. */
  getInvite: (inviteToken: string) =>
    h2hFetch<InviteDescriptor>(
      `${BASE}/invite/${encodeURIComponent(inviteToken)}`,
      null,
      { cache: "no-store" } as RequestInit,
    ),

  /** Seat yourself as the opponent and receive your own run on the same board. */
  accept: (inviteToken: string, token: string) =>
    h2hFetch<HeadToHeadMatchView>(
      `${BASE}/invite/${encodeURIComponent(inviteToken)}/accept`,
      token,
      { method: "POST", body: JSON.stringify({}) },
    ),

  getMatch: (matchId: string, token: string) =>
    h2hFetch<HeadToHeadMatchView>(`${BASE}/${encodeURIComponent(matchId)}`, token, {
      cache: "no-store",
    } as RequestInit),

  /**
   * Submit YOUR finished run. The body is empty on purpose: the server reads
   * which run is yours from its own record and recomputes every metric from
   * that run's receipt. There is nothing here for a client to assert.
   */
  submitResult: (matchId: string, token: string) =>
    h2hFetch<HeadToHeadMatchView>(
      `${BASE}/${encodeURIComponent(matchId)}/result`,
      token,
      { method: "POST", body: JSON.stringify({}) },
    ),

  getReceipt: (matchId: string, token: string) =>
    h2hFetch<HeadToHeadReceipt>(
      `${BASE}/${encodeURIComponent(matchId)}/receipt`,
      token,
      { cache: "no-store" } as RequestInit,
    ),

  rematch: (matchId: string, token: string) =>
    h2hFetch<HeadToHeadCreated>(
      `${BASE}/${encodeURIComponent(matchId)}/rematch`,
      token,
      { method: "POST", body: JSON.stringify({}) },
    ),

  getHistory: (token: string) =>
    h2hFetch<{ matches: HeadToHeadHistoryEntry[] }>(`${BASE}/history`, token, {
      cache: "no-store",
    } as RequestInit),
};

// ---------------------------------------------------------------------------
// Presentation helpers — formatting only, never a rule.
// ---------------------------------------------------------------------------

/** `/arena/run-the-table/h2h/invite/{token}`, absolute for sharing. */
export function inviteUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

export function formatActivePlayTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(s / 60);
  const rest = s % 60;
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
}

/**
 * How a level's value should read. Booleans become Yes/No; the two float
 * levels are shown at the precision the server compares them at, so a reader
 * can check the verdict rather than take it on trust.
 */
export function formatLevelValue(level: string, value: number | boolean): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (level === "active_play_time") return formatActivePlayTime(value);
  if (level === "credit_efficiency") return value.toFixed(3);
  if (level === "roster_peak3_total") return value.toFixed(1);
  if (level === "lane_differential") return value > 0 ? `+${value}` : `${value}`;
  return `${value}`;
}
