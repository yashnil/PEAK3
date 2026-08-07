"use client";

/**
 * A score / index / points readout.
 *
 * Always renders through `.score-number` (tabular numerals, frozen class), so a
 * column of scores never jitters as digits change. Naming discipline (CLAUDE.md):
 * this component displays a value, it never computes one — pass `arena_points`,
 * `prime_score` or `prime_index` straight from the API.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AnimatedNumber } from "./AnimatedNumber";

export type ScorePillTone = "neutral" | "accent" | "positive" | "negative";
export type ScorePillSize = "sm" | "md" | "lg";

const TONE_COLOR: Record<ScorePillTone, string> = {
  neutral: "var(--text-primary)",
  accent: "var(--peak-accent)",
  positive: "var(--correct)",
  negative: "var(--incorrect)",
};

const TONE_BORDER: Record<ScorePillTone, string> = {
  neutral: "var(--border-default)",
  accent: "var(--peak-accent-dim)",
  positive: "var(--correct-dim)",
  negative: "var(--incorrect-dim)",
};

/* LABEL SIZES RAISED, DELIBERATELY.
   These were 9px and 10px. A 9px uppercase label at `--text-muted` is not a
   quiet label, it is an unreadable one — and "PRIME SCORE" under a number is
   the thing that tells you WHAT the number is, which makes it load-bearing
   rather than tertiary. Raised to 10/11/12 and moved to `--text-secondary`
   below. The number keeps its size; only the caption changes, so no layout
   that depends on the pill's height moves more than a pixel. */
const SIZE: Record<ScorePillSize, { value: number; label: number; padding: string }> = {
  sm: { value: 13, label: 10, padding: "3px 8px" },
  md: { value: 16, label: 11, padding: "5px 10px" },
  lg: { value: 22, label: 12, padding: "7px 14px" },
};

export interface ScorePillProps {
  /** The value to show. Numbers are formatted with `precision`. */
  value: number | string;
  /** Small caption under/next to the number ("PRIME SCORE", "PTS"). */
  label?: ReactNode;
  tone?: ScorePillTone;
  size?: ScorePillSize;
  /** Decimal places for numeric values. Ignored for string values. */
  precision?: number;
  /** Count up to `value`. Numeric values only; jumps under reduced motion. */
  animate?: boolean;
  /** Draw the border + background. Off gives a bare number. */
  bordered?: boolean;
  className?: string;
  "data-testid"?: string;
}

export function ScorePill({
  value,
  label,
  tone = "neutral",
  size = "md",
  precision = 1,
  animate = false,
  bordered = true,
  className,
  "data-testid": testId,
}: ScorePillProps) {
  const s = SIZE[size];
  const numeric = typeof value === "number" && Number.isFinite(value);

  return (
    <span
      data-testid={testId}
      data-tone={tone}
      className={cn("inline-flex items-baseline", className)}
      style={{
        gap: "var(--pk-space-2, 8px)",
        color: TONE_COLOR[tone],
        padding: bordered ? s.padding : undefined,
        border: bordered ? `1px solid ${TONE_BORDER[tone]}` : undefined,
        borderRadius: bordered ? "var(--pk-r-md, 10px)" : undefined,
        background: bordered ? "var(--pk-surface-inset, var(--bg-elevated))" : undefined,
        // A lit top edge, so a bordered pill reads as a struck plate rather
        // than a rectangle. Costs nothing when `bordered` is off.
        boxShadow: bordered ? "var(--pk-rim)" : undefined,
      }}
    >
      {animate && numeric ? (
        /* THE `size` PROP USED TO BE DROPPED HERE. The static branch below
           sets `fontSize: s.value`; this one did not, so every ANIMATED score
           pill rendered at whatever font size it happened to inherit — a
           `size="lg"` pill counting up was 22px before the animation was
           requested and inherited-body-size after. The two branches are meant
           to differ in how the number arrives, not in how large it is.

           `.pk-counting` is the accompanying treatment: it keys off
           `AnimatedNumber`'s own `data-settled` attribute, so the digits carry
           accent ink while they are resolving and return to their tone when
           they land. No timer of its own to fall out of sync. */
        <AnimatedNumber
          value={value}
          precision={precision}
          className="pk-counting font-display font-bold leading-none"
          style={{ fontSize: s.value }}
        />
      ) : (
        <span
          className="score-number font-display font-bold leading-none"
          style={{ fontSize: s.value }}
        >
          {numeric ? (value as number).toFixed(precision) : value}
        </span>
      )}
      {label ? (
        <span
          className="font-bold uppercase leading-none"
          style={{
            // WAS `--text-muted`. This caption names the number beside it;
            // that is not tertiary metadata, and at this size the muted tier
            // was the difference between a quiet label and an unreadable one.
            color: "var(--text-secondary)",
            fontSize: s.label,
            letterSpacing: "var(--pk-track-eyebrow, 0.1em)",
          }}
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}

export default ScorePill;
