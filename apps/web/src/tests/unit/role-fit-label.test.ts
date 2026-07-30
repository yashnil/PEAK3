import { describe, expect, it } from "vitest";
import { fitLabel, ROLE_FIT_LABELS, type RoleFit } from "@/types/perfect-season";

/**
 * Phase 9B: fit labeling.
 *
 * The bug this locks down: labeling was keyed on `role_fit` ALONE, so all
 * three off-position severities rendered the same alarming "Off-slot" pill --
 * including the "mild" tier, which the simulator scores at exactly 0.0 points
 * (nba_peak/perfect_season/simulation.py::_OFF_POSITION_SEVERITY_POINTS). The
 * UI was therefore reporting a penalty the model had never charged.
 *
 * `fitLabel` here mirrors `fit_label()` in
 * nba_peak/perfect_season/positions.py, which is the server-side source of
 * truth for this wording -- these tests are the contract that keeps the two
 * from drifting.
 */
describe("fitLabel", () => {
  it("labels the three off-position severities distinctly", () => {
    expect(fitLabel("off_position", "mild")).toBe("Flex fit");
    expect(fitLabel("off_position", "moderate")).toBe("Role stretch");
    expect(fitLabel("off_position", "severe")).toBe("Structural mismatch");
  });

  it("never labels a mild off-position shift with alarming wording", () => {
    const mild = fitLabel("off_position", "mild");
    expect(mild.toLowerCase()).not.toContain("off");
    expect(mild.toLowerCase()).not.toContain("mismatch");
    expect(mild.toLowerCase()).not.toContain("stretch");
  });

  it("falls back to the simulator's own conservative default when severity is unknown", () => {
    // simulation.py::_fit_points defaults a severity-less off_position to
    // "severe" -- the label must never be more forgiving than the score.
    expect(fitLabel("off_position")).toBe("Structural mismatch");
    expect(fitLabel("off_position", null)).toBe("Structural mismatch");
  });

  it("labels primary and natural fits", () => {
    expect(fitLabel("primary")).toBe("Primary fit");
    expect(fitLabel("natural")).toBe("Natural fit");
  });

  it("renders bench slots and missing values as no label at all", () => {
    expect(fitLabel("bench")).toBe("");
    expect(fitLabel(null)).toBe("");
    expect(fitLabel(undefined)).toBe("");
  });

  it("keeps deprecated tokens from already-saved runs renderable", () => {
    // "secondary" was the pre-9B second tier and means the same thing to a
    // user as "natural"; "flexible" was the pre-9B bench token.
    expect(fitLabel("secondary")).toBe("Natural fit");
    expect(fitLabel("flexible")).toBe("");
  });

  it("never reuses the bench token for the mild off-position tier", () => {
    // Guards against the specific temptation of expressing "this shift is
    // fine" as role_fit === "flexible": that token means "bench slot, no
    // position restriction", and conflating them would erase a real
    // distinction in the saved data.
    expect(fitLabel("flexible")).not.toBe(fitLabel("off_position", "mild"));
  });

  it("severity only affects the off-position tier", () => {
    for (const roleFit of ["primary", "natural", "bench"] as RoleFit[]) {
      expect(fitLabel(roleFit, "severe")).toBe(fitLabel(roleFit));
      expect(fitLabel(roleFit, "mild")).toBe(fitLabel(roleFit));
    }
  });

  it("covers every RoleFit token in the deprecated label map", () => {
    // The map is deprecated but still typed as a total Record<RoleFit, ...>,
    // so this fails loudly if a new token is added without a label.
    for (const roleFit of Object.keys(ROLE_FIT_LABELS) as RoleFit[]) {
      expect(typeof fitLabel(roleFit)).toBe("string");
    }
  });
});
