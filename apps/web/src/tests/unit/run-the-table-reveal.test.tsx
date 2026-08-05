/**
 * The shared reveal system (`useRevealSequence` + `RevealCard` +
 * `RevealSequenceSurface`) — PRODUCT_EXPERIENCE_CONTRACT.md §2/§3,
 * SYNTHESIS_CONTRACT.md §4.
 *
 * This is the DEDICATED coverage for the pair that replaced `RevealReel`
 * (deleted this pass — see `run-the-table-v3.test.tsx`'s note where its old
 * `describe("RevealReel", ...)` block used to live). Two halves:
 *
 *   1. The HOOK, tested directly with `renderHook` and fake timers — no DOM,
 *      no `userEvent`, so beat-by-beat timing assertions are exact rather
 *      than racing real `setTimeout`s.
 *   2. The SURFACE, tested through real rendering — `userEvent` for the one
 *      action and the controls, `skipAll`/reduced-motion for anything that
 *      would otherwise need to wait out real animation time.
 *
 * Every assertion here is about CHOREOGRAPHY over data a caller already
 * handed in — this file, like the component it tests, computes no PEAK3
 * score, no card, no order.
 */
import { describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RevealSequenceSurface, {
  revealSourceFor,
} from "@/components/run-the-table/RevealSequenceSurface";
import { useRevealSequence } from "@/components/run-the-table/useRevealSequence";
import {
  REVEAL_BEAT_DURATION_MS,
  REVEAL_CARD_TOTAL_MS,
  revealSequenceTotalMs,
} from "@/components/run-the-table/reveal-timing";
import type { RevealSlot, RevealTrack } from "@/types/run-the-table";

const SLOT_IDS = ["lead_creator", "guard_wing", "wing_forward", "forward_big", "anchor", "bench_1", "bench_2"];

function revealSlot(index: number): RevealSlot {
  return {
    order: index,
    slot_id: SLOT_IDS[index],
    label: index < 5 ? "Starter" : `Bench ${index - 4}`,
    role: index < 5 ? (SLOT_IDS[index] as never) : null,
    is_starter: index < 5,
    card_id: `card-${index}`,
    player_name: `Player ${index}`,
    anchor_season: "1990-91",
    window: "1988-89–1990-91",
    prime_score: 60 + index,
    base_cost: 10 + index,
  };
}

function track(revealed: number): RevealTrack {
  const slots = SLOT_IDS.map((_, i) => revealSlot(i));
  return {
    revealed,
    total: SLOT_IDS.length,
    complete: revealed >= SLOT_IDS.length,
    order: slots.map((s) => ({ order: s.order, slot_id: s.slot_id, label: s.label })),
    revealed_slots: slots.slice(0, revealed),
    next_slot: revealed < slots.length ? slots[revealed] : null,
    can_skip: revealed > 0 && revealed < slots.length,
    remaining: slots.length - revealed,
  };
}

// ---------------------------------------------------------------------------
// useRevealSequence — the hook, in isolation, with fake timers
// ---------------------------------------------------------------------------

describe("useRevealSequence", () => {
  it("shows nothing and starts nothing until `start()` is called", () => {
    const { result } = renderHook(() =>
      useRevealSequence<RevealSlot>({ items: [], total: 7, reducedMotion: false }),
    );
    expect(result.current.started).toBe(false);
    expect(result.current.presentationCursor).toBe(0);
    expect(result.current.activeIndex).toBeNull();
    expect(result.current.visible).toEqual([]);
  });

  it("holds at card 0 until the batched data actually lands, even after start()", () => {
    const { result } = renderHook(() =>
      useRevealSequence<RevealSlot>({ items: [], total: 7, reducedMotion: false }),
    );
    act(() => result.current.start());
    expect(result.current.started).toBe(true);
    // No items yet — the POST is still "in flight" from the caller's
    // perspective — so nothing has begun animating.
    expect(result.current.activeIndex).toBeNull();
    expect(result.current.presentationCursor).toBe(0);
  });

  it("settles cards one at a time once data has landed, in order, and completes at the total", () => {
    vi.useFakeTimers();
    try {
      const items = SLOT_IDS.map((_, i) => revealSlot(i));
      const { result, rerender } = renderHook(
        ({ items: i }: { items: RevealSlot[] }) =>
          useRevealSequence<RevealSlot>({ items: i, total: 7, reducedMotion: false }),
        { initialProps: { items: [] as RevealSlot[] } },
      );
      act(() => result.current.start());
      rerender({ items });

      // Nothing settled yet — the first card's beats are still running.
      expect(result.current.presentationCursor).toBe(0);

      // Advance past exactly one card's full sequence (lights_lower is
      // one-time, so card 0's settle lands at lights_lower + one card total).
      act(() => {
        vi.advanceTimersByTime(REVEAL_BEAT_DURATION_MS.lights_lower + REVEAL_CARD_TOTAL_MS);
      });
      expect(result.current.presentationCursor).toBe(1);
      expect(result.current.visible.map((s) => s.player_name)).toEqual(["Player 0"]);

      // Advance the rest of the way — every remaining card, in order.
      act(() => {
        vi.advanceTimersByTime(REVEAL_CARD_TOTAL_MS * 6 + 100);
      });
      expect(result.current.complete).toBe(true);
      expect(result.current.presentationCursor).toBe(7);
      expect(result.current.visible.map((s) => s.player_name)).toEqual(
        SLOT_IDS.map((_, i) => `Player ${i}`),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("pause halts progress; resume continues it — no slot settles while paused", () => {
    vi.useFakeTimers();
    try {
      const items = SLOT_IDS.map((_, i) => revealSlot(i));
      const { result, rerender } = renderHook(
        ({ items: i }: { items: RevealSlot[] }) =>
          useRevealSequence<RevealSlot>({ items: i, total: 7, reducedMotion: false }),
        { initialProps: { items: [] as RevealSlot[] } },
      );
      act(() => result.current.start());
      rerender({ items });
      act(() => vi.advanceTimersByTime(REVEAL_BEAT_DURATION_MS.lights_lower + 50));
      act(() => result.current.pause());
      expect(result.current.paused).toBe(true);
      const cursorAtPause = result.current.presentationCursor;

      act(() => vi.advanceTimersByTime(5000));
      expect(result.current.presentationCursor).toBe(cursorAtPause);
      expect(result.current.complete).toBe(false);

      act(() => result.current.resume());
      expect(result.current.paused).toBe(false);
      act(() => vi.advanceTimersByTime(revealSequenceTotalMs(7)));
      expect(result.current.complete).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skipAll jumps every already-landed item to fully settled, instantly, with no timers left pending", () => {
    vi.useFakeTimers();
    try {
      const items = SLOT_IDS.map((_, i) => revealSlot(i));
      const { result, rerender } = renderHook(
        ({ items: i }: { items: RevealSlot[] }) =>
          useRevealSequence<RevealSlot>({ items: i, total: 7, reducedMotion: false }),
        { initialProps: { items: [] as RevealSlot[] } },
      );
      act(() => result.current.start());
      rerender({ items });
      act(() => vi.advanceTimersByTime(200));
      act(() => result.current.skipAll());
      expect(result.current.complete).toBe(true);
      expect(result.current.presentationCursor).toBe(7);
      expect(result.current.activeIndex).toBeNull();
      // Nothing further changes even if time keeps moving — the sequence is
      // genuinely done, not merely fast-forwarded.
      act(() => vi.advanceTimersByTime(5000));
      expect(result.current.presentationCursor).toBe(7);
    } finally {
      vi.useRealTimers();
    }
  });

  it("under reduced motion, collapses to the full final state the instant data exists — never a shortened replay", () => {
    const items = SLOT_IDS.map((_, i) => revealSlot(i));
    const { result, rerender } = renderHook(
      ({ items: i }: { items: RevealSlot[] }) =>
        useRevealSequence<RevealSlot>({ items: i, total: 7, reducedMotion: true }),
      { initialProps: { items: [] as RevealSlot[] } },
    );
    expect(result.current.presentationCursor).toBe(0);
    rerender({ items });
    expect(result.current.started).toBe(true);
    expect(result.current.complete).toBe(true);
    expect(result.current.presentationCursor).toBe(7);
    expect(result.current.activeIndex).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RevealSequenceSurface — the shared component both the roster and boss
// reveals render, via a small harness that owns the hook exactly the way
// `RunTheTableGame` does.
// ---------------------------------------------------------------------------

function RevealHarness({
  revealTrack,
  reducedMotion = false,
  onStartReveal = vi.fn(),
}: {
  revealTrack: RevealTrack;
  reducedMotion?: boolean;
  onStartReveal?: (count: number) => void;
}) {
  const sequence = useRevealSequence<RevealSlot>({
    items: revealTrack.revealed_slots,
    total: revealTrack.total,
    reducedMotion,
  });
  return (
    <RevealSequenceSurface
      track={revealTrack}
      sequence={sequence}
      kind="roster"
      title="Meet your roster"
      sourceNote={revealSourceFor("roster")}
      orderLabelFor={(slotId, label) => label ?? slotId}
      cardLookup={() => null}
      reducedMotion={reducedMotion}
      busy={false}
      onStartReveal={onStartReveal}
    />
  );
}

describe("RevealSequenceSurface", () => {
  it("shows only the one-action cover — no player name anywhere — before the press", () => {
    render(<RevealHarness revealTrack={track(0)} />);
    expect(screen.getByTestId("rtt-reveal-start-roster")).toBeInTheDocument();
    expect(screen.queryByText(/Player \d/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("rtt-reveal-pause-roster")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rtt-reveal-skip-roster")).not.toBeInTheDocument();
  });

  it("the one press fires onStartReveal with the FULL count, never a partial one", async () => {
    const onStartReveal = vi.fn();
    render(<RevealHarness revealTrack={track(0)} onStartReveal={onStartReveal} />);
    await userEvent.click(screen.getByTestId("rtt-reveal-start-roster"));
    expect(onStartReveal).toHaveBeenCalledWith(7);
    expect(onStartReveal).toHaveBeenCalledTimes(1);
  });

  it("every unsettled slot reads 'Not revealed yet' for assistive tech until the batch lands and resolves", async () => {
    const { rerender } = render(<RevealHarness revealTrack={track(0)} />);
    await userEvent.click(screen.getByTestId("rtt-reveal-start-roster"));
    // The batched POST resolving is simulated by the caller re-rendering
    // with the server's now-complete track — exactly what `RunTheTableGame`
    // does when `commit()` replaces `state`.
    rerender(<RevealHarness revealTrack={track(7)} />);
    // Before any presentation time has passed, every slot but (at most) the
    // very first must still read concealed.
    expect(screen.getAllByLabelText("Not revealed yet").length).toBeGreaterThanOrEqual(6);
  });

  it("skip all resolves every slot with the server's own names, in order — no client invention", async () => {
    const { rerender } = render(<RevealHarness revealTrack={track(0)} />);
    await userEvent.click(screen.getByTestId("rtt-reveal-start-roster"));
    rerender(<RevealHarness revealTrack={track(7)} />);
    await userEvent.click(await screen.findByTestId("rtt-reveal-skip-roster"));
    for (let i = 0; i < 7; i += 1) {
      expect(await screen.findByText(`Player ${i}`)).toBeInTheDocument();
    }
    expect(screen.queryByLabelText("Not revealed yet")).not.toBeInTheDocument();
  });

  it("reduced motion renders the fully-resolved roster the instant the batch lands, with no animation to skip", async () => {
    const { rerender } = render(<RevealHarness revealTrack={track(0)} reducedMotion />);
    await userEvent.click(screen.getByTestId("rtt-reveal-start-roster"));
    rerender(<RevealHarness revealTrack={track(7)} reducedMotion />);
    expect(await screen.findByText("Player 0")).toBeInTheDocument();
    expect(screen.getByText("Player 6")).toBeInTheDocument();
    // No pause/skip affordance is needed once nothing is left to animate.
    await waitFor(() => expect(screen.queryByTestId("rtt-reveal-pause-roster")).not.toBeInTheDocument());
  });

  it("labels itself as seed and rule generated — never implying a live-built team", () => {
    expect(revealSourceFor("roster")).toMatch(/seed and rule generated/i);
    expect(revealSourceFor("boss")).toMatch(/not a team being built live/i);
    render(<RevealHarness revealTrack={track(0)} />);
    expect(screen.getByTestId("rtt-reveal-source-roster")).toHaveTextContent(/seed and rule generated/i);
  });

  it("announces the complete, final roster in a live region once settled — mounted empty, filled after", async () => {
    const { rerender } = render(<RevealHarness revealTrack={track(0)} reducedMotion />);
    const live = screen.getByTestId("rtt-reveal-live-roster");
    expect(live).toHaveTextContent("");
    await userEvent.click(screen.getByTestId("rtt-reveal-start-roster"));
    rerender(<RevealHarness revealTrack={track(7)} reducedMotion />);
    await waitFor(() => expect(live).toHaveTextContent("Player 0"));
    expect(live).toHaveTextContent("Player 6");
  });
});
