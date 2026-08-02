/**
 * The telemetry sink must not make requests this deployment knows will be
 * refused.
 *
 * WHAT THIS PINS. `src/lib/analytics.ts` forwards a subset of events to
 * `POST /api/v1/telemetry/events`. That endpoint is OFF by default on the API
 * and answers 403 `telemetry_disabled`. The client handled the 403 correctly
 * but only for the life of the document, so every page load asked again --
 * hundreds of unauthorized POSTs across a browser run, each one drowning out
 * any 403 that would have meant something.
 *
 * Two rules now, and these are the tests for both:
 *   1. with collection off (the default), NOTHING is sent -- no probe, no
 *      first batch, nothing;
 *   2. with it on, a server refusal is remembered for the whole TAB, so a
 *      navigation does not re-ask.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const INGEST = "http://localhost:8000/api/v1/telemetry/events";

async function loadAnalytics(enabled: boolean) {
  const analytics = await reloadAnalytics(enabled);
  // Clears the module's in-memory state AND the tab-level refusal, so each
  // case starts from a genuinely fresh visit.
  analytics.__resetForTests();
  return analytics;
}

/** A NAVIGATION within the same tab: the module is re-evaluated from scratch
 *  (page-session state is gone) but `sessionStorage` survives, exactly as it
 *  does in a browser. Deliberately does NOT call `__resetForTests`, which
 *  would wipe the very thing under test. */
async function reloadAnalytics(enabled: boolean) {
  vi.stubEnv("NEXT_PUBLIC_TELEMETRY_ENABLED", enabled ? "true" : "");
  vi.resetModules();
  const mod = await import("@/lib/analytics");
  return mod.analytics;
}

function stubFetch(status: number) {
  // The signature is declared on `vi.fn` rather than on the implementation:
  // the stub ignores both arguments (it always answers the same way), but the
  // assertions below read `mock.calls[0][0]` and `[0][1]`, and those are only
  // typed if the mock knows its own call shape.
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () => new Response("{}", { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("telemetry collection gate", () => {
  it("sends nothing at all when the deployment has not enabled collection", async () => {
    const fetchMock = stubFetch(403);
    const analytics = await loadAnalytics(false);

    // A collected event -- the kind that WOULD be forwarded if collection
    // were on. Flushed explicitly so this is not just the timer not firing.
    analytics.track({ type: "game_opened", mode: "apex_1y" });
    await analytics.flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(analytics.isDisabled).toBe(true);
  });

  it("still reports through the dev-console sink when collection is off", async () => {
    // The point of the gate is to stop REQUESTS, not to stop analytics being
    // useful locally. If this ever failed, the gate would have taken the
    // console sink out with it.
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    stubFetch(403);
    const analytics = await loadAnalytics(false);

    analytics.track({ type: "game_opened", mode: "apex_1y" });

    expect(debug).toHaveBeenCalled();
    debug.mockRestore();
  });

  it("asks once and remembers the refusal for the whole tab", async () => {
    const fetchMock = stubFetch(403);
    const analytics = await loadAnalytics(true);

    analytics.track({ type: "game_opened", mode: "apex_1y" });
    await analytics.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(INGEST);

    // A NAVIGATION: module state is gone, but the tab's sessionStorage is not.
    // Without the persisted refusal this second load would post again, which
    // is exactly the behaviour being fixed.
    const reloaded = await reloadAnalytics(true);
    reloaded.track({ type: "game_opened", mode: "apex_1y" });
    await reloaded.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does send, once, when both sides are enabled and the server accepts", async () => {
    // The counterweight: the gate must not have made collection unreachable.
    const fetchMock = stubFetch(202);
    const analytics = await loadAnalytics(true);

    analytics.track({ type: "game_opened", mode: "apex_1y" });
    await analytics.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(analytics.isDisabled).toBe(false);
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.events).toEqual([{ name: "game_opened", props: { mode: "apex_1y" } }]);
  });
});
