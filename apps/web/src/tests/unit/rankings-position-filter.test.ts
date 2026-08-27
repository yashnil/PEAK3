/**
 * Rankings — the position filter's semantics.
 *
 * The rule this suite exists to pin: a player matches EVERY canonical
 * position they are eligible at, taken from the row's structured
 * `positions` array (the API's minutes-gated `career_positions()` set) and
 * never from a parsed display string. Substring-matching prose is how "PG"
 * silently matches "PG-SG" but misses "G", and how a rankings filter ends
 * up disagreeing with the placement legality the games already enforce.
 */
import { describe, expect, it } from "vitest";

import { normalizeRankingRow } from "@/lib/api";
import type { RankingRow, RankingRowPayload } from "@/types";

/** The page's own filter predicate, stated once here. */
function filterByPosition(rows: RankingRow[], position: string): RankingRow[] {
  return position === "all" ? rows : rows.filter((r) => r.positions.includes(position));
}

function row(name: string, positions: string[] | null | undefined, rank = 1): RankingRow {
  const payload = {
    rank,
    player_slug: name.toLowerCase().replace(/[^a-z]+/g, "-"),
    player_name: name,
    label: "1990-91",
    prime_score: 90,
    positions,
  } as RankingRowPayload;
  return normalizeRankingRow(payload);
}

const BOARD: RankingRow[] = [
  row("Michael Jordan", ["PG", "SF", "SG"], 1),
  row("Nikola Jokic", ["C", "PF"], 2),
  row("Shaquille O'Neal", ["C"], 3),
  row("Stephen Curry", ["PG", "SG"], 4),
  row("Draymond Green", ["PF", "SF"], 5),
  row("Unknown Player", [], 6),
];

const names = (rows: RankingRow[]) => rows.map((r) => r.player_name);

describe("rankings position filter", () => {
  it("ALL returns the untouched board, in its original order", () => {
    expect(names(filterByPosition(BOARD, "all"))).toEqual(names(BOARD));
  });

  it("matches every canonical position a multi-position player is eligible at", () => {
    // Jordan is PG/SG/SF — he must appear under all three, and under
    // neither of the two he is not eligible at.
    for (const pos of ["PG", "SG", "SF"]) {
      expect(names(filterByPosition(BOARD, pos)), pos).toContain("Michael Jordan");
    }
    for (const pos of ["PF", "C"]) {
      expect(names(filterByPosition(BOARD, pos)), pos).not.toContain("Michael Jordan");
    }
  });

  it("returns the right board for each of the five positions", () => {
    expect(names(filterByPosition(BOARD, "PG"))).toEqual(["Michael Jordan", "Stephen Curry"]);
    expect(names(filterByPosition(BOARD, "SG"))).toEqual(["Michael Jordan", "Stephen Curry"]);
    expect(names(filterByPosition(BOARD, "SF"))).toEqual(["Michael Jordan", "Draymond Green"]);
    expect(names(filterByPosition(BOARD, "PF"))).toEqual(["Nikola Jokic", "Draymond Green"]);
    expect(names(filterByPosition(BOARD, "C"))).toEqual(["Nikola Jokic", "Shaquille O'Neal"]);
  });

  it("a single-position player appears under exactly one position", () => {
    const shaqIn = ["PG", "SG", "SF", "PF", "C"].filter((p) =>
      names(filterByPosition(BOARD, p)).includes("Shaquille O'Neal"),
    );
    expect(shaqIn).toEqual(["C"]);
  });

  it("preserves the board's own ordering within a filtered position", () => {
    // Filtering narrows the set; it must never reorder it, because the sort
    // is applied afterwards and owns the order.
    const pf = filterByPosition(BOARD, "PF");
    expect(pf.map((r) => r.rank)).toEqual([2, 5]);
  });

  it("EMPTY positions means 'no information' — excluded from every position, kept under All", () => {
    for (const pos of ["PG", "SG", "SF", "PF", "C"]) {
      expect(names(filterByPosition(BOARD, pos)), pos).not.toContain("Unknown Player");
    }
    expect(names(filterByPosition(BOARD, "all"))).toContain("Unknown Player");
  });

  it("an API that omits `positions` entirely normalizes to empty, never to a guess", () => {
    expect(row("No Field", undefined).positions).toEqual([]);
    expect(row("Null Field", null).positions).toEqual([]);
  });

  it("does not derive eligibility by substring — 'PG' never matches a 'PG-SG' style token", () => {
    // A row whose data arrived as one hyphenated token is NOT two positions.
    // It matches only itself, so this can never quietly half-work.
    const hyphenated = row("Hyphen Guy", ["PG-SG"]);
    expect(filterByPosition([hyphenated], "PG")).toHaveLength(0);
    expect(filterByPosition([hyphenated], "SG")).toHaveLength(0);
  });
});
