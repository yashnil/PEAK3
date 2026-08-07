/**
 * The $20 Showdown auction room.
 *
 * WHAT THESE TESTS PROTECT. v1 was a sealed-bid auction and this file was
 * mostly LEAK tests: recursive searches of the rendered output for the
 * opponent's hidden amount. v2 bids sequentially and every amount is public the
 * instant it is named, so the one secret left is the candidate's PEAK3 score,
 * and the recursive-search discipline moved onto that.
 *
 * The rest protects the reported UI defects directly, and each block names the
 * requirement it pins: the decision hierarchy (S20-04), the auction controls
 * (S20-05), skips as a first-class number (S20-06), the three named declines
 * (S20-07), the roster columns (S20-14) and the result screen (S20-15).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  bidBlockedLabel,
  formatDollars,
  lastActionLabel,
  passActionLabel,
  passKind,
  standingBidLabel,
  waitingLabel,
  TURN_SECONDS,
  type ResolvedLot,
  type TwentyDollarPublicState,
  type TwentyDollarPrivateState,
} from "@/lib/twenty-dollar-api";
import {
  AuctionLog,
  AuctionStage,
  LotReveal,
  RosterBoard,
  SeatCard,
  TurnBanner,
} from "@/components/twenty-dollar/AuctionBoard";
import BidControls from "@/components/twenty-dollar/BidControls";
import { SettledLotTray } from "@/components/twenty-dollar/LotLedger";
import ShowdownResult, {
  responseLine,
} from "@/components/twenty-dollar/ShowdownResult";
import MatchIntro from "@/components/twenty-dollar/MatchIntro";
import ShowdownClock from "@/components/twenty-dollar/ShowdownClock";
import { toLineupDNA } from "@/components/twenty-dollar/ComponentSilhouette";
import TwentyDollarReceipt, {
  buildShowdownShareText,
  type TwentyDollarReceiptData,
} from "@/components/twenty-dollar/TwentyDollarReceipt";

// ---------------------------------------------------------------------------
// Fixtures -- shaped exactly like the server's projection.
// ---------------------------------------------------------------------------

const HIDDEN_SCORE = 137.42; // distinctive, so a search for it is unambiguous

function seat(index: number, overrides = {}) {
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

function publicState(
  overrides: Partial<TwentyDollarPublicState> = {},
): TwentyDollarPublicState {
  return {
    ruleset_version: "twenty_dollar_v3",
    model_version: "peak3_v1",
    phase: "auction",
    lot_index: 0,
    max_lots: 36,
    standard_market_lots: 24,
    market_phase: "standard",
    market_skips_per_seat: 5,
    round_index: 0,
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
    candidate: {
      player_slug: "chris-paul",
      player_name: "Chris Paul",
      anchor_season: "2008-09",
      team: "NOH",
      positions: ["PG"],
    },
    qualified_pool_size: 500,
    history: [],
    seat_names: ["You", "Rival"],
    ...overrides,
  };
}

function privateState(
  overrides: Partial<TwentyDollarPrivateState> = {},
): TwentyDollarPrivateState {
  return {
    seat_index: 0,
    is_your_turn: true,
    max_bid: 16,
    minimum_bid: 1,
    reserve_floor: 4,
    your_lot_bid: 0,
    in_lot: true,
    candidate_fits: ["PG"],
    market_skips: 5,
    pass_consumes_skip: true,
    pass_kind: "market_skip",
    lot_already_rejected: false,
    can_pass: true,
    timeout_outcome: "skip_used" as const,
    can_acquire_candidate: true,
    bid_blocked_reason: null,
    ...overrides,
  };
}

const SETTLED_LOT: ResolvedLot = {
  lot_index: 0,
  round_index: 0,
  candidate: {
    player_slug: "chris-paul",
    player_name: "Chris Paul",
    anchor_season: "2008-09",
    team: "NOH",
    positions: ["PG"],
    row_id: "r1",
    rank: 12,
    prime_score: HIDDEN_SCORE,
    components: {},
    component_index: {
      statistical_impact: 80,
      traditional_production: 60,
      individual_recognition: 70,
      postseason_individual_value: 50,
      team_achievement: 40,
    },
    model_version: "peak3_v1",
  },
  candidate_tier: "1-100",
  opening_seat: 0,
  bids: [5, 4],
  timed_out: [false, false],
  winner_seat: 0,
  price: 5,
  decided_by: "pass_out",
  actions: [
    { seat_index: 0, action: "bid", amount: 3 },
    { seat_index: 1, action: "bid", amount: 4 },
    { seat_index: 0, action: "bid", amount: 5 },
    { seat_index: 1, action: "pass", amount: 0 },
  ],
  slot_options: ["PG"],
};

function html(): string {
  return document.body.innerHTML;
}

// ---------------------------------------------------------------------------
// The one remaining secret
// ---------------------------------------------------------------------------

describe("the candidate's score is hidden until the lot resolves", () => {
  it("renders no score, rank or component for a live candidate", () => {
    render(
      <AuctionStage
        publicState={publicState()}
        fits={["PG"]}
        seatNames={["You", "Rival"]}
        yourSeat={0}
      />,
    );
    expect(html()).not.toContain(String(HIDDEN_SCORE));
    expect(html()).not.toContain("137");
    expect(screen.getByTestId("td-candidate")).toHaveTextContent(/sealed until/i);
  });

  it("names the player, the season and the team, which IS what you bid on", () => {
    render(
      <AuctionStage
        publicState={publicState()}
        fits={["PG"]}
        seatNames={["You", "Rival"]}
        yourSeat={0}
      />,
    );
    expect(screen.getByTestId("td-candidate-name")).toHaveTextContent("Chris Paul");
    expect(screen.getByTestId("td-candidate-season")).toHaveTextContent("2008-09");
    expect(screen.getByTestId("td-candidate-season")).toHaveTextContent("NOH");
    expect(screen.getByTestId("td-position-PG")).toBeInTheDocument();
  });

  it("reveals the score and the career-best season once the lot resolves", () => {
    render(<LotReveal lot={SETTLED_LOT} seatNames={["You", "Rival"]} yourSeat={0} />);
    expect(screen.getByTestId("td-reveal-score")).toHaveTextContent("137.42");
    expect(screen.getByTestId("td-reveal-season")).toHaveTextContent("2008-09");
    expect(screen.getByTestId("td-reveal-verdict")).toHaveTextContent("$5");
    expect(screen.getByTestId("td-reveal-verdict")).toHaveTextContent("PG");
  });

  it("says unsold, not sold, when nobody bid", () => {
    render(
      <LotReveal
        lot={{ ...SETTLED_LOT, winner_seat: null, price: 0 }}
        seatNames={["You", "Rival"]}
        yourSeat={0}
      />,
    );
    expect(screen.getByTestId("td-reveal-lot")).toHaveTextContent(/unsold/i);
    expect(screen.getByTestId("td-reveal-verdict")).toHaveTextContent(/Nobody bid/i);
  });

  /**
   * A RUN OF SETTLED LOTS IS A SEQUENCE, NOT A GAP (S20-10). One accepted
   * command can settle several lots — `_advance_lot` resolves an unusable
   * candidate inside the call that created it — and the player must be told
   * more are coming rather than shown a "While you were away" banner while
   * they are sitting there.
   */
  it("says how many more lots are still settling behind this one", () => {
    render(
      <LotReveal lot={SETTLED_LOT} seatNames={["You", "Rival"]} yourSeat={0} queued={2} />,
    );
    expect(screen.getByTestId("td-reveal-queued")).toHaveTextContent("2 more lots");
  });

  it("keeps the chart behind a disclosure so the score is what you see first", () => {
    render(<LotReveal lot={SETTLED_LOT} seatNames={["You", "Rival"]} yourSeat={0} />);
    const toggle = screen.getByTestId("td-reveal-breakdown-toggle");
    expect(toggle.closest("details")).not.toHaveAttribute("open");
    expect(
      screen
        .getByTestId("td-reveal-score")
        .compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// S20-04 — the decision hierarchy
// ---------------------------------------------------------------------------

describe("the auction stage reads in the order a bidder decides", () => {
  it("puts the CURRENT BID above the leader, and the leader above the last action", () => {
    render(
      <AuctionStage
        publicState={publicState({
          current_bid: 6,
          high_bidder: 1,
          lot_actions: [
            { seat_index: 0, action: "bid", amount: 5 },
            { seat_index: 1, action: "bid", amount: 6 },
          ],
        })}
        fits={["PG"]}
        seatNames={["You", "Rival"]}
        yourSeat={0}
      />,
    );
    const amount = screen.getByTestId("td-standing-amount");
    const holder = screen.getByTestId("td-standing-holder");
    const last = screen.getByTestId("td-last-action");
    expect(amount).toHaveTextContent("$6");
    expect(holder).toHaveTextContent("Rival leads");
    expect(last).toHaveTextContent("Rival raised to $6 (+$1)");
    expect(amount.compareDocumentPosition(holder) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(holder.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows no bid before anybody opens", () => {
    render(
      <AuctionStage
        publicState={publicState()}
        fits={["PG"]}
        seatNames={["You", "Rival"]}
        yourSeat={0}
      />,
    );
    expect(screen.getByTestId("td-standing-holder")).toHaveTextContent(/no bid yet/i);
    expect(screen.queryByTestId("td-last-action")).toBeNull();
  });

  /**
   * THE ROW OF MICRO-CHIPS IS GONE. `You $1 · PEAK3 Bot $2 · You $3 …` carried
   * the whole bid history at 11px beside the control it competed with. The full
   * walk-up moved into an expandable log, closed by default.
   */
  it("keeps the full bid history behind a closed disclosure", () => {
    render(
      <AuctionLog
        actions={SETTLED_LOT.actions}
        seatNames={["You", "Rival"]}
        yourSeat={0}
      />,
    );
    const log = screen.getByTestId("td-auction-log");
    expect(log.tagName).toBe("DETAILS");
    expect(log).not.toHaveAttribute("open");
    const list = screen.getByTestId("td-lot-ticker");
    expect(list).toHaveTextContent("$3");
    expect(list).toHaveTextContent("$4");
    expect(list).toHaveTextContent("$5");
    expect(list).toHaveTextContent(/passed/i);
  });
});

// ---------------------------------------------------------------------------
// S20-03 — the active seat
// ---------------------------------------------------------------------------

describe("the active participant is unmistakable", () => {
  it("names the turn at the top of the room, with a seat attribute for the styling", () => {
    render(
      <TurnBanner activeSeat={0} yourSeat={0} seatNames={["You", "Rival"]} phase="decide" />,
    );
    const banner = screen.getByTestId("td-turn-indicator");
    expect(banner).toHaveAttribute("data-your-turn", "true");
    expect(banner).toHaveAttribute("data-seat", "a");
    expect(banner).toHaveTextContent(/your move/i);
  });

  it("names the opponent when the clock is theirs", () => {
    render(
      <TurnBanner activeSeat={1} yourSeat={0} seatNames={["You", "Rival"]} phase="decide" />,
    );
    const banner = screen.getByTestId("td-turn-indicator");
    expect(banner).toHaveAttribute("data-your-turn", "false");
    expect(banner).toHaveAttribute("data-seat", "b");
    expect(banner).toHaveTextContent("Rival is deciding");
  });

  it("says what a beat is, rather than claiming somebody is deciding during it", () => {
    const { rerender } = render(
      <TurnBanner activeSeat={0} yourSeat={0} seatNames={["You", "Rival"]} phase="reveal" />,
    );
    expect(screen.getByTestId("td-turn-indicator")).toHaveTextContent(/new lot/i);
    rerender(
      <TurnBanner activeSeat={0} yourSeat={0} seatNames={["You", "Rival"]} phase="pending" />,
    );
    expect(screen.getByTestId("td-turn-indicator")).toHaveTextContent(/sending/i);
  });

  it("marks the seat card on the clock, in text as well as in an attribute", () => {
    render(
      <SeatCard seat={seat(1)} label="Rival" isYou={false} isActive isOpener={false} />,
    );
    expect(screen.getByTestId("td-budget-1")).toHaveAttribute("data-active", "true");
    // Never colour alone.
    expect(screen.getByTestId("td-seat-live-1")).toHaveTextContent(/on the clock/i);
  });

  it("marks the opening bidder for the current lot", () => {
    render(
      <SeatCard seat={seat(1)} label="Rival" isYou={false} isActive={false} isOpener />,
    );
    expect(screen.getByTestId("td-opener-1")).toHaveTextContent(/opens/i);
  });
});

// ---------------------------------------------------------------------------
// S20-05 — the auction controls
// ---------------------------------------------------------------------------

describe("bid controls are a designed auction control, not a form", () => {
  it("renders no range input anywhere", () => {
    render(
      <BidControls
        publicState={publicState()}
        privateState={privateState()}
        seatNames={["You", "Rival"]}
        busy={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(document.querySelector('input[type="range"]')).toBeNull();
  });

  it("carries the amount that will be submitted on the primary CTA", () => {
    const { unmount } = render(
      <BidControls
        publicState={publicState()}
        privateState={privateState()}
        seatNames={["You", "Rival"]}
        busy={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByTestId("td-submit-bid")).toHaveTextContent("Open at $1");
    unmount();
    render(
      <BidControls
        publicState={publicState({ current_bid: 3, high_bidder: 1, minimum_bid: 4 })}
        privateState={privateState({ minimum_bid: 4 })}
        seatNames={["You", "Rival"]}
        busy={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByTestId("td-submit-bid")).toHaveTextContent("Raise to $4");
  });

  it("names only the command that was actually pressed as sending", async () => {
    const user = userEvent.setup();
    const props = {
      publicState: publicState(),
      privateState: privateState(),
      seatNames: ["You", "Rival"],
      onSubmit: vi.fn(),
    };
    const { rerender } = render(<BidControls {...props} busy={false} />);

    await user.click(screen.getByTestId("td-submit-bid"));
    rerender(<BidControls {...props} busy={true} />);

    expect(screen.getByTestId("td-submit-bid")).toHaveTextContent(/Sending \$\d+/);
    expect(screen.getByTestId("td-pass")).not.toHaveTextContent(/Sending/);
    expect(screen.getByTestId("td-pass")).toBeDisabled();
  });

  it("names the pass as sending when the pass is what was pressed", async () => {
    const user = userEvent.setup();
    const props = {
      publicState: publicState(),
      privateState: privateState(),
      seatNames: ["You", "Rival"],
      onSubmit: vi.fn(),
    };
    const { rerender } = render(<BidControls {...props} busy={false} />);
    await user.click(screen.getByTestId("td-pass"));
    rerender(<BidControls {...props} busy={true} />);
    expect(screen.getByTestId("td-pass")).toHaveTextContent("Sending…");
    expect(screen.getByTestId("td-submit-bid")).not.toHaveTextContent(/Sending/);
  });

  it("opens at the server's minimum and steps in whole dollars", async () => {
    const user = userEvent.setup();
    render(
      <BidControls
        publicState={publicState()}
        privateState={privateState()}
        seatNames={["You", "Rival"]}
        busy={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByTestId("td-bid-amount")).toHaveTextContent("$1");
    await user.click(screen.getByTestId("td-bid-plus"));
    expect(screen.getByTestId("td-bid-amount")).toHaveTextContent("$2");
    await user.click(screen.getByTestId("td-bid-plus-2"));
    expect(screen.getByTestId("td-bid-amount")).toHaveTextContent("$4");
    await user.click(screen.getByTestId("td-bid-minus"));
    expect(screen.getByTestId("td-bid-amount")).toHaveTextContent("$3");
  });

  it("Max means the legal ceiling, not the whole budget", async () => {
    const user = userEvent.setup();
    render(
      <BidControls
        publicState={publicState()}
        privateState={privateState({ max_bid: 16, reserve_floor: 4 })}
        seatNames={["You", "Rival"]}
        busy={false}
        onSubmit={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId("td-bid-max"));
    expect(screen.getByTestId("td-bid-amount")).toHaveTextContent("$16");
    expect(screen.getByTestId("td-bid-range")).toHaveTextContent("$1–$16");
  });

  it("cannot be stepped below the raise minimum on a live bid", () => {
    render(
      <BidControls
        publicState={publicState({ current_bid: 4, high_bidder: 1, minimum_bid: 5 })}
        privateState={privateState({ minimum_bid: 5 })}
        seatNames={["You", "Rival"]}
        busy={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByTestId("td-bid-amount")).toHaveTextContent("$5");
    expect(screen.getByTestId("td-bid-minus")).toBeDisabled();
  });

  it("submits the exact whole-dollar amount shown", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <BidControls
        publicState={publicState()}
        privateState={privateState()}
        seatNames={["You", "Rival"]}
        busy={false}
        onSubmit={onSubmit}
      />,
    );
    await user.click(screen.getByTestId("td-bid-plus-2"));
    await user.click(screen.getByTestId("td-submit-bid"));
    expect(onSubmit).toHaveBeenCalledWith("bid", 3);
  });

  it("always offers a decline on your own turn", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <BidControls
        publicState={publicState()}
        privateState={privateState({ bid_blocked_reason: "insufficient_reserve" })}
        seatNames={["You", "Rival"]}
        busy={false}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByTestId("td-submit-bid")).toBeDisabled();
    await user.click(screen.getByTestId("td-pass"));
    expect(onSubmit).toHaveBeenCalledWith("pass", 0);
  });

  /**
   * S20-08's CLIENT HALF, at the control. A phase that is not `decide` — the
   * intro, a lot reveal, an inter-turn handoff — must not offer an action that
   * has not opened yet.
   */
  it("closes the controls when the room's phase is not a decision", () => {
    render(
      <BidControls
        publicState={publicState()}
        privateState={privateState()}
        seatNames={["You", "Rival"]}
        busy={false}
        live={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByTestId("td-bid-controls")).toHaveAttribute("data-live", "false");
    expect(screen.getByTestId("td-submit-bid")).toBeDisabled();
    expect(screen.getByTestId("td-pass")).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// S20-06 / S20-07 — skips, named and counted
// ---------------------------------------------------------------------------

describe("the three declines are named, and the count is not a suffix", () => {
  it.each([
    ["market_skip", /market skip/i, "true"],
    ["follow_pass", /pass on this lot/i, "false"],
    ["auction_pass", /concede the lot/i, "false"],
  ] as const)("labels %s by what it does", (kind, pattern, costs) => {
    render(
      <BidControls
        publicState={publicState()}
        privateState={privateState({
          pass_kind: kind,
          pass_consumes_skip: kind === "market_skip",
        })}
        seatNames={["You", "Rival"]}
        busy={false}
        onSubmit={vi.fn()}
      />,
    );
    const pass = screen.getByTestId("td-pass");
    expect(pass).toHaveTextContent(pattern);
    expect(pass).toHaveAttribute("data-pass-kind", kind);
    expect(pass).toHaveAttribute("data-costs-skip", costs);
  });

  /** S20-06 is explicit: "Do not append '—free' to Pass." */
  it("never appends '— free' to a decline", () => {
    for (const kind of ["follow_pass", "auction_pass"] as const) {
      const { unmount } = render(
        <BidControls
          publicState={publicState()}
          privateState={privateState({ pass_kind: kind, pass_consumes_skip: false })}
          seatNames={["You", "Rival"]}
          busy={false}
          onSubmit={vi.fn()}
        />,
      );
      expect(screen.getByTestId("td-pass").textContent).not.toMatch(/free/i);
      unmount();
    }
  });

  it("explains the cost in a sentence rather than in punctuation", () => {
    render(
      <BidControls
        publicState={publicState()}
        privateState={privateState({ pass_kind: "follow_pass", pass_consumes_skip: false })}
        seatNames={["You", "Rival"]}
        busy={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByTestId("td-bid-hint")).toHaveTextContent(
      /already declined this lot, so this costs you no market skip/i,
    );
  });

  it("falls back to `pass_consumes_skip` when the projection predates `pass_kind`", () => {
    expect(passKind(privateState({ pass_kind: undefined }))).toBe("market_skip");
    expect(
      passKind(privateState({ pass_kind: undefined, pass_consumes_skip: false })),
    ).toBe("auction_pass");
    expect(passActionLabel(privateState({ pass_kind: "follow_pass" }))).toBe(
      "Pass on this lot",
    );
  });

  /** S20-06: a first-class number on the seat card, for BOTH seats. */
  it("shows budget, roster and skips as three stats of equal rank", () => {
    render(
      <SeatCard
        seat={seat(0, { budget: 12, filled_slots: 2, market_skips: 3 })}
        label="You"
        isYou
        isActive
        isOpener={false}
      />,
    );
    const card = screen.getByTestId("td-budget-0");
    expect(screen.getByTestId("td-seat-budget-0")).toHaveTextContent("$12");
    expect(card).toHaveTextContent("2");
    const skips = screen.getByTestId("td-skips-0");
    expect(skips).toHaveAttribute("data-remaining", "3");
    // The e2e suite reads this phrasing; it is also just what the number means.
    expect(skips).toHaveTextContent(/skips left/);
    expect(skips).toHaveTextContent("3");
  });

  it("reports the server's budget through a meter role", () => {
    render(
      <SeatCard
        seat={seat(0, { budget: 12, filled_slots: 2 })}
        label="You"
        isYou
        isActive
        isOpener={false}
      />,
    );
    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "12");
    expect(meter).toHaveAttribute("aria-valuemax", "20");
  });
});

describe("a disabled bid always says why", () => {
  it.each([
    ["not_your_turn", /rival's turn/i],
    ["insufficient_reserve", /must keep \$1 behind it/i],
    ["position_infeasible", /legal starting five/i],
    ["roster_full", /roster is complete/i],
    ["passed_out", /you passed/i],
    ["match_complete", /auction is over/i],
  ] as const)("explains %s", (reason, pattern) => {
    render(
      <BidControls
        publicState={publicState({ active_seat: 1 })}
        privateState={privateState({ bid_blocked_reason: reason, is_your_turn: false })}
        seatNames={["You", "Rival"]}
        busy={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByTestId("td-bid-blocked")).toHaveTextContent(pattern);
    expect(screen.getByTestId("td-submit-bid")).toBeDisabled();
  });

  it("never disables the bid without a reason beside it", () => {
    render(
      <BidControls
        publicState={publicState({ active_seat: 1 })}
        privateState={privateState({ bid_blocked_reason: "not_your_turn", is_your_turn: false })}
        seatNames={["You", "Rival"]}
        busy={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByTestId("td-submit-bid")).toBeDisabled();
    expect(screen.getByTestId("td-bid-blocked").textContent?.length).toBeGreaterThan(0);
  });

  it("maps every reason the server can send", () => {
    for (const reason of [
      "match_complete",
      "no_candidate",
      "roster_full",
      "passed_out",
      "not_your_turn",
      "insufficient_reserve",
      "position_infeasible",
    ] as const) {
      expect(bidBlockedLabel(reason, ["You", "Rival"], 1)).toBeTruthy();
    }
    expect(bidBlockedLabel(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// S20-08 — the clock surface
// ---------------------------------------------------------------------------

describe("the clock", () => {
  it("counts the SERVER's turn length, not a hardcoded 20", () => {
    // The room passed `totalSeconds={20}` while `TURN_SECONDS` is 25, so the
    // progress arc sat pinned at full for the first five seconds of every turn.
    expect(TURN_SECONDS).toBe(25);
  });

  const clockProps = {
    activeSeat: 0,
    yourSeat: 0,
    turnKey: "0:0:0",
    pendingCommand: null,
    pendingAmount: 0,
    onExpire: vi.fn(),
  };

  it("shows the submitted action instead of a countdown while a command is out", () => {
    render(
      <ShowdownClock
        {...clockProps}
        phase="pending"
        deadlineAt={null}
        pendingCommand="bid"
        pendingAmount={4}
      />,
    );
    expect(screen.getByTestId("td-clock")).toHaveAttribute("data-mode", "pending");
    expect(screen.getByTestId("td-pending")).toHaveTextContent("Sending your $4 bid…");
    expect(screen.queryByTestId("td-timer-value")).toBeNull();
  });

  it("renders the ordinary countdown once nothing is in flight", () => {
    render(
      <ShowdownClock {...clockProps} phase="decide" deadlineAt={performance.now() + 20_000} />,
    );
    expect(screen.getByTestId("td-clock")).toHaveAttribute("data-mode", "countdown");
    expect(screen.getByTestId("td-timer-value")).toBeInTheDocument();
    // It reports TIME. The turn is `TurnBanner`'s job and nobody else's.
    expect(screen.getByTestId("td-clock")).not.toHaveTextContent(/your turn/i);
  });

  /**
   * NO DEADLINE IS A NORMAL STATE, NOT AN ERROR. `arena.py` sends
   * `seconds_remaining` to exactly one seat, so it is null for the whole of the
   * opponent's turn and for every beat. Handing that null to `ArenaTimer`
   * produced its label-only idle state — a band with a word in it and nothing
   * else, which a reviewer photographed and reasonably read as a missing clock.
   */
  it("never renders an empty band when there is no deadline", () => {
    const { unmount } = render(
      <ShowdownClock {...clockProps} phase="reveal" deadlineAt={null} />,
    );
    expect(screen.getByTestId("td-clock")).toHaveAttribute("data-mode", "held");
    expect(screen.getByTestId("td-clock").textContent?.trim().length).toBeGreaterThan(30);
    unmount();

    render(
      <ShowdownClock
        {...clockProps}
        phase="settling"
        activeSeat={null}
        deadlineAt={null}
      />,
    );
    expect(screen.getByTestId("td-clock")).toHaveTextContent(/next clock/i);
    expect(screen.getByTestId("td-clock")).toHaveTextContent(/next lot opens/i);
  });

  it("counts up rather than inventing a deadline for the opponent", () => {
    render(
      <ShowdownClock {...clockProps} phase="decide" activeSeat={1} deadlineAt={null} />,
    );
    expect(screen.getByTestId("td-clock")).toHaveAttribute("data-mode", "elapsed");
    expect(screen.getByTestId("td-elapsed-value")).toHaveTextContent("0s");
    // TIME, not a second copy of the turn banner's sentence.
    expect(screen.getByTestId("td-clock")).toHaveTextContent(/time elapsed/i);
    expect(screen.getByTestId("td-clock")).not.toHaveTextContent(/is deciding/i);
  });
});

// ---------------------------------------------------------------------------
// S20-14 — roster columns
// ---------------------------------------------------------------------------

describe("roster board", () => {
  const withRoster = seat(0, {
    filled_slots: 1,
    roster: [
      {
        player_slug: "shai-gilgeous-alexander",
        player_name: "Shai Gilgeous-Alexander",
        anchor_season: "1996-97",
        price: 4,
        slot: "C",
        prime_score: 44.5,
        autofilled: false,
      },
    ],
    assignment: { C: "shai-gilgeous-alexander" },
    open_slots: ["PG", "SG", "SF", "PF"],
  });

  it("places each player at the slot the SERVER assigned", () => {
    render(<RosterBoard seat={withRoster} slots={publicState().slots} label="Your five" />);
    expect(screen.getByTestId("td-slot-0-C")).toHaveTextContent("Shai Gilgeous-Alexander");
    expect(screen.getByTestId("td-slot-0-PF")).toHaveTextContent("Open");
  });

  /**
   * S20-14: a row must carry the headshot, the name, the season, the price and
   * the position. The old row had a 2rem tag, a flexed name and a price in a
   * 15rem column, so an ordinary name wrapped onto three lines.
   */
  it("carries every field a roster row owes, including an avatar", () => {
    render(<RosterBoard seat={withRoster} slots={publicState().slots} label="Your five" />);
    const row = screen.getByTestId("td-slot-0-C");
    expect(row).toHaveAttribute("data-filled", "true");
    expect(row).toHaveTextContent("1996-97");
    expect(row).toHaveTextContent("44.5");
    expect(row).toHaveTextContent("$4");
    expect(row).toHaveTextContent("C");
    // The SHARED-03 primitive, not a second image component.
    expect(row.querySelector('[data-testid="player-avatar"]')).not.toBeNull();
  });

  it("marks an auto-filled slot rather than passing it off as won", () => {
    const auto = seat(0, {
      roster: [
        {
          player_slug: "x",
          player_name: "Filler",
          anchor_season: "1990-91",
          price: 1,
          slot: "PG",
          prime_score: 10,
          autofilled: true,
        },
      ],
    });
    render(<RosterBoard seat={auto} slots={publicState().slots} label="Your five" />);
    expect(screen.getByTestId("td-slot-0-PG")).toHaveTextContent("auto");
  });
});

/**
 * SHARED-03: real player photographs, through the one shared primitive.
 *
 * The server resolves `headshot_url` from the committed asset manifest
 * (`data/game/assets/player_assets.v3.json`) behind
 * `PEAK3_ENABLE_EXTERNAL_ASSET_URLS`. Two branches matter and both are pinned
 * here: the photograph when a URL arrives, and the designed medallion when one
 * does not — which is 75% of this mode's pool even with the gate open, and all
 * of it with the gate in its shipped position.
 */
describe("player imagery", () => {
  const RESOLVED = "https://a.espncdn.com/i/headshots/nba/players/full/2779.png";

  function avatarIn(el: HTMLElement): HTMLElement {
    const avatar = el.querySelector('[data-testid="player-avatar"]');
    expect(avatar).not.toBeNull();
    return avatar as HTMLElement;
  }

  it("draws the photograph on the auction stage when the server sent one", () => {
    render(
      <AuctionStage
        publicState={publicState({
          candidate: {
            player_slug: "chris-paul",
            player_name: "Chris Paul",
            anchor_season: "2008-09",
            team: "NOH",
            positions: ["PG"],
            headshot_url: RESOLVED,
          },
        })}
        fits={["PG"]}
        seatNames={["You", "Rival"]}
        yourSeat={0}
      />,
    );
    const avatar = avatarIn(screen.getByTestId("td-candidate"));
    expect(avatar.tagName).toBe("IMG");
    expect(avatar).toHaveAttribute("src", RESOLVED);
  });

  it("still shows no score on a stage that now shows a face", () => {
    // The photograph is identity. Adding it must not have added the thing the
    // whole mode is built around concealing.
    render(
      <AuctionStage
        publicState={publicState({
          candidate: {
            player_slug: "chris-paul",
            player_name: "Chris Paul",
            anchor_season: "2008-09",
            team: "NOH",
            positions: ["PG"],
            headshot_url: RESOLVED,
          },
        })}
        fits={["PG"]}
        seatNames={["You", "Rival"]}
        yourSeat={0}
      />,
    );
    expect(html()).not.toContain(String(HIDDEN_SCORE));
    expect(screen.getByTestId("td-candidate")).toHaveTextContent(/sealed until/i);
  });

  it("draws the medallion when the server sent null, which is the shipped default", () => {
    render(
      <AuctionStage
        publicState={publicState()}
        fits={["PG"]}
        seatNames={["You", "Rival"]}
        yourSeat={0}
      />,
    );
    const avatar = avatarIn(screen.getByTestId("td-candidate"));
    expect(avatar.tagName).toBe("DIV");
    expect(avatar).toHaveTextContent("CP");
  });

  it("draws the photograph on a roster row", () => {
    const withPhoto = seat(0, {
      filled_slots: 1,
      roster: [
        {
          player_slug: "chris-paul",
          player_name: "Chris Paul",
          anchor_season: "2008-09",
          price: 4,
          slot: "PG",
          prime_score: 44.5,
          autofilled: false,
          headshot_url: RESOLVED,
        },
      ],
      assignment: { PG: "chris-paul" },
    });
    render(<RosterBoard seat={withPhoto} slots={publicState().slots} label="Your five" />);
    const avatar = avatarIn(screen.getByTestId("td-slot-0-PG"));
    expect(avatar.tagName).toBe("IMG");
    expect(avatar).toHaveAttribute("src", RESOLVED);
  });

  it("draws the photograph on the result screen's team cards", () => {
    const state = publicState({
      phase: "complete",
      seats: [
        seat(0, {
          budget: 0,
          filled_slots: 5,
          roster: [
            {
              player_slug: "chris-paul",
              player_name: "Chris Paul",
              anchor_season: "2008-09",
              price: 4,
              slot: "PG",
              prime_score: 44.5,
              autofilled: false,
              headshot_url: RESOLVED,
            },
          ],
        }),
        seat(1, { budget: 0, filled_slots: 5 }),
      ],
    });
    render(
      <ShowdownResult
        receipt={RECEIPT}
        publicState={state}
        seatNames={["You", "Rival"]}
        yourSeat={0}
        onPlayAgain={vi.fn()}
        onCopy={vi.fn()}
        copied={false}
      />,
    );
    const avatar = avatarIn(screen.getByTestId("td-result-seat-0"));
    expect(avatar.tagName).toBe("IMG");
    expect(avatar).toHaveAttribute("src", RESOLVED);
  });

  it("reveals a settled lot's face without changing the reveal's geometry", () => {
    const lot: ResolvedLot = {
      ...SETTLED_LOT,
      candidate: { ...SETTLED_LOT.candidate, headshot_url: RESOLVED },
    };
    render(<LotReveal lot={lot} seatNames={["You", "Rival"]} yourSeat={0} />);
    const avatar = avatarIn(screen.getByTestId("td-lot-reveal"));
    expect(avatar.tagName).toBe("IMG");
    // The same 44px box the medallion occupies, so the reveal does not jump
    // between a resolved and an unresolved player.
    expect(avatar).toHaveStyle({ width: "44px", height: "44px" });
  });
});

describe("the settled tray", () => {
  it("shows the price and the revealed score for a settled lot", () => {
    render(
      <SettledLotTray history={[SETTLED_LOT]} seatNames={["You", "Rival"]} yourSeat={0} />,
    );
    const row = screen.getByTestId("td-history-0");
    expect(row).toHaveTextContent("Chris Paul");
    expect(row).toHaveTextContent("137.4");
    expect(row).toHaveTextContent("$5");
  });

  it("renders nothing before the first lot settles", () => {
    const { container } = render(
      <SettledLotTray history={[]} seatNames={["You", "Rival"]} yourSeat={0} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("reports an unsold lot honestly", () => {
    render(
      <SettledLotTray
        history={[{ ...SETTLED_LOT, winner_seat: null, price: 0, decided_by: "unsold" }]}
        seatNames={["You", "Rival"]}
        yourSeat={0}
      />,
    );
    expect(screen.getByTestId("td-history-0")).toHaveTextContent(/unsold/i);
  });
});

describe("the silhouette maps components onto the house radar", () => {
  it("maps all five components plus data completeness", () => {
    const dna = toLineupDNA({
      statistical_impact: 80,
      traditional_production: 60,
      individual_recognition: 70,
      postseason_individual_value: 50,
      team_achievement: 40,
    });
    expect(Object.keys(dna).length).toBeGreaterThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// S20-01 — the intro
// ---------------------------------------------------------------------------

describe("the pre-match intro", () => {
  it("names the opponent, the money, the slots and the skip rule", () => {
    render(
      <MatchIntro
        opponentName="PEAK3 Bot"
        startingBudget={20}
        slots={5}
        marketSkips={5}
        rated={false}
        onDismiss={vi.fn()}
      />,
    );
    const intro = screen.getByTestId("td-intro");
    expect(intro).toHaveTextContent("PEAK3 Bot");
    expect(intro).toHaveTextContent("$20");
    expect(intro).toHaveTextContent(/roster slots/i);
    expect(intro).toHaveTextContent(/market skips/i);
    expect(intro).toHaveAttribute("aria-modal", "true");
  });

  it("is dismissible by a real button and by Escape", async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(
      <MatchIntro
        opponentName="PEAK3 Bot"
        startingBudget={20}
        slots={5}
        marketSkips={5}
        rated
        onDismiss={onDismiss}
      />,
    );
    // Focus lands on the action, so a keyboard user is not hunting for it.
    expect(screen.getByTestId("td-intro-start")).toHaveFocus();
    await user.click(screen.getByTestId("td-intro-start"));
    expect(onDismiss).toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

describe("status labels", () => {
  it("prompts you to open when the lot has no bid", () => {
    expect(waitingLabel(publicState(), 0, ["You", "Rival"])).toMatch(/open or pass/i);
  });

  it("prompts you to raise once a bid stands", () => {
    expect(
      waitingLabel(publicState({ current_bid: 3, high_bidder: 1 }), 0, ["You", "Rival"]),
    ).toMatch(/raise or pass/i);
  });

  it("names the opponent when the clock is theirs", () => {
    expect(waitingLabel(publicState({ active_seat: 1 }), 0, ["You", "Rival"])).toMatch(
      /Rival/,
    );
  });

  it("reports completion", () => {
    expect(waitingLabel(publicState({ phase: "complete" }), 0)).toMatch(/complete/i);
  });

  it("reads the standing bid back with its holder", () => {
    expect(
      standingBidLabel(publicState({ current_bid: 7, high_bidder: 0 }), 0, ["You", "Rival"]),
    ).toBe("$7 — you");
    expect(standingBidLabel(publicState(), 0, ["You", "Rival"])).toBe("No bid yet");
  });

  it("describes the last action in words, not in a chip", () => {
    const names = ["You", "Rival"];
    expect(lastActionLabel(publicState(), 0, names)).toBeNull();
    expect(
      lastActionLabel(
        publicState({ lot_actions: [{ seat_index: 0, action: "bid", amount: 2 }] }),
        0,
        names,
      ),
    ).toBe("You opened at $2");
    expect(
      lastActionLabel(
        publicState({
          lot_actions: [{ seat_index: 1, action: "pass", amount: 0, consumed_skip: true }],
        }),
        0,
        names,
      ),
    ).toBe("Rival used a market skip");
    expect(
      lastActionLabel(
        publicState({
          lot_actions: [{ seat_index: 0, action: "pass", amount: 0, timed_out: true }],
        }),
        0,
        names,
      ),
    ).toBe("You ran out of time");
  });
});

// ---------------------------------------------------------------------------
// Receipt and result
// ---------------------------------------------------------------------------

const RECEIPT: TwentyDollarReceiptData = {
  model_version: "peak3_v1",
  starting_budget: 20,
  slots: ["PG", "SG", "SF", "PF", "C"],
  seats: [
    {
      seat_index: 0, roster_total: 152.79, spent: 20, budget_remaining: 0,
      peak3_per_dollar: 7.64, components: {}, roster: [],
    },
    {
      seat_index: 1, roster_total: 238.42, spent: 20, budget_remaining: 0,
      peak3_per_dollar: 11.92, components: {}, roster: [],
    },
  ],
  positional: [
    {
      slot: "PG",
      seats: [
        { player_name: "Scoot Henderson", prime_score: 22.71, price: 3 },
        { player_name: "Darrell Armstrong", prime_score: 56.14, price: 1 },
      ],
      margin: 33.43,
      winner_seat: 1,
    },
  ],
  best_bargain: { player_name: "Clint Capela", prime_score: 61.23, price: 1, seat_index: 1 },
  biggest_overpay: { player_name: "Michael Holton", prime_score: 22.65, price: 13, seat_index: 0 },
  most_decisive: { player_name: "Clint Capela", price: 1, winner_seat: 1, bids: [0, 1] },
  counterfactual: {
    player_name: "Darrell Armstrong", your_bid: 1, winning_bid: 2, needed_bid: 3,
    extra_dollars: 2, loser_seat: 0, new_totals: [208.93, 182.28],
    assumption: "Assumes every other auction resolved exactly as it did.",
  },
  autofilled: false,
  rounds_played: 16,
  component_disclosure: {
    shown: [
      "statistical_impact", "traditional_production", "individual_recognition",
      "postseason_individual_value", "team_achievement",
    ],
    absent: ["teammate_adjustment"],
    count: 5,
    house_count: 6,
    note: "This board publishes five of the six PEAK3 components…",
  },
  settlement: {
    winner_seat: 1,
    outcome: "decided",
    decided_by: "roster_total",
    levels: [
      {
        level: "roster_total", label: "Roster PEAK3 total", higher_wins: true,
        values: [152.79, 238.42], verdict: "seat_1",
      },
    ],
  },
};

describe("receipt", () => {
  beforeEach(() => {
    render(<TwentyDollarReceipt receipt={RECEIPT} seatNames={["You", "Rival"]} yourSeat={0} />);
  });

  it("settles on the roster total alone", () => {
    expect(screen.getByTestId("td-level-roster_total")).toBeInTheDocument();
    expect(screen.queryByTestId("td-level-budget_remaining")).toBeNull();
  });

  it("surfaces the five-of-six component disclosure visibly", () => {
    const disclosure = screen.getByTestId("td-component-disclosure");
    expect(disclosure).toHaveTextContent("5 of 6 components shown");
    expect(disclosure).toHaveTextContent(/teammate_adjustment|five of the six/i);
  });

  it("names the bargain, the overpay and the decisive lot", () => {
    expect(screen.getByTestId("td-bargain")).toHaveTextContent("Clint Capela");
    expect(screen.getByTestId("td-overpay")).toHaveTextContent("Michael Holton");
    expect(screen.getByTestId("td-decisive")).toHaveTextContent("Clint Capela");
  });

  it("renders no 'One bid away' panel, even when the payload carries one", () => {
    expect(screen.queryByTestId("td-counterfactual")).toBeNull();
    expect(screen.getByTestId("td-receipt").textContent).not.toMatch(/one bid away/i);
  });

  it("shows the positional comparison per slot", () => {
    expect(screen.getByTestId("td-positional-PG")).toHaveTextContent("Darrell Armstrong");
  });
});

describe("the result screen (S20-15)", () => {
  const RESULT_STATE = publicState({
    phase: "complete",
    seats: [
      seat(0, {
        budget: 0,
        filled_slots: 5,
        roster: [
          {
            player_slug: "michael-holton",
            player_name: "Michael Holton",
            anchor_season: "1983-84",
            price: 13,
            slot: "PG",
            prime_score: 22.65,
            autofilled: false,
          },
        ],
      }),
      seat(1, { budget: 0, filled_slots: 5 }),
    ],
  });

  function renderResult(yourSeat: number) {
    return render(
      <ShowdownResult
        receipt={RECEIPT}
        publicState={RESULT_STATE}
        seatNames={["You", "Rival"]}
        yourSeat={yourSeat}
        onPlayAgain={vi.fn()}
        onCopy={vi.fn()}
        copied={false}
      />,
    );
  }

  it("says WON or LOST in a word, never by colour alone", () => {
    const { unmount } = renderResult(1);
    expect(screen.getByTestId("td-result")).toHaveAttribute("data-outcome", "win");
    expect(screen.getByTestId("td-result-headline")).toHaveTextContent("WON");
    unmount();
    renderResult(0);
    expect(screen.getByTestId("td-result")).toHaveAttribute("data-outcome", "loss");
    expect(screen.getByTestId("td-result-headline")).toHaveTextContent("LOST");
  });

  it("states the margin and a response line rather than a grey explanation", () => {
    renderResult(0);
    expect(screen.getByTestId("td-result-margin")).toHaveTextContent("85.63");
    expect(screen.getByTestId("td-result-response").textContent?.length).toBeGreaterThan(20);
    // The old screen's "Decided on the sum of five career-best 1Y PEAK3
    // seasons." sentence is gone from the hero; the receipt still explains it.
    expect(screen.getByTestId("td-result").textContent).not.toMatch(
      /Decided on the sum of five/,
    );
  });

  /** DETERMINISTIC: the same match must read the same way on every render. */
  it("picks the same response line for the same match, every time", () => {
    const first = responseLine("loss", 85.63, 39121);
    expect(responseLine("loss", 85.63, 39121)).toBe(first);
    expect(responseLine("loss", 0.4, 39121)).not.toBe(first);
    expect(responseLine("draw", 0, 1)).toMatch(/level/i);
  });

  it("gives both teams a rich card: five rows, price, PEAK3 value and totals", () => {
    renderResult(0);
    expect(screen.getByTestId("td-result-total-0")).toHaveTextContent("152.79");
    expect(screen.getByTestId("td-result-total-1")).toHaveTextContent("238.42");
    expect(screen.getByTestId("td-result-money-0")).toHaveTextContent(/spent/);
    const card = screen.getByTestId("td-result-seat-0");
    expect(card.querySelectorAll(".td-result-slot")).toHaveLength(5);
    expect(card).toHaveTextContent("Michael Holton");
    expect(card).toHaveTextContent("$13");
    // 22.65 renders as 22.6: the float is a hair below the midpoint, and the
    // number shown is `toFixed(1)` of the SERVER's value with no rounding of
    // our own applied on top of it.
    expect(card).toHaveTextContent("22.6");
    expect(card.querySelector('[data-testid="player-avatar"]')).not.toBeNull();
  });

  it("promotes the three callouts to cards with a headline number", () => {
    renderResult(0);
    expect(screen.getByTestId("td-callout-bargain")).toHaveTextContent("Steal of the night");
    expect(screen.getByTestId("td-callout-bargain")).toHaveTextContent("61.2");
    expect(screen.getByTestId("td-callout-overpay")).toHaveTextContent("$13");
    expect(screen.getByTestId("td-callout-decisive")).toHaveTextContent("Clint Capela");
  });

  it("keeps the receipt behind a secondary disclosure and the actions as buttons", () => {
    render(
      <ShowdownResult
        receipt={RECEIPT}
        publicState={RESULT_STATE}
        seatNames={["You", "Rival"]}
        yourSeat={0}
        onPlayAgain={vi.fn()}
        onCopy={vi.fn()}
        copied={false}
      >
        <p>receipt body</p>
      </ShowdownResult>,
    );
    const detail = screen.getByTestId("td-result-detail-toggle").closest("details");
    expect(detail).not.toHaveAttribute("open");
    expect(screen.getByTestId("td-play-again").tagName).toBe("BUTTON");
    expect(screen.getByTestId("td-back-to-arena")).toHaveAttribute("href", "/arena");
  });

  it("calls back when the actions are pressed", async () => {
    const onPlayAgain = vi.fn();
    const onCopy = vi.fn();
    const user = userEvent.setup();
    render(
      <ShowdownResult
        receipt={RECEIPT}
        publicState={RESULT_STATE}
        seatNames={["You", "Rival"]}
        yourSeat={0}
        onPlayAgain={onPlayAgain}
        onCopy={onCopy}
        copied={false}
      />,
    );
    await user.click(screen.getByTestId("td-play-again"));
    await user.click(screen.getByTestId("td-share"));
    expect(onPlayAgain).toHaveBeenCalled();
    expect(onCopy).toHaveBeenCalled();
  });
});

describe("share text", () => {
  it("carries totals and spend but never the roster", () => {
    const text = buildShowdownShareText(RECEIPT, 0);
    expect(text).toContain("The $20 Showdown");
    expect(text).toContain("152.8");
    expect(text).toContain("$20 spent");
    expect(text).not.toContain("Clint Capela");
    expect(text).not.toContain("Darrell Armstrong");
  });

  it("reports a loss from the losing seat's point of view", () => {
    expect(buildShowdownShareText(RECEIPT, 0)).toContain("Lost");
    expect(buildShowdownShareText(RECEIPT, 1)).toContain("Won");
  });
});

describe("formatting", () => {
  it("renders whole dollars and never a negative", () => {
    expect(formatDollars(9)).toBe("$9");
    expect(formatDollars(0)).toBe("$0");
    expect(formatDollars(-4)).toBe("$0");
  });
});

// ---------------------------------------------------------------------------
// The stylesheet's own contract
// ---------------------------------------------------------------------------

/**
 * THREE CSS DEFECTS, PINNED. Each one was invisible in dark mode and in a
 * component test, which is why they survived: a stylesheet is the one artefact
 * in this app that nothing else asserts against.
 */
describe("twenty-dollar.css", () => {
  const css = readFileSync(
    path.resolve(__dirname, "../../styles/twenty-dollar.css"),
    "utf8",
  );
  /** The file with every `@media { … }` block removed, so base rules can be
   *  compared without a responsive override counting as a redefinition. */
  const base = css.replace(/@media[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");

  it("never uses the accent FILL token as a text colour", () => {
    // `--peak-accent` measures 1.29–1.50:1 as text on the light canvas. Nine
    // rules used it that way, including `.td-btn-primary` — the label of the
    // mode's single most important control. Text uses `--peak-accent-text`,
    // which is re-derived per theme.
    const offenders = [...css.matchAll(/(^|[\s;{])color:\s*var\(--peak-accent[,)]/gm)];
    expect(offenders.map((m) => m[0])).toEqual([]);
  });

  it("gives the primary control a real fill", () => {
    // It was `background: transparent` with an accent border, so the primary
    // action was visually weaker than the secondary links on the result screen.
    const rule = /\.td-btn-primary\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule?.[1]).toMatch(/background:\s*var\(--peak-accent\)/);
    expect(rule?.[1]).toMatch(/color:\s*var\(--peak-accent-on\)/);
  });

  it("defines each base selector exactly once", () => {
    // `.td-reveal` and `.td-candidate` were each defined twice — a v1 block and
    // a v2 block 600 lines apart — and the later one silently won, so editing
    // the first had no effect at all.
    const selectors = [...base.matchAll(/(^|\})\s*([^{}@/]+?)\s*\{/g)]
      .map((m) => m[2].replace(/\s+/g, " ").trim())
      .filter((s) => s.startsWith("."));
    const seen = new Map<string, number>();
    for (const selector of selectors) {
      seen.set(selector, (seen.get(selector) ?? 0) + 1);
    }
    expect([...seen.entries()].filter(([, count]) => count > 1)).toEqual([]);
  });

  it("has consolidated its tabular numerals onto the shared class", () => {
    // Twenty hand-rolled `font-variant-numeric` declarations had accumulated
    // here. `.pk-numeral` in globals.css is the one definition; the markup
    // carries the class.
    const declarations = css.match(/font-variant-numeric/g) ?? [];
    expect(declarations.length).toBeLessThanOrEqual(4);
  });
});
