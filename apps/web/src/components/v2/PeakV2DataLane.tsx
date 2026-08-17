/**
 * PeakV2DataLane — a single labeled comparison row, in the real Arena
 * Light reference's own grammar (Pass 2.5, product-direction, verified
 * against `.claude-private/design/PEAK3-Directions-E.pdf` pages 16-17,
 * 22-23: RTT's lane-by-lane boss result and Peak Duel's component
 * breakdown use the identical dot-on-a-line row).
 *
 * `variant="line"` (the default, and the corrected reading of the real
 * reference) — one thin horizontal rule per row; a FILLED, tone-colored
 * dot for the primary/current/user value; a HOLLOW neutral dot for the
 * comparison/opponent value; both positioned along the rule proportional
 * to their actual magnitude (a real dot-plot, not two dots at fixed
 * ends) — exact numeric values stay printed at both ends regardless. The
 * filled dot ALWAYS marks the primary side, whichever side is actually
 * winning: fill is a ROLE marker (you vs. them), not an outcome marker —
 * the optional `leftCaption`/`rightCaption` text is what states the
 * outcome ("Lane won +5.1", "Wall +4.4").
 *
 * `variant="paired"` — the original Pass 2 paired-bold-number treatment.
 * Kept, not removed: nothing in production consumed it yet at the time of
 * this correction, but it remains a legitimate secondary reading (an
 * immediate "whose number is bigger" glance) and the brief's own
 * instruction was additive ("add an explicit variant if needed"), not a
 * mandate to delete the prior shape.
 *
 * Single-value mode: omit `rightValue` to render one filled dot alone —
 * "single-value component visualization where useful" (brief).
 */

import type { V2Tone } from "./v2-tone";
import { v2ToneVar } from "./v2-tone";

export interface PeakV2DataLaneProps {
  label: string;
  tone?: V2Tone;
  variant?: "line" | "paired";
  leftLabel: string;
  leftValue: string | number;
  rightLabel?: string;
  rightValue?: string | number;
  /** `"left"` / `"right"` highlights that side's value in the tone color
   *  (`variant="paired"`); `"tie"` / `undefined` renders both neutral. */
  winner?: "left" | "right" | "tie";
  /** `variant="line"` only — secondary outcome text under each side, e.g.
   *  "Lane won +5.1" / "Wall +4.4" / "Closest". Never affects which dot is
   *  filled — that is fixed by role (left = primary), not outcome. */
  leftCaption?: string;
  rightCaption?: string;
  /** `variant="line"` only — the scale the dot POSITIONS are computed
   *  against (not the display strings, which may be pre-formatted).
   *  Defaults to 0-100, the engine's own lane-rating domain per the
   *  reference's "ENGINE LANE RATING 0-100" caption. Override for a
   *  different real domain (e.g. a duel's prime-score range). */
  scaleMin?: number;
  scaleMax?: number;
  /** `variant="line"` only — the raw numbers used for dot placement, when
   *  `leftValue`/`rightValue` are pre-formatted display strings (e.g.
   *  "$7") rather than plain numbers `Number()` can parse directly. */
  leftPosition?: number;
  rightPosition?: number;
  className?: string;
}

function dotPercent(raw: number | undefined, scaleMin: number, scaleMax: number): number | null {
  if (raw === undefined || Number.isNaN(raw)) return null;
  const span = scaleMax - scaleMin;
  if (span <= 0) return null;
  const pct = ((raw - scaleMin) / span) * 100;
  // Clamped short of the true edges so a dot at the domain's extreme never
  // renders half-clipped off the rule.
  return Math.min(96, Math.max(4, pct));
}

function ValueBlock({
  label,
  value,
  caption,
  align,
  color,
}: {
  label: string;
  value: string | number;
  caption?: string;
  align: "start" | "end";
  color: string;
}) {
  return (
    <div className={`flex flex-col ${align === "end" ? "items-end text-right" : "items-start text-left"}`}>
      <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-secondary)" }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--v2-font-mono)",
          fontVariantNumeric: "tabular-nums",
          fontFeatureSettings: "var(--v2-mono-feature)",
          fontWeight: 700,
          fontSize: "1.125rem",
          color,
        }}
      >
        {value}
      </span>
      {caption ? (
        <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.6875rem", color: "var(--v2-text-muted)" }}>
          {caption}
        </span>
      ) : null}
    </div>
  );
}

function LineRule({
  toneColor,
  leftPct,
  rightPct,
}: {
  toneColor: string;
  leftPct: number | null;
  rightPct: number | null;
}) {
  return (
    <div className="relative h-4 w-full min-w-[96px]" aria-hidden="true">
      <div
        className="absolute left-0 right-0 top-1/2 -translate-y-1/2"
        style={{ height: 1, background: "var(--v2-border)" }}
      />
      {rightPct !== null ? (
        <span
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${rightPct}%`, width: 8, height: 8, border: "1.5px solid var(--v2-text-muted)", background: "var(--v2-bg-page)" }}
        />
      ) : null}
      {leftPct !== null ? (
        <span
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${leftPct}%`, width: 9, height: 9, background: toneColor }}
        />
      ) : null}
    </div>
  );
}

export default function PeakV2DataLane({
  label,
  tone = "neutral",
  variant = "line",
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
  winner,
  leftCaption,
  rightCaption,
  scaleMin = 0,
  scaleMax = 100,
  leftPosition,
  rightPosition,
  className,
}: PeakV2DataLaneProps) {
  const toneColor = v2ToneVar(tone) ?? "var(--v2-color-accent)";

  if (variant === "paired") {
    return (
      <div className={`grid grid-cols-[1fr_auto_1fr] items-center gap-3 ${className ?? ""}`}>
        <ValueBlock
          label={leftLabel}
          value={leftValue}
          align="start"
          color={winner === "left" ? toneColor : "var(--v2-text-primary)"}
        />
        <span
          style={{
            fontFamily: "var(--v2-font-ui)",
            fontSize: "0.6875rem",
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: v2ToneVar(tone) ?? "var(--v2-text-muted)",
            textAlign: "center",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        <ValueBlock
          label={rightLabel ?? ""}
          value={rightValue ?? ""}
          align="end"
          color={winner === "right" ? toneColor : "var(--v2-text-primary)"}
        />
      </div>
    );
  }

  const leftRaw = leftPosition ?? Number(leftValue);
  const rightRaw = rightValue === undefined ? undefined : rightPosition ?? Number(rightValue);
  const leftPct = dotPercent(leftRaw, scaleMin, scaleMax);
  const rightPct = rightRaw === undefined ? null : dotPercent(rightRaw, scaleMin, scaleMax);

  return (
    <div className={className}>
      {/* Mobile: values above, line below — brief's explicit mobile grammar. */}
      <div className="flex flex-col gap-1.5 sm:hidden">
        <div className="flex items-start justify-between gap-3">
          <ValueBlock label={leftLabel} value={leftValue} caption={leftCaption} align="start" color="var(--v2-text-primary)" />
          {rightValue !== undefined ? (
            <ValueBlock label={rightLabel ?? ""} value={rightValue} caption={rightCaption} align="end" color="var(--v2-text-primary)" />
          ) : null}
        </div>
        <span
          style={{
            fontFamily: "var(--v2-font-ui)",
            fontSize: "0.6875rem",
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: toneColor,
          }}
        >
          {label}
        </span>
        <LineRule toneColor={toneColor} leftPct={leftPct} rightPct={rightPct} />
      </div>

      {/* Desktop: values flank the line, per the reference. */}
      <div className="hidden sm:grid sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-4">
        <ValueBlock label={leftLabel} value={leftValue} caption={leftCaption} align="start" color="var(--v2-text-primary)" />
        <div className="flex flex-col gap-1">
          <span
            style={{
              fontFamily: "var(--v2-font-ui)",
              fontSize: "0.6875rem",
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: toneColor,
            }}
          >
            {label}
          </span>
          <LineRule toneColor={toneColor} leftPct={leftPct} rightPct={rightPct} />
        </div>
        {rightValue !== undefined ? (
          <ValueBlock label={rightLabel ?? ""} value={rightValue} caption={rightCaption} align="end" color="var(--v2-text-primary)" />
        ) : (
          <div />
        )}
      </div>
    </div>
  );
}
