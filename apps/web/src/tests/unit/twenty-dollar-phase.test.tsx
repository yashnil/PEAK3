/**
 * The $20 Showdown's timing model (game-feel pass 2).
 *
 * WHAT CHANGED. The previous model held the human's controls shut for a 1.1s
 * "reveal" beat on every new lot and a 0.7s "handoff" beat after every
 * action, while the server's 25-second decision clock kept running. Measured
 * in play those two beats were most of the dead time between a bot's reply
 * and the player's next chance to act. They are gone: the phase is a pure
 * function of the server's view plus the one client truth that a command is
 * in flight.
 */
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";

import { useShowdownPhase, type ShowdownPhaseInput } from "@/components/twenty-dollar/useShowdownPhase";

function input(overrides: Partial<ShowdownPhaseInput> = {}): ShowdownPhaseInput {
  return {
    activeSeat: 0,
    yourSeat: 0,
    deadlineAt: 10_000,
    pending: false,
    complete: false,
    introOpen: false,
    ...overrides,
  };
}

describe("the phase is the server's view plus one client truth", () => {
  it("is `decide` with a live countdown and live controls on the human's own turn", () => {
    const { result } = renderHook(() => useShowdownPhase(input()));
    expect(result.current.phase).toBe("decide");
    expect(result.current.clockDeadlineAt).toBe(10_000);
    expect(result.current.controlsLive).toBe(true);
  });

  it("opens the controls the instant the turn is the human's — no reveal or handoff beat", () => {
    // A new lot, a fresh turn: nothing holds the controls shut.
    const { result, rerender } = renderHook((props: ShowdownPhaseInput) => useShowdownPhase(props), {
      initialProps: input({ activeSeat: 1 }),
    });
    expect(result.current.controlsLive).toBe(false);
    rerender(input({ activeSeat: 0, deadlineAt: 20_000 }));
    expect(result.current.phase).toBe("decide");
    expect(result.current.controlsLive).toBe(true);
    expect(result.current.clockDeadlineAt).toBe(20_000);
  });

  it("never opens the human's controls on the opponent's turn", () => {
    const { result } = renderHook(() => useShowdownPhase(input({ activeSeat: 1, deadlineAt: null })));
    expect(result.current.phase).toBe("decide");
    expect(result.current.controlsLive).toBe(false);
    expect(result.current.clockDeadlineAt).toBeNull();
  });

  it("reports `settling` when no seat is active", () => {
    const { result } = renderHook(() => useShowdownPhase(input({ activeSeat: null, deadlineAt: null })));
    expect(result.current.phase).toBe("settling");
    expect(result.current.controlsLive).toBe(false);
  });
});

describe("a submitted action freezes the countdown", () => {
  it("hands the clock a null deadline for as long as a command is in flight", () => {
    const { result, rerender } = renderHook((props: ShowdownPhaseInput) => useShowdownPhase(props), {
      initialProps: input(),
    });
    rerender(input({ pending: true }));
    expect(result.current.phase).toBe("pending");
    expect(result.current.clockDeadlineAt).toBeNull();
    expect(result.current.controlsLive).toBe(false);
  });

  it("resumes counting to the SAME deadline once the command settles unaccepted", () => {
    const { result, rerender } = renderHook((props: ShowdownPhaseInput) => useShowdownPhase(props), {
      initialProps: input({ pending: true }),
    });
    rerender(input({ pending: false }));
    expect(result.current.phase).toBe("decide");
    expect(result.current.clockDeadlineAt).toBe(10_000);
  });
});

describe("the pre-match intro", () => {
  it("holds the clock closed for as long as the server says the intro is open", () => {
    const { result } = renderHook(() => useShowdownPhase(input({ introOpen: true, activeSeat: null, deadlineAt: 5_000 })));
    expect(result.current.phase).toBe("intro");
    expect(result.current.clockDeadlineAt).toBeNull();
    expect(result.current.controlsLive).toBe(false);
  });

  it("outranks pending: no auction command exists while the intro is open", () => {
    const { result } = renderHook(() => useShowdownPhase(input({ introOpen: true, pending: true })));
    expect(result.current.phase).toBe("intro");
  });

  it("does not open on a completed match", () => {
    const { result } = renderHook(() => useShowdownPhase(input({ complete: true, introOpen: true })));
    expect(result.current.phase).toBe("complete");
  });
});
