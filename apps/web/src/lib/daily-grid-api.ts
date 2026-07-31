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
  GridResultRequest,
  GridResultResponse,
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

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    credentials: "include",
    ...options,
  });
  const json = await res.json().catch(() => ({ detail: "Unknown error" }));
  if (!res.ok) {
    const { message, code } = parseErrorDetail((json as { detail?: unknown }).detail, res.status);
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

export { DailyGridAPIError };
