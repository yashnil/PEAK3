"use client";

/**
 * PeakV2CourtPanel — one court's presentation wrapper: `"lit"` (the active
 * court) or `"dimmed"` (a sibling court that is still fully strategic
 * information, just not the current focus).
 *
 * Pass 2.5, product-direction. Verified against the reference (Three-Man
 * Weave's three-court LIVE state, page 20): "the active court is the only
 * one fully lit… the two dim courts are still fully legible, just not
 * lit." That sentence is the whole spec — dimming must never cross into
 * hiding or blurring, and must never disable interaction.
 *
 * Implementation: `presentation="dimmed"` applies `opacity`, nothing else
 * — no `filter: blur`, no `pointer-events: none`, no `aria-hidden`. Text
 * on this app's near-black `--v2-bg-page` starts at very high contrast
 * (`--v2-text-primary` is ~18:1), so `--v2-court-dim-opacity` (0.62) still
 * lands comfortably inside AA for normal text — dimmed, not degraded.
 * `presentation="lit"` (default) additionally renders the court's own
 * `PeakV2ArenaLight` — composing the existing primitive rather than a
 * second lighting implementation.
 *
 * This belongs on the court/surface primitive, not on `PeakV2ArenaLight`
 * itself, because dimming is a property of the WHOLE court's content
 * (names, values, every slot), not a single positioned light source — see
 * the brief's own note that this "may belong on the court/surface
 * primitive if that is architecturally cleaner."
 */

import type { ReactNode } from "react";
import PeakV2ArenaLight from "./PeakV2ArenaLight";
import type { V2Tone } from "./v2-tone";

export interface PeakV2CourtPanelProps {
  label: string;
  /** e.g. "YOU" / "BOT" / a status chip — rendered beside the label. */
  status?: ReactNode;
  presentation?: "lit" | "dimmed";
  /** Whether the lit state renders its own arena light. Default true when
   *  lit — a caller composing multiple lit surfaces in one view (rare)
   *  can opt out to avoid two lights stacking. No effect when dimmed. */
  light?: boolean;
  lightTone?: V2Tone;
  children: ReactNode;
  className?: string;
  /** Overrides the default `data-testid` — for a caller whose test needs
   *  to address a specific court instance (e.g. one seat of three). Every
   *  other caller keeps the generic default. */
  testId?: string;
}

export default function PeakV2CourtPanel({
  label,
  status,
  presentation = "lit",
  light = true,
  lightTone = "accent",
  children,
  className,
  testId = "peak-v2-court-panel",
}: PeakV2CourtPanelProps) {
  const dimmed = presentation === "dimmed";
  return (
    <div
      data-testid={testId}
      data-v2-court-presentation={presentation}
      className={`relative flex flex-col gap-2 rounded-r-md ${className ?? ""}`}
      style={{
        opacity: dimmed ? "var(--v2-court-dim-opacity, 0.62)" : 1,
        borderLeft: `2px solid ${dimmed ? "var(--v2-border)" : "var(--v2-color-accent)"}`,
        // Pass 7 (human acceptance testing, task §13): a border-color-only
        // difference between the active court and its two siblings read as
        // too subtle once real rosters filled every slot with color-bearing
        // content of their own. A very low-opacity accent wash on the LIT
        // court's own background (never on dimmed — dimming already reads
        // via opacity, doubling up would fight it) gives "this is the court
        // that matters right now" a second, independent visual cue.
        background: dimmed ? "transparent" : "color-mix(in srgb, var(--v2-color-accent) 4%, transparent)",
        paddingLeft: "var(--v2-space-3)",
        paddingRight: dimmed ? undefined : "var(--v2-space-3)",
        paddingTop: dimmed ? undefined : "var(--v2-space-2)",
        paddingBottom: dimmed ? undefined : "var(--v2-space-2)",
      }}
    >
      {!dimmed && light ? <PeakV2ArenaLight tone={lightTone} y="0%" /> : null}
      <div className="relative flex items-baseline gap-2">
        <span
          style={{
            fontFamily: "var(--v2-font-display)",
            fontStyle: dimmed ? "normal" : "italic",
            fontSize: "1.0625rem",
            color: "var(--v2-text-primary)",
          }}
        >
          {label}
        </span>
        {status}
      </div>
      <div className="relative flex flex-col gap-2">{children}</div>
    </div>
  );
}
