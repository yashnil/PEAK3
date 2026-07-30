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
const mockGetResult = vi.fn();

vi.mock("@/lib/daily-grid-api", () => ({
  getDailyGridBoard: (...a: unknown[]) => mockGetBoard(...a),
  searchPlayerSeasons: (...a: unknown[]) => mockSearch(...a),
  submitDailyGridAnswer: (...a: unknown[]) => mockSubmit(...a),
  getDailyGridResult: (...a: unknown[]) => mockGetResult(...a),
  DailyGridAPIError: class DailyGridAPIError extends Error {},
}));

import DailyGridGame from "@/components/daily-grid/DailyGridGame";
import { dailyGridProgressKey } from "@/types/daily-grid";
import { BOARD, completedProgress, gridResult, playerSeason } from "./daily-grid-fixtures";

const HAKEEM = playerSeason();
// Phase 11B: the wire shapes for a search hit and a submit response carry NO
// score -- `prime_score` is stripped here so these fixtures match what the API
// can actually return. A fixture that kept the field would let a component
// render a pre-lock score while the "no leak" tests still passed.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured purely to drop the field
const { prime_score: _unusedPrimeScore, ...HAKEEM_IDENTITY } = HAKEEM;

function hit() {
  return { ...HAKEEM_IDENTITY, eligible: null };
}

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
    mockGetResult.mockResolvedValue(gridResult());
  });

  it("renders 3 row headers, 3 column headers and 9 squares from the board", () => {
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);
    expect(screen.getAllByTestId("grid-cell")).toHaveLength(9);
    expect(screen.getAllByTestId("grid-row-header")).toHaveLength(3);
    expect(screen.getAllByTestId("grid-col-header")).toHaveLength(3);
    // Headers use the compact label, because the gutter is narrow.
    expect(screen.getByText("DPOY")).toBeInTheDocument();
    expect(screen.getByText("85+ PEAK")).toBeInTheDocument();
  });

  it("shows the date, difficulty and the one-player-per-board rule up front", () => {
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);
    expect(screen.getByTestId("daily-grid-date")).toHaveTextContent("2026-07-30");
    expect(screen.getByTestId("daily-grid-difficulty")).toHaveTextContent(/medium/i);
    expect(screen.getByTestId("daily-grid-unique-rule")).toHaveTextContent(
      /nine different players/i,
    );
    // Phase 11B: the rule banner now also states that picks are final.
    expect(screen.getByTestId("daily-grid-unique-rule")).toHaveTextContent(/picks are final/i);
  });

  it("does not call the API when a board is supplied", () => {
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);
    expect(mockGetBoard).not.toHaveBeenCalled();
  });

  it("opens the search panel with BOTH constraint labels and their descriptions", async () => {
    const user = userEvent.setup();
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);
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
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

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
    // Phase 11B: the score shown on a locked square comes from
    // cell_score.quality_points (92), not from the card -- the card carries none.
    expect(within(cell).getByTestId("grid-cell-team")).toHaveTextContent("PEAK 92");
    expect(within(cell).getByTestId("grid-cell-points")).toHaveTextContent("118 pts");
    // Phase 11B: the running score is a stat tile in the status bar -- the
    // value and its "Score" label are separate elements now.
    expect(screen.getByTestId("daily-grid-score")).toHaveTextContent("118");
  });

  it("sends the used identities and filled squares so the server can enforce the unique-player rule", async () => {
    const user = userEvent.setup();
    mockSubmit.mockResolvedValue(validResponse());
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

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
      player_season: HAKEEM_IDENTITY,
    });
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

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
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    await selectFirstCell(user);
    await searchAndClickHakeem(user);

    expect(await screen.findByTestId("cell-invalid-reason")).toHaveTextContent(
      "Hakeem Olajuwon is already on this board. Every square needs a different player.",
    );
  });

  it("locks a filled square -- clicking it reviews the pick, with no way to change it", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      dailyGridProgressKey(BOARD.board_id),
      JSON.stringify(completedProgress()),
    );
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    const cells = await screen.findAllByTestId("grid-cell");
    await user.click(cells[0]);

    // Phase 11B: a valid pick is FINAL. Reviewing shows the card and a Locked
    // badge -- never a remove control, and never a search box a stray click
    // could overwrite the answer with.
    expect(screen.getByTestId("cell-panel-filled")).toHaveTextContent("1993-94 Hakeem Olajuwon");
    expect(screen.getByTestId("cell-panel-locked")).toBeInTheDocument();
    expect(screen.queryByTestId("cell-panel-remove")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cell-search-input")).not.toBeInTheDocument();
    expect(cells[0]).toHaveAttribute("data-state", "filled");
  });

  it("restores a saved board on mount and shows the completion panel", async () => {
    window.localStorage.setItem(
      dailyGridProgressKey(BOARD.board_id),
      JSON.stringify(completedProgress()),
    );
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    await waitFor(() => expect(screen.getByTestId("daily-grid-complete")).toBeInTheDocument());
    expect(screen.getByTestId("daily-grid-progress")).toHaveTextContent("9/9");
    expect(screen.getByTestId("complete-total-score")).toHaveTextContent("842");
    expect(screen.getByTestId("complete-best-cell")).toHaveTextContent("1993-94 Hakeem Olajuwon");
    expect(screen.getByTestId("complete-hardest-cell")).toHaveTextContent("DPOY x 85+ PEAK");
  });

  it("does not restore another day's board", async () => {
    window.localStorage.setItem(
      dailyGridProgressKey("grid-2026-07-29"),
      JSON.stringify({ ...completedProgress(), board_id: "grid-2026-07-29", date: "2026-07-29" }),
    );
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    await waitFor(() => expect(screen.getByTestId("daily-grid-progress")).toHaveTextContent("0/9"));
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
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    await user.click(await screen.findByTestId("daily-grid-share"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const expectedResult = gridResult();
    expect(writeText.mock.calls[0][0]).toBe(
      [
        "PEAK3 Daily Grid — 2026-07-30",
        "Solved 9/9",
        "Score: 842",
        // Phase 11B: the competitive line -- a bare score means nothing
        // without the ceiling it is measured against.
        `${expectedResult.percent_of_best}% of today's max (${expectedResult.optimal_total})`,
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
      ...HAKEEM_IDENTITY,
      id: "hakeem-olajuwon-1988-89",
      season: "1988-89",
      label: "1988-89 Hakeem Olajuwon",
    };

    it("marks an eligible hit as fitting, in words and not by colour alone", async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({ query: "olajuwon", results: [{ ...HAKEEM_IDENTITY, eligible: true }] });
      render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

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
      mockSearch.mockResolvedValue({ query: "olajuwon", results: [{ ...HAKEEM_IDENTITY, eligible: false }] });
      mockSubmit.mockResolvedValue({
        valid: false,
        reason: "Hakeem Olajuwon never played for the Boston Celtics.",
        reason_code: "constraint_failed",
      });
      render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

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
      mockSearch.mockResolvedValue({ query: "an", results: [{ ...HAKEEM_IDENTITY, eligible: null }] });
      render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

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
        results: [{ ...HAKEEM_IDENTITY, eligible: null }, { ...OTHER, eligible: null }],
      });
      render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

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
        results: [{ ...HAKEEM_IDENTITY, eligible: true }, { ...OTHER, eligible: null }],
      });
      render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

      await selectFirstCell(user);
      await user.type(screen.getByTestId("cell-search-input"), "olajuwon");

      await screen.findByTestId("cell-search-result-fits", {}, { timeout: 2000 });
      expect(screen.queryByTestId("cell-search-broad-hint")).not.toBeInTheDocument();
    });

    it("preserves the server's order -- eligible hits are never floated to the top", async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({
        query: "olajuwon",
        results: [{ ...OTHER, eligible: false }, { ...HAKEEM_IDENTITY, eligible: true }],
      });
      render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

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

  it("offers no reset control anywhere on the competitive daily board", async () => {
    window.localStorage.setItem(
      dailyGridProgressKey(BOARD.board_id),
      JSON.stringify(completedProgress()),
    );
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    await waitFor(() => expect(screen.getByTestId("daily-grid-progress")).toHaveTextContent("9/9"));

    // Phase 11B: a "start over" button would make both the day's score and the
    // comparison against today's maximum meaningless.
    expect(screen.queryByTestId("daily-grid-reset")).not.toBeInTheDocument();
    expect(screen.queryByTestId("daily-grid-reset-confirm")).not.toBeInTheDocument();
    expect(screen.queryByTestId("daily-grid-reset-cancel")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reset/i })).not.toBeInTheDocument();
  });

  it("gives every square an accessible name carrying both constraints", () => {
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);
    const cells = screen.getAllByTestId("grid-cell");
    expect(cells[0]).toHaveAccessibleName(/Boston Celtics x 1990s/i);
    expect(cells[8]).toHaveAccessibleName(/NBA Champion x 85\+ PEAK Season/i);
    expect(cells[0].tagName).toBe("BUTTON");
  });

  it("degrades to an error state with a retry when the API is unreachable", async () => {
    mockGetBoard.mockRejectedValue(new Error("fetch failed"));
    render(<DailyGridGame skipRulesGate />);

    expect(screen.getByTestId("daily-grid-loading")).toBeInTheDocument();
    expect(await screen.findByTestId("daily-grid-error")).toHaveTextContent("fetch failed");
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("loads today's board from the API when none is supplied", async () => {
    mockGetBoard.mockResolvedValue(BOARD);
    render(<DailyGridGame skipRulesGate />);
    await waitFor(() => expect(screen.getAllByTestId("grid-cell")).toHaveLength(9));
    expect(mockGetBoard).toHaveBeenCalledWith(undefined);
  });
});

/**
 * Phase 11B: the mode became a competitive optimisation puzzle. These cover the
 * three things that change made load-bearing -- the objective is stated before
 * play, no score is visible before a pick is locked, and a finished board is
 * measured against today's maximum.
 */
describe("DailyGridGame — Phase 11B competitive framing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockSearch.mockResolvedValue({ query: "olajuwon", results: [hit()] });
    mockGetResult.mockResolvedValue(gridResult());
  });

  describe("onboarding", () => {
    it("gates a first visit behind the rules, and states the objective", async () => {
      render(<DailyGridGame initialBoard={BOARD} />);

      const gate = await screen.findByTestId("how-to-play-gate");
      expect(within(gate).getByTestId("how-to-play-objective")).toHaveTextContent(
        /highest total PEAK3 score/i,
      );
      expect(within(gate).getAllByTestId("how-to-play-step")).toHaveLength(4);
      // The board is not reachable until the player starts.
      expect(screen.queryByTestId("daily-grid-board")).not.toBeInTheDocument();
    });

    it("starts the grid and remembers that the rules were seen", async () => {
      const user = userEvent.setup();
      const { unmount } = render(<DailyGridGame initialBoard={BOARD} />);

      await user.click(await screen.findByTestId("start-daily-grid"));
      expect(await screen.findByTestId("daily-grid-board")).toBeInTheDocument();

      // A returning player is not re-taught the game every morning.
      unmount();
      render(<DailyGridGame initialBoard={BOARD} />);
      expect(await screen.findByTestId("daily-grid-board")).toBeInTheDocument();
      expect(screen.queryByTestId("how-to-play-gate")).not.toBeInTheDocument();
    });

    it("can reopen the rules from the board", async () => {
      const user = userEvent.setup();
      render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

      await user.click(screen.getByTestId("daily-grid-how-to-play"));
      expect(await screen.findByTestId("how-to-play-panel")).toBeInTheDocument();

      await user.click(screen.getByTestId("how-to-play-close"));
      await waitFor(() => expect(screen.queryByTestId("how-to-play-panel")).not.toBeInTheDocument());
    });

    it("puts the objective at the top of the board itself", () => {
      render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);
      expect(screen.getByTestId("daily-grid-objective")).toHaveTextContent(/Maximize your PEAK3 total/i);
    });
  });

  describe("no score before a pick is locked", () => {
    it("shows a candidate's identity but never a score", async () => {
      const user = userEvent.setup();
      render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

      await user.click(screen.getAllByTestId("grid-cell")[0]);
      await user.type(screen.getByTestId("cell-search-input"), "olajuwon");

      const row = await screen.findByTestId("cell-search-result", {}, { timeout: 2000 });
      expect(row).toHaveTextContent("1993-94 Hakeem Olajuwon");
      expect(row).toHaveTextContent("Houston Rockets");
      // The whole point of the mode: you cannot sort by eye and click the
      // biggest number. 92.4 / 92 are this fixture's PEAK values.
      expect(row.textContent).not.toMatch(/92/);
      expect(row.textContent).not.toMatch(/\bpts\b/i);
    });

    it("reveals the score only after the pick is locked", async () => {
      const user = userEvent.setup();
      mockSubmit.mockResolvedValue(validResponse());
      render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

      await user.click(screen.getAllByTestId("grid-cell")[0]);
      await user.type(screen.getByTestId("cell-search-input"), "olajuwon");
      await user.click(await screen.findByTestId("cell-search-result", {}, { timeout: 2000 }));

      await waitFor(() =>
        expect(screen.getAllByTestId("grid-cell")[0]).toHaveAttribute("data-state", "filled"),
      );
      const cell = screen.getAllByTestId("grid-cell")[0];
      // 92 = quality_points, 118 = arena_points, both from the submit response.
      expect(within(cell).getByTestId("grid-cell-team")).toHaveTextContent("92");
      expect(within(cell).getByTestId("grid-cell-points")).toHaveTextContent("118");
      expect(within(cell).getByTestId("grid-cell-locked")).toBeInTheDocument();
    });

    it("labels an empty square as a choice, not a bare plus", () => {
      render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);
      const cell = screen.getAllByTestId("grid-cell")[0];
      expect(cell).toHaveTextContent(/Pick/i);
      expect(within(cell).getByTestId("grid-cell-rarity")).toHaveTextContent(/pool/i);
    });
  });

  describe("result against today's maximum", () => {
    it("fetches and renders the comparison once the board is complete", async () => {
      window.localStorage.setItem(
        dailyGridProgressKey(BOARD.board_id),
        JSON.stringify(completedProgress()),
      );
      render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

      const result = gridResult();
      expect(await screen.findByTestId("complete-comparison")).toBeInTheDocument();
      expect(screen.getByTestId("complete-optimal-total")).toHaveTextContent(String(result.optimal_total));
      expect(screen.getByTestId("complete-percent-of-best")).toHaveTextContent(
        `${result.percent_of_best}%`,
      );
      expect(screen.getByTestId("complete-biggest-miss")).toHaveTextContent(/Nikola Jokic/);
      expect(screen.getByTestId("daily-grid-percent")).toHaveTextContent(`${result.percent_of_best}%`);
    });

    it("never asks for the maximum while the board is unfinished", async () => {
      render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);
      await waitFor(() => expect(screen.getByTestId("daily-grid-board")).toBeInTheDocument());
      // The answer key is behind this call; an incomplete board must not make it.
      expect(mockGetResult).not.toHaveBeenCalled();
      expect(screen.queryByTestId("complete-comparison")).not.toBeInTheDocument();
    });

    it("keeps the player's own score when the comparison cannot be loaded", async () => {
      mockGetResult.mockRejectedValue(new Error("Board incomplete"));
      window.localStorage.setItem(
        dailyGridProgressKey(BOARD.board_id),
        JSON.stringify(completedProgress()),
      );
      render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

      expect(await screen.findByTestId("complete-result-error")).toBeInTheDocument();
      expect(screen.getByTestId("complete-total-score")).toHaveTextContent("842");
    });
  });
});
