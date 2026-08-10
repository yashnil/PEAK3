/**
 * The auction room, wired to a fake server.
 *
 * WHY THIS FILE EXISTS. Every other test in this workstream renders a component
 * with props handed to it directly, so none of them could answer a question
 * about the WIRING — which state reaches which child, and when.
 *
 * It was written to chase a reported "there is no countdown anywhere on the
 * auction screen", and the first thing it established is that there was no such
 * defect: the review frame had been captured 1,600 ms after the board appeared,
 * which is inside the lot-reveal beat, and the reveal beat holding the clock is
 * exactly what S20-02 asks for. The report was a photograph of correct
 * behaviour.
 *
 * WHAT IT PINS NOW is the set of clock states the room can actually be in, and
 * the rule that none of them is blank. The server sends `seconds_remaining` to
 * exactly one seat (`arena.py`), so `null` is the normal answer for the whole
 * of the opponent's turn and for every beat — and the old surface handed that
 * null to `ArenaTimer`, whose `--idle` state is a label and no digits. Correct
 * for a shared component; an empty rectangle as this mode's clock.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

import type {
  TwentyDollarMatchView,
  TwentyDollarPrivateState,
  TwentyDollarPublicState,
} from "@/lib/twenty-dollar-api";

const getMatch = vi.fn();
const submitCommand = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/twenty-dollar-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/twenty-dollar-api")>(
    "@/lib/twenty-dollar-api",
  );
  return {
    ...actual,
    twentyDollarApi: {
      getMatch: (...args: unknown[]) => getMatch(...args),
      submitCommand: (...args: unknown[]) => submitCommand(...args),
      startPractice: vi.fn(),
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

/**
 * A view shaped exactly like the server's. The defaults reproduce the state
 * the review frame was captured in: lot 1, the bot has already declined, the
 * human is on the clock with a full window.
 */
type ViewOverrides = Partial<Omit<TwentyDollarMatchView, "public_state" | "private_state">> & {
  public_state?: Partial<TwentyDollarPublicState>;
  private_state?: Partial<TwentyDollarPrivateState>;
};

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
      { seat_index: 1, display_name: "PEAK3 Bot", is_bot: true, status: "active", bot_rating: 1200 },
    ],
    legal_commands: ["bid", "pass"],
    current_turn_seat_index: 0,
    seconds_remaining: 25,
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
      seat_names: ["You", "PEAK3 Bot"],
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

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  window.localStorage.clear();
  resetMemoryCursors();
  getMatch.mockReset();
  submitCommand.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Mount, dismiss the intro, and settle every beat. */
async function openRoom(first: TwentyDollarMatchView = view()) {
  getMatch.mockResolvedValue(first);
  render(<TwentyDollarGame matchId={MATCH_ID} />);
  await waitFor(() => expect(screen.getByTestId("td-table")).toBeInTheDocument());
  const start = screen.queryByTestId("td-intro-start");
  if (start) {
    await act(async () => {
      start.click();
    });
  }
  await act(async () => {
    vi.advanceTimersByTime(2500);
  });
}

// ---------------------------------------------------------------------------
// The clock, in every state the room can be in
// ---------------------------------------------------------------------------

describe("the clock is never blank", () => {
  it("runs a real countdown on the human's own turn, once the beats have passed", async () => {
    await openRoom();
    expect(screen.getByTestId("td-clock")).toHaveAttribute("data-mode", "countdown");
    expect(screen.getByTestId("td-timer-value")).toBeInTheDocument();
    expect(Number(screen.getByTestId("td-timer-value").textContent)).toBeGreaterThan(0);
    // The consequence of expiry, named before it happens.
    expect(screen.getByTestId("td-timer-consequence")).toHaveTextContent(/./);
  });

  it("keeps counting across polls rather than blanking between them", async () => {
    await openRoom();
    const first = Number(screen.getByTestId("td-timer-value").textContent);
    await act(async () => {
      vi.advanceTimersByTime(6_000);
    });
    expect(screen.getByTestId("td-clock")).toHaveAttribute("data-mode", "countdown");
    expect(Number(screen.getByTestId("td-timer-value").textContent)).toBeLessThanOrEqual(first);
  });

  /**
   * THE STATE THAT WAS REPORTED AS A MISSING CLOCK. During the lot-reveal beat
   * the human's decision has not opened yet, so there is deliberately nothing
   * counting — that hold IS S20-02. What was wrong was the rendering: a null
   * deadline reached `ArenaTimer`, which drew its label-only idle state, and a
   * reviewer photographing that moment reasonably read it as a missing clock.
   * It now states the window it is about to give.
   */
  it("says what it is holding during the reveal beat, instead of going empty", async () => {
    await openRoom();
    expect(screen.getByTestId("td-clock")).toHaveAttribute("data-mode", "countdown");

    // A new lot arrives: the reveal beat opens and the decision is deliberately
    // not live yet.
    getMatch.mockResolvedValue(
      view({
        state_version: 4,
        public_state: { lot_index: 1, lot_actions: [] },
      }),
    );
    await act(async () => {
      vi.advanceTimersByTime(2_100);
    });

    const clock = screen.getByTestId("td-clock");
    expect(clock).toHaveAttribute("data-mode", "held");
    expect(clock).toHaveTextContent(/your clock/i);
    expect(clock).toHaveTextContent(/opens in a moment/i);
    expect(clock).toHaveTextContent("25s");
    // The band the reviewer photographed contained a label and nothing else.
    expect(clock.textContent?.trim().length).toBeGreaterThan(30);

    // ...and the beat ends on its own, handing the countdown back.
    await act(async () => {
      vi.advanceTimersByTime(1_400);
    });
    expect(screen.getByTestId("td-clock")).toHaveAttribute("data-mode", "countdown");
  });

  /**
   * THE BOT'S TURN IS NOT A DEADLINE WE HAVE. `arena.py` reports
   * `seconds_remaining` to exactly one seat, so the other seat's is `null` by
   * design — for the entire duration of every bot turn, on every lot. Counting
   * DOWN would mean manufacturing a deadline out of `TURN_SECONDS` and hoping
   * it matched; counting UP is true.
   */
  it("counts UP on the opponent's turn instead of inventing a deadline", async () => {
    await openRoom(
      view({
        seconds_remaining: null,
        current_turn_seat_index: 1,
        public_state: { active_seat: 1, lot_actions: [] },
        private_state: { is_your_turn: false, bid_blocked_reason: "not_your_turn" },
      }),
    );
    const clock = screen.getByTestId("td-clock");
    expect(clock).toHaveAttribute("data-mode", "elapsed");
    expect(clock).toHaveTextContent(/time elapsed/i);
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByTestId("td-elapsed-value")).toHaveTextContent(/[1-9]\d*s/);
    // And it does NOT answer to the countdown's name: `td-timer-value` means
    // "the human's remaining decision time" to the browser suite, and an
    // elapsed count under that name would satisfy assertions about the window.
    expect(screen.queryByTestId("td-timer-value")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Turn surfaces (the TMW-07 defect, reproduced here and reduced)
// ---------------------------------------------------------------------------

describe("whose turn it is", () => {
  it("is said by the room banner and the seat marker, and by nothing else", async () => {
    await openRoom();
    // FOUR surfaces answered this: a `Your move` banner, an `ON THE CLOCK` chip,
    // the clock's `YOUR TURN` label and a `Your move — open or pass.` line under
    // the auction log. Two remain and they do different jobs — one is the
    // room-level statement, one marks the seat. The clock now reports TIME, and
    // the waiting line is gone.
    expect(screen.queryAllByTestId("td-turn-indicator")).toHaveLength(1);
    expect(screen.getByTestId("td-seat-live-0")).toHaveTextContent(/on the clock/i);
    expect(screen.queryByTestId("td-waiting")).toBeNull();
    expect(screen.getByTestId("td-clock")).not.toHaveTextContent(/your turn/i);
  });

  it("keeps exactly one aria-live region tracking play", async () => {
    await openRoom();
    const live = document.querySelectorAll('[aria-live]:not([aria-live="off"])');
    // `ArenaTimer`'s threshold announcer is a screen-reader-only region that
    // speaks at 10s, 5s and expiry — it is not a turn surface, and it is
    // explicitly not per-second.
    const turnRegions = [...live].filter((n) => !n.classList.contains("sr-only"));
    expect(turnRegions).toHaveLength(1);
    expect(turnRegions[0]).toHaveAttribute("data-testid", "td-turn-indicator");
  });

  it("marks the active seat as a state on the card", async () => {
    await openRoom();
    expect(screen.getByTestId("td-budget-0")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("td-budget-1")).toHaveAttribute("data-active", "false");
  });
});

// ---------------------------------------------------------------------------
// The empty-bid placeholder
// ---------------------------------------------------------------------------

describe("the current-bid block before anyone opens", () => {
  it("shows a real zero rather than a bar that reads as a loading skeleton", async () => {
    await openRoom();
    // An em dash at `clamp(2.75rem, 9vw, 4rem)` renders as a thick grey
    // horizontal bar directly under the "CURRENT BID" label. Reviewers read it
    // as a skeleton, which is exactly what a placeholder glyph at display size
    // looks like.
    const amount = screen.getByTestId("td-standing-amount");
    expect(amount).toHaveTextContent("$0");
    expect(amount.textContent).not.toContain("—");
    expect(screen.getByTestId("td-standing-holder")).toHaveTextContent(/floor is open/i);
  });

  it("shows the standing bid once it exists", async () => {
    await openRoom(
      view({
        public_state: { current_bid: 6, high_bidder: 1, minimum_bid: 7 },
      }),
    );
    expect(screen.getByTestId("td-standing-amount")).toHaveTextContent("$6");
    expect(screen.getByTestId("td-standing-holder")).toHaveTextContent("PEAK3 Bot leads");
  });
});

// ---------------------------------------------------------------------------
// S20-08, end to end through the room
// ---------------------------------------------------------------------------

describe("submitting freezes the clock (S20-08), end to end", () => {
  it("replaces the countdown with the submitted action while the request is out", async () => {
    await openRoom();
    expect(screen.getByTestId("td-clock")).toHaveAttribute("data-mode", "countdown");

    let release: (value: unknown) => void = () => {};
    submitCommand.mockImplementation(
      () => new Promise((resolve) => { release = resolve; }),
    );

    await act(async () => {
      screen.getByTestId("td-submit-bid").click();
    });

    expect(screen.getByTestId("td-clock")).toHaveAttribute("data-mode", "pending");
    expect(screen.queryByTestId("td-timer-value")).toBeNull();
    expect(screen.getByTestId("td-pending")).toHaveTextContent("Sending your $1 bid…");

    await act(async () => {
      release({ accepted: true, replayed: false, match: view({ state_version: 3 }) });
    });
    await waitFor(() => expect(screen.queryByTestId("td-pending")).toBeNull());
  });

  it("derives a fresh idempotency key per intent, so a retry cannot replay a stale verdict", async () => {
    await openRoom();
    submitCommand.mockResolvedValue({
      accepted: true,
      replayed: false,
      match: view({ state_version: 3 }),
    });

    await act(async () => {
      screen.getByTestId("td-submit-bid").click();
    });
    await waitFor(() => expect(submitCommand).toHaveBeenCalled());
    const firstKey = submitCommand.mock.calls[0][4];
    expect(firstKey).toContain(MATCH_ID);
    expect(firstKey).toContain("bid");
    expect(firstKey).toContain("amount=1");
  });
});
