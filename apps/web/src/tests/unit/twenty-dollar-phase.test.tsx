/**
 * The Showdown's competitive timing model (SHARED-01, S20-01/02/08/09).
 *
 * WHAT THESE TESTS PIN, and why each one is a defect rather than a preference:
 *
 *   * S20-08. `submit()` used to set `busy` and never touch `deadlineAt`, and
 *     `ArenaTimer` keys only on `[deadlineAt]`. A bid sent inside the server's
 *     two-second grace window is DESIGNED to be accepted
 *     (`test_arena_action_races.py` asserts acceptance up to 1900 ms late) and
 *     the UI painted "Time expired" over it. The clock must be null while a
 *     command is in flight.
 *   * S20-02. A reveal beat must exist, and it must never be paid for out of
 *     the human's decision window below `MIN_DECISION_SECONDS`. A client cannot
 *     pause the server's clock; the only honest guarantee is a floor, so the
 *     floor is tested directly.
 *   * S20-01. The intro happens once, on a fresh match, and never on a resume.
 *   * S20-09. An action inside a lot produces a handoff beat.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import {
  affordableBeat,
  HANDOFF_MS,
  INTRO_MS,
  MIN_DECISION_SECONDS,
  REVEAL_MS,
  useShowdownPhase,
  type ShowdownPhaseInput,
} from "@/components/twenty-dollar/useShowdownPhase";

function input(overrides: Partial<ShowdownPhaseInput> = {}): ShowdownPhaseInput {
  return {
    lotIndex: 0,
    activeSeat: 0,
    yourSeat: 0,
    actionCount: 0,
    historyLength: 0,
    secondsRemaining: 25,
    deadlineAt: 1_000,
    pending: false,
    complete: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// The budget, which is the whole honesty of the design
// ---------------------------------------------------------------------------

describe("a beat is never paid for out of the decision window", () => {
  it("runs in full when the clock is not the human's", () => {
    // The bot's turn, a settling lot, a turn that has not opened: free.
    expect(affordableBeat(INTRO_MS, 25, false)).toBe(INTRO_MS);
    expect(affordableBeat(INTRO_MS, 3, false)).toBe(INTRO_MS);
    expect(affordableBeat(REVEAL_MS, null, true)).toBe(REVEAL_MS);
  });

  it("runs in full on a fresh human turn, which has headroom above the floor", () => {
    // TURN_SECONDS is 25 and the floor is 18, so there are 7 seconds spare.
    expect(affordableBeat(REVEAL_MS, 25, true)).toBe(REVEAL_MS);
    expect(affordableBeat(INTRO_MS, 25, true)).toBe(INTRO_MS);
  });

  it("is TRUNCATED rather than skipped when the headroom is small", () => {
    expect(affordableBeat(REVEAL_MS, MIN_DECISION_SECONDS + 0.5, true)).toBe(500);
  });

  it("is skipped outright at the floor, and below it", () => {
    expect(affordableBeat(REVEAL_MS, MIN_DECISION_SECONDS, true)).toBe(0);
    expect(affordableBeat(REVEAL_MS, 4, true)).toBe(0);
    expect(affordableBeat(INTRO_MS, 0, true)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// S20-08 — the click freezes the clock
// ---------------------------------------------------------------------------

describe("a submitted action freezes the countdown", () => {
  it("hands the timer a null deadline for as long as a command is in flight", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      (props: ShowdownPhaseInput) => useShowdownPhase(props),
      { initialProps: input({ historyLength: 3, lotIndex: 3 }) },
    );
    // Not a fresh match, so no intro: the human is on the clock.
    expect(result.current.phase).toBe("decide");
    expect(result.current.clockDeadlineAt).toBe(1_000);

    rerender(input({ historyLength: 3, lotIndex: 3, pending: true }));
    expect(result.current.phase).toBe("pending");
    // THE DEFECT: this used to stay at 1_000 and keep counting down behind the
    // request, then fire `onExpire` against a bid the server was accepting.
    expect(result.current.clockDeadlineAt).toBeNull();
    expect(result.current.controlsLive).toBe(false);
  });

  it("pending outranks a handoff beat, because our own request is the newer truth", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      (props: ShowdownPhaseInput) => useShowdownPhase(props),
      { initialProps: input({ historyLength: 2, lotIndex: 2 }) },
    );
    rerender(input({ historyLength: 2, lotIndex: 2, actionCount: 1, pending: true }));
    expect(result.current.phase).toBe("pending");
  });

  it("resumes counting to the SAME deadline once the command settles", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      (props: ShowdownPhaseInput) => useShowdownPhase(props),
      { initialProps: input({ historyLength: 2, lotIndex: 2, pending: true }) },
    );
    expect(result.current.clockDeadlineAt).toBeNull();
    // A rejected command returns the same board: the deadline is unchanged and
    // the true remaining time is what reappears.
    rerender(input({ historyLength: 2, lotIndex: 2, pending: false }));
    expect(result.current.clockDeadlineAt).toBe(1_000);
  });
});

// ---------------------------------------------------------------------------
// S20-01 — the intro
// ---------------------------------------------------------------------------

describe("the pre-match intro", () => {
  it("opens on a fresh match and holds the clock closed", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useShowdownPhase(input()));
    expect(result.current.phase).toBe("intro");
    expect(result.current.clockDeadlineAt).toBeNull();
    expect(result.current.controlsLive).toBe(false);
  });

  it("clears itself after its beat, and the clock opens", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useShowdownPhase(input()));
    act(() => {
      vi.advanceTimersByTime(INTRO_MS + 50);
    });
    expect(result.current.phase).toBe("decide");
    expect(result.current.clockDeadlineAt).toBe(1_000);
    expect(result.current.controlsLive).toBe(true);
  });

  it("can be dismissed early by the player", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useShowdownPhase(input()));
    act(() => {
      result.current.dismissIntro();
    });
    expect(result.current.phase).toBe("decide");
  });

  it("does NOT replay on a resume three lots in", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useShowdownPhase(input({ historyLength: 3, lotIndex: 3 })),
    );
    // Replaying it would be spending the player's clock to tell them something
    // they already know.
    expect(result.current.phase).toBe("decide");
  });

  it("does not open on a completed match", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useShowdownPhase(input({ complete: true, activeSeat: null })),
    );
    expect(result.current.phase).toBe("complete");
  });
});

// ---------------------------------------------------------------------------
// S20-02 / S20-09 — the reveal beat and the handoff
// ---------------------------------------------------------------------------

describe("a new lot gets a readable beat before the decision opens", () => {
  it("enters `reveal` when the lot index advances, with no clock running", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      (props: ShowdownPhaseInput) => useShowdownPhase(props),
      { initialProps: input({ historyLength: 2, lotIndex: 2 }) },
    );
    expect(result.current.phase).toBe("decide");

    rerender(input({ historyLength: 3, lotIndex: 3 }));
    expect(result.current.phase).toBe("reveal");
    expect(result.current.clockDeadlineAt).toBeNull();
    expect(result.current.controlsLive).toBe(false);

    act(() => {
      vi.advanceTimersByTime(REVEAL_MS + 50);
    });
    expect(result.current.phase).toBe("decide");
    expect(result.current.controlsLive).toBe(true);
  });

  it("SKIPS the beat rather than eating a short decision window", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      (props: ShowdownPhaseInput) => useShowdownPhase(props),
      { initialProps: input({ historyLength: 2, lotIndex: 2, secondsRemaining: 12 }) },
    );
    rerender(input({ historyLength: 3, lotIndex: 3, secondsRemaining: 12 }));
    act(() => {
      // The effect that measures affordability runs and finds nothing to spend.
      vi.advanceTimersByTime(0);
    });
    expect(result.current.phase).toBe("decide");
  });

  it("holds between actions inside one lot, then hands over (S20-09)", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      (props: ShowdownPhaseInput) => useShowdownPhase(props),
      { initialProps: input({ historyLength: 1, lotIndex: 1, actionCount: 0 }) },
    );
    // The bot raised: one more action on the same lot.
    rerender(input({ historyLength: 1, lotIndex: 1, actionCount: 1 }));
    expect(result.current.phase).toBe("handoff");

    act(() => {
      vi.advanceTimersByTime(HANDOFF_MS + 50);
    });
    expect(result.current.phase).toBe("decide");
  });
});

// ---------------------------------------------------------------------------
// The remaining phases
// ---------------------------------------------------------------------------

describe("the phases that are not a decision", () => {
  it("reports `settling` when no seat is active", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useShowdownPhase(input({ historyLength: 2, lotIndex: 2, activeSeat: null })),
    );
    expect(result.current.phase).toBe("settling");
    expect(result.current.clockDeadlineAt).toBeNull();
  });

  it("never opens the human's controls on the opponent's turn", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useShowdownPhase(input({ historyLength: 2, lotIndex: 2, activeSeat: 1 })),
    );
    expect(result.current.phase).toBe("decide");
    expect(result.current.controlsLive).toBe(false);
  });
});
