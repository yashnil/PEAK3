/**
 * Peak Duel V2 — component-lane dot semantics and "Your pick" tag semantics.
 *
 * TWO INDEPENDENT RULES, deliberately decoupled here:
 *
 *  1. The per-side TAG ("Your pick · correct" / "Not selected" / …) follows
 *     the player's actual click (`selectedPeakId`), never the outcome.
 *  2. The lane DOT COLOUR marks OWNERSHIP: the coloured dot belongs to the
 *     OVERALL MATCHUP WINNER, and it is the same side on all five lanes.
 *     Dot POSITION still encodes that side's value on the lane, so a lane the
 *     winner loses shows the hollow dot further along the rule. An exact
 *     overall tie (`score_gap === 0`) owns nothing: both dots hollow.
 *
 * Rule 2 has superseded two earlier rules, both recorded because each was a
 * real regression and neither should come back:
 *
 *   - Fill following the player's CLICK. Blanked the whole comparison on a
 *     timeout, and reported the reader's own input back to them.
 *   - Fill following the PER-LANE higher value. Self-consistent, but the dot's
 *     position already encodes magnitude, so on a lane the overall winner lost
 *     the loser's dot was both further right AND filled — reading as "that
 *     side won" directly above an explanation sentence saying the opposite.
 *
 * The per-lane-higher tests from that second rule are therefore GONE rather
 * than relaxed: they asserted the behaviour this pass removes.
 */
import { describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import PeakDuelV2Reveal from "@/components/v2/duel/PeakDuelV2Reveal";
import type { AnswerResponse, Duel, PeakWindow } from "@/types";

function duel(): Duel {
  return {
    id: "duel-1",
    left: {
      player_name: "Michael Jordan",
      player_slug: "michael-jordan",
      duration_years: 1,
      start_season: "1990-91",
      end_season: "1990-91",
      anchor_season: "1990-91",
      peak_id: "peak-left",
    },
    right: {
      player_name: "LeBron James",
      player_slug: "lebron-james",
      duration_years: 1,
      start_season: "2008-09",
      end_season: "2008-09",
      anchor_season: "2008-09",
      peak_id: "peak-right",
    },
    difficulty: "Comfortable",
  };
}

function window_(overrides: Partial<PeakWindow> = {}): PeakWindow {
  return {
    id: "peak-left",
    player_id: "michael-jordan",
    player_slug: "michael-jordan",
    player_name: "Michael Jordan",
    duration_years: 1,
    start_season: "1990-91",
    end_season: "1990-91",
    anchor_season: "1990-91",
    rank: 1,
    prime_score: 97.5,
    prime_index: 1.2,
    components: {
      statistical_impact: 36.4,
      traditional_production: 19.8,
      individual_recognition: 19.1,
      postseason_individual_value: 17.2,
      team_achievement: 2.9,
      teammate_adjustment: 0,
    },
    data_status: "complete",
    ...overrides,
  };
}

/** `winningPeakId` picks which real side (left/right) the server reports as
 *  correct; `winner`/`loser` are always the PeakWindow objects in that
 *  winner/loser role, per `AnswerResponse`'s own contract. */
function answer(
  winningPeakId: "peak-left" | "peak-right",
  componentOverrides: Partial<AnswerResponse["component_comparison"]> = {},
  scoreGap = 1.7,
): AnswerResponse {
  const winnerWindow = window_({
    id: winningPeakId,
    player_name: winningPeakId === "peak-left" ? "Michael Jordan" : "LeBron James",
    prime_score: 97.5,
  });
  const loserWindow = window_({
    id: winningPeakId === "peak-left" ? "peak-right" : "peak-left",
    player_name: winningPeakId === "peak-left" ? "LeBron James" : "Michael Jordan",
    prime_score: 95.8,
  });
  return {
    correct: false, // overwritten per-test scenario where relevant; not asserted on directly here
    winning_peak_id: winningPeakId,
    arena_points_awarded: 0,
    updated_streak: 0,
    difficulty: "Comfortable",
    score_gap: scoreGap,
    winner: winnerWindow,
    loser: loserWindow,
    component_comparison: {
      statistical_impact: { winner: 36.4, loser: 30.1, winner_leads: true },
      traditional_production: { winner: 19.8, loser: 18.0, winner_leads: true },
      individual_recognition: { winner: 19.1, loser: 17.0, winner_leads: true },
      postseason_individual_value: { winner: 17.2, loser: 15.0, winner_leads: true },
      team_achievement: { winner: 2.9, loser: 2.0, winner_leads: true },
      ...componentOverrides,
    },
    explanation: "Test explanation.",
    selected_correctly: false,
  };
}

function renderReveal(opts: {
  winningPeakId: "peak-left" | "peak-right";
  selectedPeakId: string | null;
  componentOverrides?: Partial<AnswerResponse["component_comparison"]>;
  /** 0 means the model separated nothing — an exact overall tie. */
  scoreGap?: number;
}) {
  render(
    <PeakDuelV2Reveal
      mode="daily"
      duel={duel()}
      answer={answer(opts.winningPeakId, opts.componentOverrides, opts.scoreGap)}
      selectedPeakId={opts.selectedPeakId}
      currentIndex={0}
      totalDuels={10}
      results={[]}
      totalArenaPoints={0}
      currentStreak={0}
      isLast={false}
      onNext={() => {}}
    />,
  );
}

/** The desktop rendering of one lane, located by its visible label. */
function lane(label: string): HTMLElement {
  const lanes = document.querySelectorAll(
    ".hidden.sm\\:grid.sm\\:grid-cols-\\[auto_1fr_auto\\]",
  );
  const found = Array.from(lanes).find((el) => el.textContent?.includes(label));
  if (!found) throw new Error(`no desktop lane labeled "${label}"`);
  return found as HTMLElement;
}

/** Dot geometry for one lane: filled dots carry a tone background, hollow
 *  dots a 1.5px border. Positions are percentages along the shared rule. */
function dots(label: string) {
  const el = lane(label);
  const filled = Array.from(
    el.querySelectorAll('span[style*="background: var(--v2-color-comp"]'),
  ) as HTMLElement[];
  const hollow = Array.from(
    el.querySelectorAll('span[style*="border: 1.5px"]'),
  ) as HTMLElement[];
  return {
    filledCount: filled.length,
    hollowCount: hollow.length,
    filledPct: filled.length ? parseFloat(filled[0].style.left) : null,
    hollowPct: hollow.length ? parseFloat(hollow[0].style.left) : null,
  };
}

describe("PeakDuelV2Reveal — the pick TAG follows the player's actual click", () => {
  it("picks LEFT and is correct: left is tagged as the pick", () => {
    renderReveal({ winningPeakId: "peak-left", selectedPeakId: "peak-left" });
    expect(screen.getByText("Your pick · correct")).toBeInTheDocument();
    expect(screen.getByText("Not selected")).toBeInTheDocument();
  });

  it("picks the LOSING side: their own pick is tagged incorrect, never the winner", () => {
    renderReveal({ winningPeakId: "peak-right", selectedPeakId: "peak-left" });
    expect(screen.getByText("Your pick · incorrect")).toBeInTheDocument();
    expect(screen.getByText("Correct answer")).toBeInTheDocument();
    expect(screen.queryByText("Your pick · correct")).not.toBeInTheDocument();
  });

  it("genuine no-pick (decision clock expired): neither side is tagged as the pick", () => {
    renderReveal({ winningPeakId: "peak-left", selectedPeakId: null });
    expect(screen.queryByText(/Your pick/)).not.toBeInTheDocument();
    expect(screen.getByText("Correct answer")).toBeInTheDocument();
    expect(screen.getByText("Not selected")).toBeInTheDocument();
  });
});

describe("PeakDuelV2Reveal — the lane DOT COLOUR marks the overall matchup winner", () => {
  const LANES = [
    "Statistical Impact",
    "Traditional Production",
    "Individual Recognition",
    "Playoff Rate Impact",
    "Team Result",
  ];

  it("winner on the LEFT: the filled dot is the left value on every lane", () => {
    // Winner is LEFT, and leads all five lanes in the default fixture, so the
    // filled dot is also the further one here. The lane below is what proves
    // colour is ownership rather than magnitude.
    renderReveal({ winningPeakId: "peak-left", selectedPeakId: "peak-left" });
    for (const label of LANES) {
      const d = dots(label);
      expect(d.filledCount, label).toBe(1);
      expect(d.hollowCount, label).toBe(1);
    }
  });

  it("THE OWNERSHIP RULE: on a lane the overall winner LOSES, the filled dot is the NEARER one", () => {
    // The regression this rule exists for. LEFT won the matchup; on
    // Statistical Impact the RIGHT (losing) player leads 18.0 to 15.0.
    //
    // Position: the right/loser dot is further along the rule (18.0 > 15.0).
    // Colour:   the filled dot still belongs to LEFT, the matchup winner.
    // So the filled dot must sit BEHIND the hollow one — the exact inversion
    // the old per-lane rule could never produce, and the reason a reader could
    // previously conclude the loser had won every component.
    renderReveal({
      winningPeakId: "peak-left",
      selectedPeakId: "peak-left",
      componentOverrides: {
        statistical_impact: { winner: 15.0, loser: 18.0, winner_leads: false },
      },
    });
    const si = dots("Statistical Impact");
    expect(si.filledCount).toBe(1);
    expect(si.filledPct as number).toBeLessThan(si.hollowPct as number);

    // Every other lane, where the winner does lead, keeps the filled dot ahead
    // — proving position still tracks magnitude independently of colour.
    const tp = dots("Traditional Production");
    expect(tp.filledPct as number).toBeGreaterThan(tp.hollowPct as number);
  });

  it("the SAME side is coloured on all five lanes, whatever each lane says", () => {
    // Two lanes flipped to the loser. Ownership is a property of the matchup,
    // so the coloured side must not change lane to lane.
    renderReveal({
      winningPeakId: "peak-right",
      selectedPeakId: "peak-right",
      componentOverrides: {
        statistical_impact: { winner: 15.0, loser: 18.0, winner_leads: false },
        team_achievement: { winner: 1.0, loser: 2.9, winner_leads: false },
      },
    });
    // Winner is RIGHT, so on every lane the coloured dot is the right value.
    // On the two flipped lanes the right value is the SMALLER one, so its dot
    // is nearer; on the rest it is larger, so further. Colour never moves.
    for (const label of LANES) expect(dots(label).filledCount, label).toBe(1);
    expect(dots("Statistical Impact").filledPct as number).toBeLessThan(
      dots("Statistical Impact").hollowPct as number,
    );
    expect(dots("Traditional Production").filledPct as number).toBeGreaterThan(
      dots("Traditional Production").hollowPct as number,
    );
  });

  it("dot colour does not change when the player's selection changes", () => {
    renderReveal({ winningPeakId: "peak-left", selectedPeakId: "peak-left" });
    const picked = dots("Statistical Impact");
    cleanup();
    // Same matchup and same numbers; the player clicked the OTHER side.
    renderReveal({ winningPeakId: "peak-left", selectedPeakId: "peak-right" });
    const other = dots("Statistical Impact");
    expect(other.filledPct).toBe(picked.filledPct);
    expect(other.hollowPct).toBe(picked.hollowPct);
    expect(other.filledCount).toBe(picked.filledCount);
  });

  it("a timeout with no pick still shows a full comparison — every lane keeps its coloured dot", () => {
    // Ownership comes from the matchup, not the click, so a no-pick reveal is
    // still fully legible. (The click-based rule blanked all five lanes here.)
    renderReveal({ winningPeakId: "peak-left", selectedPeakId: null });
    for (const label of LANES) expect(dots(label).filledCount, label).toBe(1);
  });

  it("an EXACT OVERALL TIE owns nothing — every lane renders neutral", () => {
    renderReveal({ winningPeakId: "peak-left", selectedPeakId: "peak-left", scoreGap: 0 });
    for (const label of LANES) {
      const d = dots(label);
      expect(d.filledCount, label).toBe(0);
      expect(d.hollowCount, label).toBe(2);
    }
  });

  it("a per-lane tie is NOT an ownership tie — the matchup winner still owns the colour", () => {
    // Under the superseded per-lane rule this lane went neutral. Ownership is
    // a matchup-level fact, so an equal lane changes nothing about colour.
    renderReveal({
      winningPeakId: "peak-left",
      selectedPeakId: "peak-left",
      componentOverrides: {
        traditional_production: { winner: 5.7, loser: 5.7, winner_leads: true },
      },
    });
    expect(dots("Traditional Production").filledCount).toBe(1);
    expect(dots("Statistical Impact").filledCount).toBe(1);
  });
});
