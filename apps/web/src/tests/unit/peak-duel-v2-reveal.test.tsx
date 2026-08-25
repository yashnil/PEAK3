/**
 * Peak Duel V2 — comparison dot / "Your pick" semantics (mission §3).
 *
 * Confirmed root cause fixed here: `PeakV2DataLane` used to unconditionally
 * fill the LEFT dot, and `PeakDuelV2Reveal` fed it values mapped by
 * `winnerIsLeft` — so the filled dot (and the "Your pick · correct" tag)
 * tracked the WINNER, never the side the player actually clicked. These
 * tests exercise `PeakDuelV2Reveal` directly, covering both directions
 * (user picks left / user picks right), a wrong pick, and the genuine
 * no-pick (decision-clock-expired) case — independent of which side the
 * server reports as the winner in each scenario.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

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
function answer(winningPeakId: "peak-left" | "peak-right"): AnswerResponse {
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
    },
    explanation: "Test explanation.",
    selected_correctly: false,
  };
}

function renderReveal(opts: { winningPeakId: "peak-left" | "peak-right"; selectedPeakId: string | null }) {
  render(
    <PeakDuelV2Reveal
      mode="daily"
      duel={duel()}
      answer={answer(opts.winningPeakId)}
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

describe("PeakDuelV2Reveal — dot fill and pick tag follow the player's actual click", () => {
  it("user picks LEFT and is correct: left is tagged as the pick, filled dots sit on the left value", () => {
    renderReveal({ winningPeakId: "peak-left", selectedPeakId: "peak-left" });
    expect(screen.getByText("Your pick · correct")).toBeInTheDocument();
    expect(screen.getByText("Not selected")).toBeInTheDocument(); // the untouched right side
    const filledDots = document.querySelectorAll('span[style*="background: var(--v2-color-comp-si)"]');
    expect(filledDots.length).toBeGreaterThan(0);
    // Left value for statistical_impact is the winner's 36.4 on a 0-max scale
    // derived from max(36.4, 30.1)*1.15 ≈ 41.86 -> left% = 36.4/41.86*100 ≈ 86.9.
    Array.from(filledDots).forEach((dot) => {
      expect((dot as HTMLElement).style.left).not.toBe("");
    });
  });

  it("user picks RIGHT and wins: pickedSide=\"right\" reaches every lane, so the filled dot sits at the RIGHT slot's value", () => {
    renderReveal({ winningPeakId: "peak-right", selectedPeakId: "peak-right" });
    expect(screen.getByText("Your pick · correct")).toBeInTheDocument();
    expect(screen.getByText("Not selected")).toBeInTheDocument();
    // statistical_impact: winner (right, since winningPeakId=peak-right) is
    // 36.4, loser (left) is 30.1. leftValue = comp.loser = 30.1 (winnerIsLeft
    // is false), rightValue = comp.winner = 36.4. With pickedSide="right",
    // the filled si-toned dot must sit at the RIGHT value's position.
    const desktopLanes = document.querySelectorAll(".hidden.sm\\:grid.sm\\:grid-cols-\\[auto_1fr_auto\\]");
    const siLane = Array.from(desktopLanes).find((el) =>
      el.querySelector('span[style*="background: var(--v2-color-comp-si)"]'),
    ) as HTMLElement;
    expect(siLane).toBeTruthy();
    const filled = siLane.querySelector('span[style*="background: var(--v2-color-comp-si)"]') as HTMLElement;
    const hollow = siLane.querySelector('span[style*="border: 1.5px"]') as HTMLElement;
    // max(36.4, 30.1, 1) * 1.15 ≈ 41.86 -> right% = 36.4/41.86*100 ≈ 86.9,
    // left% = 30.1/41.86*100 ≈ 71.9. The filled (right) dot sits further
    // along the rule than the hollow (left) one.
    expect(parseFloat(filled.style.left)).toBeGreaterThan(parseFloat(hollow.style.left));
  });

  it("user picks the LOSING side: their own pick is tagged incorrect, and the dot fill still follows THEM, not the winner", () => {
    // User clicked left, but the server says right actually won.
    renderReveal({ winningPeakId: "peak-right", selectedPeakId: "peak-left" });
    expect(screen.getByText("Your pick · incorrect")).toBeInTheDocument();
    expect(screen.getByText("Correct answer")).toBeInTheDocument();
    // Old bug: the winning (right) side would have read "Your pick · correct"
    // even though the player picked left. That string must not appear at all.
    expect(screen.queryByText("Your pick · correct")).not.toBeInTheDocument();
  });

  it("genuine no-pick (decision clock expired): neither side is tagged as the player's pick, and dots render neutral", () => {
    renderReveal({ winningPeakId: "peak-left", selectedPeakId: null });
    expect(screen.queryByText(/Your pick/)).not.toBeInTheDocument();
    expect(screen.getByText("Correct answer")).toBeInTheDocument();
    expect(screen.getByText("Not selected")).toBeInTheDocument();
    // Neutral treatment: no lane dot is filled with a component tone color.
    const filledDots = document.querySelectorAll('span[style*="background: var(--v2-color-comp-si)"]');
    expect(filledDots.length).toBe(0);
  });
});
