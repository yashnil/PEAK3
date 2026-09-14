/**
 * The shared game-feel primitives (`components/game-feel`, `lib/game-feel`).
 *
 * WHAT IS ASSERTED IS THE INTERACTION CONTRACT, not rendering: one press is
 * one action and a second press while pending is refused; a newer version
 * always wins and an older never does; queued commands run in order and a
 * coalesced channel keeps only its latest intent; every seat's clock is the
 * same mechanism; a number moves to the server's value and nowhere else.
 */
import React, { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { isNewer, useCommandLane } from "@/lib/game-feel/authoritative";
import { useArrivals } from "@/lib/game-feel/arrivals";
import {
  ActiveSeat,
  EventMoment,
  GameActionButton,
  RoundReveal,
  ScoreTransition,
  TurnClock,
} from "@/components/game-feel";

function mockMatchMedia(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? reduced : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("isNewer — the one rule for replacing what is on screen", () => {
  it("applies a strictly newer version and refuses an older one", () => {
    expect(isNewer({ version: 4 }, { version: 5 })).toBe(true);
    expect(isNewer({ version: 5 }, { version: 4 })).toBe(false);
    expect(isNewer({ version: 5 }, { version: 5 })).toBe(false);
  });

  it("allows the same version only when the phase genuinely moved", () => {
    expect(isNewer({ version: 5, phase: "reveal" }, { version: 5, phase: "pick" })).toBe(true);
    expect(isNewer({ version: 5, phase: "pick" }, { version: 5, phase: "pick" })).toBe(false);
  });
});

describe("useCommandLane — serialized, de-duplicated, coalesced", () => {
  it("refuses a second exclusive command while one is pending, and runs it once", async () => {
    const { result } = renderHook(() => useCommandLane());
    const first = deferred<string>();
    const fn = vi.fn(() => first.promise);

    let p1!: Promise<string | null>;
    let p2!: Promise<string | null>;
    act(() => {
      p1 = result.current.run("pick", fn);
      p2 = result.current.run("pick", fn);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current.pendingNow()).toBe("pick");
    await expect(p2).resolves.toBeNull();

    await act(async () => {
      first.resolve("accepted");
      await p1;
    });
    await expect(p1).resolves.toBe("accepted");
    expect(result.current.pendingNow()).toBeNull();
  });

  it("queues a pick BEHIND an in-flight stage instead of dropping it, and runs it against the later state", async () => {
    const { result } = renderHook(() => useCommandLane());
    const stage = deferred<void>();
    const order: string[] = [];
    let version = 4;

    let pickPromise!: Promise<number | null>;
    act(() => {
      void result.current.run(
        "stage",
        async () => {
          await stage.promise;
          version = 5; // the stage response bumped the version
          order.push("stage");
        },
        { exclusive: false, coalesce: "stage" },
      );
      // The "Draft" press lands while the stage is still in flight.
      pickPromise = result.current.run("pick", async () => {
        order.push(`pick@v${version}`);
        return version;
      });
    });
    // Not dropped, not run yet either: it is waiting its turn.
    expect(order).toEqual([]);
    expect(result.current.pendingNow()).toBe("pick");

    await act(async () => {
      stage.resolve();
      await pickPromise;
    });
    expect(order).toEqual(["stage", "pick@v5"]);
    await expect(pickPromise).resolves.toBe(5);
  });

  it("keeps only the LATEST queued intent on a coalescing channel", async () => {
    const { result } = renderHook(() => useCommandLane());
    const gate = deferred<void>();
    const ran: string[] = [];
    const promises: Promise<string | null>[] = [];
    act(() => {
      promises.push(
        result.current.run("stage", async () => { await gate.promise; ran.push("a"); return "a"; }, { exclusive: false, coalesce: "stage" }),
      );
      promises.push(
        result.current.run("stage", async () => { ran.push("b"); return "b"; }, { exclusive: false, coalesce: "stage" }),
      );
      promises.push(
        result.current.run("stage", async () => { ran.push("c"); return "c"; }, { exclusive: false, coalesce: "stage" }),
      );
    });
    await act(async () => {
      gate.resolve();
      await Promise.all(promises);
    });
    // "a" was already executing; "b" was superseded by "c" before it started.
    expect(ran).toEqual(["a", "c"]);
    await expect(promises[1]).resolves.toBeNull();
    await expect(promises[2]).resolves.toBe("c");
  });

  it("cancel drops a QUEUED intent on its channel but never one already sent", async () => {
    const { result } = renderHook(() => useCommandLane());
    const gate = deferred<void>();
    const ran: string[] = [];
    let executing!: Promise<string | null>;
    let queued!: Promise<string | null>;
    act(() => {
      executing = result.current.run("stage", async () => { await gate.promise; ran.push("sent"); return "sent"; }, { exclusive: false, coalesce: "stage" });
      queued = result.current.run("stage", async () => { ran.push("queued"); return "queued"; }, { exclusive: false, coalesce: "stage" });
    });
    let dropped = 0;
    act(() => {
      dropped = result.current.cancel("stage");
    });
    expect(dropped).toBe(1);
    await expect(queued).resolves.toBeNull();
    await act(async () => {
      gate.resolve();
      await executing;
    });
    expect(ran).toEqual(["sent"]);
    expect(result.current.busyNow()).toBe(false);
    expect(result.current.cancel("stage")).toBe(0);
  });

  it("reports busy synchronously while anything is executing or queued", async () => {
    const { result } = renderHook(() => useCommandLane());
    const gate = deferred<void>();
    let p!: Promise<void | null>;
    act(() => {
      p = result.current.run("stage", () => gate.promise, { exclusive: false });
    });
    expect(result.current.busyNow()).toBe(true);
    await act(async () => {
      gate.resolve();
      await p;
    });
    expect(result.current.busyNow()).toBe(false);
  });
});

describe("GameActionButton — one press, one action", () => {
  beforeEach(() => mockMatchMedia(false));

  it("runs the action exactly once for a double click, shows pending, then confirms", async () => {
    const gate = deferred<boolean>();
    const onAction = vi.fn(() => gate.promise);
    render(
      <GameActionButton onAction={onAction} pendingLabel="Drafting…" data-testid="btn">
        Draft
      </GameActionButton>,
    );
    const button = screen.getByTestId("btn");
    await userEvent.dblClick(button);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute("data-state", "pending");
    expect(button).toHaveTextContent("Drafting…");
    expect(button).toBeDisabled();

    await act(async () => {
      gate.resolve(true);
      await gate.promise;
    });
    await waitFor(() => expect(button).toHaveAttribute("data-state", "confirmed"));
    expect(button).toHaveTextContent("Draft");
  });

  it("acknowledges the pointer on press, before any request", async () => {
    const onAction = vi.fn(() => new Promise<boolean>(() => {}));
    render(
      <GameActionButton onAction={onAction} data-testid="btn">
        Go
      </GameActionButton>,
    );
    const button = screen.getByTestId("btn");
    await userEvent.pointer({ keys: "[MouseLeft>]", target: button });
    expect(button).toHaveAttribute("data-state", "pressed");
  });

  it("reads a rejected action as an error state and becomes pressable again", async () => {
    const onAction = vi.fn(async () => false);
    render(
      <GameActionButton onAction={onAction} data-testid="btn" confirmMs={10}>
        Go
      </GameActionButton>,
    );
    const button = screen.getByTestId("btn");
    await userEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute("data-state", "error"));
    await waitFor(() => expect(button).toHaveAttribute("data-state", "idle"), { timeout: 1500 });
    expect(button).not.toBeDisabled();
  });

  it("honours an external pending state from the command lane", () => {
    render(
      <GameActionButton onAction={() => {}} pending pendingLabel="Working…" data-testid="btn">
        Go
      </GameActionButton>,
    );
    expect(screen.getByTestId("btn")).toHaveAttribute("data-state", "pending");
    expect(screen.getByTestId("btn")).toHaveTextContent("Working…");
  });
});

describe("TurnClock — the same clock for every owner", () => {
  beforeEach(() => {
    mockMatchMedia(false);
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("counts down a bot's turn with the same number and bar a human gets", () => {
    const deadline = performance.now() + 30_000;
    render(<TurnClock deadlineAt={deadline} totalSeconds={45} owner="bot" testId="clock" />);
    const clock = screen.getByTestId("clock");
    expect(clock).toHaveAttribute("data-owner", "bot");
    expect(clock).toHaveAttribute("data-state", "running");
    expect(screen.getByTestId("clock-value")).toHaveTextContent("30");
    expect(screen.getByTestId("clock-label")).toHaveTextContent("Thinking");
    const fraction = Number(clock.style.getPropertyValue("--gf-clock-fraction"));
    expect(fraction).toBeGreaterThan(0.6);
    expect(fraction).toBeLessThan(0.7);
  });

  it("turns urgent under the warning threshold and expires at zero without deciding anything", () => {
    const deadline = performance.now() + 4_000;
    render(<TurnClock deadlineAt={deadline} totalSeconds={45} owner="you" testId="clock" />);
    expect(screen.getByTestId("clock")).toHaveAttribute("data-state", "warning");
    act(() => {
      vi.advanceTimersByTime(4_500);
    });
    expect(screen.getByTestId("clock")).toHaveAttribute("data-state", "expired");
    expect(screen.getByTestId("clock-value")).toHaveTextContent("0");
  });

  it("is idle, not zero, when there is no deadline", () => {
    render(<TurnClock deadlineAt={null} totalSeconds={45} owner="none" testId="clock" />);
    expect(screen.getByTestId("clock")).toHaveAttribute("data-state", "idle");
  });
});

describe("RoundReveal / EventMoment / ActiveSeat — state carried in attributes", () => {
  beforeEach(() => mockMatchMedia(false));

  it("RoundReveal renders the round and its detail, and nothing when closed", () => {
    const { rerender } = render(<RoundReveal open title="Round 4" detail="of 6" testId="rr" />);
    expect(screen.getByTestId("rr")).toHaveTextContent("Round 4");
    expect(screen.getByTestId("rr")).toHaveTextContent("of 6");
    rerender(<RoundReveal open={false} title="Round 4" testId="rr" />);
    expect(screen.queryByTestId("rr")).toBeNull();
  });

  it("EventMoment shows a moment, dismisses itself, and restarts on a new id", async () => {
    vi.useFakeTimers();
    try {
      const onDone = vi.fn();
      const { rerender } = render(
        <EventMoment moment={{ id: "a", kind: "swap", title: "A ↔ B", detail: "Swapped" }} durationMs={500} onDone={onDone} testId="m" />,
      );
      expect(screen.getByTestId("m")).toHaveAttribute("data-kind", "swap");
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(screen.queryByTestId("m")).toBeNull();
      expect(onDone).toHaveBeenCalledWith("a");
      rerender(<EventMoment moment={{ id: "b", kind: "pick", title: "X → SG" }} durationMs={500} onDone={onDone} testId="m" />);
      expect(screen.getByTestId("m")).toHaveTextContent("X → SG");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ActiveSeat exposes state, owner and completion as data attributes", () => {
    render(
      <ActiveSeat state="active" owner="bot" complete testId="seat">
        <span>court</span>
      </ActiveSeat>,
    );
    const seat = screen.getByTestId("seat");
    expect(seat).toHaveAttribute("data-gf-seat", "active");
    expect(seat).toHaveAttribute("data-gf-owner", "bot");
    expect(seat).toHaveAttribute("data-gf-complete", "true");
  });
});

describe("ScoreTransition — deterministic number movement", () => {
  it("shows the value immediately under reduced motion", () => {
    mockMatchMedia(true);
    const { rerender } = render(<ScoreTransition value={40} testId="s" />);
    expect(screen.getByTestId("s")).toHaveTextContent("40");
    rerender(<ScoreTransition value={55} testId="s" />);
    expect(screen.getByTestId("s")).toHaveTextContent("55");
    expect(screen.getByTestId("s")).toHaveAttribute("data-transitioning", "false");
  });

  it("lands exactly on the server's value after the tween, never past it", async () => {
    mockMatchMedia(false);
    const { rerender } = render(<ScoreTransition value={40} durationMs={60} testId="s" />);
    expect(screen.getByTestId("s")).toHaveTextContent("40");
    rerender(<ScoreTransition value={55} durationMs={60} testId="s" />);
    await waitFor(() => expect(screen.getByTestId("s")).toHaveTextContent("55"));
    expect(screen.getByTestId("s")).toHaveAttribute("data-value", "55");
  });
});

describe("useArrivals — the pick lock is a diff of real state", () => {
  it("reports an EMPTY -> FILLED slot as arrived and an occupant change as swapped, then clears", async () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(({ slots }) => useArrivals(slots, 200), {
        initialProps: { slots: { PG: null, SG: "a" } as Record<string, string | null> },
      });
      expect(result.current.arrived).toEqual([]);
      rerender({ slots: { PG: "b", SG: "c" } });
      expect(result.current.arrived).toEqual(["PG"]);
      expect(result.current.swapped).toEqual(["SG"]);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(result.current.arrived).toEqual([]);
      expect(result.current.swapped).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
