"use client";
import { useEffect, useReducer, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  DraftGameState,
  DraftCard as DraftCardType,
  DraftRole,
  MODE_LABELS,
} from "@/types/draft";
import {
  draftReducer,
  createInitialDraftState,
  eligibleRolesForCard,
} from "@/lib/draft-state";
import {
  getDraftGame,
  submitDraftAction,
  createChallenge,
  DraftAPIError,
} from "@/lib/draft-api";

import DraftCard from "./DraftCard";
import LineupBoard from "./LineupBoard";
import DNABar from "./DNABar";
import DraftToolbar from "./DraftToolbar";
import RoleSelector from "./RoleSelector";
import DraftReceipt from "./DraftReceipt";
import DecisionReplay from "./DecisionReplay";

interface Props {
  initialGameState: DraftGameState;
}

export default function DraftScreen({ initialGameState }: Props) {
  const router = useRouter();
  const [state, dispatch] = useReducer(draftReducer, createInitialDraftState());

  // Initialize from server-fetched state
  useEffect(() => {
    dispatch({ type: "GAME_LOADED", gameState: initialGameState });
  }, [initialGameState]);

  const gs = state.gameState;

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleSelectOffer = useCallback((card_id: string) => {
    dispatch({ type: "SELECT_OFFER", card_id });
  }, []);

  const handleRoleSelect = useCallback((role: DraftRole) => {
    dispatch({ type: "SELECT_ROLE", role });
  }, []);

  const handleConfirmSelection = useCallback(async () => {
    if (!gs || !state.selectedOfferId || !state.pendingRole) return;
    dispatch({ type: "SUBMIT_START" });
    try {
      const updated = await submitDraftAction(gs.game_id, "select_card", {
        card_id: state.selectedOfferId,
        role: state.pendingRole,
      });
      dispatch({ type: "SUBMIT_SUCCESS", gameState: updated });
    } catch (e) {
      const msg = e instanceof DraftAPIError ? e.detail : "Server error. Try again.";
      dispatch({ type: "SUBMIT_ERROR", message: msg });
    }
  }, [gs, state.selectedOfferId, state.pendingRole]);

  const handleHold = useCallback(async () => {
    if (!gs || !state.selectedOfferId) {
      // Show the hold tool prompt first if no card selected
      dispatch({ type: "OPEN_TOOL", tool: "hold" });
      return;
    }
    dispatch({ type: "SUBMIT_START" });
    try {
      const updated = await submitDraftAction(gs.game_id, "use_hold", {
        card_id: state.selectedOfferId,
      });
      dispatch({ type: "TOOL_SUCCESS", gameState: updated });
    } catch (e) {
      const msg = e instanceof DraftAPIError ? e.detail : "Server error.";
      dispatch({ type: "SUBMIT_ERROR", message: msg });
    }
  }, [gs, state.selectedOfferId]);

  const handleReframe = useCallback(async () => {
    if (!gs) return;
    dispatch({ type: "SUBMIT_START" });
    try {
      const updated = await submitDraftAction(gs.game_id, "use_reframe");
      dispatch({ type: "TOOL_SUCCESS", gameState: updated });
    } catch (e) {
      const msg = e instanceof DraftAPIError ? e.detail : "Server error.";
      dispatch({ type: "SUBMIT_ERROR", message: msg });
    }
  }, [gs]);

  const handleShareChallenge = useCallback(async () => {
    if (!gs) return;
    try {
      const result = await createChallenge(gs.game_id);
      await navigator.clipboard.writeText(
        window.location.origin + result.public_url_path
      );
      // Brief toast via alert (no toast lib dependency)
      alert("Challenge link copied to clipboard!");
    } catch {
      alert("Could not create challenge link.");
    }
  }, [gs]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!gs || state.phase === "loading") {
    return (
      <div
        className="flex items-center justify-center h-64 text-sm"
        style={{ color: "var(--text-muted)" }}
      >
        Loading board…
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <p style={{ color: "#ef4444" }}>{state.errorMessage}</p>
        <button
          onClick={() => router.push("/arena")}
          className="text-sm underline"
          style={{ color: "var(--text-secondary)" }}
        >
          Back to Arena
        </button>
      </div>
    );
  }

  const isDone = gs.status === "draft_complete";
  const submitting = state.phase === "submitting";

  // Which card (if any) is selected from current offers?
  const selectedCard: DraftCardType | null =
    state.selectedOfferId
      ? gs.current_offers.find((c) => c.peak_window_id === state.selectedOfferId) ?? null
      : null;

  return (
    <div className="flex flex-col gap-5 max-w-lg mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-muted)" }}
          >
            {MODE_LABELS[gs.mode]} · Round {gs.current_round}/{gs.total_rounds}
          </div>
          <h1
            className="text-xl font-bold mt-0.5"
            style={{ color: "var(--text-primary)" }}
          >
            Peak Draft
          </h1>
        </div>
        <DraftToolbar
          gameState={gs}
          onHold={() => {
            if (selectedCard) {
              handleHold();
            } else {
              dispatch({ type: "OPEN_TOOL", tool: "hold" });
            }
          }}
          onReframe={handleReframe}
          disabled={submitting || isDone}
        />
      </div>

      {/* Error banner */}
      {state.errorMessage && (
        <div
          className="text-xs px-3 py-2 rounded-lg"
          style={{ background: "#ef444420", color: "#ef4444" }}
        >
          {state.errorMessage}
        </div>
      )}

      {/* ── DRAFT COMPLETE ──────────────────────── */}
      {isDone && gs.lineup_evaluation && (
        <>
          <LineupBoard
            selectedCards={gs.selected_cards}
            openRoles={gs.open_roles}
          />
          <DraftReceipt
            evaluation={gs.lineup_evaluation}
            onShare={handleShareChallenge}
          />
          <DecisionReplay history={gs.round_history} />
        </>
      )}

      {/* ── ROLE SELECTION ──────────────────────── */}
      {state.phase === "role_select" && selectedCard && !isDone && (
        <>
          <RoleSelector
            card={selectedCard}
            openRoles={gs.open_roles}
            selectedRole={state.pendingRole}
            onSelect={handleRoleSelect}
            onCancel={() => dispatch({ type: "DESELECT_OFFER" })}
            onConfirm={handleConfirmSelection}
            submitting={submitting}
          />
          <LineupBoard
            selectedCards={gs.selected_cards}
            openRoles={gs.open_roles}
          />
        </>
      )}

      {/* ── HOLD CONFIRMATION (no card selected yet) ── */}
      {state.phase === "tool_confirm" && state.toolMode === "hold" && (
        <div
          className="rounded-xl border p-4 flex flex-col gap-3"
          style={{
            background: "var(--bg-elevated)",
            borderColor: "var(--border-default)",
          }}
        >
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Select a card from the offers below, then tap Hold.
          </p>
          <button
            onClick={() => dispatch({ type: "CANCEL_TOOL" })}
            className="text-xs self-end"
            style={{ color: "var(--text-muted)" }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* ── CARD OFFERS ──────────────────────────── */}
      {!isDone && (
        <>
          {gs.current_offers.length > 0 ? (
            <div className="flex flex-col gap-2">
              <div
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-secondary)" }}
              >
                {gs.held_card ? "Offers (your held card is included)" : "Offers"}
              </div>
              {gs.current_offers.map((card) => {
                const isSelected = state.selectedOfferId === card.peak_window_id;
                const isDimmed =
                  !!state.selectedOfferId && !isSelected;
                const eligibleOpen = eligibleRolesForCard(card, gs.open_roles);
                const hasEligibleRole = eligibleOpen.length > 0;
                return (
                  <DraftCard
                    key={card.peak_window_id}
                    card={card}
                    selected={isSelected}
                    dimmed={isDimmed || (!hasEligibleRole && !isSelected)}
                    onClick={
                      state.phase === "selecting" && !submitting
                        ? () => handleSelectOffer(card.peak_window_id)
                        : undefined
                    }
                  />
                );
              })}
            </div>
          ) : (
            <p
              className="text-sm text-center py-8"
              style={{ color: "var(--text-muted)" }}
            >
              {submitting ? "Submitting…" : "No offers available."}
            </p>
          )}

          {/* Hold instruction when a card is in hold_pending */}
          {gs.status === "hold_pending" && (
            <div
              className="text-xs px-3 py-2 rounded-lg border"
              style={{
                background: "var(--peak-accent)10",
                borderColor: "var(--peak-accent)40",
                color: "var(--peak-accent)",
              }}
            >
              Card held. Select from the 2 remaining offers — your held card
              will appear in round {(gs.current_round ?? 0) + 1}.
            </div>
          )}
        </>
      )}

      {/* ── LINEUP PROGRESS ──────────────────────── */}
      {!isDone && gs.selected_cards.length > 0 && state.phase !== "role_select" && (
        <LineupBoard
          selectedCards={gs.selected_cards}
          openRoles={gs.open_roles}
          heldCard={gs.held_card}
        />
      )}

      {/* ── CURRENT DNA ──────────────────────────── */}
      {gs.current_dna && !isDone && gs.selected_cards.length > 0 && (
        <div
          className="rounded-xl border p-4"
          style={{
            background: "var(--bg-elevated)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <DNABar dna={gs.current_dna} label="Current lineup DNA" />
        </div>
      )}
    </div>
  );
}
