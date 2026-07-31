/**
 * Daily Grid API client (Phase 11D).
 *
 * A separate file from daily-grid-components.test.tsx on purpose: that one
 * mocks `@/lib/daily-grid-api` wholesale to prove the components never score
 * anything themselves, so it cannot also exercise the real client.
 *
 * What matters here is the 429 path. A rate limit is the one server response a
 * player can hit while playing correctly (a fast typist on a slow debounce),
 * so it has to read as "wait a second", not as an error that lost their board.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DailyGridAPIError,
  RATE_LIMITED_MESSAGE,
  getDailyGridBoard,
  saveOfficialDailyGridResult,
  searchPlayerSeasons,
} from "@/lib/daily-grid-api";

const realFetch = global.fetch;

function mockResponse(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

afterEach(() => {
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("daily-grid API client — rate limiting", () => {
  const LIMITED = { detail: { error_code: "rate_limited", message: "Too many requests." } };

  it("turns a 429 into a sentence the player can act on", async () => {
    mockResponse(429, LIMITED);
    await expect(searchPlayerSeasons({ q: "jordan" })).rejects.toThrow(RATE_LIMITED_MESSAGE);
  });

  it("reassures rather than reading as data loss", async () => {
    // The board, the locked picks and the timer are all untouched by a 429,
    // and the copy has to say so -- otherwise it looks like the run was lost.
    expect(RATE_LIMITED_MESSAGE).toMatch(/your board is safe/i);
  });

  it("does not surface a retry countdown", async () => {
    // Retry-After is deliberately not shown: a countdown to the next allowed
    // request is the calibration signal the server withholds on purpose.
    expect(RATE_LIMITED_MESSAGE).not.toMatch(/\d/);
  });

  it("keeps the machine-readable code so callers can branch", async () => {
    mockResponse(429, LIMITED);
    await expect(searchPlayerSeasons({ q: "jordan" })).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
    });
  });

  it("applies to every Daily Grid route, not just search", async () => {
    mockResponse(429, LIMITED);
    await expect(getDailyGridBoard()).rejects.toThrow(RATE_LIMITED_MESSAGE);
  });

  it("leaves other errors with the server's own message", async () => {
    mockResponse(400, {
      detail: { error_code: "invalid_grid_date", message: "date must be a real YYYY-MM-DD date" },
    });
    await expect(getDailyGridBoard("nope")).rejects.toThrow(/real YYYY-MM-DD date/);
  });
});

describe("daily-grid API client — official save", () => {
  it("sends the bearer token and carries no score of its own", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ official_saved: true, created: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await saveOfficialDailyGridResult(
      {
        date: "2026-03-14",
        filled: [{ row: 0, col: 0, answer_id: "a" }],
        incorrect_attempts: 1,
        elapsed_seconds: 300,
        theme: "Award Season",
      },
      "test-token",
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer test-token");
    const sent = JSON.parse(init.body as string);
    // The server recomputes every scored number from the board; there is
    // deliberately nothing here for a client to inflate.
    expect(sent).not.toHaveProperty("score");
    expect(sent).not.toHaveProperty("percent_of_best");
    expect(sent).not.toHaveProperty("optimal_total");
  });

  it("surfaces an auth failure as an error the caller can swallow", async () => {
    mockResponse(401, { detail: "authentication_required" });
    await expect(
      saveOfficialDailyGridResult(
        { date: "2026-03-14", filled: [], incorrect_attempts: 0 },
        "bad-token",
      ),
    ).rejects.toBeInstanceOf(DailyGridAPIError);
  });
});
