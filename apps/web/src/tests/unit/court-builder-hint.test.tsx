/**
 * Gameplay-polish: "Give me a suggestion" -- CourtBuilder's Easy-mode hint
 * button.
 *
 * THE VISIBILITY CONTRACT UNDER TEST (from the product spec): the button
 * exists only when difficulty === "easy", the hint has not been used yet,
 * and a candidate offer is actually open (the spin ceremony has revealed a
 * roll and the player has not yet selected someone). Once used, the server
 * marks `hint_used` on the persisted game state, so the button must show
 * "Hint used" (disabled, not hidden) rather than disappear -- and because
 * that flag lives on the server-returned state, it survives a reload for
 * free once the component re-renders from a freshly-fetched state, which
 * the last test below exercises directly (mount already-hint_used state).
 */
import React, { act } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CourtLineupPublicState, SpinCandidate } from "@/types/perfect-season";

const requestHint = vi.fn();

vi.mock("@/lib/perfect-season-api", () => ({
  cancelSelection: vi.fn(),
  completeCourtGame: vi.fn(),
  createCourtGame: vi.fn(),
  placeCard: vi.fn(),
  requestHint: (...args: unknown[]) => requestHint(...args),
  respinIdempotencyKey: vi.fn(() => "key"),
  respinSeason: vi.fn(),
  respinTeam: vi.fn(),
  selectPlayer: vi.fn(),
  swapSlots: vi.fn(),
  undoIdempotencyKey: vi.fn(() => "undo-key"),
  undoLastPlacement: vi.fn(),
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

import CourtBuilder from "@/components/court/CourtBuilder";

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

/** SpinStage's real (non-reduced-motion) reveal ceremony runs on real
 * timers -- SPIN_MS + LOCK_MS + COUNT_MS (~2.77s). Fake timers let this test
 * cross that boundary instantly instead of actually waiting. */
async function revealCeremony() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
}

function renderBuilder(state: CourtLineupPublicState) {
  return render(
    <CourtBuilder initialGameState={state} franchiseNames={["Test City Testers"]} seasonLabels={["2020-21"]} />,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  requestHint.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CourtBuilder hint button visibility", () => {
  it("shows 'Give me a suggestion' once the round's offer is revealed in Easy mode", async () => {
    renderBuilder(baseState());
    await revealCeremony();
    await waitFor(() => expect(screen.getByTestId("hint-btn")).toBeInTheDocument());
    expect(screen.getByTestId("hint-btn")).toHaveTextContent("Give me a suggestion");
    expect(screen.getByTestId("hint-btn")).not.toBeDisabled();
  });

  it("does not render the hint button at all in Hard mode", async () => {
    renderBuilder(baseState({ difficulty: "hard" }));
    await revealCeremony();
    await waitFor(() => expect(screen.getByTestId("candidate-panel")).toBeInTheDocument());
    expect(screen.queryByTestId("hint-btn")).not.toBeInTheDocument();
  });

  it("renders 'Hint used', disabled, when the persisted state already has hint_used", async () => {
    renderBuilder(baseState({ hint_used: true }));
    await revealCeremony();
    await waitFor(() => expect(screen.getByTestId("hint-btn")).toBeInTheDocument());
    expect(screen.getByTestId("hint-btn")).toHaveTextContent("Hint used");
    expect(screen.getByTestId("hint-btn")).toBeDisabled();
  });

  it("calls the hint endpoint, highlights the recommended candidate, and then disables itself for the rest of the run", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    requestHint.mockResolvedValue({
      state: { ...baseState(), hint_used: true },
      hint: { player_slug: "player-b", player_name: "Player B" },
    });
    renderBuilder(baseState());
    await revealCeremony();
    await waitFor(() => expect(screen.getByTestId("hint-btn")).toBeInTheDocument());

    await user.click(screen.getByTestId("hint-btn"));

    await waitFor(() => expect(requestHint).toHaveBeenCalledWith("game-1"));
    await waitFor(() => expect(screen.getByTestId("hint-message")).toHaveTextContent("PEAK3 suggests: Player B"));

    // The recommended row is visibly marked, but never with a score --
    // ADR-005 Decision 6 has no number to leak in the first place (the
    // candidate/hint types carry none), so this only checks the identity
    // marker actually landed on the right row.
    const highlightedCard = screen.getByTestId("candidate-hint-badge").closest("button");
    expect(highlightedCard).toHaveAttribute("data-player-slug", "player-b");

    await waitFor(() => expect(screen.getByTestId("hint-btn")).toHaveTextContent("Hint used"));
    expect(screen.getByTestId("hint-btn")).toBeDisabled();
  });

  it("hides the hint button entirely once a candidate has been selected (no offer is open)", async () => {
    renderBuilder(
      baseState({
        status: "placement_pending",
        current_spin: null,
        pending_selection: {
          exact_player_season_key: "player-a-tst-202021",
          player_name: "Player A",
          primary_position: "PG",
          secondary_positions: [],
          fit_by_open_slot: {},
        },
      }),
    );
    expect(screen.queryByTestId("hint-btn")).not.toBeInTheDocument();
  });
});
