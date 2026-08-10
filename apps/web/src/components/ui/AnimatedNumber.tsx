"use client";

/**
 * A number that counts to its new value.
 *
 * Two non-negotiable rules, both about not lying to the user:
 *
 * 1. **It settles on the authoritative value exactly.** The final frame assigns
 *    `value` itself, never an interpolated approximation, so a displayed score
 *    is always the server's number and never a rounding of a tween.
 *
 * 2. **The accessible text is correct from the first paint.** The animating
 *    text is `aria-hidden`; a visually-hidden sibling carries the exact final
 *    value immediately. A screen-reader or copy-paste user never waits on an
 *    animation to learn the number, which is the usual way count-up components
 *    become an accessibility defect.
 *
 * Under `prefers-reduced-motion` it jumps straight to the value — no tween is
 * ever scheduled.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/lib/a11y";
import { MOTION_DURATION_MS } from "@/lib/motion";

export interface AnimatedNumberProps {
  /** The authoritative value. The animation always ends exactly here. */
  value: number;
  /** Tween length in ms. Defaults to `--pk-dur-slower` (480ms). */
  durationMs?: number;
  /** Decimal places, when no `format` is supplied. */
  precision?: number;
  /** Full control over rendering. Must be a pure function of the number. */
  format?: (value: number) => string;
  prefix?: string;
  suffix?: string;
  className?: string;
  /**
   * Applied to the root span.
   *
   * Exists because a caller that controls the number's SIZE could not
   * previously say so: `ScorePill` sizes its static branch with an inline
   * `fontSize` and had no way to size this one, so every animated pill
   * silently rendered at its inherited size.
   */
  style?: CSSProperties;
  "data-testid"?: string;
}

function defaultFormat(value: number, precision: number): string {
  return value.toFixed(precision);
}

export function AnimatedNumber({
  value,
  durationMs = MOTION_DURATION_MS.slower,
  precision = 0,
  format,
  prefix = "",
  suffix = "",
  className,
  style,
  "data-testid": testId,
}: AnimatedNumberProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [display, setDisplay] = useState(value);
  // The tween's starting point. Kept in a ref so a value change mid-flight
  // continues from where the eye currently is rather than snapping back.
  const displayRef = useRef(value);

  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    if (reducedMotion || durationMs <= 0) {
      displayRef.current = value;
      setDisplay(value);
      return;
    }

    const from = displayRef.current;
    if (from === value) return;

    const start =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    let frame = 0;

    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      // ease-out cubic — fast then settling, matching --pk-ease-out.
      const eased = 1 - Math.pow(1 - t, 3);
      // Rule 1: the terminal frame is the authoritative value verbatim.
      const next = t >= 1 ? value : from + (value - from) * eased;
      displayRef.current = next;
      setDisplay(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs, reducedMotion]);

  const render = (n: number) => `${prefix}${format ? format(n) : defaultFormat(n, precision)}${suffix}`;
  const finalText = render(value);

  return (
    <span
      className={cn("score-number", className)}
      style={style}
      data-testid={testId}
      data-value={String(value)}
      data-settled={display === value ? "true" : "false"}
    >
      <span aria-hidden="true" data-pk-animated-number-visual="">
        {render(display)}
      </span>
      {/* Rule 2: the real value, available to assistive tech immediately. */}
      <span className="sr-only">{finalText}</span>
    </span>
  );
}

export default AnimatedNumber;
