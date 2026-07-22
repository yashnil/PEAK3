"use client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DraftCard as DraftCardType, DraftRole } from "@/types/draft";
import type { RankedMode, RankedSettlementView } from "@/types/ranked";
import { RANKED_MODE_LABELS } from "@/types/ranked";
import { createInitialRankedState, rankedReducer } from "@/lib/ranked-state";
import { eligibleRolesForCard } from "@/lib/draft-state";
import { rankedApi, RankedAPIError } from "@/lib/ranked-api";
import { useAuth } from "@/lib/auth-context";
import { getAccessToken } from "@/lib/auth";
import { analytics } from "@/lib/analytics";

import DraftCard from "@/components/draft/DraftCard";
import RoleSelector from "@/components/draft/RoleSelector";

interface Props {
  mode: RankedMode;
}

export default function RankedScreen({ mode }: Props) {
  const router = useRouter();
  const { user } = useAuth();
  const [state, dispatch] = useReducer(rankedReducer, createInitialRankedState());
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<DraftRole | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    dispatch({ type: "SET_MODE", mode });
    analytics.track({ type: "ranked_queue_viewed", mode });
  }, [mode]);

  // ── Resume on mount/refresh ──────────────────────────────────────────────
  // A refresh must restore the ranked game or settled result, not silently
  // drop back to an empty queue-join screen — match/participant/submission
  // state is durable server-side; only the last-known match id needs a
  // client-side breadcrumb (same pattern as lib/draft-progress.ts for
  // Daily/Practice resumption).
  useEffect(() => {
    if (!user) return;
    const storageKey = `peak3_ranked_match_${mode}`;
    const knownMatchId = typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;
    if (!knownMatchId) return;

    (async () => {
      const token = await getAccessToken();
      if (!token) return;
      try {
        const match = await rankedApi.getMatch(token, knownMatchId);
        if (match.status === "settled") {
          const result = await rankedApi.getSettlement(token, knownMatchId);
          if ("outcome" in result) {
            dispatch({ type: "MATCHED", matchId: knownMatchId });
            dispatch({ type: "SETTLED", settlement: result as RankedSettlementView });
          }
        } else if (match.status !== "cancelled" && match.status !== "expired" && match.status !== "invalidated") {
          dispatch({ type: "MATCHED", matchId: knownMatchId });
        } else {
          localStorage.removeItem(storageKey);
        }
      } catch {
        localStorage.removeItem(storageKey);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, mode]);

  // Persist the match id the moment we learn it, so a refresh at any later
  // phase (playing, awaiting_opponent, settled) can resume from it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const storageKey = `peak3_ranked_match_${mode}`;
    if (state.matchId) {
      localStorage.setItem(storageKey, state.matchId);
    }
  }, [state.matchId, mode]);

  // ── Queue join ──────────────────────────────────────────────────────────
  const joinQueue = useCallback(async () => {
    if (!user) {
      router.push(`/signin?returnTo=/arena/ranked/${mode}`);
      return;
    }
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("not authenticated");
      const result = await rankedApi.joinQueue(token, mode);
      analytics.track({ type: "ranked_queue_joined", mode });
      if (result.status === "matched") analytics.track({ type: "ranked_match_created", mode });
      dispatch({ type: "QUEUE_JOINED", result });
    } catch (e) {
      const msg = e instanceof RankedAPIError ? e.message : "Could not join the queue. Try again.";
      dispatch({ type: "SET_ERROR", message: msg });
    }
  }, [mode, user, router]);

  const cancelQueue = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return;
    await rankedApi.cancelQueue(token, mode);
    analytics.track({ type: "ranked_queue_cancelled", mode });
    dispatch({ type: "QUEUE_CANCELLED" });
  }, [mode]);

  // ── Poll queue status while waiting ─────────────────────────────────────
  useEffect(() => {
    if (state.phase !== "queue_waiting") {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      const token = await getAccessToken();
      if (!token) return;
      const status = await rankedApi.getQueueStatus(token, mode);
      if (status.status === "matched" && status.match_id) {
        dispatch({ type: "MATCHED", matchId: status.match_id });
      } else if (status.status === "waiting" && status.waited_seconds != null) {
        dispatch({ type: "QUEUE_WAIT_TICK", waitedSeconds: status.waited_seconds });
      }
    }, 2500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [state.phase, mode]);

  // ── Start the game once matched ─────────────────────────────────────────
  useEffect(() => {
    if (state.phase !== "matched" || !state.matchId) return;
    (async () => {
      const token = await getAccessToken();
      if (!token) return;
      const gameState = await rankedApi.startOrGetGame(token, state.matchId!);
      analytics.track({ type: "ranked_match_started", mode });
      dispatch({ type: "GAME_LOADED", gameState });
    })();
  }, [state.phase, state.matchId, mode]);

  // ── Poll for settlement while awaiting opponent ────────────────────────
  useEffect(() => {
    if (state.phase !== "awaiting_opponent" || !state.matchId) return;
    const interval = setInterval(async () => {
      const token = await getAccessToken();
      if (!token || !state.matchId) return;
      const result = await rankedApi.getSettlement(token, state.matchId);
      if ("outcome" in result) {
        const settlement = result as RankedSettlementView;
        analytics.track({ type: "ranked_match_settled", mode, outcome: settlement.outcome });
        analytics.track({ type: "rating_changed", mode });
        if (settlement.placement_progress) {
          analytics.track({
            type: "placement_advanced",
            mode,
            valid_matches_completed: Number(settlement.placement_progress.match(/\d+/)?.[0] ?? 0),
          });
        } else {
          analytics.track({ type: "placement_completed", mode });
        }
        dispatch({ type: "SETTLED", settlement });
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [state.phase, state.matchId, mode]);

  const handleSelectOffer = useCallback((cardId: string) => {
    setSelectedOfferId((prev) => (prev === cardId ? null : cardId));
    setPendingRole(null);
  }, []);

  const handleConfirm = useCallback(
    async (cardId: string, role: DraftRole) => {
      if (!state.matchId) return;
      setSubmitting(true);
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("not authenticated");
        const updated = await rankedApi.submitAction(token, state.matchId, {
          action: "select_card",
          card_id: cardId,
          role,
          idempotency_key: crypto.randomUUID(),
        });
        setSelectedOfferId(null);
        setPendingRole(null);
        if (updated.status === "draft_complete") {
          analytics.track({ type: "ranked_match_completed", mode });
          dispatch({ type: "AWAITING_OPPONENT" });
        } else {
          dispatch({ type: "GAME_LOADED", gameState: updated });
        }
      } catch (e) {
        const msg = e instanceof RankedAPIError ? e.message : "Server error. Try again.";
        dispatch({ type: "SET_ERROR", message: msg });
      } finally {
        setSubmitting(false);
      }
    },
    [state.matchId, mode],
  );

  const gs = state.gameState;

  // ── Render ───────────────────────────────────────────────────────────────

  if (state.phase === "queue_idle") {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <p style={{ color: "var(--text-secondary)" }}>
          Ranked pairs you with another PEAK3 player on the exact same hidden board. Neither
          side sees the other&apos;s picks until both are done.
        </p>
        <button
          onClick={joinQueue}
          className="px-6 py-3 rounded-lg font-semibold"
          style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
        >
          Join {RANKED_MODE_LABELS[mode]} queue
        </button>
      </div>
    );
  }

  if (state.phase === "queue_waiting") {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center" aria-live="polite">
        <p style={{ color: "var(--text-primary)" }}>Waiting for an opponent…</p>
        <p className="text-sm tabular-nums" style={{ color: "var(--text-muted)" }}>
          {Math.floor(state.waitedSeconds)}s elapsed
        </p>
        <button
          onClick={cancelQueue}
          className="text-sm px-4 py-2 rounded-lg"
          style={{ color: "var(--text-secondary)", background: "var(--bg-elevated)" }}
        >
          Cancel
        </button>
      </div>
    );
  }

  if (state.phase === "matched" || (state.phase === "playing" && !gs)) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center" aria-live="polite">
        <p style={{ color: "var(--text-primary)" }}>Matched! Loading your board…</p>
      </div>
    );
  }

  if (state.phase === "awaiting_opponent") {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center" aria-live="polite">
        <p style={{ color: "var(--text-primary)" }}>You&apos;re done. Waiting for your opponent to finish…</p>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Your picks and score stay hidden from them until settlement, too.
        </p>
      </div>
    );
  }

  if (state.phase === "settled" && state.settlement) {
    return <RankedResultView settlement={state.settlement} mode={mode} onDone={() => dispatch({ type: "RESET" })} />;
  }

  if (state.phase === "error") {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <p style={{ color: "var(--text-primary)" }}>{state.errorMessage}</p>
        <button
          onClick={() => dispatch({ type: "RESET" })}
          className="text-sm px-4 py-2 rounded-lg"
          style={{ color: "var(--text-secondary)", background: "var(--bg-elevated)" }}
        >
          Back to queue
        </button>
      </div>
    );
  }

  if (!gs) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between text-sm" style={{ color: "var(--text-secondary)" }}>
        <span>Round {gs.current_round} of {gs.total_rounds}</span>
        <span>{RANKED_MODE_LABELS[mode]} · Ranked</span>
      </div>

      {pendingRole === null ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {gs.current_offers.map((card: DraftCardType) => {
            const eligibleOpen = eligibleRolesForCard(card, gs.open_roles);
            const hasEligibleRole = eligibleOpen.length > 0;
            return (
              <DraftCard
                key={card.peak_window_id}
                card={card}
                selected={selectedOfferId === card.peak_window_id}
                eligible={hasEligibleRole}
                dimmed={!hasEligibleRole}
                onClick={
                  !submitting
                    ? () => {
                        handleSelectOffer(card.peak_window_id);
                        if (eligibleOpen.length === 1) {
                          void handleConfirm(card.peak_window_id, eligibleOpen[0]);
                        } else if (eligibleOpen.length > 1) {
                          setPendingRole(eligibleOpen[0]);
                        }
                      }
                    : undefined
                }
              />
            );
          })}
        </div>
      ) : (
        selectedOfferId && (
          <RoleSelector
            card={gs.current_offers.find((c) => c.peak_window_id === selectedOfferId)!}
            openRoles={gs.open_roles}
            selectedRole={pendingRole}
            onSelect={setPendingRole}
            onCancel={() => {
              setSelectedOfferId(null);
              setPendingRole(null);
            }}
            onConfirm={() => selectedOfferId && pendingRole && handleConfirm(selectedOfferId, pendingRole)}
            submitting={submitting}
          />
        )
      )}
    </div>
  );
}

function RankedResultView({
  settlement,
  mode,
  onDone,
}: {
  settlement: RankedSettlementView;
  mode: RankedMode;
  onDone: () => void;
}) {
  const outcomeLabel = settlement.outcome === "win" ? "Victory" : settlement.outcome === "loss" ? "Defeat" : "Draw";
  const delta = settlement.rating_change.delta;
  const deltaLabel = settlement.placement_progress
    ? "Rating hidden during placements"
    : `${delta >= 0 ? "+" : ""}${delta.toFixed(0)}`;

  return (
    <div className="flex flex-col gap-6 py-6">
      {/* Tier 1: outcome + scores — always visible first */}
      <div className="text-center">
        <div className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          {RANKED_MODE_LABELS[mode]} · Ranked
        </div>
        <div className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
          {outcomeLabel}
        </div>
        <div className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          You {settlement.your_score.toFixed(2)} · Opponent {settlement.opponent_score.toFixed(2)}
          {settlement.tie_break_used && settlement.tie_break_used !== "none" && (
            <span> · decided by {settlement.tie_break_used.replace("_", " ")}</span>
          )}
        </div>
      </div>

      {/* Tier 2: rating change / placement progress */}
      <div className="rounded-xl border p-4 text-center" style={{ borderColor: "var(--border-default)" }}>
        {settlement.placement_progress ? (
          <div style={{ color: "var(--text-primary)" }}>{settlement.placement_progress}</div>
        ) : (
          <div style={{ color: "var(--text-primary)" }}>
            Rating: {settlement.rating_change.prior_rating.toFixed(0)} → {settlement.rating_change.new_rating.toFixed(0)}{" "}
            <span style={{ color: delta >= 0 ? "var(--correct)" : "var(--incorrect)" }}>({deltaLabel})</span>
          </div>
        )}
        {settlement.division_change && (
          <div className="mt-1 text-sm" style={{ color: "var(--peak-accent)" }}>{settlement.division_change}</div>
        )}
      </div>

      <div className="flex justify-center gap-3">
        <button
          onClick={onDone}
          className="px-5 py-2.5 rounded-lg font-semibold"
          style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
        >
          Queue again
        </button>
      </div>
    </div>
  );
}
