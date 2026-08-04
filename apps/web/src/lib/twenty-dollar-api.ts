/**
 * API client for The $20 Showdown.
 *
 * Modelled on `lib/head-to-head-api.ts`, including the two conventions that
 * file establishes and that are easy to get wrong:
 *
 *  * AUTH IS ATTACHED CENTRALLY, inside the fetch wrapper, never per call. A
 *    per-call header is a header some future call forgets, and this mode is
 *    account-backed -- the API answers 401 without a bearer token.
 *  * STATUS 0 MEANS THE NETWORK FAILED, not that the API said no. A caller
 *    needs to tell "the API is not running" apart from "the API rejected
 *    this", and an HTTP status cannot express the former.
 *
 * THIS MODULE COMPUTES NOTHING. No PEAK3 score, no winner, no legal bid
 * maximum, no roster legality. Every one of those is decided by the server
 * (`nba_peak/twenty_dollar/`), and what is rendered here is what the server
 * sent. `private_state.max_bid` is the server's number; the input's clamp is a
 * courtesy so a player is not told "rejected" for something the UI could have
 * shown, and it is NOT the enforcement -- the reducer re-checks it.
 *
 * WHAT IS DELIBERATELY NOT IN ANY TYPE HERE: the opponent's bid amount. The
 * server's projection never sends it, so there is no field to declare. If one
 * ever appears in a payload, `SeatPublic` will not have a home for it and the
 * leak test in `tests/unit/twenty-dollar.test.tsx` will fail on the value.
 */

import { getAccessToken } from "@/lib/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const TWENTY_DOLLAR_MODE = "twenty_dollar";

export class TwentyDollarAPIError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "TwentyDollarAPIError";
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

async function arenaFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Central auth. Every call in this module goes through here, so no call site
  // can forget the header or attach a stale one.
  const token = await getAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1/arena${path}`, {
      credentials: "include",
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
    });
  } catch {
    throw new TwentyDollarAPIError(0, "Could not reach the PEAK3 API.", "network_unavailable");
  }
  const json = await res.json().catch(() => ({ detail: "Unknown error" }));
  if (!res.ok) {
    const { message, code } = parseErrorDetail((json as { detail?: unknown }).detail, res.status);
    throw new TwentyDollarAPIError(res.status, message, code);
  }
  return json as T;
}

// ---------------------------------------------------------------------------
// Types -- the consumer-side declaration of the server's payloads.
// ---------------------------------------------------------------------------

/** A candidate as it appears BEFORE the round resolves: no score, no rank, no
 *  components. Those are the thing being bid on. */
export interface CandidatePublic {
  player_slug: string;
  player_name: string;
  anchor_season: string;
  team: string | null;
  positions: string[];
}

/** A candidate as it appears in a RESOLVED round, with everything revealed. */
export interface CandidateRevealed extends CandidatePublic {
  row_id: string;
  rank: number;
  prime_score: number;
  components: Record<string, number>;
  /** 0-100 per component, normalised SERVER-SIDE against the pool's own
   *  min/max. Rendered straight onto the radar with no client rescaling --
   *  the discipline `LaneProfile.tsx` states for RTT lanes. */
  component_index: Record<string, number>;
  model_version: string;
}

export interface RosterEntry {
  player_slug: string;
  player_name: string;
  price: number;
  /** From the LIVE global assignment, recomputed across the whole roster --
   *  not the slot that happened to motivate the purchase. A multi-position
   *  player moves as later purchases arrive. */
  slot: string | null;
  autofilled: boolean;
}

/** What every seat may see about a seat. Note the absence of a bid amount:
 *  `locked` says THAT they acted, never what they bid. */
export interface SeatPublic {
  seat_index: number;
  budget: number;
  filled_slots: number;
  roster_full: boolean;
  locked: boolean;
  roster: RosterEntry[];
  assignment: Record<string, string>;
  open_slots: string[];
}

export interface ResolvedRound {
  round_index: number;
  candidate: CandidateRevealed;
  bids: number[];
  timed_out: boolean[];
  winner_seat: number | null;
  price: number;
  decided_by: string | null;
  levels: Array<Record<string, unknown>>;
  tie_priority_seat: number;
  tie_priority_used: boolean;
  slot_options?: string[];
  autofill_reason?: string;
}

export interface TwentyDollarPublicState {
  ruleset_version: string;
  model_version: string;
  phase: "bidding" | "complete";
  round_index: number;
  max_rounds: number;
  tie_priority_seat: number;
  seats: SeatPublic[];
  slots: string[];
  autofilled: boolean;
  candidate: CandidatePublic | null;
  history: ResolvedRound[];
  seat_names?: string[];
}

/** What THIS seat may additionally see. `your_bid` is the only bid amount that
 *  ever crosses the wire to a client, and only to its owner. */
export interface TwentyDollarPrivateState {
  seat_index: number;
  your_bid: number | null;
  your_locked: boolean;
  max_bid: number;
  reserve_floor: number;
  holds_tie_priority: boolean;
  candidate_fits: string[];
  can_acquire_candidate: boolean;
}

export interface ArenaSeatMeta {
  seat_index: number;
  display_name: string;
  is_bot: boolean;
  status: string;
  bot_rating: number | null;
}

export interface TwentyDollarMatchView {
  match_id: string;
  mode: string;
  mode_version: string;
  model_version: string;
  status: string;
  state_version: number;
  seat_count: number;
  entry_path: string;
  rated: boolean;
  your_seat_index: number | null;
  seats: ArenaSeatMeta[];
  public_state: TwentyDollarPublicState;
  private_state: TwentyDollarPrivateState;
  legal_commands: string[];
  current_turn_seat_index: number | null;
  seconds_remaining: number | null;
  latest_event_seq: number;
  room_code: string | null;
}

export interface SubmitCommandResult {
  accepted: boolean;
  replayed: boolean;
  rejection_code?: string | null;
  rejection_message?: string | null;
  match: TwentyDollarMatchView;
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

/**
 * A fresh idempotency key per user action.
 *
 * The server requires at least 8 characters and uses it to make a retry a
 * replay rather than a second bid. Generated per ACTION, not per request, so a
 * network retry of the same click reuses it -- that is the whole point.
 */
export function newIdempotencyKey(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `td-${random}`.slice(0, 128);
}

export const twentyDollarApi = {
  startPractice(): Promise<TwentyDollarMatchView> {
    return arenaFetch<TwentyDollarMatchView>("/matches/practice", {
      method: "POST",
      body: JSON.stringify({ mode: TWENTY_DOLLAR_MODE }),
    });
  },

  getMatch(matchId: string): Promise<TwentyDollarMatchView> {
    return arenaFetch<TwentyDollarMatchView>(`/matches/${encodeURIComponent(matchId)}`);
  },

  /**
   * Lock a sealed bid, or pass.
   *
   * `expected_state_version` is REQUIRED by the server, and passing the version
   * the UI actually rendered is what makes a stale tab's bid fail loudly
   * instead of landing against a board that has already moved on.
   */
  submitCommand(
    matchId: string,
    commandType: "bid" | "pass",
    payload: Record<string, unknown>,
    expectedStateVersion: number,
    idempotencyKey: string,
  ): Promise<SubmitCommandResult> {
    return arenaFetch<SubmitCommandResult>(
      `/matches/${encodeURIComponent(matchId)}/commands`,
      {
        method: "POST",
        body: JSON.stringify({
          command_type: commandType,
          payload,
          idempotency_key: idempotencyKey,
          expected_state_version: expectedStateVersion,
        }),
      },
    );
  },
};

// ---------------------------------------------------------------------------
// Presentation helpers -- formatting only, never a rule.
// ---------------------------------------------------------------------------

export function formatDollars(amount: number): string {
  return `$${Math.max(0, Math.round(amount))}`;
}

/**
 * Whose action the board is waiting on, as a sentence.
 *
 * Reads `locked` only. It cannot say anything about an amount because it is
 * never given one.
 */
export function waitingLabel(
  publicState: TwentyDollarPublicState,
  yourSeat: number | null,
): string {
  if (publicState.phase === "complete") return "Auction complete.";
  const seats = publicState.seats;
  const you = seats.find((s) => s.seat_index === yourSeat);
  const others = seats.filter((s) => s.seat_index !== yourSeat);
  const waitingOn = others.filter((s) => !s.locked && !s.roster_full);
  if (you && !you.locked && !you.roster_full) return "Your bid is not in yet.";
  if (waitingOn.length > 0) return "Waiting for the other seat to lock in.";
  return "Revealing…";
}

/** Slot order for display. The server publishes it; this is the fallback. */
export const SLOT_ORDER = ["PG", "SG", "SF", "PF", "C"] as const;
