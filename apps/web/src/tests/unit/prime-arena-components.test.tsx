/**
 * Shared PRIME-mode pieces: the match strip never carries a decision, the
 * podium keeps the server's order, and the personal record says what is true.
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";

const getPersonalRecord = vi.fn();
vi.mock("@/lib/prime-arena/personal", () => ({ getPersonalRecord: (...args: unknown[]) => getPersonalRecord(...args) }));

import ArenaMatchStrip, { ordinal } from "@/components/prime-arena/ArenaMatchStrip";
import ArenaFinalPodium from "@/components/prime-arena/ArenaFinalPodium";
import PersonalRecordLine from "@/components/prime-arena/PersonalRecordLine";

const seats = [
  { seatIndex: 0, name: "You", isBot: false, botTier: null, position: 2, scoreText: "71.0", locked: false },
  { seatIndex: 1, name: "IsoKing", isBot: true, botTier: "MVP", position: 1, scoreText: "88.5", locked: true },
];

describe("ArenaMatchStrip", () => {
  it("orders by position and labels bots and lock state in words", () => {
    render(<ArenaMatchStrip seats={seats} yourSeat={0} showLocks title="Standings" progress="Card 3 / 8" scoreLabel="Match score" />);
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("IsoKing");
    expect(within(rows[0]).getByTestId("parena-seat-1-bot")).toHaveTextContent("Bot · MVP");
    expect(within(rows[0]).getByTestId("parena-seat-1-lock")).toHaveTextContent("Locked");
    expect(within(rows[1]).getByTestId("parena-seat-0-lock")).toHaveTextContent("Deciding");
    expect(rows[1]).toHaveTextContent("You");
    expect(screen.queryByText(/keep|cut/i)).toBeNull();
  });

  it("hides lock state outside a decision", () => {
    render(<ArenaMatchStrip seats={seats} yourSeat={0} showLocks={false} title="Standings" progress="1 of 3" scoreLabel="Match score" />);
    expect(screen.queryByText("Locked")).toBeNull();
  });

  it("uses English ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st"]);
  });
});

describe("ArenaFinalPodium", () => {
  it("keeps the server's placements, including a shared first", () => {
    render(
      <ArenaFinalPodium
        yourSeat={2}
        scoreLabel="Points"
        rows={[
          { seatIndex: 2, name: "You", isBot: false, botTier: null, placement: 3, outcome: "loss", scoreText: "500" },
          { seatIndex: 0, name: "A", isBot: true, botTier: "MVP", placement: 1, outcome: "draw", scoreText: "800" },
          { seatIndex: 1, name: "B", isBot: true, botTier: "Starter", placement: 1, outcome: "draw", scoreText: "800" },
        ]}
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("data-placement"))).toEqual(["1", "1", "3"]);
    expect(rows[0]).toHaveTextContent("Shared first");
  });
});

describe("PersonalRecordLine", () => {
  const base = {
    mode: "prime_cut",
    matches_played: 3,
    rated_matches: 1,
    wins: 2,
    podiums: 3,
    current_win_streak: 2,
    longest_win_streak: 2,
    best_score: 90,
    bests: {},
    match_found: true,
    match_score: 90,
    match_placement: 1,
    previous_best_score: 80,
    is_personal_best: true,
    streak_after_match: 2,
    ratings_enabled: true,
    rating: 1216,
    rating_provisional: true,
    match_rating_change: 16,
  };

  it("names a new personal best, the streak and the rating change", async () => {
    getPersonalRecord.mockResolvedValueOnce(base);
    render(<dl><PersonalRecordLine mode="prime_cut" matchId="m" rated scoreLabel="match score" formatScore={(v) => v.toFixed(1)} /></dl>);
    expect(await screen.findByTestId("parena-personal-best")).toHaveTextContent("New personal best — up from 80.0");
    expect(screen.getByTestId("parena-personal-streak")).toHaveTextContent("2 wins in a row");
    expect(screen.getByTestId("parena-personal-rating")).toHaveTextContent("+16 → 1216 (provisional)");
  });

  it("never shows a rating for an unrated match", async () => {
    getPersonalRecord.mockResolvedValueOnce({ ...base, previous_best_score: null, match_rating_change: null });
    render(<dl><PersonalRecordLine mode="prime_cut" matchId="m" rated={false} scoreLabel="match score" formatScore={(v) => v.toFixed(1)} /></dl>);
    expect(await screen.findByTestId("parena-personal-rating")).toHaveTextContent("Unrated match");
    expect(screen.getByTestId("parena-personal-best")).toHaveTextContent("First result");
  });

  it("says so when the record cannot load", async () => {
    getPersonalRecord.mockRejectedValueOnce(new Error("offline"));
    render(<dl><PersonalRecordLine mode="prime_cut" matchId="m" rated={false} scoreLabel="match score" formatScore={(v) => v.toFixed(1)} /></dl>);
    await waitFor(() => expect(screen.getByTestId("parena-personal")).toHaveTextContent("could not be loaded"));
  });
});
