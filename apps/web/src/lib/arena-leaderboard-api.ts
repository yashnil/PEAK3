/**
 * Arena multiplayer standings — Top Players, Around You and the skill card.
 *
 * NOTHING HERE DECIDES A RANK, A TIER OR A PERCENTILE. Every one of them is
 * computed server-side (`apps/api/app/services/arena/skill.py`,
 * `standings.py`) and arrives with a machine-readable reason whenever it is
 * withheld. The client's job is to report what it is told, including "not
 * yet": a percentile that is `null` carries `percentile_reason`, and the copy
 * in `components/arena/leaderboard/leaderboard-copy.ts` turns that into a
 * sentence rather than a blank.
 *
 * MODE-AGNOSTIC. Every call takes whatever mode id the server publishes, so a
 * newly registered mode (for example a Three-Man Weave variant) has a board
 * the day it is registered, with no change here.
 *
 * Same two conventions as `arena-lobby-api.ts`: auth is attached centrally,
 * and status 0 means the network failed rather than the API refusing.
 */

import { getAccessToken } from "@/lib/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export class ArenaStandingsError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ArenaStandingsError";
    this.status = status;
    this.code = code;
  }
}

async function standingsFetch<T>(path: string, withAuth: boolean): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (withAuth) {
    try {
      const token = await getAccessToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
    } catch {
      /* the server answers authoritatively */
    }
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1/arena${path}`, { credentials: "include", headers });
  } catch {
    throw new ArenaStandingsError(0, "Could not reach the PEAK3 API.", "network_unavailable");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (json as { detail?: unknown }).detail;
    const d = detail && typeof detail === "object" ? (detail as { message?: string; error_code?: string }) : {};
    throw new ArenaStandingsError(
      res.status,
      typeof detail === "string" ? detail : d.message || `HTTP ${res.status}`,
      d.error_code,
    );
  }
  return json as T;
}

// ---------------------------------------------------------------------------
// Types — mirror apps/api/app/models/arena.py
// ---------------------------------------------------------------------------

/** Why a tier, rank or percentile is withheld. Stable server strings. */
export type SkillReason =
  | "not_rated"
  | "provisional"
  | "population_too_small"
  | "ratings_disabled"
  | "leaderboard_disabled";

/** Who a mode's board is computed over. Humans only — bots are never rated. */
export interface ArenaPopulation {
  /** Humans with a public handle and at least one rated match (listed rows). */
  total_rated_players: number;
  /** Every human with a rated match, listed or not. Ranks count all of them. */
  rated_population: number;
  established_players: number;
  percentile_min_population: number;
  provisional_until: number;
}

export interface ArenaLeaderboardEntry {
  /** Global position among every rated human, so an unlisted player ahead
   *  leaves a gap in the numbers. */
  rank: number;
  handle: string;
  rating: number;
  rd: number;
  rated_matches: number;
  provisional: boolean;
  tier: string | null;
  wins: number;
  losses: number;
  draws: number;
  matches_with_bots: number;
  matches_all_human: number;
  average_placement: number | null;
  podium_rate: number | null;
  average_score: number | null;
  best_score: number | null;
  averages: Record<string, number>;
  bests: Record<string, number>;
}

export interface ArenaTierStep {
  label: string;
  min_rating: number;
}

export interface ArenaLeaderboardResponse {
  leaderboard_enabled: boolean;
  mode: string;
  entries: ArenaLeaderboardEntry[];
  limit: number;
  offset: number;
  population: ArenaPopulation;
  total_rated_players: number;
  tier_version: string | null;
  tier_ladder: ArenaTierStep[];
}

export interface ArenaSkill {
  rated: boolean;
  rating: number | null;
  rd: number | null;
  rated_matches: number;
  provisional: boolean | null;
  matches_until_established: number | null;
  tier: string | null;
  tier_reason: SkillReason | null;
  tier_capped: boolean;
  next_tier: string | null;
  next_tier_rating: number | null;
  rank: number | null;
  rank_reason: SkillReason | null;
  listed: boolean;
  handle: string | null;
  percentile: number | null;
  percentile_reason: SkillReason | null;
  wins: number;
  losses: number;
  draws: number;
  rated_matches_counted: number;
  matches_with_bots: number;
  matches_all_human: number;
  best_rated_score: number | null;
  population: ArenaPopulation;
  tier_version: string | null;
}

export type AroundMeStatus = "listed" | "unlisted" | "not_rated";

export interface ArenaAroundMeResponse {
  leaderboard_enabled: boolean;
  mode: string;
  status: AroundMeStatus;
  me: ArenaSkill | null;
  /** Listed players ahead, best first — the nearest is last. */
  above: ArenaLeaderboardEntry[];
  /** Listed players behind, best first — the nearest is first. */
  below: ArenaLeaderboardEntry[];
  population: ArenaPopulation;
  total_rated_players: number;
  tier_version: string | null;
}

export interface ArenaModeSummary {
  id: string;
  seat_count: number;
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export interface ArenaStandingsApi {
  /** The modes the server currently registers (`GET /arena/readiness`). */
  modes(): Promise<ArenaModeSummary[]>;
  topPlayers(mode: string, page?: { limit?: number; offset?: number }): Promise<ArenaLeaderboardResponse>;
  aroundMe(mode: string, window?: number): Promise<ArenaAroundMeResponse>;
  /** The skill card alone, from `GET /arena/modes/{mode}/me` — for screens
   *  that want a badge without the neighbours. Null for a guest. */
  skill(mode: string): Promise<ArenaSkill | null>;
}

const encode = (mode: string) => encodeURIComponent(mode);

export const arenaStandingsApi: ArenaStandingsApi = {
  async modes() {
    const body = await standingsFetch<{ modes?: ArenaModeSummary[] }>("/readiness", false);
    return body.modes ?? [];
  },
  topPlayers(mode, page = {}) {
    const query = new URLSearchParams({
      limit: String(page.limit ?? 50),
      offset: String(page.offset ?? 0),
    });
    // Public: no token is sent, so a signed-out reader sees the same board.
    return standingsFetch<ArenaLeaderboardResponse>(`/leaderboard/${encode(mode)}?${query}`, false);
  },
  aroundMe(mode, window = 3) {
    return standingsFetch<ArenaAroundMeResponse>(
      `/leaderboard/${encode(mode)}/around-me?window=${window}`,
      true,
    );
  },
  async skill(mode) {
    const body = await standingsFetch<{ skill?: ArenaSkill | null }>(`/modes/${encode(mode)}/me`, true);
    return body.skill ?? null;
  },
};
