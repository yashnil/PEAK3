/**
 * Daily Grid: the midnight rollover, the refetch-storm guard, and the
 * server-authoritative timer (W3, hardening pass).
 *
 * Three audited client defects live here, each with the failure it used to
 * produce spelled out:
 *
 *   D1  a rollover in an open tab REPLACED the board and the progress with the
 *       new day's empty grid. A player six squares in at 00:00 PT lost all six
 *       silently, with nothing to undo and no way back to the board.
 *   D2  `firedForRef` was cleared on every new window OBJECT, and every refetch
 *       makes one — so on a device whose clock ran ahead the guard re-armed
 *       after each fire and the hook refetched once a second until the 120/min
 *       board rate limit locked the player out of their own grid.
 *   D6  `officialSaved` was never reset across a rollover, so the "Saved to
 *       your account" badge could survive onto a day whose save had failed.
 *
 * Plus the timer contract from spec §2: the clock starts on an explicit Start
 * and on nothing else — not the page load, not the walkthrough.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const mockSearch = vi.fn();
const mockSubmit = vi.fn();
const mockGetBoard = vi.fn();
const mockGetResult = vi.fn();
const mockStart = vi.fn();
const mockSaveOfficial = vi.fn();

vi.mock("@/lib/daily-grid-api", () => ({
  getDailyGridBoard: (...a: unknown[]) => mockGetBoard(...a),
  searchPlayerSeasons: (...a: unknown[]) => mockSearch(...a),
  submitDailyGridAnswer: (...a: unknown[]) => mockSubmit(...a),
  getDailyGridResult: (...a: unknown[]) => mockGetResult(...a),
  startDailyGridAttempt: (...a: unknown[]) => mockStart(...a),
  saveOfficialDailyGridResult: (...a: unknown[]) => mockSaveOfficial(...a),
  DailyGridAPIError: class DailyGridAPIError extends Error {},
}));

/** A signed-in player, so the "official" badge is reachable at all (D6). */
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: "u1" }, loading: false }),
}));
vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
}));

import DailyGridGame from "@/components/daily-grid/DailyGridGame";
import { useDailyReset } from "@/lib/use-daily-reset";
import { todayPacific, type DailyWindowPayload } from "@/lib/daily-time";
import {
  DAILY_GRID_PROGRESS_SCHEMA_VERSION,
  DailyGridBoard,
  dailyGridProgressKey,
} from "@/types/daily-grid";
import { BOARD, completedProgress, filledCell, gridResult, playerSeason } from "./daily-grid-fixtures";

/** Mid-morning Pacific: hours of headroom, so nothing rolls over by accident. */
const NOW = "2026-07-30T12:00:00Z";
/** The Pacific daily key at `NOW` — 12:00 UTC is 05:00 PT on the 30th. */
const TODAY_KEY = "2026-07-30";
/** Five seconds before midnight Pacific, for the rollover cases. July is PDT
 *  (UTC-7), so 06:59:55Z is 23:59:55 on the 30th. */
const EVE = "2026-07-31T06:59:55Z";
const NEXT_KEY = "2026-07-31";

/**
 * `BOARD` plus the server's daily block, which is what makes the component
 * treat it as TODAY's board rather than an archive replay. Without a window it
 * falls back to `isCanonicalToday(board.date)`, and the fixture's date is only
 * "today" for the frozen clock these tests set.
 *
 * The window is anchored on the CURRENT fake clock, so a test that moves the
 * clock before building a board gets a board that is internally consistent
 * with it — which matters here, because a board whose key is in the browser's
 * future is exactly the corrected-clock case `useDailyReset` treats as stale.
 */
function todayBoard(
  overrides: { boardId?: string; secondsRemaining?: number; dailyKey?: string } = {},
): DailyGridBoard {
  const now = Date.now();
  const key = overrides.dailyKey ?? todayPacific(new Date(now));
  const secondsRemaining = overrides.secondsRemaining ?? 6 * 3600;
  const ends = new Date(now + secondsRemaining * 1000).toISOString();
  return {
    ...BOARD,
    board_id: overrides.boardId ?? BOARD.board_id,
    date: key,
    daily_key: key,
    timezone: "America/Los_Angeles",
    seconds_remaining: secondsRemaining,
    ends_at: ends,
    attempt_status: "not_started",
    // The nested block the daily-window contract actually reads.
    daily: {
      daily_key: key,
      timezone: "America/Los_Angeles",
      starts_at: new Date(now).toISOString(),
      ends_at: ends,
      seconds_remaining: secondsRemaining,
    },
  } as DailyGridBoard;
}

/** Tomorrow's board, as the server would answer the refetch after a rollover.
 *  Call it with the clock already set — the window is anchored on it. */
const tomorrow = () =>
  todayBoard({ boardId: "grid-2026-07-31", dailyKey: NEXT_KEY, secondsRemaining: 86_400 });

function seedProgress(
  boardId: string,
  over: { filled?: number; startedAt?: string | null; completed?: boolean } = {},
) {
  const filled = over.completed
    ? completedProgress().filled
    : Array.from({ length: over.filled ?? 0 }, (_, i) =>
        filledCell(0, i, playerSeason(), 100 + i, "rare"),
      );
  window.localStorage.setItem(
    dailyGridProgressKey(boardId),
    JSON.stringify({
      board_id: boardId,
      date: TODAY_KEY,
      schema_version: DAILY_GRID_PROGRESS_SCHEMA_VERSION,
      filled,
      incorrect_attempts: 0,
      started_at: over.startedAt === undefined ? "2026-07-30T11:55:00.000Z" : over.startedAt,
      completed_at: over.completed ? "2026-07-30T11:59:00.000Z" : null,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(NOW));
  mockSearch.mockResolvedValue({ query: "", results: [] });
  mockGetResult.mockResolvedValue(gridResult());
  mockSaveOfficial.mockResolvedValue({ official_saved: true, created: true });
  mockStart.mockResolvedValue({
    daily_key: TODAY_KEY,
    started_at: NOW,
    server_now: NOW,
    elapsed_seconds: 0,
    attempt_status: "in_progress",
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* The timer contract (spec §2)                                        */
/* ------------------------------------------------------------------ */

describe("the timer starts on Start and on nothing else", () => {
  it("does not start on page load, and does not start when the walkthrough opens", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockGetBoard.mockResolvedValue(todayBoard());
    render(<DailyGridGame />);

    await screen.findByTestId("daily-grid-start-gate");
    expect(mockStart).not.toHaveBeenCalled();

    // Reading the rules is free — this is the entire point of the start gate.
    await user.click(screen.getByTestId("daily-grid-gate-how-to-play"));
    await screen.findByTestId("daily-grid-tour");
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    expect(mockStart).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("guided-tour-skip"));
    await waitFor(() => expect(screen.queryByTestId("daily-grid-tour")).toBeNull());
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("starts exactly once when the player presses Start", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockGetBoard.mockResolvedValue(todayBoard());
    render(<DailyGridGame />);

    await user.click(await screen.findByTestId("start-daily-grid"));
    await screen.findByTestId("daily-grid-board");
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
    expect(mockStart).toHaveBeenCalledWith(TODAY_KEY, "test-token");
  });

  it("starts from Skip Tour and Start too", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockGetBoard.mockResolvedValue(todayBoard());
    render(<DailyGridGame />);

    await user.click(await screen.findByTestId("daily-grid-gate-skip-tour"));
    await screen.findByTestId("daily-grid-board");
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
  });

  it("derives elapsed time from the SERVER, not from the browser clock", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockGetBoard.mockResolvedValue(todayBoard());
    // The player already has seven minutes on this attempt from another tab.
    mockStart.mockResolvedValue({
      daily_key: TODAY_KEY,
      started_at: "2026-07-30T11:53:00Z",
      server_now: NOW,
      elapsed_seconds: 420,
      attempt_status: "in_progress",
    });
    render(<DailyGridGame />);

    await user.click(await screen.findByTestId("start-daily-grid"));
    await waitFor(() => expect(screen.getByTestId("daily-grid-timer")).toHaveTextContent("7:00"));
  });

  it("falls back to the local clock when the start call fails", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockGetBoard.mockResolvedValue(todayBoard());
    mockStart.mockRejectedValue(new Error("HTTP 404"));
    render(<DailyGridGame />);

    await user.click(await screen.findByTestId("start-daily-grid"));
    await screen.findByTestId("daily-grid-board");
    // Running, from zero, on this device: a board is never blocked on the
    // timer, which scores nothing.
    expect(screen.getByTestId("daily-grid-timer")).toHaveTextContent("0:00");
    await act(async () => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.getByTestId("daily-grid-timer")).toHaveTextContent("1:05");
  });

  it("starts at most one attempt however many squares are clicked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockGetBoard.mockResolvedValue(todayBoard());
    render(<DailyGridGame skipRulesGate />);

    const cells = await screen.findAllByTestId("grid-cell");
    await user.click(cells[0]);
    await user.click(cells[1]);
    await user.click(cells[2]);
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
  });

  it("resumes an existing attempt's true elapsed time on a second device", async () => {
    // Nothing in this browser's storage, but the server already has an
    // in-progress attempt for this account. `/start` is idempotent, so the
    // first move resolves to the ORIGINAL start instant rather than a new one.
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockGetBoard.mockResolvedValue({
      ...todayBoard(),
      attempt_status: "in_progress",
    });
    mockStart.mockResolvedValue({
      daily_key: TODAY_KEY,
      started_at: "2026-07-30T11:47:20Z",
      server_now: NOW,
      elapsed_seconds: 760,
      attempt_status: "in_progress",
    });
    render(<DailyGridGame skipRulesGate />);

    const cells = await screen.findAllByTestId("grid-cell");
    expect(screen.getByTestId("daily-grid-timer")).toHaveTextContent("—");
    await user.click(cells[0]);
    await waitFor(() => expect(screen.getByTestId("daily-grid-timer")).toHaveTextContent("12:40"));
  });

  it("never starts today's attempt from an archive board", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockGetBoard.mockResolvedValue(
      todayBoard({ dailyKey: "2026-03-14", secondsRemaining: 0 }),
    );
    render(<DailyGridGame date="2026-03-14" skipRulesGate />);

    const cells = await screen.findAllByTestId("grid-cell");
    await user.click(cells[0]);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(mockStart).not.toHaveBeenCalled();
    // The local clock still runs, so the player still sees their own time.
    expect(screen.getByTestId("daily-grid-timer")).not.toHaveTextContent("—");
  });
});

/* ------------------------------------------------------------------ */
/* D1 — the rollover prompts                                           */
/* ------------------------------------------------------------------ */

describe("D1: a midnight rollover prompts instead of discarding", () => {
  // Five seconds before midnight Pacific, so advancing the clock crosses a
  // REAL boundary: the board's window closes and the browser's own Pacific day
  // moves on at the same instant, which is the only state in which a rollover
  // is genuinely correct.
  beforeEach(() => {
    vi.setSystemTime(new Date(EVE));
  });

  it("keeps a part-filled board on screen and asks", async () => {
    seedProgress(BOARD.board_id, { filled: 3 });
    mockGetBoard.mockResolvedValue(todayBoard({ secondsRemaining: 5 }));
    render(<DailyGridGame skipRulesGate />);
    await screen.findByTestId("daily-grid-board");
    expect(mockGetBoard).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(6000);
    });

    expect(await screen.findByTestId("daily-grid-rollover-prompt")).toBeInTheDocument();
    // NOT refetched, NOT replaced: the three locked squares are still there.
    expect(mockGetBoard).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("daily-grid-progress")).toHaveTextContent("3/9");
    expect(screen.getByTestId("daily-grid-score")).toHaveTextContent("303");
  });

  it("lets the player stay on the board they were playing", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    seedProgress(BOARD.board_id, { filled: 3 });
    mockGetBoard.mockResolvedValue(todayBoard({ secondsRemaining: 5 }));
    render(<DailyGridGame skipRulesGate />);
    await screen.findByTestId("daily-grid-board");

    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    await user.click(await screen.findByTestId("daily-grid-rollover-stay"));

    await waitFor(() =>
      expect(screen.queryByTestId("daily-grid-rollover-prompt")).toBeNull(),
    );
    expect(screen.getByTestId("daily-grid-progress")).toHaveTextContent("3/9");
    expect(mockGetBoard).toHaveBeenCalledTimes(1);

    // And the prompt does not come back once a minute for the rest of the day.
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    expect(screen.queryByTestId("daily-grid-rollover-prompt")).toBeNull();
    expect(mockGetBoard).toHaveBeenCalledTimes(1);
  });

  it("moves to the new day only when the player asks", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    seedProgress(BOARD.board_id, { filled: 3 });
    mockGetBoard
      .mockResolvedValueOnce(todayBoard({ secondsRemaining: 5 }))
      .mockResolvedValue(tomorrow());
    render(<DailyGridGame skipRulesGate />);
    await screen.findByTestId("daily-grid-board");

    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    await user.click(await screen.findByTestId("daily-grid-rollover-switch"));

    await waitFor(() => expect(mockGetBoard).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId("daily-grid-date")).toHaveTextContent("2026-07-31"));
    // The new day starts clean, and the prompt is gone.
    expect(screen.getByTestId("daily-grid-progress")).toHaveTextContent("0/9");
    expect(screen.queryByTestId("daily-grid-rollover-prompt")).toBeNull();
  });

  it("still swaps an untouched board silently — there is nothing to lose", async () => {
    mockGetBoard
      .mockResolvedValueOnce(todayBoard({ secondsRemaining: 5 }))
      .mockResolvedValue(tomorrow());
    render(<DailyGridGame skipRulesGate />);
    await screen.findByTestId("daily-grid-board");

    await act(async () => {
      vi.advanceTimersByTime(6000);
    });

    await waitFor(() => expect(mockGetBoard).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("daily-grid-rollover-prompt")).toBeNull();
  });

  it("never prompts on a deliberately opened archive board", async () => {
    seedProgress(BOARD.board_id, { filled: 3 });
    mockGetBoard.mockResolvedValue(todayBoard({ dailyKey: "2026-03-14", secondsRemaining: 0 }));
    render(<DailyGridGame date="2026-03-14" skipRulesGate />);
    await screen.findByTestId("daily-grid-board");

    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    expect(screen.queryByTestId("daily-grid-rollover-prompt")).toBeNull();
    expect(mockGetBoard).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/* D6 — the official badge does not survive a rollover                 */
/* ------------------------------------------------------------------ */

describe("D6: the official badge belongs to one board", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date(EVE));
  });

  it("clears when the board is replaced, so a failed save cannot inherit it", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    seedProgress(BOARD.board_id, { completed: true });
    seedProgress("grid-2026-07-31", { completed: true });
    mockGetBoard
      .mockResolvedValueOnce(todayBoard({ secondsRemaining: 5 }))
      .mockResolvedValue(tomorrow());
    // Yesterday's save succeeded; today's fails.
    mockSaveOfficial
      .mockResolvedValueOnce({ official_saved: true, created: true })
      .mockRejectedValue(new Error("offline"));

    render(<DailyGridGame skipRulesGate />);
    await waitFor(() =>
      expect(screen.getByTestId("complete-local-only")).toHaveAttribute("data-official", "true"),
    );

    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    await user.click(await screen.findByTestId("daily-grid-rollover-switch"));

    await waitFor(() => expect(mockGetBoard).toHaveBeenCalledTimes(2));
    // The badge used to survive the swap and claim a save that never happened.
    await waitFor(() =>
      expect(screen.getByTestId("complete-local-only")).toHaveAttribute("data-official", "false"),
    );
  });
});

/* ------------------------------------------------------------------ */
/* D2 — the refetch storm                                              */
/* ------------------------------------------------------------------ */

describe("D2: a new window object cannot re-arm the same fire", () => {
  function windowFor(dailyKey: string, secondsRemaining: number): DailyWindowPayload {
    return {
      daily_key: dailyKey,
      timezone: "America/Los_Angeles",
      starts_at: NOW,
      ends_at: new Date(Date.parse(NOW) + secondsRemaining * 1000).toISOString(),
      seconds_remaining: secondsRemaining,
    };
  }

  it("fires once per daily key, however many refetches follow", () => {
    // The audited scenario exactly: the DEVICE clock says it is already the
    // 31st, so `keyMovedOn` is true against a board the server keeps insisting
    // is today's. Every refetch hands the hook a brand new window object.
    vi.setSystemTime(new Date("2026-07-31T20:00:00Z"));
    const onReset = vi.fn();
    const { rerender } = renderHook(
      ({ win }: { win: DailyWindowPayload }) =>
        useDailyReset({
          dailyKey: win.daily_key,
          secondsRemaining: win.seconds_remaining,
          window: win,
          onReset,
        }),
      { initialProps: { win: windowFor("2026-07-30", 10 * 3600) } },
    );

    act(() => {
      globalThis.dispatchEvent(new Event("focus"));
    });
    expect(onReset).toHaveBeenCalledTimes(1);

    // Ten refetches, ten new objects, same key. Before the fix each one reset
    // the guard and the next tick fired again — one request per second until
    // the board rate limit 429ed the player out.
    for (let i = 0; i < 10; i += 1) {
      rerender({ win: windowFor("2026-07-30", 10 * 3600) });
      act(() => {
        vi.advanceTimersByTime(1000);
        globalThis.dispatchEvent(new Event("focus"));
      });
    }
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("still fires for a genuinely new daily key", () => {
    vi.setSystemTime(new Date("2026-07-31T20:00:00Z"));
    const onReset = vi.fn();
    const { rerender } = renderHook(
      ({ win }: { win: DailyWindowPayload }) =>
        useDailyReset({
          dailyKey: win.daily_key,
          secondsRemaining: win.seconds_remaining,
          window: win,
          onReset,
        }),
      { initialProps: { win: windowFor("2026-07-30", 10 * 3600) } },
    );
    act(() => {
      globalThis.dispatchEvent(new Event("focus"));
    });
    expect(onReset).toHaveBeenCalledTimes(1);

    // The clock moves on again; the board the hook is now watching is the 31st,
    // and the device says it is the 1st. A different key, so a new fire.
    vi.setSystemTime(new Date("2026-08-01T20:00:00Z"));
    rerender({ win: windowFor("2026-07-31", 10 * 3600) });
    act(() => {
      globalThis.dispatchEvent(new Event("focus"));
    });
    expect(onReset).toHaveBeenCalledTimes(2);
  });
});
