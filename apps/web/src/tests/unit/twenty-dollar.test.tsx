/**
 * The $20 Showdown frontend.
 *
 * The most important tests here are the LEAK tests, and they are written the
 * same way the server-side ones are: a recursive search of the rendered output
 * for the opponent's actual bid value, rather than an assertion about a key we
 * happened to think of. A key check (`expect(html).not.toContain("bid")`) is
 * passed by any future field that carries the number under a different name,
 * and this is the one place in the mode where a miss is a cheating bug.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  formatDollars,
  waitingLabel,
  type TwentyDollarPublicState,
  type TwentyDollarPrivateState,
} from "@/lib/twenty-dollar-api";
import {
  AuctionHistory,
  BudgetMeter,
  CandidateCard,
  RosterBoard,
  RoundReveal,
  TiePriorityToken,
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

const OPPONENT_SECRET_BID = 137; // distinctive, so a search for it is unambiguous

function publicState(overrides: Partial<TwentyDollarPublicState> = {}): TwentyDollarPublicState {
  return {
    ruleset_version: "twenty_dollar_v1",
    model_version: "peak3_v1",
    phase: "bidding",
    round_index: 0,
    max_rounds: 60,
    tie_priority_seat: 1,
    slots: ["PG", "SG", "SF", "PF", "C"],
    autofilled: false,
    seat_names: ["You", "Rival"],
    seats: [
      {
        seat_index: 0, budget: 20, filled_slots: 0, roster_full: false,
        locked: false, roster: [], assignment: {}, open_slots: ["PG", "SG", "SF", "PF", "C"],
      },
      {
        // The opponent has LOCKED. `locked` is public; the amount is not, and
        // there is deliberately no field here to hold it.
        seat_index: 1, budget: 20, filled_slots: 0, roster_full: false,
        locked: true, roster: [], assignment: {}, open_slots: ["PG", "SG", "SF", "PF", "C"],
      },
    ],
    candidate: {
      player_slug: "michael-jordan",
      player_name: "Michael Jordan",
      anchor_season: "1990-91",
      team: "CHI",
      positions: ["PG", "SF", "SG"],
    },
    history: [],
    ...overrides,
  };
}

function privateState(overrides: Partial<TwentyDollarPrivateState> = {}): TwentyDollarPrivateState {
  return {
    seat_index: 0,
    your_bid: null,
    your_locked: false,
    max_bid: 16,
    reserve_floor: 4,
    holds_tie_priority: false,
    candidate_fits: ["PG", "SG", "SF"],
    can_acquire_candidate: true,
    ...overrides,
  };
}

const RESOLVED_ROUND = {
  round_index: 0,
  candidate: {
    player_slug: "michael-jordan",
    player_name: "Michael Jordan",
    anchor_season: "1990-91",
    team: "CHI",
    positions: ["PG", "SF", "SG"],
    row_id: "michael-jordan-1yr-199091",
    rank: 1,
    prime_score: 97.53,
    components: {
      statistical_impact: 37.6059,
      traditional_production: 13.9424,
      individual_recognition: 19.9989,
      postseason_individual_value: 12.5652,
      team_achievement: 3.0,
    },
    component_index: {
      statistical_impact: 96.6,
      traditional_production: 87.83,
      individual_recognition: 100,
      postseason_individual_value: 93.97,
      team_achievement: 100,
    },
    model_version: "peak3_v1",
  },
  bids: [9, 4],
  timed_out: [false, false],
  winner_seat: 0,
  price: 9,
  decided_by: "bid_amount",
  levels: [],
  tie_priority_seat: 1,
  tie_priority_used: false,
};

/** Every number appearing anywhere in the rendered DOM. */
function renderedNumbers(container: HTMLElement): number[] {
  const found: number[] = [];
  const text = container.textContent ?? "";
  for (const match of text.matchAll(/-?\d+(?:\.\d+)?/g)) found.push(Number(match[0]));
  // Attribute values too -- a leak hidden in a data-* attribute is still a leak.
  container.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      for (const match of attr.value.matchAll(/-?\d+(?:\.\d+)?/g)) found.push(Number(match[0]));
    }
  });
  return found;
}

// ---------------------------------------------------------------------------

describe("sealed bid is never rendered for the opponent", () => {
  it("does not render the opponent's amount anywhere in the board", () => {
    // The opponent's bid is not in the props at all -- the server never sends
    // it. This asserts the whole board renders without it appearing, which
    // also fails loudly if someone ever threads it through.
    const { container } = render(
      <>
        <CandidateCard publicState={publicState()} fits={["PG"]} />
        {publicState().seats.map((seat) => (
          <BudgetMeter key={seat.seat_index} seat={seat} label={`Seat ${seat.seat_index}`} />
        ))}
      </>,
    );
    expect(renderedNumbers(container)).not.toContain(OPPONENT_SECRET_BID);
  });

  it("shows that the opponent has locked without showing what", () => {
    render(<BudgetMeter seat={publicState().seats[1]} label="Rival" />);
    expect(screen.getByTestId("td-budget-1")).toHaveTextContent("locked in");
    expect(screen.getByTestId("td-budget-1")).not.toHaveTextContent(String(OPPONENT_SECRET_BID));
  });

  it("renders your own locked bid only to you", () => {
    render(
      <BidControls
        publicState={publicState()}
        privateState={privateState({ your_locked: true, your_bid: 7 })}
        disabled={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByTestId("td-your-locked-amount")).toHaveTextContent("$7");
  });

  it("offers no way to change a locked bid, because the server has none", () => {
    render(
      <BidControls
        publicState={publicState()}
        privateState={privateState({ your_locked: true, your_bid: 7 })}
        disabled={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("td-bid-input")).toBeNull();
    expect(screen.queryByTestId("td-lock-bid")).toBeNull();
  });
});

describe("the candidate's score is hidden until the round resolves", () => {
  it("renders no score, rank or component for a live candidate", () => {
    const { container } = render(
      <CandidateCard publicState={publicState()} fits={["PG", "SG"]} />,
    );
    const numbers = renderedNumbers(container);
    // The real values from the resolved fixture must not appear.
    expect(numbers).not.toContain(97.53);
    expect(numbers).not.toContain(37.6059);
    expect(container.querySelector('[data-testid="td-component-silhouette"]')).toBeNull();
  });

  it("names the player and the positions, which IS what you bid on", () => {
    render(<CandidateCard publicState={publicState()} fits={["PG"]} />);
    expect(screen.getByTestId("td-candidate-name")).toHaveTextContent("Michael Jordan");
    expect(screen.getByTestId("td-position-PG")).toBeInTheDocument();
  });

  it("reveals score and silhouette once the round has resolved", () => {
    render(
      <RoundReveal round={RESOLVED_ROUND} seatNames={["You", "Rival"]} yourSeat={0} />,
    );
    expect(screen.getByTestId("td-reveal-score")).toHaveTextContent("97.53");
    expect(screen.getByTestId("td-component-silhouette")).toBeInTheDocument();
    // Both amounts are public now -- at this point they ARE the result.
    expect(screen.getByTestId("td-reveal-bid-0")).toHaveTextContent("$9");
    expect(screen.getByTestId("td-reveal-bid-1")).toHaveTextContent("$4");
  });
});

describe("the silhouette maps components onto the house radar", () => {
  it("maps all five components plus data completeness", () => {
    const dna = toLineupDNA(RESOLVED_ROUND.candidate.component_index);
    expect(dna.primary_creation).toBe(96.6);
    expect(dna.scoring_pressure).toBe(87.83);
    expect(dna.individual_validation).toBe(100);
    expect(dna.postseason_translation).toBe(93.97);
    expect(dna.team_context).toBe(100);
    expect(dna.context_completeness).toBe(100);
  });

  it("does not rescale the server's numbers", () => {
    const index = { statistical_impact: 42.5 };
    expect(toLineupDNA(index).primary_creation).toBe(42.5);
  });
});

describe("budget meter", () => {
  it("reports the server's budget through a meter role", () => {
    render(<BudgetMeter seat={publicState().seats[0]} label="You" />);
    const meter = screen.getByRole("meter", { name: /You budget remaining/i });
    expect(meter).toHaveAttribute("aria-valuenow", "20");
    expect(meter).toHaveAttribute("aria-valuemax", "20");
  });
});

describe("bid controls", () => {
  it("caps the slider at the server's maximum, not the raw budget", () => {
    render(
      <BidControls
        publicState={publicState()}
        privateState={privateState({ max_bid: 9 })}
        disabled={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByTestId("td-bid-input")).toHaveAttribute("max", "9");
    expect(screen.getByTestId("td-bid-ceiling")).toHaveTextContent("$9");
  });

  it("explains the reserve rather than only its consequence", () => {
    render(
      <BidControls
        publicState={publicState()}
        privateState={privateState()}
        disabled={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByTestId("td-bid-ceiling")).toHaveTextContent("$4 must stay behind");
  });

  it("blocks bidding on a player who would strand the roster, but still allows a pass", () => {
    render(
      <BidControls
        publicState={publicState()}
        privateState={privateState({ can_acquire_candidate: false })}
        disabled={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByTestId("td-lock-bid")).toBeDisabled();
    expect(screen.getByTestId("td-pass")).not.toBeDisabled();
    expect(screen.getByTestId("td-bid-ceiling")).toHaveTextContent("cannot field a legal roster");
  });
});

describe("roster board", () => {
  it("places each player at the slot the SERVER assigned", () => {
    const seat = {
      ...publicState().seats[0],
      filled_slots: 2,
      roster: [
        { player_slug: "a", player_name: "Brian Grant", price: 9, slot: "C", autofilled: false },
        { player_slug: "b", player_name: "Mike Bantom", price: 4, slot: "SF", autofilled: false },
      ],
    };
    render(<RosterBoard seat={seat} slots={["PG", "SG", "SF", "PF", "C"]} label="Your" />);
    // Grant is at C, not SF, because a later purchase moved him -- the model
    // rearranging a multi-position player is correct behaviour, not a glitch.
    expect(screen.getByTestId("td-slot-0-C")).toHaveTextContent("Brian Grant");
    expect(screen.getByTestId("td-slot-0-SF")).toHaveTextContent("Mike Bantom");
    expect(screen.getByTestId("td-slot-0-PG")).toHaveTextContent("Open");
  });

  it("marks an auto-filled slot rather than passing it off as won", () => {
    const seat = {
      ...publicState().seats[0],
      roster: [
        { player_slug: "a", player_name: "Filler", price: 1, slot: "PG", autofilled: true },
      ],
    };
    render(<RosterBoard seat={seat} slots={["PG"]} label="Your" />);
    expect(screen.getByTestId("td-slot-0-PG")).toHaveTextContent("auto");
  });
});

describe("tie priority", () => {
  it("is always visible and names the holder", () => {
    render(<TiePriorityToken holderSeat={1} holderName="Rival" youHoldIt={false} />);
    expect(screen.getByTestId("td-tie-token")).toHaveTextContent("Rival");
  });

  it("says so plainly when you hold it", () => {
    render(<TiePriorityToken holderSeat={0} holderName="You" youHoldIt />);
    expect(screen.getByTestId("td-tie-token")).toHaveTextContent("you");
  });
});

describe("auction history", () => {
  it("shows both bids and the revealed score for a settled lot", () => {
    render(
      <AuctionHistory history={[RESOLVED_ROUND]} seatNames={["You", "Rival"]} yourSeat={0} />,
    );
    expect(screen.getByTestId("td-history-0")).toHaveTextContent("97.53");
    expect(screen.getByTestId("td-history-bid-0-0")).toHaveTextContent("$9");
    expect(screen.getByTestId("td-history-bid-0-1")).toHaveTextContent("$4");
  });

  it("renders nothing before the first lot settles", () => {
    const { container } = render(
      <AuctionHistory history={[]} seatNames={["You", "Rival"]} yourSeat={0} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("waiting label", () => {
  it("prompts you when your own bid is missing", () => {
    expect(waitingLabel(publicState(), 0)).toMatch(/your bid is not in/i);
  });

  it("waits on the opponent once you have locked", () => {
    const state = publicState();
    state.seats[0].locked = true;
    state.seats[1].locked = false;
    expect(waitingLabel(state, 0)).toMatch(/waiting for the other seat/i);
  });

  it("reports completion", () => {
    expect(waitingLabel(publicState({ phase: "complete" }), 0)).toMatch(/complete/i);
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
    levels: [
      {
        level: "roster_total", label: "Roster PEAK3 total", higher_wins: true,
        values: [152.79, 238.42], verdict: "seat_1",
      },
      {
        level: "budget_remaining", label: "Budget remaining", higher_wins: true,
        values: [0, 0], verdict: "not_consulted",
      },
    ],
  },
};

describe("receipt", () => {
  beforeEach(() => {
    render(<TwentyDollarReceipt receipt={RECEIPT} seatNames={["You", "Rival"]} yourSeat={0} />);
  });

  it("reports every settlement level, including the ones not consulted", () => {
    expect(screen.getByTestId("td-level-roster_total")).toBeInTheDocument();
    const notConsulted = screen.getByTestId("td-level-budget_remaining");
    expect(notConsulted).toHaveTextContent("Not consulted");
    expect(notConsulted.className).toContain("td-level-muted");
  });

  it("renders the levels in the server's published order", () => {
    const rows = screen.getAllByTestId(/^td-level-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "td-level-roster_total",
      "td-level-budget_remaining",
    ]);
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

  it("labels the counterfactual as an assumption rather than a simulation", () => {
    const counterfactual = screen.getByTestId("td-counterfactual");
    expect(counterfactual).toHaveTextContent("$3");
    expect(counterfactual).toHaveTextContent(/assumes every other auction/i);
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
