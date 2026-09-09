/**
 * Daily Grid completion recap, V2 (Pass 7, human acceptance testing, task
 * §3). The legacy recap was card-in-card-in-card (`CompletionModal`'s
 * `Dialog` panel -> a `<section>` -> `ScoreTile`/retention `card-surface`
 * tiles -> `OptimalGrid`/`RecentResults`/`DailyLeaderboard`'s own internal
 * cards). This proves the V2 branch reports the EXACT SAME receipt values
 * as legacy off the identical fixtures (`gridResult`/`completedProgress`
 * from `daily-grid-fixtures.ts`) -- only the markup differs.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { setUiVersion, __resetUiVersionStoreForTests } from "@/lib/ui-version";
import { buildArchiveEntry, emptyArchive } from "@/lib/daily-grid-archive";
import { BOARD, completedProgress, gridResult } from "./daily-grid-fixtures";

vi.mock("@/lib/daily-grid-api", () => ({
  fetchDailyLeaderboard: vi.fn().mockRejectedValue(new Error("not stubbed")),
}));

import CompletionPanel from "@/components/daily-grid/CompletionPanel";

beforeEach(() => {
  __resetUiVersionStoreForTests();
  setUiVersion("v2");
});

afterEach(() => {
  __resetUiVersionStoreForTests();
});

describe("Daily Grid completion recap, V2", () => {
  it("reports the identical receipt values as the legacy recap for the same result", () => {
    const progress = completedProgress();
    const result = gridResult();
    const archive = {
      ...emptyArchive(),
      current_streak: 4,
      longest_streak: 9,
      total_completed: 12,
      entries: [buildArchiveEntry(BOARD, progress, result)],
    };

    render(
      <CompletionPanel
        board={BOARD}
        progress={progress}
        result={result}
        resultError={null}
        archive={archive}
        isArchiveBoard={false}
        officialSaved
      />,
    );

    // The three headline numbers.
    expect(screen.getByTestId("complete-total-score")).toHaveTextContent(String(result.user_total));
    expect(screen.getByTestId("complete-optimal-total")).toHaveTextContent(String(result.optimal_total));
    expect(screen.getByTestId("complete-percent-of-best")).toHaveTextContent(`${result.percent_of_best}%`);

    // Time / misses / matched-at-max. Each is now a stat block -- a value
    // and its label -- rather than a clause in a sentence; the VALUES are
    // what this test is about and they are unchanged.
    expect(screen.getByTestId("complete-attempts")).toHaveTextContent(
      String(progress.incorrect_attempts),
    );
    expect(screen.getByTestId("complete-attempts")).toHaveTextContent(/miss/i);
    expect(screen.getByTestId("complete-matched")).toHaveTextContent(
      `${result.squares_matching_optimal}/9`,
    );
    expect(screen.getByTestId("complete-matched")).toHaveTextContent(/at the max/i);

    // Every one of the 9 per-square recap tiles is present, in board order.
    expect(screen.getAllByTestId("complete-mini-cell")).toHaveLength(9);

    // The biggest miss detail (real players, real points).
    expect(screen.getByTestId("complete-biggest-miss")).toHaveTextContent(
      result.biggest_miss!.user_player_season.label,
    );
    expect(screen.getByTestId("complete-biggest-miss")).toHaveTextContent(
      result.biggest_miss!.optimal_player_season.label,
    );

    // The best-legal-grid comparison summary and its embedded OptimalGrid.
    expect(screen.getByTestId("complete-comparison-summary")).toHaveTextContent(
      /agrees with you on 8 of 9 squares/,
    );

    // Retention block: streak/longest/total, sourced from `archive`, not
    // re-derived -- and the "Saved to your account" badge for officialSaved.
    expect(screen.getByTestId("complete-current-streak")).toHaveTextContent("4");
    expect(screen.getByTestId("complete-longest-streak")).toHaveTextContent("9");
    expect(screen.getByTestId("complete-total-played")).toHaveTextContent("12");
    expect(screen.getByTestId("complete-local-only")).toHaveAttribute("data-official", "true");
  });

  it("degrades to the player's own totals (no crash, no invented comparison) when result is unavailable", () => {
    const progress = completedProgress();
    render(
      <CompletionPanel
        board={BOARD}
        progress={progress}
        result={null}
        resultError="Comparison temporarily unavailable."
        archive={null}
        isArchiveBoard={false}
      />,
    );
    const total = progress.filled.reduce((s, c) => s + c.cell_score.arena_points, 0);
    expect(screen.getByTestId("complete-total-score")).toHaveTextContent(String(total));
    expect(screen.queryByTestId("complete-optimal-total")).not.toBeInTheDocument();
    expect(screen.getByTestId("complete-result-error")).toHaveTextContent("Comparison temporarily unavailable.");
  });
});

// ---------------------------------------------------------------------------
// The result screen's hierarchy (responsiveness + visual-juice pass)
// ---------------------------------------------------------------------------

describe("the completion screen's hierarchy", () => {
  function renderPanel() {
    const progress = completedProgress();
    const result = gridResult();
    render(
      <CompletionPanel
        board={BOARD}
        progress={progress}
        result={result}
        resultError={null}
        archive={null}
        isArchiveBoard={false}
        officialSaved
      />,
    );
    return { progress, result };
  }

  it("gives every square its own verdict, not just the two that beat the max", () => {
    // "Max" and "Beat" were the only two words on the receipt; every other
    // square printed a bare minus-number and a paragraph underneath had to
    // explain what that meant.
    renderPanel();
    const cells = screen.getAllByTestId("complete-mini-cell");
    expect(cells).toHaveLength(9);
    for (const cell of cells) {
      expect(cell.textContent?.trim().length ?? 0).toBeGreaterThan(1);
      expect(cell.getAttribute("data-grade")).toBeTruthy();
    }
  });

  it("replaces the three-sentence legend with swatches that say the same thing", () => {
    renderPanel();
    const legend = screen.getByTestId("complete-legend");
    expect(legend).toHaveTextContent("Beat");
    expect(legend).toHaveTextContent("Max");
    expect(legend).toHaveTextContent("Close");
    // The prose it replaces is gone.
    expect(screen.queryByText(/means the best legal grid scored the same here/i)).toBeNull();
  });

  it("makes the cost of the biggest swing the largest thing in its block", () => {
    const { result } = renderPanel();
    const swing = screen.getByTestId("complete-biggest-miss");
    const number = swing.querySelector(".dg-swing-number");
    expect(number).not.toBeNull();
    expect(number).toHaveTextContent(String(result.biggest_miss!.points_left));
    // Both player names are still named, and the optimal one is marked as such.
    expect(swing).toHaveTextContent(result.biggest_miss!.user_player_season.label);
    expect(swing).toHaveTextContent(result.biggest_miss!.optimal_player_season.label);
    expect(swing.querySelector('[data-side="optimal"]')).not.toBeNull();
    expect(swing.querySelector('[data-side="yours"]')).not.toBeNull();
  });

  it("states the summary as three labelled stats", () => {
    renderPanel();
    const summary = screen.getByTestId("complete-summary");
    expect(summary).toContainElement(screen.getByTestId("complete-time"));
    expect(summary).toContainElement(screen.getByTestId("complete-attempts"));
    expect(summary).toContainElement(screen.getByTestId("complete-matched"));
    for (const id of ["complete-time", "complete-attempts", "complete-matched"]) {
      expect(screen.getByTestId(id).querySelector(".dg-stat-label")).not.toBeNull();
    }
  });
});
