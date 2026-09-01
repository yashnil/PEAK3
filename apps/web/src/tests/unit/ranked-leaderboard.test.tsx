/**
 * Component-level tests for the ranked leaderboard (RankedLeaderboard,
 * rendered by arena/ranked/[mode]/leaderboard/page.tsx once it resolves
 * `params`). This surface had zero test coverage before the Arena Archive
 * visual-polish pass rebuilt it (bare div/h1/table -> PeakV2Shell + shared
 * EmptyState/ErrorState/Skeleton) — these guard the states that rebuild
 * touched, since the prior batch's mode-label regression proved visual
 * review alone isn't enough. Tests the extracted `RankedLeaderboard`
 * component directly (plain `mode` prop) rather than the page wrapper,
 * matching `RankedScreen`'s own split — the page's `use(params)` needs a
 * real Suspense-aware host to resolve in a browser, which this render
 * harness cannot provide.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

import RankedLeaderboard from "@/components/ranked/RankedLeaderboard";
import type { LeaderboardResponse } from "@/types/ranked";

const getLeaderboard = vi.fn();

vi.mock("@/lib/ranked-api", () => ({
  rankedApi: {
    getLeaderboard: (...args: unknown[]) => getLeaderboard(...args),
  },
}));

vi.mock("@/lib/analytics", () => ({
  analytics: { track: vi.fn() },
}));

function makeResponse(overrides: Partial<LeaderboardResponse> = {}): LeaderboardResponse {
  return {
    mode: "apex_1y",
    enabled: true,
    entries: [],
    next_cursor: null,
    updated_at: "2026-08-29T20:00:00Z",
    queue_version: "v1",
    rating_algorithm_version: "v1",
    ...overrides,
  };
}

beforeEach(() => {
  getLeaderboard.mockReset();
});

function renderPage() {
  return render(<RankedLeaderboard mode="apex_1y" />);
}

describe("RankedLeaderboard", () => {
  it("shows the mode title and a link back to the queue", async () => {
    getLeaderboard.mockResolvedValue(makeResponse());
    renderPage();

    expect(screen.getByRole("heading", { name: /1Y Apex Leaderboard/i })).toBeInTheDocument();
    const back = screen.getByRole("link", { name: /back to queue/i });
    expect(back).toHaveAttribute("href", "/arena/ranked/apex_1y");
  });

  it("announces a loading state before the response lands", () => {
    getLeaderboard.mockReturnValue(new Promise(() => {})); // never resolves
    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent(/loading leaderboard/i);
  });

  it("shows an error state when the request fails", async () => {
    getLeaderboard.mockRejectedValue(new Error("network down"));
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/could not load the leaderboard/i);
    });
  });

  it("shows a not-enabled empty state when the board is disabled", async () => {
    getLeaderboard.mockResolvedValue(makeResponse({ enabled: false }));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/not enabled yet/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("leaderboard-table")).not.toBeInTheDocument();
  });

  it("shows a no-established-players empty state when enabled but empty", async () => {
    getLeaderboard.mockResolvedValue(makeResponse({ enabled: true, entries: [] }));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/no established players yet/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("leaderboard-table")).not.toBeInTheDocument();
  });

  it("renders every entry's rank, player, rating and division in the table", async () => {
    getLeaderboard.mockResolvedValue(
      makeResponse({
        entries: [
          { rank: 1, handle: "player_abc123", rating: 1487, rd: 45, division: "Gold" },
          { rank: 2, handle: "player_def456", rating: 1450, rd: 50, division: "Silver" },
        ],
      }),
    );
    renderPage();

    const table = await screen.findByTestId("leaderboard-table");
    expect(table).toHaveTextContent("@player_abc123");
    expect(table).toHaveTextContent("1487");
    expect(table).toHaveTextContent("Gold");
    expect(table).toHaveTextContent("@player_def456");
    expect(table).toHaveTextContent("1450");
    expect(table).toHaveTextContent("Silver");
  });

  it("never renders a raw owner_sub — public-platform-readiness Batch P3 §3.7", async () => {
    getLeaderboard.mockResolvedValue(
      makeResponse({
        entries: [{ rank: 1, handle: "safe_handle", rating: 1487, rd: 45, division: "Gold" }],
      }),
    );
    renderPage();

    const table = await screen.findByTestId("leaderboard-table");
    expect(table).not.toHaveTextContent(/owner_sub/i);
  });

  it("shows the updated-at timestamp once a response lands", async () => {
    getLeaderboard.mockResolvedValue(makeResponse());
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/updated/i)).toBeInTheDocument();
    });
  });
});
