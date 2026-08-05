/**
 * Every 82-0 request carries the signed-in player's bearer token.
 *
 * WHAT BROKE ON STAGING. `apiFetch` in perfect-season-api.ts sent
 * `credentials: "include"` and no `Authorization` header. Only the handful of
 * functions that take an explicit `accessToken` argument (save, submit,
 * my-runs, personal-bests) were authenticated; create, load, respin, select,
 * place and complete were not. So a signed-in player's brand-new run was filed
 * under a GUEST subject by `resolve_owner_sub`.
 *
 * Same-origin that only mislabelled the owner. Split across origins it broke
 * outright — the guest identity lives in a cookie the browser will not send
 * cross-site — so create returned 200 and the very next request returned 403
 * `not_your_game`.
 *
 * These tests assert on the header of the actual outbound request, because the
 * bug was invisible at every other level: the API was correct, the ownership
 * check was correct, and the client's own types said nothing about auth.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getAccessToken = vi.fn<() => Promise<string | null>>();

vi.mock("@/lib/auth", () => ({
  getAccessToken: () => getAccessToken(),
}));

function mockFetch(status = 200, body: unknown = { game_id: "g-1" }) {
  const fn = vi.fn(async (...args: [string, RequestInit?]) => ({
    _args: args,
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** The Authorization header of the Nth outbound request, if any. */
function authHeaderOf(fn: ReturnType<typeof mockFetch>, call = 0): string | undefined {
  const init = fn.mock.calls[call]?.[1] as RequestInit | undefined;
  return (init?.headers as Record<string, string> | undefined)?.Authorization;
}

function initOf(fn: ReturnType<typeof mockFetch>, call = 0): RequestInit {
  return fn.mock.calls[call]?.[1] as RequestInit;
}

beforeEach(() => {
  vi.resetModules();
  getAccessToken.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("82-0 requests are authenticated centrally", () => {
  /**
   * The create call is the one that decides who owns the run for its entire
   * life, so it is named explicitly rather than folded into the loop below.
   */
  it("attaches the bearer token when CREATING a run", async () => {
    getAccessToken.mockResolvedValue("token-abc");
    const fetchFn = mockFetch();
    const { createCourtGame } = await import("@/lib/perfect-season-api");

    await createCourtGame("apex_1y");

    expect(authHeaderOf(fetchFn)).toBe("Bearer token-abc");
  });

  /**
   * Every mutator too: an authenticated create followed by an unauthenticated
   * respin is the same divergence in the other direction.
   */
  it("attaches the bearer token on load, respin, select, place and complete", async () => {
    getAccessToken.mockResolvedValue("token-abc");
    const api = await import("@/lib/perfect-season-api");

    const calls: [string, () => Promise<unknown>][] = [
      ["load", () => api.getCourtGame("g-1")],
      ["select", () => api.selectPlayer("g-1", "some-slug")],
      ["cancel", () => api.cancelSelection("g-1")],
      ["respin-team", () => api.respinTeam("g-1")],
      ["respin-season", () => api.respinSeason("g-1")],
      ["place", () => api.placeCard("g-1", "PG")],
      ["swap", () => api.swapSlots("g-1", "PG", "SG")],
      ["complete", () => api.completeCourtGame("g-1")],
    ];

    for (const [label, run] of calls) {
      const fetchFn = mockFetch();
      await run().catch(() => {
        /* shape of the response is irrelevant; the header is the assertion */
      });
      expect(authHeaderOf(fetchFn), `${label} sent no bearer token`).toBe("Bearer token-abc");
      vi.unstubAllGlobals();
    }
  });

  it("still sends credentials, so an anonymous guest keeps its cookie identity", async () => {
    getAccessToken.mockResolvedValue(null);
    const fetchFn = mockFetch();
    const { createCourtGame } = await import("@/lib/perfect-season-api");

    await createCourtGame("apex_1y");

    expect(initOf(fetchFn).credentials).toBe("include");
    expect(authHeaderOf(fetchFn)).toBeUndefined();
  });

  it("sends no Authorization header at all when signed out", async () => {
    // Not `Bearer null` and not `Bearer undefined`: an unparseable header would
    // be rejected by the API and would break anonymous play, which must keep
    // working exactly as before.
    getAccessToken.mockResolvedValue(null);
    const fetchFn = mockFetch();
    const { createCourtGame } = await import("@/lib/perfect-season-api");

    await createCourtGame("apex_1y");

    const headers = initOf(fetchFn).headers as Record<string, string>;
    expect(Object.keys(headers)).not.toContain("Authorization");
  });

  it("does not let an auth-layer failure block a guest-playable request", async () => {
    getAccessToken.mockRejectedValue(new Error("supabase unreachable"));
    const fetchFn = mockFetch();
    const { createCourtGame } = await import("@/lib/perfect-season-api");

    await expect(createCourtGame("apex_1y")).resolves.toBeTruthy();
    expect(authHeaderOf(fetchFn)).toBeUndefined();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("keeps an explicitly-passed token, so the save/submit callers are unchanged", async () => {
    // Those functions take an accessToken argument and set the header
    // themselves. options.headers is spread last, so the explicit value wins
    // rather than being silently replaced by a stale ambient one.
    getAccessToken.mockResolvedValue("ambient-token");
    const fetchFn = mockFetch(200, { saved_run: {}, personal_bests: {}, comparison: "first" });
    const { saveRun } = await import("@/lib/perfect-season-api");

    await saveRun("g-1", "explicit-token");

    expect(authHeaderOf(fetchFn)).toBe("Bearer explicit-token");
  });

  it("a caller cannot accidentally drop credentials by passing its own init", async () => {
    // `options` is spread BEFORE headers/credentials for exactly this reason.
    getAccessToken.mockResolvedValue("token-abc");
    const fetchFn = mockFetch();
    const { getCourtGame } = await import("@/lib/perfect-season-api");

    await getCourtGame("g-1"); // passes { cache: "no-store" }

    const init = initOf(fetchFn);
    expect(init.credentials).toBe("include");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-abc");
  });
});
