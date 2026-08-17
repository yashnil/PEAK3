"use client";

/**
 * PeakV2CinematicStage — the container for a CINEMATIC moment (brief
 * §The Two-Tempo System): homepage hero, opponent/boss reveal, franchise ·
 * decade reveal, victory/defeat, final daily result, a streak/record
 * moment. Never used for routine gameplay.
 *
 * Composes the three things every cinematic moment shares: one controlled
 * `PeakV2ArenaLight`, the DISPLAY/MOMENT typography scope (children set in
 * `--v2-font-display` get it for free via CSS inheritance — no per-child
 * font-family prop needed), and a restrained entrance (`v2-reveal-rise`,
 * `--v2-dur-reveal`, collapsed to instant under reduced motion). It does
 * NOT own pacing beyond that one entrance — a multi-beat sequence (a boss's
 * name, then its lineup) is the CALLER's timer chain, built from
 * `V2_DURATION_MS`/`v2Duration`, same as the existing opening-reveal
 * ceremonies already stage their own beats.
 */

import { type ReactNode } from "react";
import { usePrefersReducedMotion } from "@/lib/a11y";
import PeakV2ArenaLight from "./PeakV2ArenaLight";
import type { V2Tone } from "./v2-tone";

export interface PeakV2CinematicStageProps {
  children: ReactNode;
  light?: { x?: string; y?: string; tone?: V2Tone };
  /** `"center"` (the default) or `"start"` — most cinematic moments center
   *  their statement; a few (e.g. a franchise/decade roll beside a still
   *  court) want it pinned left. */
  align?: "center" | "start";
  className?: string;
}

export default function PeakV2CinematicStage({
  children,
  light,
  align = "center",
  className,
}: PeakV2CinematicStageProps) {
  const reducedMotion = usePrefersReducedMotion();
  return (
    <section
      data-v2-tempo="cinematic"
      className={`relative overflow-hidden ${className ?? ""}`}
      style={{
        fontFamily: "var(--v2-font-display)",
        padding: "var(--v2-space-16) var(--v2-space-6)",
      }}
    >
      <PeakV2ArenaLight x={light?.x} y={light?.y} tone={light?.tone} />
      <div
        className={`relative flex flex-col ${align === "center" ? "items-center text-center" : "items-start text-left"}`}
        style={{
          animation: reducedMotion
            ? "none"
            : "v2-reveal-rise var(--v2-dur-reveal) var(--v2-ease-out) both",
        }}
      >
        {children}
      </div>
    </section>
  );
}
