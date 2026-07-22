import { describe, it, expect } from "vitest";
import {
  uiPhaseFromStatus,
  getOpenSlotTypes,
  filledSlotCount,
  isRosterComplete,
  hasResult,
} from "@/lib/court-state";
import type { CourtLineupPublicState, CourtSlotPublic } from "@/types/perfect-season";
import { SLOT_TYPES } from "@/types/perfect-season";

function mockSlots(filledCount: number): CourtSlotPublic[] {
  return SLOT_TYPES.map((slot_type, i) => ({
    slot_type,
    filled: i < filledCount,
    peak_window_id: i < filledCount ? `player-${i}-1yr-202021` : null,
    player_name: i < filledCount ? `Player ${i}` : null,
    anchor_season: i < filledCount ? "2020-21" : null,
    individual_peak_score: i < filledCount ? 80 : null,
    individual_peak_rank: i < filledCount ? i + 1 : null,
    resolved_via_spin_id: null,
  }));
}

function mockState(overrides: Partial<CourtLineupPublicState> = {}): CourtLineupPublicState {
  return {
    game_id: "game-1",
    status: "selection_pending",
    mode: "apex_1y",
    current_round: 1,
    total_rounds: 8,
    current_spin: null,
    pending_selection: null,
    slots: mockSlots(0),
    board_seed: 42,
    card_pool_version: "v3",
    board_generator_version: "perfect_season_board_v0",
    interim_team_data_version: "courtbuilder_interim_teams.v0",
    simulation_result: null,
    ...overrides,
  };
}

describe("uiPhaseFromStatus", () => {
  it("maps selection_pending to spinning", () => {
    expect(uiPhaseFromStatus("selection_pending")).toBe("spinning");
  });
  it("maps placement_pending to placing", () => {
    expect(uiPhaseFromStatus("placement_pending")).toBe("placing");
  });
  it("maps rounds_complete and result_ready to complete", () => {
    expect(uiPhaseFromStatus("rounds_complete")).toBe("complete");
    expect(uiPhaseFromStatus("result_ready")).toBe("complete");
  });
});

describe("getOpenSlotTypes", () => {
  it("returns all 8 slots when none are filled", () => {
    expect(getOpenSlotTypes(mockSlots(0))).toHaveLength(8);
  });

  it("returns only unfilled slots", () => {
    const open = getOpenSlotTypes(mockSlots(3));
    expect(open).toHaveLength(5);
    expect(open).not.toContain("starter_1");
    expect(open).toContain("bench_3");
  });

  it("allows bench slots to be open while starters are filled -- soft placement, no forced order", () => {
    const slots = mockSlots(0).map((s) => ({
      ...s,
      filled: s.slot_type.startsWith("starter"),
    }));
    const open = getOpenSlotTypes(slots);
    expect(open).toEqual(["bench_1", "bench_2", "bench_3"]);
  });
});

describe("filledSlotCount", () => {
  it("counts filled slots correctly", () => {
    expect(filledSlotCount(mockSlots(0))).toBe(0);
    expect(filledSlotCount(mockSlots(5))).toBe(5);
    expect(filledSlotCount(mockSlots(8))).toBe(8);
  });
});

describe("isRosterComplete", () => {
  it("is false while selecting/placing", () => {
    expect(isRosterComplete(mockState({ status: "selection_pending" }))).toBe(false);
    expect(isRosterComplete(mockState({ status: "placement_pending" }))).toBe(false);
  });
  it("is true once rounds_complete or result_ready", () => {
    expect(isRosterComplete(mockState({ status: "rounds_complete" }))).toBe(true);
    expect(isRosterComplete(mockState({ status: "result_ready" }))).toBe(true);
  });
});

describe("hasResult", () => {
  it("is false before simulation runs", () => {
    expect(hasResult(mockState())).toBe(false);
  });
  it("is true once simulation_result is present -- result must always load after completion", () => {
    const state = mockState({
      status: "result_ready",
      simulation_result: {
        lineup_model_version: "perfect_season_lineup_fit_v0",
        simulator_version: "perfect_season_simulator_v0",
        fit_components: {},
        wins: 82,
        losses: 0,
        expected_wins: 80,
        expected_wins_low: 75,
        expected_wins_high: 82,
        decisive_factors: ["Elite talent core"],
        is_perfect_season: true,
        experimental_notice: "v0 experimental",
      },
    });
    expect(hasResult(state)).toBe(true);
  });
});
