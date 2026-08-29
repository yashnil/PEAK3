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
  /** Override this axis's spin duration. Default staggers primary/secondary
   *  so two wheels never stop on the same frame. Three-Man Weave overrides
   *  it because its ceremony length is a fraction of the SERVER's own reveal
   *  window, never a client-chosen duration — the reel must not still be
   *  turning when the server's phase ends. */
  spinMs?: number;
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
  /**
   * CALLER-OWNED ORCHESTRATION.
   *
   * By default this component runs its own machine: the reels report when
   * they settle, a lock beat follows, then REVEALED. That is right for 82-0,
   * where the ceremony is a client presentation over an already-decided
   * roll.
   *
   * Three-Man Weave cannot work that way. Its reveal is a real SERVER TURN
   * with a published deadline, every seat watches the same one, and a
   * reconnect must resume it where the server says it is rather than
   * replaying a reel that already finished. So TMW derives the stage from
   * elapsed-vs-deadline and hands it in here. The PRESENTATION is shared —
   * shell, geometry, typography, the lock beat's treatment, the live region,
   * the axis grammar — and only the question of WHEN stays with the mode.
   *
   * When set, the internal machine does not run and `onRevealed` is not
   * fired (the caller already knows).
   */
  stage?: PeakV2SpinStage;
  /** Force the reduced/no-motion reel path independently of the user's
   *  media query — for a roll joined mid-flight, where animating from the
   *  start would replay a ceremony the server has already spent. */
  still?: boolean;
  className?: string;
  testId?: string;
  /** Extra attributes for the root, so a mode can keep its own long-standing
   *  e2e-observable identity on the same element. */
  rootProps?: Record<string, string | undefined>;
}

export default function PeakV2SpinReveal({
  axes,
  runKey,
  onRevealed,
  alreadyRevealed = false,
  status,
  announcePrefix = "Rolled",
  stage: controlledStage,
  still = false,
  className,
  testId = "peak-v2-spin-reveal",
  rootProps,
}: PeakV2SpinRevealProps) {
  const prefersReduced = usePrefersReducedMotion();
  const reduced = prefersReduced || still;
  const controlled = controlledStage !== undefined;
  const [internalStage, setStage] = useState<PeakV2SpinStage>(alreadyRevealed ? "revealed" : "idle");
  const stage = controlled ? controlledStage : internalStage;
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
    () => axes.map((a, i) => a.spinMs ?? (i === 0 ? REEL_SPIN_MS.primary : REEL_SPIN_MS.secondary)),
    [axes],
  );

  // Re-arm on a genuinely new roll.
  useEffect(() => {
    if (controlled) return;
    settled.current = new Set();
    setStage(alreadyRevealed ? "revealed" : "idle");
  }, [runKey, alreadyRevealed, controlled]);

  // IDLE → SPINNING on mount of a new run. A frame, not a timer: the reels
  // arm on their own first effect and this only has to be after that.
  useEffect(() => {
    if (controlled || stage !== "idle") return;
    const id = window.setTimeout(() => setStage("spinning"), 0);
    return () => window.clearTimeout(id);
  }, [controlled, stage, runKey]);

  const noteSettled = useCallback(
    (axisKey: string) => {
      if (controlled) return;
      settled.current.add(axisKey);
      if (settled.current.size < axes.length) return;
      setStage("locking");
    },
    [axes.length, controlled],
  );

  // LOCKING → REVEALED after the lock beat. This is presentation time the
  // reels have already earned, not an added wait.
  useEffect(() => {
    if (controlled || stage !== "locking") return;
    const id = window.setTimeout(
      () => {
        setStage("revealed");
        onRevealedRef.current?.();
      },
      reduced ? 0 : REEL_LOCK_MS,
    );
    return () => window.clearTimeout(id);
  }, [controlled, stage, reduced]);

  // A ceremony the caller mounted already-revealed still owes its listener
  // the callback, or the caller waits forever for a beat that never comes.
  useEffect(() => {
    if (!controlled && alreadyRevealed) onRevealedRef.current?.();
  }, [controlled, alreadyRevealed, runKey]);

  const revealed = stage === "revealed";

  return (
    <div
      className={`v2-spin${className ? ` ${className}` : ""}`}
      data-testid={testId}
      data-stage={stage}
      data-revealed={revealed ? "true" : "false"}
      data-reduced-motion={reduced ? "true" : "false"}
      {...rootProps}
    >
      {status ? <div className="v2-spin-status">{status}</div> : null}

      <div className="v2-spin-axes" data-axis-count={axes.length}>
        {axes.map((axis, i) => (
          <div
            className="v2-spin-axis"
            key={axis.label}
            data-testid={axis.testId}
            data-revealed={revealed ? "true" : "false"}
            // The axis publishes its decided value from the first frame, for
            // the same reason `SpinReel` does: a test (and a reader of the
            // DOM) can assert this roll cannot land anywhere else without
            // racing the animation. It is data, never rendered text — the
            // value only becomes VISIBLE when the reel settles.
            data-final-value={axis.value}
          >
            <span className="v2-spin-axis-label">{axis.label}</span>
            <span className="v2-spin-axis-value">
              {/* THE REEL DOES NOT EXIST UNTIL THE CEREMONY IS SPINNING.
                  `SpinReel` starts its animation on MOUNT, so mounting it
                  while the ceremony is still IDLE means the wheel turns and
                  lands during a stage that is supposed to be "armed, nothing
                  decided" — measured live: the reel reached `done` about
                  1.6s in, entirely behind Three-Man Weave's opening card, and
                  the ceremony then advanced to SPINNING with the answer
                  already sitting there and the caption still reading
                  "Rolling…".

                  Gating the mount on the stage is what makes IDLE → SPINNING
                  a real transition rather than a label: at IDLE there is
                  nothing on screen to leak, and the wheel starts turning
                  exactly when the ceremony says it does. The placeholder
                  holds the same 30px window, so the shell does not move when
                  the reel arrives. */}
              {stage === "idle" ? (
                <span className="v2-spin-axis-armed" aria-hidden="true" />
              ) : (
                <SpinReel
                  pool={axis.pool}
                  target={axis.value}
                  spinMs={spinMs[i]}
                  runKey={`${runKey}:${axis.label}`}
                  reduced={reduced || alreadyRevealed}
                  testId={`${axis.testId ?? `v2-spin-axis-${i}`}-reel`}
                  onSettled={() => noteSettled(axis.label)}
                />
              )}
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
