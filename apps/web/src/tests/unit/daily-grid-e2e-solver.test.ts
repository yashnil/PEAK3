/**
 * The Daily Grid e2e driver's distinct-player matcher
 * (`tests/e2e/helpers/daily-grid-solver.ts::assignDistinctPlayers`).
 *
 * The driver used to lock squares greedily in row-major order, taking the
 * first candidate that fit. These cases pin the replacement: one global
 * assignment, nine distinct players, found even where a greedy first choice
 * dead-ends; deterministic; and an honest null when no assignment exists.
 */
import { describe, expect, it } from "vitest";

import { assignDistinctPlayers, type Candidate } from "@/tests/e2e/helpers/daily-grid-solver";

const c = (playerSlug: string, season = "2000-01"): Candidate => ({ playerSlug, answerId: `${playerSlug}-${season}` });

/** Nine squares; `overrides` replaces chosen squares' option lists. */
function board(overrides: Record<number, Candidate[]>): Candidate[][] {
  return Array.from({ length: 9 }, (_, square) => overrides[square] ?? [c(`filler-${square}`)]);
}

function slugsOf(candidates: Candidate[][], picks: number[]): string[] {
  return picks.map((pick, square) => candidates[square][pick].playerSlug);
}

/** What the old driver did: row-major, first unused candidate per square. */
function greedy(candidates: Candidate[][]): string[] | null {
  const used = new Set<string>();
  const out: string[] = [];
  for (const options of candidates) {
    const pick = options.find((o) => !used.has(o.playerSlug));
    if (!pick) return null;
    used.add(pick.playerSlug);
    out.push(pick.playerSlug);
  }
  return out;
}

describe("assignDistinctPlayers", () => {
  it("solves a board where the greedy first choice dead-ends a later square", () => {
    // Square 0's first option is the ONLY player square 6 can take (the
    // 2026-10-06 shape: a rare Undrafted square late in row-major order).
    const candidates = board({
      0: [c("alex-caruso"), c("shai-gilgeous-alexander")],
      6: [c("alex-caruso")],
    });
    expect(greedy(candidates)).toBeNull();

    const picks = assignDistinctPlayers(candidates);
    expect(picks).not.toBeNull();
    const slugs = slugsOf(candidates, picks!);
    expect(slugs[0]).toBe("shai-gilgeous-alexander");
    expect(slugs[6]).toBe("alex-caruso");
    expect(new Set(slugs).size).toBe(9);
  });

  it("resolves a chain of displacements across several squares", () => {
    const candidates = board({
      0: [c("a"), c("b")],
      1: [c("b"), c("c")],
      2: [c("c"), c("d")],
      8: [c("a")],
    });
    expect(greedy(candidates)).toBeNull();
    const slugs = slugsOf(candidates, assignDistinctPlayers(candidates)!);
    expect(slugs.slice(0, 3)).toEqual(["b", "c", "d"]);
    expect(slugs[8]).toBe("a");
  });

  it("never uses one player twice, even across different seasons", () => {
    const candidates = board({
      0: [c("lebron-james", "2012-13"), c("kevin-durant")],
      1: [c("lebron-james", "2008-09")],
    });
    const slugs = slugsOf(candidates, assignDistinctPlayers(candidates)!);
    expect(slugs[1]).toBe("lebron-james");
    expect(slugs[0]).toBe("kevin-durant");
    expect(new Set(slugs).size).toBe(9);
  });

  it("is deterministic and keeps each square's preference order when free", () => {
    const candidates = board({
      0: [c("x"), c("y"), c("z")],
      1: [c("y"), c("z")],
    });
    const first = assignDistinctPlayers(candidates);
    expect(assignDistinctPlayers(candidates)).toEqual(first);
    expect(slugsOf(candidates, first!).slice(0, 2)).toEqual(["x", "y"]);
  });

  it("returns null only when no distinct assignment exists", () => {
    // Two squares that can only take the same single player.
    expect(assignDistinctPlayers(board({ 3: [c("only-one")], 7: [c("only-one")] }))).toBeNull();
    // A square with no options at all.
    expect(assignDistinctPlayers(board({ 4: [] }))).toBeNull();
  });
});
