/**
 * Phase 9A: SaveRunPanel -- anonymous vs signed-in behavior, and the
 * personal-best comparison verdict.
 *
 * Three properties worth pinning down, because each was a deliberate choice:
 *   - An anonymous visitor gets a sign-in CTA that NAMES the benefit, never a
 *     disabled control or an error. Play is anonymous-friendly; only durable
 *     history needs an account.
 *   - The comparison verdict is whatever the SERVER said (the tiebreaker
 *     rules live in app/repositories/saved_run_ranking.py) -- this component
 *     must not recompute it, so a "below personal best" response must render
 *     as "below", not be second-guessed into something friendlier.
 *   - "Tied" is its own positive-toned outcome, not folded into "below".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const mockUseAuth = vi.fn();
const mockSaveRun = vi.fn();
const mockGetMyPersonalBests = vi.fn();

vi.mock("@/lib/auth-context", () => ({ useAuth: () => mockUseAuth() }));
vi.mock("@/lib/auth", () => ({ getAccessToken: vi.fn().mockResolvedValue("fake-token") }));
vi.mock("@/lib/perfect-season-api", () => ({
  saveRun: (...a: unknown[]) => mockSaveRun(...a),
  getMyPersonalBests: (...a: unknown[]) => mockGetMyPersonalBests(...a),
  PerfectSeasonAPIError: class PerfectSeasonAPIError extends Error {
    code?: string;
  },
}));

import SaveRunPanel from "@/components/court/SaveRunPanel";

function makeSavedRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    game_id: "g1",
    mode: "apex_1y",
    seed: 1,
    wins: 60,
    losses: 22,
    lineup_score: 55.5,
    score_status: "complete",
    exact_cards_scored: 8,
    total_cards: 8,
    leaderboard_eligible: true,
    challenge_kind: "free_play",
    challenge_date: null,
    is_perfect_season: false,
    team_respins_used: 0,
    season_respins_used: 0,
    roster: [],
    spin_history: [],
    peak_picks_matched: null,
    peak_picks_total: null,
    data_version: null,
    formula_version: null,
    simulation_version: null,
    created_at: "2026-07-29T00:00:00Z",
    ...overrides,
  };
}

function makeBests(overrides: Record<string, unknown> = {}) {
  return {
    total_runs: 1,
    best_run: makeSavedRun(),
    best_wins: 60,
    best_lineup_score: 55.5,
    best_lineup_score_run: makeSavedRun(),
    best_daily_run: null,
    perfect_season_count: 0,
    recent_runs: [],
    ...overrides,
  };
}

describe("SaveRunPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMyPersonalBests.mockResolvedValue(makeBests({ total_runs: 0, best_run: null, best_wins: null }));
  });

  it("shows a sign-in CTA naming the benefit for an anonymous visitor -- never a save button", async () => {
    mockUseAuth.mockReturnValue({ user: null });
    render(<SaveRunPanel gameId="g1" wins={60} savable />);

    expect(screen.getByTestId("save-run-signin-cta")).toBeInTheDocument();
    expect(screen.getByText(/personal bests/i)).toBeInTheDocument();
    expect(screen.queryByTestId("save-run-btn")).not.toBeInTheDocument();
    // And nothing is fetched for a user who has no account to fetch for.
    expect(mockGetMyPersonalBests).not.toHaveBeenCalled();
  });

  it("shows a live save button for a signed-in user", async () => {
    mockUseAuth.mockReturnValue({ user: { id: "u1" } });
    render(<SaveRunPanel gameId="g1" wins={60} savable />);

    await waitFor(() => expect(screen.getByTestId("save-run-btn")).toBeEnabled());
    expect(screen.queryByTestId("save-run-signin-cta")).not.toBeInTheDocument();
  });

  it("renders 'New personal best!' when the server says so", async () => {
    mockUseAuth.mockReturnValue({ user: { id: "u1" } });
    mockSaveRun.mockResolvedValue({
      saved_run: makeSavedRun(),
      comparison: "new_personal_best",
      already_saved: false,
      personal_bests: makeBests(),
    });
    render(<SaveRunPanel gameId="g1" wins={60} savable />);

    await userEvent.click(await screen.findByTestId("save-run-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("personal-best-comparison")).toHaveTextContent(/New personal best/i);
    });
    expect(screen.getByTestId("save-run-saved-status")).toHaveTextContent(/Saved to your history/i);
  });

  it("renders 'Tied your personal best' as its own outcome, not as 'below'", async () => {
    mockUseAuth.mockReturnValue({ user: { id: "u1" } });
    mockSaveRun.mockResolvedValue({
      saved_run: makeSavedRun(),
      comparison: "tied_personal_best",
      already_saved: false,
      personal_bests: makeBests(),
    });
    render(<SaveRunPanel gameId="g1" wins={60} savable />);

    await userEvent.click(await screen.findByTestId("save-run-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("personal-best-comparison")).toHaveTextContent(/Tied your personal best/i);
    });
    expect(screen.getByTestId("personal-best-comparison")).not.toHaveTextContent(/below/i);
  });

  it("reports a below-best run honestly rather than softening it", async () => {
    mockUseAuth.mockReturnValue({ user: { id: "u1" } });
    mockSaveRun.mockResolvedValue({
      saved_run: makeSavedRun({ wins: 40, losses: 42 }),
      comparison: "below_personal_best",
      already_saved: false,
      personal_bests: makeBests(),
    });
    render(<SaveRunPanel gameId="g1" wins={40} savable />);

    await userEvent.click(await screen.findByTestId("save-run-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("personal-best-comparison")).toHaveTextContent(/Below your personal best/i);
    });
  });

  it("says 'Already in your history' for an idempotent re-save", async () => {
    mockUseAuth.mockReturnValue({ user: { id: "u1" } });
    mockSaveRun.mockResolvedValue({
      saved_run: makeSavedRun(),
      comparison: "first_run",
      already_saved: true,
      personal_bests: makeBests(),
    });
    render(<SaveRunPanel gameId="g1" wins={60} savable />);

    await userEvent.click(await screen.findByTestId("save-run-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("save-run-saved-status")).toHaveTextContent(/Already in your history/i);
    });
  });

  it("surfaces a save failure inline without losing the panel", async () => {
    mockUseAuth.mockReturnValue({ user: { id: "u1" } });
    mockSaveRun.mockRejectedValue(new Error("boom"));
    render(<SaveRunPanel gameId="g1" wins={60} savable />);

    await userEvent.click(await screen.findByTestId("save-run-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("save-run-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("save-run-btn")).toBeInTheDocument();
  });

  it("renders nothing on a read-only shared result (saving is an owner action)", () => {
    mockUseAuth.mockReturnValue({ user: { id: "u1" } });
    const { container } = render(<SaveRunPanel gameId="g1" wins={60} savable readOnly />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the server says the run isn't savable yet", () => {
    mockUseAuth.mockReturnValue({ user: { id: "u1" } });
    const { container } = render(<SaveRunPanel gameId="g1" wins={60} savable={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the existing best as context before saving, so 'can I beat it?' is answerable", async () => {
    mockUseAuth.mockReturnValue({ user: { id: "u1" } });
    mockGetMyPersonalBests.mockResolvedValue(makeBests({ best_run: makeSavedRun({ wins: 61, losses: 21 }) }));
    render(<SaveRunPanel gameId="g1" wins={45} savable />);

    await waitFor(() => {
      expect(screen.getByText(/Your best so far: 61-21/)).toBeInTheDocument();
    });
    expect(screen.getByText(/This run: 45-37/)).toBeInTheDocument();
  });
});
