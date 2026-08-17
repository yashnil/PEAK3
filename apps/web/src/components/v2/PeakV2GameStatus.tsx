"use client";

/**
 * PeakV2GameStatus — "YOUR TURN", "LIVE", "WAITING", "REVEALING". A phase
 * indicator, not a badge: a small tone-colored dot plus a compact mono
 * label, no pill chrome, no border, no background fill — the brief's
 * explicit anti-pattern is "reduce excessive… pills, badges… tiny
 * uppercase metadata." This is the one place V2 still needs an uppercase
 * micro-label (a live phase genuinely is short, discrete state), so it
 * earns its keep by carrying real state, not decorating a data value that
 * already speaks for itself.
 */

import { usePrefersReducedMotion } from "@/lib/a11y";

export interface PeakV2GameStatusProps {
  label: string;
  /** `"active"` renders a soft pulse (your turn / live) — collapses under
   *  reduced motion, per every other pulsing primitive in this system. */
  state?: "active" | "idle";
  className?: string;
}

export default function PeakV2GameStatus({ label, state = "idle", className }: PeakV2GameStatusProps) {
  const reducedMotion = usePrefersReducedMotion();
  return (
    <div className={`inline-flex items-center gap-1.5 ${className ?? ""}`}>
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: state === "active" ? "var(--v2-color-accent)" : "var(--v2-text-muted)",
          animation:
            state === "active" && !reducedMotion
              ? "v2-arena-light-pulse 1.6s ease-in-out infinite"
              : "none",
        }}
      />
      <span
        style={{
          fontFamily: "var(--v2-font-mono)",
          fontSize: "0.6875rem",
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: state === "active" ? "var(--v2-text-primary)" : "var(--v2-text-muted)",
        }}
      >
        {label}
      </span>
    </div>
  );
}
