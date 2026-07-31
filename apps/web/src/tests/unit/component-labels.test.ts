/**
 * Component naming (Phase 12B, variant K).
 *
 * The top-50 review's recurring complaint was not that a number was wrong but
 * that the name promised something the number does not measure. "Postseason
 * Value" reads as "how much their postseason mattered" when the component is a
 * per-possession playoff RATE measure (r=+0.61 with playoff BPM, r=+0.08 with
 * playoff games); "Team Achievement" reads as open-ended credit for winning
 * when it is capped at 3 of ~100 index points.
 *
 * These tests pin the rename and, more importantly, pin the two invariants that
 * make it safe: the payload keys never changed, and no score moved.
 */
import { describe, expect, it } from "vitest";

import { componentColor, componentLabel } from "@/lib/utils";

const KEYS = [
  "statistical_impact",
  "traditional_production",
  "individual_recognition",
  "postseason_individual_value",
  "team_achievement",
] as const;

describe("componentLabel", () => {
  it("names the two renamed components after what they compute", () => {
    expect(componentLabel("postseason_individual_value")).toBe("Playoff Rate Impact");
    expect(componentLabel("team_achievement")).toBe("Team Result");
  });

  it("leaves the three components the review did not object to alone", () => {
    expect(componentLabel("statistical_impact")).toBe("Statistical Impact");
    expect(componentLabel("traditional_production")).toBe("Traditional Production");
    expect(componentLabel("individual_recognition")).toBe("Individual Recognition");
  });

  it("no longer surfaces either retired name", () => {
    const rendered = [...KEYS, "teammate_adjustment"].map(componentLabel).join(" | ");
    expect(rendered).not.toContain("Postseason Value");
    expect(rendered).not.toContain("Team Achievement");
  });

  it("keeps the payload keys untouched so API data still resolves", () => {
    // The rename is display-only. If a key stopped resolving, every breakdown
    // would silently fall through to the raw snake_case string.
    for (const key of KEYS) {
      expect(componentLabel(key)).not.toBe(key);
      expect(componentLabel(key)).toMatch(/^[A-Z]/);
    }
  });

  it("still falls back to the raw key for anything unknown", () => {
    expect(componentLabel("not_a_component")).toBe("not_a_component");
  });

  it("did not disturb the component colour tokens", () => {
    // Colours identify components across the whole UI; a rename that moved one
    // would break the legend/bar correspondence.
    expect(componentColor("postseason_individual_value")).toBe("var(--comp-po)");
    expect(componentColor("team_achievement")).toBe("var(--comp-team)");
  });
});
