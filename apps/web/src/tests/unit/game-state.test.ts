import { describe, it, expect } from "vitest";
import {
  createInitialState,
  gameReducer,
  isComplete,
  currentDuel,
  getAccuracy,
} from "@/lib/game-state";
import type { Duel, AnswerResponse } from "@/types";

const mockDuel = (id: string): Duel => ({
  id,
  left: {
    player_name: "Player A",
    player_slug: "player-a",
    duration_years: 3,
    start_season: "1990-91",
    end_season: "1992-93",
    anchor_season: "1990-91",
    peak_id: `left-${id}`,
  },
  right: {
    player_name: "Player B",
    player_slug: "player-b",
    duration_years: 3,
    start_season: "2010-11",
    end_season: "2012-13",
    anchor_season: "2010-11",
    peak_id: `right-${id}`,
  },
  difficulty: "Tricky",
});

const mockAnswer = (correct: boolean, points: number, streak: number): AnswerResponse => ({
  correct,
  winning_peak_id: "left-duel1",
  arena_points_awarded: correct ? points : 0,
  updated_streak: streak,
  difficulty: "Tricky",
  score_gap: 5.0,
  winner: {
    id: "player-a-3yr-199091",
    player_id: "player-a",
    player_slug: "player-a",
    player_name: "Player A",
    duration_years: 3,
    start_season: "1990-91",
    end_season: "1992-93",
    anchor_season: "1990-91",
    rank: 1,
    prime_score: 97.5,
    prime_index: 86.8,
    components: {
      statistical_impact: 37.0,
      traditional_production: 14.0,
      individual_recognition: 20.0,
      postseason_individual_value: 12.0,
      team_achievement: 3.0,
      teammate_adjustment: -0.2,
    },
    data_status: "complete",
  },
  loser: {
    id: "player-b-3yr-201011",
    player_id: "player-b",
    player_slug: "player-b",
    player_name: "Player B",
    duration_years: 3,
    start_season: "2010-11",
    end_season: "2012-13",
    anchor_season: "2010-11",
    rank: 2,
    prime_score: 94.0,
    prime_index: 80.0,
    components: {
      statistical_impact: 35.0,
      traditional_production: 14.0,
      individual_recognition: 18.0,
      postseason_individual_value: 9.0,
      team_achievement: 3.0,
      teammate_adjustment: -0.1,
    },
    data_status: "complete",
  },
  component_comparison: {
    statistical_impact: { winner: 37.0, loser: 35.0, winner_leads: true },
    traditional_production: { winner: 14.0, loser: 14.0, winner_leads: true },
    individual_recognition: { winner: 20.0, loser: 18.0, winner_leads: true },
    postseason_individual_value: { winner: 12.0, loser: 9.0, winner_leads: true },
    team_achievement: { winner: 3.0, loser: 3.0, winner_leads: true },
    teammate_adjustment: { winner: -0.2, loser: -0.1, winner_leads: false },
  },
  explanation: "Player A's advantage came primarily from Postseason Value.",
  selected_correctly: correct,
});

describe("game-state", () => {
  it("creates initial state correctly", () => {
    const duels = [mockDuel("duel1"), mockDuel("duel2")];
    const state = createInitialState("daily", 3, duels, "token123", { date: "2026-06-28" });
    expect(state.mode).toBe("daily");
    expect(state.years).toBe(3);
    expect(state.duels).toHaveLength(2);
    expect(state.current_index).toBe(0);
    expect(state.phase).toBe("picking");
    expect(state.total_arena_points).toBe(0);
    expect(state.current_streak).toBe(0);
    expect(state.results).toHaveLength(0);
  });

  it("SELECT_PEAK updates selected_peak_id", () => {
    const duels = [mockDuel("duel1")];
    const state = createInitialState("daily", 3, duels, "token");
    const next = gameReducer(state, { type: "SELECT_PEAK", peak_id: "left-duel1" });
    expect(next.selected_peak_id).toBe("left-duel1");
  });

  it("SELECT_PEAK is ignored during revealing phase", () => {
    const duels = [mockDuel("duel1")];
    let state = createInitialState("daily", 3, duels, "token");
    state = { ...state, phase: "revealing" };
    const next = gameReducer(state, { type: "SELECT_PEAK", peak_id: "left-duel1" });
    expect(next.selected_peak_id).toBeNull();
  });

  it("SUBMIT_SUCCESS transitions to revealing and records result", () => {
    const duels = [mockDuel("duel1"), mockDuel("duel2")];
    let state = createInitialState("daily", 3, duels, "token");
    state = gameReducer(state, { type: "SELECT_PEAK", peak_id: "left-duel1" });
    state = gameReducer(state, { type: "SUBMIT_START" });
    const answer = mockAnswer(true, 250, 1);
    state = gameReducer(state, { type: "SUBMIT_SUCCESS", answer, elapsed_ms: 5000 });

    expect(state.phase).toBe("revealing");
    expect(state.current_streak).toBe(1);
    expect(state.total_arena_points).toBe(250);
    expect(state.results).toHaveLength(1);
    expect(state.results[0].correct).toBe(true);
  });

  it("incorrect answer resets streak", () => {
    const duels = [mockDuel("duel1")];
    let state = createInitialState("daily", 3, duels, "token");
    state = { ...state, current_streak: 5, best_streak: 5 };
    state = gameReducer(state, { type: "SELECT_PEAK", peak_id: "left-duel1" });
    state = gameReducer(state, { type: "SUBMIT_START" });
    const answer = mockAnswer(false, 0, 0);
    state = gameReducer(state, { type: "SUBMIT_SUCCESS", answer, elapsed_ms: 5000 });

    expect(state.current_streak).toBe(0);
    expect(state.best_streak).toBe(5); // best streak preserved
    expect(state.total_arena_points).toBe(0);
  });

  it("ADVANCE moves to next duel", () => {
    const duels = [mockDuel("duel1"), mockDuel("duel2")];
    let state = createInitialState("daily", 3, duels, "token");
    state = { ...state, phase: "revealing" };
    state = gameReducer(state, { type: "ADVANCE" });
    expect(state.current_index).toBe(1);
    expect(state.phase).toBe("picking");
    expect(state.selected_peak_id).toBeNull();
  });

  it("ADVANCE on last duel transitions to complete", () => {
    const duels = [mockDuel("duel1")];
    let state = createInitialState("daily", 3, duels, "token");
    state = { ...state, phase: "revealing", current_index: 0 };
    state = gameReducer(state, { type: "ADVANCE" });
    expect(state.phase).toBe("complete");
  });

  it("isComplete returns true only when phase is complete", () => {
    const duels = [mockDuel("duel1")];
    const state = createInitialState("daily", 3, duels, "token");
    expect(isComplete(state)).toBe(false);
    expect(isComplete({ ...state, phase: "complete" })).toBe(true);
  });

  it("currentDuel returns correct duel", () => {
    const duels = [mockDuel("duel1"), mockDuel("duel2")];
    const state = createInitialState("daily", 3, duels, "token");
    expect(currentDuel(state)?.id).toBe("duel1");
    expect(currentDuel({ ...state, current_index: 1 })?.id).toBe("duel2");
  });

  it("getAccuracy calculates correctly", () => {
    const duels = [mockDuel("d1"), mockDuel("d2"), mockDuel("d3")];
    let state = createInitialState("daily", 3, duels, "token");
    expect(getAccuracy(state)).toBe(0);
    state = {
      ...state,
      results: [
        { duel_id: "d1", selected_peak_id: "left-d1", correct: true, arena_points_awarded: 200, difficulty: "Tricky", score_gap: 5, answer_response: mockAnswer(true, 200, 1) },
        { duel_id: "d2", selected_peak_id: "left-d2", correct: false, arena_points_awarded: 0, difficulty: "Tricky", score_gap: 5, answer_response: mockAnswer(false, 0, 0) },
      ],
    };
    expect(getAccuracy(state)).toBe(0.5);
  });

  it("RESET clears game state", () => {
    const duels = [mockDuel("d1")];
    let state = createInitialState("daily", 3, duels, "token");
    state = { ...state, total_arena_points: 500, current_streak: 3, best_streak: 5 };
    state = gameReducer(state, { type: "RESET" });
    expect(state.total_arena_points).toBe(0);
    expect(state.current_streak).toBe(0);
    expect(state.results).toHaveLength(0);
    expect(state.phase).toBe("picking");
  });
});
