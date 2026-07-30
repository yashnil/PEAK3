/**
 * Daily Grid UI. The API module is mocked wholesale so these tests never need
 * a running FastAPI -- which also proves the component treats the server as
 * the only authority: every filled square in here exists solely because the
 * mocked POST /daily-grid/answer said `valid: true` and handed back a
 * cell_score. Nothing is scored or validated in the component.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const mockSearch = vi.fn();
const mockSubmit = vi.fn();
const mockGetBoard = vi.fn();

vi.mock("@/lib/daily-grid-api", () => ({
  getDailyGridBoard: (...a: unknown[]) => mockGetBoard(...a),
  searchPlayerSeasons: (...a: unknown[]) => mockSearch(...a),
  submitDailyGridAnswer: (...a: unknown[]) => mockSubmit(...a),
  DailyGridAPIError: class DailyGridAPIError extends Error {},
}));

import DailyGridGame from "@/components/daily-grid/DailyGridGame";
import { dailyGridProgressKey } from "@/types/daily-grid";
import { BOARD, completedProgress, playerSeason } from "./daily-grid-fixtures";

const HAKEEM = playerSeason();

function hit() {
  return { ...HAKEEM, eligible: null };
}

function validResponse() {
  return {
    valid: true,
    player_season: HAKEEM,
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

async function selectFirstCell(user: ReturnType<typeof userEvent.setup>) {
  const cells = screen.getAllByTestId("grid-cell");
  await user.click(cells[0]);
}

async function searchAndClickHakeem(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId("cell-search-input"), "olajuwon");
  const result = await screen.findByTestId("cell-search-result", {}, { timeout: 2000 });
  await user.click(result);
}

describe("DailyGridGame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockSearch.mockResolvedValue({ query: "olajuwon", results: [hit()] });
  });

  it("renders 3 row headers, 3 column headers and 9 squares from the board", () => {
    render(<DailyGridGame initialBoard={BOARD} />);
    expect(screen.getAllByTestId("grid-cell")).toHaveLength(9);
    expect(screen.getAllByTestId("grid-row-header")).toHaveLength(3);
    expect(screen.getAllByTestId("grid-col-header")).toHaveLength(3);
    // Headers use the compact label, because the gutter is narrow.
    expect(screen.getByText("DPOY")).toBeInTheDocument();
    expect(screen.getByText("85+ PEAK")).toBeInTheDocument();
  });

  it("shows the date, difficulty and the one-player-per-board rule up front", () => {
    render(<DailyGridGame initialBoard={BOARD} />);
    expect(screen.getByTestId("daily-grid-date")).toHaveTextContent("2026-07-30");
    expect(screen.getByTestId("daily-grid-difficulty")).toHaveTextContent(/medium/i);
    expect(screen.getByTestId("daily-grid-unique-rule")).toHaveTextContent(
      /No player may be used twice on this board/i,
    );
  });

  it("does not call the API when a board is supplied", () => {
    render(<DailyGridGame initialBoard={BOARD} />);
    expect(mockGetBoard).not.toHaveBeenCalled();
  });

  it("opens the search panel with BOTH constraint labels and their descriptions", async () => {
    const user = userEvent.setup();
    render(<DailyGridGame initialBoard={BOARD} />);
    expect(screen.queryByTestId("cell-panel")).not.toBeInTheDocument();

    await selectFirstCell(user);

    const panel = screen.getByTestId("cell-panel");
    expect(within(panel).getByTestId("cell-panel-title")).toHaveTextContent("Boston Celtics × 1990s");
    expect(within(panel).getByTestId("cell-panel-row-constraint")).toHaveTextContent("Boston Celtics");
    expect(within(panel).getByTestId("cell-panel-row-constraint")).toHaveTextContent(
      /at least one regular-season game for the Boston Celtics/i,
    );
    expect(within(panel).getByTestId("cell-panel-column-constraint")).toHaveTextContent("1990s");
    expect(within(panel).getByTestId("cell-panel-column-constraint")).toHaveTextContent(
      /season began in a year from 1990 through 1999/i,
    );
    expect(within(panel).getByTestId("cell-search-input")).toBeInTheDocument();
  });

  it("fills the square with the server's player-season and score after a valid answer", async () => {
    const user = userEvent.setup();
    mockSubmit.mockResolvedValue(validResponse());
    render(<DailyGridGame initialBoard={BOARD} />);

    await selectFirstCell(user);
    await searchAndClickHakeem(user);

    const cell = await waitFor(() => {
      const c = screen.getAllByTestId("grid-cell")[0];
      expect(c).toHaveAttribute("data-state", "filled");
      return c;
    });
    expect(within(cell).getByTestId("grid-cell-player")).toHaveTextContent("Hakeem Olajuwon");
    expect(within(cell).getByTestId("grid-cell-season")).toHaveTextContent("1993-94");
    expect(within(cell).getByTestId("grid-cell-team")).toHaveTextContent("HOU");
    expect(within(cell).getByTestId("grid-cell-team")).toHaveTextContent("PEAK 92.4");
    expect(within(cell).getByTestId("grid-cell-points")).toHaveTextContent("118 pts");
    expect(screen.getByTestId("daily-grid-score")).toHaveTextContent("118 pts");
  });

  it("sends the used identities and filled squares so the server can enforce the unique-player rule", async () => {
    const user = userEvent.setup();
    mockSubmit.mockResolvedValue(validResponse());
    render(<DailyGridGame initialBoard={BOARD} />);

    await selectFirstCell(user);
    await searchAndClickHakeem(user);

    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    expect(mockSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        date: "2026-07-30",
        row: 0,
        col: 0,
        answer_id: HAKEEM.id,
        used_player_slugs: [],
        filled_cells: [],
      }),
    );
  });

  it("renders the server's own rejection sentence, verbatim", async () => {
    const user = userEvent.setup();
    mockSubmit.mockResolvedValue({
      valid: false,
      reason: "Hakeem Olajuwon never played for the Boston Celtics.",
      reason_code: "constraint_failed",
      player_season: HAKEEM,
    });
    render(<DailyGridGame initialBoard={BOARD} />);

    await selectFirstCell(user);
    await searchAndClickHakeem(user);

    const alert = await screen.findByTestId("cell-invalid-reason");
    expect(alert).toHaveTextContent("Hakeem Olajuwon never played for the Boston Celtics.");
    // The square stays empty and the panel stays open so the user can retry.
    expect(screen.getAllByTestId("grid-cell")[0]).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("cell-search-input")).toBeInTheDocument();
  });

  it("surfaces the unique-player rejection the server sends, without inventing its own", async () => {
    const user = userEvent.setup();
    mockSubmit.mockResolvedValue({
      valid: false,
      reason: "Hakeem Olajuwon is already on this board. Every square needs a different player.",
      reason_code: "player_already_used",
    });
    render(<DailyGridGame initialBoard={BOARD} />);

    await selectFirstCell(user);
    await searchAndClickHakeem(user);

    expect(await screen.findByTestId("cell-invalid-reason")).toHaveTextContent(
      "Hakeem Olajuwon is already on this board. Every square needs a different player.",
    );
  });

  it("requires an explicit remove action on a filled square -- clicking the cell only reviews it", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      dailyGridProgressKey(BOARD.board_id),
      JSON.stringify(completedProgress()),
    );
    render(<DailyGridGame initialBoard={BOARD} />);

    const cells = await screen.findAllByTestId("grid-cell");
    await user.click(cells[0]);

    // Reviewing shows the card and a remove control -- never a search box that
    // a stray click could overwrite the answer with.
    expect(screen.getByTestId("cell-panel-filled")).toHaveTextContent("1993-94 Hakeem Olajuwon");
    expect(screen.queryByTestId("cell-search-input")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("cell-panel-remove"));
    await waitFor(() => expect(screen.getAllByTestId("grid-cell")[0]).toHaveAttribute("data-state", "active"));
    expect(screen.getByTestId("cell-search-input")).toBeInTheDocument();
  });

  it("restores a saved board on mount and shows the completion panel", async () => {
    window.localStorage.setItem(
      dailyGridProgressKey(BOARD.board_id),
      JSON.stringify(completedProgress()),
    );
    render(<DailyGridGame initialBoard={BOARD} />);

    await waitFor(() => expect(screen.getByTestId("daily-grid-complete")).toBeInTheDocument());
    expect(screen.getByTestId("daily-grid-progress")).toHaveTextContent("9/9 filled");
    expect(screen.getByTestId("complete-total-score")).toHaveTextContent("842");
    expect(screen.getByTestId("complete-best-cell")).toHaveTextContent("1993-94 Hakeem Olajuwon");
    expect(screen.getByTestId("complete-hardest-cell")).toHaveTextContent("DPOY x 85+ PEAK");
  });

  it("does not restore another day's board", async () => {
    window.localStorage.setItem(
      dailyGridProgressKey("grid-2026-07-29"),
      JSON.stringify({ ...completedProgress(), board_id: "grid-2026-07-29", date: "2026-07-29" }),
    );
    render(<DailyGridGame initialBoard={BOARD} />);

    await waitFor(() => expect(screen.getByTestId("daily-grid-progress")).toHaveTextContent("0/9 filled"));
    expect(screen.queryByTestId("daily-grid-complete")).not.toBeInTheDocument();
  });

  it("copies the share text to the clipboard", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    // Defined after userEvent.setup(), which installs its own clipboard stub.
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    window.localStorage.setItem(
      dailyGridProgressKey(BOARD.board_id),
      JSON.stringify(completedProgress()),
    );
    render(<DailyGridGame initialBoard={BOARD} />);

    await user.click(await screen.findByTestId("daily-grid-share"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toBe(
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

  // The server reveals eligibility only once a query narrows to a specific
  // player (nba_peak/daily_grid/search.py). Three renderings, and the UI must
  // never re-sort, filter or disable on the flag.
  describe("search-result eligibility", () => {
    const OTHER = {
      ...HAKEEM,
      id: "hakeem-olajuwon-1988-89",
      season: "1988-89",
      label: "1988-89 Hakeem Olajuwon",
      prime_score: 84.1,
    };

    it("marks an eligible hit as fitting, in words and not by colour alone", async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({ query: "olajuwon", results: [{ ...HAKEEM, eligible: true }] });
      render(<DailyGridGame initialBoard={BOARD} />);

      await selectFirstCell(user);
      await user.type(screen.getByTestId("cell-search-input"), "olajuwon");

      const row = await screen.findByTestId("cell-search-result", {}, { timeout: 2000 });
      expect(row).toHaveAttribute("data-eligible", "true");
      expect(within(row).getByTestId("cell-search-result-fits")).toHaveTextContent(/Fits/i);
      expect(row).toHaveAccessibleName(/Fits this square/i);
      expect(row).toBeEnabled();
    });

    it("de-emphasizes an ineligible hit but keeps it clickable and submits it normally", async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({ query: "olajuwon", results: [{ ...HAKEEM, eligible: false }] });
      mockSubmit.mockResolvedValue({
        valid: false,
        reason: "Hakeem Olajuwon never played for the Boston Celtics.",
        reason_code: "constraint_failed",
      });
      render(<DailyGridGame initialBoard={BOARD} />);

      await selectFirstCell(user);
      await user.type(screen.getByTestId("cell-search-input"), "olajuwon");

      const row = await screen.findByTestId("cell-search-result", {}, { timeout: 2000 });
      expect(row).toHaveAttribute("data-eligible", "false");
      expect(within(row).getByTestId("cell-search-result-unfits")).toHaveTextContent(/No fit/i);
      expect(row).toHaveAccessibleName(/Does not fit this square/i);
      // Not filtered away, not disabled -- the server's reason is still the lesson.
      expect(row).toBeEnabled();

      await user.click(row);
      await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
      expect(await screen.findByTestId("cell-invalid-reason")).toHaveTextContent(
        "Hakeem Olajuwon never played for the Boston Celtics.",
      );
    });

    it("shows no eligibility affordance when the server withheld a verdict", async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({ query: "an", results: [{ ...HAKEEM, eligible: null }] });
      render(<DailyGridGame initialBoard={BOARD} />);

      await selectFirstCell(user);
      await user.type(screen.getByTestId("cell-search-input"), "an");

      const row = await screen.findByTestId("cell-search-result", {}, { timeout: 2000 });
      expect(row).toHaveAttribute("data-eligible", "unknown");
      expect(within(row).queryByTestId("cell-search-result-fits")).not.toBeInTheDocument();
      expect(within(row).queryByTestId("cell-search-result-unfits")).not.toBeInTheDocument();
      expect(row).toHaveAccessibleName(/1993-94 Hakeem Olajuwon/);
      expect(row.getAttribute("aria-label")).not.toMatch(/fit/i);
    });

    it("explains how to get verdicts when every hit came back unflagged", async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({
        query: "an",
        results: [{ ...HAKEEM, eligible: null }, { ...OTHER, eligible: null }],
      });
      render(<DailyGridGame initialBoard={BOARD} />);

      await selectFirstCell(user);
      await user.type(screen.getByTestId("cell-search-input"), "an");

      expect(await screen.findByTestId("cell-search-broad-hint", {}, { timeout: 2000 })).toHaveTextContent(
        /Naming a specific player will show which of their seasons fit/i,
      );
    });

    it("hides the broad-search hint as soon as any hit carries a verdict", async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({
        query: "olajuwon",
        results: [{ ...HAKEEM, eligible: true }, { ...OTHER, eligible: null }],
      });
      render(<DailyGridGame initialBoard={BOARD} />);

      await selectFirstCell(user);
      await user.type(screen.getByTestId("cell-search-input"), "olajuwon");

      await screen.findByTestId("cell-search-result-fits", {}, { timeout: 2000 });
      expect(screen.queryByTestId("cell-search-broad-hint")).not.toBeInTheDocument();
    });

    it("preserves the server's order -- eligible hits are never floated to the top", async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({
        query: "olajuwon",
        results: [{ ...OTHER, eligible: false }, { ...HAKEEM, eligible: true }],
      });
      render(<DailyGridGame initialBoard={BOARD} />);

      await selectFirstCell(user);
      await user.type(screen.getByTestId("cell-search-input"), "olajuwon");

      await waitFor(() => expect(screen.getAllByTestId("cell-search-result")).toHaveLength(2));
      const rows = screen.getAllByTestId("cell-search-result");
      expect(rows[0]).toHaveAttribute("data-answer-id", OTHER.id);
      expect(rows[0]).toHaveAttribute("data-eligible", "false");
      expect(rows[1]).toHaveAttribute("data-answer-id", HAKEEM.id);
      expect(rows[1]).toHaveAttribute("data-eligible", "true");
    });
  });

  it("only resets behind a confirmation, and the reset clears storage", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      dailyGridProgressKey(BOARD.board_id),
      JSON.stringify(completedProgress()),
    );
    render(<DailyGridGame initialBoard={BOARD} />);

    await waitFor(() => expect(screen.getByTestId("daily-grid-progress")).toHaveTextContent("9/9 filled"));

    await user.click(screen.getByTestId("daily-grid-reset"));
    expect(screen.getByTestId("daily-grid-reset-confirm")).toBeInTheDocument();

    // Backing out changes nothing.
    await user.click(screen.getByTestId("daily-grid-reset-cancel"));
    expect(screen.getByTestId("daily-grid-progress")).toHaveTextContent("9/9 filled");

    await user.click(screen.getByTestId("daily-grid-reset"));
    await user.click(screen.getByTestId("daily-grid-reset-confirm"));

    await waitFor(() => expect(screen.getByTestId("daily-grid-progress")).toHaveTextContent("0/9 filled"));
    expect(screen.queryByTestId("daily-grid-complete")).not.toBeInTheDocument();
    const stored = JSON.parse(window.localStorage.getItem(dailyGridProgressKey(BOARD.board_id))!);
    expect(stored.filled).toHaveLength(0);
  });

  it("gives every square an accessible name carrying both constraints", () => {
    render(<DailyGridGame initialBoard={BOARD} />);
    const cells = screen.getAllByTestId("grid-cell");
    expect(cells[0]).toHaveAccessibleName(/Boston Celtics x 1990s/i);
    expect(cells[8]).toHaveAccessibleName(/NBA Champion x 85\+ PEAK Season/i);
    expect(cells[0].tagName).toBe("BUTTON");
  });

  it("degrades to an error state with a retry when the API is unreachable", async () => {
    mockGetBoard.mockRejectedValue(new Error("fetch failed"));
    render(<DailyGridGame />);

    expect(screen.getByTestId("daily-grid-loading")).toBeInTheDocument();
    expect(await screen.findByTestId("daily-grid-error")).toHaveTextContent("fetch failed");
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("loads today's board from the API when none is supplied", async () => {
    mockGetBoard.mockResolvedValue(BOARD);
    render(<DailyGridGame />);
    await waitFor(() => expect(screen.getAllByTestId("grid-cell")).toHaveLength(9));
    expect(mockGetBoard).toHaveBeenCalledWith(undefined);
  });
});
