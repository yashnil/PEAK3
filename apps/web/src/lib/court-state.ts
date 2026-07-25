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
