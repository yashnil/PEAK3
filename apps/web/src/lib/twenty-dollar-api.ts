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

/**
 * The decision window, mirroring `nba_peak/twenty_dollar/config.py::TURN_SECONDS`.
 *
 * Declared here rather than typed into a prop, because it was typed into a
 * prop: the room passed `totalSeconds={20}` to `ArenaTimer` while the server
 * gave 25, so the progress arc sat pinned at full for the first five seconds
 * of every single turn and then fell off a cliff. One constant, one place.
 */
export const TURN_SECONDS = 25;

/**
 * The grace window the server allows past a deadline, mirroring
 * `apps/api/app/services/arena/clock.py::ACTION_GRACE_SECONDS`.
 *
 * `apps/api/tests/test_arena_action_races.py` asserts an action up to 1900 ms
 * late is still ACCEPTED. The client must therefore not paint "time expired"
 * over an action it has already sent — see `useShowdownPhase`.
 */
export const ACTION_GRACE_SECONDS = 2;

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
  /**
   * This player's photograph, from the committed asset manifest.
   *
   * IDENTITY, NOT VALUATION — which is the only reason it is allowed on a LIVE
   * lot at all. It says who is on the block, exactly as `player_name` does; it
   * carries no score, no rank and no component.
   *
   * Null for most identities and for every identity when the API's
   * `PEAK3_ENABLE_EXTERNAL_ASSET_URLS` gate is off, which is the shipped
   * default. `PlayerAvatar` draws its medallion in the same reserved box, so
   * null costs no layout. @see `components/court/PlayerAvatar`.
   */
  headshot_url?: string | null;
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
  /** @see `CandidatePublic.headshot_url`. Null for most identities and for all
   *  of them with the API's default flag posture. */
  headshot_url?: string | null;
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
  /**
   * WHICH of the three declines passing right now would be.
   *
   * `nba_peak/twenty_dollar/state.py::pass_kind`. The three have genuinely
   * different consequences and used to share one word ("skip") plus a
   * punctuation mark ("Pass — free") doing the explaining. The control now
   * NAMES the action it is about to take; the count is a first-class number on
   * the seat card rather than a suffix on a button.
   *
   * Optional only so a client rendered against an older projection still
   * type-checks; `passKind()` falls back to `pass_consumes_skip`.
   */
  pass_kind?: PassKind;
  /** Has either seat already declined this UNOPENED lot? When true a decline
   * is a free follow rather than a market skip. */
  lot_already_rejected?: boolean;
  /** False in exactly one situation: the pass would cost a skip and there are
   * none left, so the only legal move is to open at the minimum. */
  can_pass: boolean;
  /**
   * WHAT THE CLOCK WILL DO IF IT REACHES ZERO, computed server-side from the
   * live lot. The four outcomes have genuinely different costs, and a countdown
   * that does not say which is coming is a countdown a player cannot act on
   * (PART 16). @see `nba_peak/twenty_dollar/state.py::timeout_outcome`.
   */
  timeout_outcome: TimeoutOutcome;
}

export type TimeoutOutcome = "skip_used" | "auto_open" | "free_pass" | "conceded";

/**
 * The three ways a seat can decline, named.
 *
 *   * `market_skip`  — first rejection of an UNOPENED lot. Costs one token.
 *   * `follow_pass`  — the other seat already rejected it, so the player is
 *                      gone either way. Free.
 *   * `auction_pass` — conceding a live auction. Free.
 *
 * @see `nba_peak/twenty_dollar/state.py::pass_kind`
 */
export type PassKind = "market_skip" | "follow_pass" | "auction_pass";

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
  /** True when this key had already been recorded and NOTHING was applied. */
  replayed: boolean;
  rejection_code?: string | null;
  /**
   * THE FIELD IS `message`, AND THAT IS THE WHOLE POINT OF THIS COMMENT.
   *
   * `apps/api/app/models/arena.py::SubmitCommandResponse` declares
   * `{accepted, replayed, rejection_code, message, match}` and
   * `arena.py::submit_command` fills it with `outcome.rejection_message`. This
   * interface used to declare the field as `rejection_message`, so
   * `result.rejection_message` was ALWAYS `undefined` and the game room's
   * `|| "That move was not accepted."` fallback fired on every single
   * rejection — including the reported Curry bid, where the server had
   * actually said "This match has moved on (you sent version 1, it is now 2)".
   *
   * A field that does not exist is not a type error in TypeScript when it is
   * declared optional, which is why this went unnoticed. `explainRejection`
   * consumes it, and `tests/unit/arena-rejection.test.ts` asserts against the
   * real API model's field name.
   */
  message?: string | null;
  match: TwentyDollarMatchView;
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

/**
 * A stable idempotency key for one INTENDED action.
 *
 * WHY THIS REPLACED A RANDOM UUID, and it is the highest-severity defect this
 * pass fixed. The room used to mint `newIdempotencyKey()` once, hold it in a
 * ref, and clear it only on the SUCCESS path — the `catch` left it set. So
 * after a dropped response the next click of ANY kind reused the key and the
 * server replayed the recorded verdict for a completely different intent. If
 * the lost request had been REJECTED, the retry came back `replayed: true`,
 * the room's `if (!accepted && !replayed)` guard swallowed the banner, and the
 * corrected bid was never sent: a silent no-op under a running clock.
 *
 * Deriving the key from what the action IS makes a retry of the SAME action a
 * replay and a genuinely different action a different key, with no lifecycle
 * to get wrong. Identical in shape to `arena-api.ts::commandIdempotencyKey`,
 * which is what Three-Man Weave has always used; it is duplicated rather than
 * imported so the two Arena modes cannot be coupled through a helper that one
 * of them is free to change.
 *
 * The server's minimum length is 8, which the match id alone clears.
 */
export function showdownIdempotencyKey(
  matchId: string,
  seatIndex: number | null,
  stateVersion: number,
  commandType: string,
  payload: Record<string, unknown>,
): string {
  const shape = Object.keys(payload)
    .sort()
    .map((key) => `${key}=${String(payload[key])}`)
    .join("&");
  return `${matchId}:${seatIndex ?? "x"}:${stateVersion}:${commandType}:${shape}`.slice(
    0,
    128,
  );
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

/**
 * Which decline this seat's Pass control would actually perform.
 *
 * Reads the server's `pass_kind` when it is present and falls back to the
 * older `pass_consumes_skip` boolean when it is not, so a client rendered
 * against a projection from before that field existed still names two of the
 * three cases correctly instead of guessing all three.
 */
export function passKind(privateState: TwentyDollarPrivateState): PassKind {
  if (privateState.pass_kind) return privateState.pass_kind;
  return privateState.pass_consumes_skip ? "market_skip" : "auction_pass";
}

/**
 * The LABEL on the decline control — the action it will take, by name.
 *
 * PART S20-06: "Do not append '—free' to Pass. The UI should explain the
 * distinction through state, not punctuation." So the free cases are simply
 * called what they are, and the expensive one says it spends a token without
 * carrying the running count (that is a first-class number on the seat card).
 */
export function passActionLabel(privateState: TwentyDollarPrivateState): string {
  switch (passKind(privateState)) {
    case "market_skip":
      return "Market skip";
    case "follow_pass":
      return "Pass on this lot";
    case "auction_pass":
    default:
      return "Concede the lot";
  }
}

/** One line saying what the decline costs, for the control's supporting copy. */
export function passActionCost(
  privateState: TwentyDollarPrivateState,
  publicState: TwentyDollarPublicState,
): string {
  switch (passKind(privateState)) {
    case "market_skip":
      return `Takes this player off the board and spends 1 of your ${publicState.market_skips_per_seat} market skips.`;
    case "follow_pass":
      return "The other seat has already declined this lot, so this costs you no market skip.";
    case "auction_pass":
    default:
      return "Conceding a live auction costs no market skip.";
  }
}

/**
 * THE LAST MEANINGFUL ACTION on the live lot, as one short sentence.
 *
 * S20-04 puts this fourth in the hierarchy, under the current bid and the
 * leader. It replaces the row of micro-chips (`You $1 · PEAK3 Bot $2 · …`)
 * that used to carry the whole history at 11 px.
 */
export function lastActionLabel(
  publicState: TwentyDollarPublicState,
  yourSeat: number | null,
  seatNames: string[] = [],
): string | null {
  const actions = publicState.lot_actions;
  if (!actions || actions.length === 0) return null;
  const last = actions[actions.length - 1];
  const who = last.seat_index === yourSeat ? "You" : (seatNames[last.seat_index] ?? "Opponent");
  if (last.action === "bid") {
    const previous = actions
      .slice(0, -1)
      .filter((action) => action.action === "bid")
      .pop();
    const raise = previous ? last.amount - previous.amount : 0;
    return previous
      ? `${who} raised to ${formatDollars(last.amount)} (+${formatDollars(raise)})`
      : `${who} opened at ${formatDollars(last.amount)}`;
  }
  if (last.timed_out) return `${who} ran out of time`;
  if (last.consumed_skip) return `${who} used a market skip`;
  return `${who} passed`;
}

/**
 * What expiry will cost this seat, in words, BEFORE the clock reaches zero.
 *
 * PART 16 requires the timer to state its consequence, and the four outcomes
 * are genuinely different: a market skip is spent, an automatic opening bid is
 * placed, a free pass is taken, or a live auction is conceded. A player shown
 * the wrong one has been warned about the wrong thing.
 *
 * Reads `timeout_outcome`, which the server computes from the live lot — never
 * re-derived here, because a second copy of the rule is a second thing that can
 * disagree with the first.
 */
export function timeoutConsequence(
  privateState: TwentyDollarPrivateState,
  seatNames: string[] = [],
  publicState?: TwentyDollarPublicState,
): string {
  switch (privateState.timeout_outcome) {
    case "skip_used": {
      const left = Math.max(0, privateState.market_skips - 1);
      return `Timeout uses 1 market skip — ${left} would remain.`;
    }
    case "auto_open":
      return `Timeout opens automatically at ${formatDollars(privateState.minimum_bid)} — you have no skips left.`;
    case "conceded": {
      const holder = publicState?.high_bidder ?? null;
      const who =
        holder === null || holder === privateState.seat_index
          ? "the other seat"
          : (seatNames[holder] ?? "the other seat");
      return `Timeout concedes this auction to ${who}. No skip is used.`;
    }
    case "free_pass":
    default:
      return "Timeout passes for free — this player cannot fit your roster.";
  }
}
