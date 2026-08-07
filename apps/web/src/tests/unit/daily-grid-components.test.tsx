/**
 * Daily Grid UI. The API module is mocked wholesale so these tests never need
 * a running FastAPI -- which also proves the component treats the server as
 * the only authority: every filled square in here exists solely because the
 * mocked POST /daily-grid/answer said `valid: true` and handed back a
 * cell_score. Nothing is scored or validated in the component.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const mockSearch = vi.fn();
const mockSubmit = vi.fn();
const mockGetBoard = vi.fn();
const mockGetResult = vi.fn();
/** The timed-attempt start. Defaults to the ordinary "brand new attempt"
 *  answer — `elapsed_seconds: 0` — so the component's server re-anchor lands on
 *  the same instant its local fallback already chose. Given as the `vi.fn`
 *  implementation rather than set in a `beforeEach` so no amount of
 *  `clearAllMocks` / `restoreAllMocks` can leave it returning `undefined`. */
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
import {
  DAILY_GRID_TOUR_ID,
  DAILY_GRID_TOUR_VERSION,
} from "@/components/ui/tour-steps";
import { readTourSeen } from "@/lib/tour-state";
import { DailyGridArchiveEntry, dailyGridProgressKey } from "@/types/daily-grid";
import {
  emptyArchive,
  loadArchive,
  recordCompletedBoard,
  saveArchive,
} from "@/lib/daily-grid-archive";
import { BOARD, completedProgress, gridResult, playerSeason, searchHit } from "./daily-grid-fixtures";

const HAKEEM = playerSeason();
// Phase 11B: the wire shapes for a search hit and a submit response carry NO
// score -- `prime_score` is stripped here so these fixtures match what the API
// can actually return. A fixture that kept the field would let a component
// render a pre-lock score while the "no leak" tests still passed.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured purely to drop the field
const { prime_score: _unusedPrimeScore, ...HAKEEM_IDENTITY } = HAKEEM;

function hit() {
  return searchHit();
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
    expect(screen.getByText("36+ MPG")).toBeInTheDocument();
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
  });

  // Phase 11C: the completion state has to read like a game result, not a
  // paragraph. These pin the elements a player is meant to scan.
  describe("result screen", () => {
    async function renderCompleted() {
      window.localStorage.setItem(
        dailyGridProgressKey(BOARD.board_id),
        JSON.stringify(completedProgress()),
      );
      render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);
      await screen.findByTestId("daily-grid-complete");
      return gridResult();
    }

    it("leads with a headline earned from percent of today's maximum", async () => {
      const result = await renderCompleted();
      const headline = await screen.findByTestId("complete-headline");
      // The fixture leaves 41 points on one square, so it is not perfect.
      expect(result.percent_of_best).toBeLessThan(100);
      await waitFor(() => expect(headline.textContent).toMatch(/Near Perfect|Strong Run|Room to Improve/));
      expect(headline.textContent).not.toMatch(/Perfect Grid/);
    });

    it("shows the score trio: your score, today's max, and the percentage", async () => {
      const result = await renderCompleted();
      await waitFor(() =>
        expect(screen.getByTestId("complete-optimal-total")).toHaveTextContent(
          String(result.optimal_total),
        ),
      );
      expect(screen.getByTestId("complete-total-score")).toHaveTextContent(String(result.user_total));
      expect(screen.getByTestId("complete-percent-of-best")).toHaveTextContent(
        `${result.percent_of_best}%`,
      );
    });

    it("shows the final time and the miss count", async () => {
      await renderCompleted();
      // completedProgress() runs 11:52:56 -> 12:00:00.
      expect(screen.getByTestId("complete-time")).toHaveTextContent("7:04");
      expect(screen.getByTestId("complete-attempts")).toHaveTextContent("3 misses");
    });

    it("renders a nine-square mini recap, marking best-available and the biggest miss", async () => {
      await renderCompleted();
      await waitFor(() => expect(screen.getAllByTestId("complete-mini-cell")).toHaveLength(9));
      const cells = screen.getAllByTestId("complete-mini-cell");
      expect(cells.filter((c) => c.getAttribute("data-grade") === "best")).toHaveLength(8);
      expect(cells.filter((c) => c.getAttribute("data-biggest-miss") === "true")).toHaveLength(1);
    });

    it("names the biggest miss with both answers and the points left", async () => {
      const result = await renderCompleted();
      const card = await screen.findByTestId("complete-biggest-miss");
      expect(card).toHaveTextContent(result.biggest_miss!.user_player_season.label);
      expect(card).toHaveTextContent("Nikola Jokic");
      expect(card).toHaveTextContent(String(result.biggest_miss!.points_left));
    });

    // DG-01. The comparison used to be printed twice on one screen: a nine-line
    // text list ("square — you used X (n) → Y (m)"), with a "show all nine"
    // toggle because nine lines of that is a cross-reference exercise, AND the
    // identical nine facts as a board underneath it. The list is deleted; the
    // board carries the comparison alone.
    it("explains the best legal grid once, on the board, with no parallel text list", async () => {
      await renderCompleted();
      await screen.findByTestId("complete-comparison");
      expect(screen.queryByTestId("complete-per-cell-row")).toBeNull();
      expect(screen.queryByTestId("complete-per-cell-toggle")).toBeNull();
      expect(screen.queryByTestId("complete-beat-note")).toBeNull();
      expect(screen.queryByTestId("complete-overlap-note")).toBeNull();
      // ...and what remains is the 3x3 itself, with all nine squares always on
      // screen rather than behind an expander.
      expect(screen.getAllByTestId("complete-optimal-cell")).toHaveLength(9);
    });

    it("keeps a concise overall explanation over the board", async () => {
      await renderCompleted();
      // The fixture changes exactly one of the nine squares.
      const summary = await screen.findByTestId("complete-comparison-summary");
      expect(summary).toHaveTextContent(/agrees with you on 8 of 9 squares/i);
      expect(screen.getByTestId("complete-comparison")).toHaveTextContent(/best legal grid/i);
    });

    it("says so plainly when nothing would have changed", async () => {
      const result = gridResult();
      result.cells = result.cells.map((c) => ({
        ...c,
        optimal_player_season: c.user_player_season,
        optimal_points: c.user_points,
        points_left: 0,
        matched_optimal: true,
      }));
      mockGetResult.mockResolvedValue(result);
      window.localStorage.setItem(
        dailyGridProgressKey(BOARD.board_id),
        JSON.stringify(completedProgress()),
      );
      render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);
      await screen.findByTestId("daily-grid-complete");
      const summary = await screen.findByTestId("complete-comparison-summary");
      expect(summary).toHaveTextContent(/matched the best legal grid on every square/i);
    });

    it("claims no rank, percentile or comparison to other players", async () => {
      await renderCompleted();
      const panel = await screen.findByTestId("daily-grid-complete");
      expect(panel.textContent).not.toMatch(/percentile|rank(ed|ing)?\b|leaderboard|beat \d+% of/i);
    });
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
        "Two-Way Night",
        // The competitive line -- a bare score means nothing without the
        // ceiling it is measured against.
        `${expectedResult.user_total}/${expectedResult.optimal_total} — ${expectedResult.percent_of_best}% of today's max`,
        "Near Perfect",
        "Time: 7:04",
        "Misses: 3",
        "",
        // The 3x3 recap. Eight best-available squares, one miss in the corner.
        "# # #",
        "# # #",
        "# # .",
        "",
        "* beat  # best  + close  - fair  . weak",
        "peak3.app/daily",
      ].join("\n"),
    );
  });

  // Phase 11C: every result says what can be done with it, and the ones that
  // cannot be played are genuinely disabled. The UI never re-sorts or filters
  // -- the server's order and verdicts are authoritative.
  describe("search-result status", () => {
    const OTHER = {
      id: "hakeem-olajuwon-1988-89",
      season: "1988-89",
      label: "1988-89 Hakeem Olajuwon",
    };

    it("marks an available hit in words, not by colour alone, and enables it", async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({ query: "olajuwon", results: [searchHit({ status: "available" })] });
      render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

      await selectFirstCell(user);
      await user.type(screen.getByTestId("cell-search-input"), "olajuwon");

      const row = await screen.findByTestId("cell-search-result", {}, { timeout: 2000 });
      expect(row).toHaveAttribute("data-status", "available");
      expect(within(row).getByTestId("cell-search-result-available")).toHaveTextContent(/Available/i);
      expect(row).toHaveAccessibleName(/Qualifies for this square/i);
      expect(row).toBeEnabled();
    });

    it("labels a no-fit hit and disables it, so it never has to be clicked to find out", async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({ query: "olajuwon", results: [searchHit({ status: "no_fit" })] });
      render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

      await selectFirstCell(user);
      await user.type(screen.getByTestId("cell-search-input"), "olajuwon");

      const row = await screen.findByTestId("cell-search-result", {}, { timeout: 2000 });
      expect(row).toHaveAttribute("data-status", "no_fit");
      expect(within(row).getByTestId("cell-search-result-no-fit")).toHaveTextContent(/No fit/i);
      expect(row).toHaveAccessibleName(/Does not fit this square/i);
      expect(row).toBeDisabled();

      await user.click(row);
      expect(mockSubmit).not.toHaveBeenCalled();
    });

    it("labels an already-used player USED — never as if it were playable — and disables it", async () => {
      const user = userEvent.setup();
      // The reported LeBron case: an identity already on the board, whose
      // season DOES satisfy the square. It must still not be offered.
      mockSearch.mockResolvedValue({
        query: "olajuwon",
        results: [searchHit({ status: "used", eligible: true })],
      });
      render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

      await selectFirstCell(user);
      await user.type(screen.getByTestId("cell-search-input"), "olajuwon");

      const row = await screen.findByTestId("cell-search-result", {}, { timeout: 2000 });
      expect(row).toHaveAttribute("data-status", "used");
      expect(within(row).getByTestId("cell-search-result-used")).toHaveTextContent(/Used/i);
      expect(within(row).queryByTestId("cell-search-result-available")).not.toBeInTheDocument();
      expect(row).toHaveAccessibleName(/Already used on this board/i);
      expect(row).toBeDisabled();

      await user.click(row);
      expect(mockSubmit).not.toHaveBeenCalled();
    });

    it("sends the board's used identities so the server can mark them", async () => {
      const user = userEvent.setup();
      window.localStorage.setItem(
        dailyGridProgressKey(BOARD.board_id),
        JSON.stringify({ ...completedProgress(), filled: completedProgress().filled.slice(0, 2) }),
      );
      render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

      await waitFor(() => expect(screen.getByTestId("daily-grid-progress")).toHaveTextContent("2/9"));
      await user.click(screen.getAllByTestId("grid-cell")[8]);
      await user.type(screen.getByTestId("cell-search-input"), "olajuwon");

      await waitFor(() => expect(mockSearch).toHaveBeenCalled());
      const call = mockSearch.mock.calls[mockSearch.mock.calls.length - 1][0];
      expect(call.used).toEqual(["hakeem-olajuwon", "david-robinson"]);
    });

    it("shows no verdict affordance when the server withheld one, and stays playable", async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({ query: "an", results: [searchHit({ status: "unknown" })] });
      render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

      await selectFirstCell(user);
      await user.type(screen.getByTestId("cell-search-input"), "an");

      const row = await screen.findByTestId("cell-search-result", {}, { timeout: 2000 });
      expect(row).toHaveAttribute("data-status", "unknown");
      expect(within(row).queryByTestId("cell-search-result-available")).not.toBeInTheDocument();
      expect(within(row).queryByTestId("cell-search-result-no-fit")).not.toBeInTheDocument();
      expect(row).toHaveAccessibleName(/1993-94 Hakeem Olajuwon/);
      expect(row).toBeEnabled();
    });

    it("explains how to get verdicts when every hit came back unflagged", async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({
        query: "an",
        results: [searchHit({ status: "unknown" }), searchHit({ ...OTHER, status: "unknown" })],
      });
      render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

      await selectFirstCell(user);
      await user.type(screen.getByTestId("cell-search-input"), "an");

      expect(await screen.findByTestId("cell-search-broad-hint", {}, { timeout: 2000 })).toHaveTextContent(
        /Too many players match to show which ones qualify/i,
      );
    });

    it("hides the broad-search hint as soon as any hit carries a verdict", async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({
        query: "olajuwon",
        results: [searchHit({ status: "available" }), searchHit({ ...OTHER, status: "no_fit" })],
      });
      render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

      await selectFirstCell(user);
      await user.type(screen.getByTestId("cell-search-input"), "olajuwon");

      await screen.findByTestId("cell-search-result-available", {}, { timeout: 2000 });
      expect(screen.queryByTestId("cell-search-broad-hint")).not.toBeInTheDocument();
    });

    it("preserves the server's order rather than re-sorting on status", async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({
        query: "olajuwon",
        results: [searchHit({ ...OTHER, status: "no_fit" }), searchHit({ status: "available" })],
      });
      render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

      await selectFirstCell(user);
      await user.type(screen.getByTestId("cell-search-input"), "olajuwon");

      await waitFor(() => expect(screen.getAllByTestId("cell-search-result")).toHaveLength(2));
      const rows = screen.getAllByTestId("cell-search-result");
      expect(rows[0]).toHaveAttribute("data-answer-id", OTHER.id);
      expect(rows[0]).toHaveAttribute("data-status", "no_fit");
      expect(rows[1]).toHaveAttribute("data-answer-id", HAKEEM.id);
      expect(rows[1]).toHaveAttribute("data-status", "available");
    });

    it("never renders a score on a search result", async () => {
      const user = userEvent.setup();
      mockSearch.mockResolvedValue({
        query: "olajuwon",
        results: [searchHit({ status: "available" })],
      });
      render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

      await selectFirstCell(user);
      await user.type(screen.getByTestId("cell-search-input"), "olajuwon");

      const row = await screen.findByTestId("cell-search-result", {}, { timeout: 2000 });
      expect(row.textContent).not.toMatch(/92|PEAK|pts/);
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
    expect(cells[8]).toHaveAccessibleName(/NBA Champion x 36\+ Minutes Per Game/i);
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
    it("gates a first visit behind the three-action start gate, verbatim", async () => {
      render(<DailyGridGame initialBoard={BOARD} />);

      const gate = await screen.findByTestId("daily-grid-start-gate");
      // The four briefed lines, exactly. Curly apostrophes are what the page
      // renders, so the heading is matched with the same one it ships.
      expect(within(gate).getByRole("heading", { level: 1 })).toHaveTextContent(
        "Today’s Daily Grid",
      );
      expect(within(gate).getByTestId("daily-grid-gate-shape")).toHaveTextContent(
        "9 squares · 9 different exact player-seasons",
      );
      expect(within(gate).getByTestId("daily-grid-gate-objective")).toHaveTextContent(
        "Build the highest-scoring valid grid you can.",
      );
      expect(within(gate).getByTestId("daily-grid-gate-timer-note")).toHaveTextContent(
        "The timer starts only when you press Start.",
      );

      // The three briefed actions, and nothing else that commits the player.
      expect(within(gate).getByTestId("daily-grid-gate-how-to-play")).toHaveTextContent(
        "How to Play",
      );
      expect(within(gate).getByTestId("start-daily-grid")).toHaveTextContent("Start Timed Grid");
      expect(within(gate).getByTestId("daily-grid-gate-skip-tour")).toHaveTextContent(
        "Skip Tour and Start",
      );

      // The board is not reachable until the player starts, so there is no
      // square to select and therefore no search surface at all: `CellPanel` is
      // the only place a candidate can be inspected and it mounts solely for a
      // selected square.
      expect(screen.queryByTestId("daily-grid-board")).not.toBeInTheDocument();
      expect(screen.queryByTestId("grid-cell")).not.toBeInTheDocument();
      expect(screen.queryByTestId("cell-search-input")).not.toBeInTheDocument();
    });

    it("starts the grid and remembers that onboarding was seen", async () => {
      const user = userEvent.setup();
      const { unmount } = render(<DailyGridGame initialBoard={BOARD} />);

      await user.click(await screen.findByTestId("start-daily-grid"));
      expect(await screen.findByTestId("daily-grid-board")).toBeInTheDocument();

      // A returning player is not re-taught the game every morning.
      unmount();
      render(<DailyGridGame initialBoard={BOARD} />);
      expect(await screen.findByTestId("daily-grid-board")).toBeInTheDocument();
      expect(screen.queryByTestId("daily-grid-start-gate")).not.toBeInTheDocument();
    });

    it("records the walkthrough as skipped when the player says so", async () => {
      const user = userEvent.setup();
      render(<DailyGridGame initialBoard={BOARD} />);

      await user.click(await screen.findByTestId("daily-grid-gate-skip-tour"));
      expect(await screen.findByTestId("daily-grid-board")).toBeInTheDocument();
      expect(readTourSeen(DAILY_GRID_TOUR_ID)).toEqual(
        expect.objectContaining({ version: DAILY_GRID_TOUR_VERSION, status: "skipped" }),
      );
    });

    it("opens the walkthrough from the gate without starting anything", async () => {
      const user = userEvent.setup();
      render(<DailyGridGame initialBoard={BOARD} />);

      await user.click(await screen.findByTestId("daily-grid-gate-how-to-play"));
      expect(await screen.findByTestId("daily-grid-tour")).toBeInTheDocument();

      // The gate is still the screen, no attempt was started, and the clock is
      // untouched: reading the rules is free.
      expect(screen.getByTestId("daily-grid-start-gate")).toBeInTheDocument();
      expect(mockStart).not.toHaveBeenCalled();
      expect(screen.queryByTestId("daily-grid-board")).not.toBeInTheDocument();
    });

    it("never auto-opens the walkthrough on top of the start gate", async () => {
      render(<DailyGridGame initialBoard={BOARD} />);
      await screen.findByTestId("daily-grid-start-gate");
      // A first-time player has no stored tour record at all, which is exactly
      // the state that WOULD auto-start it if the gate did not opt out.
      expect(screen.queryByTestId("daily-grid-tour")).not.toBeInTheDocument();
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

/**
 * Phase 11D: the daily loop. Completing a board should leave the player with a
 * streak, a record, and a reason to come back — and none of it may imply a
 * ranking that does not exist.
 */
describe("DailyGridGame — Phase 11D retention", () => {
  function seedCompleted() {
    window.localStorage.setItem(
      dailyGridProgressKey(BOARD.board_id),
      JSON.stringify(completedProgress()),
    );
  }

  /** An archive holding `days` consecutive completed boards ending on
   *  BOARD.date, so the streak under test is a real derived number rather than
   *  a value written straight into storage. */
  function seedArchive(days: number, overrides: Partial<DailyGridArchiveEntry> = {}) {
    let archive = emptyArchive();
    for (let i = days - 1; i >= 0; i -= 1) {
      const date = new Date(Date.UTC(2026, 6, 30 - i)).toISOString().slice(0, 10);
      archive = recordCompletedBoard(
        archive,
        {
          // The final day IS the fixture board, so it must carry the fixture's
          // own id -- otherwise the component records a second row for the
          // same date and the total is off by one.
          board_id: date === BOARD.date ? BOARD.board_id : `daily-grid-v2-${date}`,
          date,
          theme: "Two-Way Night",
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
        },
        BOARD.date,
      );
    }
    saveArchive(archive);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    // These describes are siblings of the main one, so they do not inherit its
    // mock setup -- without this the completion effect's result fetch resolves
    // to undefined.
    mockSearch.mockResolvedValue({ query: "olajuwon", results: [hit()] });
    mockGetResult.mockResolvedValue(gridResult());
    // The fixture board is 2026-07-30; pin "now" there so it is the canonical
    // today and the streak logic is exercised rather than short-circuited.
    // `shouldAdvanceTime` keeps the clock moving under the fake, which is what
    // lets testing-library's findBy* polling and userEvent still resolve.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-07-30T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the streak, longest streak and total after completing", async () => {
    seedArchive(3);
    seedCompleted();
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    await vi.waitFor(() => expect(screen.getByTestId("complete-retention")).toBeInTheDocument());
    expect(screen.getByTestId("complete-current-streak")).toHaveTextContent("3");
    expect(screen.getByTestId("complete-longest-streak")).toHaveTextContent("3");
    expect(screen.getByTestId("complete-total-played")).toHaveTextContent("3");
  });

  it("records the finished board into the archive", async () => {
    seedCompleted();
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    await vi.waitFor(() => expect(screen.getByTestId("complete-retention")).toBeInTheDocument());
    const archive = loadArchive(BOARD.date);
    expect(archive.total_completed).toBe(1);
    expect(archive.entries[0].date).toBe(BOARD.date);
    expect(archive.entries[0].counted_for_streak).toBe(true);
  });

  it("does not double-count across re-renders", async () => {
    seedCompleted();
    const { rerender } = render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);
    await vi.waitFor(() => expect(screen.getByTestId("complete-retention")).toBeInTheDocument());
    rerender(<DailyGridGame initialBoard={BOARD} skipRulesGate />);
    await vi.waitFor(() => expect(screen.getByTestId("complete-retention")).toBeInTheDocument());
    expect(loadArchive(BOARD.date).total_completed).toBe(1);
  });

  it("tells the player to come back tomorrow, with a countdown", async () => {
    seedCompleted();
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    const line = await screen.findByTestId("complete-come-back");
    expect(line).toHaveTextContent(/Come back tomorrow for a new grid/i);
    expect(line).toHaveTextContent(/Next board in \d+h \d+m/);
  });

  it("labels local history honestly and claims no ranking", async () => {
    seedArchive(2);
    seedCompleted();
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    await vi.waitFor(() => expect(screen.getByTestId("complete-retention")).toBeInTheDocument());
    expect(screen.getByTestId("complete-local-only")).toHaveTextContent(/Saved on this device/i);
    expect(screen.getByTestId("complete-local-only")).toHaveAttribute("data-official", "false");
    expect(screen.getByTestId("daily-grid-complete").textContent).not.toMatch(
      /percentile|leaderboard|global rank|you beat \d+%/i,
    );
  });

  it("previews recent grids and links to the full history", async () => {
    seedArchive(3);
    seedCompleted();
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    await vi.waitFor(() => expect(screen.getByTestId("recent-results")).toBeInTheDocument());
    expect(screen.getAllByTestId("recent-results-row").length).toBeGreaterThan(1);
    expect(screen.getByTestId("complete-history-link")).toHaveAttribute("href", "/daily/history");
  });

  it("puts the streak on the history link while playing", async () => {
    seedArchive(4);
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    await vi.waitFor(() => expect(screen.getByTestId("daily-grid-streak-chip")).toBeInTheDocument());
    expect(screen.getByTestId("daily-grid-streak-chip")).toHaveTextContent("4d");
    expect(screen.getByTestId("daily-grid-history-link")).toHaveAttribute("href", "/daily/history");
  });

  it("includes a real streak in the share text but never a rank", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    seedArchive(5);
    seedCompleted();
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    await user.click(await screen.findByTestId("daily-grid-share"));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain("Streak: 5 days");
    expect(text).not.toMatch(/percentile|leaderboard|rank/i);
  });

  it("omits the streak line when there is nothing worth claiming", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    // A first-ever board: the streak is 1, which is just "I played".
    seedCompleted();
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    await user.click(await screen.findByTestId("daily-grid-share"));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).not.toContain("Streak:");
  });
});

describe("DailyGridGame — Phase 11D archive boards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockSearch.mockResolvedValue({ query: "olajuwon", results: [hit()] });
    mockGetResult.mockResolvedValue(gridResult());
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // A day AFTER the fixture board's date, so BOARD is a replay.
    vi.setSystemTime(new Date("2026-08-05T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("labels a non-today board as an archive replay", () => {
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);
    const banner = screen.getByTestId("daily-grid-archive-banner");
    expect(banner).toHaveTextContent(/Archive board · 2026-07-30/);
    expect(banner).toHaveTextContent(/does not count toward your streak/i);
    expect(screen.getByTestId("daily-grid-play-today")).toHaveAttribute("href", "/daily/grid");
  });

  it("shows no archive banner on today's board", () => {
    vi.setSystemTime(new Date("2026-07-30T12:00:00Z"));
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);
    expect(screen.queryByTestId("daily-grid-archive-banner")).not.toBeInTheDocument();
  });

  it("records a replay in history without touching the live streak", async () => {
    window.localStorage.setItem(
      dailyGridProgressKey(BOARD.board_id),
      JSON.stringify(completedProgress()),
    );
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    await vi.waitFor(() => expect(screen.getByTestId("complete-retention")).toBeInTheDocument());
    const archive = loadArchive("2026-08-05");
    expect(archive.total_completed).toBe(1);
    expect(archive.entries[0].counted_for_streak).toBe(false);
    expect(archive.current_streak).toBe(0);
  });

  it("points a finished replay back at today's grid instead of tomorrow", async () => {
    window.localStorage.setItem(
      dailyGridProgressKey(BOARD.board_id),
      JSON.stringify(completedProgress()),
    );
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    const line = await screen.findByTestId("complete-come-back");
    expect(line).toHaveTextContent(/That was an archive board/i);
    expect(screen.getByTestId("complete-play-today")).toHaveAttribute("href", "/daily/grid");
  });
});

/**
 * Phase 12A: the comparison is grid-to-grid. Two consequences of that used to
 * render as something false — a square the player won reading as "no better
 * answer existed", and a reused player reading as a duplicate bug.
 */
describe("DailyGridGame — the best legal grid", () => {
  function seedCompleted() {
    window.localStorage.setItem(
      dailyGridProgressKey(BOARD.board_id),
      JSON.stringify(completedProgress()),
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockSearch.mockResolvedValue({ query: "olajuwon", results: [hit()] });
  });

  it("calls the comparison the best LEGAL grid, not a per-square maximum", async () => {
    mockGetResult.mockResolvedValue(gridResult());
    seedCompleted();
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    const panel = await screen.findByTestId("complete-comparison");
    expect(panel).toHaveTextContent(/best legal grid/i);
  });

  it("says the player BEAT the grid on a square rather than claiming it was the max", async () => {
    const result = gridResult();
    // The grid traded this square away for a bigger total elsewhere.
    result.cells[0] = {
      ...result.cells[0],
      optimal_points: result.cells[0].user_points - 12,
      points_left: 0,
      matched_optimal: true,
      beat_optimal: true,
    };
    mockGetResult.mockResolvedValue(result);
    seedCompleted();
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    await waitFor(() => expect(screen.getAllByTestId("complete-mini-cell")).toHaveLength(9));
    const beaten = screen
      .getAllByTestId("complete-mini-cell")
      .filter((c) => c.getAttribute("data-grade") === "beat");
    expect(beaten).toHaveLength(1);
    // "Beat", never "Max" — the old label was simply false here.
    expect(beaten[0]).toHaveTextContent("Beat");
    expect(beaten[0]).not.toHaveTextContent("Max");
    expect(beaten[0]).toHaveAccessibleName(/beat the best legal grid here/i);
  });

  // The overlap note moved. It used to be a parenthetical inside the nine-line
  // text list, which DG-01 deleted; it now sits on the optimal square that is
  // asking for the swap, and is asserted there — see "keeps the 'you played
  // them elsewhere' note" in the optimal-3x3 suite below.

  it("never claims a square was the max when the player beat it", async () => {
    const result = gridResult();
    result.cells = result.cells.map((c) => ({
      ...c,
      optimal_points: c.user_points - 5,
      points_left: 0,
      matched_optimal: true,
      beat_optimal: true,
    }));
    mockGetResult.mockResolvedValue(result);
    seedCompleted();
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    await waitFor(() => expect(screen.getAllByTestId("complete-mini-cell")).toHaveLength(9));
    for (const cell of screen.getAllByTestId("complete-mini-cell")) {
      expect(cell).not.toHaveTextContent("Max");
    }
  });
});

/**
 * The optimal board, drawn as a board — DG-01 and DG-02.
 *
 * THIS IS NOW THE WHOLE COMPARISON. The nine-line text list that used to sit
 * above it is deleted, so these assert everything a reader needs and used to
 * get from the list: that a square's POSITION is its position on the real
 * board, that each square states its verdict in a word rather than only in a
 * colour, that a changed square carries the player's own answer, and that the
 * "you played them on X" overlap — the one genuinely two-square fact the list
 * carried — survives on the square that is asking for the swap.
 *
 * AND WHAT DG-02 ADDED: a headshot per square, from the one shared avatar
 * primitive, plus the season and team beside the name.
 */
describe("DailyGridGame — the optimal 3x3", () => {
  function seedCompleted() {
    window.localStorage.setItem(
      dailyGridProgressKey(BOARD.board_id),
      JSON.stringify(completedProgress()),
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockSearch.mockResolvedValue({ query: "olajuwon", results: [hit()] });
  });

  it("draws nine squares under the best-legal-grid heading, with the board's own headers", async () => {
    mockGetResult.mockResolvedValue(gridResult());
    seedCompleted();
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    const grid = await screen.findByTestId("complete-optimal-grid");
    expect(within(grid).getAllByTestId("complete-optimal-cell")).toHaveLength(9);
    // Row and column headers are what make this recognisably the same puzzle
    // rather than nine cards in a square.
    expect(within(grid).getAllByTestId("complete-optimal-row-header")).toHaveLength(3);
    expect(within(grid).getAllByTestId("complete-optimal-col-header")).toHaveLength(3);
    // And the one concise explanation it sits under.
    expect(screen.getByTestId("complete-comparison")).toHaveTextContent(/best legal grid/i);
  });

  it("names all three states in a legend, so colour is never the only carrier", async () => {
    mockGetResult.mockResolvedValue(gridResult());
    seedCompleted();
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    const legend = await screen.findByTestId("complete-optimal-legend");
    expect(legend).toHaveTextContent(/Matched/);
    expect(legend).toHaveTextContent(/You beat this/);
    expect(legend).toHaveTextContent(/Best choice/);
  });

  it("puts each square where it sits on the real board, not where it was filled", async () => {
    // `result.cells` arrives in FILL order. A `grid-cols-3` fills left to
    // right, top to bottom, so rendering straight from it would put answer
    // sheet square N in board position N — the same thing only by coincidence.
    const result = gridResult();
    result.cells = [...result.cells].reverse();
    mockGetResult.mockResolvedValue(result);
    seedCompleted();
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    const grid = await screen.findByTestId("complete-optimal-grid");
    const cells = within(grid).getAllByTestId("complete-optimal-cell");
    const expected = [...result.cells].sort((a, b) => a.row - b.row || a.col - b.col);
    cells.forEach((node, i) => {
      expect(node).toHaveTextContent(expected[i].optimal_player_season.player_name);
    });
  });

  it("marks a square you already played as matched, and says so in a word", async () => {
    mockGetResult.mockResolvedValue(gridResult());
    seedCompleted();
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    const grid = await screen.findByTestId("complete-optimal-grid");
    const matched = within(grid)
      .getAllByTestId("complete-optimal-cell")
      .filter((c) => c.getAttribute("data-state") === "matched");
    // The fixture matches on eight of nine squares.
    expect(matched).toHaveLength(8);
    expect(matched[0]).toHaveTextContent("Matched");
    // Nothing to cross-reference on a square you already got right.
    expect(within(matched[0]).queryByTestId("complete-optimal-your-answer")).toBeNull();
  });

  it("shows what you used on a square the grid would change", async () => {
    mockGetResult.mockResolvedValue(gridResult());
    seedCompleted();
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    const grid = await screen.findByTestId("complete-optimal-grid");
    const changed = within(grid)
      .getAllByTestId("complete-optimal-cell")
      .filter((c) => c.getAttribute("data-state") === "replacement");
    expect(changed).toHaveLength(1);
    // The optimal season is the content...
    expect(changed[0]).toHaveTextContent("Nikola Jokic");
    expect(changed[0]).toHaveTextContent("Best choice");
    // ...and the player's own answer is right there under it, which is the
    // whole reason this grid exists next to the list.
    const yours = within(changed[0]).getByTestId("complete-optimal-your-answer");
    expect(yours).toHaveTextContent(/You used:/i);
    expect(yours).toHaveTextContent(/pts/i);
  });

  it("gives a square you outscored its own state, never 'matched'", async () => {
    // `matched_optimal` is `points_left === 0` and `points_left` floors at
    // zero, so a beaten square carries `matched_optimal: true` while naming
    // somebody else. Labelling that "Matched" under a different name reads as
    // a bug in the comparison.
    const result = gridResult();
    const target = result.cells.findIndex(
      (c) => c.user_player_season.id !== c.optimal_player_season.id,
    );
    result.cells[target] = {
      ...result.cells[target],
      optimal_points: result.cells[target].user_points - 12,
      points_left: 0,
      matched_optimal: true,
      beat_optimal: true,
    };
    mockGetResult.mockResolvedValue(result);
    seedCompleted();
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    const grid = await screen.findByTestId("complete-optimal-grid");
    const beaten = within(grid)
      .getAllByTestId("complete-optimal-cell")
      .filter((c) => c.getAttribute("data-state") === "beat");
    expect(beaten).toHaveLength(1);
    expect(beaten[0]).toHaveTextContent("You beat this");
    expect(beaten[0]).not.toHaveTextContent("Matched");
    expect(within(beaten[0]).getByTestId("complete-optimal-your-answer")).toBeInTheDocument();
  });

  it("names the square, both answers and the verdict for a screen reader", async () => {
    mockGetResult.mockResolvedValue(gridResult());
    seedCompleted();
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    const grid = await screen.findByTestId("complete-optimal-grid");
    const changed = within(grid)
      .getAllByTestId("complete-optimal-cell")
      .filter((c) => c.getAttribute("data-state") === "replacement")[0];
    // Colour is reinforcement here, never the only carrier of the fact.
    expect(changed).toHaveAccessibleName(/best legal grid plays .+ Nikola Jokic/i);
    expect(changed).toHaveAccessibleName(/You played /i);
  });

  // DG-01: the overlap note was the ONE thing the deleted nine-line list said
  // that is about two squares rather than one. A name appearing twice on this
  // board is not a duplicate bug — it is the grid saying it wanted that player
  // somewhere else — so it moved onto the square that is asking for the swap.
  it("keeps the 'you played them elsewhere' note, on the square asking for the swap", async () => {
    const result = gridResult();
    const target = result.cells.findIndex((c) => !c.matched_optimal);
    result.cells[target] = {
      ...result.cells[target],
      optimal_player_user_square: "MVP x Nuggets",
    };
    mockGetResult.mockResolvedValue(result);
    seedCompleted();
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    const grid = await screen.findByTestId("complete-optimal-grid");
    const swap = within(grid)
      .getAllByTestId("complete-optimal-cell")
      .filter((c) => c.getAttribute("data-state") === "replacement")[0];
    const note = within(swap).getByTestId("complete-optimal-overlap");
    expect(note).toHaveTextContent("You played Nikola Jokic on MVP x Nuggets.");
    expect(swap).toHaveAccessibleName(/you played Nikola Jokic on MVP x Nuggets/i);
    // Only on squares the grid wants swapped: on a matched square the note
    // would be about this square, which says nothing.
    const matched = within(grid)
      .getAllByTestId("complete-optimal-cell")
      .filter((c) => c.getAttribute("data-state") === "matched")[0];
    expect(within(matched).queryByTestId("complete-optimal-overlap")).toBeNull();
  });

  // ---- DG-02 ----------------------------------------------------------------

  it("gives every square a headshot from the one shared avatar primitive", async () => {
    mockGetResult.mockResolvedValue(gridResult());
    seedCompleted();
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    const grid = await screen.findByTestId("complete-optimal-grid");
    const cells = within(grid).getAllByTestId("complete-optimal-cell");
    for (const cell of cells) {
      expect(within(cell).getByTestId("player-avatar")).toBeInTheDocument();
    }
  });

  it("renders the designed medallion, which is what actually ships", async () => {
    // THE FALLBACK IS THE PRODUCTION PATH, not the error path. The ESPN
    // manifest resolves ~15% of identities and roughly no historical players,
    // and the API gate (PEAK3_ENABLE_EXTERNAL_ASSET_URLS) is off pending a
    // licensing review — so no result payload carries an image URL and every
    // square draws initials. It must therefore be a designed mark, sized, and
    // out of the accessibility tree (the square's own aria-label names the
    // player already).
    mockGetResult.mockResolvedValue(gridResult());
    seedCompleted();
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    const grid = await screen.findByTestId("complete-optimal-grid");
    const swap = within(grid)
      .getAllByTestId("complete-optimal-cell")
      .filter((c) => c.getAttribute("data-state") === "replacement")[0];
    const avatar = within(swap).getByTestId("player-avatar");
    // Not an <img>: no URL was supplied, so the medallion renders instead of a
    // broken image, and it reserves the same box either way.
    expect(avatar.tagName).toBe("DIV");
    expect(avatar).toHaveTextContent("NJ");
    expect(avatar).toHaveAttribute("aria-hidden", "true");
    expect(avatar).toHaveStyle({ width: "28px", height: "28px" });
    // And no square anywhere in the grid smuggles in a second image source.
    expect(grid.querySelectorAll("img")).toHaveLength(0);
  });

  it("names the optimal player, their season and their team on every square", async () => {
    mockGetResult.mockResolvedValue(gridResult());
    seedCompleted();
    render(<DailyGridGame initialBoard={BOARD} skipRulesGate />);

    const grid = await screen.findByTestId("complete-optimal-grid");
    const swap = within(grid)
      .getAllByTestId("complete-optimal-cell")
      .filter((c) => c.getAttribute("data-state") === "replacement")[0];
    expect(swap).toHaveTextContent("Nikola Jokic");
    expect(swap).toHaveTextContent("2021-22");
    expect(swap).toHaveTextContent("DEN");
    // The points that square was worth are still the number on the card.
    expect(swap).toHaveTextContent(String(gridResult().biggest_miss!.optimal_points));
  });
});
