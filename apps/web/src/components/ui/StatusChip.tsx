"use client";

/**
 * A small state label — "Daily", "In progress", "Not eligible", "Boss".
 *
 * Tone is semantic, not decorative: it maps onto the existing frozen state
 * tokens (`--correct`, `--incorrect`, `--peak-accent`, …) so a chip can never
 * introduce a colour the rest of the app does not already use. Colour is never
 * the only signal — the chip always carries text.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StatusChipTone =
  | "neutral"
  | "accent"
  | "positive"
  | "negative"
  | "info"
  | "muted";

export type StatusChipSize = "sm" | "md";

interface ToneStyle {
  color: string;
  background: string;
  border: string;
}

const TONES: Record<StatusChipTone, ToneStyle> = {
  neutral: {
    color: "var(--text-secondary)",
    background: "var(--pk-surface-raised, var(--bg-surface))",
    border: "var(--border-default)",
  },
  accent: {
    color: "var(--peak-accent)",
    background: "var(--peak-accent-bg)",
    border: "var(--peak-accent-dim)",
  },
  positive: {
    color: "var(--correct)",
    background: "var(--correct-bg)",
    border: "var(--correct-dim)",
  },
  negative: {
    color: "var(--incorrect)",
    background: "var(--incorrect-bg)",
    border: "var(--incorrect-dim)",
  },
  info: {
    color: "var(--comp-si)",
    background: "var(--pk-surface-inset, var(--bg-elevated))",
    border: "var(--border-emphasis)",
  },
  muted: {
    color: "var(--text-muted)",
    background: "transparent",
    border: "var(--border-subtle)",
  },
};

const SIZES: Record<StatusChipSize, { fontSize: number; padding: string; gap: string }> = {
  sm: { fontSize: 10, padding: "2px 7px", gap: "var(--pk-space-1, 4px)" },
  md: { fontSize: 11, padding: "4px 10px", gap: "var(--pk-space-1, 4px)" },
};

export interface StatusChipProps {
  children: ReactNode;
  tone?: StatusChipTone;
  size?: StatusChipSize;
  /** Decorative leading glyph. Rendered `aria-hidden`. */
  icon?: ReactNode;
  /** Uppercase + letterspacing, for eyebrow-style chips. */
  uppercase?: boolean;
  className?: string;
  title?: string;
  "data-testid"?: string;
}

export function StatusChip({
  children,
  tone = "neutral",
  size = "sm",
  icon,
  uppercase = true,
  className,
  title,
  "data-testid": testId,
}: StatusChipProps) {
  const t = TONES[tone];
  const s = SIZES[size];

  return (
    <span
      title={title}
      data-testid={testId}
      data-tone={tone}
      className={cn(
        "inline-flex items-center whitespace-nowrap font-bold leading-none",
        uppercase && "uppercase tracking-[0.08em]",
        className,
      )}
      style={{
        color: t.color,
        background: t.background,
        border: `1px solid ${t.border}`,
        borderRadius: "var(--pk-r-pill, 999px)",
        fontSize: s.fontSize,
        padding: s.padding,
        gap: s.gap,
      }}
    >
      {icon ? (
        <span aria-hidden="true" className="inline-flex items-center">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}

export default StatusChip;
