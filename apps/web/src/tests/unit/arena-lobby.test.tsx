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
import { render, screen, waitFor } from "@testing-library/react";
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

  it("shows a closed-alpha state rather than a playable button when the arena is off", async () => {
    vi.stubGlobal("fetch", mockFetch({ ...READY, arena_enabled: false }));
    render(<ArenaLobby />);
    const panel = await screen.findByTestId("lobby-disabled");
    expect(panel).toHaveTextContent(/closed alpha/i);
    expect(screen.queryByTestId("lobby-mode-twenty_dollar")).toBeNull();
  });

  it("explains a disabled action instead of only greying it out", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ ...READY, bots_enabled: false, public_queue_enabled: false }),
    );
    render(<ArenaLobby />);
    await screen.findByTestId("lobby-mode-grid");
    expect(screen.getByTestId("lobby-twenty_dollar-practice")).toBeDisabled();
    expect(
      screen.getAllByText(/PEAK3 Bot is offline right now\./i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Public matchmaking is paused\./i).length,
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
