/**
 * 82-0 final pre-deploy polish — the pacing and opening contracts, pinned.
 *
 *   - the pacing constants sit in the bands they were tuned into;
 *   - a FRESHLY CREATED run opens with the intro; a resumed run does not;
 *     Play Again opens the intro for the new run;
 *   - the round card shows ONCE per authoritative round, BEFORE the reels
 *     (`SpinStage` is held until it leaves), and is never re-triggered by
 *     leaving and resuming the selection panel;
 *   - the visible "Data receipt" tag is gone from the live board.
 *
 * Non-reduced motion with fake timers, so the card and the hold are real.
 */
import React, { act } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { CourtLineupPublicState, SpinCandidate } from "@/types/perfect-season";

const createCourtGame = vi.fn();
const placeCard = vi.fn();

vi.mock("@/lib/perfect-season-api", () => ({
  cancelSelection: vi.fn(),
  completeCourtGame: vi.fn(),
  createCourtGame: (...args: unknown[]) => createCourtGame(...args),
  placeCard: (...args: unknown[]) => placeCard(...args),
  requestHint: vi.fn(),
  respinIdempotencyKey: vi.fn(() => "key"),
  respinSeason: vi.fn(),
  respinTeam: vi.fn(),
  selectPlayer: vi.fn(),
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
import { COURT_PACING } from "@/lib/court-state";

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
    board_seed: 4471,
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

function renderBuilder(state: CourtLineupPublicState, openingIntro = false) {
  return render(
    <CourtBuilder
      initialGameState={state}
      franchiseNames={["Test City Testers"]}
      seasonLabels={["2020-21"]}
      openingIntro={openingIntro}
    />,
  );
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const stage = () => screen.getByTestId("spin-stage");

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  createCourtGame.mockReset();
  placeCard.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("82-0 pacing constants", () => {
  it("keeps the round card in its 1.4-1.8 s band and the intro under 4 s", () => {
    expect(COURT_PACING.ROUND_REVEAL_MS).toBeGreaterThanOrEqual(1400);
    expect(COURT_PACING.ROUND_REVEAL_MS).toBeLessThanOrEqual(1800);
    expect(COURT_PACING.ROUND_REVEAL_EXIT_MS).toBeLessThanOrEqual(300);
    expect(COURT_PACING.INTRO_MS).toBeGreaterThanOrEqual(3000);
    expect(COURT_PACING.INTRO_MS).toBeLessThanOrEqual(4000);
    expect(COURT_PACING.INTRO_EXIT_MS).toBeLessThan(COURT_PACING.INTRO_MS);
    expect(COURT_PACING.INTRO_REDUCED_MS).toBeLessThan(1000);
  });
});

describe("82-0 opening intro", () => {
  it("plays once for a freshly created run, then hands over to the round card", async () => {
    renderBuilder(baseState(), true);
    expect(screen.getByTestId("court-intro")).toBeInTheDocument();
    expect(screen.getByTestId("court-intro-title")).toHaveTextContent("82-0 Peak Season");
    // Nothing playable exists behind it yet: no chooser, no reels.
    expect(screen.queryByTestId("selection-overlay")).toBeNull();
    expect(screen.queryByTestId("court-round-reveal")).toBeNull();

    await advance(COURT_PACING.INTRO_MS - COURT_PACING.INTRO_EXIT_MS + 10);
    expect(screen.getByTestId("court-intro")).toHaveAttribute("data-leaving", "true");
    await advance(COURT_PACING.INTRO_EXIT_MS + 10);
    expect(screen.queryByTestId("court-intro")).toBeNull();
    // The first thing after the intro is the round card, over held reels.
    expect(screen.getByTestId("court-round-reveal")).toHaveTextContent("Round 1");
    expect(stage()).toHaveAttribute("data-held", "true");
  });

  it("does NOT play for a resumed run, which lands straight on its round", () => {
    renderBuilder(baseState({ current_round: 3, state_version: 9 }));
    expect(screen.queryByTestId("court-intro")).toBeNull();
    expect(screen.getByTestId("court-round-reveal")).toHaveTextContent("Round 3");
  });

  it("does NOT play for a run resumed mid-placement, and no round card either", () => {
    renderBuilder(
      baseState({
        status: "placement_pending",
        current_spin: null,
        current_round: 2,
        pending_selection: {
          player_slug: "player-a",
          player_name: "Player A",
          primary_position: "PG",
          secondary_positions: [],
          fit_by_open_slot: {},
        } as unknown as CourtLineupPublicState["pending_selection"],
      }),
    );
    expect(screen.queryByTestId("court-intro")).toBeNull();
    expect(screen.queryByTestId("court-round-reveal")).toBeNull();
    expect(screen.getByTestId("placing-banner")).toHaveTextContent("Player A");
  });

  it("plays again for the NEW run Play Again creates", async () => {
    const finished = baseState({
      status: "result_ready",
      current_round: 8,
      current_spin: null,
      slots: SLOT_TYPES.map((slot_type) => ({ slot_type, filled: true, player_name: `P ${slot_type}`, team_name: "T", season: "2020-21", season_score: 70, exact_player_season_key: `${slot_type}-k` }) as CourtLineupPublicState["slots"][number]),
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
        experimental_notice: "Experimental.",
        fit_components: { talent_core: 80, bench_strength: 50, positional_fit: 70, creation_coverage: 60, scoring_coverage: 60, postseason_pedigree: 50, team_context_depth: 40 },
      } as unknown as CourtLineupPublicState["simulation_result"],
    });
    createCourtGame.mockResolvedValue(baseState({ game_id: "game-2" }));
    renderBuilder(finished);
    expect(screen.queryByTestId("court-intro")).toBeNull();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(await screen.findByTestId("play-again-btn"));
    await waitFor(() => expect(screen.getByTestId("court-intro")).toBeInTheDocument());
    expect(screen.queryByTestId("season-result")).toBeNull();
  });
});

describe("82-0 round card — once per round, before the reels", () => {
  it("holds the reels while the card is up, releases them when it leaves, and never replays on Resume selection", async () => {
    renderBuilder(baseState());
    // Up from the first frame of the round, over reels that are NOT running.
    expect(screen.getByTestId("court-round-reveal")).toHaveTextContent("Round 1");
    expect(stage()).toHaveAttribute("data-held", "true");
    expect(stage()).toHaveAttribute("data-phase", "spinning");

    await advance(COURT_PACING.ROUND_REVEAL_MS - 100);
    expect(screen.getByTestId("court-round-reveal")).toBeInTheDocument();
    expect(stage()).toHaveAttribute("data-held", "true");

    // The hand-over: the card leaves (still mounted for its exit) as the
    // reels start, on the same frame.
    await advance(150);
    expect(screen.getByTestId("court-round-reveal-wrap")).toHaveAttribute("data-leaving", "true");
    expect(stage()).toHaveAttribute("data-held", "false");
    await advance(COURT_PACING.ROUND_REVEAL_EXIT_MS + 20);
    expect(screen.queryByTestId("court-round-reveal")).toBeNull();

    // The ceremony resolves and the list opens.
    await advance(4000);
    await waitFor(() => expect(screen.getByTestId("candidate-panel")).toBeInTheDocument());
    expect(stage()).toHaveAttribute("data-phase", "revealed");

    // LEAVE the selection state and RESUME it: the card does not come back,
    // the reels do not re-run, and the roll is the same one.
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByTestId("minimize-overlay-btn"));
    await user.click(await screen.findByTestId("resume-selection-btn"));
    await advance(50);
    expect(screen.queryByTestId("court-round-reveal")).toBeNull();
    expect(stage()).toHaveAttribute("data-phase", "revealed");
    expect(stage()).toHaveAttribute("data-held", "false");
    expect(screen.getByTestId("candidate-panel")).toBeInTheDocument();
    // And again, to be sure it is the round, not the first reopen, that gates it.
    await user.click(screen.getByTestId("minimize-overlay-btn"));
    await user.click(await screen.findByTestId("resume-selection-btn"));
    await advance(50);
    expect(screen.queryByTestId("court-round-reveal")).toBeNull();
  });

  it("shows the NEXT round's card once when the server advances the round", async () => {
    placeCard.mockResolvedValue(
      baseState({
        current_round: 2,
        state_version: 3,
        slots: SLOT_TYPES.map((slot_type) =>
          slot_type === "PG"
            ? ({ slot_type, filled: true, player_name: "Player A", team_name: "Test City Testers", season: "2020-21", role_fit: "primary" } as CourtLineupPublicState["slots"][number])
            : { slot_type, filled: false },
        ),
        current_spin: {
          round_number: 2,
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
      }),
    );
    renderBuilder(
      baseState({
        status: "placement_pending",
        current_spin: null,
        pending_selection: {
          player_slug: "player-a",
          player_name: "Player A",
          primary_position: "PG",
          secondary_positions: [],
          fit_by_open_slot: {},
        } as unknown as CourtLineupPublicState["pending_selection"],
      }),
    );
    expect(screen.queryByTestId("court-round-reveal")).toBeNull();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const pg = screen.getAllByTestId("court-slot").find((el) => el.getAttribute("data-slot-type") === "PG")!;
    await user.click(pg);
    await waitFor(() => expect(screen.getByTestId("court-round-reveal")).toHaveTextContent("Round 2"));
    expect(stage()).toHaveAttribute("data-held", "true");
    // Two acts: the hand-over is a state update flushed at the end of the
    // first, and only then is the card's exit timer armed.
    await advance(COURT_PACING.ROUND_REVEAL_MS + 50);
    expect(stage()).toHaveAttribute("data-held", "false");
    await advance(COURT_PACING.ROUND_REVEAL_EXIT_MS + 50);
    expect(screen.queryByTestId("court-round-reveal")).toBeNull();
  });
});

describe("82-0 provenance", () => {
  it("shows the board's seed with no 'Data receipt' tag, and keeps the details behind it", () => {
    renderBuilder(baseState());
    expect(screen.queryByText(/data receipt/i)).toBeNull();
    const receipt = screen.getByTestId("board-receipt");
    expect(receipt.querySelector("summary")).toHaveTextContent("Seed 4471");
    expect(receipt).toHaveTextContent("v1");
  });
});
