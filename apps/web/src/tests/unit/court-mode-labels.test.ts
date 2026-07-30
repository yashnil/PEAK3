import { describe, it, expect } from "vitest";
import { COURT_MODE_LABELS, type CourtMode } from "@/types/perfect-season";
import { MODE_LABELS } from "@/types/draft";

/** The three board ids, spelled out rather than derived from the map under
 *  test, so a dropped key fails instead of silently shrinking the loop. */
const COURT_MODES: CourtMode[] = ["apex_1y", "prime_3y", "foundation_5y"];

/**
 * Phase 10C: the flagship 82-0 surfaces must not carry retired 1Y/3Y/5Y
 * game-mode branding.
 *
 * Covered here rather than in e2e because the two remaining consumers of this
 * map are awkward to reach from a browser test: the 82-0 leaderboard sits
 * behind PEAK3_COURTBUILDER_LEADERBOARD_ENABLED (false in local dev), and run
 * history needs a signed-in account with saved runs. The label vocabulary is
 * pure data, so asserting the map directly is both faster and stricter than
 * trying to render those pages. The *start gate* case is genuinely
 * user-visible and is covered in e2e/play-routing.spec.ts.
 */

const RETIRED_MODE_NAMES = ["1Y Apex", "3Y Prime", "5Y Foundation"];

describe("COURT_MODE_LABELS (flagship 82-0 vocabulary)", () => {
  it("names no board variant with a retired game-mode name", () => {
    for (const label of Object.values(COURT_MODE_LABELS)) {
      expect(RETIRED_MODE_NAMES).not.toContain(label);
    }
  });

  it("labels the standard board as 82-0, not as a peak-window duration", () => {
    expect(COURT_MODE_LABELS.apex_1y).toBe("Standard 82-0");
  });

  it("still labels every board id, so no surface can fall back to a raw id", () => {
    for (const mode of COURT_MODES) {
      const label = COURT_MODE_LABELS[mode];
      expect(label, `${mode} needs a user-facing label`).toBeTruthy();
      // A label equal to the id would mean the `?? mode` fallbacks in the
      // history and leaderboard views are printing internals at users.
      expect(label).not.toBe(mode);
    }
  });

  it("gives each board variant a distinct label", () => {
    // The leaderboard renders these as a three-way filter, so duplicates would
    // produce indistinguishable buttons.
    const labels = Object.values(COURT_MODE_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("claims no multi-season window, which the exact-season board never builds", () => {
    // On the exact-team-season path a mode's duration is recorded only as the
    // board's `duration_years`; candidates come from the rolled team-season's
    // real roster, so every card is a single exact season. A label like
    // "3-Year Peak" would describe a window that does not exist here.
    for (const label of Object.values(COURT_MODE_LABELS)) {
      expect(label).not.toMatch(/\b(year|season)s?\s+(peak|window|prime)\b/i);
    }
  });

  it("does not disturb the legacy Peak Draft labels, which keep their names", () => {
    // The retired modes still exist at /arena/labs and are still tested there.
    // This is the counter-assertion: the cleanup was scoped to the flagship
    // surfaces, not applied across the product.
    expect(MODE_LABELS.apex_1y).toBe("1Y Apex");
    expect(MODE_LABELS.prime_3y).toBe("3Y Prime");
    expect(MODE_LABELS.foundation_5y).toBe("5Y Foundation");
  });

  it("keeps the internal board ids unchanged for saved runs and history", () => {
    // Renaming these would orphan every saved run, leaderboard row and
    // bookmarked URL. Only the display text was allowed to move.
    expect(Object.keys(COURT_MODE_LABELS).sort()).toEqual(
      ["apex_1y", "foundation_5y", "prime_3y"],
    );
  });
});
