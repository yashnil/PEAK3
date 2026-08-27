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

    // Time / misses / matched-at-max.
    expect(screen.getByTestId("complete-attempts")).toHaveTextContent(
      `${progress.incorrect_attempts} misses`,
    );
    expect(screen.getByTestId("complete-matched")).toHaveTextContent(
      `${result.squares_matching_optimal}/9 squares at the max`,
    );

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
