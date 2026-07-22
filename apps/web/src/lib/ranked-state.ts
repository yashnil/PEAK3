/**
 * Ranked UI state reducer. Server is always authoritative — this reducer
 * only tracks which screen to show; it never computes matchmaking or
 * settlement outcomes itself (mirrors lib/draft-state.ts's discipline).
 */
import type { RankedUIAction, RankedUIState } from "@/types/ranked";

export function createInitialRankedState(): RankedUIState {
  return {
    phase: "queue_idle",
    mode: null,
    matchId: null,
    gameState: null,
    settlement: null,
    errorMessage: null,
    waitedSeconds: 0,
  };
}

export function rankedReducer(state: RankedUIState, action: RankedUIAction): RankedUIState {
  switch (action.type) {
    case "SET_MODE":
      return { ...state, mode: action.mode, phase: "queue_idle", errorMessage: null };

    case "QUEUE_JOINED":
      if (action.result.status === "matched" && action.result.match_id) {
        return { ...state, phase: "matched", matchId: action.result.match_id, waitedSeconds: 0 };
      }
      return { ...state, phase: "queue_waiting", waitedSeconds: 0 };

    case "QUEUE_WAIT_TICK":
      return { ...state, waitedSeconds: action.waitedSeconds };

    case "QUEUE_CANCELLED":
      return { ...createInitialRankedState(), mode: state.mode };

    case "MATCHED":
      return { ...state, phase: "matched", matchId: action.matchId };

    case "GAME_LOADED":
      return {
        ...state,
        phase: action.gameState.status === "draft_complete" ? "awaiting_opponent" : "playing",
        gameState: action.gameState,
      };

    case "AWAITING_OPPONENT":
      return { ...state, phase: "awaiting_opponent" };

    case "SETTLED":
      return { ...state, phase: "settled", settlement: action.settlement };

    case "SET_ERROR":
      return { ...state, phase: "error", errorMessage: action.message };

    case "RESET":
      return createInitialRankedState();

    default:
      return state;
  }
}

export function isRankedGameActive(state: RankedUIState): boolean {
  return state.phase === "playing" && state.gameState !== null && state.gameState.status !== "draft_complete";
}
