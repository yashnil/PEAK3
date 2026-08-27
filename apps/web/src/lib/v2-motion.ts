/**
 * PEAK3 V2 motion constants — mirrors `--v2-dur-*`/`--v2-ease-*` in
 * `styles/v2/tokens.css`, the same relationship `lib/motion.ts` already
 * has with `--pk-dur-*`/`--pk-ease-*`. A JS-driven transition (framer
 * `motion`) and a CSS one on the same V2 surface read this file and that
 * stylesheet respectively and can never drift apart.
 *
 * Named by what the motion COMMUNICATES (brief §Motion system), not by
 * arbitrary size, so a call site reads as intent:
 *   ack        — immediate acknowledgement a click landed (80-120ms)
 *   control    — a control's own state change, e.g. hover/press (140-180ms)
 *   transition — one UI region replacing another (180-240ms)
 *   reveal     — a card/player becoming visible (300-450ms)
 *   cinematic  — one full staged sequence, total (~2-3.5s)
 */

/** Milliseconds — for `setTimeout`/staged-sequence chains. */
export const V2_DURATION_MS = {
  ack: 100,
  control: 160,
  transition: 210,
  reveal: 380,
  cinematic: 2800,
} as const;

/** The same durations in seconds, the unit `motion` transitions expect. */
export const V2_DURATION_S = {
  ack: 0.1,
  control: 0.16,
  transition: 0.21,
  reveal: 0.38,
  cinematic: 2.8,
} as const;

/** Mirrors `--v2-ease-*`, which itself aliases the existing measured
 *  `--pk-ease-*` curves — see `tokens.css`'s module docstring for why V2
 *  does not author a second set of curves. */
export const V2_EASE = {
  standard: [0.2, 0, 0, 1],
  out: [0, 0, 0.2, 1],
  in: [0.4, 0, 1, 1],
  emphasized: [0.34, 1.56, 0.64, 1],
} as const;

/**
 * A reduced-motion-aware duration: returns 0 whenever the caller reports the
 * user prefers reduced motion, so a staged sequence collapses to its final
 * state instantly instead of skipping the CSS transition but still waiting
 * out a `setTimeout`. Every V2 cinematic primitive's timer chain is built
 * from this, never a bare `V2_DURATION_MS` constant, mirroring how the
 * existing opening-reveal ceremonies already short-circuit under reduced
 * motion (see `RevealSequenceSurface`'s reduced-motion handling).
 */
export function v2Duration(ms: number, reducedMotion: boolean): number {
  return reducedMotion ? 0 : ms;
}
