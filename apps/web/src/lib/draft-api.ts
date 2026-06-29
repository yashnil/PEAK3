/**
 * API client for Peak Draft endpoints.
 * Never calculates lineup scores — those are server-authoritative.
 */
import { DraftGameState, DraftMode } from "@/types/draft";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

class DraftAPIError extends Error {
  constructor(
    public status: number,
    public detail: string,
    public code?: string,
  ) {
    super(detail);
    this.name = "DraftAPIError";
  }
}

// The API returns `detail` either as a plain string (FastAPI default) or as a
// structured { error_code, message } object (Peak Draft state-machine errors).
function parseErrorDetail(
  detail: unknown,
  status: number,
): { message: string; code?: string } {
  if (typeof detail === "string") return { message: detail };
  if (detail && typeof detail === "object") {
    const d = detail as { error_code?: string; message?: string };
    return { message: d.message || `HTTP ${status}`, code: d.error_code };
  }
  return { message: `HTTP ${status}` };
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  const json = await res.json().catch(() => ({ detail: "Unknown error" }));
  if (!res.ok) {
    const { message, code } = parseErrorDetail(
      (json as { detail?: unknown }).detail,
      res.status,
    );
    throw new DraftAPIError(res.status, message, code);
  }
  return json as T;
}

// Create a new game
export async function createDraftGame(
  mode: DraftMode,
  boardType: "daily" | "practice" | "challenge",
  options: { date?: string; seed?: number } = {},
): Promise<DraftGameState> {
  return apiFetch<DraftGameState>("/draft/games", {
    method: "POST",
    body: JSON.stringify({ mode, board_type: boardType, ...options }),
  });
}

// Get today's daily board
export async function getDailyDraft(
  mode: DraftMode,
  date?: string,
): Promise<DraftGameState> {
  const params = new URLSearchParams({ mode });
  if (date) params.set("date", date);
  return apiFetch<DraftGameState>(`/draft/daily?${params}`);
}

// Get current game state
export async function getDraftGame(gameId: string): Promise<DraftGameState> {
  return apiFetch<DraftGameState>(`/draft/games/${gameId}`);
}

// Submit an action
export async function submitDraftAction(
  gameId: string,
  action: "select_card" | "use_hold" | "use_reframe" | "confirm",
  options: {
    card_id?: string;
    role?: string;
    idempotency_key?: string;
  } = {},
): Promise<DraftGameState> {
  return apiFetch<DraftGameState>(`/draft/games/${gameId}/actions`, {
    method: "POST",
    body: JSON.stringify({ game_id: gameId, action, ...options }),
  });
}

// Create a challenge link
export async function createChallenge(gameId: string): Promise<{
  challenge_token: string;
  public_url_path: string;
  board_id: string;
  mode: string;
}> {
  return apiFetch(`/draft/challenges?game_id=${gameId}`, { method: "POST" });
}

// Load a challenge board
export async function loadChallenge(token: string): Promise<DraftGameState> {
  return apiFetch<DraftGameState>(`/draft/challenges/${token}`);
}

// Get draft model metadata
export async function getDraftMeta(): Promise<{
  supported_modes: string[];
  mode_descriptions: Record<string, string>;
  roles: string[];
  dna_dimensions: string[];
  lineup_model_version: string;
  ruleset_version: string;
  card_pool_version: string;
  experimental_notice: string;
}> {
  return apiFetch("/draft/meta");
}

export { DraftAPIError };
