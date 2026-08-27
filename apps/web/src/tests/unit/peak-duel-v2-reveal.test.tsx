/**
 * Peak Duel V2 — component-lane dot semantics and "Your pick" tag semantics.
 *
 * TWO INDEPENDENT RULES, deliberately decoupled here:
 *
 *  1. The per-side TAG ("Your pick · correct" / "Not selected" / …) follows
 *     the player's actual click (`selectedPeakId`), never the outcome.
 *  2. The lane DOT FILL follows the LANE'S OWN DATA: on each lane, the side
 *     with the higher value is filled and the other is hollow — regardless of
 *     what the player picked, who won the matchup overall, or which side a
 *     name was dealt to. Equal-at-displayed-precision is a tie: both hollow.
 *
 * Rule 2 supersedes an earlier pass in which fill tracked the player's pick.
 * That made the row answer a question the reader already knew the answer to,
 * and blanked the entire comparison on a timeout (no pick -> nothing filled).
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
    score_gap: 1.7,
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
}) {
  render(
    <PeakDuelV2Reveal
      mode="daily"
      duel={duel()}
      answer={answer(opts.winningPeakId, opts.componentOverrides)}
      selectedPeakId={opts.selectedPeakId}
      currentIndex={0}
      totalDuels={10}
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

describe("PeakDuelV2Reveal — the lane DOT marks whoever is higher on that lane", () => {
  it("left leads the lane: the filled dot sits at the left value, ahead of the hollow one", () => {
    // winner is LEFT, so leftValue = comp.winner = 36.4, right = 30.1.
    renderReveal({ winningPeakId: "peak-left", selectedPeakId: "peak-left" });
    const d = dots("Statistical Impact");
    expect(d.filledCount).toBe(1);
    expect(d.hollowCount).toBe(1);
    expect(d.filledPct as number).toBeGreaterThan(d.hollowPct as number);
  });

  it("right leads the lane: the filled dot moves to the right value", () => {
    // winner is RIGHT, so leftValue = comp.loser = 30.1, right = 36.4.
    renderReveal({ winningPeakId: "peak-right", selectedPeakId: "peak-right" });
    const d = dots("Statistical Impact");
    expect(d.filledCount).toBe(1);
    expect(d.filledPct as number).toBeGreaterThan(d.hollowPct as number);
  });

  it("THE OVERALL LOSER LEADING A LANE still gets that lane's filled dot", () => {
    // The brief's worked example. The server says LEFT won the matchup, but
    // on Statistical Impact the RIGHT (losing) player is ahead: 18.0 vs 15.0.
    // The lane must report the lane, not the matchup.
    renderReveal({
      winningPeakId: "peak-left",
      selectedPeakId: "peak-left",
      componentOverrides: {
        statistical_impact: { winner: 15.0, loser: 18.0, winner_leads: false },
      },
    });
    const si = lane("Statistical Impact");
    const filled = si.querySelector(
      'span[style*="background: var(--v2-color-comp"]',
    ) as HTMLElement;
    const hollow = si.querySelector('span[style*="border: 1.5px"]') as HTMLElement;
    // left = 15.0 (the overall WINNER), right = 18.0 (the overall LOSER).
    // Higher value sits further along the rule, and it must be the filled one.
    expect(parseFloat(filled.style.left)).toBeGreaterThan(parseFloat(hollow.style.left));

    // Every other lane, where the overall winner does lead, is unaffected.
    const tp = dots("Traditional Production");
    expect(tp.filledPct as number).toBeGreaterThan(tp.hollowPct as number);
  });

  it("dot fill does not change when the player's selection changes", () => {
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

  it("a timeout with no pick still shows a full comparison — every lane keeps its filled dot", () => {
    // The old rule blanked all five lanes here (see design-review/05).
    renderReveal({ winningPeakId: "peak-left", selectedPeakId: null });
    for (const label of [
      "Statistical Impact",
      "Traditional Production",
      "Individual Recognition",
      "Playoff Rate Impact",
      "Team Result",
    ]) {
      expect(dots(label).filledCount).toBe(1);
    }
  });

  it("an exact tie at the displayed precision renders neutral — neither side promoted", () => {
    renderReveal({
      winningPeakId: "peak-left",
      selectedPeakId: "peak-left",
      componentOverrides: {
        traditional_production: { winner: 5.7, loser: 5.7, winner_leads: true },
      },
    });
    const tied = dots("Traditional Production");
    expect(tied.filledCount).toBe(0);
    expect(tied.hollowCount).toBe(2);
    // A tie in one lane does not disturb the others.
    expect(dots("Statistical Impact").filledCount).toBe(1);
  });

  it("values that differ only below the printed precision are treated as a tie", () => {
    // Both print "5.7"; promoting either would claim something the numbers
    // beside the dots do not show.
    renderReveal({
      winningPeakId: "peak-left",
      selectedPeakId: "peak-left",
      componentOverrides: {
        traditional_production: { winner: 5.72, loser: 5.68, winner_leads: true },
      },
    });
    expect(dots("Traditional Production").filledCount).toBe(0);
  });
});
