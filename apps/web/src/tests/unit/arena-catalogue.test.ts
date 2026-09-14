import { afterEach, describe, expect, it, vi } from "vitest";

import { getArenaCatalogue } from "@/lib/arena-readiness-server";

afterEach(() => {
  vi.unstubAllGlobals();
});

function serve(modes: Array<{ id: string; seat_count: number }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ arena_enabled: true, modes }) }) as Response),
  );
}

describe("the Arena catalogue the homepage and /arena render", () => {
  it("lists each game once, never a ruleset variant as a game of its own", async () => {
    serve([
      { id: "three_man_weave", seat_count: 3 },
      { id: "three_man_weave_franchise", seat_count: 3 },
      { id: "three_man_weave_decade", seat_count: 3 },
      { id: "twenty_dollar", seat_count: 2 },
    ]);
    const catalogue = await getArenaCatalogue();
    expect(catalogue.available).toBe(true);
    expect(catalogue.modes.map((m) => m.id)).toEqual(["three_man_weave", "twenty_dollar"]);
  });

  it("keeps the two multiplayer games the homepage's slate takes first", async () => {
    serve([
      { id: "twenty_dollar", seat_count: 2 },
      { id: "three_man_weave_decade", seat_count: 3 },
      { id: "three_man_weave", seat_count: 3 },
    ]);
    const [first, second] = (await getArenaCatalogue()).modes;
    expect([first?.id, second?.id].sort()).toEqual(["three_man_weave", "twenty_dollar"]);
  });
});
