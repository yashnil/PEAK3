/**
 * Daily Grid: persistence and the pure derivations behind the recap/share.
 *
 * The properties worth pinning down:
 *   - a save is scoped to one board_id, so a new day genuinely starts clean
 *     rather than inheriting yesterday's squares;
 *   - corrupt or stale JSON is discarded, never thrown -- a bad localStorage
 *     entry must not be able to brick the page;
 *   - the share text is an exact, emoji-free format.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  DAILY_GRID_PROGRESS_SCHEMA_VERSION,
  dailyGridProgressKey,
} from "@/types/daily-grid";
import {
  bestCell,
  buildDailyGridShareText,
  cellShortTitle,
  clearProgress,
  emptyProgress,
  filledCoords,
  hardestCell,
  isComplete,
  loadProgress,
  rarityRank,
  saveProgress,
  totalArenaPoints,
  usedPlayerSlugs,
  withFilledCell,
  withIncorrectAttempt,
  withoutCell,
} from "@/lib/daily-grid-state";
import { BOARD, completedProgress, filledCell, playerSeason } from "./daily-grid-fixtures";

describe("daily-grid-state persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips progress through localStorage", () => {
    const progress = completedProgress();
    saveProgress(progress);

    const loaded = loadProgress(BOARD.board_id);
    expect(loaded).not.toBeNull();
    expect(loaded!.filled).toHaveLength(9);
    expect(loaded!.incorrect_attempts).toBe(3);
    expect(loaded!.filled[0].player_season.player_name).toBe("Hakeem Olajuwon");
    expect(loaded!.filled[0].cell_score.arena_points).toBe(120);
  });

  it("returns null for a board that has never been played", () => {
    expect(loadProgress("grid-2026-08-01")).toBeNull();
  });

  it("does not load another board's progress -- a new date starts clean", () => {
    saveProgress(completedProgress());
    // Tomorrow's board_id is a different storage key entirely.
    expect(loadProgress("grid-2026-07-31")).toBeNull();
  });

  it("discards a payload whose inner board_id does not match the key", () => {
    const smuggled = { ...completedProgress(), board_id: "grid-2026-01-01" };
    window.localStorage.setItem(dailyGridProgressKey(BOARD.board_id), JSON.stringify(smuggled));
    expect(loadProgress(BOARD.board_id)).toBeNull();
  });

  it("survives corrupt JSON without throwing", () => {
    window.localStorage.setItem(dailyGridProgressKey(BOARD.board_id), "{not json at all");
    expect(() => loadProgress(BOARD.board_id)).not.toThrow();
    expect(loadProgress(BOARD.board_id)).toBeNull();
  });

  it("discards a save written under an older schema version", () => {
    const stale = { ...completedProgress(), schema_version: DAILY_GRID_PROGRESS_SCHEMA_VERSION - 1 };
    window.localStorage.setItem(dailyGridProgressKey(BOARD.board_id), JSON.stringify(stale));
    expect(loadProgress(BOARD.board_id)).toBeNull();
  });

  it("drops malformed individual cells instead of failing the whole save", () => {
    const progress = completedProgress();
    const damaged = {
      ...progress,
      filled: [progress.filled[0], { row: 1 }, null, progress.filled[1]],
    };
    window.localStorage.setItem(dailyGridProgressKey(BOARD.board_id), JSON.stringify(damaged));
    expect(loadProgress(BOARD.board_id)!.filled).toHaveLength(2);
  });

  it("clearProgress removes the entry", () => {
    saveProgress(completedProgress());
    clearProgress(BOARD.board_id);
    expect(loadProgress(BOARD.board_id)).toBeNull();
  });
});

describe("daily-grid-state derivations", () => {
  it("starts empty and incomplete", () => {
    const p = emptyProgress(BOARD);
    expect(p.filled).toHaveLength(0);
    expect(p.incorrect_attempts).toBe(0);
    expect(isComplete(p)).toBe(false);
    expect(totalArenaPoints(p)).toBe(0);
  });

  it("sums only server-awarded arena_points", () => {
    expect(totalArenaPoints(completedProgress())).toBe(842);
  });

  it("marks the board complete at nine squares and stamps completed_at", () => {
    let p = emptyProgress(BOARD);
    for (let i = 0; i < 9; i++) {
      p = withFilledCell(
        p,
        filledCell(Math.floor(i / 3), i % 3, playerSeason({ player_slug: `p-${i}`, id: `p-${i}` }), 10, "common"),
      );
    }
    expect(isComplete(p)).toBe(true);
    expect(p.completed_at).not.toBeNull();
  });

  it("replaces rather than duplicates when the same square is filled twice", () => {
    let p = emptyProgress(BOARD);
    p = withFilledCell(p, filledCell(0, 0, playerSeason(), 50, "common"));
    p = withFilledCell(
      p,
      filledCell(0, 0, playerSeason({ player_slug: "bill-russell", label: "1961-62 Bill Russell" }), 70, "rare"),
    );
    expect(p.filled).toHaveLength(1);
    expect(p.filled[0].cell_score.arena_points).toBe(70);
  });

  it("withoutCell removes a square and un-completes the board", () => {
    const p = withoutCell(completedProgress(), 1, 2);
    expect(p.filled).toHaveLength(8);
    expect(p.completed_at).toBeNull();
    expect(isComplete(p)).toBe(false);
  });

  it("tracks used identities and filled coordinates for the submit payload", () => {
    const p = completedProgress();
    expect(usedPlayerSlugs(p)).toContain("shaquille-oneal");
    expect(new Set(usedPlayerSlugs(p)).size).toBe(9);
    expect(filledCoords(p)).toContainEqual([1, 2]);
    expect(withIncorrectAttempt(p).incorrect_attempts).toBe(4);
  });

  it("ranks rarity from very_rare down to very_common", () => {
    expect(rarityRank("very_rare")).toBeLessThan(rarityRank("rare"));
    expect(rarityRank("rare")).toBeLessThan(rarityRank("common"));
    expect(rarityRank("common")).toBeLessThan(rarityRank("very_common"));
  });

  it("picks the highest-scoring square as the best cell", () => {
    expect(bestCell(completedProgress().filled)!.player_season.label).toBe("1993-94 Hakeem Olajuwon");
  });

  it("picks the rarest square as the hardest cell, not the highest-scoring one", () => {
    const hardest = hardestCell(completedProgress().filled)!;
    expect(hardest.cell_score.rarity_bucket).toBe("very_rare");
    expect(cellShortTitle(BOARD, hardest.row, hardest.col)).toBe("DPOY x 85+ PEAK");
  });

  it("breaks a rarity tie on arena_points, then reading order", () => {
    const a = filledCell(2, 2, playerSeason({ player_slug: "a", id: "a" }), 40, "rare");
    const b = filledCell(0, 1, playerSeason({ player_slug: "b", id: "b" }), 60, "rare");
    const c = filledCell(0, 0, playerSeason({ player_slug: "c", id: "c" }), 60, "rare");
    expect(hardestCell([a, b, c])).toBe(c);
  });

  it("returns null best/hardest for an empty board", () => {
    expect(bestCell([])).toBeNull();
    expect(hardestCell([])).toBeNull();
  });
});

describe("daily-grid share text", () => {
  it("matches the published format exactly", () => {
    expect(buildDailyGridShareText(BOARD, completedProgress())).toBe(
      [
        "PEAK3 Daily Grid — 2026-07-30",
        "Solved 9/9",
        "Score: 842",
        "Best cell: 1993-94 Hakeem Olajuwon",
        "Hardest cell: DPOY x 85+ PEAK",
        "peak3.app/daily",
      ].join("\n"),
    );
  });

  it("contains no emoji or pictographic characters", () => {
    const text = buildDailyGridShareText(BOARD, completedProgress());
    expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false);
  });

  it("reports a partial grid honestly and omits cell lines when nothing is filled", () => {
    const empty = buildDailyGridShareText(BOARD, emptyProgress(BOARD));
    expect(empty).toBe(["PEAK3 Daily Grid — 2026-07-30", "Solved 0/9", "Score: 0", "peak3.app/daily"].join("\n"));

    const partial = withFilledCell(emptyProgress(BOARD), filledCell(1, 2, playerSeason(), 77, "very_rare"));
    expect(buildDailyGridShareText(BOARD, partial)).toContain("Solved 1/9");
    expect(buildDailyGridShareText(BOARD, partial)).toContain("Score: 77");
  });
});
