/**
 * "While you were away", across a real reload.
 *
 * THE DEFECT UNDER TEST. `useLotVisibility` baselined itself at
 * `history.length` on first render, so a reload started a fresh slate and
 * reported no gap. That was right for bursts WITHIN a session — several lots
 * really do settle between two polls, because `_advance_lot` resolves unsold
 * lots recursively and `drive_pending_bots` runs up to twelve bot turns inside
 * one request — and wrong for the case the feature is named after: closing a
 * tab, coming back, and finding players on a roster you never saw bought.
 *
 * The cursor is the highest `lot_index` this browser has displayed, persisted
 * per match id. `lot_index` is server-assigned, monotonic and already on every
 * history row, so "what have I seen" is one integer derived from state the
 * server publishes — no migration, no second record of the match, and nothing
 * that can disagree with the authoritative history.
 *
 * A REMOUNT IS A RELOAD, for this hook. Everything it reads on mount comes from
 * localStorage and from props; there is no module-level state and no ref that
 * outlives an unmount. So `unmount()` then `render()` exercises exactly the
 * path a browser reload takes.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MissedLotsSummary, useLotVisibility } from "@/components/twenty-dollar/LotLedger";
import {
  clearSeenCursor,
  partitionUnseen,
  readSeenCursor,
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

/** A probe that renders whatever the hook decides, so a test can read it. */
function Probe({ history, phase = "auction" as const }: {
  history: ResolvedLot[];
  phase?: "auction" | "complete";
}) {
  const { missed, reveal, acknowledge } = useLotVisibility(MATCH, state(history, { phase }));
  return (
    <div>
      <span data-testid="missed">{missed.map((l) => l.lot_index).join(",")}</span>
      <span data-testid="reveal">{reveal ? reveal.lot_index : "none"}</span>
      <button type="button" data-testid="ack" onClick={acknowledge}>
        ack
      </button>
      <MissedLotsSummary
        lots={missed}
        seatNames={["You", "Floor General"]}
        yourSeat={0}
        onDismiss={acknowledge}
      />
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
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

  it("survives storage being unavailable rather than throwing", () => {
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error("quota");
    };
    expect(() => writeSeenCursor(MATCH, 3)).not.toThrow();
    window.localStorage.setItem = original;
  });

  it("preserves ordering regardless of the input array's order", () => {
    const unsorted = [lot(5), lot(2), lot(9)];
    expect(partitionUnseen(unsorted, 1).map((l) => l.lot_index)).toEqual([2, 5, 9]);
  });
});

// ---------------------------------------------------------------------------
// Reload
// ---------------------------------------------------------------------------

describe("reload", () => {
  it("reports ONE missed lot after a reload", () => {
    writeSeenCursor(MATCH, 2);
    render(<Probe history={[lot(0), lot(1), lot(2), lot(3)]} />);
    // One unseen lot is a reveal, not a gap -- the same treatment it would get
    // if the player had been watching.
    expect(screen.getByTestId("reveal")).toHaveTextContent("3");
    expect(screen.getByTestId("missed")).toHaveTextContent("");
  });

  it("reports SEVERAL missed lots after a reload, in order", () => {
    writeSeenCursor(MATCH, 1);
    render(<Probe history={[lot(0), lot(1), lot(2), lot(3), lot(4)]} />);
    expect(screen.getByTestId("missed")).toHaveTextContent("2,3,4");
    expect(screen.getByTestId("reveal")).toHaveTextContent("none");
    expect(screen.getByTestId("td-missed-lots")).toHaveAttribute("data-count", "3");
  });

  it("omits nothing: every settled lot past the cursor is listed", () => {
    writeSeenCursor(MATCH, -1);
    const history = [lot(0), lot(1), lot(2), lot(3)];
    render(<Probe history={history} />);
    for (const index of [0, 1, 2, 3]) {
      expect(screen.getByTestId(`td-missed-${index}`)).toBeInTheDocument();
    }
  });

  it("reports nothing after a reload that missed nothing", () => {
    writeSeenCursor(MATCH, 3);
    render(<Probe history={[lot(0), lot(1), lot(2), lot(3)]} />);
    expect(screen.getByTestId("missed")).toHaveTextContent("");
    expect(screen.getByTestId("reveal")).toHaveTextContent("none");
  });

  it("reports nothing during a live auction with no settled lots", () => {
    render(<Probe history={[]} />);
    expect(screen.getByTestId("missed")).toHaveTextContent("");
    expect(screen.getByTestId("reveal")).toHaveTextContent("none");
  });

  it("keeps reporting a live auction's own gap while the auction continues", () => {
    // A reload mid-lot: three lots settled while away, and the current lot is
    // still live (`active_seat` set, no new history row).
    writeSeenCursor(MATCH, 0);
    render(<Probe history={[lot(0), lot(1), lot(2), lot(3)]} />);
    expect(screen.getByTestId("missed")).toHaveTextContent("1,2,3");
  });
});

// ---------------------------------------------------------------------------
// Acknowledgement, and not replaying it
// ---------------------------------------------------------------------------

describe("acknowledgement", () => {
  it("dismissing the summary advances the cursor past every missed lot", async () => {
    writeSeenCursor(MATCH, 0);
    render(<Probe history={[lot(0), lot(1), lot(2), lot(3)]} />);
    await userEvent.click(screen.getByTestId("td-missed-dismiss"));
    expect(readSeenCursor(MATCH)).toBe(3);
    expect(screen.getByTestId("missed")).toHaveTextContent("");
  });

  it("a REPEATED reconnect does not replay an acknowledged summary", () => {
    writeSeenCursor(MATCH, 0);
    const history = [lot(0), lot(1), lot(2)];
    const first = render(<Probe history={history} />);
    expect(screen.getByTestId("missed")).toHaveTextContent("1,2");

    act(() => {
      screen.getByTestId("ack").click();
    });
    first.unmount();

    // Reload one.
    const second = render(<Probe history={history} />);
    expect(screen.getByTestId("missed")).toHaveTextContent("");
    second.unmount();

    // Reload two. Still nothing -- the cursor is not a session value.
    render(<Probe history={history} />);
    expect(screen.getByTestId("missed")).toHaveTextContent("");
  });

  it("shows no DUPLICATE summary when the same state arrives twice", () => {
    writeSeenCursor(MATCH, 0);
    const history = [lot(0), lot(1), lot(2)];
    const { rerender } = render(<Probe history={history} />);
    rerender(<Probe history={history} />);
    rerender(<Probe history={history} />);
    expect(screen.getAllByTestId("td-missed-lots")).toHaveLength(1);
  });

  it("a single reveal acknowledges itself after its hold", () => {
    vi.useFakeTimers();
    writeSeenCursor(MATCH, 1);
    render(<Probe history={[lot(0), lot(1), lot(2)]} />);
    expect(screen.getByTestId("reveal")).toHaveTextContent("2");
    expect(readSeenCursor(MATCH)).toBe(1);

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    // It was on screen; it counts as seen. A reload now reports no gap.
    expect(readSeenCursor(MATCH)).toBe(2);
  });

  it("a GAP does not acknowledge itself", () => {
    vi.useFakeTimers();
    writeSeenCursor(MATCH, 0);
    render(<Probe history={[lot(0), lot(1), lot(2), lot(3)]} />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    // Auto-advancing here would be the original defect wearing a cursor: the
    // lots would be marked shown without anybody having read them.
    expect(readSeenCursor(MATCH)).toBe(0);
    expect(screen.getByTestId("missed")).toHaveTextContent("1,2,3");
  });
});

// ---------------------------------------------------------------------------
// Two tabs, and a completed match
// ---------------------------------------------------------------------------

describe("two tabs", () => {
  it("a second tab stops reporting lots the first tab acknowledged", () => {
    writeSeenCursor(MATCH, 0);
    const history = [lot(0), lot(1), lot(2)];
    render(<Probe history={history} />);
    expect(screen.getByTestId("missed")).toHaveTextContent("1,2");

    // The other tab acknowledges. `storage` fires only in THIS tab, which is
    // the direction that needs it.
    act(() => {
      writeSeenCursor(MATCH, 2);
      window.dispatchEvent(
        new StorageEvent("storage", { key: seenCursorKey(MATCH), newValue: "2" }),
      );
    });
    expect(screen.getByTestId("missed")).toHaveTextContent("");
  });

  it("ignores a storage event for a different match", () => {
    writeSeenCursor(MATCH, 0);
    render(<Probe history={[lot(0), lot(1), lot(2)]} />);
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: seenCursorKey("m-other"), newValue: "9" }),
      );
    });
    expect(screen.getByTestId("missed")).toHaveTextContent("1,2");
  });
});

describe("a completed match", () => {
  it("acknowledges everything, because the result screen shows it all anyway", () => {
    writeSeenCursor(MATCH, 0);
    render(<Probe history={[lot(0), lot(1), lot(2)]} phase="complete" />);
    expect(readSeenCursor(MATCH)).toBe(2);
  });
});

describe("clearSeenCursor", () => {
  it("forgets a match", () => {
    writeSeenCursor(MATCH, 5);
    clearSeenCursor(MATCH);
    expect(readSeenCursor(MATCH)).toBe(-1);
  });
});
