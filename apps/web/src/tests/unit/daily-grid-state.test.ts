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
  buildShareGrid,
  cellGrade,
  cellShortTitle,
  clearProgress,
  elapsedMs,
  emptyProgress,
  filledCoords,
  formatElapsed,
  hardestCell,
  isComplete,
  loadProgress,
  rarityRank,
  resultGrade,
  saveProgress,
  totalArenaPoints,
  usedPlayerSlugs,
  withFilledCell,
  withIncorrectAttempt,
  withTimerStarted,
} from "@/lib/daily-grid-state";
import { BOARD, completedProgress, filledCell, gridResult, playerSeason } from "./daily-grid-fixtures";

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
    // Phase 11B: a locked square is FINAL. The second write is ignored rather
    // than overwriting -- on the competitive daily board there is no way to
    // trade a pick for a better one, and a stray double-submit must not be
    // able to change a score that has already been counted.
    expect(p.filled).toHaveLength(1);
    expect(p.filled[0].cell_score.arena_points).toBe(50);
    expect(p.filled[0].player_season.player_slug).toBe("hakeem-olajuwon");
  });

  it("exposes no way to unlock a square", async () => {
    // There is deliberately no `withoutCell` export: the state layer should not
    // be able to express "remove a locked pick", so a future UI cannot
    // accidentally offer it.
    const mod = await import("@/lib/daily-grid-state");
    expect("withoutCell" in mod).toBe(false);
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
    expect(cellShortTitle(BOARD, hardest.row, hardest.col)).toBe("DPOY x 36+ MPG");
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
  it("matches the published format exactly for an unfinished board", () => {
    // No comparison released yet, so no maximum, no grade and no recap grid --
    // the server only hands those over once all nine squares are locked.
    expect(buildDailyGridShareText(BOARD, completedProgress())).toBe(
      [
        "PEAK3 Daily Grid — 2026-07-30",
        "Two-Way Night",
        "Score: 842",
        "Solved 9/9",
        "Time: 7:04",
        "Misses: 3",
        "peak3.app/daily",
      ].join("\n"),
    );
  });

  it("contains no emoji or pictographic characters", () => {
    const text = buildDailyGridShareText(BOARD, completedProgress(), gridResult());
    expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false);
  });

  it("reports a partial grid honestly and omits the clock before the first move", () => {
    const empty = buildDailyGridShareText(BOARD, emptyProgress(BOARD));
    expect(empty).toBe(
      [
        "PEAK3 Daily Grid — 2026-07-30",
        "Two-Way Night",
        "Score: 0",
        "Solved 0/9",
        "Misses: 0",
        "peak3.app/daily",
      ].join("\n"),
    );

    const partial = withFilledCell(emptyProgress(BOARD), filledCell(1, 2, playerSeason(), 77, "very_rare"));
    expect(buildDailyGridShareText(BOARD, partial)).toContain("Solved 1/9");
    expect(buildDailyGridShareText(BOARD, partial)).toContain("Score: 77");
  });
});

describe("daily-grid share text — competitive framing", () => {
  it("adds the score-against-maximum line and the grade once the result is known", () => {
    const result = gridResult();
    const text = buildDailyGridShareText(BOARD, completedProgress(), result);
    // A bare score means nothing without the ceiling it is measured against;
    // this line is the reason the share is worth posting.
    expect(text).toContain(
      `${result.user_total}/${result.optimal_total} — ${result.percent_of_best}% of today's max`,
    );
    expect(text).toContain(resultGrade(result.percent_of_best).headline);
    expect(text.startsWith("PEAK3 Daily Grid — 2026-07-30")).toBe(true);
    expect(text.endsWith("peak3.app/daily")).toBe(true);
  });

  it("carries a three-by-three plain-text recap with a legend", () => {
    const text = buildDailyGridShareText(BOARD, completedProgress(), gridResult());
    const grid = buildShareGrid(gridResult());
    expect(grid).toHaveLength(3);
    expect(grid.every((row) => row.split(" ").length === 3)).toBe(true);
    for (const row of grid) expect(text).toContain(row);
    expect(text).toContain("# best  + close  - fair  . weak");
  });

  it("says 'best known' instead of 'today's max' when the optimum is not proven", () => {
    const text = buildDailyGridShareText(BOARD, completedProgress(), gridResult({ exact_optimal: false }));
    expect(text).toContain("of PEAK3's best known");
    expect(text).not.toContain("today's max");
  });

  it("omits the comparison and the recap entirely when the result is absent", () => {
    const text = buildDailyGridShareText(BOARD, completedProgress(), null);
    expect(text).not.toContain("%");
    expect(text).not.toContain("# best");
  });

  it("claims no rank, percentile or global standing", () => {
    const text = buildDailyGridShareText(BOARD, completedProgress(), gridResult());
    expect(text).not.toMatch(/percentile|leaderboard|rank|#\d+\b/i);
  });

  it("never contains emoji", () => {
    const text = buildDailyGridShareText(BOARD, completedProgress(), gridResult());
    expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Timer (Phase 11C)
// ---------------------------------------------------------------------------

describe("daily-grid timer", () => {
  const T0 = new Date("2026-07-30T12:00:00Z");

  it("does not run until the player's first move", () => {
    const fresh = emptyProgress(BOARD);
    expect(fresh.started_at).toBeNull();
    expect(elapsedMs(fresh, T0)).toBeNull();
    expect(formatElapsed(null)).toBe("—");
  });

  it("starts once, and a second start does not restart it", () => {
    const started = withTimerStarted(emptyProgress(BOARD), T0);
    expect(started.started_at).toBe(T0.toISOString());
    const again = withTimerStarted(started, new Date("2026-07-30T12:05:00Z"));
    expect(again).toBe(started);
  });

  it("survives a refresh -- the start time is persisted, not an accumulator", () => {
    const started = withTimerStarted(emptyProgress(BOARD), T0);
    saveProgress(started);
    const reloaded = loadProgress(BOARD.board_id)!;
    expect(reloaded.started_at).toBe(started.started_at);
    expect(elapsedMs(reloaded, new Date("2026-07-30T12:03:20Z"))).toBe(200_000);
  });

  it("runs against the clock while the board is in play", () => {
    const started = withTimerStarted(emptyProgress(BOARD), T0);
    expect(elapsedMs(started, new Date("2026-07-30T12:00:45Z"))).toBe(45_000);
    expect(elapsedMs(started, new Date("2026-07-30T12:07:04Z"))).toBe(424_000);
  });

  it("stops at completion and does not move afterwards", () => {
    const done = completedProgress();
    const atCompletion = elapsedMs(done, new Date("2026-07-30T12:00:00Z"));
    const muchLater = elapsedMs(done, new Date("2026-07-30T23:00:00Z"));
    expect(atCompletion).toBe(424_000);
    expect(muchLater).toBe(atCompletion);
  });

  it("never starts a clock on an already-finished board", () => {
    const done = completedProgress();
    expect(withTimerStarted({ ...done, started_at: null }, T0).started_at).toBeNull();
  });

  it("formats minutes, seconds and hours, and never goes negative", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(45_000)).toBe("0:45");
    expect(formatElapsed(424_000)).toBe("7:04");
    expect(formatElapsed(3_731_000)).toBe("1:02:11");
    // A clock skew between two sessions must not print "-3:12".
    const skewed = { ...emptyProgress(BOARD), started_at: "2026-07-30T12:00:00Z" };
    expect(elapsedMs(skewed, new Date("2026-07-30T11:55:00Z"))).toBe(0);
  });

  it("ignores an unparseable stored start time rather than throwing", () => {
    const broken = { ...emptyProgress(BOARD), started_at: "not-a-date" };
    expect(elapsedMs(broken, T0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Result grading (Phase 11C)
// ---------------------------------------------------------------------------

describe("daily-grid result grading", () => {
  it("reserves the perfect headline for actually matching the maximum", () => {
    expect(resultGrade(100).headline).toBe("Perfect Grid");
    expect(resultGrade(99.9).headline).toBe("Near Perfect");
  });

  it("bands the rest of the range", () => {
    expect(resultGrade(92).headline).toBe("Near Perfect");
    expect(resultGrade(80).headline).toBe("Strong Run");
    expect(resultGrade(51).headline).toBe("Room to Improve");
    expect(resultGrade(0).headline).toBe("Room to Improve");
  });

  it("grades a square by how close it came to the best answer available there", () => {
    const cells = gridResult().cells;
    const matched = cells.find((c) => c.matched_optimal)!;
    const missed = cells.find((c) => !c.matched_optimal)!;
    expect(cellGrade(matched)).toBe("best");
    expect(cellGrade(missed)).not.toBe("best");
  });
});

describe("daily-grid rules acknowledgement", () => {
  it("reports unseen until marked, then seen", async () => {
    const { hasSeenRules, markRulesSeen } = await import("@/lib/daily-grid-state");
    window.localStorage.clear();
    expect(hasSeenRules()).toBe(false);
    markRulesSeen();
    expect(hasSeenRules()).toBe(true);
  });

  /**
   * The one-way migration from the unversioned `"peak3.daily-grid.rules-seen"`
   * flag to the versioned tour store. The old flag is still READ so that
   * shipping this does not re-onboard everyone who had already dismissed the
   * gate; it is never written again, and the acknowledgement it stands in for
   * is replayable once a version bump makes it worth replaying.
   */
  it("accepts the legacy unversioned flag, and never writes it back", async () => {
    const { hasSeenRules, markRulesSeen } = await import("@/lib/daily-grid-state");
    const { DAILY_GRID_RULES_SEEN_KEY } = await import("@/types/daily-grid");
    const { TOUR_STORAGE_KEY, readTourSeen } = await import("@/lib/tour-state");

    window.localStorage.clear();
    window.localStorage.setItem(DAILY_GRID_RULES_SEEN_KEY, "1");
    // Recognised, with nothing at all in the versioned store yet.
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBeNull();
    expect(hasSeenRules()).toBe(true);

    // The next acknowledgement goes to the versioned store only.
    markRulesSeen("skipped");
    expect(readTourSeen("daily-grid")?.status).toBe("skipped");

    window.localStorage.clear();
    markRulesSeen();
    expect(window.localStorage.getItem(DAILY_GRID_RULES_SEEN_KEY)).toBeNull();
  });

  it("replays onboarding after a tour version bump", async () => {
    const { hasSeenRules } = await import("@/lib/daily-grid-state");
    const { markTourSeen } = await import("@/lib/tour-state");
    const { DAILY_GRID_TOUR_VERSION } = await import("@/components/ui/tour-steps");

    window.localStorage.clear();
    // Seen at a DIFFERENT version -- which is how a copy change reaches an
    // existing player. The old bare "1" string could not express this at all.
    markTourSeen("daily-grid", DAILY_GRID_TOUR_VERSION - 1, "completed");
    expect(hasSeenRules()).toBe(false);

    markTourSeen("daily-grid", DAILY_GRID_TOUR_VERSION, "completed");
    expect(hasSeenRules()).toBe(true);
  });
});
