/**
 * The auction room, wired to a fake server (game-feel pass 2).
 *
 * Every other Showdown test renders a component with props handed to it
 * directly; this one answers questions about the WIRING — which state
 * reaches which child, when, and what leaves the client on a press:
 *
 *   * a bid press is acknowledged in the same tick and emits exactly ONE
 *     command, however fast the second press lands;
 *   * stepping the proposed bid updates the figure, the action label and the
 *     projected budget with no request;
 *   * the authoritative response reconciles the budget and the standing bid;
 *   * an OLDER poll landing after a newer command response is dropped;
 *   * the bot's reply is read when the server says it is due, not a poll
 *     interval later;
 *   * Play Again deals a fresh practice match and replaces the route.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { TwentyDollarMatchView, TwentyDollarPrivateState, TwentyDollarPublicState } from "@/lib/twenty-dollar-api";

const getMatch = vi.fn();
const submitCommand = vi.fn();
const startPractice = vi.fn();
const replace = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, refresh: vi.fn() }),
}));

vi.mock("@/lib/twenty-dollar-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/twenty-dollar-api")>("@/lib/twenty-dollar-api");
  return {
    ...actual,
    twentyDollarApi: {
      getMatch: (...args: unknown[]) => getMatch(...args),
      submitCommand: (...args: unknown[]) => submitCommand(...args),
      startPractice: (...args: unknown[]) => startPractice(...args),
    },
  };
});

import TwentyDollarGame from "@/components/twenty-dollar/TwentyDollarGame";
import { resetMemoryCursors } from "@/lib/twenty-dollar-seen";

const MATCH_ID = "m-room";

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

type ViewOverrides = Partial<Omit<TwentyDollarMatchView, "public_state" | "private_state">> & {
  public_state?: Partial<TwentyDollarPublicState>;
  private_state?: Partial<TwentyDollarPrivateState>;
};

/** Lot 1, the bot has already declined, the human is on the clock. */
function view(overrides: ViewOverrides = {}): TwentyDollarMatchView {
  const publicOverrides = overrides.public_state ?? {};
  const privateOverrides = overrides.private_state ?? {};
  return {
    match_id: MATCH_ID,
    mode: "twenty_dollar",
    mode_version: "twenty_dollar_v3",
    model_version: "peak3_v1",
    status: "live",
    state_version: 2,
    seat_count: 2,
    entry_path: "practice",
    rated: false,
    your_seat_index: 0,
    seats: [
      { seat_index: 0, display_name: "You", is_bot: false, status: "active", bot_rating: null },
      { seat_index: 1, display_name: "IsoKing", is_bot: true, status: "active", bot_rating: 1200 },
    ],
    legal_commands: ["bid", "pass"],
    current_turn_seat_index: 0,
    seconds_remaining: 25,
    turn_seconds_remaining: 25,
    turn_phase: "auction",
    bot_reply_in_seconds: null,
    latest_event_seq: 3,
    room_code: null,
    ...overrides,
    public_state: {
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
      seats: [seat(0), seat(1, { market_skips: 4, in_lot: false })],
      slots: ["PG", "SG", "SF", "PF", "C"],
      autofilled: false,
      opening_seat: 1,
      next_opening_seat: 0,
      active_seat: 0,
      high_bidder: null,
      current_bid: 0,
      minimum_bid: 1,
      lot_actions: [{ seat_index: 1, action: "pass" as const, amount: 0, consumed_skip: true }],
      candidate: {
        player_slug: "jamaal-wilkes",
        player_name: "Jamaal Wilkes",
        anchor_season: "1979-80",
        team: "LAL",
        positions: ["SF"],
      },
      qualified_pool_size: 500,
      history: [],
      seat_names: ["You", "IsoKing"],
      lot_kind: "standard",
      ...publicOverrides,
    },
    private_state: {
      seat_index: 0,
      is_your_turn: true,
      max_bid: 16,
      minimum_bid: 1,
      reserve_floor: 4,
      your_lot_bid: 0,
      in_lot: true,
      candidate_fits: ["SF"],
      market_skips: 5,
      pass_consumes_skip: false,
      pass_kind: "follow_pass" as const,
      lot_already_rejected: true,
      can_pass: true,
      timeout_outcome: "free_pass" as const,
      can_acquire_candidate: true,
      bid_blocked_reason: null,
      ...privateOverrides,
    },
  } as TwentyDollarMatchView;
}

/** The same lot after the human opened at `amount` and the bot is on the clock. */
/** `afterOpen`'s `bot_reply_in_seconds` (0.8 s) plus the room's
 *  `BOT_REPLY_SLACK_MS` (60 ms): the one deadline the bot-reply read is
 *  armed for. Kept beside the fixture so a change to either is visible here. */
const BOT_REPLY_DEADLINE_MS = 0.8 * 1000 + 60;

function afterOpen(amount: number, version = 3): TwentyDollarMatchView {
  return view({
    state_version: version,
    seconds_remaining: null,
    turn_seconds_remaining: 25,
    bot_reply_in_seconds: 0.8,
    current_turn_seat_index: 1,
    public_state: {
      active_seat: 1,
      high_bidder: 0,
      current_bid: amount,
      minimum_bid: amount + 1,
      lot_actions: [{ seat_index: 0, action: "bid", amount }],
      seats: [seat(0, { lot_bid: amount }), seat(1)],
    },
    private_state: { is_your_turn: false, your_lot_bid: amount, minimum_bid: amount + 1, bid_blocked_reason: "not_your_turn" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  window.localStorage.clear();
  resetMemoryCursors();
  getMatch.mockReset();
  submitCommand.mockReset();
  startPractice.mockReset();
  replace.mockReset();
  push.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

async function openRoom(first: TwentyDollarMatchView = view()) {
  getMatch.mockResolvedValue(first);
  render(<TwentyDollarGame matchId={MATCH_ID} />);
  await waitFor(() => expect(screen.getByTestId("td-game")).toBeInTheDocument());
  // Let the mount's passive effects settle before anything is pressed.
  await act(async () => {});
}

// ---------------------------------------------------------------------------
// Immediate acknowledgement, local manipulation
// ---------------------------------------------------------------------------

describe("the proposed bid is local and immediate", () => {
  it("steps the figure, the action label and the projected budget with no request", async () => {
    await openRoom();
    const calls = getMatch.mock.calls.length;
    expect(screen.getByTestId("td-bid-amount")).toHaveTextContent("$1");
    expect(screen.getByTestId("td-submit-bid")).toHaveTextContent("Bid $1");
    expect(screen.getByTestId("td-projection")).toHaveTextContent("Leaves you $19");

    fireEvent.click(screen.getByTestId("td-bid-plus"));
    fireEvent.click(screen.getByTestId("td-bid-plus"));
    fireEvent.click(screen.getByTestId("td-bid-plus-2"));

    expect(screen.getByTestId("td-bid-amount")).toHaveTextContent("$5");
    expect(screen.getByTestId("td-submit-bid")).toHaveTextContent("Bid $5");
    expect(screen.getByTestId("td-projection")).toHaveTextContent("Leaves you $15");
    // The budget meter projects the same number.
    expect(screen.getByTestId("td-budget-meter-0")).toHaveAttribute("data-projected", "15");
    expect(submitCommand).not.toHaveBeenCalled();
    expect(getMatch.mock.calls.length).toBe(calls);
  });

  it("Max means the legal ceiling, not the whole budget", async () => {
    await openRoom();
    fireEvent.click(screen.getByTestId("td-bid-max"));
    expect(screen.getByTestId("td-bid-amount")).toHaveTextContent("$16");
    expect(screen.getByTestId("td-projection")).toHaveTextContent("$4 reserved");
  });
});

describe("submitting a bid", () => {
  it("is acknowledged in the same tick, locks the figure, and freezes the clock", async () => {
    await openRoom();
    const pending = deferred<unknown>();
    submitCommand.mockReturnValue(pending.promise);
    fireEvent.click(screen.getByTestId("td-bid-plus"));
    fireEvent.click(screen.getByTestId("td-submit-bid"));

    // Same tick: pending state on the button, the clock frozen, the figure locked.
    expect(screen.getByTestId("td-submit-bid")).toHaveAttribute("data-state", "pending");
    await waitFor(() => expect(screen.getByTestId("td-clock")).toHaveAttribute("data-mode", "pending"));
    // THE CLOCK ZONE NAMES THE COMMITTED FIGURE, not the request. It read
    // "Sending $2" until the responsiveness pass, which is the client's
    // transport state given the room's most valuable space; the assertion
    // moved with the copy because that copy WAS the reported defect. What the
    // test still pins is the part that matters and did not change: the exact
    // amount this press committed is on screen before the server answers.
    expect(screen.getByTestId("td-pending")).toHaveTextContent("$2");
    expect(screen.getByTestId("td-pending")).toHaveTextContent("Confirming");
    expect(screen.getByTestId("td-bid-plus")).toBeDisabled();
    expect(screen.getByTestId("td-standing-amount-pending")).toHaveTextContent("$2");

    pending.resolve({ accepted: true, replayed: false, match: afterOpen(2) });
    await waitFor(() => expect(screen.getByTestId("td-standing-amount")).toHaveTextContent("$2"));
    // Reconciled from the server, not from the local proposal.
    expect(screen.getByTestId("td-standing-holder")).toHaveTextContent("You lead");
    expect(screen.getByTestId("td-clock")).toHaveAttribute("data-mode", "elapsed");
  });

  it("emits exactly ONE command for a rapid double press", async () => {
    await openRoom();
    const pending = deferred<unknown>();
    submitCommand.mockReturnValue(pending.promise);
    const button = screen.getByTestId("td-submit-bid");
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(screen.getByTestId("td-pass"));
    expect(submitCommand).toHaveBeenCalledTimes(1);
    expect(submitCommand.mock.calls[0][1]).toBe("bid");
    expect(submitCommand.mock.calls[0][2]).toEqual({ amount: 1 });
    pending.resolve({ accepted: true, replayed: false, match: afterOpen(1) });
    await waitFor(() => expect(screen.getByTestId("td-standing-amount")).toHaveTextContent("$1"));
    expect(submitCommand).toHaveBeenCalledTimes(1);
  });

  it("derives the idempotency key from the intent and the version current at execution", async () => {
    await openRoom();
    submitCommand.mockResolvedValue({ accepted: true, replayed: false, match: afterOpen(1) });
    fireEvent.click(screen.getByTestId("td-submit-bid"));
    await waitFor(() => expect(submitCommand).toHaveBeenCalledTimes(1));
    expect(submitCommand.mock.calls[0][3]).toBe(2);
    expect(submitCommand.mock.calls[0][4]).toBe(`${MATCH_ID}:0:2:bid:amount=1`);
  });

  it("explains a rejection and shows the error beat, then keeps the board the server sent", async () => {
    await openRoom();
    submitCommand.mockResolvedValue({
      accepted: false,
      replayed: false,
      rejection_code: "bid_too_low",
      message: "You must raise to at least $3.",
      match: view({ state_version: 4, public_state: { current_bid: 2, high_bidder: 1, minimum_bid: 3, lot_actions: [{ seat_index: 1, action: "bid", amount: 2 }] }, private_state: { minimum_bid: 3 } }),
    });
    fireEvent.click(screen.getByTestId("td-submit-bid"));
    await waitFor(() => expect(screen.getByTestId("td-error")).toBeInTheDocument());
    expect(screen.getByTestId("td-submit-bid")).toHaveAttribute("data-state", "error");
    expect(screen.getByTestId("td-standing-amount")).toHaveTextContent("$2");
    // Re-based onto the new floor once the request settled.
    expect(screen.getByTestId("td-bid-amount")).toHaveTextContent("$3");
  });
});

// ---------------------------------------------------------------------------
// Newer wins
// ---------------------------------------------------------------------------

describe("stale responses", () => {
  it("drops an OLDER poll that lands after a newer command response", async () => {
    await openRoom();
    const slowPoll = deferred<TwentyDollarMatchView>();
    getMatch.mockReturnValueOnce(slowPoll.promise);
    // Force a poll now (visibility wake) so it is in flight before the command.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    submitCommand.mockResolvedValue({ accepted: true, replayed: false, match: afterOpen(1, 3) });
    fireEvent.click(screen.getByTestId("td-submit-bid"));
    await waitFor(() => expect(screen.getByTestId("td-standing-amount")).toHaveTextContent("$1"));
    // The old poll finally answers with version 2: it must not roll the board back.
    await act(async () => {
      slowPoll.resolve(view());
    });
    expect(screen.getByTestId("td-standing-amount")).toHaveTextContent("$1");
    expect(screen.getByTestId("td-standing-holder")).toHaveTextContent("You lead");
  });
});

// ---------------------------------------------------------------------------
// The bot's reply is read when it is due
// ---------------------------------------------------------------------------

describe("reading the bot's reply", () => {
  it("schedules one read for `bot_reply_in_seconds`, not a fixed interval later", async () => {
    // THE CONTRACT: after the human's bid lands, the room arms exactly ONE
    // read for the server-published `bot_reply_in_seconds` (0.8 s) plus the
    // client's intentional slack (`BOT_REPLY_SLACK_MS`, 60 ms) — 860 ms — and
    // reads nothing before it.
    //
    // WHY THE TIMER IS OBSERVED, NOT INFERRED. The previous version waited
    // for the clock to enter `elapsed` mode and then advanced fake time in
    // two 500 ms steps. The clock flips in the same render the command
    // response lands, but the scheduling EFFECT runs after that render — on
    // a slow CI runner the first advance could happen before the timeout
    // was armed, and the second then never reached its deadline
    // ("expected 1 to be 2"). Spying on `setTimeout` waits for the arm
    // itself, and the deadline is measured from the fake clock's reading at
    // the instant it was armed, so the auto-advancing fake clock
    // (`shouldAdvanceTime`) cannot skew the boundary either.
    const original = window.setTimeout;
    let armedAt: number | null = null;
    const timeoutSpy = vi.spyOn(window, "setTimeout").mockImplementation(((...args: Parameters<typeof window.setTimeout>) => {
      if (args[1] === BOT_REPLY_DEADLINE_MS && armedAt === null) armedAt = Date.now();
      return original.apply(window, args);
    }) as unknown as typeof window.setTimeout);
    try {
      await openRoom();
      submitCommand.mockResolvedValue({ accepted: true, replayed: false, match: afterOpen(1) });
      const replied = view({
        state_version: 4,
        public_state: { current_bid: 2, high_bidder: 1, minimum_bid: 2, lot_actions: [{ seat_index: 0, action: "bid", amount: 1 }, { seat_index: 1, action: "bid", amount: 2 }] },
        private_state: { minimum_bid: 3 },
      });
      getMatch.mockResolvedValue(replied);
      fireEvent.click(screen.getByTestId("td-submit-bid"));

      // The read is ARMED for exactly 0.8 s + 60 ms — and only once.
      await waitFor(() => expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), BOT_REPLY_DEADLINE_MS));
      expect(timeoutSpy.mock.calls.filter((call) => call[1] === BOT_REPLY_DEADLINE_MS)).toHaveLength(1);
      expect(armedAt).not.toBeNull();
      const before = getMatch.mock.calls.length;

      // Not yet: 60 ms short of the deadline, measured from the arm.
      await act(async () => {
        vi.advanceTimersByTime(Math.max(0, (armedAt as number) + BOT_REPLY_DEADLINE_MS - 60 - Date.now()));
      });
      expect(getMatch.mock.calls.length).toBe(before);

      // Crossing the deadline fires exactly one read.
      await act(async () => {
        vi.advanceTimersByTime(Math.max(1, (armedAt as number) + BOT_REPLY_DEADLINE_MS + 1 - Date.now()));
      });
      expect(getMatch.mock.calls.length).toBe(before + 1);
    } finally {
      timeoutSpy.mockRestore();
    }
    await waitFor(() => expect(screen.getByTestId("td-standing-amount")).toHaveTextContent("$2"));
    // The opponent's raise is announced as a moment, and the turn banner says so.
    expect(screen.getByTestId("td-moment")).toHaveTextContent("IsoKing raises to $2");
    expect(screen.getByTestId("td-turn-indicator")).toHaveTextContent(/your move/i);
  });

  it("does not read again immediately when the turn stays with the human", async () => {
    await openRoom();
    const before = getMatch.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(getMatch.mock.calls.length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// The clock and the turn surface
// ---------------------------------------------------------------------------

describe("the clock", () => {
  it("counts down on the human's own turn", async () => {
    await openRoom();
    expect(screen.getByTestId("td-clock")).toHaveAttribute("data-mode", "countdown");
    expect(screen.getByTestId("td-turn-clock")).toHaveAttribute("data-owner", "you");
    expect(screen.getByTestId("td-turn-clock-value")).toHaveTextContent("25");
  });

  it("counts DOWN against the published deadline on the bot's turn, and says the bot is thinking", async () => {
    await openRoom(afterOpen(1));
    const clock = screen.getByTestId("td-clock");
    expect(clock).toHaveAttribute("data-mode", "elapsed");
    expect(clock).toHaveAttribute("data-direction", "down");
    expect(screen.getByTestId("td-turn-clock")).toHaveAttribute("data-owner", "bot");
    expect(screen.getByTestId("td-turn-clock-label")).toHaveTextContent(/IsoKing is thinking/);
    expect(screen.getByTestId("td-elapsed-value")).toHaveTextContent("25s");
  });

  it("keeps exactly one aria-live region tracking play", async () => {
    await openRoom();
    const live = document.querySelectorAll('[aria-live]:not([aria-live="off"])');
    // `ArenaTimer`'s threshold announcer is a screen-reader-only region that
    // speaks at 10s, 5s and expiry — it is not a turn surface.
    const turnRegions = [...live].filter((n) => !n.classList.contains("sr-only"));
    expect(turnRegions).toHaveLength(1);
    expect(turnRegions[0]).toHaveAttribute("data-testid", "td-turn-indicator");
  });
});

// ---------------------------------------------------------------------------
// Rosters and money
// ---------------------------------------------------------------------------

describe("the rosters are lineups", () => {
  it("marks the slot the live candidate would fill as a target on your lineup", async () => {
    await openRoom();
    expect(screen.getByTestId("td-slot-0-SF")).toHaveAttribute("data-state", "targeted");
    expect(screen.getByTestId("td-slot-0-PG")).toHaveAttribute("data-state", "empty");
  });

  it("locks a slot and reconciles the budget when the server says the lot sold", async () => {
    await openRoom();
    const sold = view({
      state_version: 5,
      public_state: {
        lot_index: 1,
        candidate: { player_slug: "next-up", player_name: "Next Up", anchor_season: "2001-02", team: "SAS", positions: ["C"] },
        seats: [
          seat(0, { budget: 17, filled_slots: 1, roster: [{ player_slug: "jamaal-wilkes", player_name: "Jamaal Wilkes", anchor_season: "1979-80", price: 3, slot: "SF", prime_score: 61.2, autofilled: false }], open_slots: ["PG", "SG", "PF", "C"] }),
          seat(1),
        ],
        history: [
          {
            lot_index: 0, round_index: 0, opening_seat: 1, bids: [3, 0], timed_out: [false, false], winner_seat: 0, price: 3, decided_by: "bid", lot_kind: "standard", actions: [], slot_options: ["SF"], candidate_tier: "101-250",
            candidate: { player_slug: "jamaal-wilkes", player_name: "Jamaal Wilkes", anchor_season: "1979-80", team: "LAL", positions: ["SF"], row_id: "r", rank: 150, prime_score: 61.2, components: {}, component_index: {}, model_version: "peak3_v1" },
          },
        ],
      },
      private_state: { candidate_fits: ["C"], reserve_floor: 3, max_bid: 14 },
    });
    getMatch.mockResolvedValue(sold);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(screen.getByTestId("td-slot-0-SF")).toHaveAttribute("data-state", "filled"));
    expect(screen.getByTestId("td-slot-0-SF")).toHaveAttribute("data-gf-lock", "arrived");
    expect(screen.getByTestId("td-budget-meter-0")).toHaveAttribute("data-value", "17");
    // The SOLD moment plays over the stage and never blocks the live controls.
    expect(screen.getByTestId("td-lot-reveal")).toHaveTextContent("SOLD");
    expect(screen.getByTestId("td-lot-reveal")).toHaveTextContent("61.2");
    expect(screen.getByTestId("td-bid-controls")).toHaveAttribute("data-live", "true");
    expect(screen.getByTestId("td-submit-bid")).toBeEnabled();
    expect(screen.getByTestId("td-candidate")).toHaveTextContent("Next Up");
  });
});

// ---------------------------------------------------------------------------
// Play Again
// ---------------------------------------------------------------------------

describe("Play Again", () => {
  it("deals a fresh practice match and replaces the route", async () => {
    const receipt = {
      ruleset_version: "twenty_dollar_v3", model_version: "peak3_v1", starting_budget: 20, slots: ["PG", "SG", "SF", "PF", "C"],
      seats: [
        { seat_index: 0, roster_total: 300, spent: 18, budget_remaining: 2, peak3_per_dollar: 16.6, components: {}, roster: [] },
        { seat_index: 1, roster_total: 280, spent: 17, budget_remaining: 3, peak3_per_dollar: 16.4, components: {}, roster: [] },
      ],
      positional: [], best_bargain: null, biggest_overpay: null, most_decisive: null, autofilled: false, rounds_played: 12,
      component_disclosure: { shown: [], absent: [], count: 5, house_count: 6, note: "" },
      settlement: { winner_seat: 0, outcome: "decided", decided_by: "roster_total", levels: [], rules_version: "x" },
    };
    await openRoom(view({ status: "completed", state_version: 40, public_state: { phase: "complete", active_seat: null, candidate: null, receipt }, turn_phase: null }));
    startPractice.mockResolvedValue({ match_id: "m-next" });
    await waitFor(() => expect(screen.getByTestId("td-result")).toBeInTheDocument());
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    fireEvent.click(screen.getByTestId("td-play-again"));
    await waitFor(() => expect(startPractice).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/arena/twenty-dollar/m-next"));
  });
});

// ---------------------------------------------------------------------------
// The first read
// ---------------------------------------------------------------------------

describe("the first read", () => {
  it("retries a transient refusal before showing the not-your-seat gate", async () => {
    // A freshly started server plus a session still hydrating produced a
    // 403 on the very first request in a real two-tab run; the room must
    // read again rather than settle on it.
    const { TwentyDollarAPIError } = await import("@/lib/twenty-dollar-api");
    getMatch.mockRejectedValueOnce(new TwentyDollarAPIError(403, "not your seat", "not_your_seat"));
    getMatch.mockResolvedValue(view());
    render(<TwentyDollarGame matchId={MATCH_ID} />);
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    await waitFor(() => expect(screen.getByTestId("td-game")).toBeInTheDocument());
    expect(screen.queryByTestId("td-match-error")).not.toBeInTheDocument();
    expect(getMatch).toHaveBeenCalledTimes(2);
  });

  it("shows the gate at once for a match that does not exist", async () => {
    const { TwentyDollarAPIError } = await import("@/lib/twenty-dollar-api");
    getMatch.mockRejectedValue(new TwentyDollarAPIError(404, "no such match", "not_found"));
    render(<TwentyDollarGame matchId={MATCH_ID} />);
    await waitFor(() => expect(screen.getByTestId("td-match-error")).toBeInTheDocument());
    expect(getMatch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// "SENDING YOUR MOVE" — the dead time, and what replaced it
// ---------------------------------------------------------------------------

describe("a press while the command is in flight", () => {
  it("names the decision instead of the request, and never blanks the room", async () => {
    // THE REPORT. A bid or a pass replaced the clock zone with "Sending your
    // decision…" and the room's one turn line with "SENDING YOUR MOVE" for
    // the whole round trip. Measured in process against the real route, the
    // server's own work behind that screen is a median of 6.1ms: what the
    // player was watching was network latency being narrated at them.
    await openRoom();
    const flight = deferred<{ accepted: boolean; match: TwentyDollarMatchView }>();
    submitCommand.mockReturnValue(flight.promise);

    fireEvent.click(screen.getByTestId("td-bid-plus-2"));
    expect(screen.getByTestId("td-bid-amount")).toHaveTextContent("$3");
    fireEvent.click(screen.getByTestId("td-submit-bid"));

    // NO SERVER ANSWER YET.
    await waitFor(() => expect(screen.getByTestId("td-game")).toHaveAttribute("data-phase", "pending"));
    const turn = screen.getByTestId("td-turn-indicator");
    expect(turn).toHaveTextContent("You bid $3");
    expect(turn).not.toHaveTextContent(/sending/i);
    // The clock zone confirms the committed figure rather than the request.
    const clockPending = screen.getByTestId("td-pending");
    expect(clockPending).toHaveTextContent("$3");
    expect(clockPending).toHaveTextContent("Confirming");
    expect(clockPending).not.toHaveTextContent(/sending/i);
    // The lot, the standing figure and both lineups are all still on screen.
    expect(screen.getByTestId("td-candidate")).toBeInTheDocument();
    expect(screen.getByTestId("td-roster-0")).toBeInTheDocument();
    expect(screen.getByTestId("td-roster-1")).toBeInTheDocument();

    await act(async () => {
      flight.resolve({ accepted: true, match: afterOpen(3) });
      await flight.promise;
    });
    await waitFor(() => expect(screen.getByTestId("td-standing-amount")).toHaveTextContent("$3"));
  });

  it("acknowledges a pass the same way", async () => {
    await openRoom();
    const flight = deferred<{ accepted: boolean; match: TwentyDollarMatchView }>();
    submitCommand.mockReturnValue(flight.promise);
    fireEvent.click(screen.getByTestId("td-pass"));
    await waitFor(() => expect(screen.getByTestId("td-turn-indicator")).toHaveTextContent("You passed"));
    expect(screen.getByTestId("td-pending")).toHaveTextContent("Pass");
    await act(async () => {
      flight.resolve({ accepted: true, match: view({ state_version: 3 }) });
      await flight.promise;
    });
  });

  it("emits exactly one command however many times the control is pressed", async () => {
    await openRoom();
    const flight = deferred<{ accepted: boolean; match: TwentyDollarMatchView }>();
    submitCommand.mockReturnValue(flight.promise);
    const bid = screen.getByTestId("td-submit-bid");
    fireEvent.click(bid);
    fireEvent.click(bid);
    fireEvent.click(bid);
    expect(submitCommand).toHaveBeenCalledTimes(1);
    await act(async () => {
      flight.resolve({ accepted: true, match: afterOpen(1) });
      await flight.promise;
    });
    expect(submitCommand).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// The side-column turn rails, and whose clock is actually running
// ---------------------------------------------------------------------------

describe("the side-column turn rails", () => {
  it("run only for the seat the SERVER says is on the clock", async () => {
    await openRoom();
    expect(screen.getByTestId("td-turn-rail-0")).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("td-turn-rail-0")).toHaveTextContent("Your move");
    expect(screen.getByTestId("td-turn-rail-1")).toHaveAttribute("data-state", "inactive");
    expect(screen.getByTestId("td-turn-rail-1")).toHaveTextContent("Waiting");
    // The inactive rail shows no number at all -- there is no second timer.
    expect(screen.getByTestId("td-turn-rail-clock-1-value")).toHaveTextContent("—");
  });

  it("hold NEUTRAL while this client's command is in flight — the opponent's clock has not opened", async () => {
    // THE TIMER RULE. The next seat's countdown may not start from this
    // client's press; it starts when the server publishes the next active
    // seat and its deadline. Until then neither rail counts.
    await openRoom();
    const flight = deferred<{ accepted: boolean; match: TwentyDollarMatchView }>();
    submitCommand.mockReturnValue(flight.promise);
    fireEvent.click(screen.getByTestId("td-submit-bid"));

    await waitFor(() => expect(screen.getByTestId("td-turn-rail-0")).toHaveAttribute("data-state", "pending"));
    expect(screen.getByTestId("td-turn-rail-1")).toHaveAttribute("data-state", "inactive");
    expect(screen.getByTestId("td-turn-rail-clock-0-value")).toHaveTextContent("—");
    expect(screen.getByTestId("td-turn-rail-clock-1-value")).toHaveTextContent("—");

    await act(async () => {
      flight.resolve({ accepted: true, match: afterOpen(1) });
      await flight.promise;
    });

    // NOW the opponent's rail is the one running, on the server's own deadline.
    await waitFor(() => expect(screen.getByTestId("td-turn-rail-1")).toHaveAttribute("data-state", "active"));
    expect(screen.getByTestId("td-turn-rail-0")).toHaveAttribute("data-state", "inactive");
  });

  it("count the SAME deadline the stage clock counts", async () => {
    // One authority, one number: a rail and the central clock reading
    // different seconds is the "two independent timers" defect.
    await openRoom();
    const flight = deferred<{ accepted: boolean; match: TwentyDollarMatchView }>();
    submitCommand.mockReturnValue(flight.promise);
    fireEvent.click(screen.getByTestId("td-submit-bid"));
    await act(async () => {
      flight.resolve({ accepted: true, match: afterOpen(1) });
      await flight.promise;
    });
    await waitFor(() => expect(screen.getByTestId("td-turn-rail-1")).toHaveAttribute("data-state", "active"));
    const rail = screen.getByTestId("td-turn-rail-clock-1-value").textContent;
    const stage = screen.getByTestId("td-turn-clock-value").textContent;
    expect(rail).toBe(stage);
  });
});

// ---------------------------------------------------------------------------
// Arrival (game-feel pass 4)
// ---------------------------------------------------------------------------

describe("arrival", () => {
  it("reports the intro on screen exactly once, then shows the intro's own countdown", async () => {
    const arriving = view({
      state_version: 1,
      turn_phase: "arrival",
      legal_commands: ["showdown_intro_seen", "showdown_forfeit"],
      current_turn_seat_index: null,
      seconds_remaining: 20,
      turn_seconds_remaining: 20,
      turn_elapsed_seconds: 0.1,
      turn_total_seconds: 20,
      turn_seq: 0,
      private_state: { is_your_turn: false },
    });
    const intro = view({
      state_version: 2,
      turn_phase: "intro",
      legal_commands: ["showdown_forfeit"],
      current_turn_seat_index: null,
      seconds_remaining: 4.5,
      turn_seconds_remaining: 4.5,
      turn_elapsed_seconds: 0,
      turn_total_seconds: 4.5,
      turn_seq: 1,
      private_state: { is_your_turn: false },
    });
    submitCommand.mockResolvedValue({ accepted: true, replayed: false, match: intro });
    await openRoom(arriving);

    expect(screen.getByTestId("td-intro")).toBeInTheDocument();
    await waitFor(() => expect(submitCommand).toHaveBeenCalledTimes(1));
    expect(submitCommand.mock.calls[0][1]).toBe("showdown_intro_seen");
    expect(submitCommand.mock.calls[0][3]).toBe(1);

    await waitFor(() => expect(screen.getByTestId("td-intro-countdown")).toHaveTextContent(/Lot 1 opens in \d+s/));
    expect(screen.getByTestId("td-intro-countdown")).toHaveAttribute("data-arriving", "false");

    getMatch.mockResolvedValue(intro);
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    expect(submitCommand).toHaveBeenCalledTimes(1);
  });
});
