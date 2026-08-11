/**
 * FINAL INTEGRITY CLOSURE — the reveal-anchored clock (gap 2) and
 * leaderboard retries (gap 1), at the component layer.
 *
 * Gap 2's contract: the authoritative attempt clock exists BEFORE the board
 * is actionable. The board is un-clickable while the /start handshake is in
 * flight, the first move establishes nothing (the clock is already running),
 * and time spent staring at the revealed board is time on the clock.
 *
 * Gap 1's contract: a replay is a separate run under a separate storage key
 * that can only ever talk to /daily-grid/retry/complete — never /official,
 * never the local archive — and the player is told plainly whether it beat
 * their best.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const mockSearch = vi.fn();
const mockSubmit = vi.fn();
const mockGetBoard = vi.fn();
const mockGetResult = vi.fn();
const mockStart = vi.fn();
const mockSaveOfficial = vi.fn();
const mockRetryStart = vi.fn();
const mockRetryComplete = vi.fn();
const mockFetchLeaderboard = vi.fn().mockRejectedValue(new Error("not stubbed"));

vi.mock("@/lib/daily-grid-api", () => ({
  getDailyGridBoard: (...a: unknown[]) => mockGetBoard(...a),
  searchPlayerSeasons: (...a: unknown[]) => mockSearch(...a),
  submitDailyGridAnswer: (...a: unknown[]) => mockSubmit(...a),
  getDailyGridResult: (...a: unknown[]) => mockGetResult(...a),
  startDailyGridAttempt: (...a: unknown[]) => mockStart(...a),
  saveOfficialDailyGridResult: (...a: unknown[]) => mockSaveOfficial(...a),
  startDailyGridRetry: (...a: unknown[]) => mockRetryStart(...a),
  completeDailyGridRetry: (...a: unknown[]) => mockRetryComplete(...a),
  fetchDailyLeaderboard: (...a: unknown[]) => mockFetchLeaderboard(...a),
  DailyGridAPIError: class DailyGridAPIError extends Error {},
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: "u1" }, loading: false, supabaseEnabled: true }),
}));
vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
}));

import DailyGridGame from "@/components/daily-grid/DailyGridGame";
import { todayPacific } from "@/lib/daily-time";
import { DailyGridBoard, dailyGridProgressKey } from "@/types/daily-grid";
import { BOARD, completedProgress, gridResult, playerSeason, searchHit } from "./daily-grid-fixtures";

const NOW = "2026-07-30T12:00:00Z";
const TODAY_KEY = "2026-07-30";

/** Same construction as daily-grid-rollover.test.tsx: `BOARD` plus the daily
 *  window block that makes the component treat it as TODAY's board. */
function todayBoard(): DailyGridBoard {
  const now = Date.now();
  const key = todayPacific(new Date(now));
  const ends = new Date(now + 6 * 3600 * 1000).toISOString();
  return {
    ...BOARD,
    date: key,
    daily_key: key,
    timezone: "America/Los_Angeles",
    seconds_remaining: 6 * 3600,
    ends_at: ends,
    attempt_status: "not_started",
    daily: {
      daily_key: key,
      timezone: "America/Los_Angeles",
      starts_at: new Date(now).toISOString(),
      ends_at: ends,
      seconds_remaining: 6 * 3600,
    },
  } as DailyGridBoard;
}

const HAKEEM = playerSeason();
// The wire shapes carry no score (Phase 11B).
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured purely to drop the field
const { prime_score: _dropped, ...HAKEEM_IDENTITY } = HAKEEM;

function validResponse() {
  return {
    valid: true,
    player_season: HAKEEM_IDENTITY,
    cell_score: {
      arena_points: 118,
      quality_points: 92,
      rarity_bucket: "rare" as const,
      rarity_label: "Rare square",
      rarity_multiplier: 1.28,
      rarity_bonus: 26,
    },
  };
}

function seedCanonicalCompleted() {
  window.localStorage.setItem(
    dailyGridProgressKey(BOARD.board_id),
    JSON.stringify({
      ...completedProgress(),
      date: TODAY_KEY,
      started_at: "2026-07-30T11:52:56Z",
      completed_at: "2026-07-30T12:00:00Z",
    }),
  );
}

/** An in-flight RETRY run, eight squares in — (0,0) still open. */
function seedRetryInProgress() {
  const base = completedProgress();
  window.localStorage.setItem(
    dailyGridProgressKey(`${BOARD.board_id}::retry`),
    JSON.stringify({
      ...base,
      board_id: `${BOARD.board_id}::retry`,
      date: TODAY_KEY,
      filled: base.filled.slice(1),
      started_at: "2026-07-30T11:58:00Z",
      completed_at: null,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  // The gate is once-ever; these are returning players.
  window.localStorage.setItem(
    "peak3.tour.state",
    JSON.stringify({
      schema_version: 1,
      tours: { "daily-grid": { version: 1, status: "completed", at: "" } },
      coachmarks: {},
    }),
  );
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(NOW));
  mockSearch.mockResolvedValue({ query: "olajuwon", results: [searchHit()] });
  mockSubmit.mockResolvedValue(validResponse());
  mockGetBoard.mockResolvedValue(todayBoard());
  mockGetResult.mockResolvedValue(gridResult());
  mockSaveOfficial.mockResolvedValue({ official_saved: true, created: true });
  mockFetchLeaderboard.mockRejectedValue(new Error("not stubbed"));
  mockStart.mockResolvedValue({
    daily_key: TODAY_KEY,
    started_at: NOW,
    server_now: NOW,
    elapsed_seconds: 0,
    attempt_status: "in_progress",
  });
  mockRetryStart.mockResolvedValue({
    daily_key: TODAY_KEY,
    retry_id: "retry-1",
    started_at: NOW,
    server_now: NOW,
  });
  mockRetryComplete.mockResolvedValue({
    score: 840,
    completion_time_ms: 42_800,
    improved: true,
    best_score: 840,
    best_completion_time_ms: 42_800,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the clock anchors at board reveal (gap 2)", () => {
  it("starts the authoritative attempt at reveal — the first move establishes nothing", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<DailyGridGame skipRulesGate />);

    // The clock exists before ANY interaction.
    await screen.findAllByTestId("grid-cell");
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
    expect(mockStart).toHaveBeenCalledWith(TODAY_KEY, "test-token");

    // A move later adds nothing: the clock cannot be established, moved or
    // restarted by playing.
    const cells = screen.getAllByTestId("grid-cell");
    await user.click(cells[0]);
    await user.click(cells[1]);
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it("the board is not actionable until the authoritative started_at exists", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let releaseStart!: (value: unknown) => void;
    mockStart.mockReturnValue(new Promise((resolve) => (releaseStart = resolve)));
    render(<DailyGridGame skipRulesGate />);

    const cells = await screen.findAllByTestId("grid-cell");
    // Handshake in flight: a click selects nothing.
    await user.click(cells[0]);
    expect(screen.queryByTestId("cell-panel")).not.toBeInTheDocument();

    await act(async () => {
      releaseStart({
        daily_key: TODAY_KEY,
        started_at: NOW,
        server_now: NOW,
        elapsed_seconds: 0,
        attempt_status: "in_progress",
      });
    });
    await user.click(cells[0]);
    expect(await screen.findByTestId("cell-panel")).toBeInTheDocument();
  });

  it("waiting five seconds before the first move costs five seconds", async () => {
    render(<DailyGridGame skipRulesGate />);
    await screen.findAllByTestId("grid-cell");
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));

    // No move made; the revealed board is studyable, so the clock runs.
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByTestId("daily-grid-timer")).toHaveTextContent("0:05");
  });

  it("a reload keeps the same started_at — the clock is never re-stamped", async () => {
    // First reveal: the server says this attempt is already five minutes old
    // (the idempotent /start answers with the ORIGINAL instant), and the
    // client re-anchors its display to that answer before persisting it.
    mockStart.mockResolvedValue({
      daily_key: TODAY_KEY,
      started_at: "2026-07-30T11:55:00Z",
      server_now: NOW,
      elapsed_seconds: 300,
      attempt_status: "in_progress",
    });
    const { unmount } = render(<DailyGridGame skipRulesGate />);
    await screen.findAllByTestId("grid-cell");
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("daily-grid-timer")).toHaveTextContent("5:00"),
    );
    unmount();

    // The reload restores that same anchored clock and pings nothing: with a
    // timestamp already present there is no path that could re-stamp it —
    // and the server's own `started_at` is immutable regardless (the /start
    // route is ON CONFLICT DO NOTHING; API-tested).
    render(<DailyGridGame skipRulesGate />);
    await screen.findAllByTestId("grid-cell");
    expect(screen.getByTestId("daily-grid-timer")).toHaveTextContent("5:00");
    expect(mockStart).toHaveBeenCalledTimes(1);
  });
});

describe("leaderboard retries (gap 1)", () => {
  it("offers a replay after the official save, and says the official result is safe", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    seedCanonicalCompleted();
    render(<DailyGridGame skipRulesGate />);

    await screen.findByTestId("daily-grid-complete");
    await waitFor(() => expect(mockSaveOfficial).toHaveBeenCalledTimes(1));
    const replay = await screen.findByTestId("daily-grid-replay");
    expect(screen.getByTestId("daily-grid-complete")).toHaveTextContent(
      /official result stays recorded/i,
    );

    await user.click(replay);
    await waitFor(() =>
      expect(mockRetryStart).toHaveBeenCalledWith(TODAY_KEY, "test-token"),
    );
    // A fresh, empty board under the retry identity — the canonical completed
    // record still sits untouched in its own storage key.
    await waitFor(() =>
      expect(screen.getByTestId("daily-grid-progress")).toHaveTextContent("0/9"),
    );
    expect(screen.queryByTestId("daily-grid-complete")).not.toBeInTheDocument();
    const canonical = window.localStorage.getItem(dailyGridProgressKey(BOARD.board_id));
    expect(JSON.parse(canonical!).completed_at).toBe("2026-07-30T12:00:00Z");
  });

  it("a finished retry posts ONLY to retry/complete and reports the improvement", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    seedCanonicalCompleted();
    seedRetryInProgress();
    render(<DailyGridGame skipRulesGate />);

    // Resumed mid-retry: eight squares, the top-left still open.
    await waitFor(() =>
      expect(screen.getByTestId("daily-grid-progress")).toHaveTextContent("8/9"),
    );
    const cells = screen.getAllByTestId("grid-cell");
    await user.click(cells[0]);
    await user.type(screen.getByTestId("cell-search-input"), "olajuwon");
    await user.click(await screen.findByTestId("cell-search-result"));

    await waitFor(() => expect(mockRetryComplete).toHaveBeenCalledTimes(1));
    const [body, token] = mockRetryComplete.mock.calls[0];
    expect(token).toBe("test-token");
    expect(body.date).toBe(TODAY_KEY);
    expect(body.filled).toHaveLength(9);
    // No score, no time — there is nothing in the body a client could forge.
    expect(body).not.toHaveProperty("elapsed_seconds");
    expect(body).not.toHaveProperty("completion_time_ms");
    expect(body).not.toHaveProperty("started_at");

    // NEVER the official-result path, and the run is labeled a replay.
    expect(mockSaveOfficial).not.toHaveBeenCalled();
    await screen.findByTestId("daily-grid-retry-banner");
    expect(await screen.findByTestId("daily-grid-retry-outcome")).toHaveTextContent(
      /leaderboard updated/i,
    );
  });

  it("an unbeaten best is reported honestly, and a failed submission is never dressed up", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockRetryComplete.mockResolvedValue({
      score: 700,
      completion_time_ms: 90_000,
      improved: false,
      best_score: 842,
      best_completion_time_ms: 40_000,
    });
    seedCanonicalCompleted();
    seedRetryInProgress();
    render(<DailyGridGame skipRulesGate />);

    await waitFor(() =>
      expect(screen.getByTestId("daily-grid-progress")).toHaveTextContent("8/9"),
    );
    await user.click(screen.getAllByTestId("grid-cell")[0]);
    await user.type(screen.getByTestId("cell-search-input"), "olajuwon");
    await user.click(await screen.findByTestId("cell-search-result"));

    expect(await screen.findByTestId("daily-grid-retry-outcome")).toHaveTextContent(
      /earlier run stays on the board/i,
    );
    expect(screen.getByTestId("daily-grid-retry-outcome")).not.toHaveTextContent(
      /leaderboard updated/i,
    );
  });

  it("returns to the recorded official result without touching it", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    seedCanonicalCompleted();
    seedRetryInProgress();
    render(<DailyGridGame skipRulesGate />);

    await waitFor(() =>
      expect(screen.getByTestId("daily-grid-progress")).toHaveTextContent("8/9"),
    );
    await user.click(screen.getAllByTestId("grid-cell")[0]);
    await user.type(screen.getByTestId("cell-search-input"), "olajuwon");
    await user.click(await screen.findByTestId("cell-search-result"));
    await screen.findByTestId("daily-grid-retry-outcome");

    await user.click(screen.getByTestId("daily-grid-retry-exit"));
    // The canonical run, exactly as it was recorded: its own total, no
    // replay banner.
    await waitFor(() =>
      expect(screen.getByTestId("complete-total-score")).toHaveTextContent("842"),
    );
    expect(screen.queryByTestId("daily-grid-retry-banner")).not.toBeInTheDocument();
  });
});
