"use client";

/**
 * PeakV2Timer — INSTRUMENTATION role: a countdown clock. Pick clocks, bid
 * timers, the Peak Duel decision clock. Tabular mono figures so the digits
 * never reflow the surrounding layout as they tick.
 *
 * Deliberately dumb: it renders a number this render was given, it does not
 * run its own interval. The countdown authority (a deadline timestamp, a
 * reducer tick) stays wherever the game's existing timing semantics already
 * live — this primitive never becomes a second clock a screen could
 * disagree with itself about.
 */

import { usePrefersReducedMotion } from "@/lib/a11y";

export interface PeakV2TimerProps {
  secondsRemaining: number;
  /** When set, the timer reads as urgent (accent/negative tone, a slow
   *  pulse under normal motion) once `secondsRemaining` drops to or below
   *  this value. */
  urgentAtSeconds?: number;
  label?: string;
  size?: "md" | "lg";
  className?: string;
}

export default function PeakV2Timer({
  secondsRemaining,
  urgentAtSeconds,
  label,
  size = "md",
  className,
}: PeakV2TimerProps) {
  const reducedMotion = usePrefersReducedMotion();
  const urgent = urgentAtSeconds !== undefined && secondsRemaining <= urgentAtSeconds;
  const clamped = Math.max(0, secondsRemaining);
  return (
    <div
      role="timer"
      aria-live="off"
      className={`inline-flex items-baseline gap-1.5 ${className ?? ""}`}
    >
      {label ? (
        <span
          style={{
            fontFamily: "var(--v2-font-ui)",
            fontSize: "0.6875rem",
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--v2-text-muted)",
          }}
        >
          {label}
        </span>
      ) : null}
      <span
        data-testid="peak-v2-timer-value"
        style={{
          fontFamily: "var(--v2-font-mono)",
          fontVariantNumeric: "tabular-nums",
          fontFeatureSettings: "var(--v2-mono-feature)",
          letterSpacing: "var(--v2-mono-track)",
          fontWeight: 600,
          fontSize: size === "lg" ? "1.75rem" : "1.125rem",
          color: urgent ? "var(--v2-color-negative)" : "var(--v2-text-primary)",
          animation:
            urgent && !reducedMotion ? "v2-arena-light-pulse 1.1s ease-in-out infinite" : "none",
        }}
      >
        {clamped}
      </span>
    </div>
  );
}
