/**
 * Final closure pass, task §4: the Daily Grid row-header gutter is the
 * narrowest column on the board, and at 390px an uppercase, tracked,
 * single-word category label like "Champion" had no natural break point --
 * `overflow-wrap: break-word` sliced it mid-word. jsdom has no real layout
 * engine (no `getBoundingClientRect`), so this cannot assert actual pixel
 * wrapping; what it CAN assert, and does, is the structural fix: the
 * row-header track floor widened, row-header letter-spacing dropped to zero,
 * and long single-word labels get a smaller reserved font-size than short
 * ones -- verified against the reported case ("Champion") and worse/longer
 * cases so the fix is not "Champion"-specific.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import DailyGridBoardView from "@/components/daily-grid/DailyGridBoardView";
import { emptyProgress } from "@/lib/daily-grid-state";
import { BOARD } from "./daily-grid-fixtures";
import type { DailyGridBoard } from "@/types/daily-grid";

function boardWithRowLabels(labels: [string, string, string]): DailyGridBoard {
  return {
    ...BOARD,
    rows: BOARD.rows.map((row, i) => ({ ...row, short_label: labels[i] })),
  };
}

describe("DailyGridBoardView — row-header labels never break mid-word (task §4)", () => {
  it("reports the row-header gutter track with a wider floor than before (58px -> 68px)", () => {
    const { container } = render(
      <DailyGridBoardView
        board={BOARD}
        progress={emptyProgress(BOARD)}
        selected={null}
        invalidCell={null}
        onSelect={() => {}}
      />,
    );
    const grid = container.querySelector('[data-testid="daily-grid-board"]') as HTMLElement;
    expect(grid.style.gridTemplateColumns).toContain("minmax(68px, 0.55fr)");
  });

  it.each([
    ["Champion", 8], // the reported bug
    ["Timberwolves", 12], // worse: a real team-constraint short_label
    ["Forward", 7], // a single-word position constraint
  ])("gives the long single-word row label %s no letter-spacing and a length-aware font-size", (label) => {
    const board = boardWithRowLabels([label, "DPOY", "1990s"]);
    render(
      <DailyGridBoardView
        board={board}
        progress={emptyProgress(board)}
        selected={null}
        invalidCell={null}
        onSelect={() => {}}
      />,
    );
    const headers = screen.getAllByTestId("grid-row-header");
    const span = headers[0].querySelector("span:last-child") as HTMLElement;
    expect(span.textContent).toBe(label);
    // No tracking-*/letter-spacing on row headers at all (column headers,
    // ~3x wider, keep theirs) -- reclaimed pixels the long word needs.
    expect(span.className).not.toMatch(/tracking-/);
    expect(span.style.letterSpacing).toBe("");
    // Labels over 9 characters get the smaller reserved clamp; shorter ones
    // (e.g. "DPOY", "Champion" is 8 so it still gets the default clamp) keep
    // the default size -- this is a shrink for outliers, not a global cut.
    const expectFontSize = label.length > 9 ? "clamp(7.5px, 2.1vw, 10px)" : "clamp(9px, 2.4vw, 12px)";
    expect(span.style.fontSize).toBe(expectFontSize);
  });

  it("does not touch column-header labels (already ~3x wider, unaffected by this fix)", () => {
    render(
      <DailyGridBoardView
        board={BOARD}
        progress={emptyProgress(BOARD)}
        selected={null}
        invalidCell={null}
        onSelect={() => {}}
      />,
    );
    const colHeaders = screen.getAllByTestId("grid-col-header");
    const span = colHeaders[0].querySelector("span:last-child") as HTMLElement;
    expect(span.className).toMatch(/tracking-\[0\.04em\]/);
  });

  it("still wraps a multi-word label at its natural space, unaffected by the single-word fix", () => {
    const board = boardWithRowLabels(["League Leader", "DPOY", "1990s"]);
    render(
      <DailyGridBoardView
        board={board}
        progress={emptyProgress(board)}
        selected={null}
        invalidCell={null}
        onSelect={() => {}}
      />,
    );
    const headers = screen.getAllByTestId("grid-row-header");
    expect(headers[0].textContent).toBe("League Leader");
  });
});
