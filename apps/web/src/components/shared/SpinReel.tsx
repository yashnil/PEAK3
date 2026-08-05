"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * ONE REEL: a clipping window over a pre-built strip, moved by a single
 * composited transform.
 *
 * A DIRECT ADAPTATION OF `components/court/SpinStage.tsx`, not a new spinner.
 * Every mechanic and every constant below is that component's, extracted so a
 * second mode can use the same wheel without either mode being able to change
 * the other's ceremony. The reasons those mechanics are what they are were
 * paid for in Phase 9B and are worth restating, because they are the
 * difference between a wheel and a text swap:
 *
 *  * ONE TRANSFORM, NEVER A PER-ROW STYLE. The rows are created once per spin
 *    and never reconciled again. The original bug was a `layout` animation and
 *    an inline `transform` fighting for the same property, which teleported
 *    every row for one frame roughly 150 times per spin.
 *  * UNIFORM ROW HEIGHT. The payline is a static overlay on the WINDOW, never
 *    a class on the moving row, so no row ever changes size mid-flight and
 *    re-lays-out the strip underneath the animation.
 *  * CONSTANT TRAVEL DISTANCE, independent of pool size and of where the
 *    target sits. Every spin therefore has the same duration and the same
 *    deceleration curve, with no "some rolls take longer" tell and no
 *    positional bias.
 *  * A SETTLE OVERSHOOT. 0.3 of a row, rebounding on a back-ease, reads as a
 *    mechanical detent rather than an abrupt stop.
 *  * A TIMEOUT BESIDE EVERY `transitionend`. The event is not delivered if the
 *    tab backgrounds mid-transition, so each stage arms both and both are
 *    guarded on the current stage so they cannot double-advance.
 *
 * THE REEL NEVER DECIDES ANYTHING. `target` is the server's answer, known
 * before the first frame, and `data-final-value` carries it from t=0 so a test
 * can assert the reel cannot resolve to anything else without racing the
 * animation. The on-screen answer is still hidden until the strip arrives.
 */

/** Uniform row height. Uniform is load-bearing -- see the docstring. */
const ROW_H = 30;
const WINDOW_ROWS = 3;
const WINDOW_H = ROW_H * WINDOW_ROWS;
const offsetForRow = (index: number) => -(index * ROW_H) + (WINDOW_H - ROW_H) / 2;

/** Rows travelled per spin. Constant for every roll. */
const TRAVEL_ROWS = 52;
const MAX_STRIP_ROWS = 160;

const SPIN_EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";
const SETTLE_EASE = "cubic-bezier(0.34, 1.42, 0.64, 1)";
const OVERSHOOT_ROWS = 0.3;
const SETTLE_MS = 220;
const TRANSITION_FALLBACK_MS = 120;

/** The two reels are staggered on purpose: two independent physical wheels
 * never stop on the same frame. Franchise first, decade second, so the pair
 * reads as one constraint arriving rather than two facts. */
export const REEL_SPIN_MS = { primary: 1400, secondary: 1750 } as const;

/** Total ceremony, which lands inside the product's 1.5-2.5s window:
 * 1750 (slowest reel) + 220 settle + 300 lock-in beat = 2270ms. */
export const REEL_LOCK_MS = 300;
export const CEREMONY_MS = REEL_SPIN_MS.secondary + SETTLE_MS + REEL_LOCK_MS;

/** Reduced motion still runs the real state machine (spinning -> locked ->
 * revealed) so nothing downstream has to special-case it -- just with
 * near-zero delays, well inside any browser-test budget. */
export const REDUCED_CEREMONY_MS = 80;

type ReelStage = "armed" | "spinning" | "settling" | "done";

interface ReelRun {
  strip: readonly string[];
  targetIndex: number;
  startIndex: number;
  finalLabel: string;
  stage: ReelStage;
  spinMs: number;
  runKey: string;
}

function buildRun(
  pool: readonly string[],
  target: string,
  spinMs: number,
  runKey: string,
): ReelRun {
  // A pool that does not contain the target would spin to a row that is not
  // the answer, so the target is appended rather than assumed present.
  const safePool = pool.includes(target) ? pool : [...pool, target];
  const poolLength = Math.max(1, safePool.length);
  const finalPoolIndex = Math.max(0, safePool.indexOf(target));
  const repeats = Math.max(
    2,
    Math.min(
      Math.ceil(MAX_STRIP_ROWS / poolLength),
      Math.ceil((TRAVEL_ROWS + poolLength) / poolLength) + 1,
    ),
  );
  const strip = Array.from(
    { length: repeats * poolLength },
    (_, index) => safePool[index % poolLength],
  );
  const targetIndex = (repeats - 1) * poolLength + finalPoolIndex;
  return {
    strip,
    targetIndex,
    startIndex: Math.max(0, targetIndex - TRAVEL_ROWS),
    finalLabel: target,
    stage: "armed",
    spinMs,
    runKey,
  };
}

export default function SpinReel({
  pool,
  target,
  spinMs,
  runKey,
  reduced,
  testId,
  onSettled,
}: {
  /** What the reel ticks through. Decorative only -- the answer is `target`. */
  pool: readonly string[];
  /** The server's result. Known before the first frame. */
  target: string;
  spinMs: number;
  /** Changes per roll so a new run always remounts cleanly. */
  runKey: string;
  reduced: boolean;
  testId: string;
  onSettled: () => void;
}) {
  const [run, setRun] = useState<ReelRun>(() =>
    buildRun(pool, target, spinMs, runKey),
  );
  const stripRef = useRef<HTMLDivElement | null>(null);
  const settled = useRef(false);

  useEffect(() => {
    settled.current = false;
    if (reduced) {
      // No strip at all under reduced motion: the value is simply there.
      setRun(buildRun(pool, target, spinMs, runKey));
      const timer = window.setTimeout(() => {
        settled.current = true;
        onSettled();
      }, REDUCED_CEREMONY_MS);
      return () => window.clearTimeout(timer);
    }
    setRun(buildRun(pool, target, spinMs, runKey));
    // One frame armed at `startIndex` with no transition, then release. Two
    // rAFs rather than one: the first commits the armed transform, the second
    // guarantees the browser has painted it before the transition is added,
    // which is what stops the strip jumping straight to the target.
    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() =>
        setRun((current) => ({ ...current, stage: "spinning" })),
      );
    });
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
    // `pool` is intentionally not a dependency: it is decorative and a new
    // array identity on every render would restart the reel forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, target, reduced, spinMs]);

  const advance = useCallback(() => {
    setRun((current) => {
      if (current.stage === "spinning") return { ...current, stage: "settling" };
      if (current.stage === "settling") {
        if (!settled.current) {
          settled.current = true;
          onSettled();
        }
        return { ...current, stage: "done" };
      }
      return current;
    });
  }, [onSettled]);

  // The timeout that stands beside `transitionend`. Both are guarded on the
  // stage inside `advance`, so whichever arrives first wins and the other is a
  // no-op.
  useEffect(() => {
    if (reduced || run.stage === "armed" || run.stage === "done") return;
    const duration = run.stage === "spinning" ? run.spinMs : SETTLE_MS;
    const timer = window.setTimeout(advance, duration + TRANSITION_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [run.stage, run.spinMs, reduced, advance]);

  if (reduced || run.stage === "done") {
    return (
      <span
        data-testid={testId}
        data-final-value={run.finalLabel}
        data-stage={reduced ? "reduced" : "done"}
        className="tmw-reel-value"
      >
        {run.finalLabel}
      </span>
    );
  }

  const restingIndex =
    run.stage === "armed"
      ? run.startIndex
      : run.stage === "spinning"
        ? run.targetIndex + OVERSHOOT_ROWS
        : run.targetIndex;

  return (
    <span
      className="spin-reel-strip"
      data-testid={testId}
      data-stage={run.stage}
      data-phase="spinning"
      data-final-value={run.finalLabel}
      // The moving strip is decoration over a decided result. The result is
      // announced once, by the ceremony's own live region.
      aria-hidden="true"
    >
      <span
        ref={stripRef}
        className="spin-reel-track"
        data-row-count={run.strip.length}
        style={{
          transform: `translate3d(0, ${offsetForRow(restingIndex)}px, 0)`,
          transition:
            run.stage === "armed"
              ? "none"
              : run.stage === "spinning"
                ? `transform ${run.spinMs}ms ${SPIN_EASE}`
                : `transform ${SETTLE_MS}ms ${SETTLE_EASE}`,
        }}
        onTransitionEnd={(event) => {
          if (event.propertyName !== "transform") return;
          if (event.target !== stripRef.current) return;
          advance();
        }}
      >
        {run.strip.map((label, index) => (
          <span className="spin-reel-row" key={index} data-label={label}>
            {label}
          </span>
        ))}
      </span>
    </span>
  );
}
