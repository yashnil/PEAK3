/**
 * `getAccessToken()`'s memoization (P3-H, SYNTHESIS_CONTRACT.md §6).
 *
 * `PERFORMANCE.md` measured this running a real, un-memoized
 * `client.auth.getSession()` call before EVERY single RTT fetch. What is
 * pinned here is the fix's actual contract, not just "it doesn't crash":
 *
 *   - A burst of concurrent callers shares ONE underlying `getSession()`
 *     call, not one each.
 *   - A cached, still-valid token is returned without calling the SDK
 *     again at all.
 *   - The cache is dropped the instant Supabase reports a DIFFERENT
 *     session (sign-in, sign-out, refresh) via `onAuthStateChange` — this
 *     is a memoization of a fast-changing truth, never a second copy of it.
 *   - An expired cache entry is not served stale.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

function futureExpiry(secondsFromNow: number): number {
  return Math.floor(Date.now() / 1000) + secondsFromNow;
}

const getSession = vi.fn();
const onAuthStateChange = vi.fn();
let authStateCallback: ((event: string, session: unknown) => void) | null = null;

const fakeClient = {
  auth: {
    getSession,
    onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
      authStateCallback = cb;
      onAuthStateChange(cb);
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    },
  },
};

vi.mock("@/lib/supabase/client", () => ({
  getBrowserSupabaseClient: () => fakeClient,
}));

describe("getAccessToken caching", () => {
  beforeEach(async () => {
    vi.resetModules();
    getSession.mockReset();
    onAuthStateChange.mockReset();
    authStateCallback = null;
  });

  it("shares one in-flight getSession() call across concurrent callers", async () => {
    let resolveSession!: (v: { data: { session: { access_token: string; expires_at: number } } }) => void;
    getSession.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
    );

    const { getAccessToken } = await import("@/lib/auth");
    const [p1, p2, p3] = [getAccessToken(), getAccessToken(), getAccessToken()];
    expect(getSession).toHaveBeenCalledTimes(1);

    resolveSession({ data: { session: { access_token: "tok-a", expires_at: futureExpiry(3600) } } });
    await expect(Promise.all([p1, p2, p3])).resolves.toEqual(["tok-a", "tok-a", "tok-a"]);
  });

  it("serves a cached, still-valid token without calling getSession again", async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: "tok-b", expires_at: futureExpiry(3600) } },
    });
    const { getAccessToken } = await import("@/lib/auth");

    await expect(getAccessToken()).resolves.toBe("tok-b");
    await expect(getAccessToken()).resolves.toBe("tok-b");
    await expect(getAccessToken()).resolves.toBe("tok-b");
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("re-fetches once the cached token's expiry has passed", async () => {
    getSession
      .mockResolvedValueOnce({ data: { session: { access_token: "tok-c", expires_at: futureExpiry(-10) } } })
      .mockResolvedValueOnce({ data: { session: { access_token: "tok-d", expires_at: futureExpiry(3600) } } });
    const { getAccessToken } = await import("@/lib/auth");

    // Expired the moment it arrives (safety-margin-adjusted expiry already in
    // the past) — never served as if it were still good.
    await expect(getAccessToken()).resolves.toBe("tok-c");
    await expect(getAccessToken()).resolves.toBe("tok-d");
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("drops the cache the instant onAuthStateChange reports sign-out", async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: "tok-e", expires_at: futureExpiry(3600) } },
    });
    const { getAccessToken } = await import("@/lib/auth");

    await expect(getAccessToken()).resolves.toBe("tok-e");
    expect(getSession).toHaveBeenCalledTimes(1);

    expect(authStateCallback).not.toBeNull();
    authStateCallback?.("SIGNED_OUT", null);

    // The cache is gone even though nothing has re-called getSession yet —
    // the NEXT call must go back to the SDK, not keep serving "tok-e".
    getSession.mockResolvedValueOnce({ data: { session: null } });
    await expect(getAccessToken()).resolves.toBeNull();
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("picks up a rotated token immediately on a refresh event, with no extra getSession call", async () => {
    getSession.mockResolvedValue({
      data: { session: { access_token: "tok-f", expires_at: futureExpiry(3600) } },
    });
    const { getAccessToken } = await import("@/lib/auth");
    await expect(getAccessToken()).resolves.toBe("tok-f");

    authStateCallback?.("TOKEN_REFRESHED", { access_token: "tok-g", expires_at: futureExpiry(3600) });

    await expect(getAccessToken()).resolves.toBe("tok-g");
    // Still just the one call from the initial fetch — the refresh event
    // itself is what updated the cache, not a second round-trip.
    expect(getSession).toHaveBeenCalledTimes(1);
  });
});
