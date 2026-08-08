"use client";

/**
 * A number that arrives by counting to itself.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT SIMPLY `AnimatedNumber`. `AnimatedNumber`
 * tweens between two values of its `value` prop, and it deliberately does NOT
 * animate on mount — its effect returns early when `from === value`. That is
 * the right default nearly everywhere: a rankings row whose score ticks up
 * every time it scrolls into view is noise, not feedback.
 *
 * A RESULT is the opposite case. The number arrives with the screen, it is the
 * thing the player just played for, and printing it silently at its final
 * value is the single biggest reason these recap screens read as a report
 * rather than as a payoff. So this component holds `0` for exactly one commit
 * and then hands `AnimatedNumber` the authoritative value, which is the one
 * thing that makes it tween.
 *
 * THE ZERO IS NEVER PAINTED IN THE BROWSER — WITH ONE STATED LIMIT. The
 * hand-off runs in a LAYOUT effect, which React flushes before the browser
 * paints, so on the client no frame shows a zero score and `AnimatedNumber`'s
 * screen-reader sibling carries the real value from the first painted frame
 * onward. (A plain `useEffect` here would paint one frame of `0` — small, but
 * it is the difference between decoration over a result and a result that
 * briefly lies.) Under `prefers-reduced-motion` `AnimatedNumber` never
 * schedules a tween at all, so the same hand-off just assigns the value and
 * nothing moves.
 *
 * THE LIMIT, STATED RATHER THAN GLOSSED: the SERVER-RENDERED HTML contains
 * `0`, including in the visually-hidden sibling, because `useState(0)` is the
 * initial render and layout effects do not run during SSR. Hydration matches
 * (the client's first render is also `0`) and the real value lands before the
 * first client paint, so this is not observable in the product — every surface
 * using this component is a post-gameplay result screen that cannot be reached
 * without JavaScript. It would become observable the moment one of these
 * numbers appeared on a server-rendered page a visitor could read without
 * hydrating, and at that point this component is the wrong tool: pass the
 * authoritative value to `AnimatedNumber` directly and accept no count-up.
 *
 * `.pk-counting` is applied permanently and keys off `AnimatedNumber`'s own
 * `data-settled` attribute, so the digits carry accent ink only while they are
 * resolving. There is one clock — the component's — and no second timer to
 * fall out of sync with it.
 *
 * WHERE IT LIVES. Peak Duel, Run the Table, the Daily Grid recap and the
 * progression moments all need exactly this behaviour and none of them owns a
 * directory the others can import from. It sits with the game surface that
 * needed it first rather than being pasted into five files.
 */

import {
  useEffect,
  useLayoutEffect,
  useState,
  type CSSProperties,
} from "react";

/* DEEP IMPORT, NOT THE `@/components/ui` BARREL — and this is a measured
   decision rather than a style preference. The barrel re-exports
   `ThemeToggle`, which imports `lucide-react`; pulling `AnimatedNumber`
   through it dragged that whole dependency into the Peak Duel route and took
   `/play/daily`'s First Load JS from 176 kB to 250 kB. Barrels are convenient
   at the call site and invisible in the diff exactly where they are most
   expensive. Import the module. */
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { cn } from "@/lib/utils";
import { MOTION_DURATION_MS } from "@/lib/motion";

/** `useLayoutEffect` warns when it runs during SSR; on the server the effect
 *  would be a no-op anyway, so fall back to `useEffect` there. Aliased once at
 *  module scope, never chosen per render, so the hook order is stable. */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface ResultNumberProps {
  /** The authoritative value. The count always ends exactly here. */
  value: number;
  /** Decimal places, when no `format` is given. */
  precision?: number;
  /** Full control over rendering. Must be a pure function of the number. */
  format?: (value: number) => string;
  prefix?: string;
  suffix?: string;
  /** Tween length. Defaults to `--pk-dur-count` (600ms), the token the rest of
   *  the cinematic surfaces already count with. */
  durationMs?: number;
  className?: string;
  style?: CSSProperties;
  "data-testid"?: string;
}

export function ResultNumber({
  value,
  precision = 0,
  format,
  prefix,
  suffix,
  durationMs = MOTION_DURATION_MS.count,
  className,
  style,
  "data-testid": testId,
}: ResultNumberProps) {
  const [target, setTarget] = useState(0);

  useIsomorphicLayoutEffect(() => {
    setTarget(value);
  }, [value]);

  return (
    <AnimatedNumber
      value={target}
      precision={precision}
      format={format}
      prefix={prefix}
      suffix={suffix}
      durationMs={durationMs}
      className={cn("pk-counting", className)}
      style={style}
      data-testid={testId}
    />
  );
}

export default ResultNumber;
