/**
 * Timing for the shared per-card reveal choreography (PRODUCT_EXPERIENCE_CONTRACT.md
 * §2, §8 — binding via SYNTHESIS_CONTRACT.md §5).
 *
 * The contract requires new durations to extend the EXISTING `--pk-dur-*` /
 * `MOTION_DURATION_MS` scale rather than introduce magic numbers. That scale
 * lives in `apps/web/src/lib/motion.ts`, owned by `platform`
 * (`FILE_OWNERSHIP.md`) — `rtt-experience` consumes it, never edits it. This
 * file names every reveal-specific duration once, reusing the shared scale
 * wherever a value already exists there.
 *
 * RECONCILING TWO CONFLICTING NUMBERS IN THE SAME CONTRACT SECTION, ON THE
 * RECORD: §8's timing table sums to ≈2.9s per card (lights_lower 300 + role
 * 150 + silhouette 250 + identity 400 + window 200 + score 600 + signature
 * 320 + settle 480 + gap 200) — ×7 cards ≈ 20s. §2's prose target is a total
 * of 8-12s for all 7 cards (≈1.1-1.7s/card). Read literally and strictly
 * sequentially, the table and the prose target cannot both hold. §2 step 9
 * ("silhouette for slot N+1 enters as slot N's card finishes settling; no
 * dead air between cards") reads as license to overlap consecutive cards
 * rather than run them fully sequentially, which is the more likely intended
 * reconciliation — but a truly concurrent multi-card animation (correct
 * under pause/resume/skip-all) is a materially larger implementation than a
 * sequential one for the same visible result in the common case (nobody
 * pauses mid-reveal).
 *
 * This pass ships the SEQUENTIAL model, with per-card beat durations
 * compressed from the table so 7 cards total ≈9.4s (lights_lower run ONCE,
 * globally, at sequence start — not per card, since dimming/undimming the
 * shell seven times in ten seconds would itself be the "distracting motion"
 * the contract is trying to avoid) — inside the 8-12s target. Relative
 * emphasis is preserved: `identity` and `score` stay the two longest beats,
 * matching the contract's "single most information-dense beat" language for
 * `identity`. Flagged to the lead/product-director for Phase 5: this is a
 * reconciliation of an internal contradiction in the source contract, not a
 * literal restatement of §8's table, and the overlapping-cards model remains
 * an open alternative if Phase 5 prefers it.
 */
import { MOTION_DURATION_MS } from "@/lib/motion";

/** Not yet in the shared scale — requested from `platform` for promotion
 *  into `MOTION_DURATION_MS`, see module docstring and the completion
 *  message to the lead. */
export const REVEAL_EXTRA_DURATION_MS = {
  /** Beat 4, "identity resolves" — spec §8: "add a `reveal` token ≈400ms",
   *  compressed to fit the 8-12s/7-card budget while staying the longest
   *  beat after `score`. */
  identityMs: 260,
  /** Beat 6, "score counts up" — spec §8's new `count` token. `AnimatedNumber`
   *  carries the authoritative value in an sr-only sibling from first paint
   *  regardless of this duration, so this is display pacing only, never a
   *  source of truth. */
  countMs: 340,
} as const;

/** The nine per-card beats, in order — PRODUCT_EXPERIENCE_CONTRACT.md §2.
 *  `lights_lower` fires once per SEQUENCE (see `useRevealSequence`), not once
 *  per card — see module docstring. */
export const REVEAL_BEATS = [
  "lights_lower",
  "role",
  "silhouette",
  "identity",
  "window",
  "score",
  "signature",
  "settle",
  "gap",
] as const;

export type RevealBeat = (typeof REVEAL_BEATS)[number];

/** Per-beat duration in ms. `lights_lower` is the one-time, sequence-level
 *  value (mirrors the shared `slow` token); every other beat is a per-card
 *  duration in the compressed sequential model — see module docstring. */
export const REVEAL_BEAT_DURATION_MS: Record<RevealBeat, number> = {
  lights_lower: MOTION_DURATION_MS.slow, // 320ms, once per sequence
  role: 120,
  silhouette: 150,
  identity: REVEAL_EXTRA_DURATION_MS.identityMs,
  window: 120,
  score: REVEAL_EXTRA_DURATION_MS.countMs,
  signature: 180,
  settle: 130,
  // "No dead air between cards" (§2 step 9) — the next card's `role` begins
  // immediately after `settle`; the gap beat exists as a named instant for
  // components that key off it, not as a visible hold.
  gap: 0,
};

/** Per-lane stagger inside the "signature" beat — §8: "60ms/bar". */
export const REVEAL_SIGNATURE_BAR_STAGGER_MS = 60;

/** Sum of the per-card beats (excludes `lights_lower`, which is sequence-level). */
export const REVEAL_CARD_TOTAL_MS = REVEAL_BEATS.filter((b) => b !== "lights_lower").reduce(
  (sum, beat) => sum + REVEAL_BEAT_DURATION_MS[beat],
  0,
);

/** Total unpaced duration for a sequence of `count` cards, lights-lower once. */
export function revealSequenceTotalMs(count: number): number {
  return REVEAL_BEAT_DURATION_MS.lights_lower + count * REVEAL_CARD_TOTAL_MS;
}
