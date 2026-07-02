/**
 * Client for Phase 4.0 ranked duel API endpoints.
 * All calls except getReadiness/getLeaderboard require an access token
 * (authenticated user) — mirrors lib/progression-api.ts's apiGet/apiPost
 * pattern exactly.
 */
import type {
  JoinQueueResponse,
  LeaderboardResponse,
  MatchmakingStatusResponse,
  PlacementStateResponse,
  QueueRatingResponse,
  RankedGameState,
  RankedMatchPublic,
  RankedMode,
  RankedQueuesResponse,
  RankedReadinessResponse,
  RankedSettlementOrPending,
  RatingHistoryResponse,
  SurroundingRankResponse,
} from "@/types/ranked";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export class RankedAPIError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function parseErrorDetail(res: Response): Promise<{ message: string; code?: string }> {
  try {
    const body = await res.json();
    const detail = body?.detail;
    if (typeof detail === "string") return { message: detail };
    if (detail && typeof detail === "object") {
      return { message: detail.message ?? "Request failed", code: detail.error_code };
    }
    return { message: "Request failed" };
  } catch {
    return { message: "Unknown error" };
  }
}

async function apiGet<T>(path: string, token: string | null): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) {
    const { message, code } = await parseErrorDetail(res);
    throw new RankedAPIError(res.status, message, code);
  }
  return res.json();
}

async function apiPost<T>(path: string, token: string | null, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const { message, code } = await parseErrorDetail(res);
    throw new RankedAPIError(res.status, message, code);
  }
  return res.json();
}

export const rankedApi = {
  getReadiness: () => apiGet<RankedReadinessResponse>("/api/v1/ranked/readiness", null),

  listQueues: () => apiGet<RankedQueuesResponse>("/api/v1/ranked/queues", null),

  joinQueue: (token: string, mode: RankedMode) =>
    apiPost<JoinQueueResponse>(`/api/v1/ranked/queues/${mode}/join`, token),

  cancelQueue: (token: string, mode: RankedMode) =>
    apiPost<{ cancelled: boolean }>(`/api/v1/ranked/queues/${mode}/cancel`, token),

  getQueueStatus: (token: string, mode: RankedMode) =>
    apiGet<MatchmakingStatusResponse>(`/api/v1/ranked/queues/${mode}/status`, token),

  getMatch: (token: string, matchId: string) =>
    apiGet<RankedMatchPublic>(`/api/v1/ranked/matches/${matchId}`, token),

  startOrGetGame: (token: string, matchId: string) =>
    apiPost<RankedGameState>(`/api/v1/ranked/matches/${matchId}/game`, token),

  getGameState: (token: string, matchId: string) =>
    apiGet<RankedGameState>(`/api/v1/ranked/matches/${matchId}/game`, token),

  submitAction: (
    token: string,
    matchId: string,
    body: { action: string; card_id?: string; role?: string; idempotency_key?: string },
  ) => apiPost<RankedGameState>(`/api/v1/ranked/matches/${matchId}/actions`, token, body),

  getSettlement: (token: string, matchId: string) =>
    apiGet<RankedSettlementOrPending>(`/api/v1/ranked/matches/${matchId}/settlement`, token),

  getRating: (token: string, mode: RankedMode) =>
    apiGet<QueueRatingResponse>(`/api/v1/ranked/queues/${mode}/rating`, token),

  getPlacement: (token: string, mode: RankedMode) =>
    apiGet<PlacementStateResponse>(`/api/v1/ranked/queues/${mode}/placement`, token),

  getRatingHistory: (token: string, mode: RankedMode) =>
    apiGet<RatingHistoryResponse>(`/api/v1/ranked/queues/${mode}/rating-history`, token),

  getLeaderboard: (mode: RankedMode, limit = 50, cursor?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return apiGet<LeaderboardResponse>(`/api/v1/ranked/queues/${mode}/leaderboard?${params}`, null);
  },

  getSurroundingRank: (token: string, mode: RankedMode) =>
    apiGet<SurroundingRankResponse>(`/api/v1/ranked/queues/${mode}/leaderboard/me`, token),
};
