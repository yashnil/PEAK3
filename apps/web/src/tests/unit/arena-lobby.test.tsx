/**
 * The redesigned multiplayer lobby.
 *
 * Four properties are worth protecting, and each maps to a defect that shipped:
 *
 *   1. BOTH GAMES ARE ON ONE SCREEN. The old lobby was a three-stage wizard —
 *      choose a game, choose a path, then act — so no screen ever answered
 *      "what is here?".
 *   2. RATED STATE IS VISIBLE BEFORE COMMITTING. A match that did not count
 *      must never be a discovery made afterwards.
 *   3. THE LOBBY IS MODE-AGNOSTIC. A mode is data plus a route, so a mode the
 *      server does not publish is not offered and a mode this build has no
 *      route for is skipped.
 *   4. EVERY PUBLISHED `matchPath` RESOLVES TO A REAL ROUTE. This is the one
 *      that broke: `three_man_weave` advertised `/arena/three-man-weave/<id>`
 *      while the app only had `/arena/three-man-weave?match=<id>`, so every
 *      created match navigated into a Next.js 404.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  ARENA_MODES,
  ENTRY_PATHS,
  modeMeta,
  offerableModes,
  seatLabel,
} from "@/lib/arena-modes";
import { normaliseRoomCode, searchLabel } from "@/lib/arena-lobby-api";
import { MODE_COPY, MULTIPLAYER_MODE_IDS } from "@/lib/modes";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/lib/auth", () => ({ getAccessToken: async () => "token" }));

import ArenaLobby from "@/components/arena/ArenaLobby";

const READY = {
  readiness_level: "closed_alpha",
  arena_enabled: true,
  public_queue_enabled: true,
  bots_enabled: true,
  modes: [
    { id: "twenty_dollar", seat_count: 2 },
    { id: "three_man_weave", seat_count: 3 },
  ],
};

function mockFetch(readiness: typeof READY, extra: Record<string, unknown> = {}) {
  return vi.fn(async (url: string) => {
    const target = String(url);
    if (target.includes("/readiness")) {
      return { ok: true, json: async () => readiness } as Response;
    }
    for (const [fragment, body] of Object.entries(extra)) {
      if (target.includes(fragment)) {
        return { ok: true, json: async () => body } as Response;
      }
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
}

beforeEach(() => {
  push.mockReset();
  vi.stubGlobal("fetch", mockFetch(READY));
});
afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

describe("every published match path resolves to a real route", () => {
  const APP_ROOT = path.join(process.cwd(), "src", "app", "(main)");

  it.each(ARENA_MODES.map((m) => [m.id, m.matchPath("MATCH-ID")]))(
    "%s renders at %s",
    (_id, published) => {
      // "/arena/three-man-weave/MATCH-ID" -> the directory that must exist,
      // with the id segment replaced by its dynamic form.
      const segments = published.split("/").filter(Boolean);
      segments[segments.length - 1] = "[matchId]";
      const dir = path.join(APP_ROOT, ...segments);
      expect(
        existsSync(path.join(dir, "page.tsx")),
        `${published} has no page at ${dir}/page.tsx — matchmaking would 404`,
      ).toBe(true);
    },
  );

  it("uses a distinct route per mode", () => {
    const paths = ARENA_MODES.map((m) => m.matchPath("x"));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("the nav catalogue deep-links at server mode ids this build serves", () => {
    // `MODE_COPY` points the menu and the homepage cards at
    // `/arena/lobby?game=<server id>`, which the lobby uses to highlight the
    // card you came for. A typo there is a silent no-op — the lobby renders,
    // nothing is highlighted, and nobody notices — so the ids are checked
    // against the catalogue the server actually registers against.
    const served = new Set(ARENA_MODES.map((m) => m.id));
    for (const modeId of MULTIPLAYER_MODE_IDS) {
      const href = MODE_COPY[modeId].href;
      const game = new URLSearchParams(href.split("?")[1] ?? "").get("game");
      expect(game, `${modeId} deep-links at ${href}`).not.toBeNull();
      expect(served.has(game as string)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

describe("rated state is visible before committing", () => {
  it("mirrors the schema: only the public queue is rated", () => {
    // The database enforces CHECK (rated = (entry_path = 'public_queue')).
    // This asserts the catalogue restates it rather than inventing a policy.
    const byId = Object.fromEntries(ENTRY_PATHS.map((p) => [p.id, p.rated]));
    expect(byId).toEqual({
      public_queue: true,
      private_room: false,
      practice: false,
    });
  });

  it("offers exactly the three entry paths", () => {
    expect(ENTRY_PATHS.map((p) => p.id)).toEqual([
      "public_queue",
      "private_room",
      "practice",
    ]);
  });
});

describe("the catalogue is data, and the server decides what is offerable", () => {
  it("intersects the catalogue with the server's live modes", () => {
    const offerable = offerableModes([{ id: "twenty_dollar", seat_count: 2 }]);
    expect(offerable.map((m) => m.id)).toEqual(["twenty_dollar"]);
    expect(offerable[0].seatCount).toBe(2);
  });

  it("skips a server mode this build has no route for", () => {
    expect(offerableModes([{ id: "quantum_horse", seat_count: 9 }])).toEqual([]);
  });

  it("carries a premise, a length and a rules list for every mode", () => {
    for (const mode of ARENA_MODES) {
      expect(mode.description.length).toBeGreaterThan(40);
      expect(mode.duration).toMatch(/min/);
      expect(mode.kindBadge.length).toBeGreaterThan(0);
      expect(mode.rules.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("never names an implementation detail in player-facing copy", () => {
    const copy = ARENA_MODES.flatMap((m) => [
      m.name,
      m.tagline,
      m.description,
      ...m.rules,
    ]).join(" ");
    expect(copy).not.toMatch(/random_legal|_v1|_v2|feature.?flag|snapshot/i);
  });

  it("describes PEAK3 scoring rather than fantasy box scores", () => {
    const rules = ARENA_MODES.flatMap((m) => m.rules).join(" ").toLowerCase();
    expect(rules).toMatch(/peak3/);
    expect(rules).not.toMatch(/rebound|assist|points per game|fantasy/);
  });

  it("labels seat counts from the server's number", () => {
    expect(seatLabel(3)).toBe("3 players");
    expect(seatLabel(2)).toBe("2 players");
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("the lobby shows both games at once", () => {
  it("renders one card per offerable mode with its facts and actions", async () => {
    // The OPEN posture: the public queue is accepting joins, so all three
    // entry paths are real controls. See the closed-alpha block below for what
    // the same page looks like when it is not.
    render(<ArenaLobby />);
    await screen.findByTestId("lobby-mode-grid");

    for (const mode of ARENA_MODES) {
      const card = await screen.findByTestId(`lobby-mode-${mode.id}`);
      expect(card).toHaveTextContent(mode.name);
      expect(card).toHaveTextContent(mode.duration);
      expect(card).toHaveTextContent(mode.kindBadge);
      // All three actions on the card itself — no wizard step in between.
      expect(screen.getByTestId(`lobby-${mode.id}-public_queue`)).toBeEnabled();
      expect(screen.getByTestId(`lobby-${mode.id}-private_room`)).toBeEnabled();
      expect(screen.getByTestId(`lobby-${mode.id}-practice`)).toBeEnabled();
    }
  });

  it("shows a real unavailable state when the arena is off", async () => {
    // THE ONE REMAINING WALL, and it must stay a wall: a missing Arena
    // capability is not a closed alpha, it is nothing being served.
    vi.stubGlobal("fetch", mockFetch({ ...READY, arena_enabled: false }));
    render(<ArenaLobby />);
    const panel = await screen.findByTestId("lobby-disabled");
    expect(panel).toHaveTextContent(/not open yet/i);
    expect(screen.queryByTestId("lobby-mode-twenty_dollar")).toBeNull();
    expect(screen.queryByTestId("lobby-mode-three_man_weave")).toBeNull();
  });

  it("says which unavailable state it is in", async () => {
    // Three different operational problems that used to share one paragraph.
    vi.stubGlobal("fetch", mockFetch({ ...READY, modes: [] }));
    render(<ArenaLobby />);
    await screen.findByTestId("lobby-no-modes");

    cleanup();
    vi.stubGlobal(
      "fetch",
      mockFetch({ ...READY, bots_enabled: false, public_queue_enabled: false }),
    );
    // Private rooms follow the Arena, so "nothing is open" needs the Arena
    // itself to be the only thing left on -- which is what this readiness is
    // NOT. It is practice-only-minus-bots, and that is a card-level message.
    render(<ArenaLobby />);
    await screen.findByTestId("lobby-mode-grid");
    expect(screen.getByTestId("lobby-twenty_dollar-practice")).toBeDisabled();
    expect(
      screen.getAllByText(/PEAK3 Bot is offline right now\./i).length,
    ).toBeGreaterThan(0);
  });

  it("never exposes a feature-flag name", async () => {
    render(<ArenaLobby />);
    const lobby = await screen.findByTestId("arena-lobby");
    expect(lobby.textContent ?? "").not.toMatch(
      /ARENA_|feature flag|allowlist|readiness_level/i,
    );
  });
});

/**
 * CLOSED ALPHA: bots seat, the public queue does not.
 *
 * THE DEFECT THESE COVER. The lobby asked readiness one question --
 * `arena_enabled` -- and answered everything else with a `disabled` flag per
 * control. So the manual review found a page whose entire content was
 *
 *     "Multiplayer is not open yet.
 *      Three-Man Weave and The $20 Showdown are in closed alpha."
 *
 * with no way past it, while the API was serving both modes and bots were
 * enabled. And with the flags right it was barely better: two of the three
 * controls on each card were permanently greyed out, under a heading promising
 * "live games against other people".
 */
describe("closed alpha — bots on, public queue off", () => {
  const CLOSED_ALPHA = { ...READY, public_queue_enabled: false, bots_enabled: true };

  it("offers BOTH bot-practice modes as playable, not as a wall", async () => {
    vi.stubGlobal("fetch", mockFetch(CLOSED_ALPHA));
    render(<ArenaLobby />);
    await screen.findByTestId("lobby-mode-grid");

    expect(screen.queryByTestId("lobby-disabled")).toBeNull();
    expect(screen.queryByTestId("lobby-no-modes")).toBeNull();
    for (const id of ["three_man_weave", "twenty_dollar"]) {
      expect(screen.getByTestId(`lobby-mode-${id}`)).toBeInTheDocument();
      const play = screen.getByTestId(`lobby-${id}-practice`);
      expect(play).toBeEnabled();
      expect(play).toHaveTextContent(/play vs bots/i);
      expect(screen.getByTestId(`lobby-${id}-playable`)).toHaveTextContent(/playable/i);
    }
  });

  it("does not claim the rescued modes cannot be played", async () => {
    vi.stubGlobal("fetch", mockFetch(CLOSED_ALPHA));
    render(<ArenaLobby />);
    await screen.findByTestId("lobby-mode-grid");
    const text = (await screen.findByTestId("arena-lobby")).textContent ?? "";
    expect(text).not.toMatch(/Multiplayer is not open yet/i);
    expect(text).not.toMatch(/no multiplayer games are available/i);
    // And it says the true thing instead.
    expect(text).toMatch(/live matchmaking .* is not open/i);
  });

  it("keeps public matchmaking unavailable, and says so once rather than per card", async () => {
    vi.stubGlobal("fetch", mockFetch(CLOSED_ALPHA));
    render(<ArenaLobby />);
    await screen.findByTestId("lobby-mode-grid");

    // Not a disabled button on every card — no control at all.
    expect(screen.queryByTestId("lobby-twenty_dollar-public_queue")).toBeNull();
    expect(screen.queryByTestId("lobby-three_man_weave-public_queue")).toBeNull();

    const later = screen.getByTestId("lobby-coming-later");
    expect(later).toHaveTextContent(/public matchmaking/i);
    expect(later).toHaveTextContent(/ratings/i);
    expect(later).toHaveTextContent(/arena leaderboard/i);
  });

  it("shows neither a rating nor an arena leaderboard as available", async () => {
    vi.stubGlobal("fetch", mockFetch(CLOSED_ALPHA));
    render(<ArenaLobby />);
    const lobby = await screen.findByTestId("arena-lobby");
    // Every card says unrated, and the only mention of ratings or a board is
    // inside the "coming later" panel.
    expect(lobby).toHaveTextContent(/unrated in alpha/i);
    const later = screen.getByTestId("lobby-coming-later");
    for (const word of ["Ratings", "Arena leaderboard"]) {
      const hits = screen.getAllByText(new RegExp(word, "i"));
      for (const hit of hits) expect(later.contains(hit)).toBe(true);
    }
  });

  it("starts a bot match from the card and routes to the mode's match path", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(CLOSED_ALPHA, { "/matches/practice": { match_id: "alpha-1" } }),
    );
    render(<ArenaLobby />);
    await screen.findByTestId("lobby-mode-grid");
    await userEvent.click(screen.getByTestId("lobby-three_man_weave-practice"));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/arena/three-man-weave/alpha-1"),
    );
  });

  it("still offers Play With Friends, which the server has not closed", async () => {
    vi.stubGlobal("fetch", mockFetch(CLOSED_ALPHA));
    render(<ArenaLobby />);
    await screen.findByTestId("lobby-mode-grid");
    expect(screen.getByTestId("lobby-twenty_dollar-private_room")).toBeEnabled();
  });

  it("names no feature flag while explaining what is closed", async () => {
    vi.stubGlobal("fetch", mockFetch(CLOSED_ALPHA));
    render(<ArenaLobby />);
    const lobby = await screen.findByTestId("arena-lobby");
    expect(lobby.textContent ?? "").not.toMatch(
      /ARENA_|feature flag|allowlist|readiness_level|public_queue/i,
    );
  });
});

describe("starting a game", () => {
  it("practice routes straight to the mode's match path", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(READY, { "/matches/practice": { match_id: "abc-123" } }),
    );
    const user = userEvent.setup();
    render(<ArenaLobby />);
    await screen.findByTestId("lobby-mode-grid");
    await user.click(screen.getByTestId("lobby-three_man_weave-practice"));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/arena/three-man-weave/abc-123"),
    );
  });

  it("redirects at most once even if the control is pressed twice", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(READY, { "/matches/practice": { match_id: "abc-123" } }),
    );
    const user = userEvent.setup();
    render(<ArenaLobby />);
    await screen.findByTestId("lobby-mode-grid");
    const button = screen.getByTestId("lobby-twenty_dollar-practice");
    await user.click(button);
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    await user.click(button);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("opens a compact create/join control rather than a second screen", async () => {
    const user = userEvent.setup();
    render(<ArenaLobby />);
    await screen.findByTestId("lobby-mode-grid");
    expect(screen.queryByTestId("lobby-twenty_dollar-private")).toBeNull();
    await user.click(screen.getByTestId("lobby-twenty_dollar-private_room"));
    const panel = await screen.findByTestId("lobby-twenty_dollar-private");
    expect(panel).toBeInTheDocument();
    // Both halves of the interaction are present at once.
    expect(screen.getByTestId("lobby-twenty_dollar-create-room")).toBeEnabled();
    expect(screen.getByTestId("lobby-twenty_dollar-join-code")).toBeInTheDocument();
    // The other game's card is still on screen.
    expect(screen.getByTestId("lobby-mode-three_man_weave")).toBeInTheDocument();
  });

  it("refuses to submit a join until a full six-character code is typed", async () => {
    const user = userEvent.setup();
    render(<ArenaLobby />);
    await screen.findByTestId("lobby-mode-grid");
    await user.click(screen.getByTestId("lobby-twenty_dollar-private_room"));
    const submit = screen.getByTestId("lobby-twenty_dollar-join-submit");
    expect(submit).toBeDisabled();
    await user.type(screen.getByTestId("lobby-twenty_dollar-join-code"), "abc23x");
    expect(submit).toBeEnabled();
  });

  it("shows a polished queue state with seats, countdown and a progress bar", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(READY, {
        "/queue/three_man_weave/join": {
          status: "waiting",
          mode: "three_man_weave",
          waited_seconds: 6,
          still_seeking_humans: true,
        },
      }),
    );
    const user = userEvent.setup();
    render(<ArenaLobby />);
    await screen.findByTestId("lobby-mode-grid");
    await user.click(screen.getByTestId("lobby-three_man_weave-public_queue"));

    const panel = await screen.findByTestId("lobby-searching");
    expect(panel).toHaveTextContent("Three-Man Weave");
    expect(screen.getByTestId("lobby-queue-seats")).toHaveTextContent("1 of 3");
    expect(screen.getByTestId("lobby-search-label")).toHaveTextContent(
      /looking for a human/i,
    );
    expect(screen.getByTestId("lobby-queue-countdown")).toHaveTextContent("24s");
    expect(screen.getByTestId("lobby-queue-progress")).toBeInTheDocument();
    expect(screen.getByTestId("lobby-cancel-search")).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe("presentation helpers", () => {
  it("normalises a room code the way the server's alphabet expects", () => {
    expect(normaliseRoomCode(" ab-c2 3x9zz ")).toBe("ABC23X");
  });

  it("distinguishes holding out for a human from filling with bots", () => {
    expect(
      searchLabel({ status: "waiting", mode: "m", still_seeking_humans: true }),
    ).toMatch(/human/i);
    expect(
      searchLabel({ status: "waiting", mode: "m", still_seeking_humans: false }),
    ).toMatch(/bots/i);
  });

  it("resolves a mode by its server id", () => {
    expect(modeMeta("twenty_dollar")?.name).toBe("The $20 Showdown");
    expect(modeMeta("nope")).toBeUndefined();
  });
});
