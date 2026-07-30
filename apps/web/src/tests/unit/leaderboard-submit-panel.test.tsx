/**
 * Phase 8C: LeaderboardSubmitPanel's proactive incomplete-score handling.
 *
 * The backend (apps/api/app/api/v1/perfect_season.py::submit_run) always
 * rejects an incomplete-score submission with incomplete_score_not_eligible
 * -- this proves the frontend shows that state UP FRONT (disabled button +
 * explanation) rather than only after a failed submit click, and that a
 * complete-score run still gets the normal, live submit button.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { id: "u1", email: "player@example.com" } }),
}));
vi.mock("@/lib/auth", () => ({
  getAccessToken: vi.fn().mockResolvedValue("fake-token"),
}));
vi.mock("@/lib/perfect-season-api", () => ({
  getLeaderboard: vi.fn().mockResolvedValue({ leaderboard_enabled: true, runs: [] }),
  submitRun: vi.fn(),
  PerfectSeasonAPIError: class PerfectSeasonAPIError extends Error {},
}));

import LeaderboardSubmitPanel from "@/components/court/LeaderboardSubmitPanel";

describe("LeaderboardSubmitPanel incomplete-score handling", () => {
  it("shows a disabled, explained state up front for an incomplete-score run -- never a live-looking submit button", async () => {
    render(<LeaderboardSubmitPanel gameId="g1" mode="apex_1y" lineupScoreStatus="incomplete" />);

    await waitFor(() => {
      expect(screen.getByTestId("leaderboard-ineligible-incomplete")).toBeInTheDocument();
    });
    expect(screen.getByText(/Not eligible yet/i)).toBeDisabled();
    expect(screen.queryByTestId("leaderboard-submit-btn")).not.toBeInTheDocument();
  });

  it("shows the normal live submit button for a complete-score run", async () => {
    render(<LeaderboardSubmitPanel gameId="g1" mode="apex_1y" lineupScoreStatus="complete" />);

    await waitFor(() => {
      expect(screen.getByTestId("leaderboard-submit-btn")).toBeInTheDocument();
    });
    expect(screen.getByTestId("leaderboard-submit-btn")).toBeEnabled();
    expect(screen.queryByTestId("leaderboard-ineligible-incomplete")).not.toBeInTheDocument();
  });

  it("undefined lineupScoreStatus (legacy peak-window boards) behaves like a complete run", async () => {
    render(<LeaderboardSubmitPanel gameId="g1" mode="apex_1y" />);

    await waitFor(() => {
      expect(screen.getByTestId("leaderboard-submit-btn")).toBeInTheDocument();
    });
  });
});
