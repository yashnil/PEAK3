/**
 * Constraint category -> the app's existing component colour tokens
 * (CLAUDE.md "Component color tokens"). Reused rather than invented so a
 * "Top 10% Statistical Impact" header is the same blue as Statistical Impact
 * everywhere else in the product.
 */
import { ConstraintCategory, RarityBucket } from "@/types/daily-grid";

export const CATEGORY_COLOR: Record<ConstraintCategory, string> = {
  team: "var(--comp-team)", // emerald -- Team Achievement
  award: "var(--comp-rec)", // pink -- Individual Recognition
  era: "var(--comp-tm)", // slate -- neutral, era is not a component
  position: "var(--comp-po)", // orange
  context: "var(--comp-tm)", // slate -- season shape, not a component
  peak: "var(--peak-accent)", // gold -- the PEAK score itself
  component: "var(--comp-si)", // blue -- Statistical Impact family
  outcome: "var(--comp-tp)", // violet
};

export const CATEGORY_LABEL: Record<ConstraintCategory, string> = {
  team: "Franchise",
  award: "Award",
  era: "Era",
  position: "Position",
  context: "Season context",
  peak: "PEAK score",
  component: "Model component",
  outcome: "Team outcome",
};

export function categoryColor(category: ConstraintCategory): string {
  return CATEGORY_COLOR[category] ?? "var(--text-secondary)";
}

/** Rarer squares read hotter. Kept low-alpha -- this is a hint, not a scoreboard. */
export const RARITY_COLOR: Record<RarityBucket, string> = {
  very_rare: "var(--comp-po)",
  rare: "var(--peak-accent)",
  uncommon: "var(--comp-tm)",
  common: "var(--text-muted)",
  very_common: "var(--text-muted)",
};
