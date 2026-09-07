"use client";

/**
 * ScoreTransition — a number that MOVES to its new value, deterministically.
 *
 * A projected record, a roster count, a final score: when the value the
 * server sent changes, the displayed number tweens to it over a short,
 * fixed duration instead of teleporting. Nothing is invented — the tween
 * begins at the last value shown and ends at exactly the server's value,
 * and the first render shows the value directly (no count-up from zero
 * unless asked for, which is reserved for a final reveal). Reduced motion
 * shows the value immediately.
 */

import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/a11y";

export interface ScoreTransitionProps {
  value: number;
  /** How the number is printed. Defaults to rounding to an integer. */
  format?: (value: number) => string;
  /** Tween length. Level 2 for a routine change, Level 3 for a final reveal. */
  durationMs?: number;
  /** Count up from this value on first mount (a final reveal). */
  from?: number;
  testId?: string;
  className?: string;
  as?: "span" | "div";
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export default function ScoreTransition({
  value,
  format = (n) => String(Math.round(n)),
  durationMs = 420,
  from,
  testId,
  className,
  as = "span",
}: ScoreTransitionProps) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState<number>(from ?? value);
  const shownRef = useRef<number>(from ?? value);
  const frame = useRef<number | null>(null);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    const start = shownRef.current;
    if (reduced || start === value || durationMs <= 0) {
      shownRef.current = value;
      setShown(value);
      setMoving(false);
      return;
    }
    const startedAt = performance.now();
    setMoving(true);
    const step = (now: number) => {
      const t = Math.min(1, (now - startedAt) / durationMs);
      const next = start + (value - start) * easeOut(t);
      shownRef.current = next;
      setShown(next);
      if (t < 1) {
        frame.current = window.requestAnimationFrame(step);
      } else {
        shownRef.current = value;
        setShown(value);
        setMoving(false);
      }
    };
    frame.current = window.requestAnimationFrame(step);
    return () => {
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    };
  }, [value, durationMs, reduced]);

  const Tag = as;
  return (
    <Tag className={className} data-testid={testId} data-transitioning={moving ? "true" : "false"} data-value={value}>
      {format(shown)}
    </Tag>
  );
}
