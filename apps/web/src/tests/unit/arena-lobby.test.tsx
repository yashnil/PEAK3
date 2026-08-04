/**
 * The shared Arena lobby.
 *
 * The two properties worth protecting here are (1) that rated state is visible
 * BEFORE a player commits, since a match that did not count must never be a
 * discovery made afterwards, and (2) that the lobby is genuinely mode-agnostic
 * — a mode is data plus a route, so a second mode must render without this
 * component changing.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  ARENA_MODES,
  ENTRY_PATHS,
  modeMeta,
  offerableModes,
} from "@/lib/arena-modes";
import { normaliseRoomCode, searchLabel } from "@/lib/arena-lobby-api";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/auth", () => ({ getAccessToken: async () => "token" }));

import ArenaLobby from "@/components/arena/ArenaLobby";

const READY = {
  readiness_level: "open",
  arena_enabled: true,
  public_queue_enabled: true,
  bots_enabled: true,
  modes: [
    { id: "twenty_dollar", seat_count: 2 },
    { id: "three_man_weave", seat_count: 3 },
  ],
};

function mockFetch(readiness = READY) {
  return vi.fn(async (url: string) => {
    if (String(url).includes("/readiness")) {
      return { ok: true, json: async () => readiness } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
}

beforeEach(() => {
  push.mockReset();
  vi.stubGlobal("fetch", mockFetch());
});
afterEach(() => vi.unstubAllGlobals());

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

  it("labels every entry path on the button itself", async () => {
    const user = userEvent.setup();
    render(<ArenaLobby />);
    await user.click(await screen.findByTestId("lobby-mode-twenty_dollar"));

    expect(screen.getByTestId("lobby-rated-public_queue")).toHaveTextContent("Rated");
    expect(screen.getByTestId("lobby-rated-private_room")).toHaveTextContent("Unrated");
    expect(screen.getByTestId("lobby-rated-practice")).toHaveTextContent("Unrated");
  });

  it("says plainly that a bot-filled public match still counts", async () => {
    const user = userEvent.setup();
    render(<ArenaLobby />);
    await user.click(await screen.findByTestId("lobby-mode-twenty_dollar"));
    expect(screen.getByTestId("lobby-note-public_queue")).toHaveTextContent(
      /filled with bots and the match still counts/i,
    );
  });

  it("says a private room is never auto-filled", async () => {
    const user = userEvent.setup();
    render(<ArenaLobby />);
    await user.click(await screen.findByTestId("lobby-mode-twenty_dollar"));
    expect(screen.getByTestId("lobby-note-private_room")).toHaveTextContent(
      /never filled automatically/i,
    );
  });
});

describe("the lobby is mode-agnostic", () => {
  it("offers every mode the server registered", async () => {
    render(<ArenaLobby />);
    expect(await screen.findByTestId("lobby-mode-twenty_dollar")).toBeInTheDocument();
    expect(screen.getByTestId("lobby-mode-three_man_weave")).toBeInTheDocument();
  });

  it("offers only what the server registered", async () => {
    vi.stubGlobal("fetch", mockFetch({ ...READY, modes: [{ id: "twenty_dollar", seat_count: 2 }] }));
    render(<ArenaLobby />);
    expect(await screen.findByTestId("lobby-mode-twenty_dollar")).toBeInTheDocument();
    expect(screen.queryByTestId("lobby-mode-three_man_weave")).toBeNull();
  });

  it("skips a registered mode this build has no route for", () => {
    // A blank card that navigates nowhere is worse than an absent one.
    expect(offerableModes([
        { id: "twenty_dollar", seat_count: 2 },
        { id: "some_future_mode", seat_count: 5 },
      ])).toHaveLength(1);
  });

  it("renders nothing to play when the registry is empty", async () => {
    vi.stubGlobal("fetch", mockFetch({ ...READY, modes: [] }));
    render(<ArenaLobby />);
    expect(await screen.findByTestId("lobby-no-modes")).toBeInTheDocument();
  });

  it("carries a route for every catalogued mode", () => {
    for (const mode of ARENA_MODES) {
      expect(mode.matchPath("abc")).toContain("abc");
    }
  });

  // Seat count is no longer catalogued -- it comes from `readiness`, so the
  // thing worth asserting is that the SERVER's number reaches the card rather
  // than a client-side default. A mode the server does not publish is not
  // offerable at all, so there is never a count to guess.
  it("takes each mode's seat count from the server, not from the catalogue", () => {
    const offerable = offerableModes([
      { id: "twenty_dollar", seat_count: 2 },
      { id: "three_man_weave", seat_count: 3 },
    ]);
    expect(offerable.map((m) => m.seatCount)).toEqual([2, 3]);
    expect(new Set(offerable.map((m) => m.seatCount)).size).toBeGreaterThan(1);
  });

  it("believes the server over the catalogue if they ever disagree", () => {
    const [only] = offerableModes([{ id: "twenty_dollar", seat_count: 4 }]);
    expect(only.seatCount).toBe(4);
  });

  it("looks a mode up by id", () => {
    expect(modeMeta("twenty_dollar")?.name).toBe("The $20 Showdown");
    expect(modeMeta("nope")).toBeUndefined();
  });
});

describe("availability is the server's answer", () => {
  it("disables the public queue when the server has it off", async () => {
    vi.stubGlobal("fetch", mockFetch({ ...READY, public_queue_enabled: false }));
    const user = userEvent.setup();
    render(<ArenaLobby />);
    await user.click(await screen.findByTestId("lobby-mode-twenty_dollar"));
    expect(screen.getByTestId("lobby-path-public_queue")).toBeDisabled();
    expect(screen.getByTestId("lobby-note-public_queue")).toHaveTextContent(
      /not available/i,
    );
  });

  it("disables bot practice when bots are off", async () => {
    vi.stubGlobal("fetch", mockFetch({ ...READY, bots_enabled: false }));
    const user = userEvent.setup();
    render(<ArenaLobby />);
    await user.click(await screen.findByTestId("lobby-mode-twenty_dollar"));
    expect(screen.getByTestId("lobby-path-practice")).toBeDisabled();
  });

  it("closes cleanly when the arena is off entirely", async () => {
    vi.stubGlobal("fetch", mockFetch({ ...READY, arena_enabled: false }));
    render(<ArenaLobby />);
    expect(await screen.findByTestId("lobby-disabled")).toBeInTheDocument();
  });

  it("reports an unreachable API rather than hanging", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network");
      }),
    );
    render(<ArenaLobby />);
    await waitFor(() =>
      expect(screen.getByTestId("lobby-error")).toHaveTextContent(/could not reach/i),
    );
  });
});

describe("search copy is honest about who you will play", () => {
  it("distinguishes holding out for a human from giving up on one", () => {
    expect(
      searchLabel({ status: "waiting", mode: "m", still_seeking_humans: true }),
    ).toMatch(/looking for a human/i);
    expect(
      searchLabel({ status: "waiting", mode: "m", still_seeking_humans: false }),
    ).toMatch(/filling the remaining seats with bots/i);
  });

  it("reports the other two queue states", () => {
    expect(searchLabel({ status: "matched", mode: "m" })).toMatch(/found/i);
    expect(searchLabel({ status: "not_in_queue", mode: "m" })).toMatch(/not searching/i);
    expect(searchLabel(null)).toMatch(/not searching/i);
  });
});

describe("room codes", () => {
  it("normalises to the server's six-character shape", () => {
    expect(normaliseRoomCode("abc-123")).toBe("ABC123");
    expect(normaliseRoomCode("abcdefgh")).toBe("ABCDEF");
    expect(normaliseRoomCode("a b*c1")).toBe("ABC1");
  });

  it("only enables Join on a complete code", async () => {
    const user = userEvent.setup();
    render(<ArenaLobby />);
    const input = await screen.findByTestId("lobby-join-code");
    expect(screen.getByTestId("lobby-join-submit")).toBeDisabled();
    await user.type(input, "abc123");
    expect(screen.getByTestId("lobby-join-submit")).not.toBeDisabled();
  });

  it("does not require choosing a mode first, because the code decides it", async () => {
    render(<ArenaLobby />);
    expect(await screen.findByTestId("lobby-join-code")).toBeInTheDocument();
  });
});
