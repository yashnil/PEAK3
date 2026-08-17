/**
 * PeakV2Score — INSTRUMENTATION role: a numeric result. Credits, bids, a
 * lane rating, a round tally, a lifetime record. Tabular mono figures,
 * same family as `PeakV2Timer` — a score and a clock beside each other
 * must read as the same instrument, never two different typographic
 * systems sharing a screen.
 */

import type { V2Tone } from "./v2-tone";
import { v2ToneVar } from "./v2-tone";

export interface PeakV2ScoreProps {
  value: string | number;
  label?: string;
  tone?: V2Tone;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_REM: Record<NonNullable<PeakV2ScoreProps["size"]>, string> = {
  sm: "1rem",
  md: "1.375rem",
  lg: "2.25rem",
};

export default function PeakV2Score({
  value,
  label,
  tone = "neutral",
  size = "md",
  className,
}: PeakV2ScoreProps) {
  const color = v2ToneVar(tone) ?? "var(--v2-text-primary)";
  return (
    <div className={`inline-flex flex-col items-start ${className ?? ""}`}>
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
        style={{
          fontFamily: "var(--v2-font-mono)",
          fontVariantNumeric: "tabular-nums",
          fontFeatureSettings: "var(--v2-mono-feature)",
          letterSpacing: "var(--v2-mono-track)",
          fontWeight: 700,
          fontSize: SIZE_REM[size],
          color,
        }}
      >
        {value}
      </span>
    </div>
  );
}
