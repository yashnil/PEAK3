/**
 * Every playable mode has a door on BOTH the homepage and the Arena hub, and
 * every catalogued Arena mode's match route exists.
 *
 * THE DEFECTS THIS PINS. The homepage took only the first TWO multiplayer games
 * from the catalogue (`const [mp1, mp2] = multiplayerModes`), so Prime Cut,
 * Find the Prime and Shared Draft never appeared there however many the server
 * served; Peak Duel Endless and Ranked were reachable only from the Play menu.
 * And `arena-modes.ts` promised an `arena-routes.test.ts` that checked each
 * `matchPath` against the App Router tree -- no such file existed.
 */
import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import HomePageV2 from "@/components/v2/HomePageV2";
import ArenaPageV2 from "@/components/v2/ArenaPageV2";
import { ARENA_MODES } from "@/lib/arena-modes";
import { MODE_COPY } from "@/lib/modes";
import type { ArenaCatalogue } from "@/lib/arena-readiness-server";

function mockMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

const MULTIPLAYER = [
  { id: "three_man_weave", href: "/arena/lobby?family=three_man_weave", title: "Three-Man Weave", description: "d", blurb: "Three-way snake draft" },
  { id: "shared_draft", href: "/arena/lobby?game=shared_draft", title: "Shared Draft", description: "d", blurb: "Two drafters, one board" },
  { id: "twenty_dollar", href: "/arena/lobby?game=twenty_dollar", title: "The $20 Showdown", description: "d" },
  { id: "prime_cut", href: "/arena/lobby?game=prime_cut", title: "Prime Cut", description: "d" },
  { id: "find_the_prime", href: "/arena/lobby?game=find_the_prime", title: "Find the Prime", description: "d" },
];

const HOME_PROPS = {
  topWindow: null,
  componentWeights: [],
  rankingsPreview: [],
  methodology: null,
  proof: {
    modelLabel: null,
    modelVersion: null,
    isDefaultModel: true,
    startSeason: null,
    endSeason: null,
    playersEvaluated: null,
    rankedWindows: null,
    generatedAt: null,
  },
  runTheTable: { href: "/arena/run-the-table", title: "RUN THE TABLE", description: "Flagship mode" },
  dailyModes: [MODE_COPY["daily-grid"], MODE_COPY["peak-duel"]],
  peakSeason: MODE_COPY["peak-season"],
  multiplayerModes: MULTIPLAYER,
  nbaFact: null,
};

beforeEach(() => {
  mockMatchMedia();
  window.localStorage.clear();
});

describe("the homepage lists every playable mode", () => {
  it("shows EVERY multiplayer game the catalogue serves, not just the first two", () => {
    render(<HomePageV2 {...HOME_PROPS} />);
    const grid = screen.getByTestId("home-multiplayer-modes");
    for (const mode of MULTIPLAYER) {
      const card = within(grid).getByTestId(`home-${mode.id}-card`);
      expect(card).toHaveAttribute("href", mode.href);
    }
    expect(within(grid).getAllByRole("link")).toHaveLength(MULTIPLAYER.length);
  });

  it("keeps the daily and solo modes, and adds Endless and Ranked", () => {
    render(<HomePageV2 {...HOME_PROPS} />);
    for (const [testId, href] of [
      ["home-daily-grid-card", "/daily/grid"],
      ["home-daily-duel-card", "/play/daily"],
      ["home-peak-duel-endless-card", "/play/endless"],
      ["home-peak-season-card", "/arena/court/practice/apex_1y"],
      ["home-ranked-card", "/arena/ranked"],
      ["home-leaderboard-card", "/arena/court/leaderboard"],
    ] as const) {
      expect(screen.getByTestId(testId)).toHaveAttribute("href", href);
    }
  });

  it("groups the slate under labels and keeps one featured card", () => {
    render(<HomePageV2 {...HOME_PROPS} />);
    const index = screen.getByTestId("home-play-index");
    expect(within(index).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Daily · quick play",
      "Multiplayer · live",
      "Solo · competitive",
    ]);
    expect(index.querySelectorAll('[data-featured="true"]')).toHaveLength(0);
  });

  it("no mode link on the homepage is duplicated inside the play index", () => {
    render(<HomePageV2 {...HOME_PROPS} />);
    const hrefs = Array.from(screen.getByTestId("home-play-index").querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("without a live Arena there is no empty multiplayer group", () => {
    render(<HomePageV2 {...HOME_PROPS} multiplayerModes={[]} />);
    expect(screen.queryByTestId("home-multiplayer-modes")).toBeNull();
  });
});

describe("the Arena hub lists every playable mode", () => {
  const catalogue: ArenaCatalogue = {
    available: true,
    modes: [
      { id: "shared_draft", name: "Shared Draft", description: "Twelve players from the latest completed NBA season on one shared board.", facts: [], kindBadge: "Draft", href: "/arena/lobby?game=shared_draft" },
      { id: "twenty_dollar", name: "The $20 Showdown", description: "Auction.", facts: [], kindBadge: "Auction", href: "/arena/lobby?game=twenty_dollar" },
    ],
  };

  it("shows Shared Draft with its mechanic copy, plus Endless and Ranked", () => {
    render(<ArenaPageV2 courtBuilderEnabled arenaCatalogue={catalogue} />);
    const card = screen.getByTestId("arena-shared_draft-card");
    expect(card).toHaveAttribute("href", "/arena/lobby?game=shared_draft");
    expect(card).toHaveTextContent("Twelve players from the latest completed NBA season on one shared board.");
    expect(screen.getByTestId("arena-endless-duel-card")).toHaveAttribute("href", "/play/endless");
    expect(screen.getByTestId("arena-ranked-card")).toHaveAttribute("href", "/arena/ranked");
    expect(screen.getByTestId("arena-daily-duel-card")).toHaveAttribute("href", "/play/daily");
  });
});

describe("every catalogued Arena mode routes somewhere real", () => {
  const appDir = path.resolve(__dirname, "../../app/(main)");

  it.each(ARENA_MODES.map((m) => [m.id, m]))("%s's matchPath has a page", (_id, mode) => {
    const route = mode.matchPath("MATCH").replace(/^\//, "").replace("MATCH", "[matchId]");
    expect(fs.existsSync(path.join(appDir, route, "page.tsx")), route).toBe(true);
  });

  it("Shared Draft is catalogued as a first-class game with rules", () => {
    const meta = ARENA_MODES.find((m) => m.id === "shared_draft");
    expect(meta?.variantOf).toBeUndefined();
    expect(meta?.rules.length).toBeGreaterThanOrEqual(4);
    expect(meta?.blurb).toBeTruthy();
  });

  it("Shared Draft's copy never claims a live roster the data cannot prove", () => {
    // Eligibility is "appeared in the latest completed season"; the repo has
    // no current-roster source (nba_peak/shared_draft/pool.py).
    const meta = ARENA_MODES.find((m) => m.id === "shared_draft")!;
    for (const text of [meta.description, meta.blurb ?? "", meta.tagline, ...meta.rules]) {
      expect(text).not.toMatch(/\bcurrent\b|\bactive\b|on a roster|today's players/i);
    }
  });
});
