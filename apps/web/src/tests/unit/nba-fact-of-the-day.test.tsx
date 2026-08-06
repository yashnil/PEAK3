/**
 * The NBA Fact of the Day card.
 *
 * TWO FINDINGS FROM THE MANUAL REVIEW, AND THEY HAD ONE CAUSE.
 *
 *   "NBA Fact of the Day is visually weak"
 *   "the generated fact is often too dull to deserve homepage prominence"
 *
 * The card was a heading, two tiny tags, one paragraph — and, as its most
 * prominent interaction, a `<details>` labelled "Show source rows" that opened
 * a four-column table of (player, season, team, games). One type size, nothing
 * to look at, and a call to action that invited a visitor to audit the fact
 * rather than enjoy it.
 *
 * The dullness half is fixed in the bank (see `nba_peak/nba_facts/`). This file
 * is about the card: a featured value with a court motif, a headline, a
 * supporting sentence, and NO SOURCE TABLE ANYWHERE. The rows still exist in
 * the payload and are still re-derived by the model tests; they are simply not
 * what the homepage offers.
 */
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import NbaFactOfTheDay, {
  type NbaFactView,
} from "@/components/home/NbaFactOfTheDay";

const FACT: NbaFactView = {
  fact_id: "rules-abc123",
  headline: "Basketball invented the shot clock because one game finished 19–18.",
  body:
    "On 22 November 1950 the Fort Wayne Pistons held the ball for minutes at a time. " +
    "Four years later the NBA adopted a 24-second clock.",
  category: "rules",
  era: "1950s",
  geography: "usa",
  feature: "24 seconds",
  feature_label: "the new clock",
  source_label: "Editorial — checked against a named published source",
  player_slug: null,
  team_code: null,
};

function renderCard(overrides: Partial<NbaFactView> = {}) {
  return render(<NbaFactOfTheDay fact={{ ...FACT, ...overrides }} />);
}

describe("the card renders the fact, and only the fact", () => {
  it("leads with the headline and supports it with the body", () => {
    renderCard();
    expect(screen.getByTestId("fotd-text")).toHaveTextContent(/shot clock/i);
    expect(screen.getByTestId("fotd-support")).toHaveTextContent(/Fort Wayne/i);
  });

  it("sets the featured value apart from the prose", () => {
    // THE FOCAL POINT the card previously had none of. It is a separate
    // element rather than a bolded span inside the sentence, because the whole
    // point is that it is a different typographic register.
    renderCard();
    const feature = screen.getByTestId("fotd-feature");
    expect(feature).toHaveTextContent("24 seconds");
    expect(feature).toHaveTextContent(/the new clock/i);
    expect(screen.getByTestId("fotd-text").contains(feature)).toBe(false);
  });

  it("labels the category in words a reader knows", () => {
    renderCard();
    expect(screen.getByTestId("fotd-category")).toHaveTextContent("Rule changes");
    expect(screen.getByTestId("fotd-era")).toHaveTextContent("1950s");
  });

  it("tags geography only when it is worth saying", () => {
    renderCard();
    expect(screen.queryByTestId("fotd-geography")).toBeNull();
    renderCard({ geography: "global" });
    expect(screen.getAllByTestId("fotd-geography")[0]).toHaveTextContent("Global");
  });

  it("names itself as NBA trivia, never as a PEAK3 claim", () => {
    // A visitor reads this before they have been told what PEAK3 is.
    const { container } = renderCard();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "NBA Fact of the Day",
    );
    expect(container.textContent ?? "").not.toMatch(/PEAK3 (fact|rates|score)/i);
  });
});

describe("the source-row table is gone", () => {
  it("renders no evidence table", () => {
    renderCard();
    expect(screen.queryByTestId("fotd-evidence")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("offers no 'show source rows' disclosure", () => {
    const { container } = renderCard();
    expect(screen.queryByTestId("fotd-evidence-toggle")).toBeNull();
    expect(container.querySelector("details")).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/source rows/i);
  });

  it("ships no interactive element except a genuinely useful link", () => {
    // The card is server-rendered and carries no client behaviour at all now,
    // which also retires the pre-hydration dead-click window the previous
    // version's own comment documented.
    const { container } = renderCard();
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("links a player profile only when the fact is about a player", () => {
    renderCard({ player_slug: "wilt-chamberlain" });
    expect(screen.getByTestId("fotd-player-link")).toHaveAttribute(
      "href",
      "/players/wilt-chamberlain",
    );
  });
});

describe("the graphic", () => {
  it("draws court lines with no text, hidden from assistive technology", () => {
    const { container } = renderCard();
    const svg = container.querySelector("svg.fotd-motif");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg!.querySelector("text")).toBeNull();
    // No logo, no likeness, no photograph — the project ships none of those.
    expect(container.querySelector("img")).toBeNull();
  });

  it("inherits the theme rather than hard-coding two palettes", () => {
    const { container } = renderCard();
    const strokes = Array.from(
      container.querySelectorAll("svg.fotd-motif [stroke]"),
    ).map((el) => el.getAttribute("stroke"));
    expect(strokes.length).toBeGreaterThan(0);
    for (const stroke of strokes) expect(stroke).toBe("currentColor");
  });
});

describe("degraded payloads", () => {
  it("renders nothing at all when there is no fact", () => {
    // An un-built checkout is a normal state; a broken homepage is not.
    const { container } = render(<NbaFactOfTheDay fact={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a v1 payload's single text field rather than dropping it", () => {
    render(
      <NbaFactOfTheDay
        fact={
          {
            fact_id: "franchise_tenure-old",
            text: "John Stockton played all 19 of his seasons for one franchise.",
            category: "franchise_tenure",
            era: "1980s",
            source_label: "Basketball-Reference per-season totals",
            player_slug: "john-stockton",
            team_code: "UTA",
          } as unknown as NbaFactView
        }
      />,
    );
    expect(screen.getByTestId("fotd-text")).toHaveTextContent(/John Stockton/);
    expect(screen.getByTestId("fotd-category")).toHaveTextContent("Franchises");
  });

  it("omits the featured block when the fact carries no feature", () => {
    renderCard({ feature: null, feature_label: null });
    expect(screen.queryByTestId("fotd-feature")).toBeNull();
    expect(screen.getByTestId("fotd-text")).toBeInTheDocument();
  });
});
