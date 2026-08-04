/**
 * Timing for the shared per-card reveal choreography (PRODUCT_EXPERIENCE_CONTRACT.md
 * §2, §8 — binding via SYNTHESIS_CONTRACT.md §5).
 *
 * The contract requires new durations to extend the EXISTING `--pk-dur-*` /
 * `MOTION_DURATION_MS` scale rather than introduce magic numbers. That scale
 * lives in `apps/web/src/lib/motion.ts`, owned by `platform`
 * (`FILE_OWNERSHIP.md`) — `rtt-experience` consumes it, never edits it.
 * `platform` has since landed `MOTION_DURATION_MS.reveal` (400ms) and
 * `.count` (600ms) — exactly `--pk-dur-reveal`/`--pk-dur-count` in
 * `globals.css` — for the two beats §8 called out as needing new tokens;
 * this file consumes those directly rather than approximating them locally.
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
 * compressed from the table so 7 cards total ≈11.8s (lights_lower runs ONCE,
 * globally, at sequence start — not per card, since dimming/undimming the
 * shell seven times in ten seconds would itself be the "distracting motion"
 * the contract is trying to avoid) — inside the 8-12s target. `identity` and
 * `score` use the OFFICIAL, un-compressed tokens (400ms/600ms) now that they
 * exist, and stay the two longest beats, matching the contract's "single
 * most information-dense beat" language for `identity`; the remaining beats
 * (role/silhouette/window/signature/settle) are compressed to make room.
 * Flagged to the lead/product-director for Phase 5: this is a reconciliation
 * of an internal contradiction in the source contract, not a literal
 * restatement of §8's table, and the overlapping-cards model remains an open
 * alternative if Phase 5 prefers it.
 *
 * TRIMMED AGAIN in Phase 5 (P5-F2, product-director finding): the ≈11.8s
 * figure above is the THEORETICAL unpaced sum computed from these constants —
 * it is not what a browser actually measures. product-director externally
 * timed the real opening reveal (click → `data-reveal-complete="true"`,
 * `Date.now()`, never trusting an in-app number) at a median of 12604ms
 * across 5 seeds (12595-12632ms, ~40ms spread — systematic, not noise), all
 * five over the binding 12000ms ceiling. The gap (~800ms, ~6.8%) is real
 * per-sequence scheduling overhead across the ~63 chained `setTimeout`/rAF
 * beats (9 beats × 7 cards) that the theoretical sum never accounted for —
 * every beat here was already a THEORETICAL duration, not a measured one, so
 * "matches the on-record ~11.8s figure" was never proof the wall clock did.
 *
 * `identity`/`score` stay exactly as they were — the OFFICIAL
 * `--pk-dur-reveal`/`--pk-dur-count` tokens, platform's, never touched here.
 * The other five beats (role/silhouette/window/signature/settle) are cut
 * further, roughly proportionally (a ~25-33% reduction each, preserving the
 * original ordering — silhouette and signature the next-longest pair after
 * identity/score, role and window tied below them, settle shortest), landing
 * the theoretical sum at 10470ms for 7 cards. With the same ~800ms measured
 * overhead that would land the real median at ≈11.3s — inside the 8-12s
 * band with ~700ms of margin against the 12s ceiling, not tuned to sit
 * exactly on it. The 700ms margin is deliberately larger than the
 * observed 40ms seed-to-seed spread was under `next dev`; it has NOT yet
 * been confirmed against a `next build` + `next start` production bundle
 * (see the P5-F2 task note for that re-measurement).
 */
import { MOTION_DURATION_MS } from "@/lib/motion";

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
 *  duration in the compressed sequential model — see module docstring.
 *  `identity`/`score` are the OFFICIAL `--pk-dur-reveal`/`--pk-dur-count`
 *  tokens, unmodified. */
export const REVEAL_BEAT_DURATION_MS: Record<RevealBeat, number> = {
  lights_lower: MOTION_DURATION_MS.slow, // 320ms, once per sequence
  role: 90,
  silhouette: 100,
  identity: MOTION_DURATION_MS.reveal, // 400ms — --pk-dur-reveal, official
  window: 90,
  score: MOTION_DURATION_MS.count, // 600ms — --pk-dur-count, official
  signature: 100,
  settle: 70,
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
