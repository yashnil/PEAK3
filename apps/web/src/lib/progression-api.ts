/**
 * Client for Phase 3.1 progression API endpoints.
 * All calls require an access token (authenticated user).
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface LevelSummary {
  total_xp: number;
  current_level: number;
  level_cap: number;
  xp_into_level: number;
  xp_for_next_level: number | null;
  progress_fraction: number;
  policy_version: string;
}

export interface ProgressionSummary {
  level: LevelSummary;
  current_streak: number;
  longest_streak: number;
  reserve_count: number;
  reserve_cap: number;
  achievement_count: number;
  recent_achievements: string[];
}

export interface PersonalRecord {
  record_type: string;
  mode: string;
  record_value: number;
  higher_is_better: boolean;
  source_result_id: string;
  achieved_at: string;
  lineup_model_version: string;
  card_pool_version: string;
  ruleset_version: string;
}

export interface Achievement {
  key: string;
  category: string;
  title: string;
  description: string;
  requirement_copy: string;
  earned: boolean;
  earned_at: string | null;
}

export interface StreakState {
  current_streak: number;
  longest_streak: number;
  last_qualifying_date: string | null;
  reserve_count: number;
  reserve_cap: number;
  policy_version: string;
}

export interface ProgressionEventItem {
  id: string;
  event_type: string;
  xp_amount: number;
  occurred_at: string;
  policy_version: string;
}

export interface ResultProgressMoment {
  xp_awarded: number;
  new_level: number | null;
  new_personal_records: Array<{ record_type: string; mode: string; value: number; previous_value: number | null }>;
  new_achievements: string[];
  streak_advanced: boolean;
  streak_reserve_earned: boolean;
  streak_reserve_consumed: boolean;
  current_streak?: number;
}

async function apiGet<T>(path: string, token: string | null): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
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
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
  return res.json();
}

export const progressionApi = {
  getSummary: (token: string) =>
    apiGet<ProgressionSummary>("/api/v1/progression/me", token),

  getEvents: (token: string, limit = 20, beforeId?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (beforeId) params.set("before_id", beforeId);
    return apiGet<{ items: ProgressionEventItem[]; next_cursor: string | null }>(
      `/api/v1/progression/events?${params}`,
      token,
    );
  },

  recordAction: (token: string, action_type: string, source_id: string) =>
    apiPost<ResultProgressMoment>("/api/v1/progression/action", token, { action_type, source_id }),

  getRecords: (token: string) =>
    apiGet<PersonalRecord[]>("/api/v1/records", token),

  getAchievements: (token: string | null) =>
    apiGet<Achievement[]>("/api/v1/achievements", token),

  getStreak: (token: string) =>
    apiGet<StreakState>("/api/v1/streak", token),
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  daily_completion_first: "Daily completion",
  practice_completion_first_weekly: "Practice exploration",
  challenge_completion: "Challenge completed",
  receipt_exploration: "Peak Receipt explored",
  methodology_exploration: "Formula explored",
  first_game_bonus: "First game!",
};

export const RECORD_TYPE_LABELS: Record<string, string> = {
  lineup_score: "Lineup Score",
  draft_efficiency: "Draft Efficiency",
  daily_percentile: "Daily Rank",
  challenge_margin: "Challenge Margin",
};

export const MODE_LABELS: Record<string, string> = {
  apex_1y: "1Y Apex",
  prime_3y: "3Y Prime",
  foundation_5y: "5Y Foundation",
};
