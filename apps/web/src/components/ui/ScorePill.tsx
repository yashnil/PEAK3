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

const SIZE: Record<ScorePillSize, { value: number; label: number; padding: string }> = {
  sm: { value: 13, label: 9, padding: "3px 8px" },
  md: { value: 16, label: 10, padding: "5px 10px" },
  lg: { value: 22, label: 10, padding: "7px 14px" },
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
      }}
    >
      {animate && numeric ? (
        <AnimatedNumber
          value={value}
          precision={precision}
          className="font-bold leading-none"
        />
      ) : (
        <span className="score-number font-bold leading-none" style={{ fontSize: s.value }}>
          {numeric ? (value as number).toFixed(precision) : value}
        </span>
      )}
      {label ? (
        <span
          className="font-bold uppercase leading-none tracking-[0.1em]"
          style={{ color: "var(--text-muted)", fontSize: s.label }}
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}

export default ScorePill;
