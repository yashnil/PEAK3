/**
 * `/daily/history` had no dedicated component test before Batch 9 — only
 * exercised incidentally through daily-grid.spec.ts e2e coverage. The API is
 * mocked to REJECT throughout: this page's own contract is that it "must
 * render with no API at all" (see DailyGridHistory.tsx's catch branch), so
 * these tests pin that fallback path rather than a happy-path fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const mockGetBoard = vi.fn();

vi.mock("@/lib/daily-grid-api", () => ({
  getDailyGridBoard: (...a: unknown[]) => mockGetBoard(...a),
}));

import DailyGridHistory from "@/components/daily-grid/DailyGridHistory";
import {
  clearArchive,
  loadArchive,
  recordCompletedBoard,
  saveArchive,
  todayPacific,
} from "@/lib/daily-grid-archive";
import type { DailyGridArchiveEntry } from "@/types/daily-grid";

function entry(overrides: Partial<DailyGridArchiveEntry> = {}): DailyGridArchiveEntry {
  return {
    board_id: "board-1",
    date: "2026-08-01",
    theme: "Ring Chasers",
    difficulty: "medium",
    started_at: "2026-08-01T12:00:00.000Z",
    completed_at: "2026-08-01T12:10:00.000Z",
    elapsed_seconds: 600,
    score: 42,
    today_max: 60,
    percent_of_max: 70,
    grade: "Strong",
    misses: 1,
    filled_count: 9,
    counted_for_streak: true,
    picks: Array.from({ length: 9 }, (_, i) => `Player ${i}`),
    ...overrides,
  };
}

async function waitForLoaded() {
  await waitFor(() =>
    expect(screen.queryByTestId("daily-history-loading")).not.toBeInTheDocument(),
  );
}

describe("DailyGridHistory", () => {
  beforeEach(() => {
    clearArchive();
    mockGetBoard.mockRejectedValue(new Error("offline — history renders local-only"));
  });

  afterEach(() => {
    vi.clearAllMocks();
    clearArchive();
  });

  it("shows a loading state before the local archive resolves", async () => {
    render(<DailyGridHistory />);
    expect(screen.getByTestId("daily-history-loading")).toBeVisible();
    expect(screen.getByTestId("daily-history-loading")).toHaveAttribute("role", "status");
    await waitForLoaded();
  });

  it("renders zero-state stats and the not-played-today prompt with no history at all", async () => {
    render(<DailyGridHistory />);
    await waitForLoaded();

    expect(screen.getByTestId("daily-history-current-streak")).toHaveTextContent("0");
    expect(screen.getByTestId("daily-history-longest-streak")).toHaveTextContent("0");
    expect(screen.getByTestId("daily-history-total")).toHaveTextContent("0");
    expect(screen.getByTestId("daily-history-best-percent")).toHaveTextContent("—");

    expect(screen.getByText(/you have not played today.s grid yet/i)).toBeVisible();
    expect(screen.getByTestId("daily-history-play-today")).toHaveAttribute("href", "/daily/grid");
    expect(screen.getByTestId("daily-history-back")).toHaveAttribute("href", "/daily/grid");
    expect(screen.getByText("Completed grids")).toBeVisible();
    expect(screen.getByText(/no completed grids yet/i)).toBeVisible();
  });

  it("surfaces the player's own local record once boards have been completed", async () => {
    const archive = recordCompletedBoard(
      loadArchive(),
      entry({ board_id: "board-past", date: "2026-07-30", percent_of_max: 55 }),
      "2026-07-30",
    );
    saveArchive(archive);

    render(<DailyGridHistory />);
    await waitForLoaded();

    expect(screen.getByTestId("daily-history-total")).toHaveTextContent("1");
    expect(screen.getByTestId("daily-history-best-percent")).toHaveTextContent("55%");
    expect(screen.getByText("All 1 completed grids")).toBeVisible();
  });

  it("shows the done-for-today banner, with no replay link, once today's board is in the archive", async () => {
    const today = todayPacific();
    const archive = recordCompletedBoard(loadArchive(), entry({ board_id: "board-today", date: today }), today);
    saveArchive(archive);

    render(<DailyGridHistory />);
    await waitForLoaded();

    expect(screen.getByTestId("daily-history-today")).toHaveTextContent(/today.s grid is done/i);
    expect(screen.queryByTestId("daily-history-play-today")).not.toBeInTheDocument();
  });

  it("labels the record as browser-local, not account- or leaderboard-backed", async () => {
    render(<DailyGridHistory />);
    await waitForLoaded();

    expect(screen.getByTestId("daily-history-local-notice")).toHaveTextContent(/stored in this browser/i);
    expect(screen.getByTestId("daily-history-local-notice")).toHaveTextContent(/not ranked against other players/i);
  });
});
