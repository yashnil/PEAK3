/**
 * Daily Grid local archive and streak (Phase 11D).
 *
 * The properties worth pinning down:
 *   - the streak continues, breaks and never double-counts a day;
 *   - an archive/replay board is recorded but cannot inflate the live streak,
 *     which is the whole reason the strict rule exists (every past board sits
 *     at a guessable URL, so a streak that replays could be reconstructed);
 *   - corrupt or hand-edited storage degrades safely instead of throwing or
 *     being believed.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  DAILY_GRID_ARCHIVE_KEY,
  DAILY_GRID_ARCHIVE_MAX,
  DailyGridArchiveEntry,
} from "@/types/daily-grid";
import {
  buildArchiveEntry,
  clearArchive,
  currentStreak,
  daysBetween,
  emptyArchive,
  formatCountdown,
  hasCompleted,
  isCanonicalToday,
  loadArchive,
  longestStreak,
  msUntilNextBoard,
  recentEntries,
  recordCompletedBoard,
  reportableElapsedSeconds,
  saveArchive,
  todayUtc,
} from "@/lib/daily-grid-archive";
import { emptyProgress } from "@/lib/daily-grid-state";
import { BOARD, completedProgress, gridResult } from "./daily-grid-fixtures";

function entry(date: string, overrides: Partial<DailyGridArchiveEntry> = {}): DailyGridArchiveEntry {
  return {
    board_id: `daily-grid-v2-${date}`,
    date,
    theme: "Award Season",
    difficulty: "medium",
    started_at: `${date}T12:00:00.000Z`,
    completed_at: `${date}T12:07:00.000Z`,
    elapsed_seconds: 420,
    score: 700,
    today_max: 800,
    percent_of_max: 87.5,
    grade: "Strong Run",
    misses: 1,
    filled_count: 9,
    counted_for_streak: true,
    picks: [],
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

describe("daily-grid archive dates", () => {
  it("uses UTC, matching the clock the server generates boards on", () => {
    // 23:30 in UTC+13 is still the previous UTC day, and the API is still
    // serving that day's board.
    expect(todayUtc(new Date("2026-03-14T23:30:00Z"))).toBe("2026-03-14");
    expect(todayUtc(new Date("2026-03-15T00:00:00Z"))).toBe("2026-03-15");
  });

  it("counts whole days across a DST boundary", () => {
    expect(daysBetween("2026-03-07", "2026-03-08")).toBe(1);
    // US DST spring-forward weekend — a naive local-time diff gives 0.958 days.
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-03-09", "2026-03-07")).toBe(-2);
  });

  it("recognizes only the canonical board as today", () => {
    const now = new Date("2026-03-14T09:00:00Z");
    expect(isCanonicalToday("2026-03-14", now)).toBe(true);
    expect(isCanonicalToday("2026-03-13", now)).toBe(false);
    expect(isCanonicalToday("garbage", now)).toBe(false);
  });

  it("counts down to the next UTC midnight", () => {
    const ms = msUntilNextBoard(new Date("2026-03-14T22:00:00Z"));
    expect(ms).toBe(2 * 3600 * 1000);
    expect(formatCountdown(ms)).toBe("2h 0m");
    expect(formatCountdown(90_000)).toBe("1m");
    expect(formatCountdown(45_000)).toBe("45s");
    expect(formatCountdown(-5)).toBe("0s");
  });
});

// ---------------------------------------------------------------------------
// Streak
// ---------------------------------------------------------------------------

describe("daily-grid streak", () => {
  it("is zero with no history", () => {
    expect(currentStreak([], "2026-03-14")).toBe(0);
    expect(longestStreak([])).toBe(0);
  });

  it("counts consecutive days ending today", () => {
    const entries = [entry("2026-03-14"), entry("2026-03-13"), entry("2026-03-12")];
    expect(currentStreak(entries, "2026-03-14")).toBe(3);
  });

  it("stays live the morning after — yesterday still counts", () => {
    // The player finished last night and has not played yet today. Nothing is
    // broken; they simply have not shown up.
    const entries = [entry("2026-03-13"), entry("2026-03-12")];
    expect(currentStreak(entries, "2026-03-14")).toBe(2);
  });

  it("breaks when a day is missed", () => {
    const entries = [entry("2026-03-12"), entry("2026-03-11")];
    expect(currentStreak(entries, "2026-03-14")).toBe(0);
  });

  it("stops at the first gap rather than counting every day ever played", () => {
    const entries = [
      entry("2026-03-14"),
      entry("2026-03-13"),
      // gap on the 12th
      entry("2026-03-11"),
      entry("2026-03-10"),
    ];
    expect(currentStreak(entries, "2026-03-14")).toBe(2);
    expect(longestStreak(entries)).toBe(2);
  });

  it("remembers the longest run even after the current one breaks", () => {
    const entries = [
      entry("2026-03-14"),
      entry("2026-03-10"),
      entry("2026-03-09"),
      entry("2026-03-08"),
      entry("2026-03-07"),
    ];
    expect(currentStreak(entries, "2026-03-14")).toBe(1);
    expect(longestStreak(entries)).toBe(4);
  });

  it("ignores replayed boards entirely", () => {
    const entries = [
      entry("2026-03-14"),
      entry("2026-03-13", { counted_for_streak: false }),
      entry("2026-03-12"),
    ];
    // The 13th was a replay, so the run is broken there despite the row
    // existing — a streak that could be rebuilt from archive URLs would
    // measure nothing.
    expect(currentStreak(entries, "2026-03-14")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

describe("recording a completed board", () => {
  it("adds the board and derives the streak", () => {
    const archive = recordCompletedBoard(emptyArchive(), entry("2026-03-14"), "2026-03-14");
    expect(archive.total_completed).toBe(1);
    expect(archive.current_streak).toBe(1);
    expect(archive.longest_streak).toBe(1);
    expect(archive.last_streak_date).toBe("2026-03-14");
    expect(archive.best_score).toBe(700);
    expect(archive.best_percent_of_max).toBe(87.5);
  });

  it("does not double-count the same board", () => {
    // The completion effect fires on every mount of a finished board, and
    // again when the comparison lands, so this has to be idempotent.
    let archive = recordCompletedBoard(emptyArchive(), entry("2026-03-14"), "2026-03-14");
    archive = recordCompletedBoard(archive, entry("2026-03-14"), "2026-03-14");
    archive = recordCompletedBoard(archive, entry("2026-03-14"), "2026-03-14");
    expect(archive.total_completed).toBe(1);
    expect(archive.current_streak).toBe(1);
  });

  it("upgrades a row in place when the comparison arrives late", () => {
    const withoutResult = entry("2026-03-14", {
      today_max: null,
      percent_of_max: null,
      grade: null,
    });
    let archive = recordCompletedBoard(emptyArchive(), withoutResult, "2026-03-14");
    expect(archive.entries[0].percent_of_max).toBeNull();

    archive = recordCompletedBoard(archive, entry("2026-03-14"), "2026-03-14");
    expect(archive.total_completed).toBe(1);
    expect(archive.entries[0].percent_of_max).toBe(87.5);
    expect(archive.entries[0].grade).toBe("Strong Run");
  });

  it("continues a streak across consecutive days", () => {
    let archive = recordCompletedBoard(emptyArchive(), entry("2026-03-13"), "2026-03-13");
    archive = recordCompletedBoard(archive, entry("2026-03-14"), "2026-03-14");
    expect(archive.current_streak).toBe(2);
    expect(archive.total_completed).toBe(2);
  });

  it("does not let a replayed board extend the live streak", () => {
    let archive = recordCompletedBoard(emptyArchive(), entry("2026-03-14"), "2026-03-14");
    archive = recordCompletedBoard(
      archive,
      entry("2026-03-13", { counted_for_streak: false }),
      "2026-03-14",
    );
    expect(archive.total_completed).toBe(2);
    // Still 1 — the replay is history, not a streak day.
    expect(archive.current_streak).toBe(1);
  });

  it("keeps the archive bounded", () => {
    let archive = emptyArchive();
    for (let i = 0; i < DAILY_GRID_ARCHIVE_MAX + 25; i += 1) {
      const day = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
      archive = recordCompletedBoard(archive, entry(day), day);
    }
    expect(archive.entries.length).toBe(DAILY_GRID_ARCHIVE_MAX);
  });

  it("reports whether a given day is done", () => {
    const archive = recordCompletedBoard(emptyArchive(), entry("2026-03-14"), "2026-03-14");
    expect(hasCompleted(archive, "2026-03-14")).toBe(true);
    expect(hasCompleted(archive, "2026-03-15")).toBe(false);
  });

  it("returns recent entries newest first", () => {
    let archive = emptyArchive();
    for (const day of ["2026-03-10", "2026-03-12", "2026-03-11"]) {
      archive = recordCompletedBoard(archive, entry(day), "2026-03-12");
    }
    expect(recentEntries(archive, 2).map((e) => e.date)).toEqual(["2026-03-12", "2026-03-11"]);
  });
});

// ---------------------------------------------------------------------------
// Building an entry from real progress
// ---------------------------------------------------------------------------

describe("buildArchiveEntry", () => {
  const NOW = new Date("2026-07-30T12:00:00Z");

  it("snapshots the server's numbers rather than recomputing them", () => {
    const result = gridResult();
    const built = buildArchiveEntry(BOARD, completedProgress(), result, NOW);
    expect(built.score).toBe(result.user_total);
    expect(built.today_max).toBe(result.optimal_total);
    expect(built.percent_of_max).toBe(result.percent_of_best);
    expect(built.grade).toBe("Near Perfect");
    expect(built.elapsed_seconds).toBe(424);
    expect(built.theme).toBe("Two-Way Night");
    expect(built.filled_count).toBe(9);
  });

  it("still records the board when the comparison never loaded", () => {
    const built = buildArchiveEntry(BOARD, completedProgress(), null, NOW);
    expect(built.score).toBeGreaterThan(0);
    expect(built.today_max).toBeNull();
    expect(built.percent_of_max).toBeNull();
    expect(built.grade).toBeNull();
  });

  it("stores display labels, never answer ids", () => {
    const built = buildArchiveEntry(BOARD, completedProgress(), gridResult(), NOW);
    expect(built.picks).toHaveLength(9);
    expect(built.picks[0]).toBe("1993-94 Hakeem Olajuwon");
    // An answer id would make a finished archive a solution key for anyone
    // else on this browser.
    for (const pick of built.picks) expect(pick).not.toMatch(/^[a-z-]+-\d{6}-[a-z]{3}$/);
  });

  it("marks a board played on another day as not counting", () => {
    // BOARD.date is 2026-07-30; "now" here is a different day.
    const built = buildArchiveEntry(
      BOARD,
      completedProgress(),
      gridResult(),
      new Date("2026-08-02T09:00:00Z"),
    );
    expect(built.counted_for_streak).toBe(false);
  });

  it("marks a board played on its own day as counting", () => {
    const built = buildArchiveEntry(BOARD, completedProgress(), gridResult(), NOW);
    expect(built.counted_for_streak).toBe(true);
  });
});

describe("reportableElapsedSeconds", () => {
  it("reports a normal duration in whole seconds", () => {
    expect(reportableElapsedSeconds(completedProgress())).toBe(424);
  });

  it("reports null before the first move", () => {
    expect(reportableElapsedSeconds(emptyProgress(BOARD))).toBeNull();
  });

  it("reports null rather than clamping an implausible clock", () => {
    // The timer is a persisted start timestamp, so a board opened on Monday
    // and finished on Wednesday genuinely reads 48 hours. Clamping to exactly
    // 24h would assert a duration nobody believes; null says the honest thing.
    const twoDays = {
      ...completedProgress(),
      started_at: "2026-07-28T12:00:00Z",
      completed_at: "2026-07-30T12:00:00Z",
    };
    expect(reportableElapsedSeconds(twoDays)).toBeNull();
  });

  it("still reports a duration right at the accepted bound", () => {
    const exactlyADay = {
      ...completedProgress(),
      started_at: "2026-07-29T12:00:00Z",
      completed_at: "2026-07-30T12:00:00Z",
    };
    expect(reportableElapsedSeconds(exactlyADay)).toBe(86_400);
  });
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

describe("archive persistence", () => {
  it("round-trips through localStorage", () => {
    const archive = recordCompletedBoard(emptyArchive(), entry("2026-03-14"), "2026-03-14");
    saveArchive(archive);
    const reloaded = loadArchive("2026-03-14");
    expect(reloaded.total_completed).toBe(1);
    expect(reloaded.current_streak).toBe(1);
    expect(reloaded.entries[0].date).toBe("2026-03-14");
  });

  it("returns an empty archive for a browser that has never played", () => {
    expect(loadArchive("2026-03-14").total_completed).toBe(0);
  });

  it("survives corrupt JSON without throwing", () => {
    window.localStorage.setItem(DAILY_GRID_ARCHIVE_KEY, "{not json");
    expect(() => loadArchive("2026-03-14")).not.toThrow();
    expect(loadArchive("2026-03-14").total_completed).toBe(0);
  });

  it("discards a save written under an older schema", () => {
    window.localStorage.setItem(
      DAILY_GRID_ARCHIVE_KEY,
      JSON.stringify({ schema_version: 0, entries: [entry("2026-03-14")] }),
    );
    expect(loadArchive("2026-03-14").total_completed).toBe(0);
  });

  it("drops individual malformed rows and keeps the rest", () => {
    window.localStorage.setItem(
      DAILY_GRID_ARCHIVE_KEY,
      JSON.stringify({
        ...emptyArchive(),
        entries: [entry("2026-03-14"), { junk: true }, null, entry("2026-03-13")],
      }),
    );
    const loaded = loadArchive("2026-03-14");
    expect(loaded.total_completed).toBe(2);
    expect(loaded.current_streak).toBe(2);
  });

  it("recomputes a hand-edited streak instead of believing it", () => {
    // The counters are derived, so a tampered value is corrected on read
    // rather than displayed once and fixed later.
    window.localStorage.setItem(
      DAILY_GRID_ARCHIVE_KEY,
      JSON.stringify({
        ...emptyArchive(),
        entries: [entry("2026-03-14")],
        current_streak: 900,
        longest_streak: 900,
        total_completed: 900,
      }),
    );
    const loaded = loadArchive("2026-03-14");
    expect(loaded.current_streak).toBe(1);
    expect(loaded.longest_streak).toBe(1);
    expect(loaded.total_completed).toBe(1);
  });

  it("re-derives a stale streak against the current date", () => {
    // Saved when the streak was live; read a week later, it is broken.
    saveArchive(recordCompletedBoard(emptyArchive(), entry("2026-03-14"), "2026-03-14"));
    expect(loadArchive("2026-03-21").current_streak).toBe(0);
    // ...but the history and the longest streak are still there.
    expect(loadArchive("2026-03-21").total_completed).toBe(1);
    expect(loadArchive("2026-03-21").longest_streak).toBe(1);
  });

  it("clears cleanly", () => {
    saveArchive(recordCompletedBoard(emptyArchive(), entry("2026-03-14"), "2026-03-14"));
    clearArchive();
    expect(loadArchive("2026-03-14").total_completed).toBe(0);
  });
});
