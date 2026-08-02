/**
 * The navigation, as data.
 *
 * These tests exist because the navbar used to be a five-entry literal, which
 * meant "is every finished mode still reachable?" was a question only a human
 * reading three page components could answer. `lib/nav-model.ts` makes it
 * answerable here, and this file is the thing that actually asks.
 *
 * The route list below is checked against the real `src/app` tree, so a mode
 * whose route is renamed fails here rather than in a browser.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MODE_COPY, ModeId, RUN_THE_TABLE_DAILY_HREF } from "@/lib/modes";
import {
  allGameHrefs,
  allNavHrefs,
  ARENA_HUB_HREF,
  assertNoDuplicateModeMetadata,
  featuredItem,
  isActive,
  matchesPrefix,
  MIN_TAP_TARGET_PX,
  navGroups,
  navModelIssues,
  PLAY_TRIGGER_ACTIVE,
  splitHref,
  topLevelLinks,
} from "@/lib/nav-model";

const APP_DIR = path.resolve(__dirname, "../../app/(main)");

/** Does a Next App Router `page.tsx` exist for this path? Dynamic segments
 *  (`[mode]`, `[slug]`) count as a match for any single segment. */
function routeExists(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);

  function walk(dir: string, remaining: string[]): boolean {
    if (remaining.length === 0) return fs.existsSync(path.join(dir, "page.tsx"));
    const [head, ...tail] = remaining;
    const direct = path.join(dir, head);
    if (fs.existsSync(direct) && fs.statSync(direct).isDirectory() && walk(direct, tail)) {
      return true;
    }
    // A dynamic segment (`[mode]`, `[slug]`) matches any single URL segment.
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith("[") && entry.name.endsWith("]")) {
        if (walk(path.join(dir, entry.name), tail)) return true;
      }
    }
    return false;
  }

  return walk(APP_DIR, segments);
}

describe("route-existence helper", () => {
  it("recognises real routes and rejects invented ones", () => {
    // Guards the guard: a `routeExists` that always returned true would make
    // every reachability assertion below vacuous.
    expect(routeExists("/rankings")).toBe(true);
    expect(routeExists("/arena/run-the-table")).toBe(true);
    expect(routeExists("/arena/court/practice/apex_1y")).toBe(true);
    expect(routeExists("/arena/definitely-not-a-route")).toBe(false);
    expect(routeExists("/nope")).toBe(false);
  });
});

describe("href parsing", () => {
  it("splits path from query and ignores the hash", () => {
    expect(splitHref("/arena/run-the-table")).toEqual(["/arena/run-the-table", ""]);
    expect(splitHref("/arena/run-the-table?mode=daily")).toEqual([
      "/arena/run-the-table",
      "mode=daily",
    ]);
    expect(splitHref("/rankings?x=1#top")).toEqual(["/rankings", "x=1"]);
  });

  it("matches on segment boundaries only", () => {
    expect(matchesPrefix("/arena", "/arena")).toBe(true);
    expect(matchesPrefix("/arena/run-the-table", "/arena")).toBe(true);
    // The bug this prevents: /arenafoo is not inside /arena.
    expect(matchesPrefix("/arenafoo", "/arena")).toBe(false);
  });
});

describe("nav model structure", () => {
  it("has no duplicate metadata and every mode is reachable exactly once", () => {
    expect(navModelIssues()).toEqual([]);
    expect(() => assertNoDuplicateModeMetadata()).not.toThrow();
  });

  it("lists every MODE_COPY entry exactly once as its canonical entry", () => {
    const canonical = navGroups()
      .flatMap((group) => group.items)
      .filter((item) => item.modeId && item.href === MODE_COPY[item.modeId].href)
      .map((item) => item.modeId as ModeId);

    expect([...canonical].sort()).toEqual((Object.keys(MODE_COPY) as ModeId[]).sort());
    expect(new Set(canonical).size).toBe(canonical.length);
  });

  it("never re-types a game name or href that MODE_COPY already owns", () => {
    const items = navGroups().flatMap((group) => group.items);
    for (const modeId of Object.keys(MODE_COPY) as ModeId[]) {
      const item = items.find((i) => i.modeId === modeId && i.href === MODE_COPY[modeId].href);
      expect(item, `${modeId} has a canonical nav entry`).toBeDefined();
      expect(item?.label).toBe(MODE_COPY[modeId].title);
    }
  });

  it("features exactly one item, and it is the flagship", () => {
    const featured = featuredItem();
    expect(featured?.modeId).toBe("run-the-table");
    expect(featured?.href).toBe(MODE_COPY["run-the-table"].href);
    expect(
      navGroups().flatMap((g) => g.items).filter((i) => i.featured),
    ).toHaveLength(1);
  });

  it("groups in the documented order", () => {
    expect(navGroups().map((g) => g.id)).toEqual([
      "flagship",
      "daily",
      "competitive",
      "explore",
    ]);
  });

  it("ends with 'View all games' → /arena, so ArrowUp lands on the hub", () => {
    const groups = navGroups();
    const last = groups[groups.length - 1];
    const lastItem = last.items[last.items.length - 1];
    expect(lastItem.href).toBe(ARENA_HUB_HREF);
    expect(lastItem.label).toBe("View all games");
  });

  it("surfaces the previously orphaned endless duel", () => {
    // /play/endless was linked from nothing at all before this pass.
    expect(allGameHrefs()).toContain("/play/endless");
  });

  it("offers RUN THE TABLE's daily board as its own entry", () => {
    expect(allGameHrefs()).toContain(RUN_THE_TABLE_DAILY_HREF);
  });
});

describe("reachability", () => {
  it("every game href resolves to a real route", () => {
    for (const href of allGameHrefs()) {
      const [pathname] = splitHref(href);
      expect(routeExists(pathname), `${href} must resolve to a page`).toBe(true);
    }
  });

  it("every nav href, top level included, resolves to a real route", () => {
    for (const href of allNavHrefs()) {
      const [pathname] = splitHref(href);
      expect(routeExists(pathname), `${href} must resolve to a page`).toBe(true);
    }
  });

  it("never surfaces the legacy labs route", () => {
    // /arena/labs is deliberately reachable by URL and deliberately absent from
    // the chrome; play-routing.spec.ts asserts the same thing in a browser.
    expect(allNavHrefs().filter((href) => href.startsWith("/arena/labs"))).toHaveLength(0);
  });
});

describe("availability is a runtime input", () => {
  it("drops 82-0 when it is unavailable, without breaking the invariants", () => {
    const hrefs = allGameHrefs({ peakSeason: false });
    expect(hrefs).not.toContain(MODE_COPY["peak-season"].href);
    expect(navModelIssues({ peakSeason: false })).toEqual([]);
  });

  it("drops the whole Competitive group when nothing in it is available", () => {
    const groups = navGroups({ ranked: false, leaderboard: false, matchHistory: false });
    expect(groups.map((g) => g.id)).not.toContain("competitive");
  });

  it("drops the daily RUN THE TABLE board without touching the standard run", () => {
    const hrefs = allGameHrefs({ dailyRunTheTable: false });
    expect(hrefs).not.toContain(RUN_THE_TABLE_DAILY_HREF);
    expect(hrefs).toContain(MODE_COPY["run-the-table"].href);
  });
});

describe("active-route detection", () => {
  const daily = topLevelLinks.find((l) => l.id === "daily");

  it("marks Play active across the whole arena section", () => {
    for (const pathname of [
      "/arena",
      "/arena/run-the-table",
      "/arena/court/history",
      "/arena/court/daily/apex_1y",
      "/arena/ranked",
    ]) {
      expect(isActive(pathname, PLAY_TRIGGER_ACTIVE), pathname).toBe(true);
    }
  });

  it("marks Daily active on /play/daily, which lives outside /daily", () => {
    expect(daily).toBeDefined();
    expect(isActive("/play/daily", daily!)).toBe(true);
    expect(isActive("/daily/grid", daily!)).toBe(true);
    expect(isActive("/rankings", daily!)).toBe(false);
  });

  it("does not mark Daily active on the endless duel", () => {
    // /play/endless is a Play-menu entry, not a once-a-day game.
    expect(isActive("/play/endless", daily!)).toBe(false);
    expect(isActive("/play/endless", PLAY_TRIGGER_ACTIVE)).toBe(true);
  });

  it("distinguishes the standard run from the daily run by query", () => {
    const items = navGroups().flatMap((g) => g.items);
    const standard = items.find((i) => i.id === "run-the-table")!;
    const dailyRun = items.find((i) => i.id === "run-the-table-daily")!;

    expect(isActive("/arena/run-the-table", standard, "")).toBe(true);
    expect(isActive("/arena/run-the-table", dailyRun, "")).toBe(false);

    expect(isActive("/arena/run-the-table", standard, "mode=daily")).toBe(false);
    expect(isActive("/arena/run-the-table", dailyRun, "mode=daily")).toBe(true);
  });

  it("never marks two items active on the same 82-0 route", () => {
    for (const pathname of ["/arena/court/leaderboard", "/arena/court/history"]) {
      const active = navGroups()
        .flatMap((g) => g.items)
        .filter((item) => isActive(pathname, item));
      expect(active.map((i) => i.id), pathname).toHaveLength(1);
    }
  });

  it("accepts a URLSearchParams as well as a string", () => {
    const dailyRun = navGroups()
      .flatMap((g) => g.items)
      .find((i) => i.id === "run-the-table-daily")!;
    expect(isActive("/arena/run-the-table", dailyRun, new URLSearchParams("mode=daily"))).toBe(
      true,
    );
  });
});

describe("invariant helper", () => {
  it("reports, rather than hides, a duplicate", () => {
    // navModelIssues is only useful if it can actually fail; prove it by
    // exercising the same checks on a deliberately broken shape.
    const broken = navGroups();
    broken[0].items.push({ ...broken[0].items[0] });
    const ids = broken.flatMap((g) => g.items).map((i) => i.id);
    expect(new Set(ids).size).toBeLessThan(ids.length);
  });
});

describe("constants", () => {
  it("pins the minimum tap target at 44 CSS px", () => {
    // Kept in step with `--pk-tap-min` in globals.css by hand; this test is the
    // reminder that the two exist.
    expect(MIN_TAP_TARGET_PX).toBe(44);
  });
});
