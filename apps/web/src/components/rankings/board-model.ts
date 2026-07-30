/**
 * Phase 9C: the shared vocabulary of the rankings section.
 *
 * The two boards (Peak Windows, Single Seasons) publish the same row shape, so
 * the column set, the abbreviations and the sort comparator live here once
 * instead of being re-derived per board. Colours and long labels are NOT
 * redefined here -- they come from `componentColor`/`componentLabel` in
 * `@/lib/utils`, which is the single colour map for the whole app.
 *
 * The abbreviations (SI/TP/REC/PO/TEAM) are only ever rendered next to their
 * spelled-out label (legend, column tooltip, or sr-only text). An unexplained
 * acronym in a header is the thing this overhaul is fixing.
 */

import type { RankingComponentKey, RankingRow } from "@/types";
import { componentLabel } from "@/lib/utils";

export const RANKING_COMPONENT_KEYS: readonly RankingComponentKey[] = [
  "statistical_impact",
  "traditional_production",
  "individual_recognition",
  "postseason_individual_value",
  "team_achievement",
];

export const COMPONENT_ABBR: Record<RankingComponentKey, string> = {
  statistical_impact: "SI",
  traditional_production: "TP",
  individual_recognition: "REC",
  postseason_individual_value: "PO",
  team_achievement: "TEAM",
};

/** `rank` is the board's own PEAK ordering -- the default, and the only column
 *  that sorts ascending first. */
export type RankingSortKey = "rank" | "total" | RankingComponentKey;

export type SortDirection = "asc" | "desc";

export const DEFAULT_SORT_KEY: RankingSortKey = "rank";
export const DEFAULT_SORT_DIRECTION: SortDirection = "asc";

export interface RankingColumn {
  key: RankingSortKey;
  /** Short header text. */
  abbr: string;
  /** Spelled-out name, used in the legend, the select and the sr-only header text. */
  full: string;
  /** Which direction a fresh click on this column applies. */
  initialDirection: SortDirection;
  /** Tailwind visibility classes -- component columns are desktop-only. */
  cellClass?: string;
}

export const RANKING_COLUMNS: readonly RankingColumn[] = [
  { key: "rank", abbr: "PEAK", full: "PEAK rank", initialDirection: "asc" },
  { key: "total", abbr: "Total", full: "Total score", initialDirection: "desc" },
  ...RANKING_COMPONENT_KEYS.map(
    (key): RankingColumn => ({
      key,
      abbr: COMPONENT_ABBR[key],
      full: componentLabel(key),
      initialDirection: "desc",
      cellClass: "hidden lg:table-cell",
    })
  ),
];

export function isDefaultSort(key: RankingSortKey, direction: SortDirection): boolean {
  return key === DEFAULT_SORT_KEY && direction === DEFAULT_SORT_DIRECTION;
}

/** The value a column sorts on. `null` means "this row has no value here" and
 *  always sinks to the bottom, in either direction -- a missing component is not
 *  a zero. */
export function sortValue(row: RankingRow, key: RankingSortKey): number | null {
  if (key === "rank") return row.rank;
  if (key === "total") return row.prime_score ?? row.prime_index;
  return row.components?.[key] ?? null;
}

export function sortRankingRows(
  rows: readonly RankingRow[],
  key: RankingSortKey,
  direction: SortDirection
): RankingRow[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    if (av === null && bv === null) return a.rank - b.rank;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av !== bv) return (av - bv) * sign;
    // Stable, explainable tiebreak: the board's own ordering.
    return a.rank - b.rank;
  });
}

/** Whether ANY loaded row carries component contributions. Drives whether the
 *  component columns exist at all -- a board without them shows no empty
 *  columns and no unsortable headers. */
export function hasComponents(rows: readonly RankingRow[]): boolean {
  return rows.some((row) => row.components !== null);
}

export function hasPercentiles(rows: readonly RankingRow[]): boolean {
  return rows.some((row) => row.percentiles !== null);
}

export function formatScore1(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : "—";
}

export function formatScore2(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—";
}

/** "98th", "3rd", "1st" -- an ordinal reads as a rank statement, which is what a
 *  percentile is. Returns null when there is nothing to render. */
export function formatPercentile(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  const suffix =
    rounded % 100 >= 11 && rounded % 100 <= 13
      ? "th"
      : rounded % 10 === 1
        ? "st"
        : rounded % 10 === 2
          ? "nd"
          : rounded % 10 === 3
            ? "rd"
            : "th";
  return `${rounded}${suffix}`;
}
