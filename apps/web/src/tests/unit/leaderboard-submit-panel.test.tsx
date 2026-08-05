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
const mockSubmitRun = vi.fn();
vi.mock("@/lib/perfect-season-api", () => ({
  getLeaderboard: vi.fn().mockResolvedValue({ leaderboard_enabled: true, runs: [] }),
  submitRun: (...args: unknown[]) => mockSubmitRun(...args),
  // Mirrors the real class's (status, detail, code) constructor -- a test
  // asserting on `.code` needs the mock to actually carry one.
  PerfectSeasonAPIError: class PerfectSeasonAPIError extends Error {
    constructor(
      public status: number,
      detail: string,
      public code?: string,
    ) {
      super(detail);
    }
  },
}));

import LeaderboardSubmitPanel from "@/components/court/LeaderboardSubmitPanel";
import { PerfectSeasonAPIError } from "@/lib/perfect-season-api";
import userEvent from "@testing-library/user-event";

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

/**
 * Launch-polish: the server now refuses `submit_run` with 400
 * `handle_required` once a public handle is mandatory for a leaderboard
 * submission -- and the handle-onboarding prompt deliberately never blocks
 * gameplay, so a player CAN reach a finished, eligible run and be refused
 * here having never set one. A generic error string would leave them to
 * guess that "handle" means the profile page; this is the one-click route
 * out that closes that gap.
 */
describe("LeaderboardSubmitPanel handle_required handling", () => {
  it("offers a direct link to /profile when the server refuses with handle_required", async () => {
    const user = userEvent.setup();
    mockSubmitRun.mockRejectedValueOnce(
      new PerfectSeasonAPIError(400, "A public handle is required to submit to the leaderboard.", "handle_required"),
    );
    render(<LeaderboardSubmitPanel gameId="g1" mode="apex_1y" lineupScoreStatus="complete" />);

    await user.click(await screen.findByTestId("leaderboard-submit-btn"));

    const error = await screen.findByTestId("leaderboard-submit-error");
    expect(error).toHaveTextContent(/public handle is required/i);
    const link = screen.getByTestId("leaderboard-submit-handle-link");
    expect(link).toHaveAttribute("href", "/profile");
    expect(link).toHaveTextContent(/set up your public handle/i);
  });

  it("does not offer the handle link for an unrelated submit failure", async () => {
    const user = userEvent.setup();
    mockSubmitRun.mockRejectedValueOnce(
      new PerfectSeasonAPIError(500, "Something went wrong on our end.", "internal_error"),
    );
    render(<LeaderboardSubmitPanel gameId="g1" mode="apex_1y" lineupScoreStatus="complete" />);

    await user.click(await screen.findByTestId("leaderboard-submit-btn"));

    await screen.findByTestId("leaderboard-submit-error");
    expect(screen.queryByTestId("leaderboard-submit-handle-link")).not.toBeInTheDocument();
  });
});
