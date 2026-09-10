/**
 * The v5 taxonomy's info affordance.
 *
 * Most Daily Grid axes are self-explanatory — "Lakers", "All-Star", "7'0\"+"
 * — and hanging an info marker on those is clutter that teaches nothing. A
 * handful are not: "Elite Efficiency" is relative to WHICH league average,
 * "Undrafted" means undrafted in WHICH league, "One Team" is counted over
 * WHICH seasons. The server decides which is which (`needs_definition` on the
 * constraint), and the board header is where the player is told to look.
 *
 * The marker is an SVG rather than a text glyph on purpose, and this file
 * pins the two consequences that matter: the header's own text is unchanged
 * (the board's other tests read it), and a board served before the field
 * existed renders exactly as it did.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import DailyGridBoardView from "@/components/daily-grid/DailyGridBoardView";
import CellPanel from "@/components/daily-grid/CellPanel";
import { emptyProgress } from "@/lib/daily-grid-state";
import { BOARD } from "./daily-grid-fixtures";
import type { DailyGridBoard, GridConstraint } from "@/types/daily-grid";

function boardMarking(rowFlags: [boolean, boolean, boolean]): DailyGridBoard {
  return {
    ...BOARD,
    rows: BOARD.rows.map((row, i) => ({ ...row, needs_definition: rowFlags[i] })),
    cols: BOARD.cols.map((col) => ({ ...col, needs_definition: false })),
  };
}

function renderBoard(board: DailyGridBoard) {
  return render(
    <DailyGridBoardView
      board={board}
      progress={emptyProgress(board)}
      selected={null}
      invalidCell={null}
      onSelect={() => {}}
    />,
  );
}

describe("DailyGridBoardView — definition marker", () => {
  it("marks only the axes the server flagged", () => {
    renderBoard(boardMarking([true, false, true]));
    expect(screen.getAllByTestId("grid-header-definition-marker")).toHaveLength(2);
  });

  it("renders no marker at all on a board where every rule is in its label", () => {
    renderBoard(boardMarking([false, false, false]));
    expect(screen.queryByTestId("grid-header-definition-marker")).toBeNull();
  });

  it("leaves the header's text exactly as it was", () => {
    const board = boardMarking([true, true, true]);
    renderBoard(board);
    const headers = screen.getAllByTestId("grid-row-header");
    headers.forEach((header, i) => {
      // An SVG contributes nothing to textContent, which is what lets the
      // marker coexist with the board's label assertions elsewhere.
      expect(header.textContent).toBe(board.rows[i].short_label);
    });
  });

  it("still finds the label element by its own test id, marker or not", () => {
    renderBoard(boardMarking([true, false, false]));
    const headers = screen.getAllByTestId("grid-row-header");
    for (const header of headers) {
      expect(header.querySelector("[data-testid='grid-header-label']")).not.toBeNull();
    }
  });

  it("renders nothing when the field is absent, as on a board cached before it shipped", () => {
    const strip = (constraint: GridConstraint): GridConstraint => {
      const copy = { ...constraint };
      delete copy.needs_definition;
      return copy;
    };
    const legacy: DailyGridBoard = {
      ...BOARD,
      rows: BOARD.rows.map(strip),
      cols: BOARD.cols.map(strip),
    };
    renderBoard(legacy);
    expect(screen.queryByTestId("grid-header-definition-marker")).toBeNull();
    expect(screen.getAllByTestId("grid-row-header")).toHaveLength(3);
  });

  it("keeps the full rule on the header title either way", () => {
    const board = boardMarking([true, false, false]);
    renderBoard(board);
    const header = screen.getAllByTestId("grid-row-header")[0];
    expect(header.getAttribute("title")).toContain(board.rows[0].description);
  });
});

describe("CellPanel — 'What counts'", () => {
  function panel(needsDefinition: boolean) {
    const board = {
      ...BOARD,
      rows: BOARD.rows.map((row, i) =>
        i === 0 ? { ...row, needs_definition: needsDefinition } : row,
      ),
    };
    return render(
      <CellPanel
        board={board}
        row={0}
        col={0}
        filled={null}
        usedPlayerSlugs={[]}
        invalidMessage={null}
        submitting={false}
        onSubmit={() => {}}
        onClose={() => {}}
      />,
    );
  }

  it("heads the description for an axis whose rule is not in its label", () => {
    panel(true);
    expect(screen.getByTestId("cell-panel-row-definition-heading")).toBeInTheDocument();
  });

  it("adds no heading to a self-explanatory axis", () => {
    panel(false);
    expect(screen.queryByTestId("cell-panel-row-definition-heading")).toBeNull();
  });

  it("shows the description either way", () => {
    panel(false);
    expect(screen.getByText(BOARD.rows[0].description)).toBeInTheDocument();
  });
});
