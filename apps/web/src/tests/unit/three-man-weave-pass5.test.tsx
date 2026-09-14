/**
 * Three-Man Weave, game-feel pass 5: the lottery slate and the final.
 *
 * What is pinned here is behaviour a presentation change could silently break:
 * the round's pick order is the server's fixed snake; the result's "why" is
 * drawn only from numbers the server reported and never invents a winner for
 * a shared first place; a Franchise or Decade Draft is named for the whole
 * draft rather than as a per-round pair.
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("@/lib/a11y", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/a11y")>();
  return { ...actual, usePrefersReducedMotion: () => true };
});

import PeakV2TMWReveal from "@/components/v2/tmw/PeakV2TMWReveal";
import PeakV2TMWResult from "@/components/v2/tmw/PeakV2TMWResult";
import {
  podium,
  roundPickOrder,
  separationSentence,
  turnOrder,
  winnerSeparation,
} from "@/lib/three-man-weave-state";
import type {
  ArenaResultView,
  ArenaSeatPublic,
  TmwFitComponents,
  TmwPick,
  TmwPublicState,
  TmwRoll,
  TmwRoster,
} from "@/types/three-man-weave";

const SEATS: ArenaSeatPublic[] = [
  { seat_index: 0, display_name: "You", is_bot: false, status: "active", bot_rating: null },
  { seat_index: 1, display_name: "Rim Runner", is_bot: true, status: "active", bot_rating: 50 },
  { seat_index: 2, display_name: "The Enforcer", is_bot: true, status: "active", bot_rating: 50 },
];

const ROLL: TmwRoll = {
  round_number: 2,
  roll_id: "roll-2",
  franchise_id: "DEN",
  franchise_display_name: "Denver Nuggets",
  decade: "2020s",
  eligible_slugs: ["a", "b"],
  candidates: [],
};

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

function result(
  seat: number,
  name: string,
  placement: number,
  score: number,
  fit: TmwFitComponents | null,
  extra: Partial<ArenaResultView["detail"]> = {},
): ArenaResultView {
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
      decisive_pick: null,
      tmw_adapter_version: "a",
      lineup_model_version: "b",
      simulator_version: "c",
      formula_version: "d",
      ...extra,
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

// ---------------------------------------------------------------------------
// The round's picks
// ---------------------------------------------------------------------------

describe("roundPickOrder", () => {
  it("is the fixed snake: odd rounds forward, even rounds reversed, numbered across the match", () => {
    expect(roundPickOrder(1, 3)).toEqual([
      { pickNumber: 1, seatIndex: 0 },
      { pickNumber: 2, seatIndex: 1 },
      { pickNumber: 3, seatIndex: 2 },
    ]);
    expect(roundPickOrder(2, 3)).toEqual([
      { pickNumber: 4, seatIndex: 2 },
      { pickNumber: 5, seatIndex: 1 },
      { pickNumber: 6, seatIndex: 0 },
    ]);
    expect(roundPickOrder(0, 3)).toEqual([]);
  });

  it("agrees with the whole-match turnOrder for every round", () => {
    const state = { total_rounds: 6, rosters: [roster(0), roster(1), roster(2)] } as unknown as TmwPublicState;
    const all = turnOrder(state, 3);
    for (let round = 1; round <= 6; round += 1) {
      expect(roundPickOrder(round, 3).map((entry) => entry.seatIndex)).toEqual(
        all.filter((slot) => slot.roundNumber === round).map((slot) => slot.seatIndex),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Why the winner won
// ---------------------------------------------------------------------------

describe("winnerSeparation / separationSentence", () => {
  const rows = podium([
    result(1, "Rim Runner", 1, 70.2, FIT({ positional_fit: 95, creation_coverage: 61, postseason_pedigree: 80 })),
    result(0, "You", 2, 66.1, FIT({ positional_fit: 83, creation_coverage: 60.5, postseason_pedigree: 74 })),
    result(2, "The Enforcer", 3, 60.0, FIT({ positional_fit: 70, postseason_pedigree: 79 })),
  ]);

  it("lists only the measures the sole winner leads by a full point, strongest first, against the best other value", () => {
    // positional 95 vs 83 (+12); postseason 80 vs 79 from The Enforcer, not
    // You (+1, exactly the threshold); creation 61 vs 60.5 (+0.5) is not a
    // separation; scoring is level.
    const separations = winnerSeparation(rows);
    expect(separations.map((entry) => entry.key)).toEqual(["positional_fit", "postseason_pedigree"]);
    expect(separations[0]).toMatchObject({ winnerValue: 95, nextValue: 83, nextName: "You", gap: 12 });
    expect(separations[1]).toMatchObject({ winnerValue: 80, nextValue: 79, nextName: "The Enforcer" });
    expect(winnerSeparation(rows, 1).map((entry) => entry.key)).toEqual(["positional_fit"]);
  });

  it("finds nothing to explain when first place is shared", () => {
    const shared = podium([
      result(0, "You", 1, 70, FIT({ positional_fit: 99 })),
      result(1, "Rim Runner", 1, 70, FIT()),
      result(2, "The Enforcer", 3, 60, FIT()),
    ]);
    expect(winnerSeparation(shared)).toEqual([]);
  });

  it("says it as the model's rating, with the real values", () => {
    const sentence = separationSentence("Rim Runner", false, winnerSeparation(rows));
    expect(sentence).toBe(
      "PEAK3 rates Rim Runner's six clear of the field on positional fit (95 vs 83 for You) " +
        "and postseason pedigree (80 vs 79 for The Enforcer).",
    );
    expect(separationSentence("Rim Runner", true, [])).toMatch(/^No single fit measure separated you by a full point/);
  });
});

// ---------------------------------------------------------------------------
// The slate
// ---------------------------------------------------------------------------

describe("PeakV2TMWReveal — the lottery slate", () => {
  it("names the round, the picks it owns and who takes them, and marks who opens once resolved", () => {
    render(
      <PeakV2TMWReveal
        roll={ROLL}
        roundNumber={2}
        totalRounds={6}
        seats={SEATS}
        yourSeatIndex={0}
        seatCount={3}
        upNextSeatIndex={2}
        handoffLabel="The Enforcer is up"
        phase="reveal"
        totalSeconds={1.5}
      />,
    );
    expect(screen.getByTestId("tmw-round-reveal")).toHaveTextContent("Round 2 of 6");
    expect(screen.getByText("Picks 4–6")).toBeInTheDocument();
    const order = screen.getByRole("list", { name: "Round 2 draft order" });
    const items = within(order).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["4The Enforceron the clock", "5Rim Runner", "6You"]);
    expect(items[0]).toHaveAttribute("data-next", "true");
    expect(screen.getByTestId("tmw-handoff")).toHaveAttribute("data-visible", "true");
    expect(screen.getByTestId("tmw-roll-franchise")).toBeInTheDocument();
    expect(screen.getByTestId("tmw-roll-decade")).toBeInTheDocument();
  });

  it("marks the handoff as the viewer's own when the viewer opens", () => {
    render(
      <PeakV2TMWReveal
        roll={ROLL}
        roundNumber={2}
        totalRounds={6}
        seats={SEATS}
        yourSeatIndex={0}
        upNextSeatIndex={0}
        handoffLabel="You're up"
        phase="reveal"
      />,
    );
    expect(screen.getByTestId("tmw-handoff")).toHaveAttribute("data-you", "true");
    expect(screen.getByTestId("tmw-handoff")).toHaveTextContent("You're up");
  });

  it("rolls a Franchise Draft's ONE constraint for the whole draft, not a per-round pair", () => {
    render(
      <PeakV2TMWReveal
        roll={{ ...ROLL, round_number: 1, variant: "franchise", decade: "All decades" }}
        roundNumber={1}
        totalRounds={6}
        seats={SEATS}
        yourSeatIndex={0}
        constraint={{ kind: "franchise", value: "DEN", label: "Denver Nuggets" }}
        phase="reveal"
      />,
    );
    expect(screen.getByTestId("tmw-round-reveal")).toHaveTextContent("Franchise Draft · round 1 of 6");
    expect(screen.getByText("All 18 picks")).toBeInTheDocument();
    expect(screen.getByTestId("tmw-roll-franchise")).toHaveAttribute("data-final-value", "Denver Nuggets");
    expect(screen.queryByTestId("tmw-roll-decade")).toBeNull();
    expect(screen.queryByText("All decades")).toBeNull();
  });

  it("rolls a Decade Draft's decade alone", () => {
    render(
      <PeakV2TMWReveal
        roll={{ ...ROLL, round_number: 1, variant: "decade", franchise_display_name: "All franchises" }}
        roundNumber={1}
        totalRounds={6}
        seats={SEATS}
        yourSeatIndex={0}
        constraint={{ kind: "decade", value: "1990s", label: "1990s" }}
        phase="reveal"
      />,
    );
    expect(screen.getByTestId("tmw-round-reveal")).toHaveTextContent("Decade Draft");
    expect(screen.getByTestId("tmw-roll-decade")).toHaveAttribute("data-final-value", "1990s");
    expect(screen.queryByTestId("tmw-roll-franchise")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The final
// ---------------------------------------------------------------------------

describe("PeakV2TMWResult — who won, why, what you built", () => {
  const RESULTS = [
    result(1, "Rim Runner", 1, 70.2, FIT({ positional_fit: 95 }), {
      best_pick: "Nikola Jokic",
      decisive_pick: {
        slot_type: "C",
        player_slug: "nikola-jokic",
        player_name: "Nikola Jokic",
        season: "2021-22",
        team_id: "DEN",
        round_number: 1,
        lineup_quality_drop: 6.25,
      },
    }),
    result(0, "You", 2, 66.1, FIT({ positional_fit: 83 }), {
      best_pick: "Kawhi Leonard",
      decisive_pick: {
        slot_type: "SF",
        player_slug: "kawhi-leonard",
        player_name: "Kawhi Leonard",
        season: "2018-19",
        team_id: "TOR",
        round_number: 2,
        lineup_quality_drop: 4.1,
      },
    }),
    result(2, "The Enforcer", 3, 60.0, FIT({ positional_fit: 70 })),
  ];
  const ROSTERS = [
    roster(0, { SF: pick("kawhi-leonard", "Kawhi Leonard", "SF", 88.4), PG: pick("kyle-lowry", "Kyle Lowry", "PG", 71.2) }),
    roster(1),
    roster(2),
  ];

  function renderFinal(results = RESULTS, yourSeatIndex: number | null = 0) {
    render(
      <PeakV2TMWResult
        results={results}
        rosters={ROSTERS}
        yourSeatIndex={yourSeatIndex}
        seed="m-5"
        onPlayAgain={async () => true}
      />,
    );
  }

  it("explains the win from the winner's decisive pick and the measure where it separated", () => {
    renderFinal();
    const why = screen.getByTestId("tmw-why");
    expect(why).toHaveTextContent("Why Rim Runner won");
    expect(screen.getByTestId("tmw-why-decisive")).toHaveTextContent("Nikola Jokic");
    expect(screen.getByTestId("tmw-why-decisive")).toHaveTextContent("6.25");
    expect(screen.getByTestId("tmw-why-edge")).toHaveTextContent(
      "PEAK3 rates Rim Runner's six clear of the field on positional fit (95 vs 83 for You).",
    );
  });

  it("compares every roster on each measure with the number printed and the leader named in words", () => {
    renderFinal();
    const row = screen.getByTestId("tmw-compare-positional_fit");
    const cells = within(row).getAllByRole("cell");
    expect(cells.map((cell) => cell.querySelector(".tmw-h2h-value")?.textContent)).toEqual(["95", "83", "70"]);
    expect(within(cells[0]).getByText("best")).toBeInTheDocument();
    expect(within(cells[1]).queryByText("best")).toBeNull();
    expect(screen.getByTestId("tmw-compare-decisive")).toHaveTextContent("Kawhi Leonard");
  });

  it("shows the viewer's own six with the decisive and top-rated cards marked", () => {
    renderFinal();
    const build = screen.getByTestId("tmw-your-build");
    expect(build).toHaveTextContent("What you built");
    const kawhi = within(build).getByText("Kawhi Leonard").closest("li")!;
    expect(kawhi).toHaveAttribute("data-decisive", "true");
    expect(kawhi).toHaveTextContent("decisive");
    expect(kawhi).toHaveTextContent("top card");
    expect(within(build).getAllByRole("listitem")).toHaveLength(6);
  });

  it("keeps both exits on the first screen and never publishes a projected record", () => {
    renderFinal();
    expect(screen.getByTestId("tmw-play-again")).toBeInTheDocument();
    expect(screen.getByTestId("tmw-back-to-arena")).toHaveAttribute("href", "/arena");
    const panel = screen.getByTestId("tmw-podium");
    expect(panel.textContent).not.toMatch(/projected record/i);
    expect(panel.textContent).not.toMatch(/\b\d{2}-\d{2}\b/);
  });

  it("invents no explanation for a shared first place", () => {
    renderFinal([
      result(0, "You", 1, 70, FIT()),
      result(1, "Rim Runner", 1, 70, FIT()),
      result(2, "The Enforcer", 3, 60, FIT()),
    ]);
    expect(screen.queryByTestId("tmw-why")).toBeNull();
    expect(screen.getByTestId("tmw-why-drawn")).toHaveTextContent(/no single winning roster/i);
  });

  it("omits the head-to-head when the payload carries no fit components", () => {
    renderFinal([
      result(1, "Rim Runner", 1, 70, null),
      result(0, "You", 2, 66, null),
      result(2, "The Enforcer", 3, 60, null),
    ]);
    expect(screen.queryByTestId("tmw-compare")).toBeNull();
    expect(screen.queryByTestId("tmw-why")).toBeNull();
  });
});
