/**
 * Peak Duel Daily: the ten-second decision clock, left/right side identity
 * through the reveal, and the manual-only advance out of the reveal (no
 * auto-advance anywhere in the loop — rounds 1-9 and round 10 both wait for
 * an explicit press).
 *
 * `submitAnswer`/`postDailyResult` are mocked — this suite is about the game
 * loop's own state machine and timing, not the network layer. `ArenaTimer`'s
 * own tick behavior is already covered by arena-timer.test.tsx; here it is
 * exercised end-to-end only to prove GameEngine wires expiry to a real
 * no-pick submission.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";

import { GameEngine } from "@/components/game/game-engine";
import type { Duel, AnswerResponse } from "@/types";

const submitAnswer = vi.fn();
const postDailyResult = vi.fn();
// V2's completion screen (`PeakDuelV2History`) fetches the server's Peak
// Duel Daily history to merge with the local snapshot; empty by default so
// mounting it in these state-machine/timing tests never needs a real
// network call.
const getDailyHistory = vi.fn(() => Promise.resolve({ entries: [] }));

vi.mock("@/lib/api", () => ({
  submitAnswer: (...args: unknown[]) => submitAnswer(...args),
  postDailyResult: (...args: unknown[]) => postDailyResult(...args),
  getDailyHistory: () => getDailyHistory(),
}));

vi.mock("@/lib/progress", () => ({
  getProgressRepository: () => ({
    recordDailyCompletion: vi.fn(),
    recordAnswer: vi.fn(),
    updateEndlessScore: vi.fn(),
    getDailyCompletion: vi.fn(() => null),
    // V2's completion screen (`PeakDuelV2History`) reads the local snapshot
    // of daily completions to merge with the server's own history — same
    // repo the legacy screen already read via other methods above.
    getAll: vi.fn(() => ({ daily_completions: {} })),
  }),
}));

function mockDuel(id: string, leftName = "Left Player", rightName = "Right Player"): Duel {
  return {
    id,
    left: {
      player_name: leftName,
      player_slug: "left-player",
      duration_years: 3,
      start_season: "1990-91",
      end_season: "1992-93",
      anchor_season: "1990-91",
      peak_id: `left-${id}`,
    },
    right: {
      player_name: rightName,
      player_slug: "right-player",
      duration_years: 3,
      start_season: "2010-11",
      end_season: "2012-13",
      anchor_season: "2010-11",
      peak_id: `right-${id}`,
    },
    difficulty: "Tricky",
  };
}

function mockAnswer(opts: {
  correct: boolean;
  winningPeakId: string;
  winnerSlug: string;
  loserSlug: string;
}): AnswerResponse {
  const winner = {
    id: `${opts.winnerSlug}-window`,
    player_id: opts.winnerSlug,
    player_slug: opts.winnerSlug,
    player_name: opts.winnerSlug === "left-player" ? "Left Player" : "Right Player",
    duration_years: 3,
    start_season: "1990-91",
    end_season: "1992-93",
    anchor_season: "1990-91",
    rank: 1,
    prime_score: 95.0,
    prime_index: 85.0,
    components: {
      statistical_impact: 37.0,
      traditional_production: 14.0,
      individual_recognition: 20.0,
      postseason_individual_value: 12.0,
      team_achievement: 3.0,
      teammate_adjustment: -0.2,
    },
    data_status: "complete" as const,
  };
  const loser = {
    ...winner,
    id: `${opts.loserSlug}-window`,
    player_id: opts.loserSlug,
    player_slug: opts.loserSlug,
    player_name: opts.loserSlug === "left-player" ? "Left Player" : "Right Player",
    rank: 2,
    prime_score: 90.0,
    prime_index: 80.0,
  };
  return {
    correct: opts.correct,
    winning_peak_id: opts.winningPeakId,
    arena_points_awarded: opts.correct ? 200 : 0,
    updated_streak: opts.correct ? 1 : 0,
    difficulty: "Tricky",
    score_gap: 5.0,
    winner,
    loser,
    component_comparison: {
      statistical_impact: { winner: 37.0, loser: 35.0, winner_leads: true },
      traditional_production: { winner: 14.0, loser: 14.0, winner_leads: true },
      individual_recognition: { winner: 20.0, loser: 18.0, winner_leads: true },
      postseason_individual_value: { winner: 12.0, loser: 9.0, winner_leads: true },
      team_achievement: { winner: 3.0, loser: 3.0, winner_leads: true },
      teammate_adjustment: { winner: -0.2, loser: -0.1, winner_leads: false },
    },
    explanation: "The margin came down to Postseason Value.",
    selected_correctly: opts.correct,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  submitAnswer.mockReset();
  postDailyResult.mockReset();
  postDailyResult.mockResolvedValue({
    saved: true,
    already_recorded: false,
    daily_key: "2026-08-16",
    duration_years: 3,
    duels_total: 1,
    correct_count: 0,
    arena_points: 0,
    best_streak: 0,
    played_on_daily_key: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the ten-second decision clock", () => {
  it("auto-submits a null pick and reveals when the clock expires", async () => {
    const duel = mockDuel("d1");
    submitAnswer.mockResolvedValue(
      mockAnswer({
        correct: false,
        winningPeakId: duel.left.peak_id,
        winnerSlug: "left-player",
        loserSlug: "right-player",
      })
    );

    render(
      <GameEngine
        mode="daily"
        years={3}
        duels={[duel]}
        session_token="token"
        date="2026-08-16"
      />
    );

    expect(screen.getByTestId("peak-duel-decision-clock")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(10250);
    });

    expect(submitAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ duel_id: duel.id, selected_peak_id: null })
    );
    expect(screen.getByText("Not quite.")).toBeInTheDocument();
  });

  it("does not render a decision clock in endless mode", () => {
    render(
      <GameEngine
        mode="endless"
        years={3}
        duels={[mockDuel("d1")]}
        session_token="token"
      />
    );
    expect(screen.queryByTestId("peak-duel-decision-clock")).toBeNull();
  });
});

describe("left/right side continuity", () => {
  it("keeps names on their original side through the reveal, even when the right side wins", async () => {
    const duel = mockDuel("d1", "Alpha Alpherson", "Beta Betason");
    submitAnswer.mockResolvedValue(
      mockAnswer({
        correct: true,
        winningPeakId: duel.right.peak_id,
        winnerSlug: "right-player",
        loserSlug: "left-player",
      })
    );

    render(
      <GameEngine
        mode="daily"
        years={3}
        duels={[duel]}
        session_token="token"
        date="2026-08-16"
      />
    );

    // Before the pick: left is left, right is right.
    expect(screen.getByTestId("duel-card-left")).toHaveTextContent("Alpha Alpherson");
    expect(screen.getByTestId("duel-card-right")).toHaveTextContent("Beta Betason");

    fireEvent.click(screen.getByTestId("duel-card-right"));
    await act(async () => {
      await Promise.resolve();
    });

    // After the reveal, the same names stay on the same sides — the winner
    // landing on the right must never re-sort it to a "winner slot".
    expect(screen.getByTestId("duel-card-left")).toHaveTextContent("Alpha Alpherson");
    expect(screen.getByTestId("duel-card-right")).toHaveTextContent("Beta Betason");
  });
});

describe("no auto-advance — every round waits for a manual press", () => {
  it("does not advance out of the reveal on its own, no matter how long it waits", async () => {
    const duels = [mockDuel("d1"), mockDuel("d2"), mockDuel("d3")];
    submitAnswer.mockResolvedValue(
      mockAnswer({
        correct: true,
        winningPeakId: duels[0].left.peak_id,
        winnerSlug: "left-player",
        loserSlug: "right-player",
      })
    );

    render(
      <GameEngine
        mode="daily"
        years={3}
        duels={duels}
        session_token="token"
        date="2026-08-16"
      />
    );

    fireEvent.click(screen.getByTestId("duel-card-left"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Correct!")).toBeInTheDocument();

    // Long past any plausible reveal-timer duration -- there is no timer to
    // fire, so this must still be sitting on duel 1's reveal.
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByText("Correct!")).toBeInTheDocument();
    expect(screen.queryByText("2 of 3")).toBeNull();
  });

  it("a manual press advances exactly one round", async () => {
    const duels = [mockDuel("d1"), mockDuel("d2"), mockDuel("d3")];
    submitAnswer.mockResolvedValue(
      mockAnswer({
        correct: true,
        winningPeakId: duels[0].left.peak_id,
        winnerSlug: "left-player",
        loserSlug: "right-player",
      })
    );

    render(
      <GameEngine
        mode="daily"
        years={3}
        duels={duels}
        session_token="token"
        date="2026-08-16"
      />
    );

    fireEvent.click(screen.getByTestId("duel-card-left"));
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByText("Next Matchup"));
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
  });

  it("double-clicking the advance control cannot skip a round", async () => {
    const duels = [mockDuel("d1"), mockDuel("d2"), mockDuel("d3")];
    submitAnswer.mockResolvedValue(
      mockAnswer({
        correct: true,
        winningPeakId: duels[0].left.peak_id,
        winnerSlug: "left-player",
        loserSlug: "right-player",
      })
    );

    render(
      <GameEngine
        mode="daily"
        years={3}
        duels={duels}
        session_token="token"
        date="2026-08-16"
      />
    );

    fireEvent.click(screen.getByTestId("duel-card-left"));
    await act(async () => {
      await Promise.resolve();
    });

    // Two rapid clicks on the same advance control (a real double-click) --
    // the underlying reducer's own guard (`phase !== "revealing"` -> no-op,
    // covered directly in game-state.test.ts) is what actually makes the
    // second press inert; this asserts the observable outcome end-to-end:
    // exactly one duel skipped, never two.
    const nextButton = screen.getByText("Next Matchup");
    fireEvent.click(nextButton);
    fireEvent.click(nextButton);
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    expect(screen.queryByText("3 of 3")).toBeNull();
  });

  it("does not advance out of the final round — it waits for a manual press", async () => {
    const duels = [mockDuel("d1")];
    submitAnswer.mockResolvedValue(
      mockAnswer({
        correct: true,
        winningPeakId: duels[0].left.peak_id,
        winnerSlug: "left-player",
        loserSlug: "right-player",
      })
    );

    render(
      <GameEngine
        mode="daily"
        years={3}
        duels={duels}
        session_token="token"
        date="2026-08-16"
      />
    );

    fireEvent.click(screen.getByTestId("duel-card-left"));
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    // Still on the reveal, not swept into the summary screen by a timer.
    expect(screen.getByText("See results")).toBeInTheDocument();
  });

  it("round 10 (the final round) still completes via the manual press", async () => {
    const duels = [mockDuel("d1")];
    submitAnswer.mockResolvedValue(
      mockAnswer({
        correct: true,
        winningPeakId: duels[0].left.peak_id,
        winnerSlug: "left-player",
        loserSlug: "right-player",
      })
    );

    render(
      <GameEngine
        mode="daily"
        years={3}
        duels={duels}
        session_token="token"
        date="2026-08-16"
      />
    );

    fireEvent.click(screen.getByTestId("duel-card-left"));
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByText("See results"));
    // The reveal is gone -- ChallengeSummary (or its V2 equivalent) has taken
    // over, same completion flow as before this pass.
    expect(screen.queryByText("See results")).toBeNull();
  });
});
