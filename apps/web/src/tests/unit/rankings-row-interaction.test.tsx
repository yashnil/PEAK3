/**
 * A ranking row has ONE destination, and the `ƒ` column is gone.
 *
 * WHAT THIS FILE USED TO ASSERT, AND WHY THAT CHANGED. Its previous subject was
 * the row's TWO actions and the guarantee that they occupied two separate boxes:
 * the player name opened the analysis, a bounded 44px cell headed `ƒ` opened a
 * separate score-derivation modal, and a table cell is a rectangle so neither
 * could contain the other. That was a correct fix to a real geometry defect —
 * at 390px the name had covered most of the row, so the same gesture opened a
 * different dialog at two viewport widths.
 *
 * It was also the wrong shape for the product. The row still offered two
 * destinations for one question: the drawer showed the shape of a peak and
 * would not say where the number came from, the modal showed the derivation and
 * had no chart, and a reader who wanted both had to close one to open the
 * other. `ƒ` is a glyph, and a column of glyphs is a column of things a reader
 * must decode before it is worth anything.
 *
 * So the column is gone — header and cells — and the derivation is a disclosure
 * inside the one analysis drawer. The geometry guarantee below is now stronger
 * than "two boxes that cannot overlap": there is only one thing in the row to
 * open.
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import RankingsTable from "@/components/rankings/RankingsTable";
import type { RankingRow } from "@/types";

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
    components: null,
    percentiles: null,
    data_completeness: "complete",
    headshot_url: null,
    ...overrides,
  } as RankingRow;
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
];

function renderTable(overrides: Partial<React.ComponentProps<typeof RankingsTable>> = {}) {
  const onSelectRow = vi.fn();
  render(
    <RankingsTable
      rows={ROWS}
      sortKey="rank"
      sortDirection="asc"
      onSort={vi.fn()}
      showComponents={false}
      onSelectRow={onSelectRow}
      caption="Test board"
      emptyMessage="none"
      labelHeading="Window"
      {...overrides}
    />,
  );
  return { onSelectRow };
}

describe("the ƒ column is gone", () => {
  it("renders no ƒ header", () => {
    renderTable();
    const headers = screen
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent ?? "");
    expect(headers.some((text) => text.includes("ƒ"))).toBe(false);
    expect(headers.some((text) => /score derivation/i.test(text))).toBe(false);
  });

  it("renders no standalone derivation control in any row", () => {
    renderTable();
    expect(screen.queryAllByTestId("rankings-explain")).toHaveLength(0);
    expect(
      screen.queryAllByRole("button", { name: /Explain the PEAK3 score/i }),
    ).toHaveLength(0);
  });

  it("puts no ƒ glyph anywhere in the table", () => {
    renderTable();
    expect(screen.getByTestId("rankings-table").textContent).not.toContain("ƒ");
  });

  it("reclaims the width: every body row has the same cell count as the header", () => {
    // The removed column was a real `<td>` in every row, not a CSS-hidden one.
    // Header and body agreeing is what proves it was removed from both.
    renderTable();
    const headerCells = screen.getAllByRole("columnheader").length;
    for (const tableRow of screen.getAllByTestId("rankings-row")) {
      expect(within(tableRow).getAllByRole("cell").length).toBe(headerCells);
    }
  });
});

describe("what each part of a row does", () => {
  it("tapping the PLAYER NAME opens the analysis", async () => {
    const { onSelectRow } = renderTable();
    const first = screen.getAllByTestId("rankings-row")[0];
    await userEvent.click(within(first).getByTestId("rankings-open-analysis"));
    expect(onSelectRow).toHaveBeenCalledWith(expect.objectContaining({ rank: 1 }));
  });

  it("tapping ordinary row whitespace opens the analysis", async () => {
    const { onSelectRow } = renderTable();
    // The team cell carries no control, so a click on it is a click on the row.
    const first = screen.getAllByTestId("rankings-row")[0];
    await userEvent.click(within(first).getByText("CHI"));
    expect(onSelectRow).toHaveBeenCalledWith(expect.objectContaining({ rank: 1 }));
  });

  it("tapping the RANK opens the analysis", async () => {
    const { onSelectRow } = renderTable();
    await userEvent.click(screen.getByTestId("rankings-select-1"));
    expect(onSelectRow).toHaveBeenCalledWith(expect.objectContaining({ rank: 1 }));
  });

  it("opens the SAME destination from all three paths", async () => {
    const { onSelectRow } = renderTable();
    const first = screen.getAllByTestId("rankings-row")[0];
    await userEvent.click(screen.getByTestId("rankings-select-1"));
    await userEvent.click(within(first).getByTestId("rankings-open-analysis"));
    await userEvent.click(within(first).getByText("CHI"));
    expect(onSelectRow).toHaveBeenCalledTimes(3);
    for (const call of onSelectRow.mock.calls) {
      expect(call[0]).toMatchObject({ row_id: "michael-jordan-1yr-199091" });
    }
  });
});

describe("keyboard", () => {
  it("activates the analysis from the player name with Enter and Space", async () => {
    const { onSelectRow } = renderTable();
    const first = screen.getAllByTestId("rankings-row")[0];
    within(first).getByTestId("rankings-open-analysis").focus();
    await userEvent.keyboard("{Enter}");
    expect(onSelectRow).toHaveBeenCalledTimes(1);
    await userEvent.keyboard(" ");
    expect(onSelectRow).toHaveBeenCalledTimes(2);
  });

  it("activates the analysis from the rank with Enter and Space", async () => {
    const { onSelectRow } = renderTable();
    screen.getByTestId("rankings-select-1").focus();
    await userEvent.keyboard("{Enter}");
    expect(onSelectRow).toHaveBeenCalledTimes(1);
    await userEvent.keyboard(" ");
    expect(onSelectRow).toHaveBeenCalledTimes(2);
  });

  it("tabs from the rank straight to the name, and then out of the row", async () => {
    // There is no third stop any more. The tab order used to be
    // rank → name → derivation; the derivation was the control that has gone.
    renderTable();
    const rows = screen.getAllByTestId("rankings-row");
    const rank = screen.getByTestId("rankings-select-1");
    rank.focus();
    await userEvent.tab();
    expect(within(rows[0]).getByTestId("rankings-open-analysis")).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByTestId("rankings-select-2")).toHaveFocus();
  });
});

describe("the structural guarantees", () => {
  it("gives the row no interactive role, so nothing is nested-interactive", () => {
    // The row carries a click handler as a pointer convenience. It must NOT
    // carry `role="button"`: an interactive role wrapping focusable descendants
    // is axe's `nested-interactive`, and a screen reader would announce the row
    // as a button and then be unable to reach the buttons inside it.
    renderTable();
    const row0 = screen.getAllByTestId("rankings-row")[0];
    expect(row0.getAttribute("role")).toBeNull();
    expect(row0.getAttribute("tabindex")).toBeNull();
    // And every action the row offers is also a real control inside it.
    expect(within(row0).getAllByRole("button").length).toBe(2);
  });

  it("both controls carry the same accessible name, because they do the same thing", () => {
    renderTable();
    expect(
      screen.getAllByRole("button", {
        name: /Open the full PEAK3 analysis for Michael Jordan/i,
      }),
    ).toHaveLength(2);
  });

  it("renders the name as plain text when there is no analysis to open", async () => {
    // A board rendered without `onSelectRow` has no destination. A button that
    // does nothing is worse than a name, and it used to fall back to a
    // derivation modal that no longer exists.
    renderTable({ onSelectRow: undefined });
    expect(screen.queryByTestId("rankings-open-analysis")).toBeNull();
    expect(screen.getAllByText("Michael Jordan").length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("button", { name: /Open the full PEAK3 analysis/i })).toHaveLength(
      0,
    );
  });
});
