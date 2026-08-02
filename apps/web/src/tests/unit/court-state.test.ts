import { describe, it, expect } from "vitest";
import {
  uiPhaseFromStatus,
  getOpenSlotTypes,
  filledSlotCount,
  isRosterComplete,
  hasResult,
} from "@/lib/court-state";
import { respinIdempotencyKey } from "@/lib/perfect-season-api";
import type { CourtLineupPublicState, CourtSlotPublic } from "@/types/perfect-season";
import { BENCH_SLOT_TYPES, ERA_LABELS, SLOT_LABELS, SLOT_TYPES, STARTER_SLOT_TYPES } from "@/types/perfect-season";

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
    board_generator_version: "perfect_season_board_v2",
    interim_team_data_version: "courtbuilder_interim_teams.v3",
    open_pool_enabled: false,
    simulation_result: null,
    live_build: null,
    respin_history: [],
    team_respins_used_total: 0,
    team_respins_remaining_total: 3,
    season_respins_used_total: 0,
    season_respins_remaining_total: 3,
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
    expect(open).not.toContain("PG");
    expect(open).toContain("bench_3");
  });

  it("allows bench slots to be open while starters are filled -- soft placement, no forced order", () => {
    const slots = mockSlots(0).map((s) => ({
      ...s,
      filled: STARTER_SLOT_TYPES.includes(s.slot_type),
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
        lineup_peak_score: 92.5,
        lineup_score_status: "complete",
      },
    });
    expect(hasResult(state)).toBe(true);
  });
});

describe("court slot labels (Phase 5X.4 rule 4)", () => {
  it("starters use real position labels PG/SG/SF/PF/C", () => {
    expect(STARTER_SLOT_TYPES).toEqual(["PG", "SG", "SF", "PF", "C"]);
  });

  it("bench slots are plain Bench 1/2/3, never role-flavored labels", () => {
    expect(BENCH_SLOT_TYPES).toEqual(["bench_1", "bench_2", "bench_3"]);
    expect(SLOT_LABELS.bench_1).toBe("Bench 1");
    expect(SLOT_LABELS.bench_2).toBe("Bench 2");
    expect(SLOT_LABELS.bench_3).toBe("Bench 3");
    const labels = Object.values(SLOT_LABELS);
    expect(labels).not.toContain("Wildcard");
    expect(labels).not.toContain("Defensive Specialist");
    expect(labels).not.toContain("6th Man");
  });

  it("era wheel covers all 5 supported decades", () => {
    expect(ERA_LABELS).toEqual(["1980s", "1990s", "2000s", "2010s", "2020s"]);
  });
});

/**
 * W5 (UX / organization / polish pass): respin idempotency keys.
 *
 * The server-side half is tested in apps/api/tests/test_perfect_season.py.
 * What has to be true on THIS side is subtler and is the whole reason the
 * double-click bug survives a naive fix: the key must be DERIVED from state
 * the component can already see, never generated fresh per invocation. A
 * `crypto.randomUUID()` per click would make every click a distinct request
 * and the second one would still burn a respin.
 */
describe("respinIdempotencyKey (W5)", () => {
  it("is stable for the same game, round, kind and respin count", () => {
    expect(respinIdempotencyKey("g1", 3, "team", 1)).toBe(
      respinIdempotencyKey("g1", 3, "team", 1),
    );
  });

  it("a double-click produces ONE key, because neither click has seen the response yet", () => {
    // Both handlers read the same React state: team_respins_used_total is
    // still 0 when the second click fires, so both derive the same key and
    // the server recognises the second as a replay.
    const stateAtClickTime = { gameId: "g1", round: 1, used: 0 };
    const first = respinIdempotencyKey(stateAtClickTime.gameId, stateAtClickTime.round, "team", stateAtClickTime.used);
    const second = respinIdempotencyKey(stateAtClickTime.gameId, stateAtClickTime.round, "team", stateAtClickTime.used);
    expect(second).toBe(first);
  });

  it("changes once the respin has actually been consumed, so the next one is not swallowed", () => {
    // Idempotency must not become a lock -- after the counter increments the
    // player can still spend their remaining respins.
    expect(respinIdempotencyKey("g1", 1, "team", 1)).not.toBe(
      respinIdempotencyKey("g1", 1, "team", 0),
    );
  });

  it("namespaces team and season so one axis cannot mask the other", () => {
    expect(respinIdempotencyKey("g1", 1, "team", 0)).not.toBe(
      respinIdempotencyKey("g1", 1, "season", 0),
    );
  });

  it("changes per round and per game", () => {
    expect(respinIdempotencyKey("g1", 2, "team", 0)).not.toBe(
      respinIdempotencyKey("g1", 1, "team", 0),
    );
    expect(respinIdempotencyKey("g2", 1, "team", 0)).not.toBe(
      respinIdempotencyKey("g1", 1, "team", 0),
    );
  });

  it("contains no randomness -- the same inputs always yield the same key", () => {
    const keys = new Set(
      Array.from({ length: 50 }, () => respinIdempotencyKey("g1", 4, "season", 2)),
    );
    expect(keys.size).toBe(1);
  });
});

/**
 * W5: the respin policy receipt is an OPTIONAL, debug-only part of the public
 * state. It must never be required for the UI to render, because a run created
 * before the policy shipped has none.
 */
describe("respin policy debug metadata (W5)", () => {
  it("is optional on the public state -- an older run without it still loads", () => {
    const legacy = mockState();
    expect(legacy.respin_policy_debug).toBeUndefined();
    expect(isRosterComplete(legacy)).toBe(false);
  });

  it("carries the exclusion radius and allowed pool size when present", () => {
    const state = mockState({
      respin_policy_version: "perfect_season_respin_policy_v1",
      respin_policy_debug: [
        {
          policy_version: "perfect_season_respin_policy_v1",
          kind: "season",
          relaxation_tier: "same_team_radius_2",
          exclusion_radius: 2,
          history_depth: 0,
          allowed_pool_size: 28,
        },
      ],
    });
    expect(state.respin_policy_debug?.[0].exclusion_radius).toBe(2);
    expect(state.respin_policy_debug?.[0].allowed_pool_size).toBeGreaterThanOrEqual(8);
  });
});
