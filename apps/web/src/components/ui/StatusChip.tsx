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
  // P3-G2: `color` here is rendered TEXT (the chip's own label), so every
  // tone below reads its `-text` sibling, not the frozen/raw token
  // directly -- `--peak-accent`/`--comp-si` as literal text measured
  // 1.50:1 / 2.40:1 against the light theme's card surface, failing WCAG
  // AA at any size. `background`/`border` keep the frozen/raw tokens,
  // which is exactly where they belong.
  accent: {
    color: "var(--peak-accent-text)",
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
    color: "var(--comp-si-text)",
    background: "var(--pk-surface-inset, var(--bg-elevated))",
    border: "var(--border-emphasis)",
  },
  muted: {
    color: "var(--text-muted)",
    background: "transparent",
    border: "var(--border-subtle)",
  },
};

/* RAISED FROM 10/11px. A chip carries a state the player has to act on —
   "In progress", "Not eligible", "Your turn" — and uppercase letterspaced
   text is already the hardest case to read at small sizes. One point each
   costs no layout (the padding is unchanged and the chip is pill-shaped) and
   moves both sizes above the floor where letterspacing starts to hurt more
   than it helps. */
const SIZES: Record<StatusChipSize, { fontSize: number; padding: string; gap: string }> = {
  sm: { fontSize: 11, padding: "2px 7px", gap: "var(--pk-space-1, 4px)" },
  md: { fontSize: 12, padding: "4px 10px", gap: "var(--pk-space-1, 4px)" },
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
        // A lit top edge on every tone except `muted`, which is deliberately
        // the flat one — it is the tone for "this is background information",
        // and giving it volume would argue the opposite.
        boxShadow: tone === "muted" ? undefined : "var(--pk-rim)",
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
