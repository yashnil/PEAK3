/**
 * Rankings: no analysis on load, and the chart lives only inside one.
 *
 * THE DEFECT UNDER TEST. `rankings/page.tsx` resolved the selected row as
 *
 *     const match = selectedRowId ? sortedRows.find(...) : null;
 *     return match ?? sortedRows[0];
 *
 * so a fresh load selected the top-ranked player, drew a radar chart, and held
 * a third of the page width open in `.rankings-split`'s
 * `minmax(21rem, 0.9fr)` track. Three findings followed from that single
 * fallback: an analysis appeared before anyone asked for one, the table lost
 * the width its component columns needed, and the chart read as decoration
 * beside a list rather than as part of a player's analysis.
 *
 * These tests drive the real page component against a stubbed API, because the
 * defect was in the page's own state resolution rather than in any child.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { RankingBoardData, RankingRow } from "@/types";

const { getPeakWindowBoard, getSeasonBoard, getMethodology, getRankingExplain } =
  vi.hoisted(() => ({
    getPeakWindowBoard: vi.fn(),
    getSeasonBoard: vi.fn(),
    getMethodology: vi.fn(),
    getRankingExplain: vi.fn(),
  }));

vi.mock("@/lib/api", () => ({
  getPeakWindowBoard,
  getSeasonBoard,
  getMethodology,
  getRankingExplain,
}));

import RankingsPage from "@/app/(main)/rankings/page";

function row(overrides: Partial<RankingRow> = {}): RankingRow {
  return {
    row_id: "michael-jordan-1yr-199091",
    rank: 1,
    player_name: "Michael Jordan",
    player_slug: "michael-jordan",
    label: "1990-91",
    team: "CHI",
    prime_score: 97.53,
    prime_index: 97.53,
    duration_years: 1,
    components: {
      statistical_impact: 38.1,
      traditional_production: 20.4,
      individual_recognition: 19.8,
      postseason_individual_value: 17.2,
      team_achievement: 2.9,
    },
    percentiles: {
      statistical_impact: 99,
      traditional_production: 98,
      individual_recognition: 100,
      postseason_individual_value: 97,
      team_achievement: 95,
    },
    data_completeness: "complete",
    headshot_url: null,
    ...overrides,
  } as RankingRow;
}

function board(rows: RankingRow[]): RankingBoardData {
  return {
    rows,
    meta: {
      total_available: rows.length,
      model_version: "peak3_v1",
      generated_at: "2026-08-05T00:00:00Z",
    },
  } as RankingBoardData;
}

const ROWS = [
  row(),
  row({
    row_id: "lebron-james-1yr-200809",
    rank: 2,
    player_name: "LeBron James",
    player_slug: "lebron-james",
    label: "2008-09",
    team: "CLE",
    prime_score: 95.85,
  }),
  row({
    row_id: "kareem-abdul-jabbar-1yr-197172",
    rank: 3,
    player_name: "Kareem Abdul-Jabbar",
    player_slug: "kareem-abdul-jabbar",
    label: "1971-72",
    team: "MIL",
    prime_score: 94.2,
  }),
];

beforeEach(() => {
  getPeakWindowBoard.mockResolvedValue(board(ROWS));
  getSeasonBoard.mockResolvedValue(board(ROWS));
  getMethodology.mockResolvedValue(null);
  getRankingExplain.mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

async function renderPage() {
  render(<RankingsPage />);
  await waitFor(() => expect(screen.getAllByTestId("rankings-row").length).toBe(3));
}

// ---------------------------------------------------------------------------
// The initial state
// ---------------------------------------------------------------------------

describe("the initial Rankings page", () => {
  it("opens with NO player analysis", async () => {
    await renderPage();
    expect(screen.queryByTestId("rankings-analysis")).toBeNull();
  });

  it("opens with NO chart, and the chart is not merely hidden", async () => {
    await renderPage();
    // THE SVG IS NOT IN THE DOCUMENT AT ALL. "Rendered but display:none" would
    // still pay the construction cost on a load that never opens an analysis,
    // which is what PART 22's "render only when analysis opens" rules out.
    expect(screen.queryByTestId("rankings-composite-chart")).toBeNull();
    expect(document.querySelector("svg")).toBeNull();
  });

  it("does not select Michael Jordan, or anyone else", async () => {
    await renderPage();
    for (const tableRow of screen.getAllByTestId("rankings-row")) {
      expect(tableRow).toHaveAttribute("data-selected", "false");
    }
  });

  it("keeps the board full width, with no reserved analysis column", async () => {
    await renderPage();
    // `.rankings-split` was a two-column grid whose right track was held open
    // whether or not anything was in it. Its replacement is a single
    // full-width container.
    expect(document.querySelector(".rankings-split")).toBeNull();
    expect(document.querySelector(".rankings-board")).not.toBeNull();
  });

  it("still offers the browsing controls the page is for", async () => {
    await renderPage();
    expect(screen.getByTestId("pool-tab-peak-windows")).toBeInTheDocument();
    expect(screen.getByTestId("pool-tab-seasons")).toBeInTheDocument();
    expect(screen.getByTestId("peak-window-tab-3y")).toBeInTheDocument();
    expect(screen.getByTestId("rankings-search")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Opening an analysis
// ---------------------------------------------------------------------------

describe("opening the analysis", () => {
  it("opens on a row click, with the correct player", async () => {
    await renderPage();
    await userEvent.click(screen.getAllByTestId("rankings-row")[1]);
    const panel = await screen.findByTestId("rankings-analysis");
    expect(panel).toHaveAttribute("data-row-id", "lebron-james-1yr-200809");
    expect(within(panel).getByTestId("rk-detail-name")).toHaveTextContent("LeBron James");
  });

  it("opens on Enter and on Space from the keyboard control", async () => {
    await renderPage();
    const control = screen.getByTestId("rankings-select-2");
    control.focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByTestId("rankings-analysis")).toHaveAttribute(
      "data-row-id",
      "lebron-james-1yr-200809",
    );

    await userEvent.click(screen.getByTestId("rankings-analysis-close"));
    await waitFor(() => expect(screen.queryByTestId("rankings-analysis")).toBeNull());

    screen.getByTestId("rankings-select-3").focus();
    await userEvent.keyboard(" ");
    expect(await screen.findByTestId("rankings-analysis")).toHaveAttribute(
      "data-row-id",
      "kareem-abdul-jabbar-1yr-197172",
    );
  });

  it("draws the chart only now, inside the analysis", async () => {
    await renderPage();
    expect(document.querySelector("svg")).toBeNull();
    await userEvent.click(screen.getAllByTestId("rankings-row")[0]);
    const panel = await screen.findByTestId("rankings-analysis");
    expect(within(panel).getByTestId("rankings-composite-chart")).toBeInTheDocument();
  });

  it("carries the whole analysis, not only a chart", async () => {
    await renderPage();
    await userEvent.click(screen.getAllByTestId("rankings-row")[0]);
    const panel = await screen.findByTestId("rankings-analysis");
    // Rank, board, window, season, team, score.
    expect(panel).toHaveTextContent("#1");
    expect(panel).toHaveTextContent("1990-91");
    expect(panel).toHaveTextContent("CHI");
    expect(panel).toHaveTextContent("97.53");
    // All five components plus completeness, as EXACT ACCESSIBLE VALUES beside
    // the chart rather than as a text alternative bolted underneath.
    const table = within(panel).getByTestId("rk-detail-table");
    for (const key of [
      "statistical_impact",
      "traditional_production",
      "individual_recognition",
      "postseason_individual_value",
      "team_achievement",
      "data_completeness",
    ]) {
      expect(within(table).getByTestId(`rk-detail-row-${key}`)).toBeInTheDocument();
    }
    // AND the derivation, in the SAME drawer. There is no second dialog to
    // open: the three disclosures below the summary are where the formula,
    // the weights, the arithmetic and the source window live.
    expect(within(panel).getByTestId("rk-fold-breakdown")).toBeInTheDocument();
    expect(within(panel).getByTestId("rk-fold-calculation")).toBeInTheDocument();
    expect(within(panel).getByTestId("rk-fold-source")).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("asks the API for the derivation of the row that was opened, and only then", async () => {
    await renderPage();
    expect(getRankingExplain).not.toHaveBeenCalled();
    await userEvent.click(screen.getAllByTestId("rankings-row")[1]);
    await screen.findByTestId("rankings-analysis");
    await waitFor(() =>
      expect(getRankingExplain).toHaveBeenCalledWith("peakWindows", "lebron-james-1yr-200809"),
    );
  });

  it("updates the derivation as well as the chart when stepping to the next player", async () => {
    await renderPage();
    await userEvent.click(screen.getAllByTestId("rankings-row")[0]);
    await screen.findByTestId("rankings-analysis");
    await userEvent.click(screen.getByTestId("rankings-analysis-next"));
    await waitFor(() =>
      expect(getRankingExplain).toHaveBeenCalledWith("peakWindows", "lebron-james-1yr-200809"),
    );
    expect(screen.getByTestId("rk-detail-name")).toHaveTextContent("LeBron James");
  });

  it("steps to the adjacent ranked player without closing", async () => {
    await renderPage();
    await userEvent.click(screen.getAllByTestId("rankings-row")[0]);
    await userEvent.click(screen.getByTestId("rankings-analysis-next"));
    expect(screen.getByTestId("rankings-analysis")).toHaveAttribute(
      "data-row-id",
      "lebron-james-1yr-200809",
    );
    // The top-ranked row has nowhere higher to go.
    await userEvent.click(screen.getByTestId("rankings-analysis-prev"));
    expect(screen.getByTestId("rankings-analysis-prev")).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Closing, and what survives it
// ---------------------------------------------------------------------------

describe("closing the analysis", () => {
  it("closes on Escape", async () => {
    await renderPage();
    await userEvent.click(screen.getAllByTestId("rankings-row")[0]);
    await screen.findByTestId("rankings-analysis");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("rankings-analysis")).toBeNull());
  });

  it("returns focus to the row that opened it", async () => {
    await renderPage();
    await userEvent.click(screen.getByTestId("rankings-select-2"));
    await screen.findByTestId("rankings-analysis");
    await userEvent.click(screen.getByTestId("rankings-analysis-close"));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("rankings-select-2")),
    );
  });

  it("removes the chart from the document again", async () => {
    await renderPage();
    await userEvent.click(screen.getAllByTestId("rankings-row")[0]);
    await screen.findByTestId("rankings-analysis");
    await userEvent.click(screen.getByTestId("rankings-analysis-close"));
    await waitFor(() => expect(screen.queryByTestId("rankings-composite-chart")).toBeNull());
  });

  it("preserves the search text and the duration filter across an open/close", async () => {
    await renderPage();
    await userEvent.click(screen.getByTestId("peak-window-tab-3y"));
    await userEvent.type(screen.getByTestId("rankings-search"), "jordan");

    await userEvent.click(screen.getAllByTestId("rankings-row")[0]);
    await screen.findByTestId("rankings-analysis");
    await userEvent.click(screen.getByTestId("rankings-analysis-close"));

    expect(screen.getByTestId("rankings-search")).toHaveValue("jordan");
    expect(screen.getByTestId("peak-window-tab-3y")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("closes rather than substituting another player when the row leaves the board", async () => {
    // THE OLD `?? sortedRows[0]` WOULD HAVE SWAPPED IN A DIFFERENT PLAYER here,
    // silently, under a heading the reader had chosen for someone else.
    //
    // Driven through the BOARD TAB rather than the search box: switching board
    // refetches immediately, where the search runs behind a 250 ms debounce and
    // would make this a test about timing rather than about substitution.
    await renderPage();
    await userEvent.click(screen.getAllByTestId("rankings-row")[2]);
    await screen.findByTestId("rankings-analysis");

    getSeasonBoard.mockResolvedValue(board([ROWS[0]]));
    await userEvent.click(screen.getByTestId("pool-tab-seasons"));
    await waitFor(
      () => expect(screen.queryByTestId("rankings-analysis")).toBeNull(),
      { timeout: 5000 },
    );
  });
});
