/**
 * Rankings — the position filter's semantics.
 *
 * THE RULE THIS SUITE PINS: the five tabs PARTITION the board. Every player
 * belongs to EXACTLY ONE of them, taken from the row's `primary_position` —
 * the model's `primary_position()`, i.e. the single position the player logged
 * the most career minutes at.
 *
 * WHAT CHANGED, AND WHY THIS FILE WAS REWRITTEN RATHER THAN EXTENDED. This
 * suite previously pinned the opposite rule: a player matched EVERY position
 * they were eligible at, read from `positions` (the API's minutes-gated
 * `career_positions()` set). That set is correct for its own job — it is the
 * placement legality 82-0 and Three-Man Weave enforce, and it is deliberately
 * generous, because LeBron really has logged real minutes at PG. As a rankings
 * filter it produced a "PG" board led by Michael Jordan, with LeBron James
 * second and Giannis Antetokounmpo fifth: every one of those a true statement
 * about eligibility, and nonsense as a ranking of point guards.
 *
 * So the old expectations are not weakened here, they are SUPERSEDED: having
 * played point guard does not make you a point guard, and game placement
 * flexibility must not decide tab membership. `positions` is still asserted
 * below — to prove the filter now ignores it.
 */
import { describe, expect, it } from "vitest";

import {
  filterRankingRowsByPosition,
  rankingsEmptyMessage,
  sortRankingRows,
  type RankingPositionFilter,
} from "@/components/rankings/board-model";
import { normalizeRankingRow } from "@/lib/api";
import type { RankingRow, RankingRowPayload } from "@/types";

/** The page's own filter -- imported, not restated, so this suite tests it. */
function filterByPosition(rows: RankingRow[], position: string): RankingRow[] {
  return filterRankingRowsByPosition(rows, position as RankingPositionFilter);
}

function row(
  name: string,
  primary: string | null | undefined,
  positions: string[] = [],
  rank = 1,
): RankingRow {
  const payload = {
    rank,
    player_slug: name.toLowerCase().replace(/[^a-z]+/g, "-"),
    player_name: name,
    label: "1990-91",
    prime_score: 90,
    positions,
    primary_position: primary,
  } as RankingRowPayload;
  return normalizeRankingRow(payload);
}

/** The real shape of the defect: every one of these is eligible at PG. */
const BOARD: RankingRow[] = [
  row("Michael Jordan", "SG", ["PG", "SF", "SG"], 1),
  row("LeBron James", "SF", ["C", "PF", "PG", "SF", "SG"], 2),
  row("Stephen Curry", "PG", ["PG", "SG"], 3),
  row("Giannis Antetokounmpo", "PF", ["C", "PF", "PG", "SF", "SG"], 4),
  row("Nikola Jokic", "C", ["C", "PF"], 5),
  row("Unknown Player", null, [], 6),
];

const POSITIONS = ["PG", "SG", "SF", "PF", "C"] as const;
const names = (rows: RankingRow[]) => rows.map((r) => r.player_name);

describe("rankings position filter", () => {
  it("ALL returns the untouched board, in its original order", () => {
    expect(names(filterByPosition(BOARD, "all"))).toEqual(names(BOARD));
  });

  it("puts each player under exactly one tab — the tabs partition the board", () => {
    for (const r of BOARD) {
      const tabs = POSITIONS.filter((p) => names(filterByPosition(BOARD, p)).includes(r.player_name));
      // Unknown Player is the one deliberate exception: no tab, still in All.
      expect(tabs.length, `${r.player_name} appears in ${tabs.length} tabs`).toBe(
        r.primary_position ? 1 : 0,
      );
    }
  });

  it("the union of the five tabs is All, minus only the unclassifiable", () => {
    const union = POSITIONS.flatMap((p) => names(filterByPosition(BOARD, p)));
    expect(new Set(union).size, "a player was counted twice").toBe(union.length);
    expect(union.sort()).toEqual(
      names(BOARD)
        .filter((n) => n !== "Unknown Player")
        .sort(),
    );
  });

  it("ELIGIBILITY DOES NOT DECIDE MEMBERSHIP — the regression this rule exists for", () => {
    // All four are eligible at PG (`positions` says so, and that stays true
    // for placement legality). Only the actual point guard is in the PG tab.
    const pg = names(filterByPosition(BOARD, "PG"));
    expect(pg).toEqual(["Stephen Curry"]);
    expect(pg).not.toContain("Michael Jordan");
    expect(pg).not.toContain("LeBron James");
    expect(pg).not.toContain("Giannis Antetokounmpo");

    // And they are each in their own tab instead.
    expect(names(filterByPosition(BOARD, "SG"))).toEqual(["Michael Jordan"]);
    expect(names(filterByPosition(BOARD, "SF"))).toEqual(["LeBron James"]);
    expect(names(filterByPosition(BOARD, "PF"))).toEqual(["Giannis Antetokounmpo"]);
    expect(names(filterByPosition(BOARD, "C"))).toEqual(["Nikola Jokic"]);
  });

  it("keeps the eligibility set on the row — it is still the games' legality data", () => {
    // The filter ignores `positions`; nothing else should have lost it.
    const lebron = BOARD.find((r) => r.player_name === "LeBron James")!;
    expect(lebron.positions).toContain("PG");
    expect(lebron.positions).toContain("C");
    expect(lebron.primary_position).toBe("SF");
  });

  it("preserves the board's own ordering within a filtered position", () => {
    // Filtering narrows the set; it must never reorder it, because the sort
    // is applied afterwards and owns the order.
    const board = [
      row("Late PG", "PG", [], 40),
      row("Early PG", "PG", [], 3),
      row("A Centre", "C", [], 10),
    ];
    expect(filterByPosition(board, "PG").map((r) => r.rank)).toEqual([40, 3]);
  });

  it("a missing primary position means 'no information' — no tab, still under All", () => {
    for (const pos of POSITIONS) {
      expect(names(filterByPosition(BOARD, pos)), pos).not.toContain("Unknown Player");
    }
    expect(names(filterByPosition(BOARD, "all"))).toContain("Unknown Player");
  });

  it("an API that omits `primary_position` normalizes to null, never to a guess", () => {
    expect(row("No Field", undefined).primary_position).toBeNull();
    expect(row("Null Field", null).primary_position).toBeNull();
    expect(row("Wrong Type", 5 as unknown as string).primary_position).toBeNull();
  });

  it("does not derive membership by substring — 'PG' never matches a 'PG-SG' token", () => {
    const hyphenated = row("Hyphen Guy", "PG-SG");
    expect(filterByPosition([hyphenated], "PG")).toHaveLength(0);
    expect(filterByPosition([hyphenated], "SG")).toHaveLength(0);
  });
});

/**
 * REGRESSION: Rankings -> Single Seasons -> PG showed "No rows available for
 * this board" while the board reported 1,000 rows. `/api/v1/seasons` served
 * `positions` but not `primary_position`, so every season row normalised to
 * null and matched no tab. These rows are the two boards' real served shapes.
 */
describe("both boards' served rows filter by position", () => {
  const seasonRow = (rank: number, name: string, primary: string | null, season: string): RankingRow =>
    normalizeRankingRow({
      rank,
      season_id: `${name.toLowerCase().replace(/[^a-z]+/g, "-")}-1yr-${season.replace("-", "")}`,
      row_id: `${name.toLowerCase().replace(/[^a-z]+/g, "-")}-1yr-${season.replace("-", "")}`,
      player_slug: name.toLowerCase().replace(/[^a-z]+/g, "-"),
      player_name: name,
      season,
      label: season,
      prime_score: 98 - rank,
      positions: ["PG", "SG"],
      primary_position: primary,
    } as unknown as RankingRowPayload);
  const SEASONS: RankingRow[] = [
    seasonRow(1, "Michael Jordan", "SG", "1990-91"),
    seasonRow(2, "Magic Johnson", "PG", "1986-87"),
    seasonRow(3, "Stephen Curry", "PG", "2015-16"),
    seasonRow(4, "Shaquille ONeal", "C", "1999-00"),
    seasonRow(5, "Michael Jordan", "SG", "1995-96"),
    seasonRow(6, "Larry Bird", "SF", "1985-86"),
    seasonRow(7, "Tim Duncan", "PF", "2001-02"),
  ];

  it("every position tab on Single Seasons returns its qualifying seasons", () => {
    expect(names(filterByPosition(SEASONS, "PG"))).toEqual(["Magic Johnson", "Stephen Curry"]);
    expect(names(filterByPosition(SEASONS, "SG"))).toEqual(["Michael Jordan", "Michael Jordan"]);
    expect(names(filterByPosition(SEASONS, "SF"))).toEqual(["Larry Bird"]);
    expect(names(filterByPosition(SEASONS, "PF"))).toEqual(["Tim Duncan"]);
    expect(names(filterByPosition(SEASONS, "C"))).toEqual(["Shaquille ONeal"]);
    expect(filterByPosition(SEASONS, "all")).toHaveLength(SEASONS.length);
  });

  it("filtering keeps the official order under every sort", () => {
    const pg = filterByPosition(SEASONS, "PG");
    expect(sortRankingRows(pg, "rank", "asc").map((r) => r.rank)).toEqual([2, 3]);
    expect(sortRankingRows(pg, "total", "desc").map((r) => r.rank)).toEqual([2, 3]);
    const sg = filterByPosition(sortRankingRows(SEASONS, "rank", "asc"), "SG");
    expect(sg.map((r) => r.rank)).toEqual([1, 5]);
  });

  it("the empty state names the filter that emptied the board, and only then", () => {
    expect(filterByPosition([seasonRow(1, "X", "SG", "1990-91")], "C")).toHaveLength(0);
    expect(rankingsEmptyMessage("", "C")).toBe("No C rows on this board.");
    expect(rankingsEmptyMessage("zzz", "PG")).toBe('No rows at PG match "zzz".');
    expect(rankingsEmptyMessage("zzz", "all")).toBe('No rows match "zzz".');
    expect(rankingsEmptyMessage("", "all")).toBe("No rows available for this board.");
  });
});
