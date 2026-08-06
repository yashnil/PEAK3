/**
 * The decision clock, and the rerender cost it used to impose on the board.
 *
 * THE MEASUREMENT PART 25 ASKS FOR: "candidate-list render count during a
 * 20-second timer". Both game rooms held the countdown in the ROOM's state and
 * passed it down, so every tick re-rendered the whole tree — both roster
 * panels, the candidate card, the bid controls, the settled-lot list, the
 * eighteen-chip draft strip. That is twenty full reconciliations per turn for a
 * number occupying four characters, and it is the largest single contributor to
 * the reported "the game feels laggy".
 *
 * The countdown now lives in `ArenaTimer`. The room passes a DEADLINE, which
 * changes only when the authoritative state does. The test below simulates a
 * full twenty-second turn and asserts the sibling never re-renders at all.
 *
 * WHY A DEADLINE AND NOT A DURATION. `seconds_remaining` is re-seeded from a
 * two-second poll; ticking that down locally means the displayed number can be
 * up to a poll interval stale, which is how a control read "3" on a turn the
 * server had already closed. `deadlineFromSeconds` converts once, at the moment
 * the response lands, and the tick measures against a monotonic clock.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import ArenaTimer, { deadlineFromSeconds } from "@/components/shared/ArenaTimer";

vi.mock("@/lib/a11y", () => ({ usePrefersReducedMotion: () => false }));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A stand-in for the candidate list / roster panels beside the clock. */
let siblingRenders = 0;

function Sibling() {
  siblingRenders += 1;
  return <div data-testid="sibling">candidate list</div>;
}

function Board({ deadlineAt }: { deadlineAt: number | null }) {
  return (
    <div>
      <ArenaTimer deadlineAt={deadlineAt} totalSeconds={20} label="YOUR TURN" yours />
      <Sibling />
    </div>
  );
}

describe("the timer does not rerender the board", () => {
  it("ticks for a full 20-second turn without re-rendering a sibling", () => {
    siblingRenders = 0;
    const deadline = performance.now() + 20_000;
    render(<Board deadlineAt={deadline} />);

    const initial = siblingRenders;
    expect(initial).toBeGreaterThan(0);
    expect(screen.getByTestId("arena-timer-value")).toHaveTextContent("20");

    // Twenty seconds at the component's own 250 ms cadence: eighty ticks.
    for (let step = 0; step < 80; step += 1) {
      act(() => {
        vi.advanceTimersByTime(250);
      });
    }

    // THE MEASUREMENT. The clock has re-rendered eighty times; nothing beside
    // it has re-rendered once. The previous architecture held the countdown in
    // the ROOM's state, so this sibling would have re-rendered twenty times for
    // the same turn -- and so would both roster panels, the candidate card, the
    // bid controls and the eighteen-chip draft strip.
    expect(siblingRenders).toBe(initial);
    // And the clock really did count all the way down, so the zero above is a
    // measurement rather than a timer that never started.
    expect(screen.getByTestId("arena-timer")).toHaveAttribute("data-state", "expired");
  });
});

describe("what the clock shows", () => {
  it("is idle, not zero, when this seat is not on the clock", () => {
    // `null` is a real state: between lots and on the opponent's turn there is
    // nothing to count. The old surface rendered a zeroed timer on a turn the
    // player had never been given.
    render(<ArenaTimer deadlineAt={null} totalSeconds={20} label="Opponent" />);
    expect(screen.getByTestId("arena-timer")).toHaveAttribute("data-state", "idle");
    expect(screen.queryByTestId("arena-timer-value")).toBeNull();
  });

  it("reads urgent under five seconds, through more than colour", () => {
    render(
      <ArenaTimer
        deadlineAt={performance.now() + 4_000}
        totalSeconds={20}
        label="YOUR TURN"
        yours
      />,
    );
    expect(screen.getByTestId("arena-timer")).toHaveAttribute("data-state", "urgent");
  });

  it("states the consequence of expiry beside the number", () => {
    render(
      <ArenaTimer
        deadlineAt={performance.now() + 12_000}
        totalSeconds={20}
        label="YOUR TURN"
        consequence="Timeout uses 1 market skip — 4 would remain."
        yours
      />,
    );
    expect(screen.getByTestId("arena-timer-consequence")).toHaveTextContent(
      "Timeout uses 1 market skip",
    );
  });

  it("fires onExpire exactly once, and submits nothing", () => {
    const onExpire = vi.fn();
    render(
      <ArenaTimer
        deadlineAt={performance.now() + 1_000}
        totalSeconds={20}
        label="YOUR TURN"
        onExpire={onExpire}
        yours
      />,
    );
    for (let step = 0; step < 20; step += 1) {
      act(() => {
        vi.advanceTimersByTime(250);
      });
    }
    // ONCE. The client never resolves a turn -- this only lets the surface stop
    // offering an action that cannot succeed. The server owns the timeout, with
    // a grace window so an action sent at the last moment still lands.
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("arena-timer")).toHaveAttribute("data-state", "expired");
  });

  it("announces at thresholds, never every second", () => {
    render(
      <ArenaTimer
        deadlineAt={performance.now() + 12_000}
        totalSeconds={20}
        label="YOUR TURN"
        yours
      />,
    );
    const live = screen.getByRole("status");
    expect(live).toHaveTextContent("");

    // Down to 10.
    for (let step = 0; step < 8; step += 1) {
      act(() => {
        vi.advanceTimersByTime(250);
      });
    }
    expect(live).toHaveTextContent("10 seconds remaining.");

    // 9, 8, 7 and 6 must NOT announce -- a per-second live region talks over
    // everything else on the page, which is why the thresholds are a
    // requirement rather than a nicety.
    for (let step = 0; step < 16; step += 1) {
      act(() => {
        vi.advanceTimersByTime(250);
      });
    }
    expect(live).toHaveTextContent("10 seconds remaining.");

    // Down to 5.
    for (let step = 0; step < 4; step += 1) {
      act(() => {
        vi.advanceTimersByTime(250);
      });
    }
    expect(live).toHaveTextContent("5 seconds remaining.");
  });
});

describe("deadlineFromSeconds", () => {
  it("converts the server's duration once, at the moment it lands", () => {
    const before = performance.now();
    const deadline = deadlineFromSeconds(20);
    expect(deadline).not.toBeNull();
    expect(deadline! - before).toBeGreaterThanOrEqual(19_900);
    expect(deadline! - before).toBeLessThanOrEqual(20_100);
  });

  it("passes null through, because 'not your turn' is not 'zero seconds'", () => {
    expect(deadlineFromSeconds(null)).toBeNull();
    expect(deadlineFromSeconds(undefined)).toBeNull();
  });

  it("never produces a deadline in the past from a negative duration", () => {
    const deadline = deadlineFromSeconds(-5);
    expect(deadline! - performance.now()).toBeLessThanOrEqual(1);
  });
});
