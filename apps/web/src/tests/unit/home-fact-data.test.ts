/**
 * `loadNbaFactOfTheDay` — the homepage's server-side fetch.
 *
 * WHAT THIS IS GUARDING. Staging deployed an API image with no fact bank, so
 * `/api/v1/nba-facts/today` returned 503 for the whole deploy and the homepage
 * dropped its panel. The API fix is the important half; this half is that the
 * homepage must RECOVER BY ITSELF once the API is healthy, rather than holding
 * a cached failure until someone redeploys the frontend.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadNbaFactOfTheDay } from "@/components/home/home-data";

const FACT = {
  fact_id: "rules-abc123",
  headline: "Basketball invented the shot clock because one game finished 19-18.",
  body: "Four years later the NBA adopted a 24-second clock, and scoring jumped 13.6 points a game in a single season.",
  text: "Basketball invented the shot clock because one game finished 19-18.",
  category: "rules",
  era: "1950s",
  geography: "usa",
  feature: "24 seconds",
  feature_label: "the new clock",
  source_label: "Editorial — checked against a named published source",
  player_slug: null,
  team_code: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadNbaFactOfTheDay", () => {
  it("returns the fact when the API is healthy", async () => {
    fetchMock.mockResolvedValue(jsonResponse(FACT));
    const fact = await loadNbaFactOfTheDay();
    expect(fact?.fact_id).toBe(FACT.fact_id);
    expect(fact?.headline).toBe(FACT.headline);
  });

  it("never caches the response", async () => {
    // THE RECOVERY PROPERTY. A cached fetch would have kept rendering the
    // deploy-time 503 after the API was fixed.
    fetchMock.mockResolvedValue(jsonResponse(FACT));
    await loadNbaFactOfTheDay();

    const [, init] = fetchMock.mock.calls[0];
    expect(init).toMatchObject({ cache: "no-store" });
    // And no revalidate window sneaking in by another name.
    expect(init).not.toHaveProperty("next");
  });

  it("recovers on the next request after a 503, with no code change", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: "The NBA fact bank has not been built." }, 503),
    );
    expect(await loadNbaFactOfTheDay()).toBeNull();

    // The API is redeployed. The very next render asks again and gets a fact.
    fetchMock.mockResolvedValueOnce(jsonResponse(FACT));
    const recovered = await loadNbaFactOfTheDay();
    expect(recovered?.fact_id).toBe(FACT.fact_id);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null rather than throwing when the API is unreachable", async () => {
    // A homepage that 500s over a trivia panel is worse than one without it.
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await loadNbaFactOfTheDay()).toBeNull();
  });

  it("never invents a fact from a failed response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "nope" }, 503));
    expect(await loadNbaFactOfTheDay()).toBeNull();
  });
});
