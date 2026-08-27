"use client";

/**
 * PeakV2SpinReveal — THE PEAK3 roll ceremony. One component, two callers.
 *
 * WHY THIS EXISTS. 82-0 and Three-Man Weave were performing the same
 * ceremony — "two constrained axes are rolled, then locked, then revealed,
 * and then you choose within them" — through two unrelated implementations:
 * `components/court/SpinStage.tsx` (1153 lines, 82-0 only) and a bespoke
 * arrangement inside `PeakV2TMWReveal`. They shared a single reel primitive
 * and nothing else: different shells, different typography, different status
 * vocabulary, different control placement, and different bugs. This is the
 * shell both of them were missing.
 *
 * WHAT IS SHARED vs WHAT IS NOT. Shared: the shell, its fixed geometry, the
 * three-role typography, the state machine, the lock beat, the live region,
 * the reduced-motion path. Not shared: the axis LABELS ("Team × Season" vs
 * "Franchise × Decade"), the values, and whatever per-axis control a mode
 * offers (82-0 has respins; TMW has none). Those are props, because they are
 * the only things that genuinely differ.
 *
 * THE STATE MACHINE IS THE POINT.
 *
 *     IDLE → SPINNING → LOCKING → REVEALED
 *
 * and the invariant that motivated it: THE FINAL VALUE IS NEVER ON SCREEN
 * BEFORE THE SPIN. The server knows the answer before the first frame — it
 * has to, the reel spins TO it — but knowing is not showing. Each axis
 * renders `SpinReel`, which shows a moving strip and swaps in the value only
 * once its own transition has landed. `data-final-value` still carries the
 * answer from t=0 so a test can assert the reel cannot resolve to anything
 * else without racing the animation.
 *
 * (TMW's leak was not in the reel at all: the round's franchise and decade
 * were ALSO printed as a plain line elsewhere on the page, visible behind the
 * intro overlay before anything had spun — design-review/13. Fixed at that
 * call site; this component is what it now rolls through.)
 *
 * THE SHELL DOES NOT MOVE. Every axis reserves the same height whatever its
 * stage, and the value slot is width-stable, so "Utah Jazz" and "Portland
 * Trail Blazers" produce the same box. A ceremony whose container resizes as
 * it resolves reads as a bug, not as a reveal.
 *
 * NO ARTIFICIAL DELAY. The reels animate inside time the caller is already
 * spending; nothing here sleeps to make the ceremony feel longer, and
 * `onRevealed` fires as soon as the presentation has genuinely landed.
 *
 * REDUCED MOTION runs the identical machine with near-zero delays, so the
 * unrevealed → revealed distinction survives even with no animation at all —
 * downstream code never special-cases it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import SpinReel, { REEL_SPIN_MS, REEL_LOCK_MS } from "@/components/shared/SpinReel";
import { usePrefersReducedMotion } from "@/lib/a11y";

export type PeakV2SpinStage = "idle" | "spinning" | "locking" | "revealed";

export interface PeakV2SpinAxis {
  /** INSTRUMENTATION role: "TEAM", "SEASON", "FRANCHISE", "DECADE". */
  label: string;
  /** The server's decided value for this axis. */
  value: string;
  /** What the reel ticks through on the way. Decorative only. */
  pool: readonly string[];
  /** A mode-specific control that belongs to THIS axis — 82-0's per-axis
   *  respin. Rendered inside the axis, not as a detached button row: a
   *  respin is an operation on the value beside it, and three free-floating
   *  rectangles above the shell never said which axis they applied to. */
  action?: React.ReactNode;
  testId?: string;
}

export interface PeakV2SpinRevealProps {
  axes: PeakV2SpinAxis[];
  /** Changes per roll. A new key re-arms the whole ceremony. */
  runKey: string;
  /** Fires once, when the presentation reaches REVEALED. */
  onRevealed?: () => void;
  /** Skips straight to REVEALED with no ceremony — for a roll the player has
   *  already watched (a reconnect, a re-open of a minimized panel). */
  alreadyRevealed?: boolean;
  /** INSTRUMENTATION line above the axes, e.g. "ROUND 1 / 8". */
  status?: React.ReactNode;
  /** Announced to assistive tech once the values are real. */
  announcePrefix?: string;
  className?: string;
  testId?: string;
}

export default function PeakV2SpinReveal({
  axes,
  runKey,
  onRevealed,
  alreadyRevealed = false,
  status,
  announcePrefix = "Rolled",
  className,
  testId = "peak-v2-spin-reveal",
}: PeakV2SpinRevealProps) {
  const reduced = usePrefersReducedMotion();
  const [stage, setStage] = useState<PeakV2SpinStage>(alreadyRevealed ? "revealed" : "idle");
  const settled = useRef<Set<string>>(new Set());
  // Held in a ref so a caller that re-creates the callback each render cannot
  // re-fire the reveal — the same guard `ArenaTimer` uses for `onExpire`.
  const onRevealedRef = useRef(onRevealed);
  onRevealedRef.current = onRevealed;

  // Each axis gets its own spin duration: two physical wheels never stop on
  // the same frame, so the pair reads as one constraint arriving rather than
  // two simultaneous facts. Beyond the second axis the stagger repeats the
  // slower value rather than growing without bound.
  const spinMs = useMemo(
    () => axes.map((_, i) => (i === 0 ? REEL_SPIN_MS.primary : REEL_SPIN_MS.secondary)),
    [axes],
  );

  // Re-arm on a genuinely new roll.
  useEffect(() => {
    settled.current = new Set();
    setStage(alreadyRevealed ? "revealed" : "idle");
  }, [runKey, alreadyRevealed]);

  // IDLE → SPINNING on mount of a new run. A frame, not a timer: the reels
  // arm on their own first effect and this only has to be after that.
  useEffect(() => {
    if (stage !== "idle") return;
    const id = window.setTimeout(() => setStage("spinning"), 0);
    return () => window.clearTimeout(id);
  }, [stage, runKey]);

  const noteSettled = useCallback(
    (axisKey: string) => {
      settled.current.add(axisKey);
      if (settled.current.size < axes.length) return;
      setStage("locking");
    },
    [axes.length],
  );

  // LOCKING → REVEALED after the lock beat. This is presentation time the
  // reels have already earned, not an added wait.
  useEffect(() => {
    if (stage !== "locking") return;
    const id = window.setTimeout(
      () => {
        setStage("revealed");
        onRevealedRef.current?.();
      },
      reduced ? 0 : REEL_LOCK_MS,
    );
    return () => window.clearTimeout(id);
  }, [stage, reduced]);

  // A ceremony the caller mounted already-revealed still owes its listener
  // the callback, or the caller waits forever for a beat that never comes.
  useEffect(() => {
    if (alreadyRevealed) onRevealedRef.current?.();
  }, [alreadyRevealed, runKey]);

  const revealed = stage === "revealed";

  return (
    <div
      className={`v2-spin${className ? ` ${className}` : ""}`}
      data-testid={testId}
      data-stage={stage}
      data-reduced-motion={reduced ? "true" : "false"}
    >
      {status ? <div className="v2-spin-status">{status}</div> : null}

      <div className="v2-spin-axes" data-axis-count={axes.length}>
        {axes.map((axis, i) => (
          <div
            className="v2-spin-axis"
            key={axis.label}
            data-testid={axis.testId}
            data-revealed={revealed ? "true" : "false"}
          >
            <span className="v2-spin-axis-label">{axis.label}</span>
            <span className="v2-spin-axis-value">
              <SpinReel
                pool={axis.pool}
                target={axis.value}
                spinMs={spinMs[i]}
                runKey={`${runKey}:${axis.label}`}
                reduced={reduced || alreadyRevealed}
                testId={`${axis.testId ?? `v2-spin-axis-${i}`}-reel`}
                onSettled={() => noteSettled(axis.label)}
              />
            </span>
            {/* The axis's own control appears only once its value is real —
                offering "respin this" over a still-spinning reel would be
                asking about something the player cannot read yet. The slot
                is reserved either way so nothing reflows when it arrives. */}
            <span className="v2-spin-axis-action">{revealed ? axis.action : null}</span>
          </div>
        ))}
      </div>

      {/* One announcement, once, when the values are genuinely readable. The
          moving strips are aria-hidden by SpinReel itself. */}
      <span className="sr-only" role="status" aria-live="polite">
        {revealed ? `${announcePrefix} ${axes.map((a) => `${a.label} ${a.value}`).join(", ")}.` : ""}
      </span>
    </div>
  );
}
