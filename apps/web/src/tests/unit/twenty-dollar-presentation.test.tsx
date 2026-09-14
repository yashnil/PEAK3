/**
 * $20 Showdown presentation pass: the bench facts and the result's outcome.
 *
 *   * a bench says what its seat has done on THIS lot, from published fields;
 *   * tension flags come only from published state (open spots, skips, and --
 *     for your own seat -- the bid ceiling and the reserve lock);
 *   * a conceded match is never presented as a draw: the conceding seat loses,
 *     which is the server's rule (`_forfeit`), and no PEAK3 margin is claimed.
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { benchFlagsOf, lotStatusOf } from "@/components/v2/showdown/PeakV2ShowdownLive";
import PeakV2ShowdownResult from "@/components/v2/showdown/PeakV2ShowdownResult";
import type { TwentyDollarReceiptData } from "@/components/twenty-dollar/TwentyDollarReceipt";
import type { SeatPublic, TwentyDollarPrivateState, TwentyDollarPublicState } from "@/lib/twenty-dollar-api";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

function seat(index: number, overrides: Partial<SeatPublic> = {}): SeatPublic {
  return {
    seat_index: index,
    budget: 20,
    filled_slots: 0,
    roster_full: false,
    in_lot: true,
    lot_bid: 0,
    roster: [],
    assignment: {},
    open_slots: ["PG", "SG", "SF", "PF", "C"],
    market_skips: 5,
    ...overrides,
  };
}

function publicState(overrides: Partial<TwentyDollarPublicState> = {}): TwentyDollarPublicState {
  return {
    ruleset_version: "twenty_dollar_v3",
    model_version: "peak3_v1",
    phase: "auction",
    lot_index: 3,
    max_lots: 36,
    standard_market_lots: 24,
    market_phase: "standard",
    market_skips_per_seat: 5,
    round_index: 3,
    max_rounds: 36,
    seats: [seat(0), seat(1)],
    slots: ["PG", "SG", "SF", "PF", "C"],
    autofilled: false,
    opening_seat: 0,
    next_opening_seat: 1,
    active_seat: 0,
    high_bidder: null,
    current_bid: 0,
    minimum_bid: 1,
    lot_actions: [],
    candidate: { player_slug: "p", player_name: "P", anchor_season: "2000-01", team: null, positions: ["SF"] },
    qualified_pool_size: 500,
    history: [],
    lot_kind: "standard",
    ...overrides,
  } as TwentyDollarPublicState;
}

function privateState(overrides: Partial<TwentyDollarPrivateState> = {}): TwentyDollarPrivateState {
  return {
    seat_index: 0,
    is_your_turn: true,
    max_bid: 16,
    minimum_bid: 1,
    reserve_floor: 4,
    your_lot_bid: 0,
    in_lot: true,
    candidate_fits: ["SF"],
    can_acquire_candidate: true,
    bid_blocked_reason: null,
    market_skips: 5,
    pass_consumes_skip: true,
    can_pass: true,
    timeout_outcome: "skip_used",
    ...overrides,
  };
}

const live = { idle: false, isActive: true, idleLabel: "Between lots" };

describe("a bench says what its seat did on this lot", () => {
  it("names the leader and the standing figure", () => {
    const state = publicState({ high_bidder: 1, current_bid: 4 });
    expect(lotStatusOf(seat(1, { lot_bid: 4 }), state, live)).toEqual({ kind: "leading", label: "Leads at $4" });
  });

  it("marks an outbid seat with its own highest figure", () => {
    const state = publicState({ high_bidder: 1, current_bid: 4 });
    expect(lotStatusOf(seat(0, { lot_bid: 3 }), state, live)).toEqual({ kind: "bid", label: "Outbid at $3" });
  });

  it("distinguishes a skip that cost a token, an expired clock and a free pass", () => {
    const skipped = publicState({ lot_actions: [{ seat_index: 0, action: "pass", amount: 0, consumed_skip: true }] });
    expect(lotStatusOf(seat(0, { in_lot: false }), skipped, live).label).toBe("Skipped · 1 skip spent");
    const expired = publicState({ lot_actions: [{ seat_index: 0, action: "pass", amount: 0, timed_out: true }] });
    expect(lotStatusOf(seat(0, { in_lot: false }), expired, live).label).toBe("Out · clock expired");
    const passed = publicState({ lot_actions: [{ seat_index: 0, action: "pass", amount: 0 }] });
    expect(lotStatusOf(seat(0, { in_lot: false }), passed, live)).toEqual({ kind: "out", label: "Passed" });
  });

  it("says nothing about a lot during a seatless beat", () => {
    expect(lotStatusOf(seat(0), publicState(), { ...live, idle: true })).toEqual({ kind: "idle", label: "Between lots" });
  });
});

describe("tension flags come only from published state", () => {
  it("flags the final open spot and an empty skip allowance for either bench", () => {
    const flags = benchFlagsOf(seat(1, { filled_slots: 4, market_skips: 0 }), 5, publicState(), null);
    expect(flags).toEqual(["Final open spot", "No skips left"]);
  });

  it("reads your own ceiling and reserve lock from the private state", () => {
    expect(benchFlagsOf(seat(0, { budget: 6, filled_slots: 1 }), 5, publicState(), privateState({ max_bid: 3 }))).toEqual(["Only $3 biddable"]);
    expect(
      benchFlagsOf(seat(0, { budget: 4, filled_slots: 1 }), 5, publicState(), privateState({ max_bid: 0, bid_blocked_reason: "insufficient_reserve" })),
    ).toEqual(["Reserve lock"]);
  });

  it("raises nothing for a comfortable seat or a complete roster", () => {
    expect(benchFlagsOf(seat(0), 5, publicState(), privateState())).toEqual([]);
    expect(benchFlagsOf(seat(0, { filled_slots: 5, roster_full: true, market_skips: 0 }), 5, publicState(), null)).toEqual([]);
  });
});

function receipt(overrides: Partial<TwentyDollarReceiptData> = {}): TwentyDollarReceiptData {
  return {
    model_version: "peak3_v1",
    starting_budget: 20,
    slots: ["PG", "SG", "SF", "PF", "C"],
    seats: [
      { seat_index: 0, roster_total: 0, spent: 0, budget_remaining: 20, peak3_per_dollar: 0, components: {}, roster: [] },
      { seat_index: 1, roster_total: 0, spent: 0, budget_remaining: 20, peak3_per_dollar: 0, components: {}, roster: [] },
    ],
    positional: [],
    best_bargain: null,
    biggest_overpay: null,
    most_decisive: null,
    counterfactual: null,
    autofilled: false,
    rounds_played: 0,
    component_disclosure: { shown: [], absent: [], count: 5, house_count: 6, note: "" },
    settlement: { winner_seat: null, outcome: "draw", decided_by: null, levels: [] },
    ...overrides,
  };
}

function renderResult(r: TwentyDollarReceiptData, forfeitedBy: number | null, yourSeat = 0) {
  const state = { ...publicState({ phase: "complete", active_seat: null }), forfeited_by: forfeitedBy } as TwentyDollarPublicState;
  render(
    <PeakV2ShowdownResult receipt={r} publicState={state} seatNames={["You", "Anchor"]} yourSeat={yourSeat} onPlayAgain={() => {}} onCopy={() => {}} copied={false} />,
  );
}

describe("a conceded match is never a draw", () => {
  it("reads LOST, by concession, when you concede on level totals", () => {
    renderResult(receipt(), 0);
    expect(screen.getByTestId("td-result-headline")).toHaveTextContent("LOST");
    expect(screen.getByTestId("td-result-headline")).not.toHaveTextContent("DREW");
    expect(screen.getByTestId("td-result-margin")).toHaveTextContent("by concession");
    expect(screen.getByTestId("td-result")).toHaveAttribute("data-outcome", "loss");
    expect(screen.getByTestId("td-callout-forfeit")).toHaveTextContent("You conceded");
  });

  it("reads WON when the opponent concedes, whatever the totals were", () => {
    const r = receipt({
      seats: [
        { seat_index: 0, roster_total: 50, spent: 3, budget_remaining: 17, peak3_per_dollar: 1, components: {}, roster: [] },
        { seat_index: 1, roster_total: 120, spent: 9, budget_remaining: 11, peak3_per_dollar: 1, components: {}, roster: [] },
      ],
      settlement: { winner_seat: 1, outcome: "decided", decided_by: "roster_total", levels: [] },
    });
    renderResult(r, 1);
    expect(screen.getByTestId("td-result-headline")).toHaveTextContent("WON");
    expect(screen.getByTestId("td-result")).toHaveAttribute("data-outcome", "win");
  });

  it("still reads DREW for a genuine level finish, and says money left over scores nothing", () => {
    renderResult(receipt({ rounds_played: 20 }), null);
    expect(screen.getByTestId("td-result-headline")).toHaveTextContent("DREW");
    expect(screen.getByTestId("td-result")).toHaveTextContent("Money left over scores nothing");
  });
});
