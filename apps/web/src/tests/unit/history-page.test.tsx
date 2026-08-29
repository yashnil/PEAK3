/**
 * Page-level tests for /history — previously zero coverage. Added during
 * the Arena Archive visual-polish pass that gave this page a real shell,
 * EmptyState, and ErrorState.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import HistoryPage from "@/app/(main)/history/page";

const mockPush = vi.fn();
const mockRouter = { push: mockPush };
vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
}));

let authState: { user: { id: string } | null; loading: boolean };
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => authState,
}));

vi.mock("@/lib/auth", () => ({
  getAccessToken: vi.fn().mockResolvedValue("fake-token"),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
}

beforeEach(() => {
  mockPush.mockReset();
  mockFetch.mockReset();
  authState = { user: { id: "u1" }, loading: false };
});

describe("HistoryPage", () => {
  it("redirects to sign-in when signed out", () => {
    authState = { user: null, loading: false };
    render(<HistoryPage />);
    expect(mockPush).toHaveBeenCalledWith(expect.stringMatching(/^\/signin\?returnTo=.*history/));
  });

  it("shows an empty state with a way to play when there is no history", async () => {
    mockFetch.mockReturnValue(jsonResponse({ items: [], next_cursor: null, total: 0 }));
    render(<HistoryPage />);
    await waitFor(() => {
      expect(screen.getByText(/no completed games yet/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: /play today's daily/i })).toHaveAttribute("href", "/arena/daily");
  });

  it("renders every item's mode, board type, rating and optional metadata", async () => {
    mockFetch.mockReturnValue(
      jsonResponse({
        items: [
          {
            id: "h1",
            board_type: "daily",
            mode: "apex_1y",
            date: "2026-08-29",
            board_id: "b1",
            lineup_peak_rating: 87.4,
            draft_efficiency: 0.82,
            board_percentile: 12,
            hold_used: true,
            reframe_used: false,
            completed_at: "2026-08-29T12:00:00Z",
          },
        ],
        next_cursor: null,
        total: 1,
      }),
    );
    render(<HistoryPage />);

    await waitFor(() => expect(screen.getByText("Daily")).toBeInTheDocument());
    expect(screen.getByText("1Y Apex")).toBeInTheDocument();
    expect(screen.getByText("87.4")).toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.getByText(/Top 12%/)).toBeInTheDocument();
    expect(screen.getByText("Hold")).toBeInTheDocument();
    expect(screen.queryByText("Reframe")).not.toBeInTheDocument();
  });

  it("shows an error state when the request fails", async () => {
    mockFetch.mockReturnValue(jsonResponse({}, false));
    render(<HistoryPage />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/failed to load history/i);
    });
  });

  it("loads more pages via the cursor and appends results", async () => {
    mockFetch
      .mockReturnValueOnce(
        jsonResponse({
          items: [
            {
              id: "h1",
              board_type: "daily",
              mode: "apex_1y",
              date: null,
              board_id: "b1",
              lineup_peak_rating: 50,
              draft_efficiency: null,
              board_percentile: null,
              hold_used: null,
              reframe_used: null,
              completed_at: "2026-08-29T12:00:00Z",
            },
          ],
          next_cursor: "cursor-2",
          total: 2,
        }),
      )
      .mockReturnValueOnce(
        jsonResponse({
          items: [
            {
              id: "h2",
              board_type: "practice",
              mode: "prime_3y",
              date: null,
              board_id: "b2",
              lineup_peak_rating: 60,
              draft_efficiency: null,
              board_percentile: null,
              hold_used: null,
              reframe_used: null,
              completed_at: "2026-08-28T12:00:00Z",
            },
          ],
          next_cursor: null,
          total: 2,
        }),
      );

    const user = userEvent.setup();
    render(<HistoryPage />);

    await screen.findByText("50.0");
    const loadMore = screen.getByRole("button", { name: /load more/i });
    await user.click(loadMore);

    await waitFor(() => expect(screen.getByText("60.0")).toBeInTheDocument());
    expect(screen.getByText("50.0")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
    expect(mockFetch).toHaveBeenLastCalledWith(
      expect.stringContaining("before_id=cursor-2"),
      expect.anything(),
    );
  });
});
