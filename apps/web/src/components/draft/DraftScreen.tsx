"use client";
import { useEffect, useReducer, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DraftGameState,
  DraftCard as DraftCardType,
  DraftRole,
  MODE_LABELS,
  ChallengeComparisonResponse,
} from "@/types/draft";
import {
  draftReducer,
  createInitialDraftState,
  eligibleRolesForCard,
} from "@/lib/draft-state";
import {
  submitDraftAction,
  createChallenge,
  getChallengeComparison,
  DraftAPIError,
} from "@/lib/draft-api";
import { draftProgress } from "@/lib/draft-progress";
import { analytics } from "@/lib/analytics";

import DraftCard from "./DraftCard";
import LineupBoard from "./LineupBoard";
import DNABar from "./DNABar";
import DraftToolbar from "./DraftToolbar";
import RoleSelector from "./RoleSelector";
import DraftReceipt from "./DraftReceipt";
import DecisionReplay from "./DecisionReplay";
import ShareChallenge from "./ShareChallenge";
import ChallengeComparison from "./ChallengeComparison";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import PeakV2SecondaryAction from "@/components/v2/PeakV2SecondaryAction";
import { StatusChip } from "@/components/ui/StatusChip";

interface Props {
  initialGameState: DraftGameState;
  boardDate?: string;        // YYYY-MM-DD, for daily completion tracking
  challengeToken?: string;   // for challenge completion flow
}

export default function DraftScreen({ initialGameState, boardDate, challengeToken }: Props) {
  const router = useRouter();
  const [state, dispatch] = useReducer(draftReducer, createInitialDraftState());

  // ── Challenge / share state ──────────────────────────────────────────────
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [comparison, setComparison] = useState<ChallengeComparisonResponse | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);

  // Initialize from server-fetched state
  useEffect(() => {
    dispatch({ type: "GAME_LOADED", gameState: initialGameState });
    // Persist active game for resumption
    draftProgress.saveActiveGame({
      game_id: initialGameState.game_id,
      mode: initialGameState.mode,
      board_type: initialGameState.board_type,
      board_id: initialGameState.board_metadata.board_id,
      started_at: new Date().toISOString(),
    });
    // Track game start
    if (initialGameState.board_type === "daily" && boardDate !== undefined) {
      analytics.track({
        type: "daily_game_started",
        mode: initialGameState.mode,
        date: boardDate,
      });
    } else if (initialGameState.board_type === "challenge") {
      analytics.track({ type: "challenge_started", mode: initialGameState.mode });
    }
  }, [initialGameState, boardDate]);

  const gs = state.gameState;

  // ── Completion side-effects ──────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!gs || gs.status !== "draft_complete" || !gs.lineup_evaluation) return;

    if (gs.board_type === "daily" && boardDate !== undefined) {
      analytics.track({
        type: "daily_game_completed",
        mode: gs.mode,
        date: boardDate,
        lineup_peak_rating: gs.lineup_evaluation.lineup_peak_rating,
        draft_efficiency: gs.lineup_evaluation.draft_efficiency,
      });
      draftProgress.saveDailyCompletion(boardDate, gs.mode, {
        game_id: gs.game_id,
        mode: gs.mode,
        board_type: gs.board_type,
        completed_at: new Date().toISOString(),
        lineup_peak_rating: gs.lineup_evaluation.lineup_peak_rating,
        draft_efficiency: gs.lineup_evaluation.draft_efficiency,
        board_percentile: gs.lineup_evaluation.board_percentile,
        board_id: gs.board_metadata.board_id,
        hold_used: gs.hold_used,
        reframe_used: gs.reframe_used,
      });
      draftProgress.clearActiveGame();
    }

    if (challengeToken) {
      // challengeToken is set by the challenge page, regardless of the board's original board_type
      const gameId = gs.game_id;
      const mode = gs.mode;
      setComparisonLoading(true);
      (async () => {
        try {
          const result = await getChallengeComparison(challengeToken, gameId);
          setComparison(result);
          analytics.track({ type: "challenge_completed", mode, outcome: result.outcome });
        } catch {
          setComparisonError("Comparison unavailable");
        } finally {
          setComparisonLoading(false);
        }
      })();
      draftProgress.clearActiveGame();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gs?.status]); // intentionally narrow: fires exactly once when status reaches draft_complete

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
      const url = `${window.location.origin}${result.public_url_path}`;
      setShareUrl(url);
      setShowShareModal(true);
      analytics.track({ type: "challenge_created", mode: gs.mode, board_type: gs.board_type });
    } catch (err) {
      console.error("Failed to create challenge:", err);
    }
  }, [gs]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!gs || state.phase === "loading") {
    return (
      <PeakV2Shell width="live">
        <div
          className="flex items-center justify-center h-64 text-sm"
          style={{ color: "var(--text-muted)" }}
        >
          Loading board…
        </div>
      </PeakV2Shell>
    );
  }

  if (state.phase === "error") {
    return (
      <PeakV2Shell width="live">
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <p role="alert" style={{ color: "var(--incorrect)" }}>
            {state.errorMessage}
          </p>
          <PeakV2SecondaryAction onClick={() => router.push("/arena")}>
            Back to Arena
          </PeakV2SecondaryAction>
        </div>
      </PeakV2Shell>
    );
  }

  const isDone = gs.status === "draft_complete";
  const submitting = state.phase === "submitting";

  // Which card (if any) is selected from current offers?
  const selectedCard: DraftCardType | null =
    state.selectedOfferId
      ? gs.current_offers.find((c) => c.peak_window_id === state.selectedOfferId) ?? null
      : null;

  // The persistent roster/DNA rail only earns its place on screens wide
  // enough to hold a second column without stealing width from the one
  // decision that matters (brief: "one obvious decision at a time" on
  // mobile). It shows the SAME data the in-flow LineupBoard would — full
  // roster, single held card, empty/all-open board on round one included —
  // never a duplicate DOM node: each is `lg:hidden` / `hidden lg:flex` so
  // exactly one of the two renders at any viewport width.
  //
  // Once the draft is complete there is nothing left to hold a decision
  // over, so no rail renders. Rather than leave the reserved 320px column
  // empty beside a receipt that was never widened to use it (a real gap an
  // independent visual pass over this exact commit caught, at 1024/1440),
  // the completed state drops the grid and widens its own single column
  // instead — simpler than mounting a second copy of `DecisionReplay` to
  // fill the rail, which would have put two "ROUND 1 · ..." nodes in the
  // DOM at once and broken `gameplay.spec.ts`'s existing, unscoped
  // `getByText(/round 1|pick 1|your picks/i)` assertion.
  const sidebar = !isDone ? (
    <div className="hidden lg:flex lg:flex-col gap-4 lg:sticky lg:top-6">
      <LineupBoard
        selectedCards={gs.selected_cards}
        openRoles={gs.open_roles}
        heldCard={gs.held_card}
      />
      {gs.current_dna && gs.selected_cards.length > 0 && (
        <div
          className="pk-depth pk-crown rounded-xl border p-4"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <DNABar dna={gs.current_dna} label="Current lineup DNA" />
        </div>
      )}
    </div>
  ) : null;

  return (
    <PeakV2Shell width="live">
      <div className="py-6 lg:py-8">
        <div
          className={
            sidebar
              ? "mx-auto max-w-lg lg:max-w-none lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8 lg:items-start"
              : "mx-auto max-w-lg lg:max-w-2xl"
          }
        >
          <div className="flex flex-col gap-5 px-4 lg:px-0">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <StatusChip tone="accent" size="sm">
              {MODE_LABELS[gs.mode]}
            </StatusChip>
            <StatusChip tone="neutral" size="sm">
              Round {gs.current_round}/{gs.total_rounds}
            </StatusChip>
          </div>
          <h1
            className="text-xl font-bold mt-1.5"
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
          role="alert"
          className="text-xs px-3 py-2 rounded-lg"
          style={{ background: "var(--incorrect-bg)", color: "var(--incorrect)" }}
        >
          {state.errorMessage}
        </div>
      )}

      {/* ── DRAFT COMPLETE ──────────────────────── */}
      {isDone && gs.lineup_evaluation && (
        <div data-testid="draft-result">
          {challengeToken && comparison ? (
            // Challenge recipient completed — show comparison
            <ChallengeComparison
              comparison={comparison}
              recipientGameId={gs.game_id}
              challengeUrl={shareUrl ?? undefined}
            />
          ) : (
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
              {challengeToken && comparisonLoading && (
                <div
                  className="text-sm text-center py-4"
                  style={{ color: "var(--text-muted)" }}
                >
                  Loading comparison…
                </div>
              )}
              {challengeToken && comparisonError && (
                <div
                  className="text-xs px-3 py-2 rounded-lg"
                  style={{ background: "var(--incorrect-bg)", color: "var(--incorrect)" }}
                >
                  {comparisonError}
                </div>
              )}
            </>
          )}
        </div>
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
          <div className="lg:hidden">
            <LineupBoard
              selectedCards={gs.selected_cards}
              openRoles={gs.open_roles}
            />
          </div>
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
                    eligible={hasEligibleRole}
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
                // P3-G2: `"var(--peak-accent)10"`/`"var(--peak-accent)40"`
                // were pre-existing invalid CSS (appending digits directly
                // to a var() reference), unrelated to theming -- the browser
                // silently dropped both `background` and `borderColor`
                // rather than erroring, so this block rendered with neither
                // in every theme. Fixed alongside the real light-mode work
                // since it was found while auditing this exact block.
                background: "var(--peak-accent-bg)",
                borderColor: "color-mix(in srgb, var(--peak-accent) 40%, transparent)",
                color: "var(--peak-accent-text)",
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
        <div className="lg:hidden">
          <LineupBoard
            selectedCards={gs.selected_cards}
            openRoles={gs.open_roles}
            heldCard={gs.held_card}
          />
        </div>
      )}

      {/* ── CURRENT DNA ──────────────────────────── */}
      {gs.current_dna && !isDone && gs.selected_cards.length > 0 && (
        <div
          className="lg:hidden pk-depth pk-crown rounded-xl border p-4"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <DNABar dna={gs.current_dna} label="Current lineup DNA" />
        </div>
      )}

      {/* ── SHARE CHALLENGE MODAL ────────────────── */}
      {showShareModal && shareUrl && (
        <ShareChallenge
          challengeUrl={shareUrl}
          mode={gs.mode}
          lineupPeakRating={gs.lineup_evaluation?.lineup_peak_rating ?? 0}
          onClose={() => setShowShareModal(false)}
        />
      )}
          </div>
          {sidebar}
        </div>
      </div>
    </PeakV2Shell>
  );
}
