/**
 * Three-Man Weave's end screen as a celebration first and a report second
 * (game-feel pass 6).
 *
 * Pinned here: the verdict says who won in words and names the ruleset; the
 * podium stands the winner centre-stage without reordering the DOM; the
 * celebration and spark burst belong to a viewer who won, and vanish under
 * reduced motion; your score is set beside the one it was measured against;
 * and the deeper detail (head to head, rosters, receipt) is folded, not gone.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import PeakV2TMWResult, { TMW_RESULT_ENTRANCE } from "@/components/v2/tmw/PeakV2TMWResult";
import type { ArenaResultView, TmwFitComponents, TmwPick, TmwRoster } from "@/types/three-man-weave";

function mockMatchMedia(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? reduced : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const FIT = (overrides: Partial<TmwFitComponents> = {}): TmwFitComponents => ({
  talent_core: 60,
  bench_strength: 50,
  positional_fit: 80,
  creation_coverage: 60,
  scoring_coverage: 60,
  postseason_pedigree: 60,
  team_context_depth: 60,
  ...overrides,
});

function result(seat: number, name: string, placement: number, score: number, fit: TmwFitComponents | null = FIT()): ArenaResultView {
  return {
    seat_index: seat,
    display_name: name,
    placement,
    score,
    outcome: placement === 1 ? "win" : "loss",
    was_bot: seat !== 0,
    detail: {
      score_status: "complete",
      lineup_score: score,
      mean_season_score: score + 10,
      fit_components: fit as TmwFitComponents,
      best_pick: null,
      decisive_pick:
        placement === 1
          ? {
              slot_type: "C",
              player_slug: "nikola-jokic",
              player_name: "Nikola Jokic",
              season: "2021-22",
              team_id: "DEN",
              round_number: 1,
              lineup_quality_drop: 6.25,
            }
          : null,
      tmw_adapter_version: "a",
      lineup_model_version: "b",
      simulator_version: "c",
      formula_version: "d",
    },
  } as ArenaResultView;
}

function pick(slug: string, name: string, slot: string, value: number): TmwPick {
  return {
    player_slug: slug,
    player_name: name,
    positions: [slot],
    slot_type: slot,
    scoring_card: {
      season: "2018-19",
      team_id: "TOR",
      team_name: "Toronto Raptors",
      prime_score: value,
      score_source: "exact_team_stint",
      is_multi_team_season: false,
      formula_version: "peak3_v1",
    },
  } as unknown as TmwPick;
}

function roster(seat: number, slots: Record<string, TmwPick | null> = {}): TmwRoster {
  return {
    seat_index: seat,
    slots: { PG: null, SG: null, SF: null, PF: null, C: null, bench_1: null, ...slots },
    complete: true,
  };
}

const ROSTERS = [roster(0, { SF: pick("kawhi-leonard", "Kawhi Leonard", "SF", 88.4) }), roster(1), roster(2)];

function renderFinal(
  results: ArenaResultView[],
  { reduced = false, ...props }: { reduced?: boolean } & Partial<React.ComponentProps<typeof PeakV2TMWResult>> = {},
) {
  mockMatchMedia(reduced);
  return render(
    <PeakV2TMWResult results={results} rosters={ROSTERS} yourSeatIndex={0} seed="m-9" onPlayAgain={async () => true} {...props} />,
  );
}

const YOU_WIN = [result(0, "You", 1, 72.4), result(1, "Rim Runner", 2, 70.1), result(2, "The Enforcer", 3, 61.0)];
const YOU_SECOND = [result(1, "Rim Runner", 1, 72.4), result(0, "You", 2, 70.1), result(2, "The Enforcer", 3, 61.0)];

describe("PeakV2TMWResult — the verdict", () => {
  it("says a win in words, with the placement ordinal once and the table size beside it", () => {
    renderFinal(YOU_WIN);
    expect(screen.getByTestId("tmw-outcome")).toHaveTextContent("You won the draft");
    expect(screen.getByTestId("tmw-your-placement").textContent?.trim()).toBe("1st");
    expect(screen.getByText("of 3")).toBeInTheDocument();
  });

  it("names the winner when the viewer did not win", () => {
    renderFinal(YOU_SECOND);
    expect(screen.getByTestId("tmw-outcome")).toHaveTextContent("Rim Runner won the draft");
    expect(screen.getByTestId("tmw-your-placement").textContent?.trim()).toBe("2nd");
  });

  it("names the ruleset and its one constraint, and calls the standard game Classic", () => {
    renderFinal(YOU_WIN, { modeName: "Three-Man Weave: Franchise Draft", constraintLabel: "Chicago Bulls" });
    expect(screen.getByTestId("tmw-final-mode")).toHaveTextContent("Three-Man Weave · Franchise Draft · Chicago Bulls · Final");
    cleanup();
    renderFinal(YOU_WIN);
    expect(screen.getByTestId("tmw-final-mode")).toHaveTextContent("Three-Man Weave · Classic · Final");
  });

  it("keeps both exits in the verdict, before the podium", () => {
    renderFinal(YOU_SECOND);
    const again = screen.getByTestId("tmw-play-again");
    const standings = screen.getByTestId("tmw-standings");
    expect(again.compareDocumentPosition(standings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("tmw-back-to-arena")).toHaveAttribute("href", "/arena");
  });

  it("offers the rematch lobby at a multiplayer table", () => {
    renderFinal(YOU_SECOND, { multiplayer: true });
    expect(screen.getByTestId("tmw-play-again")).toHaveTextContent("Play again · rematch lobby");
  });
});

describe("PeakV2TMWResult — the podium", () => {
  it("stands three distinct placements 2nd · 1st · 3rd, keeping placement order in the document", () => {
    renderFinal(YOU_SECOND);
    const stands = screen.getByTestId("tmw-standings");
    expect(stands).toHaveAttribute("data-stage", "classic");
    const items = within(stands).getAllByRole("listitem");
    expect(items.map((item) => item.getAttribute("data-place"))).toEqual(["1", "2", "3"]);
    expect(items[0]).toHaveTextContent("1st");
    expect(items[0]).toHaveTextContent(/winner/i);
    expect(items[1]).toHaveTextContent(/you/i);
  });

  it("keeps a shared first place in plain placement order", () => {
    renderFinal([result(0, "You", 1, 70), result(1, "Rim Runner", 1, 70), result(2, "The Enforcer", 3, 60)]);
    expect(screen.getByTestId("tmw-standings")).toHaveAttribute("data-stage", "list");
    expect(screen.getByTestId("tmw-outcome")).toHaveTextContent("A share of first");
  });

  it("celebrates only a viewer who won: confetti and a spark burst on the winner's plinth", () => {
    renderFinal(YOU_WIN);
    expect(screen.getByTestId("tmw-celebration")).toHaveAttribute("data-active", "true");
    const sparks = screen.getByTestId("tmw-sparks");
    expect(sparks).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("tmw-standing-0")).toContainElement(sparks);
    cleanup();
    renderFinal(YOU_SECOND);
    expect(screen.getByTestId("tmw-celebration")).toHaveAttribute("data-active", "false");
    expect(screen.queryByTestId("tmw-sparks")).toBeNull();
  });

  it("drops every particle and entrance under reduced motion", () => {
    renderFinal(YOU_WIN, { reduced: true });
    expect(screen.getByTestId("tmw-podium")).toHaveAttribute("data-motion", "reduced");
    expect(screen.getByTestId("tmw-celebration")).toHaveAttribute("data-reduced", "true");
    expect(screen.queryByTestId("tmw-sparks")).toBeNull();
  });

  it("settles its staged entrance inside the 1.2 s budget", () => {
    const last = Math.max(
      TMW_RESULT_ENTRANCE.verdictMs,
      TMW_RESULT_ENTRANCE.podiumMs,
      TMW_RESULT_ENTRANCE.summaryMs,
      TMW_RESULT_ENTRANCE.whyMs,
    );
    expect(last + TMW_RESULT_ENTRANCE.beatMs).toBeLessThanOrEqual(1200);
    expect(TMW_RESULT_ENTRANCE.verdictMs).toBeLessThan(TMW_RESULT_ENTRANCE.podiumMs);
    expect(TMW_RESULT_ENTRANCE.podiumMs).toBeLessThan(TMW_RESULT_ENTRANCE.summaryMs);
    expect(TMW_RESULT_ENTRANCE.summaryMs).toBeLessThan(TMW_RESULT_ENTRANCE.whyMs);
  });
});

describe("PeakV2TMWResult — the summary and the detail", () => {
  it("sets your score beside the winner's when you lost, and beside the runner-up's when you won", () => {
    renderFinal(YOU_SECOND, { reduced: true });
    expect(screen.getByTestId("tmw-your-score")).toHaveTextContent("70.1");
    expect(screen.getByTestId("tmw-rival-score")).toHaveTextContent("72.4");
    expect(screen.getByTestId("tmw-rival-score")).toHaveTextContent("Rim Runner · 1st");
    cleanup();
    renderFinal(YOU_WIN, { reduced: true });
    expect(screen.getByTestId("tmw-rival-score")).toHaveTextContent("70.1");
    expect(screen.getByTestId("tmw-rival-score")).toHaveTextContent("Rim Runner · 2nd");
  });

  it("shows your six as six tiles", () => {
    renderFinal(YOU_SECOND);
    const build = screen.getByTestId("tmw-your-build");
    expect(within(build).getAllByRole("listitem")).toHaveLength(6);
    expect(build).toHaveTextContent("Kawhi Leonard");
  });

  it("folds the head to head, every roster and the receipt, all closed at first", () => {
    renderFinal(YOU_SECOND);
    const compare = screen.getByTestId("tmw-fold-compare");
    const rosters = screen.getByTestId("tmw-fold-rosters");
    const receipt = screen.getByTestId("tmw-receipt");
    for (const fold of [compare, rosters, receipt]) {
      expect(fold.tagName).toBe("DETAILS");
      expect(fold).not.toHaveAttribute("open");
    }
    expect(compare).toContainElement(screen.getByTestId("tmw-compare"));
    expect(rosters).toContainElement(screen.getByTestId("tmw-result-rows"));
    expect(receipt).toContainElement(screen.getByTestId("tmw-ranking-basis"));
    // The why sits above every fold, on the first read.
    const why = screen.getByTestId("tmw-why");
    expect(why.compareDocumentPosition(compare) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the why to at most two insights, both phrased as the model's rating", () => {
    renderFinal(YOU_SECOND);
    const why = screen.getByTestId("tmw-why");
    expect(why.querySelectorAll(".tmw-final-insight").length).toBeLessThanOrEqual(2);
    expect(screen.getByTestId("tmw-why-decisive")).toHaveTextContent("PEAK3");
  });
});
