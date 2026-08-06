/**
 * The $20 Showdown auction room.
 *
 * WHAT CHANGED, AND WHAT THE TESTS NOW PROTECT. v1 was a sealed-bid auction and
 * the tests here were mostly LEAK tests: recursive searches of the rendered
 * output for the opponent's hidden amount. v2 bids sequentially and every
 * amount is public the instant it is named, so there is no bid to leak — the
 * one secret left is the candidate's PEAK3 score, and the recursive-search
 * discipline moved onto that.
 *
 * The rest of this file protects the reported UI defects directly: precise
 * whole-dollar controls instead of a slider, a turn indicator that says whose
 * move it is, and a disabled bid button that always says WHY.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  bidBlockedLabel,
  formatDollars,
  standingBidLabel,
  waitingLabel,
  type ResolvedLot,
  type TwentyDollarPublicState,
  type TwentyDollarPrivateState,
} from "@/lib/twenty-dollar-api";
import {
  AuctionHistory,
  BudgetMeter,
  CandidateCard,
  LotReveal,
  LotTicker,
  RosterBoard,
} from "@/components/twenty-dollar/AuctionBoard";
import BidControls from "@/components/twenty-dollar/BidControls";
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
      <CandidateCard
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
      <CandidateCard
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
    // The eyebrow was hardcoded to "sold" and contradicted the verdict three
    // lines below it.
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

  it("says sold when a seat took it", () => {
    render(<LotReveal lot={SETTLED_LOT} seatNames={["You", "Rival"]} yourSeat={0} />);
    expect(screen.getByTestId("td-reveal-lot")).toHaveTextContent(/· sold/i);
    expect(screen.getByTestId("td-reveal-lot")).not.toHaveTextContent(/unsold/i);
  });

  /**
   * THE SCORE IS THE PAYOFF, so it must not be the thing you scroll for.
   * The component silhouette rendered inline and was most of the panel's
   * height; a review frame showed the revealed score cut off by the bottom of
   * the viewport. PART 19 asks for a "view breakdown" action after settlement
   * rather than a chart appended under the live controls, which is also what
   * keeps the number itself on screen.
   */
  it("keeps the chart behind a disclosure so the score is what you see first", () => {
    render(<LotReveal lot={SETTLED_LOT} seatNames={["You", "Rival"]} yourSeat={0} />);
    const toggle = screen.getByTestId("td-reveal-breakdown-toggle");
    expect(toggle).toBeInTheDocument();
    expect(toggle.closest("details")).not.toHaveAttribute("open");
    // The score outranks the chart in the DOM, which is what a screen reader
    // and a viewport agree on.
    expect(
      screen
        .getByTestId("td-reveal-score")
        .compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Everything an ascending auction must show
// ---------------------------------------------------------------------------

describe("the standing bid and the turn are on the block", () => {
  it("says whose move it is, and marks your own turn distinctly", () => {
    render(
      <CandidateCard
        publicState={publicState({ active_seat: 0 })}
        fits={["PG"]}
        seatNames={["You", "Rival"]}
        yourSeat={0}
      />,
    );
    const indicator = screen.getByTestId("td-turn-indicator");
    expect(indicator).toHaveAttribute("data-your-turn", "true");
    expect(indicator).toHaveTextContent(/your move/i);
    // THE COUNTDOWN IS NO LONGER ON THIS CARD. It lives in `ArenaTimer` beside
    // the controls so that a tick rerenders four characters rather than the
    // whole board; `arena-timer.test.tsx` covers it there.
    expect(screen.queryByTestId("td-turn-clock")).toBeNull();
  });

  it("names the opponent when the clock is theirs, and shows no countdown", () => {
    render(
      <CandidateCard
        publicState={publicState({ active_seat: 1 })}
        fits={["PG"]}
        seatNames={["You", "Rival"]}
        yourSeat={0}
      />,
    );
    const indicator = screen.getByTestId("td-turn-indicator");
    expect(indicator).toHaveAttribute("data-your-turn", "false");
    expect(indicator).toHaveTextContent("Rival");
  });

  it("shows the standing bid and who holds it", () => {
    render(
      <CandidateCard
        publicState={publicState({ current_bid: 6, high_bidder: 1, active_seat: 0 })}
        fits={["PG"]}
        seatNames={["You", "Rival"]}
        yourSeat={0}
      />,
    );
    expect(screen.getByTestId("td-standing-amount")).toHaveTextContent("$6");
    expect(screen.getByTestId("td-standing-holder")).toHaveTextContent("Rival");
  });

  it("shows no bid before anybody opens", () => {
    render(
      <CandidateCard
        publicState={publicState()}
        fits={["PG"]}
        seatNames={["You", "Rival"]}
        yourSeat={0}
      />,
    );
    expect(screen.getByTestId("td-standing-holder")).toHaveTextContent(/no bid yet/i);
  });

  it("tickers the walk-up so an alternating auction is legible", () => {
    render(
      <LotTicker
        actions={SETTLED_LOT.actions}
        seatNames={["You", "Rival"]}
        yourSeat={0}
      />,
    );
    const ticker = screen.getByTestId("td-lot-ticker");
    expect(ticker).toHaveTextContent("$3");
    expect(ticker).toHaveTextContent("$4");
    expect(ticker).toHaveTextContent("$5");
    expect(ticker).toHaveTextContent(/passed/i);
  });

  it("marks the opening bidder for the current lot", () => {
    render(
      <BudgetMeter
        seat={seat(1)}
        label="Rival"
        isYou={false}
        isActive={false}
        isOpener
      />,
    );
    expect(screen.getByTestId("td-opener-1")).toHaveTextContent(/opens/i);
  });
});

// ---------------------------------------------------------------------------
// Precise whole-dollar controls
// ---------------------------------------------------------------------------

describe("bid controls are a stepper, not a slider", () => {
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

  /**
   * ONE COMMAND IN FLIGHT, ONE CONTROL SAYING SO.
   *
   * `busy` is a single board-wide flag and both action buttons were reading
   * it, so pressing Bid put "Submitting…" on the PASS button too — a review
   * frame caught the screen claiming to be submitting a bid and a pass at the
   * same moment. Which control was pressed is now remembered locally; the
   * disabled state still comes from `busy`, because only one command may be
   * in flight either way.
   */
  it("names only the command that was actually pressed as submitting", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const props = {
      publicState: publicState(),
      privateState: privateState(),
      seatNames: ["You", "Rival"],
      onSubmit,
    };
    const { rerender } = render(<BidControls {...props} busy={false} />);

    await user.click(screen.getByTestId("td-submit-bid"));
    rerender(<BidControls {...props} busy={true} />);

    expect(screen.getByTestId("td-submit-bid")).toHaveTextContent(/Submitting \$\d+ bid/);
    expect(screen.getByTestId("td-pass")).not.toHaveTextContent(/Submitting/);
    expect(screen.getByTestId("td-pass")).toBeDisabled();
  });

  it("names the pass as submitting when the pass is what was pressed", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const props = {
      publicState: publicState(),
      privateState: privateState(),
      seatNames: ["You", "Rival"],
      onSubmit,
    };
    const { rerender } = render(<BidControls {...props} busy={false} />);

    await user.click(screen.getByTestId("td-pass"));
    rerender(<BidControls {...props} busy={true} />);

    expect(screen.getByTestId("td-pass")).toHaveTextContent("Submitting…");
    expect(screen.getByTestId("td-submit-bid")).not.toHaveTextContent(/Submitting/);
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
        // $20 budget, five slots open -> the ceiling is $16.
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

  it("cannot be stepped below the raise minimum on a live bid", async () => {
    const user = userEvent.setup();
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
    await user.click(screen.getByTestId("td-submit-bid"));
  });

  it("labels the primary action Open or Bid depending on the lot", () => {
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
    expect(screen.getByTestId("td-submit-bid")).toHaveTextContent("Bid $4");
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

  it("always offers a pass on your own turn", async () => {
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
    const button = screen.getByTestId("td-submit-bid");
    const blocked = screen.queryByTestId("td-bid-blocked");
    expect(button).toBeDisabled();
    expect(blocked).not.toBeNull();
    expect((blocked?.textContent ?? "").length).toBeGreaterThan(0);
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
// Board furniture
// ---------------------------------------------------------------------------

describe("budget meter", () => {
  it("reports the server's budget through a meter role", () => {
    render(
      <BudgetMeter
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
    expect(screen.getByTestId("td-budget-0")).toHaveTextContent("2 of 5 filled");
  });

  it("marks the seat on the clock", () => {
    render(
      <BudgetMeter seat={seat(1)} label="Rival" isYou={false} isActive isOpener={false} />,
    );
    expect(screen.getByTestId("td-budget-1")).toHaveAttribute("data-active", "true");
  });
});

describe("roster board", () => {
  const withRoster = seat(0, {
    filled_slots: 1,
    roster: [
      {
        player_slug: "brian-grant",
        player_name: "Brian Grant",
        anchor_season: "1996-97",
        price: 4,
        // The server's LIVE assignment, which a later purchase can move.
        slot: "C",
        prime_score: 44.5,
        autofilled: false,
      },
    ],
    assignment: { C: "brian-grant" },
    open_slots: ["PG", "SG", "SF", "PF"],
  });

  it("places each player at the slot the SERVER assigned", () => {
    render(<RosterBoard seat={withRoster} slots={publicState().slots} label="Your five" />);
    expect(screen.getByTestId("td-slot-0-C")).toHaveTextContent("Brian Grant");
    expect(screen.getByTestId("td-slot-0-PF")).toHaveTextContent("Open");
  });

  it("shows the season and the revealed score beside a bought player", () => {
    render(<RosterBoard seat={withRoster} slots={publicState().slots} label="Your five" />);
    expect(screen.getByTestId("td-slot-0-C")).toHaveTextContent("1996-97");
    expect(screen.getByTestId("td-slot-0-C")).toHaveTextContent("44.5");
    expect(screen.getByTestId("td-slot-0-C")).toHaveTextContent("$4");
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

describe("auction history", () => {
  it("shows the price and the revealed score for a settled lot", () => {
    render(
      <AuctionHistory
        history={[SETTLED_LOT]}
        seatNames={["You", "Rival"]}
        yourSeat={0}
      />,
    );
    const row = screen.getByTestId("td-history-0");
    expect(row).toHaveTextContent("Chris Paul");
    expect(row).toHaveTextContent("137.4");
    expect(row).toHaveTextContent("$5");
  });

  it("renders nothing before the first lot settles", () => {
    const { container } = render(
      <AuctionHistory history={[]} seatNames={["You", "Rival"]} yourSeat={0} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("reports an unsold lot honestly", () => {
    render(
      <AuctionHistory
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
    expect(
      waitingLabel(publicState({ active_seat: 1 }), 0, ["You", "Rival"]),
    ).toMatch(/Rival/);
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
});

// ---------------------------------------------------------------------------
// Receipt
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
    // ONE LEVEL in v2: unspent money has no scoring value, so it cannot be a
    // tie-break either. An exact tie is a draw.
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
    // The panel reported final totals computed by moving one card from the
    // winner's roster to the loser's, which leaves six cards on one side and
    // four on the other. The receipt fixture below still includes the legacy
    // key, and the component must ignore it rather than render it.
    expect(screen.queryByTestId("td-counterfactual")).toBeNull();
    expect(screen.getByTestId("td-receipt").textContent).not.toMatch(/one bid away/i);
  });

  it("shows the positional comparison per slot", () => {
    expect(screen.getByTestId("td-positional-PG")).toHaveTextContent("Darrell Armstrong");
  });
});

describe("share text", () => {
  it("carries totals and spend but never the roster", () => {
    const text = buildShowdownShareText(RECEIPT, 0);
    expect(text).toContain("The $20 Showdown");
    expect(text).toContain("152.8");
    expect(text).toContain("$20 spent");
    // Spoiler-safe: no player names.
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
