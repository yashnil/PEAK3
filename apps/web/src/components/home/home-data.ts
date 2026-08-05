/**
 * Server-side data the homepage needs, and nothing else.
 *
 * Three things are read here, all from the read-only API, all optional:
 *
 *   1. PROVENANCE for `ModelProofStrip`. Every number on that strip is a real
 *      field from `/api/v1/meta` (the generated `data/web/metadata.json`) or
 *      from the `/api/v1/peaks` response envelope. Nothing is hardcoded and
 *      nothing is derived — a field the API does not send becomes `null` and
 *      the strip omits that fact rather than inventing one. W6 is enriching
 *      provenance in parallel; this degrades to "show less" if a field moves.
 *
 *   2. REAL PEAK WINDOWS for `HeroVignette`. The hero shows actual top-ranked
 *      3-year peak windows with their actual weighted component contributions,
 *      because the brief asks for exact peak cards as the hero's visual content
 *      rather than giant typography. They are the model's own rank order — no
 *      player is hand-picked (CLAUDE.md forbids it).
 *
 *   3. REAL COMPONENT EXPLANATIONS for `ComponentComparison` (P3-H, the
 *      interactive comparison SYNTHESIS_CONTRACT.md §7 asks for). Every
 *      explanation string is the same `/api/v1/methodology` payload
 *      `/rankings`'s own `ScoreExplainModal` renders — never re-authored
 *      copy that could drift from the real methodology text.
 *
 * Every fetch is individually guarded: the homepage must render, and its
 * launcher must work, with the API completely down.
 */

import { getMetadata, getMethodology, getPeakWindowBoard } from "@/lib/api";
import type { Methodology, RankingComponentKey } from "@/types";
import type { NbaFactView } from "@/components/home/NbaFactOfTheDay";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * Today's NBA fact, chosen server-side by calendar date.
 *
 * FAIL-CLOSED, like every other fetch on this page. A checkout or a deploy
 * whose fact bank is missing serves a 503 here, and a homepage that 500s
 * because a trivia panel has no data would be worse than a homepage without
 * the panel. `null` renders nothing -- never a fabricated fact.
 *
 * `no-store`, AND THAT IS LOAD-BEARING RATHER THAN A PREFERENCE. Two reasons,
 * the second learned the hard way:
 *
 *   1. The fact changes at UTC midnight, so any revalidate window would serve
 *      yesterday's fact for the length of that window.
 *   2. A FAILURE MUST NOT BE CACHED. Staging shipped an image with no fact
 *      bank and this endpoint returned 503 for the whole deploy. With a cached
 *      fetch, the homepage would have gone on rendering that absence after the
 *      API was fixed, and recovery would have needed a redeploy of the
 *      frontend. With `no-store` every request re-asks, so the panel returns on
 *      its own the moment the API is healthy -- no source change, no rebuild.
 *
 * The response is a few hundred bytes and the route reads an in-process cache,
 * so re-asking every request is cheap.
 */
export async function loadNbaFactOfTheDay(): Promise<NbaFactView | null> {
  try {
    const response = await fetch(`${API_BASE}/api/v1/nba-facts/today`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as NbaFactView;
  } catch {
    return null;
  }
}

/** One peak window, reduced to exactly what the vignette draws. */
export interface VignetteWindow {
  rank: number;
  rowId: string;
  playerName: string;
  /** "1988-89 to 1990-91" — the window span, straight from the API. */
  label: string;
  team: string | null;
  primeScore: number | null;
  /** Weighted contribution per official component, `null` when absent. */
  components: Record<RankingComponentKey, number | null> | null;
}

/**
 * Provenance facts. Every field is nullable on purpose: `ModelProofStrip`
 * renders only what actually arrived.
 */
export interface HomeModelProof {
  /** Human label from the API envelope ("PEAK3 v1"), preferred for display. */
  modelLabel: string | null;
  /** Machine version from `metadata.json` ("peak3-v1"). */
  modelVersion: string | null;
  /** Whether the served board is the default model rather than a preview. */
  isDefaultModel: boolean;
  startSeason: string | null;
  endSeason: string | null;
  /** Distinct players in the evaluated universe (`universe_identity_count`). */
  playersEvaluated: number | null;
  /** Ranked peak windows in the exported dataset (`peak_window_count`). */
  rankedWindows: number | null;
  /** ISO timestamp the dataset was exported (`generated_at`). */
  generatedAt: string | null;
}

export interface HomeModelData {
  proof: HomeModelProof;
  windows: VignetteWindow[];
  /** `null` when `/api/v1/methodology` could not be reached — the
   *  comparison section renders nothing rather than inventing copy. */
  methodology: Methodology | null;
}

const EMPTY_PROOF: HomeModelProof = {
  modelLabel: null,
  modelVersion: null,
  isDefaultModel: true,
  startSeason: null,
  endSeason: null,
  playersEvaluated: null,
  rankedWindows: null,
  generatedAt: null,
};

/** How many windows the hero deck holds. Three is the depth the stack shows. */
const VIGNETTE_COUNT = 3;

export async function loadHomeModelData(): Promise<HomeModelData> {
  const [metaResult, boardResult, methodologyResult] = await Promise.allSettled([
    getMetadata(),
    getPeakWindowBoard("3y", { limit: VIGNETTE_COUNT }),
    getMethodology(),
  ]);

  const meta = metaResult.status === "fulfilled" ? metaResult.value : null;
  const board = boardResult.status === "fulfilled" ? boardResult.value : null;
  const methodology = methodologyResult.status === "fulfilled" ? methodologyResult.value : null;

  const proof: HomeModelProof = {
    ...EMPTY_PROOF,
    modelLabel: board?.meta.model_label ?? null,
    modelVersion: meta?.model_version ?? board?.meta.model_version ?? null,
    isDefaultModel: board?.meta.is_default_model ?? true,
    startSeason: board?.meta.supported_start_season ?? null,
    endSeason: board?.meta.supported_end_season ?? null,
    playersEvaluated: board?.meta.universe_identity_count ?? null,
    rankedWindows:
      typeof meta?.peak_window_count === "number" ? meta.peak_window_count : null,
    generatedAt: meta?.generated_at ?? null,
  };

  const windows: VignetteWindow[] = (board?.rows ?? [])
    .slice(0, VIGNETTE_COUNT)
    .map((row) => ({
      rank: row.rank,
      rowId: row.row_id,
      playerName: row.player_name,
      label: row.label,
      team: row.team,
      primeScore: row.prime_score,
      components: row.components,
    }));

  return { proof, windows, methodology };
}
