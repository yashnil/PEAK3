import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HANDOFF_TTL_MS,
  clearMatchHandoffs,
  primeMatchView,
  takeMatchView,
} from "@/lib/game-feel/match-handoff";

afterEach(() => {
  clearMatchHandoffs();
  vi.restoreAllMocks();
});

describe("handing a just-received match to its room", () => {
  it("gives the room the view once, by match id", () => {
    const view = { match_id: "m-1", state_version: 3 };
    primeMatchView(view);
    expect(takeMatchView("m-2")).toBeNull();
    expect(takeMatchView("m-1")).toBe(view);
    expect(takeMatchView("m-1")).toBeNull();
  });

  it("never resurrects a view older than the handoff window", () => {
    const clock = vi.spyOn(performance, "now");
    clock.mockReturnValue(1_000);
    primeMatchView({ match_id: "m-old" });
    clock.mockReturnValue(1_000 + HANDOFF_TTL_MS + 1);
    expect(takeMatchView("m-old")).toBeNull();
  });

  it("ignores anything that is not a match view", () => {
    primeMatchView(null);
    primeMatchView({ match_id: 7 });
    expect(takeMatchView("7")).toBeNull();
  });
});
