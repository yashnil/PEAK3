/**
 * `RankingComponentKey` → V2 tone/label, in the fixed order the reference
 * uses everywhere a screen enumerates all five real PEAK3 components
 * (Statistical Impact, Traditional Production, Individual Recognition,
 * Playoff Rate Impact, Team Result). One source, reused by every V2 surface
 * that renders a five-component `PeakV2DataLane` breakdown (Peak Duel, RUN
 * THE TABLE) instead of five near-identical local maps drifting apart.
 */

import type { RankingComponentKey } from "@/types";
import type { V2ComponentTone } from "@/components/v2/v2-tone";

export const RANKING_COMPONENT_ORDER: readonly RankingComponentKey[] = [
  "statistical_impact",
  "traditional_production",
  "individual_recognition",
  "postseason_individual_value",
  "team_achievement",
];

export const RANKING_COMPONENT_TONE: Record<RankingComponentKey, V2ComponentTone> = {
  statistical_impact: "si",
  traditional_production: "tp",
  individual_recognition: "rec",
  postseason_individual_value: "po",
  team_achievement: "team",
};

export const RANKING_COMPONENT_LABEL: Record<RankingComponentKey, string> = {
  statistical_impact: "Statistical Impact",
  traditional_production: "Traditional Production",
  individual_recognition: "Individual Recognition",
  postseason_individual_value: "Playoff Rate Impact",
  team_achievement: "Team Result",
};
