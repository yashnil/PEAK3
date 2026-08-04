/**
 * Arena lobby API client — shared by every mode.
 *
 * Same two conventions as `head-to-head-api.ts` and `twenty-dollar-api.ts`:
 * auth is attached CENTRALLY inside the fetch wrapper (never per call), and
 * status 0 means the network failed rather than the API refusing.
 *
 * NO MATCHMAKING LOGIC LIVES HERE. This module starts matches, reads queue
 * status and cancels — it never decides who is paired with whom, when bots may
 * fill, or whether a match is rated. All four are the server's, and two of them
 * are enforced in the schema (`CHECK (rated = (entry_path = 'public_queue'))`).
 * The client's job is to report what it is told.
 */

import { getAccessToken } from "@/lib/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export class ArenaAPIError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ArenaAPIError";
    this.status = status;
    this.code = code;
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

async function arenaFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    throw new ArenaAPIError(0, "Could not reach the PEAK3 API.", "network_unavailable");
  }
  const json = await res.json().catch(() => ({ detail: "Unknown error" }));
  if (!res.ok) {
    const { message, code } = parseErrorDetail((json as { detail?: unknown }).detail, res.status);
    throw new ArenaAPIError(res.status, message, code);
  }
  return json as T;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArenaReadiness {
  readiness_level: string;
  arena_enabled: boolean;
  public_queue_enabled: boolean;
  bots_enabled: boolean;
  /** The registry's live mode ids. A mode absent here cannot be started. */
  modes: string[];
}

export interface QueueStatus {
  status: "not_in_queue" | "waiting" | "matched";
  mode: string;
  match_id?: string | null;
  waited_seconds?: number | null;
  /** True while the matchmaker is still holding out for a human. Published so
   *  the UI can say "looking for players" and then "adding a bot" honestly,
   *  rather than showing a spinner that means nothing. */
  still_seeking_humans?: boolean | null;
}

/** Only the lobby-relevant fields. The per-mode screens declare the rest. */
export interface ArenaMatchStub {
  match_id: string;
  mode: string;
  status: string;
  seat_count: number;
  rated: boolean;
  entry_path: string;
  your_seat_index: number | null;
  room_code: string | null;
  seats: Array<{ seat_index: number; display_name: string; is_bot: boolean; status: string }>;
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export const arenaLobbyApi = {
  readiness(): Promise<ArenaReadiness> {
    return arenaFetch<ArenaReadiness>("/readiness");
  },

  /** Practice against bots. Starts immediately. Always UNRATED. */
  startPractice(mode: string): Promise<ArenaMatchStub> {
    return arenaFetch<ArenaMatchStub>("/matches/practice", {
      method: "POST",
      body: JSON.stringify({ mode }),
    });
  },

  /** Open a private room. Never auto-filled; starts when every seat is taken. */
  createPrivate(mode: string): Promise<ArenaMatchStub> {
    return arenaFetch<ArenaMatchStub>("/matches/private", {
      method: "POST",
      body: JSON.stringify({ mode }),
    });
  },

  joinPrivate(roomCode: string): Promise<ArenaMatchStub> {
    return arenaFetch<ArenaMatchStub>("/matches/private/join", {
      method: "POST",
      body: JSON.stringify({ room_code: roomCode.toUpperCase() }),
    });
  },

  joinQueue(mode: string): Promise<QueueStatus> {
    return arenaFetch<QueueStatus>(`/queue/${encodeURIComponent(mode)}/join`, {
      method: "POST",
    });
  },

  queueStatus(mode: string): Promise<QueueStatus> {
    return arenaFetch<QueueStatus>(`/queue/${encodeURIComponent(mode)}/status`);
  },

  cancelQueue(mode: string): Promise<unknown> {
    return arenaFetch<unknown>(`/queue/${encodeURIComponent(mode)}/cancel`, {
      method: "POST",
    });
  },
};

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

/**
 * Honest search copy, driven by the server's own `still_seeking_humans`.
 *
 * Two distinct states, because they mean different things to a waiting player:
 * we are holding a seat open for a person, versus we have stopped and are about
 * to seat a bot. A single "Searching…" would hide the transition that decides
 * who they end up playing.
 */
export function searchLabel(status: QueueStatus | null): string {
  if (!status || status.status === "not_in_queue") return "Not searching.";
  if (status.status === "matched") return "Match found.";
  if (status.still_seeking_humans === false) {
    return "No human found — filling the remaining seats with bots.";
  }
  return "Looking for a human opponent…";
}

/** Room codes are typed by hand and read aloud, so they are normalised on the
 *  way in. The server's alphabet excludes 0/O/1/I/L for the same reason. */
export function normaliseRoomCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}
