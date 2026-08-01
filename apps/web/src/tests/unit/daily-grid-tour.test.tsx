/**
 * The Daily Grid first-time walkthrough (W3, hardening pass).
 *
 * Mirrors `guided-tour.test.tsx` for the second tour to use the shared
 * `GuidedTour` machinery. The cases that are NOT in that file are the ones the
 * Daily Grid brief added: the walkthrough must be untimed, it must be
 * replayable from a permanent control, and reopening it must not touch the
 * board or pause the clock — a walkthrough that costs a player time is worse
 * than no walkthrough, because the timer is the one number the mode records.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const mockSearch = vi.fn();
const mockSubmit = vi.fn();
const mockGetBoard = vi.fn();
const mockGetResult = vi.fn();
const mockStart = vi.fn(async (dailyKey?: unknown) => ({
  daily_key: typeof dailyKey === "string" ? dailyKey : "2026-07-30",
  started_at: new Date().toISOString(),
  server_now: new Date().toISOString(),
  elapsed_seconds: 0,
  attempt_status: "in_progress" as const,
}));

vi.mock("@/lib/daily-grid-api", () => ({
  getDailyGridBoard: (...a: unknown[]) => mockGetBoard(...a),
  searchPlayerSeasons: (...a: unknown[]) => mockSearch(...a),
  submitDailyGridAnswer: (...a: unknown[]) => mockSubmit(...a),
  getDailyGridResult: (...a: unknown[]) => mockGetResult(...a),
  startDailyGridAttempt: (...a: unknown[]) => mockStart(...a),
  DailyGridAPIError: class DailyGridAPIError extends Error {},
}));

import DailyGridGame from "@/components/daily-grid/DailyGridGame";
import { GuidedTour, TourLauncher } from "@/components/ui/GuidedTour";
import {
  DAILY_GRID_TOUR,
  DAILY_GRID_TOUR_ID,
  DAILY_GRID_TOUR_VERSION,
  RUN_THE_TABLE_TOUR,
} from "@/components/ui/tour-steps";
import { markTourSeen, readTourSeen, shouldAutoStartTour } from "@/lib/tour-state";
import {
  DAILY_GRID_PROGRESS_SCHEMA_VERSION,
  dailyGridProgressKey,
} from "@/types/daily-grid";
import { BOARD, filledCell, gridResult, playerSeason } from "./daily-grid-fixtures";

/** The tour under test, wired the way `DailyGridGame` wires it. */
function DailyTour(props: { blocked?: boolean; version?: number; autoStart?: boolean }) {
  return (
    <GuidedTour
      steps={DAILY_GRID_TOUR}
      tourId={DAILY_GRID_TOUR_ID}
      version={props.version ?? DAILY_GRID_TOUR_VERSION}
      eyebrow="How the Daily Grid works"
      blocked={props.blocked}
      autoStart={props.autoStart}
      data-testid="daily-grid-tour"
    />
  );
}

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

/** A laid-out `data-tour-id` target. jsdom reports a zero rect for everything,
 *  so the rect is stubbed — that is the only way to exercise the spotlight. */
function mountTarget(tourId: string, rect = { top: 120, left: 80, width: 300, height: 160 }) {
  const el = document.createElement("div");
  el.setAttribute("data-tour-id", tourId);
  el.getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
  el.scrollIntoView = vi.fn();
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  document.body.innerHTML = "";
  mockSearch.mockResolvedValue({ query: "", results: [] });
  mockGetResult.mockResolvedValue(gridResult());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */
/* Step content                                                        */
/* ------------------------------------------------------------------ */

describe("step content", () => {
  it("ships exactly the seven briefed steps, in the briefed order", () => {
    expect(DAILY_GRID_TOUR.map((s) => s.id)).toEqual([
      "objective",
      "rows-and-columns",
      "exact-seasons",
      "one-player-per-board",
      "picks-lock",
      "scoring",
      "timer",
    ]);
  });

  it("gives every step a title, a body and at least one spotlight target", () => {
    for (const step of DAILY_GRID_TOUR) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
      expect(step.targets.length).toBeGreaterThan(0);
    }
  });

  /**
   * The seven subjects, exactly as briefed. Each is matched against the step's
   * own text rather than against a title, so rewording a heading cannot quietly
   * drop the rule the step exists to state.
   */
  it.each([
    ["objective", /maximize your total PEAK3 score/i],
    ["rows-and-columns", /satisfy both/i],
    ["exact-seasons", /exact player-seasons/i],
    ["one-player-per-board", /nine different players/i],
    ["picks-lock", /a valid pick is final/i],
    ["scoring", /higher-rated seasons score more/i],
    ["timer", /the clock starts only when you press start/i],
  ])("states the %s rule", (id, pattern) => {
    const step = DAILY_GRID_TOUR.find((s) => s.id === id);
    expect(step).toBeDefined();
    expect(`${step?.body} ${step?.detail ?? ""}`).toMatch(pattern);
  });

  it("says the maximum is released only after the board is finished", () => {
    const scoring = DAILY_GRID_TOUR.find((s) => s.id === "scoring");
    expect(`${scoring?.body} ${scoring?.detail ?? ""}`).toMatch(/once all nine are done/i);
  });

  it("aims every step at a Daily Grid target and never at a RUN THE TABLE one", () => {
    for (const step of DAILY_GRID_TOUR) {
      for (const target of step.targets) {
        expect(target.startsWith("dg-")).toBe(true);
      }
    }
  });

  it("leaves the RUN THE TABLE tour untouched", () => {
    // The target union was widened, not replaced. If widening it had broken the
    // other tour this would be the first thing to notice.
    expect(RUN_THE_TABLE_TOUR).toHaveLength(7);
    for (const step of RUN_THE_TABLE_TOUR) {
      for (const target of step.targets) {
        expect(target.startsWith("rtt-")).toBe(true);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* First run                                                           */
/* ------------------------------------------------------------------ */

describe("first run", () => {
  it("auto-starts on a first visit when it is allowed to", async () => {
    render(<DailyTour />);
    expect(await screen.findByTestId("guided-tour-popover")).toBeInTheDocument();
  });

  it("shows the first step and its progress as '1 of 7'", async () => {
    render(<DailyTour />);
    await screen.findByTestId("guided-tour-popover");
    expect(screen.getByTestId("guided-tour-progress")).toHaveTextContent("1 of 7");
    expect(screen.getByTestId("guided-tour-title")).toHaveTextContent(DAILY_GRID_TOUR[0].title);
  });

  it("does NOT auto-start once it has been seen at this version", () => {
    markTourSeen(DAILY_GRID_TOUR_ID, DAILY_GRID_TOUR_VERSION, "completed");
    render(<DailyTour />);
    expect(screen.queryByTestId("guided-tour-popover")).toBeNull();
  });

  it("auto-starts again after a version bump — the whole point of versioning it", async () => {
    markTourSeen(DAILY_GRID_TOUR_ID, DAILY_GRID_TOUR_VERSION, "completed");
    render(<DailyTour version={DAILY_GRID_TOUR_VERSION + 1} />);
    expect(await screen.findByTestId("guided-tour-popover")).toBeInTheDocument();
  });

  it("does not share a record with the RUN THE TABLE tour", () => {
    markTourSeen("run-the-table", 2, "completed");
    expect(shouldAutoStartTour(DAILY_GRID_TOUR_ID, DAILY_GRID_TOUR_VERSION)).toBe(true);
  });

  it("suppresses the auto-start entirely while blocked, losing nothing", () => {
    render(<DailyTour blocked />);
    expect(screen.queryByTestId("guided-tour-popover")).toBeNull();
    expect(shouldAutoStartTour(DAILY_GRID_TOUR_ID, DAILY_GRID_TOUR_VERSION)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

describe("controls", () => {
  it("steps forward and back through all seven, with Back disabled on the first", async () => {
    render(<DailyTour />);
    await screen.findByTestId("guided-tour-popover");
    expect(screen.getByTestId("guided-tour-back")).toBeDisabled();

    for (let i = 1; i < DAILY_GRID_TOUR.length; i += 1) {
      await userEvent.click(screen.getByTestId("guided-tour-next"));
      expect(screen.getByTestId("guided-tour-progress")).toHaveTextContent(
        `${i + 1} of ${DAILY_GRID_TOUR.length}`,
      );
      expect(screen.getByTestId("guided-tour-title")).toHaveTextContent(DAILY_GRID_TOUR[i].title);
    }

    await userEvent.click(screen.getByTestId("guided-tour-back"));
    expect(screen.getByTestId("guided-tour-progress")).toHaveTextContent("6 of 7");
  });

  it("finishes on the last step and records completion", async () => {
    render(<DailyTour />);
    await screen.findByTestId("guided-tour-popover");
    for (let i = 0; i < DAILY_GRID_TOUR.length - 1; i += 1) {
      await userEvent.click(screen.getByTestId("guided-tour-next"));
    }
    expect(screen.getByTestId("guided-tour-progress")).toHaveTextContent("7 of 7");
    expect(screen.getByTestId("guided-tour-next")).toHaveTextContent(/done/i);

    await userEvent.click(screen.getByTestId("guided-tour-next"));
    await waitFor(() => expect(screen.queryByTestId("guided-tour-popover")).toBeNull());
    expect(readTourSeen(DAILY_GRID_TOUR_ID)).toEqual(
      expect.objectContaining({ version: DAILY_GRID_TOUR_VERSION, status: "completed" }),
    );
  });

  it.each([
    ["Skip", "guided-tour-skip"],
    ["the close button", "guided-tour-close"],
  ])("%s closes it and records a skip", async (_label, testId) => {
    render(<DailyTour />);
    await screen.findByTestId("guided-tour-popover");
    await userEvent.click(screen.getByTestId(testId));
    await waitFor(() => expect(screen.queryByTestId("guided-tour-popover")).toBeNull());
    expect(readTourSeen(DAILY_GRID_TOUR_ID)?.status).toBe("skipped");
  });

  it("Escape closes it", async () => {
    render(<DailyTour />);
    await screen.findByTestId("guided-tour-popover");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("guided-tour-popover")).toBeNull());
    expect(shouldAutoStartTour(DAILY_GRID_TOUR_ID, DAILY_GRID_TOUR_VERSION)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Focus                                                               */
/* ------------------------------------------------------------------ */

describe("focus", () => {
  it("moves focus into the popover on open and exposes it as a modal dialog", async () => {
    render(<DailyTour />);
    const popover = await screen.findByTestId("guided-tour-popover");
    await waitFor(() =>
      expect(popover === document.activeElement || popover.contains(document.activeElement)).toBe(
        true,
      ),
    );
    expect(popover).toHaveAttribute("role", "dialog");
    expect(popover).toHaveAttribute("aria-modal", "true");
    expect(within(popover).getByTestId("guided-tour-title")).toBeInTheDocument();
  });

  it("returns focus to the control that opened it", async () => {
    markTourSeen(DAILY_GRID_TOUR_ID, DAILY_GRID_TOUR_VERSION, "completed");
    render(
      <TourLauncher
        steps={DAILY_GRID_TOUR}
        tourId={DAILY_GRID_TOUR_ID}
        version={DAILY_GRID_TOUR_VERSION}
      />,
    );
    const launcher = screen.getByTestId("tour-launcher");
    await userEvent.click(launcher);
    await screen.findByTestId("guided-tour-popover");

    await userEvent.click(screen.getByTestId("guided-tour-skip"));
    await waitFor(() => expect(document.activeElement).toBe(launcher));
  });
});

/* ------------------------------------------------------------------ */
/* Reduced motion                                                      */
/* ------------------------------------------------------------------ */

describe("reduced motion", () => {
  it("marks the overlay as un-animated and scrolls instantly", async () => {
    stubReducedMotion(true);
    const el = mountTarget("dg-board");
    render(<DailyTour />);
    await screen.findByTestId("guided-tour-popover");
    expect(screen.getByTestId("daily-grid-tour")).toHaveAttribute("data-motion", "none");
    expect(el.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
  });

  it("animates normally when reduced motion is not requested", async () => {
    stubReducedMotion(false);
    const el = mountTarget("dg-board");
    render(<DailyTour />);
    await screen.findByTestId("guided-tour-popover");
    expect(screen.getByTestId("daily-grid-tour")).toHaveAttribute("data-motion", "auto");
    expect(el.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }));
  });

  it("marks the Daily Grid surface itself under a reduced-motion preference", () => {
    stubReducedMotion(true);
    const { container } = render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);
    expect(container.querySelector('[data-motion="none"]')).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* The permanent `?` control, on the real surface                       */
/* ------------------------------------------------------------------ */

describe("replay from the ? control", () => {
  it("renders a literal ? glyph and opens the walkthrough", async () => {
    const user = userEvent.setup();
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    const launcher = screen.getByTestId("daily-grid-tour-launcher");
    expect(launcher).toHaveTextContent("?");
    expect(screen.queryByTestId("daily-grid-tour")).toBeNull();

    await user.click(launcher);
    expect(await screen.findByTestId("daily-grid-tour")).toBeInTheDocument();
    expect(screen.getByTestId("guided-tour-progress")).toHaveTextContent("1 of 7");
  });

  it("spotlights the real board once there is one to spotlight", async () => {
    const user = userEvent.setup();
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);
    // The five attributes this pass added; none existed in daily-grid/* before.
    for (const id of ["dg-board", "dg-workbench", "dg-score", "dg-timer", "dg-rule"]) {
      expect(document.querySelector(`[data-tour-id="${id}"]`)).not.toBeNull();
    }
    await user.click(screen.getByTestId("daily-grid-tour-launcher"));
    expect(await screen.findByTestId("daily-grid-tour")).toBeInTheDocument();
  });

  it("does not reset the board", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      dailyGridProgressKey(BOARD.board_id),
      JSON.stringify({
        board_id: BOARD.board_id,
        date: BOARD.date,
        schema_version: DAILY_GRID_PROGRESS_SCHEMA_VERSION,
        filled: [filledCell(0, 0, playerSeason(), 118, "rare")],
        incorrect_attempts: 2,
        started_at: "2026-07-30T11:55:00.000Z",
        completed_at: null,
      }),
    );
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);
    expect(screen.getByTestId("daily-grid-score")).toHaveTextContent("118");

    await user.click(screen.getByTestId("daily-grid-tour-launcher"));
    await screen.findByTestId("daily-grid-tour");
    await user.click(screen.getByTestId("guided-tour-skip"));
    await waitFor(() => expect(screen.queryByTestId("daily-grid-tour")).toBeNull());

    expect(screen.getByTestId("daily-grid-score")).toHaveTextContent("118");
    expect(screen.getByTestId("daily-grid-progress")).toHaveTextContent("1/9");
    expect(screen.getByTestId("daily-grid-misses")).toHaveTextContent("2");
  });

  it("does not pause the timer while it is open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.setSystemTime(new Date("2026-07-30T12:00:00Z"));
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      window.localStorage.setItem(
        dailyGridProgressKey(BOARD.board_id),
        JSON.stringify({
          board_id: BOARD.board_id,
          date: BOARD.date,
          schema_version: DAILY_GRID_PROGRESS_SCHEMA_VERSION,
          filled: [],
          incorrect_attempts: 0,
          // Five minutes on the clock already.
          started_at: "2026-07-30T11:55:00.000Z",
          completed_at: null,
        }),
      );
      render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);
      expect(screen.getByTestId("daily-grid-timer")).toHaveTextContent("5:00");

      await user.click(screen.getByTestId("daily-grid-tour-launcher"));
      await screen.findByTestId("daily-grid-tour");

      // A full minute spent reading the walkthrough is a full minute on the
      // clock: the tour is replayable, not a pause button.
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });
      expect(screen.getByTestId("daily-grid-tour")).toBeInTheDocument();
      expect(screen.getByTestId("daily-grid-timer")).toHaveTextContent("6:00");
    } finally {
      vi.useRealTimers();
    }
  });
});
