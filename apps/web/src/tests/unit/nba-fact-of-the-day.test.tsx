/**
 * The NBA Fact of the Day card (HOME-03).
 *
 * WHERE THIS CARD CAME FROM. It began as a heading, two tiny tags, one
 * paragraph and — as its most prominent interaction — a `<details>` labelled
 * "Show source rows" that opened a four-column table of (player, season, team,
 * games). That table is long gone and stays gone: these tests keep asserting
 * its absence, because the rows still exist in the payload and re-adding them
 * to the homepage would be a one-line mistake.
 *
 * WHAT THIS PASS CHANGED, AND WHAT THESE NOW ENCODE. Next to the homepage hero
 * the card still read as a notice: one gold accent whatever the fact was about,
 * one court drawing whatever the fact was about, three identical grey tags, and
 * a 11px underlined "See their PEAK3 profile" — its only control — shown for
 * roughly three quarters of the bank. So:
 *
 *   * the card is tuned to its category (`data-accent`, and one of five line
 *     motifs) rather than looking the same every day;
 *   * it always has a figure, so a fact with no number to lead with does not
 *     collapse into a paragraph;
 *   * the category tag is a different register from the era tag;
 *   * the default profile link is REMOVED. One survives only where the player
 *     is the subject of the fact, and it is a real control.
 *
 * WHAT THESE DELIBERATELY DO NOT ASSERT: any field the fact bank might stop
 * emitting. The bank is being re-tiered in parallel, so `feature`, `era`,
 * `geography` and `player_slug` are each exercised as present AND absent.
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

describe("the card is tuned to its category", () => {
  it("puts the category's accent group on the section, for the stylesheet to read", () => {
    // One custom property drives every colour in the card, so a category is a
    // one-line map entry rather than a new block of CSS.
    const { container } = renderCard();
    expect(container.querySelector(".fotd")).toHaveAttribute("data-accent", "rules");
    renderCard({ category: "olympics_fiba" });
    expect(
      screen.getAllByTestId("nba-fact-of-the-day")[1],
    ).toHaveAttribute("data-accent", "global");
    renderCard({ category: "playoffs_finals" });
    expect(
      screen.getAllByTestId("nba-fact-of-the-day")[2],
    ).toHaveAttribute("data-accent", "playoffs");
  });

  it("falls back to the brand accent for a category it has not been taught", () => {
    // The fact bank is being re-tiered in parallel. An unknown category must
    // render like the card always did, not colourless.
    renderCard({ category: "some_new_tier_the_bank_invents" });
    const card = screen.getByTestId("nba-fact-of-the-day");
    expect(card).toHaveAttribute("data-accent", "history");
    expect(screen.getByTestId("fotd-category")).toHaveTextContent("NBA history");
  });

  it("draws a different motif for a different kind of fact", () => {
    const rules = renderCard().container.querySelector("svg.fotd-motif");
    const global = renderCard({ category: "global" }).container.querySelector(
      "svg.fotd-motif",
    );
    expect(rules).toHaveAttribute("data-motif", "clock");
    expect(global).toHaveAttribute("data-motif", "globe");
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
});

describe("the one action, and when there is none", () => {
  it("ships no interactive element at all on an ordinary fact", () => {
    // The card is server-rendered and carries no client behaviour, which also
    // retires the pre-hydration dead-click window the old disclosure had.
    const { container } = renderCard();
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("does not link a profile merely because a player is named in the fact", () => {
    // HOME-03 removed the DEFAULT "See their PEAK3 profile" row. A rule-change
    // fact that happens to reference a player is exactly the case that used to
    // get one for no reason.
    renderCard({ player_slug: "wilt-chamberlain" });
    expect(screen.queryByTestId("fotd-player-link")).toBeNull();
  });

  it("links the profile where the player IS the subject, as a real control", () => {
    const { container } = renderCard({
      category: "player_story",
      player_slug: "wilt-chamberlain",
    });
    const link = screen.getByTestId("fotd-player-link");
    expect(link).toHaveAttribute("href", "/players/wilt-chamberlain");
    // It does NOT name the player: the only identity in the payload is the
    // slug, and title-casing a slug renders "Javale Mcgee" under a headline
    // that says "JaVale McGee". The headline above it has already named them.
    expect(link).toHaveTextContent(/See the full PEAK3 profile/);
    // SHARED-04: an obvious control at rest, not faint underlined body text.
    expect(link).toHaveClass("fotd-cta");
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });

  it("shows no link for a player-subject fact with no player attached", () => {
    renderCard({ category: "player_story", player_slug: null });
    expect(screen.queryByTestId("fotd-player-link")).toBeNull();
  });
});

describe("the graphic", () => {
  it("draws line art with no text, hidden from assistive technology", () => {
    const { container } = renderCard();
    const svg = container.querySelector("svg.fotd-motif");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg!.querySelector("text")).toBeNull();
    // No logo, no likeness, no photograph — the project ships none of those.
    expect(container.querySelector("img")).toBeNull();
  });

  it("inherits the theme rather than hard-coding two palettes", () => {
    // Every motif, not just the court: a `fill` would come out as a solid block
    // on the wrong theme, so they are stroke-only in `currentColor`.
    for (const category of ["rules", "global", "playoffs_finals", "records", "nba_history"]) {
      const { container } = render(
        <NbaFactOfTheDay fact={{ ...FACT, category }} />,
      );
      const strokes = Array.from(
        container.querySelectorAll("svg.fotd-motif [stroke]"),
      ).map((el) => el.getAttribute("stroke"));
      expect(strokes.length).toBeGreaterThan(0);
      for (const stroke of strokes) expect(stroke).toBe("currentColor");
      for (const el of Array.from(container.querySelectorAll("svg.fotd-motif [fill]"))) {
        expect(el.getAttribute("fill")).toBe("none");
      }
    }
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

  it("keeps a figure even when the fact carries no feature", () => {
    // Without this the card collapses to a paragraph on the days the bank has
    // no number to lead with, which is where "visually weak" came from.
    const { container } = renderCard({ feature: null, feature_label: null });
    expect(screen.queryByTestId("fotd-feature")).toBeNull();
    expect(screen.getByTestId("fotd-figure")).toBeInTheDocument();
    expect(container.querySelector(".fotd-glyph svg.fotd-motif")).not.toBeNull();
    expect(screen.getByTestId("fotd-text")).toBeInTheDocument();
  });

  it("renders without an era, a body or a geography", () => {
    renderCard({ era: "", body: "", geography: undefined });
    expect(screen.queryByTestId("fotd-era")).toBeNull();
    expect(screen.queryByTestId("fotd-support")).toBeNull();
    expect(screen.queryByTestId("fotd-geography")).toBeNull();
    expect(screen.getByTestId("fotd-text")).toHaveTextContent(/shot clock/i);
  });
});
