import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { todayPacific } from "@/lib/daily-time";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatSeason(season: string): string {
  return season;
}

export function formatWindowRange(start: string, end: string): string {
  if (start === end) return start;
  // "1990-91" to "1991-92" → "1990–92"
  const startYear = start.split("-")[0];
  const endYearShort = end.split("-")[1];
  return `${startYear}–${endYearShort}`;
}

export function formatScore(score: number): string {
  return score.toFixed(1);
}

export function formatIndex(index: number): string {
  return index.toFixed(2);
}

/**
 * Today's daily key, in the product-wide reset zone.
 *
 * @deprecated Misnamed since the daily reset moved to midnight
 * America/Los_Angeles. It now delegates to `todayPacific` in `lib/daily-time.ts`
 * and is kept only so no caller breaks mid-rename.
 *
 * More importantly: this value is a LOCAL FALLBACK for purely client-side
 * lookups (which localStorage bucket is today's). It must never be sent to the
 * server as `?date=`. The server owns what day it is; a browser-computed
 * "today" put a device one timezone ahead on tomorrow's board and left a stale
 * tab playing yesterday's forever.
 */
export function todayUTC(): string {
  return todayPacific();
}

/** Derive a short stable key from a challenge token for localStorage storage. */
export function challengeTokenKey(token: string): string {
  // Use first 20 chars of btoa — not secure, just for local disambiguation
  try {
    return btoa(token).slice(0, 20).replace(/[+/=]/g, "_");
  } catch {
    return token.slice(0, 20);
  }
}

export function difficultyColor(difficulty: string): string {
  switch (difficulty) {
    case "Photo Finish": return "text-amber-400";
    case "Brutal": return "text-red-400";
    case "Tricky": return "text-orange-400";
    case "Comfortable": return "text-emerald-400";
    default: return "text-zinc-400";
  }
}

/**
 * The display name for a scoring component.
 *
 * Phase 12B renamed two of them (variant K in
 * docs/model/PEAK3_FORMULA_VARIANT_EXPERIMENTS.md). The old names described
 * what the components were FOR; the new ones describe what they actually
 * COMPUTE, which is where nearly every trust complaint in the top-50 review
 * came from:
 *
 *   "Postseason Value" -> "Playoff Rate Impact"
 *      It measures per-possession play in the playoffs. Measured over all
 *      5,756 playoff player-seasons it correlates r=+0.61 with playoff BPM and
 *      only r=+0.08 with playoff GAMES -- so a 12-game run and a 23-game run
 *      score alike, and a Finals-run MVP can score near zero. Calling it
 *      "Postseason Value" invited the reading "how much did their postseason
 *      matter", which is not the question it answers.
 *
 *   "Team Achievement" -> "Team Result"
 *      It is team advancement times a role multiplier, capped at 3 points.
 *      "Achievement" reads like a judgement; "Result" is what it is.
 *
 * These are LABELS ONLY. No score, weight or ordering changed -- see the
 * calibration diagnosis for the evidence that no formula change was warranted.
 * The underlying keys are untouched, so API payloads and stored data are
 * unaffected.
 */
export function componentLabel(key: string): string {
  const labels: Record<string, string> = {
    statistical_impact: "Statistical Impact",
    traditional_production: "Traditional Production",
    individual_recognition: "Individual Recognition",
    postseason_individual_value: "Playoff Rate Impact",
    team_achievement: "Team Result",
    teammate_adjustment: "Teammate Adj.",
  };
  return labels[key] ?? key;
}

export function componentColor(key: string): string {
  const colors: Record<string, string> = {
    statistical_impact: "var(--comp-si)",
    traditional_production: "var(--comp-tp)",
    individual_recognition: "var(--comp-rec)",
    postseason_individual_value: "var(--comp-po)",
    team_achievement: "var(--comp-team)",
    teammate_adjustment: "var(--comp-tm)",
  };
  return colors[key] ?? "var(--peak-accent)";
}

/**
 * The text-safe sibling of `componentColor` (P3-G2). `--comp-*` is frozen
 * (CLAUDE.md) and measures 1.8-2.6:1 as literal text against Arena Day's
 * surfaces -- failing WCAG AA at every size. Use THIS for any rendered
 * component percentage/score number or label; keep `componentColor` for a
 * bar fill, border, or swatch, where the frozen value is exactly right.
 */
export function componentTextColor(key: string): string {
  const colors: Record<string, string> = {
    statistical_impact: "var(--comp-si-text)",
    traditional_production: "var(--comp-tp-text)",
    individual_recognition: "var(--comp-rec-text)",
    postseason_individual_value: "var(--comp-po-text)",
    team_achievement: "var(--comp-team-text)",
    teammate_adjustment: "var(--comp-tm-text)",
  };
  return colors[key] ?? "var(--peak-accent-text)";
}
