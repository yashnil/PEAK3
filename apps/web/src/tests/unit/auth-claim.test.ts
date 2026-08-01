/**
 * The guest claim — its credential, and how its result is described.
 *
 * TWO BUGS ARE PINNED HERE, both from the client component this replaced:
 *   1. `fetch("/api/v1/auth/claim")` was RELATIVE. Every other authenticated
 *      call in the app uses `NEXT_PUBLIC_API_URL`, so on any deployment where
 *      the API is not co-hosted this 404'd — and a bare `catch {}` meant a guest
 *      who signed in silently lost their history.
 *   2. It carried no explicit failure path. `claimGuestActivity` resolving to
 *      `null` rather than throwing is what lets the caller say "we couldn't
 *      import your results" instead of pretending it worked.
 *
 * The response-shape tests exist because Track C owns the endpoint and is adding
 * four domains to it. `summarizeClaim` must not need a frontend deploy to
 * describe them, and must not break when a field it expected is absent.
 */
import { describe, it, expect, vi } from "vitest";
import {
  claimGuestActivity,
  describeClaim,
  summarizeClaim,
} from "@/lib/supabase/claim";
import { API_BASE_URL } from "@/lib/supabase/config";

/* ================================================================== */
/* The request                                                         */
/* ================================================================== */

describe("claimGuestActivity — the credential", () => {
  function okFetch(body: unknown) {
    return vi.fn().mockResolvedValue({
      ok: true,
      json: async () => body,
    }) as unknown as typeof fetch;
  }

  it("posts to the API origin, not a relative path", async () => {
    const fetchImpl = okFetch({ claimed: true, game_count: 1 });
    await claimGuestActivity("token-abc", fetchImpl);

    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${API_BASE_URL}/api/v1/auth/claim`);
    // Explicitly absolute: a relative URL here is the exact regression.
    expect(String(url).startsWith("http")).toBe(true);
  });

  it("sends credentials, because the guest token is an httponly cookie", async () => {
    const fetchImpl = okFetch({ claimed: true });
    await claimGuestActivity("token-abc", fetchImpl);

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.method).toBe("POST");
    // Without this the `peak3_anon` cookie is not attached cross-origin and the
    // server claims nothing while reporting success.
    expect(init.credentials).toBe("include");
    expect(init.headers.Authorization).toBe("Bearer token-abc");
  });

  it("never sends a run id, a board id, or any client-held identifier", async () => {
    // Plan §2.5: the anon cookie is the ONLY ownership credential. A run id read
    // out of localStorage proves nothing — anyone who saw a shared result has it.
    const fetchImpl = okFetch({ claimed: true });
    await claimGuestActivity("token-abc", fetchImpl);
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.body).toBeUndefined();
  });

  it("resolves to null — never throws — when the API is unreachable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(
      claimGuestActivity("t", fetchImpl as unknown as typeof fetch),
    ).resolves.toBeNull();
  });

  it("resolves to null on a non-2xx response rather than reporting success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({}) });
    await expect(
      claimGuestActivity("t", fetchImpl as unknown as typeof fetch),
    ).resolves.toBeNull();
  });

  it("resolves to null when the body is not JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    });
    await expect(
      claimGuestActivity("t", fetchImpl as unknown as typeof fetch),
    ).resolves.toBeNull();
  });
});

/* ================================================================== */
/* The response                                                        */
/* ================================================================== */

describe("summarizeClaim — the shape Track C owns", () => {
  it("reads the domains the endpoint returns today", () => {
    const summary = summarizeClaim({
      claimed: true,
      claim_id: "c-1",
      reason: "claimed",
      game_count: 3,
      completion_count: 2,
      challenge_count: 1,
      progression_events_claimed: 9,
      records_claimed: 0,
      achievements_claimed: 2,
    });

    expect(summary.claimed).toBe(true);
    expect(summary.reason).toBe("claimed");
    expect(summary.total).toBe(17);
    expect(summary.lines.map((l) => [l.label, l.count])).toEqual([
      ["duels", 3],
      ["daily completions", 2],
      ["challenges", 1],
      ["achievements", 2],
      ["progression events", 9],
    ]);
  });

  it("omits zero counts instead of listing 0 of everything", () => {
    const summary = summarizeClaim({
      claimed: true,
      game_count: 0,
      completion_count: 4,
      challenge_count: 0,
    });
    expect(summary.lines).toHaveLength(1);
    expect(summary.total).toBe(4);
  });

  it("degrades gracefully when a count it expected is simply missing", () => {
    // The endpoint is being extended while this ships; an absent field must be
    // absent from the UI, not a crash and not a fabricated zero.
    const summary = summarizeClaim({ claimed: true, game_count: 2 });
    expect(summary.total).toBe(2);
    expect(summary.lines).toEqual([{ key: "game_count", label: "duels", count: 2 }]);
  });

  it("names Track C's four new domains without a frontend change", () => {
    const summary = summarizeClaim({
      claimed: true,
      run_the_table_run_count: 2,
      daily_grid_result_count: 5,
      perfect_season_run_count: 1,
      perfect_season_saved_run_count: 3,
    });
    expect(summary.lines.map((l) => l.label)).toEqual([
      "RUN THE TABLE runs",
      "Daily Grid results",
      "82-0 runs",
      "saved 82-0 lineups",
    ]);
    expect(summary.total).toBe(11);
  });

  it("humanises a count key it has never seen rather than dropping it", () => {
    const summary = summarizeClaim({ claimed: true, peak_draft_board_count: 4 });
    expect(summary.lines).toEqual([
      { key: "peak_draft_board_count", label: "peak draft board", count: 4 },
    ]);
  });

  it("ignores non-numeric and negative values", () => {
    const summary = summarizeClaim({
      claimed: true,
      game_count: "3",
      completion_count: null,
      challenge_count: Number.NaN,
      records_claimed: -5,
    });
    expect(summary.lines).toEqual([]);
    expect(summary.total).toBe(0);
  });

  it("reports the server's refusal reasons without inventing counts", () => {
    for (const reason of ["no_anon_session", "invalid_anon_credential", "already_same_user"]) {
      const summary = summarizeClaim({
        claimed: false,
        reason,
        game_count: 0,
        completion_count: 0,
        challenge_count: 0,
      });
      expect(summary.reason).toBe(reason);
      expect(summary.total).toBe(0);
    }
  });

  it("survives a body that is not an object at all", () => {
    for (const payload of [null, undefined, "claimed", 42, [1, 2, 3]]) {
      const summary = summarizeClaim(payload);
      expect(summary).toEqual({ claimed: false, reason: null, lines: [], total: 0 });
    }
  });
});

describe("describeClaim", () => {
  it("reads as a sentence fragment for a screen reader", () => {
    const summary = summarizeClaim({
      claimed: true,
      game_count: 3,
      completion_count: 2,
      challenge_count: 1,
    });
    expect(describeClaim(summary)).toBe("3 duels, 2 daily completions and 1 challenges");
  });

  it("does not add a conjunction to a single line", () => {
    expect(describeClaim(summarizeClaim({ claimed: true, game_count: 3 }))).toBe("3 duels");
  });

  it("is empty when nothing moved", () => {
    expect(describeClaim(summarizeClaim({ claimed: true }))).toBe("");
  });
});
