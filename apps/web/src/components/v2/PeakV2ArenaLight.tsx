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
 * Consumers: `PeakV2CinematicStage` (the moment's own light), `PeakV2CourtPanel`
 * (the active court's own light), and any LIVE surface that wants to mark
 * its single current focus (e.g. a court slot mid-auction).
 *
 * SEQUENCED TARGETS (Pass 2.5, product-direction — RTT's boss reveal,
 * verified against the reference: each card walks in under its OWN light
 * as it enters, one at a time). This component holds no reveal/gameplay
 * state itself — "the light itself should not be responsible for
 * gameplay/reveal state" (brief) — it only receives the CURRENT `x`/`y`
 * from a caller that already tracks which target is active (e.g. the
 * existing `useRevealSequence` hook), and animates smoothly between
 * successive positions via a plain CSS transition on its own `background`.
 * Reduced motion snaps instantly instead of sliding.
 */

import { usePrefersReducedMotion } from "@/lib/a11y";
import type { V2Tone } from "./v2-tone";
import { v2ToneVar } from "./v2-tone";

export interface PeakV2ArenaLightProps {
  /** Horizontal position of the light's center, as a CSS length/percentage.
   *  Changing this on a re-render is how a SEQUENCED light moves between
   *  targets — see the module docstring. */
  x?: string;
  /** Vertical position of the light's center, as a CSS length/percentage. */
  y?: string;
  /** Which color reads as "lit" — `"accent"` (gold) by default. Only ever a
   *  component tone when the lit subject IS that component's data. Ignored
   *  when `pair` is set (a paired wash has its own fixed, neutral tones —
   *  see below). */
  tone?: V2Tone;
  /** `"soft"` (the default, ambient) or `"focus"` (a genuinely active
   *  element — e.g. the lot currently up for bid — reads brighter). */
  intensity?: "soft" | "focus";
  /** A slow breathing pulse for a currently-active focus. Off by default —
   *  most uses (a static reveal backdrop) want a still light. */
  pulse?: boolean;
  /**
   * PAIRED AMBIENT WASH (Pass 2.5 — Peak Duel is "the one legitimate
   * exception to the usual one-light rule," per the brief). `"cool"` /
   * `"warm"` render at a fixed, deliberately low opacity and a fixed side
   * (`"cool"` left, `"warm"` right) with NEITHER a component tone nor a
   * saturated color — `"cool"` is a neutral slate wash, `"warm"` reuses
   * the gold accent at reduced strength (gold's own "cinematic emphasis"
   * use, per §Color, not a new hue). Deliberately not built from two
   * component-colored lights: this is "which side," not real PEAK3
   * component data, and coloring it with a real component hue would
   * violate the strict tone-semantics rule elsewhere in this system. Two
   * instances (one `pair="cool"`, one `pair="warm"`) compose the full
   * opposing wash — this component still renders only one source each.
   */
  pair?: "cool" | "warm";
  /** Whether a position change should animate (the sequenced-light case)
   *  or apply instantly (most single-target uses, where the light simply
   *  IS somewhere from first render, so a transition would only cause a
   *  spurious slide-in from the gradient's default state). Default
   *  `false` — opt in per the RTT-style sequence consumer. */
  animatePosition?: boolean;
  className?: string;
}

const PAIR_X: Record<NonNullable<PeakV2ArenaLightProps["pair"]>, string> = {
  cool: "18%",
  warm: "82%",
};

export default function PeakV2ArenaLight({
  x,
  y = "0%",
  tone = "accent",
  intensity = "soft",
  pulse = false,
  pair,
  animatePosition = false,
  className,
}: PeakV2ArenaLightProps) {
  const reducedMotion = usePrefersReducedMotion();
  const resolvedX = x ?? (pair ? PAIR_X[pair] : "50%");
  const color = pair
    ? pair === "cool"
      ? "var(--v2-light-neutral)"
      : "var(--v2-color-accent)"
    : v2ToneVar(tone) ?? "var(--v2-color-accent)";
  const opacityToken = pair ? "var(--v2-light-opacity-paired)" : "var(--v2-light-opacity)";
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
        } 60% at ${resolvedX} ${y}, color-mix(in srgb, ${color} calc(${opacityToken} * ${opacityScale} * 100%), transparent), transparent 70%)`,
        // `--v2-dur-reveal` (300-450ms), not `--v2-dur-cinematic`: the light
        // moving to its next target is one beat WITHIN a multi-card
        // sequence, whose overall pacing is the caller's stagger — a
        // transition this short still reads as "the light is here now" per
        // card without eating the whole reveal's time budget on one move.
        transition:
          animatePosition && !reducedMotion ? `background var(--v2-dur-reveal) var(--v2-ease-standard)` : "none",
        animation:
          pulse && !reducedMotion ? "v2-arena-light-pulse 3.4s ease-in-out infinite" : "none",
      }}
    />
  );
}
