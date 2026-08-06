/**
 * The unified player analysis: one drawer carrying the chart AND the derivation.
 *
 * WHAT THIS FILE REPLACES. It was `score-explain-modal.test.tsx`, and its
 * subject was a second dialog opened from a one-character `ƒ` cell in every
 * ranking row. That modal is gone: its contents are `ScoreDerivation`'s
 * sections, rendered inside `RankingsAnalysis` behind three disclosures, so
 * every assertion below now runs against the drawer a row click opens. The
 * substance of the assertions is deliberately unchanged — the derivation moved,
 * it did not shrink, and a test that quietly dropped half of it while the
 * component was being restructured would be the easiest way to lose it.
 *
 * The fixture is Kobe Bryant 2007-08 as the generated artifact actually
 * publishes it — the audited case where 2005-06 wins the regular-season
 * comparison but 2007-08 ranks higher, because postseason + recognition + team
 * achievement are 41% of the weight vector.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import RankingsAnalysis from "@/components/rankings/RankingsAnalysis";
import type { RankingExplain, RankingRow } from "@/types";

const KOBE_ROW: RankingRow = {
  rank: 73,
  row_id: "kobe-bryant-1yr-200708",
  player_slug: "kobe-bryant",
  player_name: "Kobe Bryant",
  label: "2007-08",
  team: "LAL",
  prime_score: 84.14,
  prime_index: 54.48,
  components: {
    statistical_impact: 22.8,
    traditional_production: 9.03,
    individual_recognition: 14.78,
    postseason_individual_value: 5.86,
    team_achievement: 1.97,
  },
  percentiles: {
    total: 92.7,
    statistical_impact: 71.4,
    traditional_production: 68.2,
    individual_recognition: 97.1,
    postseason_individual_value: 88.6,
    team_achievement: 79.3,
  },
  mpg: 38.9,
  data_completeness: "complete",
  headshot_url: null,
  season_in_progress: false,
};

const KOBE_EXPLAIN: RankingExplain = {
  ...KOBE_ROW,
  window_type: "single_season",
  seasons_in_window: ["2007-08"],
  // Deliberately NOT the real 0.38/0.21/0.20/0.18/0.03 vector. If the drawer
  // renders these values it proves the weights came from the payload rather
  // than a hardcoded TS constant — an explicit project rule.
  weights: {
    statistical_impact: 0.41,
    traditional_production: 0.19,
    individual_recognition: 0.17,
    postseason_individual_value: 0.16,
    team_achievement: 0.07,
  },
  teammate_adjustment: 0.05,
  score_split: {
    regular_season: 31.83,
    postseason: 5.86,
    recognition: 14.78,
    team: 1.97,
  },
  strongest_components: ["individual_recognition", "postseason_individual_value"],
  weakest_components: ["traditional_production", "statistical_impact"],
  season_stats: {
    games: 82,
    mpg: 38.9,
    ppg: null,
    rpg: null,
    apg: null,
    ts_pct: 0.576,
    per: 24.2,
    bpm: 5.8,
    ws: 13.8,
  },
  recognition: {
    awards: "MVP-1,AS,NBA1,DEF1",
    mvp_vote_share: 0.873,
    dpoy_vote_share: null,
  },
  postseason: { games: 21, minutes: 863, series_count: 4 },
  team_context: { finals_appearance: 1, made_playoffs: 1, championship: 0 },
  role_and_sample: { role: "Primary offensive engine", minutes_total: 3192, games_played: 82 },
  comparisons: {
    same_player: [
      {
        row_id: "kobe-bryant-1yr-200506",
        player_name: "Kobe Bryant",
        label: "2005-06",
        prime_score: 80.59,
        rank: 107,
        delta: -3.55,
      },
    ],
    similar_scores: [
      {
        row_id: "dwyane-wade-1yr-200809",
        player_name: "Dwyane Wade",
        label: "2008-09",
        prime_score: 84.02,
        rank: 74,
        delta: -0.12,
      },
    ],
    same_season_peers: [
      {
        row_id: "chris-paul-1yr-200708",
        player_name: "Chris Paul",
        label: "2007-08",
        prime_score: 88.08,
        rank: 41,
        delta: 3.94,
      },
    ],
  },
  caveats: ["Seasons under 25 minutes per game are not served on this board."],
  model_version: "peak3_v1",
  // Kobe 2007-08 is the real case: it beat his 2008-09 title season by 0.20,
  // which is exactly the "why is THAT the one?" question this block answers.
  anchor_selection: {
    basis: "highest-scoring single season",
    nearby_iconic_seasons: [
      {
        season: "2008-09",
        prime_score: 83.94,
        margin: 0.2,
        markers: ["champion", "Finals MVP"],
      },
    ],
  },
};

type Props = React.ComponentProps<typeof RankingsAnalysis>;

function fetcher(explain: RankingExplain = KOBE_EXPLAIN): Props["fetchExplain"] {
  return vi.fn(async () => explain);
}

function renderAnalysis(overrides: Partial<Props> = {}) {
  const props: Props = {
    row: KOBE_ROW,
    board: "seasons",
    boardLabel: "Single Seasons",
    windowLabel: null,
    populationNoun: "scored season",
    populationNounPlural: "scored seasons",
    boardRowCount: 1000,
    methodology: null,
    onClose: vi.fn(),
    onNavigate: vi.fn(),
    hasPrevious: true,
    hasNext: true,
    fetchExplain: fetcher(),
    ...overrides,
  };
  return { ...render(<RankingsAnalysis {...props} />), props };
}

describe("the drawer — open, close, and there is only one of it", () => {
  it("mounts nothing at all when no row is selected", () => {
    // Not merely hidden: unmounted, so axe never scans dialog markup while the
    // analysis is closed, and no explain request is made.
    const { container } = renderAnalysis({ row: null });
    expect(container).toBeEmptyDOMElement();
  });

  it("opens as an accessibly-named dialog", async () => {
    renderAnalysis();
    const dialog = await screen.findByTestId("rankings-analysis");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(
      dialog.getAttribute("aria-label") ?? dialog.getAttribute("aria-labelledby"),
    ).toBeTruthy();
  });

  it("is the ONLY dialog: there is no separate derivation modal", async () => {
    renderAnalysis();
    await screen.findByTestId("rankings-analysis");
    expect(screen.queryByTestId("score-explain-modal")).toBeNull();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    renderAnalysis({ onClose });
    await screen.findByTestId("rankings-analysis");
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes via the visible close button", async () => {
    const onClose = vi.fn();
    renderAnalysis({ onClose });
    await userEvent.click(await screen.findByTestId("rankings-analysis-close"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("the first view stays the player", () => {
  it("leads with the approved summary: name, rank, season, team, score and the chart", async () => {
    renderAnalysis();
    const panel = await screen.findByTestId("rankings-analysis");
    const summary = within(panel).getByTestId("rankings-detail");
    expect(within(summary).getByTestId("rk-detail-name")).toHaveTextContent("Kobe Bryant");
    expect(summary).toHaveTextContent("#73");
    expect(summary).toHaveTextContent("2007-08");
    expect(summary).toHaveTextContent("LAL");
    expect(summary).toHaveTextContent("84.14");
    expect(within(summary).getByTestId("rankings-composite-chart")).toBeInTheDocument();
    expect(within(summary).getByTestId("rk-detail-table")).toBeInTheDocument();
  });

  it("puts every disclosure BELOW the summary, and closed", async () => {
    renderAnalysis();
    const panel = await screen.findByTestId("rankings-analysis");
    const summary = within(panel).getByTestId("rankings-detail");
    for (const id of ["rk-fold-breakdown", "rk-fold-calculation", "rk-fold-source"]) {
      const fold = within(panel).getByTestId(id);
      expect(fold, `${id} must start closed`).not.toHaveAttribute("open");
      // `compareDocumentPosition` — the derivation follows the player, which is
      // the whole of "do not force the entire derivation above the fold".
      expect(
        summary.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("names the three disclosures the brief asks for", async () => {
    renderAnalysis();
    const panel = await screen.findByTestId("rankings-analysis");
    expect(panel).toHaveTextContent("Score breakdown");
    expect(panel).toHaveTextContent("How this score was calculated");
    expect(panel).toHaveTextContent("Source window");
  });

  it("opens a disclosure on click, and it is native so it needs no handler", async () => {
    renderAnalysis();
    const fold = (await screen.findByTestId("rk-fold-calculation")) as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    await userEvent.click(within(fold).getByText("How this score was calculated"));
    expect(fold.open).toBe(true);
  });

  it("keeps the drawer free of a control that only scrolls you down the drawer", async () => {
    // `rk-detail-explain` opened the modal. With the derivation directly below,
    // a button that jumps three hundred pixels is worse than the heading.
    renderAnalysis();
    await screen.findByTestId("rankings-analysis");
    expect(screen.queryByTestId("rk-detail-explain")).toBeNull();
  });
});

describe("the derivation renders the values the API supplied", () => {
  it("renders a value AND a percentile for all five components", async () => {
    renderAnalysis();
    await screen.findByTestId("rankings-analysis");
    const expected: [string, string, string][] = [
      ["statistical_impact", "22.80", "71st"],
      ["traditional_production", "9.03", "68th"],
      ["individual_recognition", "14.78", "97th"],
      ["postseason_individual_value", "5.86", "89th"],
      ["team_achievement", "1.97", "79th"],
    ];
    for (const [key, value, percentile] of expected) {
      const card = await screen.findByTestId(`score-explain-component-${key}`);
      expect(card, `${key} value`).toHaveTextContent(value);
      expect(card, `${key} percentile`).toHaveTextContent(percentile);
    }
  });

  it("takes the official weights from the payload, never from a TS constant", async () => {
    renderAnalysis();
    const panel = await screen.findByTestId("rankings-analysis");
    // 41% is not the real SI weight (38%). Seeing it proves the payload is read.
    await waitFor(() => expect(panel).toHaveTextContent("41"));
  });

  it("puts the regular-season total beside the postseason, recognition and team terms", async () => {
    renderAnalysis();
    const split = await screen.findByTestId("score-explain-split");
    expect(split).toHaveTextContent("31.83");
    expect(split).toHaveTextContent("14.78");
    expect(split).toHaveTextContent("5.86");
  });

  it("writes a plain-English summary from the real strongest/weakest components", async () => {
    renderAnalysis();
    const summary = await screen.findByTestId("score-explain-summary");
    expect(summary.textContent ?? "").toMatch(/recognition/i);
    expect((summary.textContent ?? "").length).toBeGreaterThan(40);
  });

  it("shows role and awards when the payload has them", async () => {
    renderAnalysis();
    const panel = await screen.findByTestId("rankings-analysis");
    await waitFor(() => expect(panel).toHaveTextContent(/Primary offensive engine/i));
    expect(panel).toHaveTextContent(/MVP/);
  });

  it("surfaces caveats rather than hiding them", async () => {
    renderAnalysis();
    const caveats = await screen.findByTestId("score-explain-caveats");
    expect(caveats).toHaveTextContent(/25 minutes per game/i);
  });
});

/**
 * THE ARITHMETIC. New in this pass, and the reason the two surfaces could not
 * simply be stacked: the old modal published contributions, weights and
 * percentiles in three separate places and never once wrote the sum down, so
 * "how the total was built" was left to the reader.
 */
describe("the arithmetic", () => {
  it("shows percentile, component score, weight and contribution per component", async () => {
    renderAnalysis();
    const table = await screen.findByTestId("rk-formula-table");
    const si = within(table).getByTestId("rk-formula-row-statistical_impact");
    expect(si).toHaveTextContent("71"); // percentile
    expect(si).toHaveTextContent("55.61"); // 22.80 / 0.41, the pre-weight score
    expect(si).toHaveTextContent("41%"); // the payload's weight
    expect(si).toHaveTextContent("22.80"); // the published contribution
  });

  it("ends in the published raw index and the calibrated score", async () => {
    renderAnalysis();
    const table = await screen.findByTestId("rk-formula-table");
    // 22.80 + 9.03 + 14.78 + 5.86 + 1.97
    expect(within(table).getByTestId("rk-formula-sum")).toHaveTextContent("54.44");
    expect(within(table).getByTestId("rk-formula-teammate")).toHaveTextContent("+0.050");
    expect(within(table).getByTestId("rk-formula-index")).toHaveTextContent("54.48");
    expect(within(table).getByTestId("rk-formula-total")).toHaveTextContent("84.14");
  });

  it("says the calibration is a remap and not a further sum", async () => {
    // The one place a reader could conclude the model is doing arithmetic it is
    // not: `calibrate_score` is monotonic, so it changes spacing and never order.
    renderAnalysis();
    const section = await screen.findByTestId("score-explain-arithmetic");
    expect(section).toHaveTextContent(/monotonic/i);
    expect(section).toHaveTextContent(/calibrate_score/);
  });

  it("omits a weight it was never given rather than inventing one", async () => {
    renderAnalysis({ fetchExplain: fetcher({ ...KOBE_EXPLAIN, weights: {} }) });
    const table = await screen.findByTestId("rk-formula-table");
    const si = within(table).getByTestId("rk-formula-row-statistical_impact");
    expect(si).toHaveTextContent("22.80");
    expect(si).not.toHaveTextContent("38%");
    expect(si).not.toHaveTextContent("41%");
  });
});

describe("the interactive component breakdown", () => {
  it("renders the stacked bar with a focusable segment per component", async () => {
    renderAnalysis();
    const bar = await screen.findByTestId("component-breakdown");
    // Real buttons, not divs with click handlers — keyboard operable.
    expect(bar.querySelectorAll("button").length).toBeGreaterThanOrEqual(5);
  });

  it("updates the detail panel when a different segment is activated", async () => {
    renderAnalysis();
    const bar = await screen.findByTestId("component-breakdown");
    const segments = Array.from(bar.querySelectorAll("button"));

    await userEvent.click(segments[0]);
    const first = (await screen.findByTestId("component-detail")).textContent ?? "";

    await userEvent.click(segments[segments.length - 1]);
    await waitFor(async () => {
      const next = (await screen.findByTestId("component-detail")).textContent ?? "";
      expect(next).not.toBe(first);
    });
  });

  it("explains why the player did well or poorly on the selected component", async () => {
    renderAnalysis();
    const bar = await screen.findByTestId("component-breakdown");
    await userEvent.click(bar.querySelectorAll("button")[0]);
    const why = await screen.findByTestId("component-detail-why");
    expect((why.textContent ?? "").length).toBeGreaterThan(20);
  });
});

describe("previous / next, and the pivot", () => {
  it("steps to the adjacent ranked player through the drawer's own controls", async () => {
    const onNavigate = vi.fn();
    renderAnalysis({ onNavigate });
    await userEvent.click(await screen.findByTestId("rankings-analysis-next"));
    expect(onNavigate).toHaveBeenCalledWith(1);
    await userEvent.click(screen.getByTestId("rankings-analysis-prev"));
    expect(onNavigate).toHaveBeenCalledWith(-1);
  });

  it("refetches the derivation when the page hands it a different row", async () => {
    const fetchExplain = vi.fn(async () => KOBE_EXPLAIN);
    const { rerender, props } = renderAnalysis({
      fetchExplain: fetchExplain as unknown as Props["fetchExplain"],
    });
    await waitFor(() =>
      expect(fetchExplain).toHaveBeenCalledWith("seasons", "kobe-bryant-1yr-200708"),
    );
    rerender(
      <RankingsAnalysis
        {...props}
        fetchExplain={fetchExplain as unknown as Props["fetchExplain"]}
        row={{ ...KOBE_ROW, row_id: "chris-paul-1yr-200708", player_name: "Chris Paul" }}
      />,
    );
    await waitFor(() =>
      expect(fetchExplain).toHaveBeenCalledWith("seasons", "chris-paul-1yr-200708"),
    );
  });

  it("renders all three comparison rails from real payload entries", async () => {
    renderAnalysis();
    const block = await screen.findByTestId("score-explain-comparisons");
    // The audited pair: Kobe's own 2005-06 must be reachable from 2007-08.
    expect(block).toHaveTextContent("2005-06");
    expect(block).toHaveTextContent("Dwyane Wade");
    expect(block).toHaveTextContent("Chris Paul");
  });

  it("pivots to a compared row without closing, and offers a way back", async () => {
    const other: RankingExplain = {
      ...KOBE_EXPLAIN,
      row_id: "kobe-bryant-1yr-200506",
      label: "2005-06",
      rank: 107,
      prime_score: 80.59,
    };
    const fetchExplain = vi.fn(async (_board: unknown, rowId: string) =>
      rowId === "kobe-bryant-1yr-200506" ? other : KOBE_EXPLAIN,
    );
    const onClose = vi.fn();
    renderAnalysis({
      fetchExplain: fetchExplain as unknown as Props["fetchExplain"],
      onClose,
    });

    const block = await screen.findByTestId("score-explain-comparisons");
    const pivot = Array.from(block.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("2005-06"),
    );
    expect(pivot, "a comparison entry must be actionable").toBeTruthy();
    await userEvent.click(pivot!);

    await waitFor(() =>
      expect(fetchExplain).toHaveBeenCalledWith("seasons", "kobe-bryant-1yr-200506"),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByTestId("rankings-analysis-back")).toBeInTheDocument();
    // "Next ranked player" is a fact about the board list, and the pivoted row
    // is not on it — so the controls stand down rather than lying.
    expect(screen.getByTestId("rankings-analysis-next")).toBeDisabled();
    await waitFor(() =>
      expect(screen.getByTestId("rk-detail-name")).toHaveTextContent("Kobe Bryant"),
    );
  });
});

describe("unavailable states stay compact and honest", () => {
  it("omits context sections entirely rather than printing empty blocks", async () => {
    renderAnalysis({
      fetchExplain: fetcher({
        ...KOBE_EXPLAIN,
        season_stats: null,
        recognition: null,
        postseason: null,
        team_context: null,
        role_and_sample: null,
      }),
    });
    const panel = await screen.findByTestId("rankings-analysis");
    await waitFor(() => expect(panel).toHaveTextContent("Kobe Bryant"));

    // The complaint this pass exists to fix: a surface that is mostly "not
    // available". At most one such line may appear.
    const notAvailable = (panel.textContent ?? "").match(/not available/gi) ?? [];
    expect(notAvailable.length).toBeLessThanOrEqual(1);
  });

  it("renders a dash rather than a fabricated zero for a null figure", async () => {
    renderAnalysis();
    const panel = await screen.findByTestId("rankings-analysis");
    await waitFor(() => expect(panel).toHaveTextContent("Kobe Bryant"));
    // ppg/rpg/apg are genuinely null in the artifact (the parquet stores
    // per-75/per-100 only), so a dash is the honest rendering — never 0.0.
    expect(panel.textContent ?? "").toContain("—");
  });

  it("surfaces a failed explain fetch without emptying the drawer", async () => {
    renderAnalysis({
      fetchExplain: vi.fn(async () => {
        throw new Error("boom");
      }) as unknown as Props["fetchExplain"],
    });
    const panel = await screen.findByTestId("rankings-analysis");
    // The row's own components came with the table, so the reader is never left
    // looking at a blank drawer: the chart and the exact values still render.
    await waitFor(() => expect(panel).toHaveTextContent("Kobe Bryant"));
    expect(within(panel).getByTestId("rankings-composite-chart")).toBeInTheDocument();
    expect(panel).toHaveTextContent("22.8");
  });
});

/**
 * "Why this season?"
 *
 * The 1Y board publishes each player's highest-scoring single season, so a
 * player's famous title year can be absent — LeBron's 2008-09 edged his 2012-13
 * by 0.16, Kobe's 2007-08 beat 2008-09 by 0.20. Readers read that absence as a
 * bug. The panel states the rule and shows what it narrowly beat.
 *
 * The load-bearing property is that this EXPLAINS the choice without changing
 * it: no title season is promoted to the anchor.
 */
describe("why this season", () => {
  it("states the rule the board actually used", async () => {
    renderAnalysis();
    const panel = await screen.findByTestId("score-explain-anchor-selection");
    expect(panel).toHaveTextContent(/highest-scoring single season/i);
  });

  it("names the iconic season it narrowly beat, with the margin", async () => {
    renderAnalysis();
    const entry = await screen.findByTestId("score-explain-nearby-2008-09");
    expect(entry).toHaveTextContent("2008-09");
    expect(entry).toHaveTextContent("0.20");
    expect(entry).toHaveTextContent(/champion/i);
    expect(entry).toHaveTextContent(/Finals MVP/i);
  });

  it("shows the beaten season's score below the anchor's, never above", async () => {
    renderAnalysis();
    const entry = await screen.findByTestId("score-explain-nearby-2008-09");
    // 83.94 lost to the anchor; if this ever rendered higher than the row's own
    // score the panel would be arguing the board is wrong.
    expect(entry).toHaveTextContent("83.9");
  });

  it("renders nothing when the row has no close iconic season", async () => {
    // Most rows are like this. An empty section would be worse than no section.
    renderAnalysis({
      fetchExplain: fetcher({
        ...KOBE_EXPLAIN,
        anchor_selection: {
          basis: "highest-scoring single season",
          nearby_iconic_seasons: [],
        },
      }),
    });
    await screen.findByTestId("rankings-analysis");
    expect(screen.queryByTestId("score-explain-anchor-selection")).toBeNull();
  });

  it("renders nothing when the API omits the block entirely", async () => {
    renderAnalysis({ fetchExplain: fetcher({ ...KOBE_EXPLAIN, anchor_selection: null }) });
    await screen.findByTestId("rankings-analysis");
    expect(screen.queryByTestId("score-explain-anchor-selection")).toBeNull();
  });
});
