/**
 * PeakV2DataLane — a single labeled comparison row, in the real Arena
 * Light reference's own grammar (Pass 2.5, product-direction, verified
 * against `.claude-private/design/PEAK3-Directions-E.pdf` pages 16-17,
 * 22-23: RTT's lane-by-lane boss result and Peak Duel's component
 * breakdown use the identical dot-on-a-line row).
 *
 * `variant="line"` (the default, and the corrected reading of the real
 * reference) — one thin horizontal rule per row; a FILLED, tone-colored
 * dot for one side and a HOLLOW neutral dot for the other, both
 * positioned along the rule proportional to their actual magnitude (a
 * real dot-plot, not two dots at fixed ends) — exact numeric values stay
 * printed at both ends regardless.
 *
 * WHAT A FILLED DOT MEANS is chosen by `fill`, because the two surfaces
 * that use this row genuinely mean different things by it:
 *
 *   `fill="role"` (default) — fill follows `pickedSide`, a ROLE marker:
 *   "the side the caller designates as primary". RTT's boss result, the
 *   Showdown result and the homepage proof lanes all read this way, and
 *   the `"left"` default keeps every pre-existing caller pixel-identical.
 *
 *   `fill="higher"` — fill follows the DATA: on each lane independently,
 *   the greater value is filled and the lesser is hollow. This is Peak
 *   Duel's component comparison, where the question a reader is actually
 *   asking of a lane is "who was better at THIS?" — an answer that must
 *   not change with which player they clicked, who won overall, or which
 *   side a name was dealt to. A lane whose two values are equal at the
 *   precision actually displayed is a TIE and renders neutral.
 *
 * The optional `leftCaption`/`rightCaption` text states an outcome in
 * words; under `fill="role"` the dot never does.
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
  /** `variant="line"` only — which side's dot renders FILLED when
   *  `fill="role"` (the default): a role marker — "primary"/"the side the
   *  caller designates" — never an outcome marker. `"none"` renders both
   *  dots hollow, for use before any side has been chosen. Defaults to
   *  `"left"`, matching this component's original fixed behavior, so
   *  existing callers are unaffected. Ignored when `fill="higher"`.
   *
   *  "The side the caller designates" can legitimately be an outcome, as long
   *  as it is a CONSTANT one — Peak Duel's reveal passes the overall matchup
   *  winner here, the same side on all five lanes. What it must never be is a
   *  PER-LANE outcome; that is what `fill="higher"` is for, and why the two
   *  are separate props. */
  pickedSide?: "left" | "right" | "none";
  /** `variant="line"` only — WHAT a filled dot means on this lane.
   *
   *  `"role"` (default): fill follows `pickedSide`. Kept as the default so
   *  the lanes that genuinely mark a role rather than an outcome (RTT's
   *  boss result, the Showdown result, the homepage proof lanes) keep
   *  their exact existing rendering.
   *
   *  `"higher"`: fill follows the DATA — the side with the greater value
   *  on THIS lane is filled and the other is hollow, computed per-lane and
   *  independent of selection, of the overall winner, and of which side a
   *  value happens to be printed on. Values that are equal at the
   *  precision actually shown to the reader are a TIE and render neutral
   *  (both hollow) rather than silently promoting one side.
   *
   *  NO CURRENT PRODUCT CALLER, and that is deliberate rather than an
   *  oversight. Peak Duel's reveal used to be the one caller and has moved
   *  back to `"role"`: dot POSITION on these lanes already encodes magnitude,
   *  so filling by magnitude too made the two channels redundant and, on a
   *  lane the overall winner lost, actively misleading — the loser's larger
   *  value sat further right AND filled, reading as "that side won". Keep this
   *  mode only for a surface where the dot's position is NOT magnitude. */
  fill?: "role" | "higher";
  /** `variant="line"` only — secondary outcome text under each side, e.g.
   *  "Lane won +5.1" / "Wall +4.4" / "Closest". Never affects which dot is
   *  filled — that is controlled by `pickedSide`, not outcome. */
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

function Dot({ pct, filled, toneColor }: { pct: number; filled: boolean; toneColor: string }) {
  return (
    <span
      className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
      style={
        filled
          ? { left: `${pct}%`, width: 9, height: 9, background: toneColor }
          : { left: `${pct}%`, width: 8, height: 8, border: "1.5px solid var(--v2-text-muted)", background: "var(--v2-bg-page)" }
      }
    />
  );
}

function LineRule({
  toneColor,
  leftPct,
  rightPct,
  leftFilled,
  rightFilled,
}: {
  toneColor: string;
  leftPct: number | null;
  rightPct: number | null;
  leftFilled: boolean;
  rightFilled: boolean;
}) {
  // Render the hollow dot first and the filled one last (on top) so two
  // dots landing at (near-)identical positions still read as "filled wins
  // the overlap" — matches the original left-always-filled stacking order
  // when the left dot is filled, mirrors it when the right one is, and
  // order is moot when neither is (a tie, or no side chosen).
  const renderRightFirst = !rightFilled;
  const leftDot = leftPct !== null ? <Dot key="left" pct={leftPct} filled={leftFilled} toneColor={toneColor} /> : null;
  const rightDot = rightPct !== null ? <Dot key="right" pct={rightPct} filled={rightFilled} toneColor={toneColor} /> : null;
  return (
    <div className="relative h-4 w-full min-w-[96px]" aria-hidden="true">
      <div
        className="absolute left-0 right-0 top-1/2 -translate-y-1/2"
        style={{ height: 1, background: "var(--v2-border)" }}
      />
      {renderRightFirst ? (
        <>
          {rightDot}
          {leftDot}
        </>
      ) : (
        <>
          {leftDot}
          {rightDot}
        </>
      )}
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
  pickedSide = "left",
  fill = "role",
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

  // WHICH DOT IS FILLED.
  //
  // Under `fill="higher"` the comparison is made at the precision the
  // reader can actually SEE. Comparing the underlying floats instead would
  // fill one dot of two lanes both printed "5.7" purely on a difference
  // that is not on screen — the reader would have no way to tell a real
  // lane win from a rounding artifact, and the lane would be claiming
  // something the numbers beside it do not support. So when both sides
  // render as the same string, this is a tie: both dots stay hollow and
  // neither side is promoted.
  let leftFilled: boolean;
  let rightFilled: boolean;
  if (fill === "higher") {
    const comparable =
      rightRaw !== undefined && !Number.isNaN(leftRaw) && !Number.isNaN(rightRaw);
    const displayedEqual = String(leftValue) === String(rightValue);
    leftFilled = comparable && !displayedEqual && leftRaw > (rightRaw as number);
    rightFilled = comparable && !displayedEqual && (rightRaw as number) > leftRaw;
  } else {
    leftFilled = pickedSide === "left";
    rightFilled = pickedSide === "right";
  }

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
        <LineRule toneColor={toneColor} leftPct={leftPct} rightPct={rightPct} leftFilled={leftFilled} rightFilled={rightFilled} />
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
          <LineRule toneColor={toneColor} leftPct={leftPct} rightPct={rightPct} leftFilled={leftFilled} rightFilled={rightFilled} />
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
