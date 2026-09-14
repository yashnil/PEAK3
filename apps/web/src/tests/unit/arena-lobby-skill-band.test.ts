import { afterEach, describe, expect, it, vi } from "vitest";

import { skillBandLabel, type QueueStatus } from "@/lib/arena-lobby-api";

const waiting = (extra: Partial<QueueStatus>): QueueStatus => ({
  status: "waiting",
  mode: "three_man_weave",
  waited_seconds: 4,
  still_seeking_humans: true,
  ...extra,
});

describe("the queue's skill range, as the server reports it", () => {
  it("names a bounded band in whole rating points", () => {
    expect(skillBandLabel(waiting({ rating_band: 200 }))).toBe("Within 200 rating");
  });

  it("says the search is open to anyone once the band is unbounded", () => {
    expect(skillBandLabel(waiting({ rating_band: null, still_seeking_humans: false }))).toBe("Any rating");
  });

  it("says nothing when the server did not publish a band", () => {
    expect(skillBandLabel(waiting({}))).toBeNull();
  });

  it("says nothing outside a live search", () => {
    expect(skillBandLabel(null)).toBeNull();
    expect(skillBandLabel({ status: "matched", mode: "twenty_dollar", match_id: "m" })).toBeNull();
  });
});

describe("matchmaking wait telemetry", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/analytics");
  });

  it("reports whole seconds from the join press, and nothing about the match", async () => {
    const track = vi.fn();
    vi.doMock("@/lib/analytics", () => ({ analytics: { track } }));
    const { reportMatchmakingWait } = await import("@/lib/game-feel/action-timing");
    const joinedAt = performance.now() - 12_400;
    reportMatchmakingWait("twenty_dollar", joinedAt);
    expect(track).toHaveBeenCalledTimes(1);
    const event = track.mock.calls[0][0];
    expect(event).toMatchObject({ type: "arena_action_timing", mode: "twenty_dollar", decision: "queue_matched" });
    expect(event.wait_seconds).toBeGreaterThanOrEqual(12);
    expect(event.wait_seconds).toBeLessThanOrEqual(13);
    expect(Object.keys(event).sort()).toEqual(["decision", "mode", "outcome", "type", "wait_seconds"]);
  });
});
