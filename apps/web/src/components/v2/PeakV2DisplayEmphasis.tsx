/**
 * PeakV2DisplayEmphasis — the inline italic/accent-gold run inside a
 * DISPLAY/MOMENT headline (Pass 2.5, product-direction — verified against
 * the real reference: "Five lanes. *One point each.*", "Act 4 — *The
 * Wall*", "Utah Jazz *2010s*", "Somebody always *overpays*.", "*Victory
 * over The Wall*").
 *
 * A composable inline span, not a template or a set of hardcoded strings —
 * a caller composes its own real copy around it:
 *
 *   <PeakV2ResultHeadline as="h1" scale="hero">
 *     Five lanes. <PeakV2DisplayEmphasis>One point each.</PeakV2DisplayEmphasis>
 *   </PeakV2ResultHeadline>
 *
 * Deliberately a plain `<span>`, not `<em>`: the italic here is a
 * TYPOGRAPHIC/brand convention (which word in a display line gets the
 * accent treatment), not semantic stress emphasis — using `<em>` would
 * risk a screen reader adding vocal stress the copy never intended.
 * Because it is an inline child of the SAME heading element, it changes
 * nothing about heading semantics or reading order: assistive tech reads
 * the heading's text content straight through, exactly as authored.
 *
 * `tone` defaults to the same gold `PeakV2ResultHeadline` uses for
 * `tone="accent"`, matching the reference's gold-italic convention; pass
 * `"inherit"` for a same-color, italic-only emphasis (e.g. "Act 4 — *The
 * Wall*", where the boss name is not gold, just italic).
 */

import type { ReactNode } from "react";

export interface PeakV2DisplayEmphasisProps {
  children: ReactNode;
  tone?: "accent" | "inherit";
  className?: string;
}

export default function PeakV2DisplayEmphasis({
  children,
  tone = "accent",
  className,
}: PeakV2DisplayEmphasisProps) {
  return (
    <span
      className={className}
      style={{
        fontStyle: "italic",
        color: tone === "accent" ? "var(--v2-color-accent)" : "inherit",
      }}
    >
      {children}
    </span>
  );
}
