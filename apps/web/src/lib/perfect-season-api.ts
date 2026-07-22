/**
 * API client for 82-0 Peak Season / CourtBuilder endpoints (Phase 5C).
 * Never calculates scores or simulation results client-side -- server-authoritative,
 * mirroring the discipline in draft-api.ts.
 */
import {
  CourtBuilderReadiness,
  CourtLineupPublicState,
  CourtMode,
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

export async function createCourtGame(mode: CourtMode, seed?: number): Promise<CourtLineupPublicState> {
  return apiFetch<CourtLineupPublicState>("/perfect-season/games", {
    method: "POST",
    body: JSON.stringify({ mode, seed }),
  });
}

export async function getCourtGame(gameId: string): Promise<CourtLineupPublicState> {
  return apiFetch<CourtLineupPublicState>(`/perfect-season/games/${gameId}`, { cache: "no-store" } as RequestInit);
}

export async function selectPlayer(gameId: string, playerSlug: string): Promise<CourtLineupPublicState> {
  return apiFetch<CourtLineupPublicState>(`/perfect-season/games/${gameId}/select`, {
    method: "POST",
    body: JSON.stringify({ game_id: gameId, player_slug: playerSlug }),
  });
}

export async function placeCard(gameId: string, slotType: SlotType): Promise<CourtLineupPublicState> {
  return apiFetch<CourtLineupPublicState>(`/perfect-season/games/${gameId}/place`, {
    method: "POST",
    body: JSON.stringify({ game_id: gameId, slot_type: slotType }),
  });
}

export async function completeCourtGame(gameId: string): Promise<CourtLineupPublicState> {
  return apiFetch<CourtLineupPublicState>(`/perfect-season/games/${gameId}/complete`, {
    method: "POST",
    body: JSON.stringify({ game_id: gameId }),
  });
}

export { PerfectSeasonAPIError };
