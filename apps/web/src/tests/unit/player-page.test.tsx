/**
 * Page-level tests for /players/[slug] — previously zero coverage at any
 * level. `PlayerPage` is an async Server Component with no client state;
 * tested by awaiting it directly (mirrors how Next.js itself invokes it)
 * and rendering the resolved JSX, rather than via React's `use()` /
 * Suspense (batch 4 found that path has no working harness in this repo).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

import PlayerPage from "@/app/(main)/players/[slug]/page";
import type { PlayerProfile, PeakWindow } from "@/types";

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function makeWindow(overrides: Partial<PeakWindow> = {}): PeakWindow {
  return {
    id: "w1",
    player_id: "p1",
    player_slug: "test-player",
    player_name: "Test Player",
    duration_years: 1,
    start_season: "2015-16",
    end_season: "2015-16",
    anchor_season: "2015-16",
    rank: 12,
    prime_score: 87.4,
    prime_index: 0.912,
    components: {
      statistical_impact: 32.1,
      traditional_production: 18.4,
      individual_recognition: 15.0,
      postseason_individual_value: 10.2,
      team_achievement: 2.9,
      teammate_adjustment: -0.5,
    },
    data_status: "complete",
    ...overrides,
  };
}

function makeProfile(overrides: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    player_slug: "test-player",
    player_name: "Test Player",
    windows: { "1": makeWindow() },
    ...overrides,
  };
}

async function renderPage(slug = "test-player") {
  const jsx = await PlayerPage({ params: Promise.resolve({ slug }) });
  return render(jsx as React.ReactElement);
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("PlayerPage", () => {
  it("renders the player name and every present window with the correct duration label", async () => {
    mockFetch.mockReturnValue(
      jsonResponse(
        makeProfile({
          windows: {
            "1": makeWindow({ duration_years: 1, rank: 5 }),
            "3": makeWindow({ duration_years: 3, rank: 40, start_season: "2014-15", end_season: "2016-17" }),
          },
        }),
      ),
    );
    await renderPage();

    expect(screen.getByRole("heading", { name: "Test Player" })).toBeInTheDocument();
    expect(screen.getByText("1-Year Peak")).toBeInTheDocument();
    expect(screen.getByText("3-Year Peak")).toBeInTheDocument();
    // Regression guard: the rank label used to hardcode "(1-year window)"
    // for every duration, including this 3-year one.
    expect(screen.getByText(/Rank #5/)).toBeInTheDocument();
    expect(screen.getByText(/— 1-year board/)).toBeInTheDocument();
    expect(screen.getByText(/Rank #40/)).toBeInTheDocument();
    expect(screen.getByText(/— 3-year board/)).toBeInTheDocument();
    expect(screen.queryByText(/1–year window/)).not.toBeInTheDocument();
  });

  it("shows exact prime score, prime index and component values unchanged", async () => {
    mockFetch.mockReturnValue(
      jsonResponse(makeProfile({ windows: { "1": makeWindow({ prime_score: 91.25, prime_index: 0.834 }) } })),
    );
    await renderPage();

    expect(screen.getByText("91.3")).toBeInTheDocument(); // toFixed(1) of 91.25
    expect(screen.getByText(/0\.83/)).toBeInTheDocument(); // toFixed(2) of 0.834
    expect(screen.getByText("Statistical Impact")).toBeInTheDocument();
    expect(screen.getByText("32.1")).toBeInTheDocument();
    expect(screen.getByText("Teammate Adj.")).toBeInTheDocument();
    expect(screen.getByText("-0.50")).toBeInTheDocument();
  });

  it("links to the correct rankings targets for each window", async () => {
    mockFetch.mockReturnValue(jsonResponse(makeProfile({ windows: { "1": makeWindow() } })));
    await renderPage();

    expect(screen.getByRole("link", { name: /rankings/i })).toHaveAttribute("href", "/rankings");
    expect(screen.getByRole("link", { name: /view 1-year leaderboard/i })).toHaveAttribute(
      "href",
      "/rankings?years=1",
    );
  });

  it("shows a not-found state for a real 404, distinct from a load failure", async () => {
    mockFetch.mockReturnValue(jsonResponse({}, 404));
    await renderPage("no-such-player");

    expect(screen.getByText(/player not found/i)).toBeInTheDocument();
    expect(screen.getByText(/no peak3 data for/i)).toBeInTheDocument();
  });

  it("shows a distinct error state (not 'not found') when the API fails for another reason", async () => {
    mockFetch.mockReturnValue(jsonResponse({}, 500));
    await renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent(/could not load this player/i);
    expect(screen.queryByText(/player not found/i)).not.toBeInTheDocument();
  });

  it("shows the error state on a network failure too", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));
    await renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent(/could not load this player/i);
  });
});
