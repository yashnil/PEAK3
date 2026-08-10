/**
 * The rejection contract: every refusal names something the player can act on,
 * and nothing the player sees is written by a backend engineer (S20-12).
 *
 * THREE DEFECTS UNDER TEST, in the order they were found.
 *
 * 1. A FIELD-NAME MISMATCH THAT DISCARDED EVERY EXPLANATION. The API's
 *    `SubmitCommandResponse` carries its prose in `message`; the Showdown
 *    client declared the field as `rejection_message` and rendered
 *    `result.rejection_message || "That move was not accepted."`. The read was
 *    always `undefined`, so 100% of rejections showed the generic string —
 *    including the reported `$2` Curry bid, where the server had said "This
 *    match has moved on (you sent version 1, it is now 2). Reload."
 *
 * 2. AND THEN THE PASS-THROUGH BECAME THE DEFECT. Falling back to the server's
 *    own prose for an unrecognised code was fine while every code was
 *    recognised, and stopped being fine the moment three were not:
 *    `duplicate_action`, `not_bidding` and `ruleset_version_mismatch` all
 *    reached players verbatim, and the last is an engineering string naming two
 *    ruleset identifiers. `not_your_seat`, `unknown_command` and the bare
 *    `"rejected"` were not in the union at all.
 *
 * 3. AND HTTP FAILURES NEVER GOT HERE. A 404, 403, 429 or 500 was thrown before
 *    any of this ran and rendered as `apiError.message` — which for a body with
 *    no `detail.message` is literally the string `"HTTP 500"`.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  explainRejection,
  explainTransportError,
  type AttemptedAction,
} from "@/lib/arena-rejection";
import type {
  ResolvedLot,
  SubmitCommandResult,
  TwentyDollarPublicState,
} from "@/lib/twenty-dollar-api";

const SEAT_NAMES = ["You", "Floor General"];

function settledCurryLot(overrides: Partial<ResolvedLot> = {}): ResolvedLot {
  return {
    lot_index: 4,
    round_index: 4,
    candidate: {
      player_slug: "stephen-curry",
      player_name: "Stephen Curry",
      anchor_season: "2015-16",
      team: "GSW",
      positions: ["PG"],
      row_id: "stephen-curry-1yr-201516",
      rank: 3,
      prime_score: 93.9,
      components: {},
      component_index: {},
      model_version: "peak3_v1",
    },
    candidate_tier: "1-100",
    opening_seat: 1,
    bids: [0, 1],
    timed_out: [true, false],
    winner_seat: 1,
    price: 1,
    decided_by: "pass_out",
    actions: [
      { seat_index: 1, action: "bid", amount: 1 },
      { seat_index: 0, action: "pass", amount: 0, timed_out: true },
    ],
    ...overrides,
  };
}

function state(overrides: Partial<TwentyDollarPublicState> = {}): TwentyDollarPublicState {
  return {
    ruleset_version: "twenty_dollar_v3",
    model_version: "peak3_v1",
    phase: "auction",
    lot_index: 5,
    max_lots: 36,
    standard_market_lots: 24,
    market_phase: "standard",
    market_skips_per_seat: 5,
    round_index: 5,
    max_rounds: 36,
    seats: [],
    slots: ["PG", "SG", "SF", "PF", "C"],
    autofilled: false,
    opening_seat: 0,
    next_opening_seat: 1,
    active_seat: 0,
    high_bidder: null,
    current_bid: 0,
    minimum_bid: 1,
    lot_actions: [],
    candidate: null,
    qualified_pool_size: 500,
    history: [settledCurryLot()],
    seat_names: SEAT_NAMES,
    ...overrides,
  };
}

const CURRY_BID: AttemptedAction = {
  command: "bid",
  amount: 2,
  lotIndex: 4,
  standingBid: 1,
  wouldSpendSkip: false,
};

/** Every code the API can currently emit for this mode. */
const ALL_CODES = [
  "stale_state_version",
  "turn_already_resolved",
  "match_not_live",
  "match_expired",
  "duplicate_action",
  "not_your_seat",
  "unknown_command",
  "ruleset_version_mismatch",
  "not_bidding",
  "not_your_turn",
  "already_passed",
  "bid_too_low",
  "bid_over_max",
  "candidate_unfit",
  "no_market_skips",
  "roster_full",
  "match_over",
  "bid_not_integer",
  "rejected",
] as const;

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the reported Curry rejection", () => {
  it("names the lot, the winner and the price instead of a version number", () => {
    const result = explainRejection(
      "stale_state_version",
      "This match has moved on (you sent version 1, it is now 2). Reload.",
      CURRY_BID,
      state(),
      SEAT_NAMES,
      0,
    );
    expect(result.message).toContain("$2 bid");
    expect(result.message).toContain("lot 5");
    expect(result.message).toContain("Stephen Curry");
    expect(result.message).toContain("Floor General");
    expect(result.message).toContain("$1");
    expect(result.boardMovedOn).toBe(true);
    expect(result.tone).toBe("board");
    // And it does NOT leak the mechanism at the player.
    expect(result.message).not.toContain("version");
  });

  it("is never a shrug, for any code the server can emit", () => {
    for (const code of ALL_CODES) {
      const result = explainRejection(code, "server prose", CURRY_BID, state(), SEAT_NAMES, 0);
      expect(result.message).not.toBe("That move was not accepted.");
      expect(result.message.length).toBeGreaterThan(10);
      expect(result.tone).toBeTruthy();
    }
  });

  it("still says something actionable when the server sent no prose at all", () => {
    const result = explainRejection(null, null, CURRY_BID, state(), SEAT_NAMES, 0);
    expect(result.message).toMatch(/board below is up to date/i);
    expect(result.tone).toBe("retry");
  });
});

describe("a board that moved without the lot closing", () => {
  it("reports the new standing bid", () => {
    const result = explainRejection(
      "stale_state_version",
      "",
      { ...CURRY_BID, lotIndex: 5 },
      state({ current_bid: 4, high_bidder: 1 }),
      SEAT_NAMES,
      0,
    );
    expect(result.message).toContain("standing bid changed");
    expect(result.message).toContain("$4");
    expect(result.message).toMatch(/legal raise or pass/);
  });

  it("reports whose turn it now is when nothing else changed", () => {
    const result = explainRejection(
      "stale_state_version",
      "",
      { ...CURRY_BID, lotIndex: 5, standingBid: 0 },
      state({ active_seat: 1 }),
      SEAT_NAMES,
      0,
    );
    expect(result.message).toContain("Floor General");
  });
});

describe("rules refusals, which are the player's to fix", () => {
  it("explains a low bid with the actual minimum", () => {
    const result = explainRejection(
      "bid_too_low",
      "You must raise to at least $5.",
      { ...CURRY_BID, amount: 3, lotIndex: 5 },
      state({ current_bid: 4, minimum_bid: 5 }),
      SEAT_NAMES,
      0,
    );
    expect(result.message).toContain("$3");
    expect(result.message).toContain("$5");
    expect(result.boardMovedOn).toBe(false);
    expect(result.tone).toBe("rule");
  });

  it("keeps the server's own sentence for the reserve ceiling — the ONE allowlisted code", () => {
    // The server knows the persisted budget and the exact ceiling; this module
    // does not, so it must not paraphrase. It is an allowlist of one rather
    // than a general pass-through, which is the whole point of the change.
    const result = explainRejection(
      "bid_over_max",
      "Your maximum bid is $7: every slot you still have to fill must keep at least $1 behind it.",
      { ...CURRY_BID, amount: 12, lotIndex: 5 },
      state(),
      SEAT_NAMES,
      0,
    );
    expect(result.message).toContain("$7");
    expect(result.message).toContain("$1 behind it");
  });

  it("writes its own ceiling sentence when the server sent no prose", () => {
    const result = explainRejection(
      "bid_over_max",
      "",
      { ...CURRY_BID, amount: 12, lotIndex: 5 },
      state(),
      SEAT_NAMES,
      0,
    );
    expect(result.message).toContain("$12");
    expect(result.message).toContain("$1 behind it");
  });

  it("distinguishes 'out of skips' from every other refusal", () => {
    const result = explainRejection(
      "no_market_skips",
      "",
      { ...CURRY_BID, command: "pass", lotIndex: 5 },
      state({ minimum_bid: 1 }),
      SEAT_NAMES,
      0,
    );
    expect(result.message).toContain("no market skips left");
    expect(result.message).toContain("$1");
  });
});

// ---------------------------------------------------------------------------
// The codes that used to reach a player verbatim
// ---------------------------------------------------------------------------

describe("codes that were unmapped, or not in the union at all", () => {
  it.each([
    ["duplicate_action", /already processed/i],
    ["not_bidding", /already moved on/i],
    ["ruleset_version_mismatch", /reload the page/i],
    ["not_your_seat", /not seated in this match/i],
    ["unknown_command", /out of date/i],
  ] as const)("writes user-facing copy for %s", (code, pattern) => {
    const result = explainRejection(
      code,
      "twenty_dollar_v3 != twenty_dollar_v1 (snapshot ruleset_version)",
      { ...CURRY_BID, lotIndex: 5 },
      state(),
      SEAT_NAMES,
      0,
    );
    expect(result.message).toMatch(pattern);
    // THE ENGINEERING STRING NEVER SURVIVES.
    expect(result.message).not.toContain("twenty_dollar_v");
    expect(result.message).not.toContain("!=");
  });

  it("never passes an unrecognised code's prose through to a player", () => {
    const result = explainRejection(
      "some_future_code",
      "Traceback (most recent call last): KeyError('active_seat')",
      CURRY_BID,
      state(),
      SEAT_NAMES,
      0,
    );
    expect(result.message).not.toContain("Traceback");
    expect(result.message).not.toContain("KeyError");
    expect(result.message).toMatch(/board below is up to date/i);
    expect(result.tone).toBe("retry");
    // ...but it is logged, so the failure is still diagnosable.
    expect(console.warn).toHaveBeenCalled();
  });

  it("carries the code through for telemetry even when the copy is generic", () => {
    expect(
      explainRejection("some_future_code", "x", CURRY_BID, state(), SEAT_NAMES, 0).code,
    ).toBe("some_future_code");
  });
});

// ---------------------------------------------------------------------------
// HTTP-level failures
// ---------------------------------------------------------------------------

describe("transport failures, which never reached this module before", () => {
  it("never renders 'HTTP 500'", () => {
    // `twenty-dollar-api.ts::parseErrorDetail` produces exactly this string for
    // a body with no `detail.message`, and it was rendered into the banner.
    for (const attempted of ["load", "bid", "pass"] as const) {
      const result = explainTransportError(500, undefined, "HTTP 500", attempted);
      expect(result.message).not.toContain("HTTP");
      expect(result.message).not.toContain("500");
      expect(result.tone).toBe("retry");
    }
  });

  it.each([
    ["authentication_required", 401, /sign in again/i],
    ["not_a_participant", 403, /another pair of bidders/i],
    ["match_not_found", 404, /no longer available/i],
    ["rate_limited", 429, /try once more|refresh shortly/i],
  ] as const)("maps %s", (code, status, pattern) => {
    expect(explainTransportError(status, code, "raw", "bid").message).toMatch(pattern);
  });

  it("says the move was NOT SENT when a command fails, and does not when a poll does", () => {
    expect(explainTransportError(0, "network_unavailable", null, "bid").message).toMatch(
      /your bid was not sent/i,
    );
    expect(explainTransportError(0, "network_unavailable", null, "load").message).toMatch(
      /reconnecting/i,
    );
  });

  it("falls back on the STATUS when the code is unknown", () => {
    expect(explainTransportError(403, "brand_new_code", "x", "bid").message).toMatch(
      /not able to act/i,
    );
    expect(explainTransportError(409, "brand_new_code", "x", "bid").message).toMatch(
      /moved on/i,
    );
    expect(explainTransportError(404, undefined, null, "load").tone).toBe("reload");
  });
});

describe("the response shape this client reads", () => {
  it("reads the field the API actually sends", () => {
    // A COMPILE-TIME PIN. `apps/api/app/models/arena.py::SubmitCommandResponse`
    // declares `message`; if this client's interface ever renames it back to
    // `rejection_message`, this object stops type-checking.
    const response: Pick<SubmitCommandResult, "accepted" | "replayed" | "rejection_code" | "message"> = {
      accepted: false,
      replayed: false,
      rejection_code: "stale_state_version",
      message: "This match has moved on.",
    };
    expect(response.message).toBe("This match has moved on.");
    // And the old name is gone rather than merely unused.
    expect("rejection_message" in response).toBe(false);
  });
});
