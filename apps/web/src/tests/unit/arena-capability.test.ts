/**
 * The Arena's posture, derived from readiness and nothing else.
 *
 * THE DEFECT UNDER TEST. `ArenaLobby` asked readiness one question —
 * `arena_enabled` — and if the answer was no it rendered a single panel:
 *
 *     "Multiplayer is not open yet.
 *      Three-Man Weave and The $20 Showdown are in closed alpha."
 *
 * Two different situations reached that panel and only one of them deserved it.
 * A missing Arena capability genuinely means nothing is being served. A CLOSED
 * ALPHA — arena on, bots on, public queue off — means both games are playable
 * right now, and saying otherwise is not a wording problem: it is the page
 * refusing access to something that works.
 *
 * One boolean cannot carry that distinction, which is why the distinction is
 * now a type. These tests pin the truth table.
 */
import { describe, expect, it } from "vitest";

import {
  ARENA_COMING_LATER,
  arenaCapability,
  arenaHeadline,
} from "@/lib/arena-capability";
import type { ArenaReadiness } from "@/lib/arena-lobby-api";

const MODES = [
  { id: "three_man_weave", seat_count: 3 },
  { id: "twenty_dollar", seat_count: 2 },
];

function readiness(overrides: Partial<ArenaReadiness> = {}): ArenaReadiness {
  return {
    readiness_level: "closed_alpha",
    arena_enabled: true,
    public_queue_enabled: false,
    bots_enabled: true,
    modes: MODES,
    ...overrides,
  };
}

describe("closed alpha is a playable posture", () => {
  it("is practice_only when bots seat and the queue does not", () => {
    const capability = arenaCapability(readiness());
    expect(capability.posture).toBe("practice_only");
    expect(capability.practiceAvailable).toBe(true);
    expect(capability.publicQueueAvailable).toBe(false);
    expect(capability.unavailableReason).toBeNull();
  });

  it("offers both registered modes", () => {
    expect(arenaCapability(readiness()).modes.map((m) => m.id).sort()).toEqual([
      "three_man_weave",
      "twenty_dollar",
    ]);
  });

  it("says live matchmaking is closed, not that multiplayer is closed", () => {
    const { intro } = arenaHeadline(arenaCapability(readiness()));
    // "Not open yet" is still the right phrase — the correction is WHAT it is
    // said about. It has to attach to matchmaking, never to Multiplayer.
    expect(intro).toMatch(/live matchmaking against other people is not open yet/i);
    expect(intro).toMatch(/playable right now/i);
    expect(intro).not.toMatch(/multiplayer is not open/i);
  });

  it("does not promise live games against other people", () => {
    // The exact sentence the page carried in EVERY configuration, including
    // this one, where it is the single thing that is not true.
    const { intro } = arenaHeadline(arenaCapability(readiness()));
    expect(intro).not.toMatch(/^Live games against other people/);
  });
});

describe("the open posture is unchanged", () => {
  it("is open once the public queue accepts joins", () => {
    const capability = arenaCapability(readiness({ public_queue_enabled: true }));
    expect(capability.posture).toBe("open");
    expect(capability.publicQueueAvailable).toBe(true);
    expect(capability.practiceAvailable).toBe(true);
    expect(arenaHeadline(capability).intro).toMatch(/live games against other people/i);
  });
});

describe("a missing capability is still a real unavailable state", () => {
  it("walls off a disabled Arena, and offers no mode", () => {
    const capability = arenaCapability(readiness({ arena_enabled: false }));
    expect(capability.posture).toBe("unavailable");
    expect(capability.unavailableReason).toBe("arena_disabled");
    expect(capability.modes).toEqual([]);
    expect(capability.practiceAvailable).toBe(false);
  });

  it("distinguishes 'no modes' from 'arena off'", () => {
    const capability = arenaCapability(readiness({ modes: [] }));
    expect(capability.posture).toBe("unavailable");
    expect(capability.unavailableReason).toBe("no_modes");
  });

  it("distinguishes 'no way in' from both of those", () => {
    // Every door shut while the Arena is nominally on: rare, and its own
    // operational question. It used to be told to a reader as "the Arena is
    // in closed alpha", which sends them to the wrong place entirely.
    const capability = arenaCapability(
      readiness({ bots_enabled: false, public_queue_enabled: false, arena_enabled: true }),
    );
    // Private rooms follow the Arena itself, so this posture is still
    // reachable — the wall needs every path closed, which only happens when
    // the Arena is off. Assert that rather than pretending otherwise.
    expect(capability.privateRoomAvailable).toBe(true);
    expect(capability.posture).toBe("practice_only");
    expect(capability.practiceAvailable).toBe(false);
  });

  it("skips a server mode this build cannot route to", () => {
    const capability = arenaCapability(
      readiness({ modes: [{ id: "a_mode_from_the_future", seat_count: 4 }] }),
    );
    expect(capability.posture).toBe("unavailable");
    expect(capability.unavailableReason).toBe("no_modes");
  });
});

describe("what the alpha holds back is stated once", () => {
  it("names public matchmaking, ratings and the arena leaderboard", () => {
    const titles = ARENA_COMING_LATER.map((item) => item.title.toLowerCase());
    expect(titles).toContain("public matchmaking");
    expect(titles).toContain("ratings");
    expect(titles).toContain("arena leaderboard");
  });

  it("says nothing about the 82-0 leaderboard, which is a different board", () => {
    // Two boards with one word between them. The Arena's rating leaderboard is
    // deliberately off; the 82-0 Peak Season board is a separate product with
    // its own flag, and conflating them in copy is how one gets switched for
    // the other.
    const text = ARENA_COMING_LATER.map((i) => `${i.title} ${i.detail}`).join(" ");
    expect(text).not.toMatch(/82-0|peak season/i);
  });
});
