/**
 * API client for the Daily Grid Challenge (Phase 11A).
 *
 * Deliberately a thin transport layer, mirroring perfect-season-api.ts: the
 * server owns board generation, eligibility and scoring. Nothing here decides
 * whether an answer is valid, and nothing here computes arena_points -- a
 * rejected answer comes back as HTTP 200 with `valid: false` plus the server's
 * own teachable `reason` sentence, which the UI renders verbatim.
 */
import {
  DailyGridBoard,
  DailyGridSearchResponse,
  DailyGridStartResponse,
  GridResultRequest,
  GridResultResponse,
  OfficialResultRequest,
  OfficialResultResponse,
  SubmitAnswerRequest,
  SubmitAnswerResponse,
} from "@/types/daily-grid";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

class DailyGridAPIError extends Error {
  constructor(
    public status: number,
    public detail: string,
    public code?: string,
  ) {
    super(detail);
    this.name = "DailyGridAPIError";
  }
}

function parseErrorDetail(detail: unknown, status: number): { message: string; code?: string } {
  if (typeof detail === "string") return { message: detail };
  if (detail && typeof detail === "object") {
    const d = detail as { error_code?: string; message?: string };
    return { message: d.message || `HTTP ${status}`, code: d.error_code };
  }
  return { message: `HTTP ${status}` };
}

/** What the UI says when the server rate-limits a Daily Grid request.
 *
 *  The server's own 429 body is deliberately vague (see the router's
 *  `_enforce`), so the client supplies the sentence a player needs rather than
 *  rendering "HTTP 429" at them. Exported so tests assert the exact copy the
 *  player sees. */
export const RATE_LIMITED_MESSAGE =
  "You're searching faster than the grid allows. Wait a moment and try again — your board is safe.";

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  // `headers` is merged LAST. It used to sit before `...options`, which
  // re-spread `options.headers` and silently REPLACED the merged object — so
  // any call that added an Authorization header (the official save, the
  // leaderboard read) lost its Content-Type, FastAPI parsed the JSON body as
  // a plain string, and POST /daily-grid/official failed 422 from the app
  // while passing in every API-level test that posted directly.
  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    credentials: "include",
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const json = await res.json().catch(() => ({ detail: "Unknown error" }));
  if (!res.ok) {
    const { message, code } = parseErrorDetail((json as { detail?: unknown }).detail, res.status);
    if (res.status === 429) {
      // A rate limit is a "wait", not a failure: the board, the locked picks
      // and the timer are all untouched, and saying so stops it reading as
      // data loss. Retry-After is intentionally not surfaced -- a countdown
      // to the next allowed request is the calibration signal the server
      // withholds on purpose.
      throw new DailyGridAPIError(429, RATE_LIMITED_MESSAGE, code ?? "rate_limited");
    }
    throw new DailyGridAPIError(res.status, message, code);
  }
  return json as T;
}

/** Today's board (UTC) unless a specific date is asked for. */
export async function getDailyGridBoard(date?: string): Promise<DailyGridBoard> {
  const qs = date ? `?date=${encodeURIComponent(date)}` : "";
  return apiFetch<DailyGridBoard>(`/daily-grid/board${qs}`, { cache: "no-store" } as RequestInit);
}

/**
 * Start (or resume) today's TIMED attempt.
 *
 * The one write that decides when the clock started. Called ONLY from an
 * explicit player action — never on page load, never when the walkthrough
 * opens — because the whole point of the endpoint is that reading the rules
 * and waiting for the network are not charged to the player.
 *
 * IDEMPOTENT SERVER-SIDE: the timestamp is written once, so a double-click, a
 * refresh and a second tab all resolve to the same `started_at`. The client
 * guards concurrency as well (see `DailyGridGame.beginAttempt`), but that
 * guard is a courtesy — the server is the authority.
 *
 * A 409 `not_todays_key` means the caller asked to start a board that is not
 * today's. The caller treats it, like any other failure here, as "keep the
 * local clock": the score is not affected by the timer in any way, so a failed
 * start must never block play.
 */
export async function startDailyGridAttempt(
  dailyKey: string,
  accessToken?: string | null,
): Promise<DailyGridStartResponse> {
  return apiFetch<DailyGridStartResponse>(
    `/daily-grid/${encodeURIComponent(dailyKey)}/start`,
    {
      method: "POST",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    },
  );
}

/**
 * Player-season search. When `row`/`col` are supplied the search is scoped to
 * that square and each hit carries a `status` saying whether it can be played
 * there; unusable hits are still returned on purpose (see the contract in
 * types/daily-grid.ts -- hiding them would leak the answer key by omission).
 *
 * `used` is the identities already on the board. Sending it is what lets the
 * server mark a player the client has already spent, rather than offering them
 * again as if they were playable.
 */
export async function searchPlayerSeasons(params: {
  q: string;
  date?: string;
  row?: number;
  col?: number;
  limit?: number;
  used?: string[];
  signal?: AbortSignal;
}): Promise<DailyGridSearchResponse> {
  const qs = new URLSearchParams({ q: params.q });
  if (params.date) qs.set("date", params.date);
  if (params.row !== undefined) qs.set("row", String(params.row));
  if (params.col !== undefined) qs.set("col", String(params.col));
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  for (const slug of params.used ?? []) qs.append("used", slug);
  return apiFetch<DailyGridSearchResponse>(`/daily-grid/search?${qs.toString()}`, {
    cache: "no-store",
    signal: params.signal,
  } as RequestInit);
}

/** Submit one square. An invalid answer is a normal 200 response, not a throw.
 *
 *  The response carries a score ONLY when the answer was valid, and only via
 *  `cell_score` -- a rejected pick never reveals what it was worth. */
export async function submitDailyGridAnswer(body: SubmitAnswerRequest): Promise<SubmitAnswerResponse> {
  return apiFetch<SubmitAnswerResponse>("/daily-grid/answer", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Fetch the post-completion comparison against today's maximum.
 *
 * Throws (400 `board_incomplete` / `board_not_valid`) unless all nine squares
 * are genuinely locked with valid answers -- the server re-validates every one
 * before releasing anything, because this response contains the answer key.
 * Only call it once `isComplete(progress)`.
 */
export async function getDailyGridResult(body: GridResultRequest): Promise<GridResultResponse> {
  return apiFetch<GridResultResponse>("/daily-grid/result", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Save the completed board as this account's OFFICIAL result for the day.
 *
 * Signed-in only, and additive: an anonymous player's local archive is the
 * whole product for them, and nothing about play is gated on this succeeding.
 * The caller treats a failure as a no-op — the result screen has already shown
 * the real score, and losing the durable copy is not worth an error state in
 * front of a player who just finished a grid.
 *
 * The server recomputes every stored number from the board; the request body
 * carries no score, so there is nothing here for a client to inflate.
 */
export async function saveOfficialDailyGridResult(
  body: OfficialResultRequest,
  accessToken: string,
): Promise<OfficialResultResponse> {
  return apiFetch<OfficialResultResponse>("/daily-grid/official", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export { DailyGridAPIError };

// ---------------------------------------------------------------------------
// Daily leaderboard (final polish pass, A2)
// ---------------------------------------------------------------------------

export interface DailyLeaderboardRow {
  rank: number;
  handle: string;
  score: number;
  /** Server-witnessed elapsed play in ms (attempt start -> first valid save,
   *  both server-stamped). Null when the server never owned a clock for this
   *  completion; such rows rank after timed ones of equal score. */
  completion_time_ms: number | null;
  is_current_user: boolean;
}

export interface DailyLeaderboardYou {
  rank: number | null;
  score: number | null;
  completion_time_ms: number | null;
  listed: boolean;
  has_handle: boolean;
  has_entry: boolean;
}

export interface DailyLeaderboardResponse {
  daily_key: string;
  entries: DailyLeaderboardRow[];
  total_listed: number;
  /** Present only for an authenticated caller — their TRUE standing, even
   *  outside the returned page, so the UI never fakes a placement. */
  you: DailyLeaderboardYou | null;
}

/**
 * Today's (or a named day's) leaderboard. Public to read — the token only
 * adds `is_current_user` marking and the caller's own `you` block. RANKS
 * ARRIVE COMPUTED; nothing here re-derives an order (A2.9).
 */
export async function fetchDailyLeaderboard(params?: {
  date?: string;
  limit?: number;
  accessToken?: string | null;
}): Promise<DailyLeaderboardResponse> {
  const qs = new URLSearchParams();
  if (params?.date) qs.set("date", params.date);
  if (params?.limit) qs.set("limit", String(params.limit));
  const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
  return apiFetch<DailyLeaderboardResponse>(`/daily-grid/leaderboard${suffix}`, {
    cache: "no-store",
    headers: params?.accessToken
      ? { Authorization: `Bearer ${params.accessToken}` }
      : undefined,
  } as RequestInit);
}

// ---------------------------------------------------------------------------
// Leaderboard retries (final integrity closure)
// ---------------------------------------------------------------------------

export interface DailyGridRetryStartResponse {
  daily_key: string;
  retry_id: string;
  started_at: string;
  server_now: string;
}

export interface DailyGridRetryCompleteResponse {
  score: number;
  completion_time_ms: number;
  improved: boolean;
  best_score: number;
  best_completion_time_ms: number | null;
}

/**
 * Open a FRESH retry clock on today's board. Signed-in only, never
 * idempotent: each call is its own server-stamped attempt. The canonical
 * official result and its recorded time are not touched by anything on this
 * path — a retry exists purely to challenge the leaderboard's better-only
 * upsert.
 */
export async function startDailyGridRetry(
  dailyKey: string,
  accessToken: string,
): Promise<DailyGridRetryStartResponse> {
  return apiFetch<DailyGridRetryStartResponse>(
    `/daily-grid/${encodeURIComponent(dailyKey)}/retry`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
}

/**
 * Finish a retry: the server revalidates the nine squares, recomputes the
 * score, times the run against the active retry clock's own `started_at`,
 * and lets the outcome challenge the leaderboard. The body carries no score
 * and no time — there is nothing here a client could inflate.
 */
export async function completeDailyGridRetry(
  body: GridResultRequest,
  accessToken: string,
): Promise<DailyGridRetryCompleteResponse> {
  return apiFetch<DailyGridRetryCompleteResponse>("/daily-grid/retry/complete", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
