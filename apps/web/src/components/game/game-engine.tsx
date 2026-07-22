"use client";

import { useReducer, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { GameMode, Duel } from "@/types";
import {
  gameReducer,
  createInitialState,
  currentDuel,
  isComplete,
} from "@/lib/game-state";
import { submitAnswer } from "@/lib/api";
import { getProgressRepository } from "@/lib/progress";
import { DuelCardComponent } from "./duel-card";
import { RevealPanel } from "./reveal-panel";
import { ChallengeSummary } from "./challenge-summary";

interface GameEngineProps {
  mode: GameMode;
  years: number;
  duels: Duel[];
  session_token: string;
  date?: string;
  seed?: number;
  onComplete?: () => void;
}

export function GameEngine({
  mode,
  years,
  duels,
  session_token,
  date,
  seed,
  onComplete,
}: GameEngineProps) {
  const [state, dispatch] = useReducer(
    gameReducer,
    { mode, years, duels, session_token, date, seed },
    ({ mode, years, duels, session_token, date, seed }) =>
      createInitialState(mode, years, duels, session_token, { date, seed })
  );

  const startTimeRef = useRef<number | null>(null);
  const repo = useRef(getProgressRepository());

  // Start timer when a duel becomes active
  useEffect(() => {
    if (state.phase === "picking") {
      startTimeRef.current = Date.now();
    }
  }, [state.phase, state.current_index]);

  // Keyboard support
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const duel = currentDuel(state);
      if (!duel) return;

      if (state.phase === "picking") {
        if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
          e.preventDefault();
          handleSelect(duel.left.peak_id);
        } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
          e.preventDefault();
          handleSelect(duel.right.peak_id);
        }
      } else if (state.phase === "revealing") {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          dispatch({ type: "ADVANCE" });
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  // Save daily completion on finish
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isComplete(state) && mode === "daily" && date) {
      repo.current.recordDailyCompletion(date, years, state.results);
      onComplete?.();
    }
    if (isComplete(state) && mode === "endless") {
      repo.current.updateEndlessScore(state.total_arena_points, state.best_streak);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]); // intentionally narrow: fires exactly once per phase transition

  const handleSelect = useCallback(
    async (peakId: string) => {
      if (state.phase !== "picking" || state.is_submitting) return;
      const duel = currentDuel(state);
      if (!duel) return;

      // Validate selection
      if (peakId !== duel.left.peak_id && peakId !== duel.right.peak_id) return;

      dispatch({ type: "SELECT_PEAK", peak_id: peakId });
      dispatch({ type: "SUBMIT_START" });

      const elapsed_ms = startTimeRef.current
        ? Math.max(0, Date.now() - startTimeRef.current)
        : 5000;

      try {
        const answer = await submitAnswer({
          session_token: state.session_token,
          duel_id: duel.id,
          selected_peak_id: peakId,
          elapsed_ms,
          current_streak: state.current_streak,
        });
        dispatch({ type: "SUBMIT_SUCCESS", answer, elapsed_ms });
        repo.current.recordAnswer(answer.correct);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to submit answer";
        dispatch({ type: "SUBMIT_ERROR", error: message });
      }
    },
    [state]
  );

  const duel = currentDuel(state);

  if (isComplete(state)) {
    return (
      <ChallengeSummary
        state={state}
        date={date}
      />
    );
  }

  if (!duel) return null;

  const leftSelected = state.selected_peak_id === duel.left.peak_id;
  const rightSelected = state.selected_peak_id === duel.right.peak_id;
  const revealed = state.phase === "revealing";
  const winnerId = state.current_answer?.winning_peak_id;

  return (
    <div className="mx-auto max-w-2xl space-y-5 py-6">
      {/* Progress + score bar */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          {mode === "daily" && (
            <>
              <p className="text-[var(--text-secondary)]">
                {state.current_index + 1} / {duels.length}
              </p>
              <div
                className="h-1 w-24 rounded-full bg-[var(--border-subtle)] overflow-hidden"
                role="progressbar"
                aria-valuenow={state.current_index + 1}
                aria-valuemin={1}
                aria-valuemax={duels.length}
              >
                <motion.div
                  className="h-full rounded-full bg-[var(--peak-accent)]"
                  animate={{ width: `${((state.current_index + 1) / duels.length) * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
          {state.current_streak > 0 && (
            <span className="text-[var(--peak-accent)] font-semibold">
              🔥 {state.current_streak}
            </span>
          )}
          <span className="score-number font-medium text-[var(--text-primary)]">
            {state.total_arena_points.toLocaleString()} pts
          </span>
        </div>
      </div>

      {/* Duel type label */}
      <div className="text-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">
          Peak Duel · {duel.left.duration_years}-Year Window
        </p>
      </div>

      {/* Cards */}
      <AnimatePresence mode="wait">
        <motion.div
          key={duel.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.25 }}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          <DuelCardComponent
            card={duel.left}
            side="left"
            selected={leftSelected}
            revealed={revealed}
            isWinner={revealed && winnerId === duel.left.peak_id}
            primeScore={
              revealed ? state.current_answer?.winner.player_id === duel.left.player_slug
                ? state.current_answer?.winner.prime_score
                : state.current_answer?.loser.prime_score
              : undefined
            }
            onClick={() => handleSelect(duel.left.peak_id)}
            disabled={state.is_submitting || revealed}
          />
          <DuelCardComponent
            card={duel.right}
            side="right"
            selected={rightSelected}
            revealed={revealed}
            isWinner={revealed && winnerId === duel.right.peak_id}
            primeScore={
              revealed ? state.current_answer?.winner.player_id === duel.right.player_slug
                ? state.current_answer?.winner.prime_score
                : state.current_answer?.loser.prime_score
              : undefined
            }
            onClick={() => handleSelect(duel.right.peak_id)}
            disabled={state.is_submitting || revealed}
          />
        </motion.div>
      </AnimatePresence>

      {/* Keyboard hint */}
      {!revealed && (
        <p className="text-center text-[10px] text-[var(--text-muted)]">
          Use{" "}
          <kbd className="rounded border border-[var(--border-subtle)] px-1 font-mono">←</kbd>{" "}
          <kbd className="rounded border border-[var(--border-subtle)] px-1 font-mono">A</kbd>{" "}
          or{" "}
          <kbd className="rounded border border-[var(--border-subtle)] px-1 font-mono">→</kbd>{" "}
          <kbd className="rounded border border-[var(--border-subtle)] px-1 font-mono">D</kbd>{" "}
          to choose
        </p>
      )}

      {/* Submitting indicator */}
      {state.is_submitting && (
        <p className="text-center text-xs text-[var(--text-muted)] animate-pulse" role="status">
          Checking…
        </p>
      )}

      {/* Error */}
      {state.error && !state.is_submitting && (
        <div role="alert" className="rounded-lg bg-[var(--incorrect-bg)] border border-[var(--incorrect)] p-3 text-sm text-[var(--incorrect)]">
          {state.error} — tap a player to try again.
        </div>
      )}

      {/* Reveal panel */}
      {revealed && state.current_answer && (
        <RevealPanel
          answer={state.current_answer}
          arenaPoints={state.total_arena_points}
          streak={state.current_streak}
          onNext={() => dispatch({ type: "ADVANCE" })}
          isLast={state.current_index === duels.length - 1}
        />
      )}
    </div>
  );
}
