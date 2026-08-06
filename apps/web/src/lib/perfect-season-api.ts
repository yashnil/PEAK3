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
  PersonalPlacementResponse,
  PerfectSeasonRunPublic,
  SavedRunsResponse,
  SaveRunResponse,
  SharedCourtResult,
  SlotType,
} from "@/types/perfect-season";

import { getAccessToken } from "@/lib/auth";

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
  // THE BEARER TOKEN IS ATTACHED HERE, CENTRALLY, FOR EVERY CALL.
  //
  // It used to be attached only by the handful of functions that took an
  // `accessToken` parameter (save, submit, my-runs, personal-bests). Create,
  // load, respin, select, place and complete sent no Authorization at all, so
  // `resolve_owner_sub` on the API fell through to the anonymous branch and a
  // signed-in player's brand-new run was created under a GUEST subject.
  //
  // On a same-origin deployment that merely mislabelled the owner. Split across
  // origins it broke outright: the guest identity is carried by the `peak3_anon`
  // cookie, and a cross-site cookie is not sent by the browser at all, so every
  // request minted a *fresh* anonymous subject. Create returned 200, the very
  // next load returned 403 `not_your_game`, and starting again produced a new
  // board and the same error — because each request was a different person.
  //
  // Read here rather than threaded through ~15 call sites so no future caller
  // can forget it, mirroring run-the-table-api.ts which already does this and
  // for the same reason. `getAccessToken` returns null when signed out or on
  // the server, and a null token leaves the request exactly as it was, so
  // anonymous play is untouched.
  let authHeader: Record<string, string> = {};
  try {
    const accessToken = await getAccessToken();
    if (accessToken) authHeader = { Authorization: `Bearer ${accessToken}` };
  } catch {
    // An auth-layer hiccup must never block a guest-playable request.
  }

  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    ...options,
    // Spread AFTER `options` so a caller cannot accidentally drop credentials
    // or the auth header by passing its own `headers`/`credentials`. An
    // explicit `Authorization` in options.headers still wins, because
    // options.headers is spread last — that is how the token-taking functions
    // keep working unchanged.
    headers: { "Content-Type": "application/json", ...authHeader, ...options.headers },
    credentials: "include",
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

/**
 * Launch-polish LP2-2: reverse the single most recent placement or swap.
 *
 * `expectedStateVersion` is `state.state_version` from the last state this
 * client received -- never a value this client derives or increments
 * itself. The server compares it against its own counter and rejects
 * (`stale_state`) if anything has moved on; a SEPARATE server-side check
 * rejects (`undo_not_available` / `undo_expired`) even when the caller is
 * perfectly in sync, if the specific thing it wants undone is no longer the
 * most recent action or the (server-enforced, reload-independent) window
 * has closed. This function sends no reversal details of its own -- no
 * slot, no card, not even "place" vs "swap" -- only the intent to undo and
 * the caller's belief about the current state; the server decides the rest
 * from its own stored snapshot. See `idempotencyKey` below for why a
 * double-click or a retried request cannot double-undo.
 */
export async function undoLastPlacement(
  gameId: string,
  expectedStateVersion: number,
  idempotencyKey?: string,
): Promise<CourtLineupPublicState> {
  return apiFetch<CourtLineupPublicState>(`/perfect-season/games/${gameId}/undo`, {
    method: "POST",
    body: JSON.stringify(
      idempotencyKey
        ? { game_id: gameId, expected_state_version: expectedStateVersion, idempotency_key: idempotencyKey }
        : { game_id: gameId, expected_state_version: expectedStateVersion },
    ),
  });
}

/**
 * Derived from state the caller already has, not generated fresh per call --
 * same reasoning as `respinIdempotencyKey` above. Two clicks of the same
 * Undo button both read the same `expected_state_version` (the first
 * response has not landed yet), so both send the same key and the server
 * recognises the second as a replay instead of undoing twice.
 */
export function undoIdempotencyKey(gameId: string, expectedStateVersion: number): string {
  return `${gameId}:undo:v${expectedStateVersion}`;
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
  limit?: number;
  cursor?: string;
  /** The current application day only (midnight America/Los_Angeles), same
   *  query and same tie-break order. NOT a second table. */
  daily?: boolean;
} = {}): Promise<LeaderboardResponse> {
  // launch-polish IMPLEMENTATION_CONTRACT.md §7: no respin filter -- removed,
  // not defaulted off. Respins are normal Standard 82-0 play; the API no
  // longer accepts a no_respin param at all (apps/api/app/api/v1/perfect_season.py).
  const qs = new URLSearchParams();
  if (params.mode) qs.set("mode", params.mode);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.daily) qs.set("daily", "true");
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<LeaderboardResponse>(`/perfect-season/leaderboard${suffix}`, { cache: "no-store" } as RequestInit);
}

/**
 * Where the caller stands on the public board.
 *
 * THE ENDPOINT WAS ALWAYS THERE AND HAD NO CLIENT. `GET
 * /perfect-season/leaderboard/me` has existed since the gap-#2 pass; nothing
 * in the web app called it, so the board could be read and a player could
 * never see their own place on it. Reads the SAME public rows the board
 * serves, in the same order, so a rank returned here always corresponds to a
 * position the board would actually show on some page of it.
 */
export async function getPersonalPlacement(
  accessToken: string,
  mode?: CourtMode,
): Promise<PersonalPlacementResponse> {
  const qs = mode ? `?mode=${encodeURIComponent(mode)}` : "";
  return apiFetch<PersonalPlacementResponse>(
    `/perfect-season/leaderboard/me${qs}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" } as RequestInit,
  );
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
