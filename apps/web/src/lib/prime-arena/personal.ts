/**
 * `GET /arena/modes/{mode}/me` — the signed-in player's own record in one mode.
 *
 * Everything is derived server-side from persisted results: matches played,
 * wins, win streaks, best score, whether a given match was a personal best, and
 * (only when ratings are enabled and the match was rated) the rating change.
 * Nothing here is computed in the browser.
 */
import { getAccessToken } from "@/lib/auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface PersonalRecordResponse {
  mode: string;
  matches_played: number;
  rated_matches: number;
  wins: number;
  podiums: number;
  current_win_streak: number;
  longest_win_streak: number;
  best_score: number | null;
  bests: Record<string, number>;
  match_found: boolean;
  match_score: number | null;
  match_placement: number | null;
  previous_best_score: number | null;
  is_personal_best: boolean;
  streak_after_match: number | null;
  ratings_enabled: boolean;
  rating: number | null;
  rating_provisional: boolean | null;
  match_rating_change: number | null;
}

export async function getPersonalRecord(mode: string, matchId?: string): Promise<PersonalRecordResponse> {
  let authHeader: Record<string, string> = {};
  try {
    const token = await getAccessToken();
    if (token) authHeader = { Authorization: `Bearer ${token}` };
  } catch {
    /* the server answers authoritatively */
  }
  const query = matchId ? `?match_id=${encodeURIComponent(matchId)}` : "";
  const response = await fetch(`${API_BASE}/api/v1/arena/modes/${mode}/me${query}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...authHeader },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as PersonalRecordResponse;
}
