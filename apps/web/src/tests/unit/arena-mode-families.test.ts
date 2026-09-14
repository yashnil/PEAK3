/**
 * Three-Man Weave is ONE game with three rulesets, on every surface that lists
 * games.
 *
 * The defect: Franchise Draft and Decade Draft were added as further entries
 * beside Three-Man Weave, so the lobby, the Play menu and the hub read as three
 * unrelated games. Grouping now comes from one place (`groupModeFamilies`, over
 * the catalogue's `variantOf`), and these tests pin that each surface's DATA
 * nests the rulesets under the game instead of listing them beside it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ARENA_MODES,
  familyIdOf,
  familyRulesets,
  groupModeFamilies,
  variantLabelOf,
} from "@/lib/arena-modes";
import { getArenaCatalogue } from "@/lib/arena-readiness-server";
import {
  allGameHrefs,
  allNavHrefs,
  flattenNavItems,
  isActive,
  navGroups,
  navModelIssues,
} from "@/lib/nav-model";

afterEach(() => vi.unstubAllGlobals());

describe("groupModeFamilies", () => {
  it("folds every ruleset into its parent's family, parent first", () => {
    const families = groupModeFamilies(ARENA_MODES);
    const weave = families.find((f) => f.id === "three_man_weave");
    expect(weave?.name).toBe("Three-Man Weave");
    expect(weave?.variants.map((m) => m.id)).toEqual([
      "three_man_weave",
      "three_man_weave_franchise",
      "three_man_weave_decade",
    ]);
    expect(weave?.variants.map(variantLabelOf)).toEqual(["Classic", "Franchise Draft", "Decade Draft"]);
    // Every mode lands in exactly one family, and no family is a ruleset.
    expect(families.flatMap((f) => f.variants)).toHaveLength(ARENA_MODES.length);
    for (const family of families) expect(modeIsParentless(family.id)).toBe(true);
  });

  it("keeps the order families first appear in, so the lobby's layout is the catalogue's", () => {
    const ids = groupModeFamilies(ARENA_MODES).map((f) => f.id);
    const firstSeen = [...new Set(ARENA_MODES.map(familyIdOf))];
    expect(ids).toEqual(firstSeen);
  });

  it("forms a family from its rulesets alone, still named after the game", () => {
    const onlyVariants = ARENA_MODES.filter((m) => m.variantOf === "three_man_weave").reverse();
    const [family] = groupModeFamilies(onlyVariants);
    expect(family.name).toBe("Three-Man Weave");
    expect(family.parent?.id).toBe("three_man_weave");
    expect(family.variants.map((m) => m.id).sort()).toEqual([
      "three_man_weave_decade",
      "three_man_weave_franchise",
    ]);
  });

  it("gives every ruleset in a family a short label and a menu-sized line", () => {
    for (const family of groupModeFamilies(ARENA_MODES).filter((f) => f.variants.length > 1)) {
      for (const mode of family.variants) {
        expect(mode.variantLabel, mode.id).toBeTruthy();
        expect(mode.variantSummary?.split(/\s+/).length ?? 99, mode.id).toBeLessThanOrEqual(8);
      }
      expect(family.parent?.family?.tagline).toBeTruthy();
      expect(family.parent?.family?.description.length ?? 0).toBeGreaterThan(40);
    }
  });
});

function modeIsParentless(id: string): boolean {
  return ARENA_MODES.some((m) => m.id === id && !m.variantOf) || !ARENA_MODES.some((m) => m.id === id);
}

describe("the Play menu nests a game's rulesets under one row", () => {
  const multiplayer = () => navGroups().find((g) => g.id === "multiplayer")!;

  it("lists Three-Man Weave once, with Classic, Franchise Draft and Decade Draft beneath it", () => {
    const items = multiplayer().items;
    expect(items.map((i) => i.modeId)).toEqual(["three-man-weave", "twenty-dollar"]);
    const weave = items[0];
    expect(weave.children?.map((c) => c.label)).toEqual(["Classic", "Franchise Draft", "Decade Draft"]);
    expect(weave.children?.map((c) => c.href)).toEqual(
      familyRulesets("three_man_weave").map((m) => `/arena/lobby?game=${m.id}`),
    );
    // The game row itself is the family, not its Classic ruleset.
    expect(weave.href).toBe("/arena/lobby?family=three_man_weave");
    expect(items[1].children).toBeUndefined();
  });

  it("holds nested rows to every invariant a top-level row meets", () => {
    expect(navModelIssues()).toEqual([]);
    const children = multiplayer().items.flatMap((i) => i.children ?? []);
    for (const child of children) {
      expect(allNavHrefs()).toContain(child.href);
      expect(allGameHrefs()).toContain(child.href);
      expect(child.blurb).toBeTruthy();
    }
    expect(flattenNavItems(multiplayer().items)).toHaveLength(2 + children.length);
  });

  it("marks only the ruleset you are on as current", () => {
    const weave = multiplayer().items[0];
    const current = flattenNavItems([weave]).filter((item) =>
      isActive("/arena/lobby", item, "game=three_man_weave_decade"),
    );
    expect(current.map((item) => item.label)).toEqual(["Decade Draft"]);
    expect(isActive("/arena/lobby", weave, "family=three_man_weave")).toBe(true);
  });
});

describe("the Arena catalogue carries a family's served rulesets", () => {
  function serve(modes: Array<{ id: string; seat_count: number }>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ arena_enabled: true, modes }) }) as Response),
    );
  }

  it("attaches Classic, Franchise Draft and Decade Draft to the one Weave entry", async () => {
    serve([
      { id: "three_man_weave", seat_count: 3 },
      { id: "three_man_weave_franchise", seat_count: 3 },
      { id: "three_man_weave_decade", seat_count: 3 },
      { id: "twenty_dollar", seat_count: 2 },
    ]);
    const { modes } = await getArenaCatalogue();
    expect(modes.map((m) => m.id)).toEqual(["three_man_weave", "twenty_dollar"]);
    const [weave, showdown] = modes;
    expect(weave.name).toBe("Three-Man Weave");
    expect(weave.href).toBe("/arena/lobby?family=three_man_weave");
    expect(weave.variants?.map((v) => [v.label, v.href])).toEqual([
      ["Classic", "/arena/lobby?game=three_man_weave"],
      ["Franchise Draft", "/arena/lobby?game=three_man_weave_franchise"],
      ["Decade Draft", "/arena/lobby?game=three_man_weave_decade"],
    ]);
    expect(showdown.variants).toBeUndefined();
    expect(showdown.href).toBe("/arena/lobby?game=twenty_dollar");
  });

  it("lists only the rulesets the server serves, and a lone ruleset as a plain game", async () => {
    serve([
      { id: "three_man_weave", seat_count: 3 },
      { id: "three_man_weave_decade", seat_count: 3 },
    ]);
    let [weave] = (await getArenaCatalogue()).modes;
    expect(weave.variants?.map((v) => v.id)).toEqual(["three_man_weave", "three_man_weave_decade"]);

    serve([{ id: "three_man_weave", seat_count: 3 }]);
    [weave] = (await getArenaCatalogue()).modes;
    expect(weave.variants).toBeUndefined();
    expect(weave.href).toBe("/arena/lobby?game=three_man_weave");
  });
});
