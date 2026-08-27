"use client";

import { useReducer, useEffect, useRef, useCallback, useState } from "react";
import type { GameMode, Duel } from "@/types";
import {
  gameReducer,
  createInitialState,
  currentDuel,
  isComplete,
} from "@/lib/game-state";
import { submitAnswer, postDailyResult } from "@/lib/api";
import { getProgressRepository } from "@/lib/progress";
import { deadlineFromSeconds } from "@/components/shared/ArenaTimer";
import PeakDuelV2Stage from "@/components/v2/duel/PeakDuelV2Stage";
import { DECISION_CLOCK_SECONDS } from "@/lib/peak-duel-constants";

// Peak Duel Daily only: a short decision clock per duel. Endless mode stays
// exactly as it was — untimed, manual-advance only.
//
// The clock reuses `ArenaTimer` (the multiplayer arena's decision clock)
// rather than a hand-rolled interval: it already ticks against a monotonic
// `performance.now()` deadline in its own isolated component (so a 250ms
// tick never re-renders the duel cards), and its reduced-motion handling is
// pure CSS, already audited.
//
// The clock LENGTH itself lives in `lib/peak-duel-constants.ts` — the one
// authoritative source `PeakDuelV2Question` also imports, so V2 and legacy
// can never drift to two different clock lengths again.

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

  // Daily only: a fresh monotonic deadline per duel, converted once at the
  // moment the duel becomes interactable — never held as a duration that
  // gets ticked down in this component's own state (see the module note).
  //
  // A CLOCK IS BOUND TO THE QUESTION IT WAS ARMED FOR. This used to be a bare
  // `deadlineAt` that an effect re-armed on `[phase, current_index]`, which
  // left the PREVIOUS duel's (by then long-expired) deadline sitting in state
  // for the duration of the reveal. React runs a child's MOUNT effect before
  // its parent's UPDATE effect, so pressing "Next Matchup" mounted the next
  // question's `ArenaTimer` with that stale deadline still in place;
  // `ArenaTimer` ticks once synchronously on mount, read `remaining <= 0`, and
  // fired `onExpire` -> `handleTimeout` -> a null-pick submission. The player
  // lost the matchup before seeing it, and the longer they read the previous
  // result the more certain that was. Storing the index the deadline belongs
  // to, and refusing to hand down a clock that does not match the question
  // currently on screen, makes that entire class of bug unrepresentable.
  const [clock, setClock] = useState<{ index: number; deadlineAt: number | null } | null>(null);

  // Arm the clock ONLY for an active question, and disarm it for every other
  // phase — the reveal must not have a countdown running behind it.
  useEffect(() => {
    if (state.phase !== "picking") {
      setClock(null);
      return;
    }
    startTimeRef.current = Date.now();
    setClock({
      index: state.current_index,
      deadlineAt: mode === "daily" ? deadlineFromSeconds(DECISION_CLOCK_SECONDS) : null,
    });
  }, [state.phase, state.current_index, mode]);

  // The render-time guard. On the commit that opens the next question the
  // effect above has not run yet, so `clock` is still null (or still the
  // previous index): both resolve to "no clock", which `ArenaTimer` treats as
  // idle rather than expired. The real deadline arrives one commit later, at
  // its full duration.
  const deadlineAt =
    state.phase === "picking" && clock !== null && clock.index === state.current_index
      ? clock.deadlineAt
      : null;

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
      // Fast local cache, unchanged — still what the "already completed" gate
      // on /play/daily reads before a page even reaches this component.
      repo.current.recordDailyCompletion(date, years, state.results);

      // The official record. Idempotent server-side per (owner, mode,
      // daily_key), so a resubmit from this same effect (e.g. React strict
      // -mode's dev double-invoke) or a future replay of an already-finished
      // day just returns `already_recorded: true` rather than double-counting
      // — no client-side guard needed beyond the one this effect already has
      // (fires exactly once per real phase transition into "complete").
      const selections = Object.fromEntries(
        state.results
          .filter((r): r is typeof r & { selected_peak_id: string } => r.selected_peak_id !== null)
          .map((r) => [r.duel_id, r.selected_peak_id])
      );
      postDailyResult({ session_token: state.session_token, selections }).catch(() => {
        // The local record above already stands; a failed official POST
        // (offline, signed-out edge case, etc.) must not surface as a broken
        // completion screen the player just earned.
      });

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
        : DECISION_CLOCK_SECONDS * 1000;

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

  // A genuine no-pick: the decision clock reached zero before the player
  // chose a side. Scored as incorrect by the server, same as a wrong manual
  // pick — never silently dropped from the session.
  const handleTimeout = useCallback(async () => {
    if (state.phase !== "picking" || state.is_submitting) return;
    const duel = currentDuel(state);
    if (!duel) return;

    dispatch({ type: "SUBMIT_TIMEOUT" });

    const elapsed_ms = startTimeRef.current
      ? Math.max(0, Date.now() - startTimeRef.current)
      : DECISION_CLOCK_SECONDS * 1000;

    try {
      const answer = await submitAnswer({
        session_token: state.session_token,
        duel_id: duel.id,
        selected_peak_id: null,
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
  }, [state]);

  // Rounds 1-9 (daily) no longer auto-advance out of the reveal: the result
  // stays on screen indefinitely until the player presses "Next Matchup"
  // (`onNext` below), which dispatches ADVANCE directly. Round 10 already
  // used a manual "See results" press for the same reducer action, so no
  // separate final-round case is needed now that every round is manual.
  const duel = currentDuel(state);

  // V2's own presentation branch (Pass 3) consumes this exact `state` —
  // same reducer, same handlers, same deadline.
  const v2Stage = (
    <PeakDuelV2Stage
      state={state}
      date={date}
      deadlineAt={deadlineAt}
      onSelect={handleSelect}
      onTimeout={handleTimeout}
      onNext={() => dispatch({ type: "ADVANCE" })}
    />
  );

  if (isComplete(state)) {
    return v2Stage;
  }

  if (!duel) return null;

  return v2Stage;
}
