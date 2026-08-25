/**
 * PeakDuelV2History — component-level coverage for mission §4's regression
 * requirements: completes → refresh → still shows it; completes → navigates
 * away and back → still shows it; anonymous (local) persistence; remote
 * fetch failure degrades to local-only rather than crashing.
 *
 * "Refresh" and "navigate away and back" are both modeled the same way here:
 * a fresh `render()` of the component with a fresh module-level singleton
 * reset, reading only `localStorage` (real jsdom storage, which persists
 * across renders within a test the same way it persists across a real
 * reload) and a mocked network call — never anything held in React state
 * from a previous mount, because there is no such state: the component
 * takes no props and no `GameState`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

const getDailyHistoryMock = vi.fn();
vi.mock("@/lib/api", () => ({
  getDailyHistory: () => getDailyHistoryMock(),
}));

import PeakDuelV2History from "@/components/v2/duel/PeakDuelV2History";
import { getProgressRepository, __resetProgressRepositoryForTests } from "@/lib/progress";

const STORAGE_KEY = "peak3_arena_progress";

function seedLocalCompletion(date: string, overrides: Partial<Record<string, unknown>> = {}) {
  const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") ?? {
    schema_version: 1,
    daily_completions: {},
    endless_high_score: 0,
    endless_best_streak: 0,
    lifetime_attempts: 0,
    lifetime_correct: 0,
    preferred_duration: 3,
    settings: { reduced_motion: false },
  };
  existing.daily_completions[`${date}-3yr`] = {
    date,
    years: 3,
    correct: 8,
    total: 10,
    arena_points: 1500,
    best_streak: 5,
    results: [],
    completed_at: `${date}T12:00:00.000Z`,
    ...overrides,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}

beforeEach(() => {
  localStorage.clear();
  getDailyHistoryMock.mockReset();
  getDailyHistoryMock.mockResolvedValue({ entries: [] });
  // `getProgressRepository` is a module-level singleton constructed from
  // whatever `localStorage` held at first import; force it to re-read so
  // each test's seeded storage is actually what the component sees — the
  // same re-read a real page load performs.
  __resetProgressRepositoryForTests();
});

afterEach(() => {
  cleanup();
});

/** Flushes the `getDailyHistory().then(...)` microtask chain so the
 *  component's post-fetch state update has already applied before the next
 *  assertion — avoids relying on incidental timing between tests. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("PeakDuelV2History", () => {
  it("renders nothing when there is no history at all yet (first-ever daily)", async () => {
    const { container } = render(<PeakDuelV2History />);
    await flush();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a completed day from the LOCAL archive alone (anonymous persistence)", async () => {
    seedLocalCompletion("2026-08-20");
    // Fresh repo instance reading the seeded storage — models a fresh page
    // load, not a warm cache from a previous test.
    const repo = getProgressRepository();
    expect(repo.getAll().daily_completions["2026-08-20-3yr"]).toBeTruthy();

    render(<PeakDuelV2History />);
    await flush();
    expect(screen.getByTestId("peak-duel-history-grid")).toBeInTheDocument();
    const cells = screen.getAllByTestId(/peak-duel-history-cell-/);
    const completed = cells.filter((c) => c.getAttribute("data-completed") === "true");
    expect(completed.length).toBeGreaterThanOrEqual(1);
  });

  it("survives a simulated refresh: a second, independent render of the component still shows the completion", async () => {
    seedLocalCompletion("2026-08-20");

    const first = render(<PeakDuelV2History />);
    await flush();
    expect(screen.getByTestId("peak-duel-history-grid")).toBeInTheDocument();
    first.unmount(); // models navigating away

    // Drop the in-memory singleton too — a real page refresh starts with
    // NOTHING in memory, only `localStorage` on disk. This is the strictest
    // version of the simulation: even the repo instance is new.
    __resetProgressRepositoryForTests();

    render(<PeakDuelV2History />);
    await flush();
    expect(screen.getByTestId("peak-duel-history-grid")).toBeInTheDocument();
  });

  it("authenticated / server persistence: shows a day known only to the remote history endpoint", async () => {
    getDailyHistoryMock.mockResolvedValue({
      entries: [
        {
          daily_key: "2026-08-19",
          duration_years: 3,
          duels_total: 10,
          correct_count: 9,
          arena_points: 1800,
          best_streak: 6,
          played_on_daily_key: true,
        },
      ],
    });

    render(<PeakDuelV2History />);
    // The grid renders only after the async fetch resolves and state updates.
    await screen.findByTestId("peak-duel-history-grid");
    const cells = screen.getAllByTestId(/peak-duel-history-cell-/);
    const completed = cells.filter((c) => c.getAttribute("data-completed") === "true");
    expect(completed.length).toBeGreaterThanOrEqual(1);
  });

  it("a failed remote fetch degrades to local-only history rather than crashing or hiding local data", async () => {
    seedLocalCompletion("2026-08-20");
    getDailyHistoryMock.mockRejectedValue(new Error("network error"));

    render(<PeakDuelV2History />);
    // Local data renders immediately regardless of the network call's fate.
    expect(screen.getByTestId("peak-duel-history-grid")).toBeInTheDocument();
    await flush();
    expect(screen.getByTestId("peak-duel-history-grid")).toBeInTheDocument();
  });

  it("merges local and remote without duplicating a day recorded in both", async () => {
    seedLocalCompletion("2026-08-20", { correct: 3 });
    getDailyHistoryMock.mockResolvedValue({
      entries: [
        {
          daily_key: "2026-08-20",
          duration_years: 3,
          duels_total: 10,
          correct_count: 9, // server's number should win
          arena_points: 1800,
          best_streak: 6,
          played_on_daily_key: true,
        },
      ],
    });

    render(<PeakDuelV2History />);
    await screen.findByTestId("peak-duel-history-grid");
    const cells = screen.getAllByTestId(/peak-duel-history-cell-/);
    const completed = cells.filter((c) => c.getAttribute("data-completed") === "true");
    // Exactly one day is completed in this window — the merge deduped
    // rather than showing the local and remote rows as two separate days.
    expect(completed).toHaveLength(1);
  });
});
