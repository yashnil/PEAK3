/**
 * API client for the Arena foundation — one module, every mode.
 *
 * Server-authoritative, exactly like `perfect-season-api.ts`,
 * `run-the-table-api.ts` and `draft-api.ts`: every action POSTs and the caller
 * replaces its whole state object with the response. This module never
 * computes a PEAK3 score, a legality, a placement or a ranking — it moves
 * payloads.
 *
 * Mode-agnostic on purpose, matching the foundation it talks to. Three-Man
 * Weave's reading of `public_state` lives in `@/types/three-man-weave` and in
 * `three-man-weave-state.ts`, not here.
 */
import type {
  ArenaEventsResponse,
  ArenaMatchView,
  ArenaReadiness,
  ArenaResultsResponse,
  SubmitCommandResponse,
} from "@/types/three-man-weave";

import { getAccessToken } from "@/lib/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export class ArenaAPIError extends Error {
  constructor(
    public status: number,
    public detail: string,
    public code?: string,
  ) {
    super(detail);
    this.name = "ArenaAPIError";
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

async function arenaFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  // THE BEARER TOKEN IS ATTACHED HERE, CENTRALLY, FOR EVERY CALL — the same
  // discipline `perfect-season-api.ts:45-70` records the reason for, and for
  // the same reason. Arena is account-backed: every route resolves the caller's
  // seat from `auth.sub`, so a request without the header is not a guest, it is
  // a 403 `not_in_match`. Read here rather than threaded through the call sites
  // so no future caller can forget it.
  let authHeader: Record<string, string> = {};
  try {
    const accessToken = await getAccessToken();
    if (accessToken) authHeader = { Authorization: `Bearer ${accessToken}` };
  } catch {
    // Never let an auth-layer hiccup turn into an unhandled rejection here;
    // the request proceeds and the server answers authoritatively.
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1${path}`, {
      credentials: "include",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
        ...options.headers,
      },
    });
  } catch {
    // A transport failure is not a game rejection. Given as its own status so
    // the UI can offer "reconnect" rather than "your move was refused".
    throw new ArenaAPIError(0, "Could not reach the server.", "network_error");
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    let code: string | undefined;
    try {
      const body = await res.json();
      ({ message, code } = parseErrorDetail(body?.detail, res.status));
    } catch {
      /* non-JSON error body */
    }
    throw new ArenaAPIError(res.status, message, code);
  }
  return (await res.json()) as T;
}

export async function getArenaReadiness(): Promise<ArenaReadiness> {
  return arenaFetch<ArenaReadiness>("/arena/readiness");
}

export async function createPracticeMatch(mode: string): Promise<ArenaMatchView> {
  return arenaFetch<ArenaMatchView>("/arena/matches/practice", {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

export async function createPrivateMatch(mode: string): Promise<ArenaMatchView> {
  return arenaFetch<ArenaMatchView>("/arena/matches/private", {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

export async function joinPrivateMatch(roomCode: string): Promise<ArenaMatchView> {
  return arenaFetch<ArenaMatchView>("/arena/matches/private/join", {
    method: "POST",
    body: JSON.stringify({ room_code: roomCode }),
  });
}

export async function getMatch(matchId: string): Promise<ArenaMatchView> {
  return arenaFetch<ArenaMatchView>(`/arena/matches/${matchId}`);
}

export async function getMatchEvents(
  matchId: string,
  afterSeq?: number,
): Promise<ArenaEventsResponse> {
  const query = afterSeq === undefined ? "" : `?after_seq=${afterSeq}`;
  return arenaFetch<ArenaEventsResponse>(`/arena/matches/${matchId}/events${query}`);
}

export async function getMatchResults(matchId: string): Promise<ArenaResultsResponse> {
  return arenaFetch<ArenaResultsResponse>(`/arena/matches/${matchId}/results`);
}

/**
 * THE MUTATION.
 *
 * Both `idempotency_key` and `expected_state_version` are REQUIRED by the
 * server and are required here too. An optional idempotency key is a key nobody
 * sends, and a retry without one double-applies a move.
 */
export async function submitCommand(
  matchId: string,
  commandType: string,
  payload: Record<string, unknown>,
  expectedStateVersion: number,
  idempotencyKey: string,
): Promise<SubmitCommandResponse> {
  return arenaFetch<SubmitCommandResponse>(`/arena/matches/${matchId}/commands`, {
    method: "POST",
    body: JSON.stringify({
      command_type: commandType,
      payload,
      idempotency_key: idempotencyKey,
      expected_state_version: expectedStateVersion,
    }),
  });
}

/**
 * A stable idempotency key for one intended action.
 *
 * Derived from what the action IS (match, seat, state version, command,
 * payload) rather than from a random value, so a retry after a dropped
 * response reuses the same key and is recognised as a replay instead of
 * applying the move twice. The server's minimum length is 8.
 */
export function commandIdempotencyKey(
  matchId: string,
  seatIndex: number,
  stateVersion: number,
  commandType: string,
  payload: Record<string, unknown>,
): string {
  const shape = Object.keys(payload)
    .sort()
    .map((key) => `${key}=${String(payload[key])}`)
    .join("&");
  return `${matchId}:${seatIndex}:${stateVersion}:${commandType}:${shape}`.slice(0, 128);
}
