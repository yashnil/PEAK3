"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { REVEAL_BEATS, REVEAL_BEAT_DURATION_MS, RevealBeat } from "./reveal-timing";

/**
 * Shared choreography for a "reveal N cards, one at a time" sequence.
 *
 * Used by BOTH the opening roster reveal and the boss lineup reveal — one
 * hook, so PRODUCT_EXPERIENCE_CONTRACT.md §2/§3's requirement that the two
 * use "the same 9-step per-card grammar... verified by shared component/hook
 * usage, not visual similarity" is true by construction, not by convention.
 *
 * SERVER AUTHORITY, PRESERVED: `items` is the server's own already-committed
 * `revealed_slots` array (SYNTHESIS_CONTRACT.md §2.2 — the client fires the
 * existing batched `reveal(target, count)` action ONCE, the server saturates
 * and returns every slot in one response). This hook never invents a card,
 * never picks an order, and never decides identity — it only decides WHEN,
 * client-side, an already-authoritative item is allowed to be shown.
 * `presentationCursor` is that "when" — SYNTHESIS_CONTRACT.md §2.2 is explicit
 * that it "is not a second source of truth for WHICH card is revealed — only
 * for WHEN it is shown." Server concealment (the payload contract fix,
 * task #15/#6) remains the actual security boundary for the pre-action
 * state; this hook only ever paces data the server has already sent.
 *
 * PAUSE/RESUME: pausing clears the pending timer and remembers the beat in
 * progress; resuming restarts THAT beat from its full duration rather than
 * from the exact millisecond it was paused at. This is a deliberate
 * simplification — a resumed beat replaying briefly from its start reads as
 * "picking the moment back up," not as a bug, and it keeps the state machine
 * a single timer with no drift-prone elapsed-time bookkeeping.
 */
export interface UseRevealSequenceArgs<T> {
  /** The server's own already-revealed items, in order. Empty until the
   *  single batched reveal action's response commits. */
  items: readonly T[];
  /** Total slots in this reveal (`track.total`) — may exceed `items.length`
   *  while the batched request is still in flight. */
  total: number;
  reducedMotion: boolean;
}

export interface RevealSequenceState<T> {
  /** Has the player taken the one action that starts this sequence? */
  started: boolean;
  /** Every slot has settled into its final, visible state. */
  complete: boolean;
  paused: boolean;
  /** The card currently mid-beat, or null when idle, holding for data, or done. */
  activeIndex: number | null;
  activeBeat: RevealBeat | null;
  /** How many cards have fully settled. Drives what a roster dock may show
   *  as filled — see the module docstring: choreography only, never a
   *  second identity source. */
  presentationCursor: number;
  /** `items.slice(0, presentationCursor)` — the items a UI may currently render. */
  visible: readonly T[];
  start: () => void;
  pause: () => void;
  resume: () => void;
  /** Jump to every slot fully resolved, no further animation — mirrors the
   *  existing "Skip all" contract already used elsewhere in this codebase
   *  (`RevealReel`, `BattleReveal`'s "Reveal instantly"). */
  skipAll: () => void;
}

export function useRevealSequence<T>({
  items,
  total,
  reducedMotion,
}: UseRevealSequenceArgs<T>): RevealSequenceState<T> {
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [presentationCursor, setPresentationCursor] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [activeBeat, setActiveBeat] = useState<RevealBeat | null>(null);
  const [complete, setComplete] = useState(false);

  const timerRef = useRef<number | null>(null);
  const positionRef = useRef<{ card: number; beatPos: number } | null>(null);
  const animatingRef = useRef(false);
  const pausedRef = useRef(false);
  const skippedRef = useRef(false);
  const itemsLenRef = useRef(items.length);
  const totalRef = useRef(total);
  itemsLenRef.current = items.length;
  totalRef.current = total;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const step = useCallback(
    (card: number, beatPos: number) => {
      if (skippedRef.current || pausedRef.current) return;
      if (card >= totalRef.current) {
        setActiveIndex(null);
        setActiveBeat(null);
        setComplete(true);
        return;
      }
      if (card >= itemsLenRef.current) {
        // Authoritative data for this card has not landed yet. Hold; the
        // effect below resumes from here the moment `items` grows.
        positionRef.current = { card, beatPos };
        return;
      }
      const beat = REVEAL_BEATS[beatPos];
      positionRef.current = { card, beatPos };
      setActiveIndex(card);
      setActiveBeat(beat);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        if (skippedRef.current || pausedRef.current) return;
        if (beat === "settle") {
          setPresentationCursor((c) => Math.max(c, card + 1));
        }
        const nextBeatPos = beatPos + 1;
        if (nextBeatPos >= REVEAL_BEATS.length) {
          // Only the first card in the whole sequence plays `lights_lower`
          // (beat 0) — every subsequent card starts at `role` (beat 1). See
          // `reveal-timing.ts`'s module docstring.
          step(card + 1, 1);
        } else {
          step(card, nextBeatPos);
        }
      }, REVEAL_BEAT_DURATION_MS[beat]);
    },
    [],
  );

  // Reduced motion: the sequence collapses to the final, fully-informative
  // frame the instant data exists — never a shortened replay of the beats.
  useEffect(() => {
    if (!reducedMotion || items.length === 0) return;
    setStarted(true);
    setPresentationCursor(items.length);
    setActiveIndex(null);
    setActiveBeat(null);
    if (items.length >= total) setComplete(true);
  }, [reducedMotion, items.length, total]);

  // If the sequence is skipped before the batched response has fully
  // landed (or held mid-animation waiting on data), follow `items` as it
  // grows so a slow response cannot stall the sequence forever.
  useEffect(() => {
    if (skippedRef.current) {
      setPresentationCursor(items.length);
      if (items.length >= total) setComplete(true);
      return;
    }
    if (
      animatingRef.current &&
      !pausedRef.current &&
      !reducedMotion &&
      timerRef.current === null &&
      positionRef.current &&
      positionRef.current.card < items.length &&
      !complete
    ) {
      step(positionRef.current.card, positionRef.current.beatPos);
    }
  }, [items.length, total, reducedMotion, complete, step]);

  const start = useCallback(() => {
    if (started) return;
    setStarted(true);
    if (reducedMotion) return; // handled by the effect above
    animatingRef.current = true;
    step(0, 0);
  }, [started, reducedMotion, step]);

  const pause = useCallback(() => {
    if (!animatingRef.current || complete || skippedRef.current) return;
    pausedRef.current = true;
    setPaused(true);
    clearTimer();
  }, [complete, clearTimer]);

  const resume = useCallback(() => {
    if (!pausedRef.current) return;
    pausedRef.current = false;
    setPaused(false);
    const pos = positionRef.current;
    if (pos) step(pos.card, pos.beatPos);
  }, [step]);

  const skipAll = useCallback(() => {
    skippedRef.current = true;
    pausedRef.current = false;
    clearTimer();
    setPaused(false);
    setStarted(true);
    setActiveIndex(null);
    setActiveBeat(null);
    setPresentationCursor(items.length);
    if (items.length >= total) setComplete(true);
  }, [items.length, total, clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  return {
    started,
    complete,
    paused,
    activeIndex,
    activeBeat,
    presentationCursor,
    visible: items.slice(0, presentationCursor),
    start,
    pause,
    resume,
    skipAll,
  };
}
