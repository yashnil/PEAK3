/**
 * API client for 82-0 Peak Season / CourtBuilder endpoints (Phase 5C).
 * Never calculates scores or simulation results client-side -- server-authoritative,
 * mirroring the discipline in draft-api.ts.
 */
import {
  CourtBuilderReadiness,
  CourtLineupPublicState,
  CourtMode,
  DailyChallenge,
  LeaderboardResponse,
  MyRunsResponse,
  PersonalBests,
  PerfectSeasonRunPublic,
  SavedRunsResponse,
  SaveRunResponse,
  SharedCourtResult,
  SlotType,
} from "@/types/perfect-season";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

class PerfectSeasonAPIError extends Error {
  constructor(
    public status: number,
    public detail: string,
    public code?: string,
  ) {
    super(detail);
    this.name = "PerfectSeasonAPIError";
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
    throw new PerfectSeasonAPIError(res.status, message, code);
  }
  return json as T;
}

export async function getCourtBuilderReadiness(): Promise<CourtBuilderReadiness> {
  return apiFetch<CourtBuilderReadiness>("/perfect-season/readiness", { cache: "no-store" } as RequestInit);
}

export async function createCourtGame(
  mode: CourtMode,
  seed?: number,
  /** Phase 9A: pass "daily" to start today's shared challenge. The seed is
   * always re-derived server-side for a daily board, so any `seed` passed
   * alongside it is ignored by design (see the API's own comment). */
  options: { challengeKind?: "free_play" | "daily"; challengeDate?: string } = {},
): Promise<CourtLineupPublicState> {
  return apiFetch<CourtLineupPublicState>("/perfect-season/games", {
    method: "POST",
    body: JSON.stringify({
      mode,
      seed,
      challenge_kind: options.challengeKind ?? "free_play",
      challenge_date: options.challengeDate,
    }),
  });
}

export async function getCourtGame(gameId: string): Promise<CourtLineupPublicState> {
  return apiFetch<CourtLineupPublicState>(`/perfect-season/games/${gameId}`, { cache: "no-store" } as RequestInit);
}

/**
 * The read-only scorecard behind a shared results link.
 *
 * A DIFFERENT ENDPOINT from `getCourtGame`, on purpose. `GET
 * /perfect-season/games/{id}` is the owner's live game: it carries the
 * candidate pool and is the handle every mutator keys off, so it is
 * owner-only and a shared link cannot use it (that is exactly why the shared
 * page 404'd once ownership was enforced). `/shared-result` serves only
 * finished runs, strips the owner-scoped and mutable fields server-side, and
 * 404s identically for "no such run" and "not finished yet".
 *
 * No `credentials: "include"` is needed or wanted -- the response does not
 * depend on who is asking, which is the whole point.
 */
export async function getSharedCourtResult(gameId: string): Promise<SharedCourtResult> {
  return apiFetch<SharedCourtResult>(`/perfect-season/games/${gameId}/shared-result`, {
    cache: "no-store",
  } as RequestInit);
}

export async function selectPlayer(gameId: string, playerSlug: string): Promise<CourtLineupPublicState> {
  return apiFetch<CourtLineupPublicState>(`/perfect-season/games/${gameId}/select`, {
    method: "POST",
    body: JSON.stringify({ game_id: gameId, player_slug: playerSlug }),
  });
}

export async function cancelSelection(gameId: string): Promise<CourtLineupPublicState> {
  return apiFetch<CourtLineupPublicState>(`/perfect-season/games/${gameId}/cancel`, {
    method: "POST",
    body: JSON.stringify({ game_id: gameId }),
  });
}

/**
 * W5: a respin key is derived from state the caller can already see, NOT
 * generated fresh per call.
 *
 * That is the whole point. `crypto.randomUUID()` per invocation would make
 * every click a distinct request and a double-click would still burn two of
 * the three respins. Because both clicks of a double-click observe the same
 * React state (the first response has not landed yet, so
 * `respinsUsed` has not incremented), they produce the SAME key and the
 * server recognises the second as a replay. The same property makes a
 * retried fetch, or a refresh fired mid-animation, safe.
 */
export function respinIdempotencyKey(
  gameId: string,
  round: number,
  kind: "team" | "season",
  respinsUsed: number,
): string {
  return `${gameId}:r${round}:${kind}:${respinsUsed}`;
}

export async function respinTeam(
  gameId: string,
  idempotencyKey?: string,
): Promise<CourtLineupPublicState> {
  return apiFetch<CourtLineupPublicState>(`/perfect-season/games/${gameId}/respin-team`, {
    method: "POST",
    body: JSON.stringify(
      idempotencyKey ? { game_id: gameId, idempotency_key: idempotencyKey } : { game_id: gameId },
    ),
  });
}

export async function respinSeason(
  gameId: string,
  idempotencyKey?: string,
): Promise<CourtLineupPublicState> {
  return apiFetch<CourtLineupPublicState>(`/perfect-season/games/${gameId}/respin-season`, {
    method: "POST",
    body: JSON.stringify(
      idempotencyKey ? { game_id: gameId, idempotency_key: idempotencyKey } : { game_id: gameId },
    ),
  });
}

export async function placeCard(gameId: string, slotType: SlotType): Promise<CourtLineupPublicState> {
  return apiFetch<CourtLineupPublicState>(`/perfect-season/games/${gameId}/place`, {
    method: "POST",
    body: JSON.stringify({ game_id: gameId, slot_type: slotType }),
  });
}

/** Phase 9B: move/swap two already-placed cards between slots to optimize
 * position fit. Explicitly NOT a respin -- it consumes no respin budget,
 * never re-rolls the board or any spin, and can never add or remove a card.
 * Rejected (code "rearrange_after_result") once the run is simulated. */
export async function swapSlots(
  gameId: string,
  slotA: SlotType,
  slotB: SlotType,
): Promise<CourtLineupPublicState> {
  return apiFetch<CourtLineupPublicState>(`/perfect-season/games/${gameId}/swap-slots`, {
    method: "POST",
    body: JSON.stringify({ game_id: gameId, slot_a: slotA, slot_b: slotB }),
  });
}

export async function completeCourtGame(gameId: string): Promise<CourtLineupPublicState> {
  return apiFetch<CourtLineupPublicState>(`/perfect-season/games/${gameId}/complete`, {
    method: "POST",
    body: JSON.stringify({ game_id: gameId }),
  });
}

// ---------------------------------------------------------------------------
// Phase 6G Part E: authenticated global leaderboard
// ---------------------------------------------------------------------------

export async function submitRun(gameId: string, accessToken: string): Promise<PerfectSeasonRunPublic> {
  return apiFetch<PerfectSeasonRunPublic>(`/perfect-season/games/${gameId}/submit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ game_id: gameId }),
  });
}

export async function getLeaderboard(params: {
  mode?: CourtMode;
  noRespin?: boolean;
  limit?: number;
  cursor?: string;
} = {}): Promise<LeaderboardResponse> {
  const qs = new URLSearchParams();
  if (params.mode) qs.set("mode", params.mode);
  if (params.noRespin) qs.set("no_respin", "true");
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<LeaderboardResponse>(`/perfect-season/leaderboard${suffix}`, { cache: "no-store" } as RequestInit);
}

export async function getMyRuns(accessToken: string): Promise<MyRunsResponse> {
  return apiFetch<MyRunsResponse>("/perfect-season/me/runs", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  } as RequestInit);
}

// ---------------------------------------------------------------------------
// Phase 9A: saved runs (private personal history), personal bests, daily
// challenge. All the /me/* routes require a REAL signed-in account (an
// anonymous session has nowhere durable to attach history) and throw a
// PerfectSeasonAPIError with code "sign_in_required" otherwise -- callers
// turn that into a sign-in CTA rather than an error banner.
// ---------------------------------------------------------------------------

export async function saveRun(gameId: string, accessToken: string): Promise<SaveRunResponse> {
  return apiFetch<SaveRunResponse>(`/perfect-season/games/${gameId}/save`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ game_id: gameId }),
  });
}

export async function getMySavedRuns(accessToken: string, limit = 25): Promise<SavedRunsResponse> {
  return apiFetch<SavedRunsResponse>(`/perfect-season/me/saved-runs?limit=${limit}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  } as RequestInit);
}

export async function getMyPersonalBests(accessToken: string): Promise<PersonalBests> {
  return apiFetch<PersonalBests>("/perfect-season/me/personal-bests", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  } as RequestInit);
}

/** Today's (or a given date's) shared daily challenge. Works without auth --
 * daily play is not gated on an account; an authenticated caller
 * additionally gets their own `attempts_used` for that date. */
export async function getDailyChallenge(
  mode: CourtMode = "apex_1y",
  options: { date?: string; accessToken?: string } = {},
): Promise<DailyChallenge> {
  const qs = new URLSearchParams({ mode });
  if (options.date) qs.set("date", options.date);
  return apiFetch<DailyChallenge>(`/perfect-season/daily?${qs.toString()}`, {
    headers: options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {},
    cache: "no-store",
  } as RequestInit);
}

export { PerfectSeasonAPIError };
