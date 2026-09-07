/**
 * 82-0 — the interaction contract, as regressions (game-feel reconstruction).
 *
 * Reproduces what manual testing reported ("clunky clicking", "had to click
 * twice", "nothing tells me the click worked") and pins the fix at the
 * builder level, through the same mocked API client it actually calls:
 *
 *   - a candidate click is acknowledged on the row that was clicked, and
 *     sends exactly one select command however many times it is clicked;
 *   - an open slot stays a real, disabled BUTTON while a request is in
 *     flight (it used to become a dead div a click fell through), the slot
 *     being placed into shows pending, and one click sends one placement;
 *   - a successful placement updates the court from the response itself,
 *     immediately, and announces what it did in the same render;
 *   - Play Again starts one fresh game with clean round-1 state.
 */
import React, { act } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CourtLineupPublicState, CourtSlotPublic, SpinCandidate } from "@/types/perfect-season";

const selectPlayer = vi.fn();
const placeCard = vi.fn();
const createCourtGame = vi.fn();

vi.mock("@/lib/perfect-season-api", () => ({
  cancelSelection: vi.fn(),
  completeCourtGame: vi.fn(),
  createCourtGame: (...args: unknown[]) => createCourtGame(...args),
  placeCard: (...args: unknown[]) => placeCard(...args),
  requestHint: vi.fn(),
  respinIdempotencyKey: vi.fn(() => "key"),
  respinSeason: vi.fn(),
  respinTeam: vi.fn(),
  selectPlayer: (...args: unknown[]) => selectPlayer(...args),
  swapSlots: vi.fn(),
  undoIdempotencyKey: vi.fn(() => "undo-key"),
  undoLastPlacement: vi.fn(),
  getLeaderboard: vi.fn(async () => ({ leaderboard_enabled: false, entries: [] })),
  getMyRuns: vi.fn(async () => ({ runs: [] })),
  PerfectSeasonAPIError: class PerfectSeasonAPIError extends Error {
    status: number;
    code?: string;
    constructor(status: number, detail: string, code?: string) {
      super(detail);
      this.status = status;
      this.code = code;
    }
  },
}));

vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ user: null, loading: false }) }));

import CourtBuilder from "@/components/court/CourtBuilder";

function mockMatchMedia(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? reduced : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const CANDIDATES: SpinCandidate[] = [
  { player_slug: "player-a", player_name: "Player A", primary_position: "PG", secondary_positions: [] },
  { player_slug: "player-b", player_name: "Player B", primary_position: "SG", secondary_positions: [] },
];

const SLOT_TYPES = ["PG", "SG", "SF", "PF", "C", "bench_1", "bench_2", "bench_3"] as const;

function baseState(overrides: Partial<CourtLineupPublicState> = {}): CourtLineupPublicState {
  return {
    game_id: "game-1",
    status: "selection_pending",
    mode: "apex_1y",
    current_round: 1,
    total_rounds: 8,
    current_spin: {
      round_number: 1,
      spin_type: "team_year",
      franchise_display_name: "Test City Testers",
      era_label: "2020-21",
      candidates: CANDIDATES,
      team_id: "TST",
      team_respins_used: 0,
      team_respins_max: 3,
      season_respins_used: 0,
      season_respins_max: 3,
    },
    pending_selection: null,
    slots: SLOT_TYPES.map((slot_type) => ({ slot_type, filled: false })),
    board_seed: 1,
    card_pool_version: "v1",
    board_generator_version: "v1",
    interim_team_data_version: null,
    open_pool_enabled: false,
    simulation_result: null,
    live_build: null,
    respin_history: [],
    team_respins_used_total: 0,
    team_respins_remaining_total: 3,
    season_respins_used_total: 0,
    season_respins_remaining_total: 3,
    state_version: 1,
    undo: { available: false, kind: null, expires_at: null },
    difficulty: "easy",
    hint_used: false,
    ...overrides,
  };
}

function placingState(): CourtLineupPublicState {
  return baseState({
    status: "placement_pending",
    current_spin: null,
    pending_selection: {
      player_slug: "player-a",
      player_name: "Player A",
      primary_position: "PG",
      secondary_positions: [],
      team_name: "Test City Testers",
      season: "2020-21",
      fit_by_open_slot: {},
    } as unknown as CourtLineupPublicState["pending_selection"],
    state_version: 2,
  });
}

function placedState(): CourtLineupPublicState {
  const slots: CourtSlotPublic[] = SLOT_TYPES.map((slot_type) =>
    slot_type === "PG"
      ? ({ slot_type, filled: true, player_name: "Player A", team_name: "Test City Testers", season: "2020-21", role_fit: "primary" } as CourtSlotPublic)
      : { slot_type, filled: false },
  );
  return baseState({
    status: "selection_pending",
    current_round: 2,
    slots,
    state_version: 3,
    undo: { available: true, kind: "place", expires_at: new Date(Date.now() + 8000).toISOString() },
    current_spin: {
      round_number: 2,
      spin_type: "team_year",
      franchise_display_name: "Other Town Others",
      era_label: "2019-20",
      candidates: CANDIDATES,
      team_id: "OTH",
      team_respins_used: 0,
      team_respins_max: 3,
      season_respins_used: 0,
      season_respins_max: 3,
    },
  });
}

function renderBuilder(state: CourtLineupPublicState) {
  return render(
    <CourtBuilder initialGameState={state} franchiseNames={["Test City Testers", "Other Town Others"]} seasonLabels={["2020-21", "2019-20"]} />,
  );
}

beforeEach(() => {
  // Reduced motion: the spin ceremony resolves in ~80ms, so the candidate
  // list is reachable without a 3s wait. Every assertion below is about
  // state, not motion.
  mockMatchMedia(true);
  selectPlayer.mockReset();
  placeCard.mockReset();
  createCourtGame.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("82-0 candidate choice", () => {
  it("acknowledges the clicked row immediately and sends exactly ONE select for a double click", async () => {
    const user = userEvent.setup();
    const gate = deferred<CourtLineupPublicState>();
    selectPlayer.mockImplementation(() => gate.promise);
    renderBuilder(baseState());
    const row = await screen.findByRole("button", { name: /Player A/ }, { timeout: 3000 });

    await user.dblClick(row);
    expect(selectPlayer).toHaveBeenCalledTimes(1);
    expect(selectPlayer).toHaveBeenCalledWith("game-1", "player-a");
    // The row that was pressed says so; the others are merely disabled.
    expect(row).toHaveAttribute("data-state", "pending");
    expect(row).toHaveTextContent("Choosing…");
    expect(screen.getByRole("button", { name: /Player B/ })).toBeDisabled();

    await act(async () => {
      gate.resolve(placingState());
      await gate.promise;
    });
    // The response is the next frame: placement banner up, court live.
    await waitFor(() => expect(screen.getByTestId("placing-banner")).toHaveTextContent("Player A"));
  });
});

describe("82-0 placement", () => {
  it("keeps every open slot a real button while a placement is in flight, marks the chosen one pending, and sends ONE placement", async () => {
    const user = userEvent.setup();
    const gate = deferred<CourtLineupPublicState>();
    placeCard.mockImplementation(() => gate.promise);
    renderBuilder(placingState());

    const pg = screen.getByRole("button", { name: /Point Guard|PG/i, hidden: false });
    const openSlots = () => screen.getAllByTestId("court-slot").filter((el) => el.getAttribute("data-filled") === "false");
    // Every open slot is a button before the click...
    openSlots().forEach((slot) => expect(slot.tagName).toBe("BUTTON"));

    await user.dblClick(pg);
    expect(placeCard).toHaveBeenCalledTimes(1);
    expect(placeCard).toHaveBeenCalledWith("game-1", "PG");
    // ...and STILL a button during the round trip: the pressed one pending,
    // the rest disabled -- never a dead element a click falls through.
    openSlots().forEach((slot) => expect(slot.tagName).toBe("BUTTON"));
    const pending = openSlots().find((slot) => slot.getAttribute("data-slot-type") === "PG")!;
    expect(pending).toHaveAttribute("data-state", "pending");
    expect(pending).toHaveTextContent("Placing…");
    const other = openSlots().find((slot) => slot.getAttribute("data-slot-type") === "SG")!;
    expect(other).toBeDisabled();
    // A third click on another slot while pending sends nothing.
    await user.click(other);
    expect(placeCard).toHaveBeenCalledTimes(1);

    await act(async () => {
      gate.resolve(placedState());
      await gate.promise;
    });
    // The response IS the update: the slot is filled and the moment names
    // the pick, in the same render, with no refetch.
    await waitFor(() => {
      const filled = screen.getAllByTestId("court-slot").find((el) => el.getAttribute("data-slot-type") === "PG")!;
      expect(filled).toHaveAttribute("data-filled", "true");
      expect(filled).toHaveTextContent("Player A");
    });
    expect(screen.getByTestId("court-moment")).toHaveTextContent("Player A → Point Guard");
    // And the next round's chooser is up.
    await waitFor(() => expect(screen.getByTestId("selection-overlay")).toBeVisible());
  });
});

describe("82-0 Play Again", () => {
  it("starts ONE fresh game from the result and lands on a clean round 1", async () => {
    const user = userEvent.setup();
    const finished = baseState({
      status: "result_ready",
      current_round: 8,
      current_spin: null,
      slots: SLOT_TYPES.map((slot_type) => ({ slot_type, filled: true, player_name: `P ${slot_type}`, team_name: "T", season: "2020-21", season_score: 70, exact_player_season_key: `${slot_type}-k` } as CourtSlotPublic)),
      simulation_result: {
        wins: 61,
        losses: 21,
        lineup_peak_score: 80,
        lineup_score_status: "complete",
        is_perfect_season: false,
        tier: "contender",
        best_pick: "P PG",
        structural_weakness: null,
        decisive_factors: [],
        fit_components: { talent_core: 80, bench_strength: 50, positional_fit: 70, creation_coverage: 60, scoring_coverage: 60, postseason_pedigree: 50, team_context_depth: 40 },
      } as unknown as CourtLineupPublicState["simulation_result"],
    });
    const gate = deferred<CourtLineupPublicState>();
    createCourtGame.mockImplementation(() => gate.promise);
    renderBuilder(finished);

    const again = await screen.findByTestId("play-again-btn");
    await user.dblClick(again);
    expect(createCourtGame).toHaveBeenCalledTimes(1);
    expect(again).toHaveAttribute("data-state", "pending");

    await act(async () => {
      gate.resolve(baseState({ game_id: "game-2" }));
      await gate.promise;
    });
    await waitFor(() => expect(screen.queryByTestId("season-result")).toBeNull());
    await waitFor(() => expect(screen.getByTestId("selection-overlay")).toBeVisible());
    expect(screen.getByTestId("court-builder")).toBeInTheDocument();
    expect(screen.getAllByTestId("court-slot").every((el) => el.getAttribute("data-filled") === "false")).toBe(true);
  });
});
