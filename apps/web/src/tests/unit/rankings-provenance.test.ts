/**
 * Rankings terminology + provenance copy contract.
 *
 * WHAT THIS GUARDS. Two failures that the rest of the suite could not see:
 *
 * 1. THE CONTRADICTION. The page presented the "1-Year" Peak Windows board and
 *    the "Single Seasons" board as answering "genuinely different questions",
 *    and rendered the header "1-Year Peak Windows" directly beside a tab named
 *    "Single Seasons". At n=1 a peak window IS a single season: both generated
 *    artifacts return the same rank-1 and rank-2 rows with identical row_ids
 *    (michael-jordan-1yr-199091 at 97.53, lebron-james-1yr-200809 at 95.85).
 *    The only real difference is player de-duplication. Copy asserted here;
 *    the underlying data claim is asserted server-side by
 *    apps/api/tests/test_regression.py
 *    ::test_the_two_boards_differ_only_by_deduplication_at_one_year.
 *
 * 2. THE BANNED VOCABULARY. Several phrases are retired product-wide because
 *    they were factually wrong on this surface ("(in progress)" on a finished
 *    season) or name a board that no longer exists ("Canonical Players").
 *    e2e catches them only on the rows that happen to render; a copy-level
 *    check catches them in every board/window combination at once, without a
 *    browser.
 *
 * These are pure-function assertions on purpose: rendered-markup tests fail for
 * a dozen reasons that are not about the words, so the words get their own
 * test.
 */

import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  boardHeadingFor,
  boardShortLabelFor,
  explainerFor,
  type PeakWindowId,
} from "@/components/rankings/board-copy";
import RankingsProvenance from "@/components/rankings/RankingsProvenance";
import type { RankingBoardId, RankingBoardMeta } from "@/types";

const WINDOWS: PeakWindowId[] = ["1y", "2y", "3y", "5y"];
const BOARDS: RankingBoardId[] = ["peakWindows", "seasons"];

/** Every string a reader can see from these helpers, in every combination. */
function allCopy(): string[] {
  const out: string[] = [];
  for (const board of BOARDS) {
    for (const window of WINDOWS) {
      out.push(
        explainerFor(board, window),
        boardHeadingFor(board, window),
        boardShortLabelFor(board, window),
      );
    }
  }
  return out;
}

describe("rankings board terminology", () => {
  it("names the 1-Year board by what it is: the best single season, de-duplicated", () => {
    expect(boardHeadingFor("peakWindows", "1y")).toBe(
      "Best single season (one row per player)",
    );
    const explainer = explainerFor("peakWindows", "1y");
    expect(explainer).toMatch(/best single season/i);
    expect(explainer).toMatch(/one row per player/i);
  });

  it("names the Single Seasons board as every qualifying season", () => {
    expect(boardHeadingFor("seasons", "1y")).toBe("Every qualifying season");
    expect(explainerFor("seasons", "1y")).toMatch(/every qualifying season/i);
  });

  it("states plainly that at 1-Year the two boards differ only by de-duplication", () => {
    // The whole point of the fix. If this sentence ever disappears, the page is
    // back to implying a difference of question where there is only a
    // difference of grouping.
    const explainer = explainerFor("peakWindows", "1y");
    expect(explainer).toMatch(/de-duplication is the only difference/i);
    expect(explainer).toMatch(/single seasons board/i);
  });

  it("never puts two different names for the same concept side by side", () => {
    // The observed defect: header "1-Year Peak Windows" next to tab "Single
    // Seasons". The heading must not reintroduce the window-duration phrasing
    // that the tab strip already owns.
    for (const window of WINDOWS) {
      const heading = boardHeadingFor("peakWindows", window);
      expect(heading).not.toMatch(/peak windows/i);
      expect(heading).not.toMatch(/\d[-\s]?year/i);
    }
  });

  it("keeps the 3Y/5Y boards described as genuinely different questions", () => {
    // The contradiction was specific to n=1. At 3Y and 5Y the boards really do
    // ask different things, and flattening all three into one apologetic blurb
    // would be the opposite error.
    for (const window of ["3y", "5y"] as PeakWindowId[]) {
      const explainer = explainerFor("peakWindows", window);
      expect(explainer).toMatch(/consecutive seasons/i);
      expect(explainer).toMatch(/one row per player/i);
      expect(explainer).not.toMatch(/de-duplication is the only difference/i);
    }
    expect(boardHeadingFor("peakWindows", "3y")).toBe(
      "Best 3-season stretch (one row per player)",
    );
    expect(boardHeadingFor("peakWindows", "5y")).toBe(
      "Best 5-season stretch (one row per player)",
    );
  });

  it("gives the modal a short label that reads inside a sentence", () => {
    // Rendered as "#1 on the {label} board", so the parenthetical page heading
    // would stutter there.
    expect(boardShortLabelFor("peakWindows", "1y")).toBe("Best Single Season");
    expect(boardShortLabelFor("seasons", "1y")).toBe("Every Qualifying Season");
    for (const board of BOARDS) {
      for (const window of WINDOWS) {
        expect(boardShortLabelFor(board, window)).not.toMatch(/[()]/);
      }
    }
  });

  it("describes the seasons board identically regardless of the window selector", () => {
    // The duration selector is hidden on the seasons board, so its copy must
    // not depend on a control the reader cannot see.
    const [first, ...rest] = WINDOWS.map((w) => explainerFor("seasons", w));
    for (const other of rest) expect(other).toBe(first);
  });
});

describe("rankings retired vocabulary", () => {
  // Every phrase here is banned on /rankings by the pass's frozen invariants.
  const BANNED = [
    "(in progress)",
    "still being played",
    "provisional",
    "Canonical Players",
    "Postseason Value",
    "Team Achievement",
    "preview",
  ];

  it("uses none of the retired phrases in any board/window combination", () => {
    for (const copy of allCopy()) {
      for (const phrase of BANNED) {
        expect(copy.toLowerCase()).not.toContain(phrase.toLowerCase());
      }
    }
  });

  it("produces non-empty copy for every combination", () => {
    // A silently-empty explainer would pass every "does not contain" check
    // above while telling the reader nothing.
    for (const copy of allCopy()) {
      expect(copy.trim().length).toBeGreaterThan(10);
    }
  });
});

/**
 * The provenance panel itself.
 *
 * Rendered with `createElement` rather than JSX so this file can keep the `.ts`
 * extension the pass assigned it. The values below are copied verbatim from the
 * committed artifact (`top_1000_peaks.v1.json`), not invented, so a shape change
 * upstream surfaces here rather than in a browser.
 */
const REAL_META: RankingBoardMeta = {
  dataset_version: "top_1000_peaks.v1",
  formula_version:
    "peak3_official_weights_v1 (statistical_impact=0.38, traditional_production=0.21, " +
    "recognition=0.20, postseason=0.18, team_achievement=0.03)",
  model_version: "peak3_v1",
  model_label: "PEAK3 v1",
  is_default_model: true,
  supported_start_season: "1979-80",
  supported_end_season: "2025-26",
  total_available: 1000,
  universe_identity_count: 2016,
  serving_gate_note:
    "Windows whose anchor season is under 25.0 minutes per game are not published on this " +
    "board. They are still fully scored -- this is a display gate on sample size, not a " +
    "scoring change, and it never reorders the windows it keeps.",
  effective_tie_threshold: null,
  min_season_mpg: null,
  // The API sends the SHA-256 of the artifact the serving process actually
  // loaded, which is what makes the never-invalidated `_CACHE` in peaks.py
  // detectable from the page rather than only from the filesystem.
  artifact_digest: "1f3d9c0b6a7e4d2c8b5a09f7e6d4c3b2a1908f7e6d5c4b3a2918070605040302",
  // Routinely null: `build_top_peaks.py` does not yet write a `generated_at`,
  // and it is deliberately NOT back-filled from a file mtime -- mtime skew is
  // precisely what produced the false "the rankings are stale" report that
  // started this pass. See docs/implementation/RANKINGS_SYNC_REPORT.md.
  generated_at: null,
};

describe("RankingsProvenance", () => {
  it("names the scoring model, the coverage and the release", () => {
    render(createElement(RankingsProvenance, { meta: REAL_META, fallbackRowCount: 50 }));

    // Frozen testids — enhanced in place, never replaced.
    expect(screen.getByTestId("rankings-model-version")).toHaveTextContent("PEAK3 v1");
    const panel = screen.getByTestId("rankings-provenance");
    expect(panel).toHaveTextContent("2025-26");
    expect(panel).toHaveTextContent("1979-80");
    expect(panel).toHaveTextContent("top_1000_peaks.v1");
    // rankings.spec.ts asserts this literal appears and "preview" does not.
    expect(panel).toHaveTextContent("peak3_official_weights_v1");
    expect(panel.textContent ?? "").not.toContain("preview");
  });

  it("states the serving gate as its own note, not as a trailing fragment", () => {
    render(createElement(RankingsProvenance, { meta: REAL_META, fallbackRowCount: 50 }));
    const gate = screen.getByTestId("rankings-serving-gate");
    expect(gate).toHaveTextContent("25.0 minutes per game");
    expect(gate).toHaveTextContent(/leaves out/i);
  });

  it("marks a non-default model rather than letting it pass as the default", () => {
    // Two model versions are not comparable. A board quietly serving the
    // non-default one under identical styling would be the worst failure this
    // panel can have.
    render(
      createElement(RankingsProvenance, {
        meta: { ...REAL_META, model_label: "PEAK3 v2 (preview)", is_default_model: false },
        fallbackRowCount: 50,
      }),
    );
    const badge = screen.getByTestId("rankings-model-version");
    expect(badge).toHaveAttribute("data-default-model", "false");
    expect(badge).toHaveTextContent("PEAK3 v2");
  });

  it("omits a fact it does not have rather than inventing one", () => {
    // No generated date is published by the generator today. The panel must
    // stay silent about it — an mtime-derived date would be fabricated
    // provenance, which is the exact defect this pass fixes.
    const sparse: RankingBoardMeta = {
      ...REAL_META,
      dataset_version: null,
      serving_gate_note: null,
      supported_start_season: null,
      supported_end_season: null,
      total_available: null,
    };
    render(createElement(RankingsProvenance, { meta: sparse, fallbackRowCount: 7 }));

    expect(screen.queryByTestId("rankings-serving-gate")).toBeNull();
    const panel = screen.getByTestId("rankings-provenance");
    expect(panel).not.toHaveTextContent(/data through/i);
    expect(panel).not.toHaveTextContent(/data release/i);
    // Still says which model produced the rows: that one is never optional.
    expect(screen.getByTestId("rankings-model-version")).toHaveTextContent("PEAK3 v1");
    // Falls back to the rendered row count when the API omits a total.
    expect(panel).toHaveTextContent("7");
  });

  it("links to the methodology page", () => {
    render(createElement(RankingsProvenance, { meta: REAL_META, fallbackRowCount: 50 }));
    expect(screen.getByRole("link", { name: /how the score is built/i })).toHaveAttribute(
      "href",
      "/methodology",
    );
  });
});
