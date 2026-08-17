"use client";

/**
 * PeakV2ArenaLight — the one controlled light source (brief §Arena Light).
 *
 * NOT a generic CSS glow: one broad, soft, low-opacity radial source,
 * positioned at a single `x`/`y` point tied to whatever is currently the
 * game's focus (the player being auctioned, the active court, the boss
 * being revealed, the final score) — never scattered across every
 * card/button. A parent positions this absolutely and sizes it; the light
 * itself never intercepts pointer events.
 *
 * Consumers: `PeakV2CinematicStage` (the moment's own light), and any LIVE
 * surface that wants to mark its single current focus (e.g. a court slot
 * mid-auction) without stacking a second decorative treatment on top of an
 * existing court-light effect.
 */

import { usePrefersReducedMotion } from "@/lib/a11y";
import type { V2Tone } from "./v2-tone";
import { v2ToneVar } from "./v2-tone";

export interface PeakV2ArenaLightProps {
  /** Horizontal position of the light's center, as a CSS length/percentage. */
  x?: string;
  /** Vertical position of the light's center, as a CSS length/percentage. */
  y?: string;
  /** Which color reads as "lit" — `"accent"` (gold) by default. Only ever a
   *  component tone when the lit subject IS that component's data. */
  tone?: V2Tone;
  /** `"soft"` (the default, ambient) or `"focus"` (a genuinely active
   *  element — e.g. the lot currently up for bid — reads brighter). */
  intensity?: "soft" | "focus";
  /** A slow breathing pulse for a currently-active focus. Off by default —
   *  most uses (a static reveal backdrop) want a still light. */
  pulse?: boolean;
  className?: string;
}

export default function PeakV2ArenaLight({
  x = "50%",
  y = "0%",
  tone = "accent",
  intensity = "soft",
  pulse = false,
  className,
}: PeakV2ArenaLightProps) {
  const reducedMotion = usePrefersReducedMotion();
  const color = v2ToneVar(tone) ?? "var(--v2-color-accent)";
  const opacityScale = intensity === "focus" ? 1.6 : 1;
  return (
    <div
      aria-hidden="true"
      className={`v2-arena-light pointer-events-none absolute inset-0 ${className ?? ""}`}
      style={{
        // `color-mix` keeps the alpha authored once (`--v2-light-opacity`)
        // instead of a second hardcoded rgba per tone — the same technique
        // `--pk-elev-*` already uses in globals.css.
        background: `radial-gradient(${
          intensity === "focus" ? "45%" : "var(--v2-light-spread)"
        } 60% at ${x} ${y}, color-mix(in srgb, ${color} calc(var(--v2-light-opacity) * ${opacityScale} * 100%), transparent), transparent 70%)`,
        animation:
          pulse && !reducedMotion ? "v2-arena-light-pulse 3.4s ease-in-out infinite" : "none",
      }}
    />
  );
}
