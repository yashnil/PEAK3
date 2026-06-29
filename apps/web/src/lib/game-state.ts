"use client";

import type {
  GameState,
  GameMode,
  Duel,
  AnswerResponse,
  DuelResult,
} from "@/types";

export type GameAction =
  | { type: "SELECT_PEAK"; peak_id: string }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_SUCCESS"; answer: AnswerResponse; elapsed_ms: number }
  | { type: "SUBMIT_ERROR"; error: string }
  | { type: "ADVANCE" }
  | { type: "RESET" };

export function createInitialState(
  mode: GameMode,
  years: number,
  duels: Duel[],
  session_token: string,
  opts?: { date?: string; seed?: number }
): GameState {
  return {
    mode,
    years,
    date: opts?.date,
    seed: opts?.seed,
    session_token,
    duels,
    current_index: 0,
    phase: "picking",
    results: [],
    total_arena_points: 0,
    current_streak: 0,
    best_streak: 0,
    selected_peak_id: null,
    current_answer: null,
    is_submitting: false,
    error: null,
  };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "SELECT_PEAK": {
      if (state.phase !== "picking" || state.is_submitting) return state;
      return { ...state, selected_peak_id: action.peak_id };
    }

    case "SUBMIT_START": {
      if (!state.selected_peak_id) return state;
      return { ...state, is_submitting: true, error: null };
    }

    case "SUBMIT_SUCCESS": {
      const answer = action.answer;
      const points = answer.arena_points_awarded;
      const newStreak = answer.updated_streak;
      const newBestStreak = Math.max(state.best_streak, newStreak);
      const duel = state.duels[state.current_index];
      const result: DuelResult = {
        duel_id: duel.id,
        selected_peak_id: state.selected_peak_id!,
        correct: answer.correct,
        arena_points_awarded: points,
        difficulty: answer.difficulty,
        score_gap: answer.score_gap,
        answer_response: answer,
      };
      return {
        ...state,
        phase: "revealing",
        is_submitting: false,
        current_answer: answer,
        current_streak: newStreak,
        best_streak: newBestStreak,
        total_arena_points: state.total_arena_points + points,
        results: [...state.results, result],
        error: null,
      };
    }

    case "SUBMIT_ERROR": {
      return {
        ...state,
        is_submitting: false,
        error: action.error,
        selected_peak_id: null,
      };
    }

    case "ADVANCE": {
      if (state.phase !== "revealing") return state;
      const nextIndex = state.current_index + 1;
      const isLast = nextIndex >= state.duels.length;
      return {
        ...state,
        phase: isLast ? "complete" : "picking",
        current_index: isLast ? state.current_index : nextIndex,
        selected_peak_id: null,
        current_answer: null,
        error: null,
      };
    }

    case "RESET": {
      return {
        ...state,
        current_index: 0,
        phase: "picking",
        results: [],
        total_arena_points: 0,
        current_streak: 0,
        best_streak: 0,
        selected_peak_id: null,
        current_answer: null,
        is_submitting: false,
        error: null,
      };
    }

    default:
      return state;
  }
}

export function isComplete(state: GameState): boolean {
  return state.phase === "complete";
}

export function currentDuel(state: GameState): Duel | null {
  return state.duels[state.current_index] ?? null;
}

export function getAccuracy(state: GameState): number {
  if (state.results.length === 0) return 0;
  return state.results.filter((r) => r.correct).length / state.results.length;
}

export function photoFinishCount(state: GameState): number {
  return state.results.filter((r) => r.difficulty === "Photo Finish" && r.correct).length;
}
