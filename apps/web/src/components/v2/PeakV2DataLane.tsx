/**
 * PeakV2DataLane — a single labeled two-sided comparison row: the "YOU
 * <lane rating> vs BOSS <lane rating>" shape (brief: RTT's "clean five-lane
 * analytical comparison"). Generic enough for any real two-sided
 * comparison PEAK3 already has authoritative numbers for — not RTT-only.
 *
 * `tone` should be one of the five real component tones when the lane IS
 * that component's data (Statistical Impact, Traditional Production, …) —
 * this is the primitive's actual reason to exist: encode real data with
 * real color, never a decorative rainbow. Alignment/whitespace carries the
 * left/right structure; no card, no border, no pill.
 */

import type { V2Tone } from "./v2-tone";
import { v2ToneVar } from "./v2-tone";

export interface PeakV2DataLaneProps {
  label: string;
  tone?: V2Tone;
  leftLabel: string;
  leftValue: string | number;
  rightLabel: string;
  rightValue: string | number;
  /** `"left"` / `"right"` highlights that side's value in the tone color;
   *  `"tie"` / `undefined` renders both neutral. */
  winner?: "left" | "right" | "tie";
  className?: string;
}

export default function PeakV2DataLane({
  label,
  tone = "neutral",
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
  winner,
  className,
}: PeakV2DataLaneProps) {
  const toneColor = v2ToneVar(tone);
  return (
    <div className={`grid grid-cols-[1fr_auto_1fr] items-center gap-3 ${className ?? ""}`}>
      <div className="flex flex-col items-start">
        <span
          style={{
            fontFamily: "var(--v2-font-ui)",
            fontSize: "0.75rem",
            color: "var(--v2-text-secondary)",
          }}
        >
          {leftLabel}
        </span>
        <span
          style={{
            fontFamily: "var(--v2-font-mono)",
            fontVariantNumeric: "tabular-nums",
            fontWeight: 700,
            fontSize: "1.125rem",
            color: winner === "left" ? (toneColor ?? "var(--v2-color-accent)") : "var(--v2-text-primary)",
          }}
        >
          {leftValue}
        </span>
      </div>

      <span
        style={{
          fontFamily: "var(--v2-font-ui)",
          fontSize: "0.6875rem",
          fontWeight: 700,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: toneColor ?? "var(--v2-text-muted)",
          textAlign: "center",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>

      <div className="flex flex-col items-end text-right">
        <span
          style={{
            fontFamily: "var(--v2-font-ui)",
            fontSize: "0.75rem",
            color: "var(--v2-text-secondary)",
          }}
        >
          {rightLabel}
        </span>
        <span
          style={{
            fontFamily: "var(--v2-font-mono)",
            fontVariantNumeric: "tabular-nums",
            fontWeight: 700,
            fontSize: "1.125rem",
            color: winner === "right" ? (toneColor ?? "var(--v2-color-accent)") : "var(--v2-text-primary)",
          }}
        >
          {rightValue}
        </span>
      </div>
    </div>
  );
}
