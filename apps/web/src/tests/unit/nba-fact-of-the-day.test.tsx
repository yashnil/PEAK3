/**
 * NBA Fact of the Day, on the homepage.
 *
 * The rules asserted here are the ones the feature would be wrong without: it
 * is NBA trivia and not a PEAK3 claim, every fact discloses the rows it came
 * from, and a deployment with no built bank renders nothing rather than an
 * error card.
 */
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import NbaFactOfTheDay, {
  type NbaFactView,
} from "@/components/home/NbaFactOfTheDay";

function fact(overrides: Partial<NbaFactView> = {}): NbaFactView {
  return {
    fact_id: "franchise_tenure-abc123",
    text:
      "John Stockton played all 19 of his recorded seasons for one franchise (UTA), from 1984-85 to 2002-03.",
    category: "franchise_tenure",
    era: "1980s",
    source_label: "Basketball-Reference per-season totals (1979-80 onward)",
    player_slug: "john-stockton",
    team_code: "UTA",
    evidence: [
      { player: "John Stockton", team: "UTA", season: "1984-85", games_played: 82 },
      { player: "John Stockton", team: "UTA", season: "2002-03", games_played: 82 },
    ],
    ...overrides,
  };
}

describe("NbaFactOfTheDay", () => {
  it("is headed as NBA trivia, never as a PEAK3 insight", () => {
    render(<NbaFactOfTheDay fact={fact()} />);
    const panel = screen.getByTestId("nba-fact-of-the-day");
    expect(screen.getByRole("heading", { name: "NBA Fact of the Day" })).toBeInTheDocument();
    // The branding rule, asserted on the rendered text rather than trusted.
    expect(panel.textContent).not.toMatch(/PEAK3 Fact/i);
    expect(screen.getByTestId("fotd-text")).toHaveTextContent(/John Stockton played all 19/);
  });

  it("labels the category and the era without leaning on the model", () => {
    render(<NbaFactOfTheDay fact={fact()} />);
    expect(screen.getByTestId("fotd-category")).toHaveTextContent("Franchise tenure");
    expect(screen.getByTestId("fotd-era")).toHaveTextContent("1980s");
  });

  it("discloses the source rows behind the claim", async () => {
    render(<NbaFactOfTheDay fact={fact()} />);
    const toggle = screen.getByTestId("fotd-evidence-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    const table = screen.getByTestId("fotd-evidence");
    expect(table).toHaveTextContent("1984-85");
    expect(table).toHaveTextContent("2002-03");
    expect(screen.getByText(/Basketball-Reference per-season totals/)).toBeInTheDocument();
  });

  it("links to the player's PEAK3 profile when there is one to link to", () => {
    render(<NbaFactOfTheDay fact={fact()} />);
    expect(screen.getByTestId("fotd-player-link")).toHaveAttribute(
      "href",
      "/players/john-stockton",
    );
  });

  it("omits the player link when the fact is not about one player", () => {
    render(<NbaFactOfTheDay fact={fact({ player_slug: null })} />);
    expect(screen.queryByTestId("fotd-player-link")).toBeNull();
  });

  it("renders nothing at all when the bank has not been built", () => {
    // `data/web/` is generated and gitignored, so an un-built checkout is a
    // normal state. A homepage that 500s over a trivia panel would be worse
    // than a homepage without one.
    const { container } = render(<NbaFactOfTheDay fact={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
