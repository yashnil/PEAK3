/**
 * Versioned tour persistence (W3).
 *
 * The thing under test is not really "does it store a boolean" — it is the
 * three failure modes a first-run experience gets wrong:
 *
 *   1. A tour that has been bumped must replay, for everyone, without a
 *      migration.
 *   2. A corrupt or blocked `localStorage` must degrade to "not seen yet", not
 *      throw — the tour is decoration, and decoration may never break the game.
 *   3. Nothing may touch `window` on the server.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TOUR_STORAGE_KEY,
  markCoachmarkSeen,
  markTourSeen,
  readTourPrefs,
  readTourSeen,
  resetCoachmarks,
  resetTour,
  shouldAutoStartTour,
  shouldShowCoachmark,
} from "@/lib/tour-state";

const TOUR = "run-the-table";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("shouldAutoStartTour", () => {
  it("auto-starts when nothing has ever been stored", () => {
    expect(shouldAutoStartTour(TOUR, 1)).toBe(true);
  });

  it("does not auto-start once the tour has been completed at that version", () => {
    markTourSeen(TOUR, 1, "completed");
    expect(shouldAutoStartTour(TOUR, 1)).toBe(false);
  });

  it("treats a skip as seen — skipping is an answer, not a deferral", () => {
    markTourSeen(TOUR, 1, "skipped");
    expect(shouldAutoStartTour(TOUR, 1)).toBe(false);
    expect(readTourSeen(TOUR)?.status).toBe("skipped");
  });

  it("replays for everyone when the tour version is bumped", () => {
    markTourSeen(TOUR, 1, "completed");
    expect(shouldAutoStartTour(TOUR, 2)).toBe(true);
  });

  it("replays on a NEWER stored version too — a rollback must not lock it out", () => {
    markTourSeen(TOUR, 7, "completed");
    expect(shouldAutoStartTour(TOUR, 2)).toBe(true);
  });

  it("keeps tours independent of each other", () => {
    markTourSeen(TOUR, 1);
    expect(shouldAutoStartTour("some-other-tour", 1)).toBe(true);
  });
});

describe("corrupt or hostile storage", () => {
  it("treats unparseable JSON as not-seen instead of throwing", () => {
    window.localStorage.setItem(TOUR_STORAGE_KEY, "{ this is not json");
    expect(() => readTourPrefs()).not.toThrow();
    expect(shouldAutoStartTour(TOUR, 1)).toBe(true);
  });

  it("discards a payload written by a different storage schema", () => {
    window.localStorage.setItem(
      TOUR_STORAGE_KEY,
      JSON.stringify({ schema_version: 99, tours: { [TOUR]: { version: 1, status: "completed" } } }),
    );
    expect(shouldAutoStartTour(TOUR, 1)).toBe(true);
  });

  it("discards a record whose version is not a number", () => {
    window.localStorage.setItem(
      TOUR_STORAGE_KEY,
      JSON.stringify({
        schema_version: 1,
        tours: { [TOUR]: { version: "one", status: "completed" } },
        coachmarks: {},
      }),
    );
    expect(shouldAutoStartTour(TOUR, 1)).toBe(true);
  });

  it("survives a JSON array where an object was expected", () => {
    window.localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify([1, 2, 3]));
    expect(readTourPrefs().tours).toEqual({});
  });

  it("never throws when getItem itself throws (private mode)", () => {
    const spy = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => readTourPrefs()).not.toThrow();
    expect(shouldAutoStartTour(TOUR, 1)).toBe(true);
    spy.mockRestore();
  });

  it("never throws when setItem throws (quota exceeded)", () => {
    const spy = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => markTourSeen(TOUR, 1)).not.toThrow();
    expect(() => markCoachmarkSeen("draft_room", 1)).not.toThrow();
    spy.mockRestore();
  });
});

describe("coachmarks", () => {
  it("shows each one exactly once", () => {
    expect(shouldShowCoachmark("draft_room", 1)).toBe(true);
    markCoachmarkSeen("draft_room", 1);
    expect(shouldShowCoachmark("draft_room", 1)).toBe(false);
  });

  it("keeps coachmarks independent of one another", () => {
    markCoachmarkSeen("draft_room", 1);
    expect(shouldShowCoachmark("trade_desk", 1)).toBe(true);
  });

  it("replays a coachmark when the version is bumped — the rule may have changed", () => {
    markCoachmarkSeen("film_room", 1);
    expect(shouldShowCoachmark("film_room", 2)).toBe(true);
  });

  it("does not let a seen coachmark suppress the tour, or the reverse", () => {
    markCoachmarkSeen("boss_battle", 1);
    expect(shouldAutoStartTour(TOUR, 1)).toBe(true);

    window.localStorage.clear();
    markTourSeen(TOUR, 1);
    expect(shouldShowCoachmark("boss_battle", 1)).toBe(true);
  });

  it("ignores a non-numeric coachmark flag rather than trusting it", () => {
    window.localStorage.setItem(
      TOUR_STORAGE_KEY,
      JSON.stringify({ schema_version: 1, tours: {}, coachmarks: { draft_room: "yes" } }),
    );
    expect(shouldShowCoachmark("draft_room", 1)).toBe(true);
  });

  it("resetCoachmarks clears the hints without forgetting the tour", () => {
    markTourSeen(TOUR, 1);
    markCoachmarkSeen("rest_bank", 1);
    resetCoachmarks();
    expect(shouldShowCoachmark("rest_bank", 1)).toBe(true);
    expect(shouldAutoStartTour(TOUR, 1)).toBe(false);
  });
});

describe("resetTour", () => {
  it("makes the tour auto-start again", () => {
    markTourSeen(TOUR, 1);
    resetTour(TOUR);
    expect(shouldAutoStartTour(TOUR, 1)).toBe(true);
  });

  it("also clears the coachmarks — 'show me it again' means all of it", () => {
    markCoachmarkSeen("draft_room", 1);
    markTourSeen(TOUR, 1);
    resetTour(TOUR);
    expect(shouldShowCoachmark("draft_room", 1)).toBe(true);
  });

  it("leaves another tour's record alone", () => {
    markTourSeen(TOUR, 1);
    markTourSeen("other", 1);
    resetTour(TOUR);
    expect(shouldAutoStartTour("other", 1)).toBe(false);
  });
});

describe("SSR safety", () => {
  it("reports 'do not auto-start' and does not throw without a window", () => {
    vi.stubGlobal("window", undefined);
    expect(() => shouldAutoStartTour(TOUR, 1)).not.toThrow();
    expect(shouldAutoStartTour(TOUR, 1)).toBe(false);
    expect(shouldShowCoachmark("draft_room", 1)).toBe(false);
    expect(() => readTourPrefs()).not.toThrow();
    expect(() => markTourSeen(TOUR, 1)).not.toThrow();
    expect(() => markCoachmarkSeen("draft_room", 1)).not.toThrow();
    expect(() => resetTour(TOUR)).not.toThrow();
  });
});
