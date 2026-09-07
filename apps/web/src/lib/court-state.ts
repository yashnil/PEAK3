/**
 * Client-side helpers for CourtBuilder UI state (Phase 5C).
 * Server is always authoritative -- these are pure, UI-facing derivations
 * only, never a source of game-rule enforcement (that lives in the API's
 * state machine, app/services/perfect_season/state.py).
 */
import { CourtLineupPublicState, CourtSlotPublic, CourtStatus, SlotType } from "@/types/perfect-season";

export type CourtUIPhase = "spinning" | "placing" | "complete";

/** Map server status to a simpler UI phase. Pure function -- unit-testable
 * without any network/component setup. */
export function uiPhaseFromStatus(status: CourtStatus): CourtUIPhase {
  switch (status) {
    case "selection_pending":
      return "spinning";
    case "placement_pending":
      return "placing";
    case "rounds_complete":
    case "result_ready":
      return "complete";
    default:
      return "spinning";
  }
}

/** Open (unfilled) slot types, in their declared court/bench order.
 * Any of these remains a legal placement target regardless of the
 * selected player's real position -- soft placement, never blocked
 * (ADR-005; master plan Sec 5.5). */
export function getOpenSlotTypes(slots: CourtSlotPublic[]): SlotType[] {
  return slots.filter((s) => !s.filled).map((s) => s.slot_type);
}

export function filledSlotCount(slots: CourtSlotPublic[]): number {
  return slots.filter((s) => s.filled).length;
}

export function isRosterComplete(state: CourtLineupPublicState): boolean {
  return state.status === "rounds_complete" || state.status === "result_ready";
}

/** True once a result exists and can be shown -- used by the UI to decide
 * whether to render the result screen vs. the court-building screen. Never
 * false after a successful /complete call (ADR-005 Context: result must
 * always load after completion). */
export function hasResult(state: CourtLineupPublicState): boolean {
  return state.simulation_result !== null;
}

/**
 * 82-0 pacing (final pre-deploy polish). Client presentation only -- none of
 * these gates a server command or changes a rule; each is the length of a
 * beat the player is meant to REGISTER before the next one starts. Every
 * value is a millisecond constant so a regression test can pin the band it
 * was tuned into, and so the e2e suite's own budgets can be derived from it.
 */
export const COURT_PACING = {
  /** The opening intro of a FRESHLY CREATED run (identity, one line, the
   *  cue into round 1). Never replays on resume/reload. */
  INTRO_MS: 3400,
  /** The intro's exit fade -- the last part of INTRO_MS, not added to it. */
  INTRO_EXIT_MS: 320,
  /** Reduced motion: one static frame, held just long enough to read. */
  INTRO_REDUCED_MS: 600,
  /** The round card on screen BEFORE the reels start. Was 620 ms laid over
   *  a reel that had already started; it now owns the stage, then hands
   *  over. Band: 1.4-1.8 s. */
  ROUND_REVEAL_MS: 1500,
  /** The round card's exit, overlapping the reels' first frames. */
  ROUND_REVEAL_EXIT_MS: 260,
} as const;
