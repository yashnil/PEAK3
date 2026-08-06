/**
 * The rejection contract: every refusal names what actually happened.
 *
 * THE DEFECT UNDER TEST. The API's `SubmitCommandResponse` carries its prose in
 * `message`; the Showdown client declared the field as `rejection_message` and
 * rendered `result.rejection_message || "That move was not accepted."`. The
 * read was always `undefined`, so 100% of rejections showed the generic string
 * — including the reported `$2` Curry bid, where the server had said "This
 * match has moved on (you sent version 1, it is now 2). Reload."
 *
 * Two things are asserted here that a snapshot test would not catch:
 *
 *   * THE FIELD NAME. `readsTheFieldTheApiActuallySends` pins the client
 *     interface to the API model. A field that does not exist is not a type
 *     error when it is declared optional, which is why this went unnoticed.
 *   * THE CONTENT. A rejection must say which lot closed, who took the player
 *     and for how much — the information the player needs to trust the board —
 *     rather than a version number they cannot act on.
 */
import { describe, expect, it } from "vitest";

import { explainRejection, type AttemptedAction } from "@/lib/arena-rejection";
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
    // And it does NOT leak the mechanism at the player.
    expect(result.message).not.toContain("version");
  });

  it("is never the generic string, for any code the server can emit", () => {
    const codes = [
      "stale_state_version",
      "turn_already_resolved",
      "not_your_turn",
      "already_passed",
      "bid_too_low",
      "bid_over_max",
      "candidate_unfit",
      "no_market_skips",
      "roster_full",
      "match_over",
      "match_not_live",
      "match_expired",
      "bid_not_integer",
    ];
    for (const code of codes) {
      const result = explainRejection(code, "server prose", CURRY_BID, state(), SEAT_NAMES, 0);
      expect(result.message).not.toBe("That move was not accepted.");
      expect(result.message.length).toBeGreaterThan(10);
    }
  });

  it("falls back to the server's own sentence rather than to a shrug", () => {
    const result = explainRejection(
      "some_future_code",
      "Your maximum bid is $7.",
      CURRY_BID,
      state(),
      SEAT_NAMES,
      0,
    );
    expect(result.message).toBe("Your maximum bid is $7.");
  });

  it("still says something actionable when the server sent no prose at all", () => {
    const result = explainRejection(null, null, CURRY_BID, state(), SEAT_NAMES, 0);
    expect(result.message).toContain("board below is current");
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
  });

  it("keeps the server's own sentence for the reserve ceiling", () => {
    // The server knows the persisted budget and the exact ceiling; this module
    // does not, so it must not paraphrase.
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
