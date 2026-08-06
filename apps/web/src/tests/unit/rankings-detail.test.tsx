/**
 * The Rankings master-detail panel.
 *
 * The chart used to live inside the explain modal, so comparing two peaks meant
 * open, read, close, open. What is asserted here is that it is now a standing
 * panel, that it draws all six axes, and -- the rule that matters most -- that
 * the chart is never the only way to read the numbers.
 */
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import RankingsDetail from "@/components/rankings/RankingsDetail";
import { compositeAxes } from "@/components/rankings/CompositeChart";
import type { RankingRow } from "@/types";

function row(overrides: Partial<RankingRow> = {}): RankingRow {
  return {
    rank: 1,
    row_id: "michael-jordan-1yr-199091",
    player_slug: "michael-jordan",
    player_name: "Michael Jordan",
    label: "1990-91",
    team: "CHI",
    prime_score: 97.53,
    prime_index: 1,
    components: {
      statistical_impact: 36.4,
      traditional_production: 19.8,
      individual_recognition: 19.1,
      postseason_individual_value: 17.2,
      team_achievement: 2.9,
    },
    percentiles: {
      statistical_impact: 99,
      traditional_production: 98,
      individual_recognition: 100,
      postseason_individual_value: 97,
      team_achievement: 96,
      total: 100,
    },
    mpg: 37.0,
    data_completeness: "complete",
    headshot_url: null,
    season_in_progress: false,
    ...overrides,
  };
}

describe("compositeAxes", () => {
  it("returns five components plus data completeness, in a fixed order", () => {
    const axes = compositeAxes(row().percentiles, row().components, true);
    expect(axes).not.toBeNull();
    expect(axes).toHaveLength(6);
    expect(axes![5].key).toBe("data_completeness");
    expect(axes![5].value).toBe(100);
  });

  it("refuses to draw anything when the board publishes no percentiles", () => {
    // A six-spoke shape collapsed to the origin looks like a verdict on the
    // player rather than an absence in the data.
    expect(compositeAxes(null, row().components, true)).toBeNull();
  });

  it("marks an incomplete row down on the completeness axis rather than hiding it", () => {
    const axes = compositeAxes(row().percentiles, row().components, false);
    expect(axes![5].value).toBeLessThan(100);
  });
});

describe("RankingsDetail", () => {
  function renderDetail(overrides: Partial<RankingRow> | null = {}) {
    render(
      <RankingsDetail
        row={overrides === null ? null : row(overrides)}
        boardLabel="Peak windows"
        windowLabel="1Y"
        populationNoun="peak window"
      />,
    );
  }

  it("names the selected player, their rank, window and season", () => {
    renderDetail();
    expect(screen.getByTestId("rk-detail-name")).toHaveTextContent("Michael Jordan");
    const panel = screen.getByTestId("rankings-detail");
    expect(panel).toHaveTextContent("#1 · Peak windows · 1Y");
    expect(panel).toHaveTextContent("1990-91 · CHI");
    expect(panel).toHaveTextContent("97.53");
  });

  it("draws all six axes with readable labels", () => {
    renderDetail();
    expect(screen.getByTestId("rankings-composite-chart")).toBeInTheDocument();
    for (const key of [
      "statistical_impact",
      "traditional_production",
      "individual_recognition",
      "postseason_individual_value",
      "team_achievement",
      "data_completeness",
    ]) {
      expect(screen.getByTestId(`rk-chart-label-${key}`)).toBeInTheDocument();
      expect(screen.getByTestId(`rk-chart-point-${key}`)).toBeInTheDocument();
    }
  });

  it("gives the identical values as an accessible table, always", () => {
    // NOT a fallback and NOT behind a disclosure. A radar is good at shape and
    // bad at exact values; the table is where the values live for everybody.
    renderDetail();
    const table = screen.getByTestId("rk-detail-table");
    expect(within(table).getByRole("row", { name: /Statistical Impact/i })).toHaveTextContent(
      "99",
    );
    expect(screen.getByTestId("rk-detail-row-data_completeness")).toHaveTextContent("100");
    expect(table.querySelector("caption")).toHaveTextContent(/percentile against every peak window/);
  });

  it("exposes each exact value to keyboard focus", async () => {
    renderDetail();
    const key = screen.getByTestId("rk-chart-key-postseason_individual_value");
    await userEvent.click(key);
    expect(key).toHaveTextContent("97");
    // Every axis is a real button, so tabbing reaches all six.
    expect(screen.getAllByRole("button", { name: /out of 100/ })).toHaveLength(6);
  });

  it("explains rather than draws when a board has no components", () => {
    renderDetail({ percentiles: null });
    expect(screen.getByTestId("rk-detail-no-components")).toHaveTextContent(
      /does not publish component percentiles/,
    );
    expect(screen.queryByTestId("rankings-composite-chart")).toBeNull();
  });

  it("prompts a selection rather than rendering an empty chart", () => {
    renderDetail(null);
    expect(screen.getByTestId("rankings-detail")).toHaveTextContent(
      "Select a row to see its component profile.",
    );
  });
});
