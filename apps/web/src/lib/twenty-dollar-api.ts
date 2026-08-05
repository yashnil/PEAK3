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
  anchor_season: string;
  price: number;
  /** From the LIVE global assignment, recomputed across the whole roster --
   *  not the slot that happened to motivate the purchase. A multi-position
   *  player moves as later purchases arrive. */
  slot: string | null;
  /** Revealed the moment the lot sells, so a rostered player always shows the
   *  number they were bought on. */
  prime_score: number;
  autofilled: boolean;
}

/**
 * What every seat may see about a seat.
 *
 * EVERY FIELD HERE IS PUBLIC ON PURPOSE. v1's sealed bidding hid the amount and
 * published only a `locked` boolean; an ascending auction has no secret bid to
 * hide, and an opponent who could not see the standing bid could not answer it.
 * `in_lot` and `lot_bid` are what let the board show who is still in and what
 * they have committed.
 */
export interface SeatPublic {
  seat_index: number;
  budget: number;
  filled_slots: number;
  roster_full: boolean;
  /** False once this seat has passed out of the current lot. */
  in_lot: boolean;
  /** The highest amount this seat has bid on the current lot. */
  lot_bid: number;
  roster: RosterEntry[];
  assignment: Record<string, string>;
  open_slots: string[];
  /** PUBLIC FOR BOTH SEATS. Whether your opponent can still afford to wait you
   * out is a real strategic fact; hiding it would make the rule invisible
   * rather than tactical. */
  market_skips: number;
}

/** One action inside a live or settled lot. */
export interface LotAction {
  seat_index: number;
  action: "bid" | "pass";
  amount: number;
  timed_out?: boolean;
  /** Did this pass spend a market skip? Recorded on the action so a receipt
   * can say which passes cost something rather than inferring it from a
   * counter that has since changed. */
  consumed_skip?: boolean;
}

/** A lot that has already resolved. Everything is revealed at this point --
 *  the amounts and the card ARE the result. */
export interface ResolvedLot {
  lot_index: number;
  /** The same number under its pre-rename name, so a surface reading either
   *  spelling renders. Published twice, never recomputed. */
  round_index: number;
  candidate: CandidateRevealed;
  candidate_tier: string | null;
  opening_seat: number;
  /** The highest amount each seat committed on this lot. */
  bids: number[];
  timed_out: boolean[];
  winner_seat: number | null;
  price: number;
  decided_by: "bid" | "pass_out" | "unsold" | "autofill" | null;
  actions: LotAction[];
  slot_options?: string[];
  autofill_reason?: string;
}

/** @deprecated The v1 spelling. Kept as an alias while call sites migrate. */
export type ResolvedRound = ResolvedLot;

export interface TwentyDollarPublicState {
  ruleset_version: string;
  model_version: string;
  phase: "auction" | "complete";
  lot_index: number;
  max_lots: number;
  /** Where the STANDARD market ends. Past it the board is in closeout. */
  standard_market_lots: number;
  /** "standard" | "closeout". Named rather than inferred from `lot_index`,
   * because the surface has to say which one it is in. */
  market_phase: "standard" | "closeout";
  /** The published per-seat allowance, so the UI states the rule rather than
   * only its consequence. */
  market_skips_per_seat: number;
  round_index: number;
  max_rounds: number;
  seats: SeatPublic[];
  slots: string[];
  autofilled: boolean;
  /** Who opens the CURRENT lot. Alternates after every lot, resolved or not. */
  opening_seat: number;
  next_opening_seat: number;
  /** Whose turn it is to act, or null between lots and once complete. */
  active_seat: number | null;
  high_bidder: number | null;
  current_bid: number;
  /** The smallest amount the active seat may legally name right now. */
  minimum_bid: number;
  lot_actions: LotAction[];
  candidate: CandidatePublic | null;
  qualified_pool_size: number;
  history: ResolvedLot[];
  seat_names?: string[];
  seat_is_bot?: boolean[];
  /** Present only once the match completes. */
  receipt?: Record<string, unknown>;
}

/**
 * Why the bid control is unavailable, as a machine-readable reason.
 *
 * The UI turns this into a sentence. A disabled control with no explanation
 * beside it reads as broken rather than as a rule, which the brief calls out as
 * a defect in its own right.
 */
export type BidBlockedReason =
  | "match_complete"
  | "no_candidate"
  | "roster_full"
  | "passed_out"
  | "not_your_turn"
  | "insufficient_reserve"
  | "position_infeasible";

/** What THIS seat may additionally see. All convenience derivations -- an
 *  ascending auction has no per-seat secret. */
export interface TwentyDollarPrivateState {
  seat_index: number;
  is_your_turn: boolean;
  max_bid: number;
  minimum_bid: number;
  reserve_floor: number;
  your_lot_bid: number;
  in_lot: boolean;
  candidate_fits: string[];
  can_acquire_candidate: boolean;
  bid_blocked_reason: BidBlockedReason | null;
  /** How many voluntary skips this seat has left. */
  market_skips: number;
  /** Would passing RIGHT NOW spend one? Published so the control can warn
   * before the click instead of reporting the charge afterwards, and so an
   * ordinary concession (free) is visibly different from a real skip. */
  pass_consumes_skip: boolean;
  /** False in exactly one situation: the pass would cost a skip and there are
   * none left, so the only legal move is to open at the minimum. */
  can_pass: boolean;
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
 * Reads only published fields. There is no hidden bid to be careful about in an
 * ascending auction; what this must not do is imply the user can act when the
 * server says otherwise, so it keys on `active_seat` rather than on anything
 * the client inferred.
 */
export function waitingLabel(
  publicState: TwentyDollarPublicState,
  yourSeat: number | null,
  seatNames: string[] = [],
): string {
  if (publicState.phase === "complete") return "Auction complete.";
  const active = publicState.active_seat;
  if (active === null) return "Settling the lot…";
  if (active === yourSeat) {
    return publicState.current_bid > 0 ? "Your move — raise or pass." : "Your move — open or pass.";
  }
  return `Waiting for ${seatNames[active] ?? "the other seat"}…`;
}

/** How the standing bid reads, for the header line. */
export function standingBidLabel(
  publicState: TwentyDollarPublicState,
  yourSeat: number | null,
  seatNames: string[] = [],
): string {
  if (publicState.current_bid <= 0) return "No bid yet";
  const holder = publicState.high_bidder;
  const who = holder === yourSeat ? "you" : (seatNames[holder ?? -1] ?? "the other seat");
  return `${formatDollars(publicState.current_bid)} — ${who}`;
}

/**
 * The sentence beside a disabled bid control.
 *
 * EVERY REASON GETS WORDS. `null` means the control is live; anything else must
 * render, because "never silently skip the user" is a requirement rather than a
 * nicety.
 */
export function bidBlockedLabel(
  reason: BidBlockedReason | null,
  seatNames: string[] = [],
  activeSeat: number | null = null,
): string | null {
  switch (reason) {
    case null:
      return null;
    case "not_your_turn":
      return `It is ${seatNames[activeSeat ?? -1] ?? "the other seat"}'s turn.`;
    case "insufficient_reserve":
      return "Not enough left: every slot you still have to fill must keep $1 behind it.";
    case "position_infeasible":
      return "You could not field a legal starting five if you won this player.";
    case "roster_full":
      return "Your roster is complete.";
    case "passed_out":
      return "You passed on this player.";
    case "match_complete":
      return "The auction is over.";
    case "no_candidate":
      return "Waiting for the next player to come up.";
    default:
      return "That move is not available right now.";
  }
}

/** Slot order for display. The server publishes it; this is the fallback. */
export const SLOT_ORDER = ["PG", "SG", "SF", "PF", "C"] as const;
