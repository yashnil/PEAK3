"use client";

import { DNA_LABELS, type LineupDNA } from "@/types/draft";
import DNARadar from "@/components/draft/DNARadar";

/**
 * The five-component radar for a REVEALED card.
 *
 * *** THIS IS NEVER RENDERED BEFORE A ROUND RESOLVES, AND IT CANNOT BE. ***
 *
 * The brief asked for a component silhouette during bidding. That is not
 * buildable without breaking the mode's central rule, and the reason is worth
 * stating rather than quietly working around: the server's pre-reveal payload
 * (`Candidate.public_dict`) contains identity and position eligibility and
 * NOTHING ELSE. There is no component data on the client to draw from, by
 * construction. A silhouette is a picture of the components; drawing one early
 * would mean shipping them early, and a normalised shape is still derived from
 * the hidden values -- a bidder who could see that a card is
 * recognition-heavy and postseason-heavy has been told most of what they were
 * supposed to be judging.
 *
 * So the radar is the REVEAL, not the prompt. It is the dramatic beat when a
 * round resolves and in the final receipt, which is also where it carries the
 * most meaning: you find out what you actually bought.
 *
 * WHY THIS WRAPS `DNARadar` RATHER THAN REPLACING IT. `DNARadar` is the house's
 * pure-SVG radar (no chart library) and its geometry, ring guides and
 * accessibility treatment are the ones to reuse. What could not be reused
 * as-is is its INPUT: `LineupDNA` names six dimensions from the Peak Draft
 * model, and this board publishes five PEAK3 components under different names.
 * The mapping below is 1:1 and documented in `types/draft.ts` itself, where
 * each `LineupDNA` field already records the component it derives from.
 *
 * The values are the SERVER's `component_index` (0-100, normalised in Python
 * against the pool's own min/max). Nothing is rescaled here -- the same
 * discipline `LaneProfile.tsx` states for RTT lanes.
 */

/** The sixth axis. This board has five components, so the radar's sixth
 *  dimension is pinned to the card's data completeness rather than being left
 *  to render as a zero -- a spike collapsing to the origin would read as "this
 *  player scored nothing here" instead of "this axis does not apply". */
const DATA_COMPLETE = 100;

export interface ComponentSilhouetteProps {
  /** Server-normalised 0-100 per component. */
  componentIndex: Record<string, number>;
  size?: number;
  color?: string;
}

export function toLineupDNA(componentIndex: Record<string, number>): LineupDNA {
  return {
    primary_creation: componentIndex.statistical_impact ?? 0,
    scoring_pressure: componentIndex.traditional_production ?? 0,
    individual_validation: componentIndex.individual_recognition ?? 0,
    postseason_translation: componentIndex.postseason_individual_value ?? 0,
    team_context: componentIndex.team_achievement ?? 0,
    context_completeness: DATA_COMPLETE,
  };
}

export default function ComponentSilhouette({
  componentIndex,
  size = 132,
  color = "var(--peak-accent)",
}: ComponentSilhouetteProps) {
  const dna = toLineupDNA(componentIndex);
  return (
    <figure className="td-silhouette" data-testid="td-component-silhouette">
      <DNARadar dna={dna} size={size} color={color} />
      <figcaption className="td-silhouette-caption">
        {Object.keys(DNA_LABELS).length} axes &middot; five PEAK3 components plus
        data completeness
      </figcaption>
    </figure>
  );
}
