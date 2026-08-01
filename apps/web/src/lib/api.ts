import { z } from "zod";
import type {
  DailyChallenge,
  EndlessSession,
  LeaderboardResponse,
  PeaksResponse,
  SeasonsResponse,
  SeasonExplainResponse,
  PlayerSearchResponse,
  PlayerProfile,
  AnswerResponse,
  DatasetMetadata,
  Methodology,
  RankingBoardData,
  RankingBoardId,
  RankingBoardPayload,
  RankingComparison,
  RankingComponentKey,
  RankingComponentValues,
  RankingExplain,
  RankingExplainBlock,
  RankingExplainSeasonStats,
  RankingPercentiles,
  RankingRow,
  RankingRowPayload,
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

// Phase 6D: broader-population (2,016-identity universe, not the 250-pool)
// top-1000 peaks, one duration at a time -- separate from getLeaderboard,
// which stays untouched (canonical 250-pool, DO NOT merge these).
export async function getPeaks(
  window: "1y" | "3y" | "5y",
  opts?: { limit?: number; search?: string }
): Promise<PeaksResponse> {
  const params = new URLSearchParams({ window });
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.search) params.set("search", opts.search);
  return apiFetch<PeaksResponse>(`/api/v1/peaks?${params}`);
}

// Phase 9B: the Single Seasons board -- one row per SEASON, so repeated
// players are expected. Separate from getLeaderboard and getPeaks, which are
// both one-row-per-player (DO NOT merge these three).
export async function getSeasons(
  opts?: { limit?: number; offset?: number; search?: string }
): Promise<SeasonsResponse> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  if (opts?.search) params.set("search", opts.search);
  const query = params.toString();
  return apiFetch<SeasonsResponse>(`/api/v1/seasons${query ? `?${query}` : ""}`);
}

// Fetched on modal open, never with the table: the explain blocks total
// ~3.4 MB across the board, and most visitors never open one.
export async function getSeasonExplain(seasonId: string): Promise<SeasonExplainResponse> {
  return apiFetch<SeasonExplainResponse>(
    `/api/v1/seasons/${encodeURIComponent(seasonId)}/explain`
  );
}

// ---------------------------------------------------------------------------
// Phase 9C: the two-board rankings contract.
//
// Both boards are read through ONE normalizer so the table, the sort model and
// the explain modal never have to know which endpoint a row came from. The
// normalizer is deliberately tolerant of the pre-9C field names (`season_id`,
// `window_label`, `season_mpg`, `data_status`) so the page keeps rendering
// while the API rolls forward -- but it NEVER substitutes a value: a field the
// payload does not carry becomes `null`, and the UI omits or dashes it.
// ---------------------------------------------------------------------------

const RANKING_COMPONENT_KEYS: readonly RankingComponentKey[] = [
  "statistical_impact",
  "traditional_production",
  "individual_recognition",
  "postseason_individual_value",
  "team_achievement",
];

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeComponents(
  raw: RankingRowPayload["components"]
): RankingComponentValues | null {
  if (!raw || typeof raw !== "object") return null;
  const out = {} as RankingComponentValues;
  let any = false;
  for (const key of RANKING_COMPONENT_KEYS) {
    const value = numOrNull(raw[key]);
    out[key] = value;
    if (value !== null) any = true;
  }
  // An object with five nulls carries no information; treat it as absent so the
  // UI omits the column rather than printing five dashes.
  return any ? out : null;
}

function normalizePercentiles(
  raw: RankingRowPayload["percentiles"]
): RankingPercentiles | null {
  if (!raw || typeof raw !== "object") return null;
  const out = {} as RankingPercentiles;
  let any = false;
  for (const key of [...RANKING_COMPONENT_KEYS, "total"] as const) {
    const value = numOrNull(raw[key]);
    out[key] = value;
    if (value !== null) any = true;
  }
  return any ? out : null;
}

export function normalizeRankingRow(raw: RankingRowPayload): RankingRow {
  const label = strOrNull(raw.label) ?? strOrNull(raw.window_label) ?? strOrNull(raw.season) ?? "";
  return {
    rank: raw.rank,
    row_id:
      strOrNull(raw.row_id) ??
      strOrNull(raw.season_id) ??
      strOrNull(raw.peak_id) ??
      `${raw.player_slug}:${label}`,
    player_slug: raw.player_slug,
    player_name: raw.player_name,
    label,
    team: strOrNull(raw.team),
    prime_score: numOrNull(raw.prime_score),
    prime_index: numOrNull(raw.prime_index),
    components: normalizeComponents(raw.components),
    percentiles: normalizePercentiles(raw.percentiles),
    mpg: numOrNull(raw.mpg) ?? numOrNull(raw.season_mpg),
    data_completeness: strOrNull(raw.data_completeness) ?? strOrNull(raw.data_status),
    headshot_url: strOrNull(raw.headshot_url),
    season_in_progress: raw.season_in_progress === true,
  };
}

function normalizeBoard(payload: RankingBoardPayload): RankingBoardData {
  return {
    rows: (payload.rows ?? []).map(normalizeRankingRow),
    meta: {
      dataset_version: strOrNull(payload.dataset_version),
      formula_version: strOrNull(payload.formula_version),
      model_version: strOrNull(payload.model_version),
      model_label: strOrNull(payload.model_label),
      // Absent means the API predates model versioning, which can only ever
      // have been serving the default -- so treat it as the default rather than
      // labelling every old board a preview.
      is_default_model: payload.is_default_model !== false,
      supported_start_season: strOrNull(payload.supported_start_season),
      supported_end_season: strOrNull(payload.supported_end_season),
      total_available: numOrNull(payload.total_available),
      universe_identity_count: numOrNull(payload.universe_identity_count),
      serving_gate_note: strOrNull(payload.serving_gate_note),
      effective_tie_threshold: numOrNull(payload.effective_tie_threshold),
      min_season_mpg: numOrNull(payload.min_season_mpg),
      // Provenance. The API sends the digest of the artifact IT loaded, which is
      // what makes a stale never-invalidated process cache detectable from the
      // page rather than only from the filesystem.
      artifact_digest: strOrNull(payload.artifact_digest),
      generated_at: strOrNull(payload.generated_at),
    },
  };
}

/** Peak Windows board: one row per player, at their best window of `window`. */
export async function getPeakWindowBoard(
  window: "1y" | "3y" | "5y",
  opts?: { limit?: number; search?: string }
): Promise<RankingBoardData> {
  const params = new URLSearchParams({ window });
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.search) params.set("search", opts.search);
  return normalizeBoard(await apiFetch<RankingBoardPayload>(`/api/v1/peaks?${params}`));
}

/** Single Seasons board: one row per season, repeated players expected. */
export async function getSeasonBoard(
  opts?: { limit?: number; offset?: number; search?: string }
): Promise<RankingBoardData> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  if (opts?.search) params.set("search", opts.search);
  const query = params.toString();
  return normalizeBoard(
    await apiFetch<RankingBoardPayload>(`/api/v1/seasons${query ? `?${query}` : ""}`)
  );
}

export function normalizeRankingExplain(raw: Record<string, unknown>): RankingExplain {
  const row = normalizeRankingRow(raw as unknown as RankingRowPayload);
  const split = (raw.score_split ?? {}) as Record<string, unknown>;
  const comparisons = (raw.comparisons ?? {}) as Record<string, unknown>;
  const weightsRaw = (raw.weights ?? {}) as Record<string, unknown>;
  const weights: Partial<Record<RankingComponentKey, number>> = {};
  for (const key of RANKING_COMPONENT_KEYS) {
    const value = numOrNull(weightsRaw[key]);
    if (value !== null) weights[key] = value;
  }
  const block = (value: unknown): RankingExplainBlock | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== null && v !== undefined && v !== ""
    );
    return entries.length ? (Object.fromEntries(entries) as RankingExplainBlock) : null;
  };
  const comparisonList = (value: unknown): RankingComparison[] => {
    if (!Array.isArray(value)) return [];
    return value
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
      .map((entry) => ({
        row_id: String(entry.row_id ?? entry.season_id ?? entry.peak_id ?? ""),
        label: String(entry.label ?? entry.season ?? entry.window_label ?? ""),
        prime_score: numOrNull(entry.prime_score),
        rank: numOrNull(entry.rank) ?? 0,
        player_name: strOrNull(entry.player_name),
        delta: numOrNull(entry.delta),
      }))
      .filter((entry) => entry.row_id.length > 0);
  };
  const stringList = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

  const anchorSelection = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    const nearby = Array.isArray(raw.nearby_iconic_seasons) ? raw.nearby_iconic_seasons : [];
    const seasons = nearby
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
      .map((e) => ({
        season: String(e.season ?? ""),
        prime_score: numOrNull(e.prime_score),
        margin: numOrNull(e.margin),
        markers: stringList(e.markers),
      }))
      .filter((e) => e.season.length > 0);
    const basis = strOrNull(raw.basis);
    // Nothing worth rendering if neither half arrived.
    if (!basis && seasons.length === 0) return null;
    return { basis, nearby_iconic_seasons: seasons };
  };

  const seasonStatsBlock = block(raw.season_stats);

  return {
    ...row,
    window_type: strOrNull(raw.window_type) ?? "",
    seasons_in_window: stringList(raw.seasons_in_window),
    weights,
    teammate_adjustment: numOrNull(raw.teammate_adjustment),
    score_split: {
      regular_season: numOrNull(split.regular_season),
      postseason: numOrNull(split.postseason),
      recognition: numOrNull(split.recognition),
      team: numOrNull(split.team) ?? numOrNull(split.team_achievement),
    },
    strongest_components: stringList(raw.strongest_components),
    weakest_components: stringList(raw.weakest_components),
    season_stats: seasonStatsBlock as RankingExplainSeasonStats | null,
    recognition: block(raw.recognition),
    postseason: block(raw.postseason),
    team_context: block(raw.team_context),
    role_and_sample: block(raw.role_and_sample),
    comparisons: {
      same_player: comparisonList(comparisons.same_player),
      similar_scores: comparisonList(comparisons.similar_scores),
      same_season_peers: comparisonList(comparisons.same_season_peers),
    },
    caveats: stringList(raw.caveats),
    model_version: strOrNull(raw.model_version),
    anchor_selection: anchorSelection(raw.anchor_selection),
  };
}

/**
 * The per-row explain block, fetched only when a modal opens.
 *
 * Both boards expose it under their own collection, and the response is
 * accepted either flat or wrapped in `{ explain: … }` so a wrapper change on the
 * API side cannot blank the modal.
 */
export async function getRankingExplain(
  board: RankingBoardId,
  rowId: string
): Promise<RankingExplain> {
  const collection = board === "seasons" ? "seasons" : "peaks";
  const body = await apiFetch<Record<string, unknown>>(
    `/api/v1/${collection}/${encodeURIComponent(rowId)}/explain`
  );
  const inner = (body.explain ?? body) as Record<string, unknown>;
  return normalizeRankingExplain(inner);
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
