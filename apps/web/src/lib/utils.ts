import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

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

export function todayUTC(): string {
  return new Date().toISOString().split("T")[0];
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

export function componentLabel(key: string): string {
  const labels: Record<string, string> = {
    statistical_impact: "Statistical Impact",
    traditional_production: "Traditional Production",
    individual_recognition: "Individual Recognition",
    postseason_individual_value: "Postseason Value",
    team_achievement: "Team Achievement",
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
