import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import DailyHubPage from "@/app/(main)/arena/daily/page";
import { localDailyWindow } from "@/lib/daily-time";

beforeEach(() => {
  localStorage.clear();
});

describe("DailyHubPage", () => {
  it("shows today's heading and all three modes with a Play Now link each, on a fresh visit", () => {
    render(<DailyHubPage />);

    expect(screen.getByRole("heading", { name: /today.*peak draft/i })).toBeVisible();
    expect(screen.getByText("1Y Apex")).toBeVisible();
    expect(screen.getByText("3Y Prime")).toBeVisible();
    expect(screen.getByText("5Y Foundation")).toBeVisible();

    const playLinks = screen.getAllByRole("link", { name: /play now/i });
    expect(playLinks).toHaveLength(3);
    expect(playLinks[0]).toHaveAttribute("href", "/arena/daily/apex_1y");
  });

  it("keeps the 82-0 promo link and the back-to-Arena link", () => {
    render(<DailyHubPage />);
    expect(screen.getByRole("link", { name: /try it/i })).toHaveAttribute(
      "href",
      "/arena/court/practice/apex_1y",
    );
    expect(screen.getByRole("link", { name: /back to arena/i })).toHaveAttribute(
      "href",
      "/arena",
    );
  });

  it("shows a completed mode's rating and a View Result link instead of Play Now", () => {
    const today = localDailyWindow().daily_key;
    localStorage.setItem(
      "peak3_draft_progress_v1",
      JSON.stringify({
        schema_version: 1,
        active_game: null,
        daily_completions: {
          [today]: {
            apex_1y: {
              game_id: "g1",
              mode: "apex_1y",
              board_type: "daily",
              completed_at: new Date().toISOString(),
              lineup_peak_rating: 88.4,
              draft_efficiency: 0.7,
              board_percentile: 60,
              board_id: `daily-apex_1y-${today}`,
              hold_used: false,
              reframe_used: false,
            },
          },
        },
        challenge_games: {},
      }),
    );

    render(<DailyHubPage />);

    expect(screen.getByText("88.4")).toBeVisible();
    expect(screen.getByRole("link", { name: /view result/i })).toHaveAttribute(
      "href",
      "/arena/daily/apex_1y",
    );
    expect(screen.getAllByRole("link", { name: /play now/i })).toHaveLength(2);
  });
});
