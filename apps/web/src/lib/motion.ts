"use client";

/**
 * Shared motion configuration.
 *
 * Two jobs:
 *
 * 1. `MotionProvider` — a `LazyMotion` boundary. `motion` (v11) is already the
 *    only animation dependency in the app (plan §2: zero new runtime packages);
 *    `LazyMotion` + `domAnimation` lets an animated route load the ~15kb DOM
 *    feature bundle instead of the full `motion` component tree. Wrapping a
 *    subtree is the ONLY thing this does — it does not animate anything itself.
 *
 * 2. Duration/easing constants that mirror the `--pk-dur-*` / `--pk-ease-*`
 *    CSS tokens in `styles/globals.css`, so a JS-driven transition and a CSS
 *    one on the same surface cannot drift apart.
 *
 * This file is `.ts`, not `.tsx`, so the provider is built with
 * `createElement` rather than JSX.
 *
 * NOTE FOR CONSUMERS: `strict` defaults to `false`. `LazyMotion` in strict mode
 * throws on `motion.*` and only permits `m.*`, and six existing components
 * already import `motion` directly. Opt into `strict` per-subtree once those
 * are converted — never globally without converting them first.
 */

import { createElement, type ReactElement, type ReactNode } from "react";
import { LazyMotion, domAnimation } from "motion/react";

/** Durations in milliseconds — mirrors `--pk-dur-*`. */
export const MOTION_DURATION_MS = {
  instant: 0,
  fast: 120,
  base: 200,
  slow: 320,
  slower: 480,
  // Added for the cinematic sequences (PRODUCT_EXPERIENCE_CONTRACT.md §8).
  // Mirrors `--pk-dur-reveal` / `--pk-dur-count` in globals.css — extends the
  // existing scale rather than a new hardcoded number at each call site.
  reveal: 400,
  count: 600,
} as const;

/** The same durations in seconds, the unit `motion` transitions expect. */
export const MOTION_DURATION_S = {
  instant: 0,
  fast: 0.12,
  base: 0.2,
  slow: 0.32,
  slower: 0.48,
  reveal: 0.4,
  count: 0.6,
} as const;

export type MotionDurationName = keyof typeof MOTION_DURATION_MS;

/**
 * Cubic-bezier control points — mirrors `--pk-ease-*`.
 *
 * Mutable 4-tuples (not `as const`) because `motion`'s `Easing` type expects a
 * mutable `number[]`; a readonly tuple would not assign.
 */
export const MOTION_EASE: Record<
  "standard" | "out" | "in" | "emphasized",
  [number, number, number, number]
> = {
  standard: [0.2, 0, 0, 1],
  out: [0, 0, 0.2, 1],
  in: [0.4, 0, 1, 1],
  emphasized: [0.34, 1.56, 0.64, 1],
};

export type MotionEaseName = keyof typeof MOTION_EASE;

/**
 * A ready-made `motion` transition.
 *
 * `reducedMotion: true` collapses it to zero duration, which is the correct
 * behaviour for every surface in this app: motion here is decoration over an
 * already-authoritative server result (plan §3.5), so removing it never
 * removes information.
 */
export function motionTransition(
  duration: MotionDurationName = "base",
  ease: MotionEaseName = "standard",
  reducedMotion = false,
): { duration: number; ease: [number, number, number, number] } {
  return {
    duration: reducedMotion ? 0 : MOTION_DURATION_S[duration],
    ease: MOTION_EASE[ease],
  };
}

/** A ready-made CSS `transition` shorthand using the same tokens. */
export function cssTransition(
  properties: string,
  duration: MotionDurationName = "base",
  ease: MotionEaseName = "standard",
  reducedMotion = false,
): string {
  const ms = reducedMotion ? 0 : MOTION_DURATION_MS[duration];
  const [a, b, c, d] = MOTION_EASE[ease];
  return properties
    .split(",")
    .map((p) => `${p.trim()} ${ms}ms cubic-bezier(${a}, ${b}, ${c}, ${d})`)
    .join(", ");
}

export interface MotionProviderProps {
  children: ReactNode;
  /**
   * Forbid `motion.*` and require `m.*` inside this subtree. Defaults to
   * `false` — see the module docstring.
   */
  strict?: boolean;
}

/**
 * `LazyMotion` boundary loading the `domAnimation` feature set.
 *
 * Exported but deliberately NOT wired into any layout by W7 — layout files are
 * owned by other workstreams.
 */
export function MotionProvider({ children, strict = false }: MotionProviderProps): ReactElement {
  return createElement(LazyMotion, { features: domAnimation, strict }, children);
}
