/**
 * Phase 8D: PlayAgainPanel -- the end-of-run "loop, not a dead end" panel.
 * Play Again must always be available; the personal-best comparison line is
 * additive and only appears for a signed-in user with the leaderboard
 * feature on, reusing getMyRuns/getLeaderboard (never a parallel "best run"
 * store of its own).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";

const mockUser = vi.fn();
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: mockUser() }),
}));
vi.mock("@/lib/auth", () => ({
  getAccessToken: vi.fn().mockResolvedValue("fake-token"),
}));
const mockGetLeaderboard = vi.fn();
const mockGetMyRuns = vi.fn();
vi.mock("@/lib/perfect-season-api", () => ({
  getLeaderboard: (...args: unknown[]) => mockGetLeaderboard(...args),
  getMyRuns: (...args: unknown[]) => mockGetMyRuns(...args),
}));

import PlayAgainPanel from "@/components/court/PlayAgainPanel";

function run(overrides: Partial<{ wins: number; losses: number; lineup_score: number; mode: string }> = {}) {
  return {
    id: "r1",
    display_name: "Player",
    mode: "apex_1y",
    game_type: "court",
    seed: 1,
    wins: 70,
    losses: 12,
    lineup_score: 80,
    score_status: "complete",
    exact_cards_scored: 8,
    total_cards: 8,
    team_respins_used: 0,
    season_respins_used: 0,
    data_version: null,
    formula_version: null,
    simulation_version: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("PlayAgainPanel", () => {
  beforeEach(() => {
    mockUser.mockReset();
    mockGetLeaderboard.mockReset();
    mockGetMyRuns.mockReset();
  });

  it("always renders a working Play Again button, even signed out", async () => {
    mockUser.mockReturnValue(null);
    mockGetLeaderboard.mockResolvedValue({ leaderboard_enabled: true, runs: [] });
    const onPlayAgain = vi.fn();
    render(<PlayAgainPanel mode="apex_1y" wins={82} losses={0} lineupPeakScore={95} onPlayAgain={onPlayAgain} busy={false} />);

    const btn = await screen.findByTestId("play-again-btn");
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("personal-best-compare")).not.toBeInTheDocument();
  });

  it("shows a sign-in-to-save prompt when signed out and the leaderboard feature is on", async () => {
    mockUser.mockReturnValue(null);
    mockGetLeaderboard.mockResolvedValue({ leaderboard_enabled: true, runs: [] });
    render(<PlayAgainPanel mode="apex_1y" wins={70} losses={12} lineupPeakScore={80} onPlayAgain={vi.fn()} busy={false} />);

    const prompt = await screen.findByTestId("play-again-signin-prompt");
    expect(prompt).toHaveTextContent(/sign in to save your best run/i);
    // The CTA carries the current page as ?returnTo= so signing in from a
    // result screen comes back to the result, not to the homepage. The
    // sign-in page re-validates the value with safeNext().
    const link = screen.getByRole("link", { name: /sign in/i });
    const href = link.getAttribute("href") ?? "";
    expect(href.startsWith("/signin?returnTo=")).toBe(true);
    expect(decodeURIComponent(href.split("returnTo=")[1])).toMatch(/^\//);
  });

  it("hides the sign-in prompt when the leaderboard feature is off, even signed out", async () => {
    mockUser.mockReturnValue(null);
    mockGetLeaderboard.mockResolvedValue({ leaderboard_enabled: false, runs: [] });
    render(<PlayAgainPanel mode="apex_1y" wins={70} losses={12} lineupPeakScore={80} onPlayAgain={vi.fn()} busy={false} />);

    await screen.findByTestId("play-again-btn");
    expect(screen.queryByTestId("play-again-signin-prompt")).not.toBeInTheDocument();
  });

  it("hides the sign-in prompt once the user is signed in", async () => {
    mockUser.mockReturnValue({ id: "u1" });
    mockGetLeaderboard.mockResolvedValue({ leaderboard_enabled: true, runs: [] });
    mockGetMyRuns.mockResolvedValue({ runs: [] });
    render(<PlayAgainPanel mode="apex_1y" wins={70} losses={12} lineupPeakScore={80} onPlayAgain={vi.fn()} busy={false} />);

    await screen.findByTestId("personal-best-compare");
    expect(screen.queryByTestId("play-again-signin-prompt")).not.toBeInTheDocument();
  });

  it("disables Play Again while busy", async () => {
    mockUser.mockReturnValue(null);
    mockGetLeaderboard.mockResolvedValue({ leaderboard_enabled: false, runs: [] });
    render(<PlayAgainPanel mode="apex_1y" wins={50} losses={32} lineupPeakScore={60} onPlayAgain={vi.fn()} busy={true} />);
    expect(await screen.findByTestId("play-again-btn")).toBeDisabled();
  });

  it("shows 'first submitted run' framing for a signed-in user with no prior runs in this mode", async () => {
    mockUser.mockReturnValue({ id: "u1" });
    mockGetLeaderboard.mockResolvedValue({ leaderboard_enabled: true, runs: [] });
    mockGetMyRuns.mockResolvedValue({ runs: [] });
    render(<PlayAgainPanel mode="apex_1y" wins={60} losses={22} lineupPeakScore={70} onPlayAgain={vi.fn()} busy={false} />);

    await waitFor(() => {
      expect(screen.getByTestId("personal-best-compare")).toHaveTextContent(/first submitted run/i);
    });
  });

  it("declares a new personal best when this run's wins beat the stored best", async () => {
    mockUser.mockReturnValue({ id: "u1" });
    mockGetLeaderboard.mockResolvedValue({ leaderboard_enabled: true, runs: [] });
    mockGetMyRuns.mockResolvedValue({ runs: [run({ wins: 65, losses: 17, lineup_score: 78 })] });
    render(<PlayAgainPanel mode="apex_1y" wins={70} losses={12} lineupPeakScore={80} onPlayAgain={vi.fn()} busy={false} />);

    await waitFor(() => {
      expect(screen.getByTestId("personal-best-compare")).toHaveTextContent(/New personal best/i);
      expect(screen.getByTestId("personal-best-compare")).toHaveTextContent(/65-17/);
    });
  });

  it("shows the stored best (not a new-best claim) when this run does not beat it", async () => {
    mockUser.mockReturnValue({ id: "u1" });
    mockGetLeaderboard.mockResolvedValue({ leaderboard_enabled: true, runs: [] });
    mockGetMyRuns.mockResolvedValue({ runs: [run({ wins: 78, losses: 4, lineup_score: 88 })] });
    render(<PlayAgainPanel mode="apex_1y" wins={70} losses={12} lineupPeakScore={80} onPlayAgain={vi.fn()} busy={false} />);

    await waitFor(() => {
      const el = screen.getByTestId("personal-best-compare");
      expect(el).toHaveTextContent(/Your best in this mode/i);
      expect(el).toHaveTextContent(/78-4/);
      expect(el).not.toHaveTextContent(/New personal best/i);
    });
  });

  it("only compares against runs in the SAME mode, ignoring other modes' history", async () => {
    mockUser.mockReturnValue({ id: "u1" });
    mockGetLeaderboard.mockResolvedValue({ leaderboard_enabled: true, runs: [] });
    mockGetMyRuns.mockResolvedValue({
      runs: [run({ mode: "prime_3y", wins: 82, losses: 0, lineup_score: 99 })],
    });
    render(<PlayAgainPanel mode="apex_1y" wins={70} losses={12} lineupPeakScore={80} onPlayAgain={vi.fn()} busy={false} />);

    await waitFor(() => {
      expect(screen.getByTestId("personal-best-compare")).toHaveTextContent(/first submitted run/i);
    });
  });

  it("hides the comparison line entirely when the leaderboard feature is off", async () => {
    mockUser.mockReturnValue({ id: "u1" });
    mockGetLeaderboard.mockResolvedValue({ leaderboard_enabled: false, runs: [] });
    render(<PlayAgainPanel mode="apex_1y" wins={70} losses={12} lineupPeakScore={80} onPlayAgain={vi.fn()} busy={false} />);

    await screen.findByTestId("play-again-btn");
    expect(mockGetMyRuns).not.toHaveBeenCalled();
    expect(screen.queryByTestId("personal-best-compare")).not.toBeInTheDocument();
  });
});
