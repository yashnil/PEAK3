/**
 * Copy for Arena standings — every withheld number becomes a sentence.
 *
 * Pure functions of server data, so the honest-empty and low-population states
 * are testable without rendering. Nothing here computes a rank, tier or
 * percentile; it only words what the server decided, and it never invents a
 * population ("3 rated players so far" is the server's count, not an estimate).
 */

import { modeMeta } from "@/lib/arena-modes";
import type { ArenaPopulation, ArenaSkill, SkillReason } from "@/lib/arena-leaderboard-api";

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/**
 * The human-facing name for a mode id. The catalogue name when this build
 * knows the mode; otherwise a readable form of the id, so a mode the server
 * registered after this build shipped still gets a labelled board.
 */
export function modeLabel(modeId: string): string {
  const known = modeMeta(modeId)?.name;
  if (known) return known;
  return modeId
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatRating(rating: number | null | undefined): string {
  return rating == null ? "—" : Math.round(rating).toLocaleString();
}

/** "3 rated players so far — percentiles appear at 30." / null when empty. */
export function populationNote(population: ArenaPopulation): string | null {
  const n = population.rated_population;
  if (n === 0) return null;
  if (n < population.percentile_min_population) {
    return `${plural(n, "rated player")} so far — percentiles appear at ${population.percentile_min_population}.`;
  }
  return `${plural(n, "rated player")} in this mode.`;
}

/** Explains rank gaps: rated players without a handle are counted, not shown. */
export function unlistedNote(population: ArenaPopulation): string | null {
  const hidden = population.rated_population - population.total_rated_players;
  if (hidden <= 0) return null;
  return `${plural(hidden, "rated player")} without a public handle ${hidden === 1 ? "is" : "are"} counted in ranks but not listed.`;
}

export function reasonCopy(reason: SkillReason | null, skill: Pick<ArenaSkill, "matches_until_established" | "population">): string {
  switch (reason) {
    case "population_too_small":
      return `${plural(skill.population.rated_population, "rated player")} so far — percentiles appear at ${skill.population.percentile_min_population}.`;
    case "provisional": {
      const left = skill.matches_until_established ?? 0;
      return `Provisional — ${plural(left, "more rated match", "more rated matches")} to establish.`;
    }
    case "not_rated":
      return "Not rated yet. Public matches are rated; practice and private rooms are not.";
    case "ratings_disabled":
      return "Ratings are not being recorded right now.";
    case "leaderboard_disabled":
      return "The public board is closed right now.";
    default:
      return "";
  }
}

/** "Higher than 73% of rated players", or the reason there is no percentile. */
export function percentileCopy(skill: ArenaSkill): string {
  if (skill.percentile != null) {
    return `Higher than ${Math.round(skill.percentile)}% of rated players`;
  }
  return reasonCopy(skill.percentile_reason, skill);
}

/** "6 vs people · 2 with bots" — how a rating was earned. */
export function compositionCopy(allHuman: number, withBots: number): string {
  return `${allHuman.toLocaleString()} vs people · ${withBots.toLocaleString()} with bots`;
}

export function recordCopy(wins: number, losses: number, draws: number): string {
  return draws > 0 ? `${wins}–${losses}–${draws}` : `${wins}–${losses}`;
}
