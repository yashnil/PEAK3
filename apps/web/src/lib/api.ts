import { z } from "zod";
import type {
  DailyChallenge,
  EndlessSession,
  LeaderboardResponse,
  PlayerSearchResponse,
  PlayerProfile,
  AnswerResponse,
  DatasetMetadata,
  Methodology,
} from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let message = `API error ${res.status}`;
    try {
      const body = await res.json();
      message = body.detail ?? message;
    } catch {}
    throw new APIError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export class APIError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "APIError";
  }
}

export async function getLeaderboard(
  years: number,
  opts?: { limit?: number; offset?: number; search?: string }
): Promise<LeaderboardResponse> {
  const params = new URLSearchParams({ years: String(years) });
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  if (opts?.search) params.set("search", opts.search);
  return apiFetch<LeaderboardResponse>(`/api/v1/leaderboards?${params}`);
}

export async function searchPlayers(
  q: string,
  limit = 10
): Promise<PlayerSearchResponse> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  return apiFetch<PlayerSearchResponse>(`/api/v1/players/search?${params}`);
}

export async function getPlayer(slug: string): Promise<PlayerProfile> {
  return apiFetch<PlayerProfile>(`/api/v1/players/${encodeURIComponent(slug)}`);
}

export async function getMetadata(): Promise<DatasetMetadata> {
  return apiFetch<DatasetMetadata>("/api/v1/meta");
}

export async function getMethodology(): Promise<Methodology> {
  return apiFetch<Methodology>("/api/v1/methodology");
}

export async function getDailyChallenge(
  years: number,
  date?: string
): Promise<DailyChallenge> {
  const params = new URLSearchParams({ years: String(years) });
  if (date) params.set("date", date);
  return apiFetch<DailyChallenge>(`/api/v1/game/daily?${params}`);
}

export async function getEndlessSession(
  years: number,
  opts?: { seed?: number; count?: number }
): Promise<EndlessSession> {
  const params = new URLSearchParams({ years: String(years) });
  if (opts?.seed != null) params.set("seed", String(opts.seed));
  if (opts?.count) params.set("count", String(opts.count));
  return apiFetch<EndlessSession>(`/api/v1/game/endless?${params}`);
}

export async function submitAnswer(body: {
  session_token: string;
  duel_id: string;
  selected_peak_id: string;
  elapsed_ms: number;
  current_streak: number;
}): Promise<AnswerResponse> {
  return apiFetch<AnswerResponse>("/api/v1/game/answer", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// Zod validation for API responses at runtime boundaries
export const DuelSchema = z.object({
  id: z.string(),
  left: z.object({
    player_name: z.string(),
    player_slug: z.string(),
    duration_years: z.number(),
    start_season: z.string(),
    end_season: z.string(),
    anchor_season: z.string(),
    peak_id: z.string(),
  }),
  right: z.object({
    player_name: z.string(),
    player_slug: z.string(),
    duration_years: z.number(),
    start_season: z.string(),
    end_season: z.string(),
    anchor_season: z.string(),
    peak_id: z.string(),
  }),
  difficulty: z.enum(["Comfortable", "Tricky", "Brutal", "Photo Finish"]),
});

export function validateDuelList(data: unknown): boolean {
  try {
    z.array(DuelSchema).parse(data);
    return true;
  } catch {
    return false;
  }
}
