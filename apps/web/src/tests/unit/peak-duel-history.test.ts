/**
 * Peak Duel Daily result-history grid — merge/dedupe logic (mission §4).
 *
 * Pure-function tests for `lib/peak-duel-history.ts`: merging the local
 * archive (`LocalProgressRepository`'s `daily_completions`) with the
 * server's own record (`GET /game/daily/history`), keyed and deduped by
 * Pacific daily key, with the server winning a shared day but never
 * erasing a day that exists ONLY locally.
 */
import { describe, expect, it } from "vitest";
import { buildHistoryGrid, mergeDailyHistory } from "@/lib/peak-duel-history";
import type { DailyCompletion, DailyHistoryEntry } from "@/types";

function localCompletion(overrides: Partial<DailyCompletion> = {}): DailyCompletion {
  return {
    date: "2026-08-20",
    years: 3,
    correct: 7,
    total: 10,
    arena_points: 1200,
    best_streak: 4,
    results: [],
    completed_at: "2026-08-20T12:00:00.000Z",
    ...overrides,
  };
}

function remoteEntry(overrides: Partial<DailyHistoryEntry> = {}): DailyHistoryEntry {
  return {
    daily_key: "2026-08-20",
    duration_years: 3,
    duels_total: 10,
    correct_count: 7,
    arena_points: 1200,
    best_streak: 4,
    played_on_daily_key: true,
    ...overrides,
  };
}

describe("mergeDailyHistory", () => {
  it("returns local-only days when the server has no record at all (offline / anonymous, no fetch yet)", () => {
    const merged = mergeDailyHistory({ "2026-08-20-3yr": localCompletion() }, []);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ daily_key: "2026-08-20", correct_count: 7, source: "local" });
  });

  it("returns remote-only days when this browser has no local archive (a fresh browser, signed-in account)", () => {
    const merged = mergeDailyHistory({}, [remoteEntry()]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ daily_key: "2026-08-20", source: "remote" });
  });

  it("dedupes a day present in both, preferring the server's numbers (source of truth)", () => {
    const merged = mergeDailyHistory(
      { "2026-08-20-3yr": localCompletion({ correct: 5 }) },
      [remoteEntry({ correct_count: 7 })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].correct_count).toBe(7);
    expect(merged[0].source).toBe("remote");
  });

  it("never lets an absent remote row erase a completed local-only day (offline sync, not evidence of a blank day)", () => {
    const merged = mergeDailyHistory(
      {
        "2026-08-19-3yr": localCompletion({ date: "2026-08-19" }),
        "2026-08-20-3yr": localCompletion({ date: "2026-08-20" }),
      },
      [remoteEntry({ daily_key: "2026-08-20" })], // server only knows about one of the two days
    );
    const keys = merged.map((d) => d.daily_key).sort();
    expect(keys).toEqual(["2026-08-19", "2026-08-20"]);
    expect(merged.find((d) => d.daily_key === "2026-08-19")?.source).toBe("local");
  });

  it("excludes an archive replay (played_on_daily_key: false) — this calendar is about the day's own board", () => {
    const merged = mergeDailyHistory({}, [remoteEntry({ played_on_daily_key: false })]);
    expect(merged).toHaveLength(0);
  });

  it("sorts most recent daily key first", () => {
    const merged = mergeDailyHistory(
      {},
      [
        remoteEntry({ daily_key: "2026-08-18" }),
        remoteEntry({ daily_key: "2026-08-20" }),
        remoteEntry({ daily_key: "2026-08-19" }),
      ],
    );
    expect(merged.map((d) => d.daily_key)).toEqual(["2026-08-20", "2026-08-19", "2026-08-18"]);
  });
});

describe("buildHistoryGrid", () => {
  it("builds a contiguous calendar window ending at `today`, null for a day with no record", () => {
    const days = [
      { daily_key: "2026-08-20", correct_count: 8, duels_total: 10, arena_points: 100, best_streak: 3, source: "remote" as const },
    ];
    const cells = buildHistoryGrid(days, 3, "2026-08-20");
    expect(cells).toHaveLength(3);
    expect(cells[0]).toBeNull(); // 2026-08-18
    expect(cells[1]).toBeNull(); // 2026-08-19
    expect(cells[2]?.daily_key).toBe("2026-08-20"); // today, last in the oldest-first array
  });

  it("is a pure function of its inputs — same inputs, same output, no hidden clock/state", () => {
    const days = [
      { daily_key: "2026-08-20", correct_count: 8, duels_total: 10, arena_points: 100, best_streak: 3, source: "remote" as const },
    ];
    const a = buildHistoryGrid(days, 5, "2026-08-20");
    const b = buildHistoryGrid(days, 5, "2026-08-20");
    expect(a).toEqual(b);
  });
});
