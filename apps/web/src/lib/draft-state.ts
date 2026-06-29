/**
 * Client-side reducer for Peak Draft UI state.
 * Server is always authoritative — this reducer manages local UI phase only.
 */
import { DraftUIState, DraftUIAction, DraftUIPhase, DraftRole, DraftGameState } from "@/types/draft";

export function createInitialDraftState(): DraftUIState {
  return {
    phase: "loading",
    gameState: null,
    selectedOfferId: null,
    pendingRole: null,
    toolMode: null,
    errorMessage: null,
    isLoadingTool: false,
  };
}

export function draftReducer(
  state: DraftUIState,
  action: DraftUIAction,
): DraftUIState {
  switch (action.type) {
    case "GAME_LOADED":
      return {
        ...state,
        phase: action.gameState.status === "draft_complete" ? "complete" : "selecting",
        gameState: action.gameState,
        selectedOfferId: null,
        pendingRole: null,
        toolMode: null,
        errorMessage: null,
      };

    case "SELECT_OFFER":
      if (state.phase !== "selecting") return state;
      return {
        ...state,
        phase: "role_select",
        selectedOfferId: action.card_id,
        pendingRole: null,
      };

    case "DESELECT_OFFER":
      return {
        ...state,
        phase: "selecting",
        selectedOfferId: null,
        pendingRole: null,
        toolMode: null,
      };

    case "SELECT_ROLE":
      return { ...state, pendingRole: action.role };

    case "SUBMIT_START":
      return { ...state, phase: "submitting", isLoadingTool: false };

    case "SUBMIT_SUCCESS": {
      const gs = action.gameState;
      const nextPhase: DraftUIPhase =
        gs.status === "draft_complete"
          ? "complete"
          : gs.status === "hold_pending"
          ? "selecting"
          : gs.status === "reframe_pending"
          ? "selecting"
          : "selecting";
      return {
        ...state,
        phase: nextPhase,
        gameState: gs,
        selectedOfferId: null,
        pendingRole: null,
        toolMode: null,
        errorMessage: null,
        isLoadingTool: false,
      };
    }

    case "SUBMIT_ERROR":
      return {
        ...state,
        phase: state.gameState?.status === "draft_complete" ? "complete" : "selecting",
        selectedOfferId: null,
        pendingRole: null,
        toolMode: null,
        errorMessage: action.message,
        isLoadingTool: false,
      };

    case "OPEN_TOOL":
      return { ...state, toolMode: action.tool, phase: "tool_confirm", isLoadingTool: false };

    case "CANCEL_TOOL":
      return { ...state, toolMode: null, phase: "selecting", isLoadingTool: false };

    case "TOOL_SUCCESS":
      return {
        ...state,
        phase: "selecting",
        gameState: action.gameState,
        toolMode: null,
        errorMessage: null,
        isLoadingTool: false,
        selectedOfferId: null,
        pendingRole: null,
      };

    case "SET_ERROR":
      return { ...state, errorMessage: action.message, isLoadingTool: false };

    case "RESET":
      return createInitialDraftState();

    default:
      return state;
  }
}

// Helpers
export function canSelectOffer(state: DraftUIState): boolean {
  return state.phase === "selecting" && !!state.gameState;
}

export function canSubmitSelection(state: DraftUIState): boolean {
  return (
    state.phase === "role_select" &&
    !!state.selectedOfferId &&
    !!state.pendingRole
  );
}

export function eligibleRolesForCard(
  card: { eligible_roles: DraftRole[] },
  openRoles: DraftRole[],
): DraftRole[] {
  return card.eligible_roles.filter((r) => openRoles.includes(r));
}
