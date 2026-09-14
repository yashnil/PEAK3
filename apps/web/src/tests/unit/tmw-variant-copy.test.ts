import { describe, expect, it } from "vitest";

import { modeMeta } from "@/lib/arena-modes";
import { rollScopeLine } from "@/lib/three-man-weave-state";
import type { TmwRoll } from "@/types/three-man-weave";

const roll = (extra: Partial<TmwRoll>): TmwRoll => ({
  round_number: 1,
  roll_id: "r1",
  franchise_id: "CHI",
  franchise_display_name: "Chicago Bulls",
  decade: "1990s",
  eligible_slugs: [],
  candidates: [],
  ...extra,
});

describe("what a Three-Man Weave roll asked for", () => {
  it("names both halves of a standard roll", () => {
    expect(rollScopeLine(roll({}))).toBe("the Chicago Bulls in the 1990s");
  });

  it("names only the franchise in a Franchise Draft", () => {
    expect(rollScopeLine(roll({ variant: "franchise", decade: "All decades" }))).toBe(
      "the Chicago Bulls, in any decade",
    );
  });

  it("names only the decade in a Decade Draft", () => {
    expect(
      rollScopeLine(roll({ variant: "decade", franchise_id: "ANY", franchise_display_name: "All franchises" })),
    ).toBe("the 1990s, on any franchise");
  });

  it("falls back when there is no roll", () => {
    expect(rollScopeLine(null)).toBe("this roll");
  });

  it("catalogues both variants as their own named rulesets", () => {
    expect(modeMeta("three_man_weave_franchise")?.name).toMatch(/Franchise Draft/);
    expect(modeMeta("three_man_weave_decade")?.name).toMatch(/Decade Draft/);
  });
});
