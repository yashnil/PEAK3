/**
 * Phase 10B: ScoreExplainModal against the two-board rankings contract.
 *
 * This replaces the Phase 9C suite wholesale. That suite was written for a
 * three-board world with a `ScoreExplainSubject` prop and a "canonical" board
 * whose rows published contributions but neither weights nor percentiles. Both
 * concepts are gone: the modal now takes a `RankingRow` plus a board id, and
 * every served board carries the full component contract. Keeping the old
 * assertions would have meant testing a contract the product no longer has.
 *
 * The fixture is Kobe Bryant 2007-08 as the generated artifact actually
 * publishes it — the audited case where 2005-06 wins the regular-season
 * comparison but 2007-08 ranks higher, because postseason + recognition +
 * team achievement are 41% of the weight vector. Making that legible is the
 * whole point of the modal, so it is the right thing to test against.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import ScoreExplainModal from "@/components/rankings/ScoreExplainModal";
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
  // Deliberately NOT the real 0.38/0.21/0.20/0.18/0.03 vector. If the modal
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
};

type ModalProps = React.ComponentProps<typeof ScoreExplainModal>;

function fetcher(explain: RankingExplain = KOBE_EXPLAIN): ModalProps["fetchExplain"] {
  return vi.fn(async () => explain);
}

function renderModal(overrides: Partial<ModalProps> = {}) {
  const props: ModalProps = {
    row: KOBE_ROW,
    board: "seasons",
    boardLabel: "Single Seasons",
    boardRowCount: 1000,
    populationNoun: "scored seasons",
    methodology: null,
    onClose: vi.fn(),
    fetchExplain: fetcher(),
    ...overrides,
  };
  return { ...render(<ScoreExplainModal {...props} />), props };
}

describe("ScoreExplainModal — open and close", () => {
  it("mounts nothing at all when no row is selected", () => {
    // Not merely hidden: unmounted, so axe never scans dialog markup while the
    // modal is closed.
    const { container } = renderModal({ row: null });
    expect(container).toBeEmptyDOMElement();
  });

  it("opens as an accessibly-named dialog", async () => {
    renderModal();
    const dialog = await screen.findByTestId("score-explain-modal");
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(
      dialog.getAttribute("aria-label") ?? dialog.getAttribute("aria-labelledby"),
    ).toBeTruthy();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    await screen.findByTestId("score-explain-modal");
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes via the visible close button", async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    await userEvent.click(await screen.findByTestId("score-explain-close"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("ScoreExplainModal — renders the values the API supplied", () => {
  it("shows the player, season and score from the row", async () => {
    renderModal();
    const dialog = await screen.findByTestId("score-explain-modal");
    expect(dialog).toHaveTextContent("Kobe Bryant");
    expect(dialog).toHaveTextContent("2007-08");
    expect(dialog).toHaveTextContent("84.1");
  });

  it("renders a value AND a percentile for all five components", async () => {
    renderModal();
    await screen.findByTestId("score-explain-modal");
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
    renderModal();
    const dialog = await screen.findByTestId("score-explain-modal");
    // 41% is not the real SI weight (38%). Seeing it proves the modal reads the
    // payload it was handed.
    await waitFor(() => expect(dialog).toHaveTextContent("41"));
  });

  it("puts the regular-season total beside the postseason, recognition and team terms", async () => {
    renderModal();
    const split = await screen.findByTestId("score-explain-split");
    expect(split).toHaveTextContent("31.83");
    expect(split).toHaveTextContent("14.78");
    expect(split).toHaveTextContent("5.86");
  });

  it("writes a plain-English summary from the real strongest/weakest components", async () => {
    renderModal();
    const summary = await screen.findByTestId("score-explain-summary");
    // The audited Kobe finding: recognition and postseason are what carry it.
    expect(summary.textContent ?? "").toMatch(/recognition/i);
    expect((summary.textContent ?? "").length).toBeGreaterThan(40);
  });

  it("shows role and awards when the payload has them", async () => {
    renderModal();
    const dialog = await screen.findByTestId("score-explain-modal");
    await waitFor(() => expect(dialog).toHaveTextContent(/Primary offensive engine/i));
    expect(dialog).toHaveTextContent(/MVP/);
  });

  it("surfaces caveats rather than hiding them", async () => {
    renderModal();
    const caveats = await screen.findByTestId("score-explain-caveats");
    expect(caveats).toHaveTextContent(/25 minutes per game/i);
  });
});

describe("ScoreExplainModal — interactive component breakdown", () => {
  it("renders the stacked bar with a focusable segment per component", async () => {
    renderModal();
    const bar = await screen.findByTestId("component-breakdown");
    // Real buttons, not divs with click handlers — keyboard operable.
    expect(bar.querySelectorAll("button").length).toBeGreaterThanOrEqual(5);
  });

  it("updates the detail panel when a different segment is activated", async () => {
    renderModal();
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
    renderModal();
    const bar = await screen.findByTestId("component-breakdown");
    await userEvent.click(bar.querySelectorAll("button")[0]);
    const why = await screen.findByTestId("component-detail-why");
    expect((why.textContent ?? "").length).toBeGreaterThan(20);
  });
});

describe("ScoreExplainModal — comparisons", () => {
  it("renders all three comparison rails from real payload entries", async () => {
    renderModal();
    const block = await screen.findByTestId("score-explain-comparisons");
    // The audited pair: Kobe's own 2005-06 must be reachable from 2007-08.
    expect(block).toHaveTextContent("2005-06");
    expect(block).toHaveTextContent("Dwyane Wade");
    expect(block).toHaveTextContent("Chris Paul");
  });

  it("pivots the modal to a compared row without closing it", async () => {
    const other: RankingExplain = {
      ...KOBE_EXPLAIN,
      row_id: "kobe-bryant-1yr-200506",
      label: "2005-06",
      rank: 107,
      prime_score: 80.59,
    };
    const fetchExplain = vi
      .fn(async (_board: unknown, rowId: string) =>
        rowId === "kobe-bryant-1yr-200506" ? other : KOBE_EXPLAIN,
      );
    const onClose = vi.fn();
    renderModal({ fetchExplain: fetchExplain as unknown as ModalProps["fetchExplain"], onClose });

    const block = await screen.findByTestId("score-explain-comparisons");
    const pivot = Array.from(block.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("2005-06"),
    );
    expect(pivot, "a comparison entry must be actionable").toBeTruthy();
    await userEvent.click(pivot!);

    // Still open, now showing the other season, with a way back.
    await waitFor(() =>
      expect(fetchExplain).toHaveBeenCalledWith("seasons", "kobe-bryant-1yr-200506"),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByTestId("score-explain-modal")).toBeInTheDocument();
    expect(await screen.findByTestId("score-explain-back")).toBeInTheDocument();
  });
});

describe("ScoreExplainModal — unavailable states stay compact and honest", () => {
  it("omits context sections entirely rather than printing empty blocks", async () => {
    renderModal({
      fetchExplain: fetcher({
        ...KOBE_EXPLAIN,
        season_stats: null,
        recognition: null,
        postseason: null,
        team_context: null,
        role_and_sample: null,
      }),
    });
    const dialog = await screen.findByTestId("score-explain-modal");
    await waitFor(() => expect(dialog).toHaveTextContent("Kobe Bryant"));

    // The complaint this pass exists to fix: a modal that is mostly "not
    // available". At most one such line may appear.
    const notAvailable = (dialog.textContent ?? "").match(/not available/gi) ?? [];
    expect(notAvailable.length).toBeLessThanOrEqual(1);
  });

  it("renders a dash rather than a fabricated zero for a null figure", async () => {
    renderModal();
    const dialog = await screen.findByTestId("score-explain-modal");
    await waitFor(() => expect(dialog).toHaveTextContent("Kobe Bryant"));
    // ppg/rpg/apg are genuinely null in the artifact (the parquet stores
    // per-75/per-100 only), so a dash is the honest rendering — never 0.0.
    expect(dialog.textContent ?? "").toContain("—");
  });

  it("surfaces a failed explain fetch without emptying the modal", async () => {
    renderModal({
      fetchExplain: vi.fn(async () => {
        throw new Error("boom");
      }) as unknown as ModalProps["fetchExplain"],
    });
    const dialog = await screen.findByTestId("score-explain-modal");
    // The row's own components came with the table, so the user is never left
    // looking at a blank modal.
    await waitFor(() => expect(dialog).toHaveTextContent("Kobe Bryant"));
    expect(dialog).toHaveTextContent("22.8");
  });
});
