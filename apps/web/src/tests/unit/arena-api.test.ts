/**
 * The Arena API client.
 *
 * WHAT CAN GO WRONG HERE, and what these cover:
 *
 *  * a missing bearer token. Arena is account-backed and resolves the caller's
 *    SEAT from `auth.sub`, so a request without the header is not a guest
 *    request -- it is a 403. Attaching it centrally inside the fetch wrapper is
 *    the fix `perfect-season-api.ts:45-70` records the reason for; these tests
 *    hold that fix in place for every endpoint rather than for the handful a
 *    caller remembered.
 *  * a missing or unstable idempotency key. The server requires one, and a
 *    retry after a dropped response must reuse the SAME key or the move is
 *    applied twice.
 *  * a missing `expected_state_version`, which silently turns the optimistic
 *    concurrency check into a no-op for everyone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  ArenaAPIError,
  commandIdempotencyKey,
  createPracticeMatch,
  getArenaReadiness,
  getMatch,
  submitCommand,
} from "@/lib/arena-api";

const getAccessToken = vi.fn();
vi.mock("@/lib/auth", () => ({
  getAccessToken: (...args: unknown[]) => getAccessToken(...args),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  getAccessToken.mockResolvedValue("tok-123");
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastCall(): [string, RequestInit] {
  return fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];
}

describe("auth is attached centrally", () => {
  it.each([
    ["readiness", () => getArenaReadiness()],
    ["get match", () => getMatch("m1")],
    ["create practice", () => createPracticeMatch("three_man_weave")],
    ["submit command", () => submitCommand("m1", "tmw_pick", {}, 3, "key12345")],
  ])("sends the bearer token on %s", async (_name, call) => {
    await call();
    const [, init] = lastCall();
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-123");
  });

  it("still sends the request when the auth layer throws", async () => {
    // An auth hiccup must not become an unhandled rejection that blocks a
    // request the server would have answered authoritatively.
    getAccessToken.mockRejectedValue(new Error("nope"));
    await getArenaReadiness();
    const [, init] = lastCall();
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("omits the header entirely when signed out", async () => {
    getAccessToken.mockResolvedValue(null);
    await getMatch("m1");
    const [, init] = lastCall();
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});

describe("submitCommand", () => {
  it("sends both required concurrency fields", async () => {
    await submitCommand("m1", "tmw_pick", { player_slug: "x", slot_type: "PG" }, 7, "key12345");
    const [url, init] = lastCall();
    expect(url).toContain("/arena/matches/m1/commands");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      command_type: "tmw_pick",
      payload: { player_slug: "x", slot_type: "PG" },
      idempotency_key: "key12345",
      expected_state_version: 7,
    });
  });
});

describe("commandIdempotencyKey", () => {
  it("is stable for the same intended action, so a retry is a replay", () => {
    const payload = { slot_type: "PG", player_slug: "x" };
    const a = commandIdempotencyKey("m1", 0, 3, "tmw_pick", payload);
    // Same action, keys written in a different order -- still the same key.
    const b = commandIdempotencyKey("m1", 0, 3, "tmw_pick", {
      player_slug: "x",
      slot_type: "PG",
    });
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(8);
  });

  it("differs when anything about the action differs", () => {
    const base = commandIdempotencyKey("m1", 0, 3, "tmw_pick", { player_slug: "x" });
    expect(base).not.toBe(commandIdempotencyKey("m1", 0, 4, "tmw_pick", { player_slug: "x" }));
    expect(base).not.toBe(commandIdempotencyKey("m1", 1, 3, "tmw_pick", { player_slug: "x" }));
    expect(base).not.toBe(commandIdempotencyKey("m1", 0, 3, "tmw_pick", { player_slug: "y" }));
    expect(base).not.toBe(commandIdempotencyKey("m2", 0, 3, "tmw_pick", { player_slug: "x" }));
  });

  it("stays inside the server's 128-character limit", () => {
    const key = commandIdempotencyKey(
      "m".repeat(80),
      0,
      3,
      "tmw_pick",
      { player_slug: "p".repeat(80) },
    );
    expect(key.length).toBeLessThanOrEqual(128);
  });
});

describe("errors", () => {
  it("distinguishes a transport failure from a refusal", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    await expect(getMatch("m1")).rejects.toMatchObject({
      code: "network_error",
      status: 0,
    });
  });

  it("surfaces the server's structured error code", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ detail: { error_code: "not_in_match", message: "Not your match." } }),
    });
    await expect(getMatch("m1")).rejects.toMatchObject({
      code: "not_in_match",
      detail: "Not your match.",
    });
  });

  it("handles a plain-string detail", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: "No such match." }),
    });
    await expect(getMatch("m1")).rejects.toBeInstanceOf(ArenaAPIError);
  });
});
