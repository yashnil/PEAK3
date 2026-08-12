/**
 * A2 — the Daily Grid daily leaderboard component.
 *
 * Everything ranked on this surface arrives ranked FROM THE SERVER: the mock
 * below returns responses in the exact shape of GET /daily-grid/leaderboard,
 * and the assertions check the component renders the server's ranks, its
 * `is_current_user` flags and its `you` block verbatim — never numbering,
 * sorting or inventing a placement of its own.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import React from "react";

const mockFetchLeaderboard = vi.fn();
vi.mock("@/lib/daily-grid-api", () => ({
  fetchDailyLeaderboard: (...a: unknown[]) => mockFetchLeaderboard(...a),
}));
const mockGetAccessToken = vi.fn(async () => null as string | null);
vi.mock("@/lib/auth", () => ({
  getAccessToken: () => mockGetAccessToken(),
}));
let authState: { user: { id: string } | null; supabaseEnabled: boolean } = {
  user: null,
  supabaseEnabled: true,
};
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => authState,
}));

import DailyLeaderboard, {
  formatCompletionTime,
} from "@/components/daily-grid/DailyLeaderboard";
import type { DailyLeaderboardResponse, DailyLeaderboardRow } from "@/lib/daily-grid-api";

function row(overrides: Partial<DailyLeaderboardRow> = {}): DailyLeaderboardRow {
  return {
    rank: 1,
    handle: "hoops-fan",
    score: 900,
    completion_time_ms: 42_800,
    is_current_user: false,
    ...overrides,
  };
}

function response(
  overrides: Partial<DailyLeaderboardResponse> = {},
): DailyLeaderboardResponse {
  return {
    daily_key: "2026-07-30",
    entries: [],
    total_listed: 0,
    you: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authState = { user: null, supabaseEnabled: true };
  mockGetAccessToken.mockResolvedValue(null);
});

describe("formatCompletionTime", () => {
  it("renders mm:ss.t and an em dash for a missing time", () => {
    expect(formatCompletionTime(42_800)).toBe("00:42.8");
    expect(formatCompletionTime(754_300)).toBe("12:34.3");
    expect(formatCompletionTime(0)).toBe("00:00.0");
    expect(formatCompletionTime(null)).toBe("—");
  });
});

describe("DailyLeaderboard", () => {
  it("renders the server's rows with the server's ranks, scores and times", async () => {
    mockFetchLeaderboard.mockResolvedValue(
      response({
        entries: [
          row({ rank: 1, handle: "alpha", score: 950, completion_time_ms: 40_000 }),
          row({ rank: 2, handle: "beta", score: 950, completion_time_ms: 55_500 }),
          row({ rank: 3, handle: "gamma", score: 900, completion_time_ms: null }),
        ],
        total_listed: 3,
      }),
    );
    render(<DailyLeaderboard date="2026-07-30" />);
    const first = await screen.findByTestId("daily-leaderboard-row-1");
    expect(first).toHaveTextContent("#1");
    expect(first).toHaveTextContent("alpha");
    expect(first).toHaveTextContent("950");
    expect(first).toHaveTextContent("00:40.0");
    expect(screen.getByTestId("daily-leaderboard-row-3")).toHaveTextContent("—");
    expect(screen.getByTestId("daily-leaderboard-count")).toHaveTextContent("3 on the board");
    // It asked the API for today's board, top 10.
    expect(mockFetchLeaderboard).toHaveBeenCalledWith(
      expect.objectContaining({ date: "2026-07-30", limit: 10 }),
    );
  });

  it("highlights the current user's row inside the top, marked 'you'", async () => {
    mockFetchLeaderboard.mockResolvedValue(
      response({
        entries: [
          row({ rank: 1, handle: "alpha" }),
          row({ rank: 2, handle: "me-myself", is_current_user: true, score: 880 }),
        ],
        total_listed: 2,
        you: {
          rank: 2,
          score: 880,
          completion_time_ms: 42_800,
          listed: true,
          has_handle: true,
          has_entry: true,
        },
      }),
    );
    render(<DailyLeaderboard date="2026-07-30" />);
    const mine = await screen.findByTestId("daily-leaderboard-row-2");
    expect(mine).toHaveAttribute("data-you", "true");
    expect(within(mine).getByText(/^you$/i)).toBeInTheDocument();
    // Already visible in the top rows — no duplicate separated You row.
    expect(screen.queryByTestId("daily-leaderboard-you")).not.toBeInTheDocument();
  });

  it("renders a separated real You row when the caller sits outside the top", async () => {
    mockFetchLeaderboard.mockResolvedValue(
      response({
        entries: [row({ rank: 1, handle: "alpha" })],
        total_listed: 40,
        you: {
          rank: 17,
          score: 610,
          completion_time_ms: 90_000,
          listed: true,
          has_handle: true,
          has_entry: true,
        },
      }),
    );
    render(<DailyLeaderboard date="2026-07-30" />);
    const you = await screen.findByTestId("daily-leaderboard-you");
    expect(you).toHaveTextContent("#17");
    expect(you).toHaveTextContent("You");
    expect(you).toHaveTextContent("610");
    expect(you).toHaveTextContent("01:30.0");
  });

  it("shows the empty state without any fake placement", async () => {
    mockFetchLeaderboard.mockResolvedValue(response());
    render(<DailyLeaderboard date="2026-07-30" />);
    expect(await screen.findByTestId("daily-leaderboard-empty")).toHaveTextContent(
      /be the first to finish today/i,
    );
    expect(screen.queryByTestId("daily-leaderboard-rows")).not.toBeInTheDocument();
    expect(screen.queryByTestId("daily-leaderboard-you")).not.toBeInTheDocument();
  });

  it("points a signed-in player without a handle at the profile page, not at a rank", async () => {
    mockFetchLeaderboard.mockResolvedValue(
      response({
        entries: [row({ rank: 1, handle: "alpha" })],
        total_listed: 1,
        you: {
          rank: null,
          score: 720,
          completion_time_ms: 60_000,
          listed: false,
          has_handle: false,
          has_entry: true,
        },
      }),
    );
    authState = { user: { id: "user-1" }, supabaseEnabled: true };
    render(<DailyLeaderboard date="2026-07-30" />);
    const cta = await screen.findByTestId("daily-leaderboard-handle-cta");
    expect(cta).toHaveTextContent(/choose a public handle/i);
    expect(within(cta).getByRole("link")).toHaveAttribute("href", "/profile");
    expect(screen.queryByTestId("daily-leaderboard-you")).not.toBeInTheDocument();
  });

  it("invites an anonymous player to sign in — play and share still work without it", async () => {
    mockFetchLeaderboard.mockResolvedValue(
      response({ entries: [row({ rank: 1, handle: "alpha" })], total_listed: 1 }),
    );
    render(<DailyLeaderboard date="2026-07-30" />);
    const cta = await screen.findByTestId("daily-leaderboard-signin-cta");
    expect(cta).toHaveTextContent(/sign in/i);
    expect(within(cta).getByRole("link")).toHaveAttribute("href", "/signin");
  });

  it("does not invite entries on an empty archive day — none can ever exist", async () => {
    mockFetchLeaderboard.mockResolvedValue(response({ daily_key: "2026-07-01" }));
    render(<DailyLeaderboard date="2026-07-01" isArchiveBoard />);
    expect(await screen.findByTestId("daily-leaderboard-empty")).toHaveTextContent(
      /no entries for this day/i,
    );
    expect(screen.getByTestId("daily-leaderboard-empty")).not.toHaveTextContent(/be the first/i);
  });

  it("labels an archive day's board by its date and drops the sign-in nudge", async () => {
    mockFetchLeaderboard.mockResolvedValue(
      response({ daily_key: "2026-07-01", entries: [row({ rank: 1, handle: "alpha" })], total_listed: 1 }),
    );
    render(<DailyLeaderboard date="2026-07-01" isArchiveBoard />);
    await screen.findByTestId("daily-leaderboard-rows");
    expect(screen.getByTestId("daily-leaderboard")).toHaveTextContent("Leaderboard · 2026-07-01");
    expect(screen.queryByTestId("daily-leaderboard-signin-cta")).not.toBeInTheDocument();
  });

  it("renders nothing at all when the read fails — the result stays the headline", async () => {
    mockFetchLeaderboard.mockRejectedValue(new Error("api down"));
    render(<DailyLeaderboard date="2026-07-30" />);
    await waitFor(() =>
      expect(screen.queryByTestId("daily-leaderboard")).not.toBeInTheDocument(),
    );
  });
});
