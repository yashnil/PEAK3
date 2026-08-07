/**
 * The lot ledger: what plays as a reveal, what recaps, and what can never be
 * permanent (S20-10).
 *
 * THIS FILE USED TO ENCODE THE DEFECT. Its previous assertions were "several
 * unseen lots is a gap", "a gap does not acknowledge itself", and "the summary
 * survives a remount" — all of which described the sticky "While you were away"
 * banner that fired during live play. They are replaced rather than relaxed,
 * because the behaviour they protected was the bug.
 *
 * THE THREE VERIFIED MECHANISMS behind the report, none of which is a reconnect:
 *
 *  1. ONE ACCEPTED COMMAND CAN SETTLE TWO OR MORE LOTS, and it is normal.
 *     `state.py::_advance_lot` calls `_resolve_lot` on the lot it just created
 *     when neither seat can legally acquire the candidate, and `_resolve_lot`
 *     calls `_advance_lot` again. The market draws from all 500 qualified
 *     players regardless of either roster. The old hook read `unseen.length > 1`
 *     as a reconnect and showed the banner to a player who was sitting there.
 *  2. IT WAS STICKY. The cursor advanced only on a solo reveal or on the
 *     "Caught up" button, so an undismissed gap froze it forever — banner
 *     permanent, `reveal` permanently null.
 *  3. BLOCKED STORAGE MADE BOTH PERMANENT, because writes silently did nothing.
 *
 * A REMOUNT IS A RELOAD, for this hook: everything it reads on mount comes from
 * the cursor store and from props, so `unmount()` then `render()` exercises the
 * path a browser reload takes.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  ResumeRecap,
  useLotLedger,
  REVEAL_HOLD_MS,
} from "@/components/twenty-dollar/LotLedger";
import {
  clearSeenCursor,
  partitionUnseen,
  readSeenCursor,
  resetMemoryCursors,
  seenCursorKey,
  writeSeenCursor,
} from "@/lib/twenty-dollar-seen";
import type { ResolvedLot, TwentyDollarPublicState } from "@/lib/twenty-dollar-api";

const MATCH = "m-reconnect";

function lot(index: number, overrides: Partial<ResolvedLot> = {}): ResolvedLot {
  return {
    lot_index: index,
    round_index: index,
    candidate: {
      player_slug: `player-${index}`,
      player_name: `Player ${index}`,
      anchor_season: "2015-16",
      team: "GSW",
      positions: ["PG"],
      row_id: `player-${index}-1yr-201516`,
      rank: index + 1,
      prime_score: 80 - index,
      components: {},
      component_index: {},
      model_version: "peak3_v1",
    },
    candidate_tier: "1-100",
    opening_seat: 0,
    bids: [1, 0],
    timed_out: [false, false],
    winner_seat: 0,
    price: 1,
    decided_by: "bid",
    actions: [{ seat_index: 0, action: "bid", amount: 1 }],
    ...overrides,
  };
}

function state(
  history: ResolvedLot[],
  overrides: Partial<TwentyDollarPublicState> = {},
): TwentyDollarPublicState {
  return {
    ruleset_version: "twenty_dollar_v3",
    model_version: "peak3_v1",
    phase: "auction",
    lot_index: history.length,
    max_lots: 36,
    standard_market_lots: 24,
    market_phase: "standard",
    market_skips_per_seat: 5,
    round_index: history.length,
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
    history,
    seat_names: ["You", "Floor General"],
    ...overrides,
  };
}

/** A probe that renders whatever the ledger decides, so a test can read it. */
function Probe({ history, phase = "auction" as const }: {
  history: ResolvedLot[];
  phase?: "auction" | "complete";
}) {
  const { recap, reveal, queued, acknowledgeRecap } = useLotLedger(
    MATCH,
    state(history, { phase }),
  );
  return (
    <div>
      <span data-testid="recap">{recap.map((l) => l.lot_index).join(",")}</span>
      <span data-testid="reveal">{reveal ? reveal.lot_index : "none"}</span>
      <span data-testid="queued">{queued}</span>
      <ResumeRecap
        lots={recap}
        seatNames={["You", "Floor General"]}
        yourSeat={0}
        onDismiss={acknowledgeRecap}
      />
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  resetMemoryCursors();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// The cursor itself
// ---------------------------------------------------------------------------

describe("the persisted cursor", () => {
  it("starts at -1, so a brand-new match reports nothing", () => {
    expect(readSeenCursor(MATCH)).toBe(-1);
    expect(partitionUnseen([], -1)).toEqual([]);
  });

  it("only ever moves forward", () => {
    writeSeenCursor(MATCH, 4);
    writeSeenCursor(MATCH, 2);
    expect(readSeenCursor(MATCH)).toBe(4);
  });

  it("is keyed to the match, so two matches cannot contaminate each other", () => {
    writeSeenCursor("m-a", 7);
    writeSeenCursor("m-b", 1);
    expect(readSeenCursor("m-a")).toBe(7);
    expect(readSeenCursor("m-b")).toBe(1);
    expect(seenCursorKey("m-a")).not.toBe(seenCursorKey("m-b"));
  });

  it("treats a corrupt value as 'nothing acknowledged'", () => {
    window.localStorage.setItem(seenCursorKey(MATCH), "not-a-number");
    expect(readSeenCursor(MATCH)).toBe(-1);
  });

  it("preserves ordering regardless of the input array's order", () => {
    const unsorted = [lot(5), lot(2), lot(9)];
    expect(partitionUnseen(unsorted, 1).map((l) => l.lot_index)).toEqual([2, 5, 9]);
  });

  /**
   * THE THIRD MECHANISM. Storage that throws used to make the cursor
   * permanently `-1`: every settled lot read as missed, "Caught up" was inert,
   * and the banner could never be dismissed. The documented intent — "degrade
   * to per-session" — did not hold, because a per-session degrade needs
   * somewhere to put the session's value.
   */
  it("keeps advancing IN MEMORY when storage is blocked", () => {
    const setItem = window.localStorage.setItem;
    const getItem = window.localStorage.getItem;
    window.localStorage.setItem = () => {
      throw new Error("quota");
    };
    window.localStorage.getItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(() => writeSeenCursor(MATCH, 3)).not.toThrow();
      // The point: it READS BACK. Before, this was -1 forever.
      expect(readSeenCursor(MATCH)).toBe(3);
      writeSeenCursor(MATCH, 5);
      expect(readSeenCursor(MATCH)).toBe(5);
      expect(partitionUnseen([lot(4), lot(5), lot(6)], readSeenCursor(MATCH))).toHaveLength(1);
    } finally {
      window.localStorage.setItem = setItem;
      window.localStorage.getItem = getItem;
    }
  });
});

// ---------------------------------------------------------------------------
// Live play — the case the banner used to break
// ---------------------------------------------------------------------------

describe("lots that settle while the client is live", () => {
  it("play as a reveal SEQUENCE and never as a catch-up banner", () => {
    vi.useFakeTimers();
    // Mount live at lot 0 settled and acknowledged — an ordinary in-play state.
    writeSeenCursor(MATCH, 0);
    const { rerender } = render(<Probe history={[lot(0)]} />);
    expect(screen.getByTestId("recap")).toHaveTextContent("");

    // ONE accepted command settles three lots. This is `_advance_lot` →
    // `_resolve_lot` → `_advance_lot`, which is normal, and it is what used to
    // produce "While you were away" in front of a player who was sitting there.
    rerender(<Probe history={[lot(0), lot(1), lot(2), lot(3)]} />);
    expect(screen.getByTestId("recap")).toHaveTextContent("");
    expect(screen.queryByTestId("td-missed-lots")).toBeNull();
    expect(screen.getByTestId("reveal")).toHaveTextContent("1");
    expect(screen.getByTestId("queued")).toHaveTextContent("2");
  });

  it("advances through the queue one lot at a time, on its own", () => {
    vi.useFakeTimers();
    writeSeenCursor(MATCH, 0);
    const history = [lot(0), lot(1), lot(2), lot(3)];
    const { rerender } = render(<Probe history={[lot(0)]} />);
    rerender(<Probe history={history} />);

    expect(screen.getByTestId("reveal")).toHaveTextContent("1");
    act(() => {
      vi.advanceTimersByTime(REVEAL_HOLD_MS + 50);
    });
    expect(screen.getByTestId("reveal")).toHaveTextContent("2");
    act(() => {
      vi.advanceTimersByTime(REVEAL_HOLD_MS + 50);
    });
    expect(screen.getByTestId("reveal")).toHaveTextContent("3");
    act(() => {
      vi.advanceTimersByTime(REVEAL_HOLD_MS + 50);
    });
    // THE QUEUE DRAINS. It could not, before: `unseen.length > 1` never
    // self-acknowledged, so the cursor froze and `reveal` was null forever.
    expect(screen.getByTestId("reveal")).toHaveTextContent("none");
    expect(readSeenCursor(MATCH)).toBe(3);
  });

  it("a brand-new match with no history reveals and recaps nothing", () => {
    render(<Probe history={[]} />);
    expect(screen.getByTestId("recap")).toHaveTextContent("");
    expect(screen.getByTestId("reveal")).toHaveTextContent("none");
  });
});

// ---------------------------------------------------------------------------
// A genuine resume
// ---------------------------------------------------------------------------

describe("a genuine resume boundary", () => {
  it("recaps the lots that settled while this browser was gone", () => {
    writeSeenCursor(MATCH, 1);
    render(<Probe history={[lot(0), lot(1), lot(2), lot(3), lot(4)]} />);
    expect(screen.getByTestId("recap")).toHaveTextContent("2,3,4");
    expect(screen.getByTestId("td-missed-lots")).toHaveAttribute("data-count", "3");
  });

  it("stays COMPACT: three rows, with the rest behind 'View N more'", async () => {
    writeSeenCursor(MATCH, -1);
    render(<Probe history={[lot(0), lot(1), lot(2), lot(3), lot(4), lot(5)]} />);
    // Six missed lots, three rendered. A giant permanent block pushing the live
    // lot below the fold is exactly what S20-10 forbids.
    expect(screen.getAllByTestId(/^td-missed-\d+$/)).toHaveLength(3);
    expect(screen.getByTestId("td-missed-more")).toHaveTextContent("View 3 more");

    await userEvent.click(screen.getByTestId("td-missed-more"));
    expect(screen.getAllByTestId(/^td-missed-\d+$/)).toHaveLength(6);
  });

  it("reports a single missed lot as a reveal rather than a recap", () => {
    writeSeenCursor(MATCH, 2);
    render(<Probe history={[lot(0), lot(1), lot(2), lot(3)]} />);
    // The ceiling is 3 and the cursor is 2, so lot 3 IS behind the boundary —
    // one lot is still a recap of one, which the surface renders as one row.
    expect(screen.getByTestId("recap")).toHaveTextContent("3");
    expect(screen.getAllByTestId(/^td-missed-\d+$/)).toHaveLength(1);
  });

  it("reports nothing after a reload that missed nothing", () => {
    writeSeenCursor(MATCH, 3);
    render(<Probe history={[lot(0), lot(1), lot(2), lot(3)]} />);
    expect(screen.getByTestId("recap")).toHaveTextContent("");
    expect(screen.getByTestId("reveal")).toHaveTextContent("none");
  });

  it("does not re-recap lots that settle live AFTER the resume", () => {
    vi.useFakeTimers();
    writeSeenCursor(MATCH, 1);
    const { rerender } = render(<Probe history={[lot(0), lot(1), lot(2)]} />);
    expect(screen.getByTestId("recap")).toHaveTextContent("2");

    rerender(<Probe history={[lot(0), lot(1), lot(2), lot(3)]} />);
    // Lot 3 arrived while we were watching: a reveal, not more recap.
    expect(screen.getByTestId("recap")).toHaveTextContent("2");
    expect(screen.getByTestId("reveal")).toHaveTextContent("3");
  });
});

// ---------------------------------------------------------------------------
// Acknowledgement — and never being stuck
// ---------------------------------------------------------------------------

describe("acknowledgement", () => {
  it("dismissing the recap advances the cursor past every recapped lot", async () => {
    writeSeenCursor(MATCH, 0);
    render(<Probe history={[lot(0), lot(1), lot(2), lot(3)]} />);
    await userEvent.click(screen.getByTestId("td-missed-dismiss"));
    expect(readSeenCursor(MATCH)).toBe(3);
    expect(screen.getByTestId("recap")).toHaveTextContent("");
  });

  it("a REPEATED reconnect does not replay an acknowledged recap", () => {
    writeSeenCursor(MATCH, 0);
    const history = [lot(0), lot(1), lot(2)];
    const first = render(<Probe history={history} />);
    expect(screen.getByTestId("recap")).toHaveTextContent("1,2");

    act(() => {
      screen.getByTestId("td-missed-dismiss").click();
    });
    first.unmount();

    const second = render(<Probe history={history} />);
    expect(screen.getByTestId("recap")).toHaveTextContent("");
    second.unmount();

    render(<Probe history={history} />);
    expect(screen.getByTestId("recap")).toHaveTextContent("");
  });

  /**
   * THE STICKINESS TEST. A played reveal must not silently jump the cursor past
   * an unacknowledged recap — that would mark lots as seen that nobody read —
   * and the recap must not block the queue from ever draining either. Both are
   * asserted in one sequence.
   */
  it("a reveal behind an outstanding recap plays without swallowing it", () => {
    vi.useFakeTimers();
    writeSeenCursor(MATCH, 0);
    const { rerender } = render(<Probe history={[lot(0), lot(1), lot(2)]} />);
    expect(screen.getByTestId("recap")).toHaveTextContent("1,2");

    rerender(<Probe history={[lot(0), lot(1), lot(2), lot(3)]} />);
    expect(screen.getByTestId("reveal")).toHaveTextContent("3");
    act(() => {
      vi.advanceTimersByTime(REVEAL_HOLD_MS + 50);
    });
    // Lot 3 has played and stopped being offered; lots 1-2 are still recapped.
    expect(screen.getByTestId("reveal")).toHaveTextContent("none");
    expect(screen.getByTestId("recap")).toHaveTextContent("1,2");
    expect(readSeenCursor(MATCH)).toBe(0);

    act(() => {
      screen.getByTestId("td-missed-dismiss").click();
    });
    // Dismissing flushes everything, including the lot that played behind it.
    expect(readSeenCursor(MATCH)).toBe(3);
  });

  it("shows no DUPLICATE recap when the same state arrives twice", () => {
    writeSeenCursor(MATCH, 0);
    const history = [lot(0), lot(1), lot(2)];
    const { rerender } = render(<Probe history={history} />);
    rerender(<Probe history={history} />);
    rerender(<Probe history={history} />);
    expect(screen.getAllByTestId("td-missed-lots")).toHaveLength(1);
  });

  it("is dismissible even when storage refuses to persist anything", async () => {
    const setItem = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error("quota");
    };
    try {
      writeSeenCursor(MATCH, 0);
      render(<Probe history={[lot(0), lot(1), lot(2)]} />);
      expect(screen.getByTestId("recap")).toHaveTextContent("1,2");
      await userEvent.click(screen.getByTestId("td-missed-dismiss"));
      // Before the in-memory fallback this click did nothing, forever.
      expect(screen.getByTestId("recap")).toHaveTextContent("");
    } finally {
      window.localStorage.setItem = setItem;
    }
  });
});

// ---------------------------------------------------------------------------
// Two tabs, and a completed match
// ---------------------------------------------------------------------------

describe("two tabs", () => {
  it("a second tab stops reporting lots the first tab acknowledged", () => {
    writeSeenCursor(MATCH, 0);
    render(<Probe history={[lot(0), lot(1), lot(2)]} />);
    expect(screen.getByTestId("recap")).toHaveTextContent("1,2");

    act(() => {
      writeSeenCursor(MATCH, 2);
      window.dispatchEvent(
        new StorageEvent("storage", { key: seenCursorKey(MATCH), newValue: "2" }),
      );
    });
    expect(screen.getByTestId("recap")).toHaveTextContent("");
  });

  it("ignores a storage event for a different match", () => {
    writeSeenCursor(MATCH, 0);
    render(<Probe history={[lot(0), lot(1), lot(2)]} />);
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: seenCursorKey("m-other"), newValue: "9" }),
      );
    });
    expect(screen.getByTestId("recap")).toHaveTextContent("1,2");
  });
});

describe("a completed match", () => {
  it("acknowledges everything, because the result screen shows it all anyway", () => {
    writeSeenCursor(MATCH, 0);
    render(<Probe history={[lot(0), lot(1), lot(2)]} phase="complete" />);
    expect(readSeenCursor(MATCH)).toBe(2);
    expect(screen.queryByTestId("td-missed-lots")).toBeNull();
  });
});

describe("clearSeenCursor", () => {
  it("forgets a match", () => {
    writeSeenCursor(MATCH, 5);
    clearSeenCursor(MATCH);
    expect(readSeenCursor(MATCH)).toBe(-1);
  });
});
