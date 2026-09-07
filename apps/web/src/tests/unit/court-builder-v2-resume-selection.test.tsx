/**
 * 82-0 Pass 7 (human acceptance testing, task §5/§7): the V2 chooser had no
 * way back in once minimized ("View court"), and no visible state banner
 * once a player was staged for placement. Both are pure rendering gaps —
 * `CourtBuilder`'s own `overlayMinimized`/`pending_selection` state already
 * preserved the round/roll/respins/candidates untouched; V2 just never
 * rendered a way to see it. This suite proves the V2 render path
 * specifically (legacy already covered by `court-builder-hint.test.tsx` and
 * its own "resume-selection-banner" testid).
 */
import React, { act } from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { setUiVersion, __resetUiVersionStoreForTests } from "@/lib/ui-version";
import type { CourtLineupPublicState, SpinCandidate } from "@/types/perfect-season";

const selectPlayer = vi.fn();
const cancelSelection = vi.fn();
const respinTeam = vi.fn();
const respinSeason = vi.fn();

vi.mock("@/lib/perfect-season-api", () => ({
  cancelSelection: (...args: unknown[]) => cancelSelection(...args),
  completeCourtGame: vi.fn(),
  createCourtGame: vi.fn(),
  placeCard: vi.fn(),
  requestHint: vi.fn(),
  respinIdempotencyKey: vi.fn(() => "key"),
  respinSeason: (...args: unknown[]) => respinSeason(...args),
  respinTeam: (...args: unknown[]) => respinTeam(...args),
  selectPlayer: (...args: unknown[]) => selectPlayer(...args),
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

/** 82-0 pacing (final polish): the round card now holds the reels for
 * `COURT_PACING.ROUND_REVEAL_MS` (1.5 s) BEFORE the ceremony clock starts,
 * and the outcome absorbs for 450 ms before the list opens. Two acts, not
 * one: the card's hand-over is a React state update that `act` flushes at
 * its end, and only THEN does the reel's own clock get armed -- a single
 * 6 s advance would run out before those timers existed. Budgets for the
 * fake clock, not assertions. */
async function revealCeremony() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(COURT_PACING.ROUND_REVEAL_MS + 50);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4000);
  });
}

function renderV2Builder(state: CourtLineupPublicState) {
  return render(
    <CourtBuilder initialGameState={state} franchiseNames={["Test City Testers"]} seasonLabels={["2020-21"]} />,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  selectPlayer.mockReset();
  cancelSelection.mockReset();
  respinTeam.mockReset();
  respinSeason.mockReset();
  __resetUiVersionStoreForTests();
  setUiVersion("v2");
});

afterEach(() => {
  vi.useRealTimers();
  __resetUiVersionStoreForTests();
});

describe("82-0 V2 — chooser reopen (task §5)", () => {
  it("closing the chooser ('View court') leaves an obvious way back in, and reopening shows the same unresolved roll", async () => {
    renderV2Builder(baseState());
    await revealCeremony();
    // "the chooser is open and showing candidates" -- asserted on the panel
    // itself, not on a copy string. These waits used to key on the
    // "Step 1 · Choose a player · N eligible" label, which was never what
    // they were testing; it was just the most convenient text in the open
    // panel. Removing that redundant label therefore failed four tests that
    // have nothing to do with it.
    await waitFor(() => expect(screen.getByTestId("candidate-panel")).toBeInTheDocument());

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: /view court/i }));

    // Same round/roll never disappear from the page -- only the chooser's
    // OWN candidate list (inside the now-hidden panel) is gone from what a
    // query for visible text would find; the resume affordance must exist.
    const resumeBtn = await screen.findByRole("button", { name: /resume selection/i });
    expect(resumeBtn).toBeInTheDocument();

    // No API call happened just by closing -- no respin, no new selection.
    expect(respinTeam).not.toHaveBeenCalled();
    expect(respinSeason).not.toHaveBeenCalled();
    expect(selectPlayer).not.toHaveBeenCalled();

    await user.click(resumeBtn);

    // The SAME roll and candidate pool reappear -- never re-rolled.
    // chooser open, showing candidates (see the note in the first test)
    await waitFor(() => expect(screen.getByTestId("candidate-panel")).toBeInTheDocument());
    expect(screen.getByText("Player A")).toBeInTheDocument();
    expect(screen.getByText("Player B")).toBeInTheDocument();
    expect(screen.getByText(/Respin team \(3 left\)/)).toBeInTheDocument();
    expect(screen.getByText(/Respin season \(3 left\)/)).toBeInTheDocument();

    // Still no respin/selection API calls anywhere in this flow.
    expect(respinTeam).not.toHaveBeenCalled();
    expect(respinSeason).not.toHaveBeenCalled();
    expect(selectPlayer).not.toHaveBeenCalled();
  });

  it("does not show the resume affordance while the chooser is open", async () => {
    renderV2Builder(baseState());
    await revealCeremony();
    // chooser open, showing candidates (see the note in the first test)
    await waitFor(() => expect(screen.getByTestId("candidate-panel")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /resume selection/i })).not.toBeInTheDocument();
  });
});

describe("82-0 V2 — placement state banner (task §7)", () => {
  it("shows a single 'PLACE [PLAYER]' banner once a candidate is chosen, with a working Switch selection", async () => {
    selectPlayer.mockResolvedValue(
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
    cancelSelection.mockResolvedValue(baseState());

    renderV2Builder(baseState());
    await revealCeremony();
    // chooser open, showing candidates (see the note in the first test)
    await waitFor(() => expect(screen.getByTestId("candidate-panel")).toBeInTheDocument());

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const chooseButtons = screen.getAllByText(/^Choose$/i);
    await user.click(chooseButtons[0]);

    await waitFor(() => expect(selectPlayer).toHaveBeenCalledWith("game-1", expect.any(String)));
    // Human acceptance testing, task §8: the banner is now a single
    // structured "PLACE / player / team · season · position" instrumentation
    // (`PeakV2PlayerIdentity`) rather than one prose sentence with the name
    // embedded in it -- the player's name and the instruction text are
    // separate nodes. Scoped to the banner itself (`placing-banner`)
    // since "Player A" can also appear in the (still-mounted, now-hidden)
    // chooser's own candidate list.
    const banner = await screen.findByTestId("placing-banner");
    expect(within(banner).getByText("Place")).toBeInTheDocument();
    expect(within(banner).getByText("Player A")).toBeInTheDocument();
    // The banner used to end with "Any open spot — the fit badge shows how
    // well they match it." That sentence was removed in the product-UX
    // recovery pass: the court now states legality itself (open slots light
    // up, with a stronger treatment on a natural fit, a dashed one on a
    // stretch, and a dotted, dimmed one on a mismatch), so a line of grey
    // helper text was explaining a thing already on screen. What this test
    // is actually for — ONE banner, naming the player being placed, with a
    // working way out — is asserted above and below.
    expect(within(banner).getByText("PG")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /switch selection/i }));
    await waitFor(() => expect(cancelSelection).toHaveBeenCalledWith("game-1"));
  });
});
