/**
 * The homepage's two new P3-H sections: `ComponentComparison` (real
 * methodology rows, click-to-explain, deep links into `/rankings`) and
 * `LeaderboardPreview` (real 82-0 top rows, daily status, personal best
 * only when signed in).
 *
 * Both degrade honestly with the API down/disabled rather than rendering a
 * placeholder — the behaviors pinned here are exactly that degradation,
 * plus the deep-link hrefs the homepage promises the rankings page will
 * honor (`rankings/page.tsx`'s `readSortFromLocation`).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import type { Methodology } from "@/types";

afterEach(() => {
  cleanup();
  // `clearAllMocks`, not `restoreAllMocks`: the latter reverts a `vi.fn()`
  // created inside a `vi.mock` factory to no implementation at all, which
  // silently wiped `getAccessToken`'s `mockResolvedValue` after the first
  // test that used it and made every later call return `undefined`.
  vi.clearAllMocks();
});

/* ------------------------------------------------------------------ */
/* ComponentComparison                                                 */
/* ------------------------------------------------------------------ */

const METHODOLOGY: Methodology = {
  weights: {
    statistical_impact: 0.38,
    traditional_production: 0.21,
    individual_recognition: 0.2,
    postseason_individual_value: 0.18,
    team_achievement: 0.03,
  },
  components: [
    {
      id: "statistical_impact",
      label: "Statistical Impact",
      weight: 0.38,
      weight_pct: 38,
      short_description: "Advanced per-possession impact metrics.",
      long_description: "The full, longer explanation of statistical impact.",
      key_inputs: ["BPM", "Win Shares"],
      common_misconceptions: [],
    },
    {
      id: "team_achievement",
      label: "Team Result",
      weight: 0.03,
      weight_pct: 3,
      short_description: "What the team actually accomplished.",
      long_description: "The full, longer explanation of team result.",
      key_inputs: ["Wins", "Playoff round"],
      common_misconceptions: [],
    },
  ],
  teammate_adjustment: { id: "teammate_adjustment", label: "Teammate Adj.", description: "", range: [-5, 5] },
  calibration: { description: "", raw_label: "", display_label: "" },
  window_aggregation: {} as Methodology["window_aggregation"],
};

import ComponentComparison from "@/components/home/ComponentComparison";

describe("ComponentComparison", () => {
  it("renders nothing when methodology could not be reached", () => {
    const { container } = render(<ComponentComparison methodology={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one row per real component, with its real weight", () => {
    render(<ComponentComparison methodology={METHODOLOGY} />);
    expect(screen.getByText("Statistical Impact")).toBeInTheDocument();
    expect(screen.getByText("38%")).toBeInTheDocument();
    expect(screen.getByText("Team Result")).toBeInTheDocument();
    expect(screen.getByText("3%")).toBeInTheDocument();
  });

  it("is collapsed by default and expands the real long-form explanation on click", async () => {
    const user = userEvent.setup();
    render(<ComponentComparison methodology={METHODOLOGY} />);
    expect(screen.queryByText("The full, longer explanation of statistical impact.")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("home-comparison-toggle-statistical_impact"));
    expect(screen.getByText("The full, longer explanation of statistical impact.")).toBeInTheDocument();
    expect(screen.getByText("BPM")).toBeInTheDocument();
  });

  it("links each expanded row into /rankings sorted by that exact component", async () => {
    const user = userEvent.setup();
    render(<ComponentComparison methodology={METHODOLOGY} />);
    await user.click(screen.getByTestId("home-comparison-toggle-team_achievement"));
    const link = screen.getByTestId("home-comparison-see-rankings-team_achievement");
    expect(link).toHaveAttribute("href", "/rankings?sort=team_achievement");
  });
});

/* ------------------------------------------------------------------ */
/* LeaderboardPreview                                                  */
/* ------------------------------------------------------------------ */

const authState: { user: null | { id: string; email?: string }; supabaseEnabled: boolean } = {
  user: null,
  supabaseEnabled: true,
};

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => authState,
}));
vi.mock("@/lib/auth", () => ({
  getAccessToken: vi.fn().mockResolvedValue("fake-token"),
}));

const mockGetLeaderboard = vi.fn();
const mockGetDailyChallenge = vi.fn();
const mockGetMyPersonalBests = vi.fn();
vi.mock("@/lib/perfect-season-api", () => ({
  getLeaderboard: (...args: unknown[]) => mockGetLeaderboard(...args),
  getDailyChallenge: (...args: unknown[]) => mockGetDailyChallenge(...args),
  getMyPersonalBests: (...args: unknown[]) => mockGetMyPersonalBests(...args),
}));

import LeaderboardPreview from "@/components/home/LeaderboardPreview";

describe("LeaderboardPreview", () => {
  it("shows the disabled message, not an empty table, when the leaderboard is off", async () => {
    authState.user = null;
    mockGetLeaderboard.mockResolvedValue({ leaderboard_enabled: false, runs: [], next_cursor: null });
    mockGetDailyChallenge.mockResolvedValue({ already_played: false });

    render(<LeaderboardPreview />);
    await waitFor(() => {
      expect(screen.getByTestId("home-leaderboard-preview-disabled")).toBeInTheDocument();
    });
  });

  it("renders real top rows, ranked, from the leaderboard response", async () => {
    authState.user = null;
    mockGetLeaderboard.mockResolvedValue({
      leaderboard_enabled: true,
      next_cursor: null,
      runs: [
        { id: "r1", display_name: "Ada L.", wins: 5, losses: 0 },
        { id: "r2", display_name: "Grace H.", wins: 4, losses: 1 },
      ],
    });
    mockGetDailyChallenge.mockResolvedValue({ already_played: true });

    render(<LeaderboardPreview />);
    const rows = await screen.findByTestId("home-leaderboard-top-rows");
    expect(within(rows).getByText("Ada L.")).toBeInTheDocument();
    expect(within(rows).getByText("5-0")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("You've played today's board.")).toBeInTheDocument());
  });

  it("shows no personal-best row for a signed-out visitor, and never calls the authenticated endpoint", async () => {
    authState.user = null;
    mockGetLeaderboard.mockResolvedValue({ leaderboard_enabled: true, runs: [], next_cursor: null });
    mockGetDailyChallenge.mockResolvedValue({ already_played: false });

    render(<LeaderboardPreview />);
    await waitFor(() => expect(screen.getByText("Sign in to track your own personal best.")).toBeInTheDocument());
    expect(mockGetMyPersonalBests).not.toHaveBeenCalled();
  });

  it("shows a signed-in visitor's real personal best", async () => {
    authState.user = { id: "u1", email: "ada@example.com" };
    mockGetLeaderboard.mockResolvedValue({ leaderboard_enabled: true, runs: [], next_cursor: null });
    mockGetDailyChallenge.mockResolvedValue({ already_played: false });
    mockGetMyPersonalBests.mockResolvedValue({
      total_runs: 4,
      best_lineup_score: 87.3,
      best_run: null,
      best_wins: null,
      best_lineup_score_run: null,
      best_daily_run: null,
      perfect_season_count: 0,
      recent_runs: [],
    });

    render(<LeaderboardPreview />);
    const best = await screen.findByTestId("home-leaderboard-personal-best");
    expect(best).toHaveTextContent("87.3");
    expect(best).toHaveTextContent("4 runs");
  });
});
