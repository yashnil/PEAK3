/**
 * THREE-MAN WEAVE — the interaction contract, as regressions.
 *
 * Every test here reproduces a defect found in manual testing and pins its
 * fix at the room level (`ThreeManWeaveGame`), through the same mocked API
 * client the room actually calls:
 *
 *   - "Draft X at Y" needed several clicks: the press was silently dropped
 *     while a background stage request was in flight;
 *   - a swap's message appeared over a roster still showing the old state;
 *   - an older poll response overwrote a newer command response;
 *   - Play Again dumped the player on the mode's landing page;
 *   - the room went visually dead while another seat was on the clock;
 *   - a reconnect mid-ceremony replayed it from the start.
 */
import React, { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ThreeManWeaveGame from "@/components/three-man-weave/ThreeManWeaveGame";
import ThreeManWeaveLoader from "@/components/three-man-weave/ThreeManWeaveLoader";
import type {
  ArenaSeatPublic,
  TmwMatchView,
  TmwPick,
  TmwPublicState,
  TmwRoll,
  TmwRoster,
} from "@/types/three-man-weave";
import { TMW_REVEAL_SECONDS, TMW_TURN_PHASE_PICK, TMW_TURN_PHASE_REVEAL } from "@/types/three-man-weave";

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

const routerPush = vi.fn();
const routerReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace, prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const getMatch = vi.fn();
const getMatchResults = vi.fn();
const submitCommand = vi.fn();
const createPracticeMatch = vi.fn();
const getArenaReadiness = vi.fn();

vi.mock("@/lib/arena-api", () => ({
  ArenaAPIError: class ArenaAPIError extends Error {
    constructor(
      public status: number,
      public detail: string,
      public code?: string,
    ) {
      super(detail);
    }
  },
  commandIdempotencyKey: (...parts: unknown[]) => parts.join(":"),
  getMatch: (...args: unknown[]) => getMatch(...args),
  getMatchResults: (...args: unknown[]) => getMatchResults(...args),
  submitCommand: (...args: unknown[]) => submitCommand(...args),
  createPracticeMatch: (...args: unknown[]) => createPracticeMatch(...args),
  getArenaReadiness: (...args: unknown[]) => getArenaReadiness(...args),
}));

vi.mock("@/lib/arena-modes", () => ({ modeMeta: () => null }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SEATS: ArenaSeatPublic[] = [
  { seat_index: 0, display_name: "You", is_bot: false, status: "active", bot_rating: null },
  { seat_index: 1, display_name: "Rim Runner", is_bot: true, status: "active", bot_rating: 50 },
  { seat_index: 2, display_name: "The Enforcer", is_bot: true, status: "active", bot_rating: 50 },
];

function pick(slug: string, name: string, slot: TmwPick["slot_type"], seat = 0, round = 1): TmwPick {
  return {
    player_slug: slug,
    player_name: name,
    positions: [slot === "bench_1" ? "PG" : slot],
    eligibility: {
      franchise_id: "UTA",
      franchise_display_name: "Utah Jazz",
      decade: "1990s",
      seasons: [{ season: "1996-97", team_code: "UTA", games_played: 82, via: "direct_team_season" }],
    },
    scoring_card: {
      season: "1996-97",
      team_id: "UTA",
      team_name: "Utah Jazz",
      prime_score: 80,
      score_source: "exact_team_stint",
      is_multi_team_season: false,
      formula_version: "peak3_v1",
    },
    seat_index: seat,
    round_number: round,
    slot_type: slot,
    franchise_id: "UTA",
    decade: "1990s",
  };
}

function roster(seatIndex: number, slots: Record<string, TmwPick | null> = {}): TmwRoster {
  return {
    seat_index: seatIndex,
    slots: { PG: null, SG: null, SF: null, PF: null, C: null, bench_1: null, ...slots },
    complete: false,
  };
}

const ROLL: TmwRoll = {
  round_number: 1,
  roll_id: "roll-1",
  franchise_id: "UTA",
  franchise_display_name: "Utah Jazz",
  decade: "1990s",
  eligible_slugs: ["john-stockton", "karl-malone"],
  candidates: [
    {
      player_slug: "john-stockton",
      player_name: "John Stockton",
      positions: ["PG"],
      eligibility: {
        franchise_id: "UTA",
        franchise_display_name: "Utah Jazz",
        decade: "1990s",
        seasons: [{ season: "1996-97", team_code: "UTA", games_played: 82, via: "direct_team_season" }],
      },
    },
    {
      player_slug: "karl-malone",
      player_name: "Karl Malone",
      positions: ["PF"],
      eligibility: {
        franchise_id: "UTA",
        franchise_display_name: "Utah Jazz",
        decade: "1990s",
        seasons: [{ season: "1996-97", team_code: "UTA", games_played: 82, via: "direct_team_season" }],
      },
    },
  ],
};

function publicState(overrides: Partial<TmwPublicState> = {}): TmwPublicState {
  return {
    mode_version: "tmw_ruleset_v2",
    formula_version: "peak3_v1",
    slot_types: ["PG", "SG", "SF", "PF", "C", "bench_1"],
    total_rounds: 6,
    current_round: 1,
    current_seat: 0,
    is_complete: false,
    rosters: [roster(0), roster(1), roster(2)],
    drafted_identities: [],
    used_roll_ids: ["roll-1"],
    current_roll: ROLL,
    ...overrides,
  };
}

function view(overrides: Partial<TmwMatchView> = {}): TmwMatchView {
  return {
    match_id: "m-1",
    mode: "three_man_weave",
    mode_version: "tmw_ruleset_v2",
    model_version: "peak3_v1",
    status: "active",
    state_version: 4,
    seat_count: 3,
    entry_path: "practice",
    rated: false,
    your_seat_index: 0,
    seats: SEATS,
    public_state: publicState(),
    private_state: {
      seat_index: 0,
      candidate_fits: {
        "john-stockton": { player_slug: "john-stockton", state: "fits_now", direct_slots: ["PG"], plan: null, moves: [], reason: null },
        "karl-malone": { player_slug: "karl-malone", state: "fits_now", direct_slots: ["PF"], plan: null, moves: [], reason: null },
      },
      legal_picks: { "john-stockton": ["PG"], "karl-malone": ["PF"] },
    },
    legal_commands: ["tmw_pick", "tmw_rearrange", "tmw_stage_pick"],
    current_turn_seat_index: 0,
    seconds_remaining: 45,
    turn_seconds_remaining: 45,
    turn_elapsed_seconds: 0,
    turn_total_seconds: 45,
    turn_seq: 3,
    turn_phase: TMW_TURN_PHASE_PICK,
    latest_event_seq: 3,
    room_code: null,
    ...overrides,
  };
}

function accepted(match: TmwMatchView) {
  return { accepted: true, replayed: false, rejection_code: null, message: null, match };
}

beforeEach(() => {
  mockMatchMedia(false);
  getMatch.mockReset();
  getMatchResults.mockReset();
  submitCommand.mockReset();
  createPracticeMatch.mockReset();
  routerPush.mockReset();
  routerReplace.mockReset();
  getMatchResults.mockResolvedValue({ results: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Single-click draft
// ---------------------------------------------------------------------------

describe("single-click drafting", () => {
  it("one click on Draft, pressed while the stage request is still in flight, sends exactly ONE pick and lands it", async () => {
    const user = userEvent.setup();
    getMatch.mockImplementation(async () => view());
    const stage = deferred<ReturnType<typeof accepted>>();
    const stagedView = view({ state_version: 5, private_state: { ...view().private_state, staged_pick: { player_slug: "john-stockton", slot_type: "PG" } } });
    const afterPick = view({
      state_version: 6,
      current_turn_seat_index: 1,
      seconds_remaining: null,
      legal_commands: [],
      public_state: publicState({
        current_seat: 1,
        rosters: [roster(0, { PG: pick("john-stockton", "John Stockton", "PG") }), roster(1), roster(2)],
        drafted_identities: ["john-stockton"],
      }),
    });
    submitCommand.mockImplementation(async (_id: string, type: string, _payload: unknown, version: number) => {
      if (type === "tmw_stage_pick") return stage.promise;
      if (type === "tmw_pick") {
        // THE PICK CARRIES THE VERSION THE STAGE RESPONSE PRODUCED, not the
        // one the button was rendered against.
        expect(version).toBe(5);
        return accepted(afterPick);
      }
      throw new Error(`unexpected ${type}`);
    });

    render(<ThreeManWeaveGame initialMatch={view()} />);
    await user.click(screen.getByTestId("tmw-candidate-john-stockton"));
    await waitFor(() => expect(submitCommand).toHaveBeenCalledTimes(1));
    expect(submitCommand.mock.calls[0][1]).toBe("tmw_stage_pick");

    // The stage is STILL IN FLIGHT. This is the click that used to do nothing.
    const confirm = screen.getByTestId("tmw-confirm-pick");
    expect(confirm).toHaveTextContent("Draft John Stockton at Point guard");
    await user.click(confirm);
    // Acknowledged immediately: pending, disabled, and a second click is inert.
    expect(confirm).toHaveAttribute("data-state", "pending");
    expect(confirm).toHaveTextContent("Drafting…");
    await user.click(confirm);

    await act(async () => {
      stage.resolve(accepted(stagedView));
      await stage.promise;
    });
    await waitFor(() => expect(submitCommand).toHaveBeenCalledTimes(2));
    expect(submitCommand.mock.calls[1][1]).toBe("tmw_pick");
    expect(submitCommand.mock.calls[1][2]).toEqual({ player_slug: "john-stockton", slot_type: "PG" });

    // The response is the whole next frame: overlay closed, roster changed,
    // next seat on the clock, the moment announced -- with NO poll involved.
    await waitFor(() => expect(screen.queryByTestId("tmw-pick-overlay")).toBeNull());
    expect(within(screen.getAllByTestId("tmw-seat-court-0")[0]).getByText("John Stockton")).toBeInTheDocument();
    expect(screen.getByTestId("tmw-on-the-clock")).toHaveTextContent("Rim Runner");
    expect(screen.getByTestId("tmw-moment")).toHaveTextContent("John Stockton → PG");
    expect(getMatch).not.toHaveBeenCalled();
    expect(submitCommand).toHaveBeenCalledTimes(2);
  });

  it("does not stage the same intent twice, and a rapid re-selection keeps only the latest", async () => {
    const user = userEvent.setup();
    getMatch.mockImplementation(async () => view());
    const gate = deferred<ReturnType<typeof accepted>>();
    submitCommand.mockImplementation(async (_id: string, type: string, payload: { player_slug?: string }) => {
      if (type === "tmw_stage_pick" && payload.player_slug === "john-stockton") return gate.promise;
      return accepted(view({ state_version: 6, private_state: { ...view().private_state, staged_pick: { player_slug: payload.player_slug ?? "", slot_type: payload.player_slug === "john-stockton" ? "PG" : "PF" } } }));
    });
    render(<ThreeManWeaveGame initialMatch={view()} />);
    await user.click(screen.getByTestId("tmw-candidate-john-stockton"));
    await user.click(screen.getByTestId("tmw-candidate-john-stockton"));
    await user.click(screen.getByTestId("tmw-candidate-karl-malone"));
    await user.click(screen.getByTestId("tmw-candidate-john-stockton"));
    await act(async () => {
      gate.resolve(accepted(view({ state_version: 5, private_state: { ...view().private_state, staged_pick: { player_slug: "john-stockton", slot_type: "PG" } } })));
      await gate.promise;
    });
    // Four clicks, ONE request. The first intent executed; the flip to
    // Malone was superseded by the flip back before it ever started; and the
    // trailing Stockton intent was dropped at execution time because the
    // server's own response already held exactly that staged pick.
    await act(async () => {
      await Promise.resolve();
    });
    const staged = submitCommand.mock.calls.map((c) => (c[2] as { player_slug?: string }).player_slug);
    expect(staged).toEqual(["john-stockton"]);
  });
});

// ---------------------------------------------------------------------------
// Stale fetch race
// ---------------------------------------------------------------------------

describe("stale fetch race", () => {
  it("an older poll response landing after a newer command response cannot roll the board back", { timeout: 8000 }, async () => {
    const user = userEvent.setup();
    const oldPoll = deferred<TmwMatchView>();
    getMatch.mockImplementation(() => oldPoll.promise);
    const afterPick = view({
      state_version: 6,
      current_turn_seat_index: 1,
      seconds_remaining: null,
      legal_commands: [],
      public_state: publicState({
        current_seat: 1,
        rosters: [roster(0, { PG: pick("john-stockton", "John Stockton", "PG") }), roster(1), roster(2)],
      }),
    });
    submitCommand.mockImplementation(async (_id: string, type: string) =>
      type === "tmw_stage_pick" ? accepted(view({ state_version: 5 })) : accepted(afterPick),
    );

    render(<ThreeManWeaveGame initialMatch={view()} />);
    // Let the room issue one real poll (2s on its own turn), which then hangs
    // until we release it.
    await waitFor(() => expect(getMatch).toHaveBeenCalledTimes(1), { timeout: 3000 });

    await user.click(screen.getByTestId("tmw-candidate-john-stockton"));
    await user.click(screen.getByTestId("tmw-confirm-pick"));
    await waitFor(() => expect(screen.queryByTestId("tmw-pick-overlay")).toBeNull());
    expect(screen.getByTestId("tmw-on-the-clock")).toHaveTextContent("Rim Runner");

    // NOW the old poll lands, carrying version 4: it must be dropped.
    await act(async () => {
      oldPoll.resolve(view());
      await oldPoll.promise;
    });
    expect(screen.queryByTestId("tmw-pick-overlay")).toBeNull();
    expect(screen.getByTestId("tmw-on-the-clock")).toHaveTextContent("Rim Runner");
    expect(within(screen.getAllByTestId("tmw-seat-court-0")[0]).getByText("John Stockton")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Swap
// ---------------------------------------------------------------------------

describe("swaps", () => {
  it("the swap message and both changed slots come from the SAME server response", async () => {
    const user = userEvent.setup();
    const before = view({
      current_turn_seat_index: 1,
      seconds_remaining: null,
      legal_commands: ["tmw_rearrange"],
      public_state: publicState({
        current_seat: 1,
        rosters: [
          roster(0, { PG: pick("john-stockton", "John Stockton", "PG"), SG: pick("trae-young", "Trae Young", "SG", 0, 2) }),
          roster(1),
          roster(2),
        ],
      }),
    });
    const after = view({
      state_version: 5,
      current_turn_seat_index: 1,
      seconds_remaining: null,
      legal_commands: ["tmw_rearrange"],
      public_state: publicState({
        current_seat: 1,
        rosters: [
          roster(0, { PG: { ...pick("trae-young", "Trae Young", "PG", 0, 2), positions: ["PG", "SG"] }, SG: { ...pick("john-stockton", "John Stockton", "SG"), positions: ["PG", "SG"] } }),
          roster(1),
          roster(2),
        ],
      }),
    });
    // Both players can play both guard spots so the move is legal locally.
    before.public_state.rosters[0].slots.PG!.positions = ["PG", "SG"];
    before.public_state.rosters[0].slots.SG!.positions = ["PG", "SG"];
    getMatch.mockImplementation(async () => before);
    const gate = deferred<ReturnType<typeof accepted>>();
    submitCommand.mockImplementation(() => gate.promise);

    render(<ThreeManWeaveGame initialMatch={before} />);
    const court = screen.getAllByTestId("tmw-seat-court-0")[0];
    await user.click(within(court).getByRole("button", { name: /Rearrange John Stockton/ }));
    await user.click(within(court).getByRole("button", { name: /Move here: Shooting guard/ }));
    expect(submitCommand).toHaveBeenCalledTimes(1);
    expect(submitCommand.mock.calls[0][1]).toBe("tmw_rearrange");
    // NOTHING is announced before the server answers.
    expect(screen.queryByTestId("tmw-moment")).toBeNull();

    await act(async () => {
      gate.resolve(accepted(after));
      await gate.promise;
    });
    await waitFor(() => expect(screen.getByTestId("tmw-moment")).toHaveTextContent("Trae Young ↔ John Stockton"));
    // The same render shows the new positions.
    const slots = within(screen.getAllByTestId("tmw-seat-court-0")[0]).getAllByTestId("peak-v2-court-slot");
    expect(slots[0]).toHaveTextContent("Trae Young");
    expect(slots[1]).toHaveTextContent("John Stockton");
  });
});

// ---------------------------------------------------------------------------
// Turn clocks for every seat
// ---------------------------------------------------------------------------

describe("turn clocks", () => {
  it("a bot on the clock gets the same depleting clock on its own court, and the others recede", () => {
    const botTurn = view({
      current_turn_seat_index: 1,
      seconds_remaining: null,
      turn_seconds_remaining: 30,
      turn_elapsed_seconds: 15,
      turn_total_seconds: 45,
      legal_commands: [],
      public_state: publicState({ current_seat: 1 }),
    });
    getMatch.mockImplementation(async () => botTurn);
    render(<ThreeManWeaveGame initialMatch={botTurn} />);
    const clock = screen.getAllByTestId("tmw-seat-clock-1")[0];
    expect(clock).toHaveAttribute("data-owner", "bot");
    expect(clock).toHaveAttribute("data-state", "running");
    expect(within(clock).getByTestId("tmw-seat-clock-1-value")).toHaveTextContent("30");
    expect(within(clock).getByTestId("tmw-seat-clock-1-label")).toHaveTextContent("Thinking");
    expect(screen.queryAllByTestId("tmw-seat-clock-0")).toHaveLength(0);
    const seats = screen.getAllByTestId("tmw-seat-court-1").map((el) => el.closest("[data-gf-seat]"));
    expect(seats[0]).toHaveAttribute("data-gf-seat", "active");
    expect(screen.getAllByTestId("tmw-seat-court-0")[0].closest("[data-gf-seat]")).toHaveAttribute("data-gf-seat", "receded");
  });

  it("the human's own turn uses the identical clock, labelled as theirs", () => {
    getMatch.mockImplementation(async () => view());
    render(<ThreeManWeaveGame initialMatch={view()} />);
    const clock = screen.getAllByTestId("tmw-seat-clock-0")[0];
    expect(clock).toHaveAttribute("data-owner", "you");
    expect(within(clock).getByTestId("tmw-seat-clock-0-label")).toHaveTextContent("Your pick");
  });
});

// ---------------------------------------------------------------------------
// Reconnect mid-ceremony
// ---------------------------------------------------------------------------

describe("reconnect", () => {
  function ceremony(elapsed: number): TmwMatchView {
    return view({
      turn_phase: TMW_TURN_PHASE_REVEAL,
      current_turn_seat_index: null,
      legal_commands: ["tmw_pick"],
      turn_seq: 7,
      turn_elapsed_seconds: elapsed,
      turn_total_seconds: TMW_REVEAL_SECONDS,
      turn_seconds_remaining: TMW_REVEAL_SECONDS - elapsed,
      seconds_remaining: TMW_REVEAL_SECONDS - elapsed,
    });
  }

  it("lands at the SERVER's point in the ceremony: settled when the reels have settled, from the round card when it just opened", () => {
    getMatch.mockImplementation(async () => ceremony(0));
    const late = render(<ThreeManWeaveGame initialMatch={ceremony(2.6)} />);
    expect(late.getByTestId("tmw-roll")).toHaveAttribute("data-revealed", "true");
    expect(late.queryByTestId("tmw-pick-overlay")).toBeNull();
    late.unmount();

    const fresh = render(<ThreeManWeaveGame initialMatch={ceremony(0)} />);
    expect(fresh.getByTestId("tmw-roll")).toHaveAttribute("data-revealed", "false");
    expect(fresh.getByTestId("tmw-round-reveal")).toHaveTextContent("Round 1");
    expect(fresh.queryByRole("button", { name: /skip|draft now/i })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

describe("Play Again", () => {
  it("creates ONE fresh bot match and enters it directly, never the landing page", async () => {
    const user = userEvent.setup();
    const done = view({
      status: "completed",
      current_turn_seat_index: null,
      seconds_remaining: null,
      turn_phase: null,
      legal_commands: [],
      public_state: publicState({ is_complete: true }),
    });
    getMatch.mockImplementation(async () => done);
    getMatchResults.mockResolvedValue({
      results: [
        { seat_index: 0, display_name: "You", placement: 1, score: 70, outcome: "win", was_bot: false, detail: { score_status: "complete", lineup_score: 70, mean_season_score: 70, fit_components: { talent_core: 0, bench_strength: 0, positional_fit: 0, creation_coverage: 0, scoring_coverage: 0, postseason_pedigree: 0, team_context_depth: 0 }, best_pick: null, decisive_pick: null, tmw_adapter_version: "v", lineup_model_version: "v", simulator_version: "v", formula_version: "v" } },
        { seat_index: 1, display_name: "Rim Runner", placement: 2, score: 60, outcome: "loss", was_bot: true, detail: { score_status: "complete", lineup_score: 60, mean_season_score: 60, fit_components: { talent_core: 0, bench_strength: 0, positional_fit: 0, creation_coverage: 0, scoring_coverage: 0, postseason_pedigree: 0, team_context_depth: 0 }, best_pick: null, decisive_pick: null, tmw_adapter_version: "v", lineup_model_version: "v", simulator_version: "v", formula_version: "v" } },
        { seat_index: 2, display_name: "The Enforcer", placement: 3, score: 50, outcome: "loss", was_bot: true, detail: { score_status: "complete", lineup_score: 50, mean_season_score: 50, fit_components: { talent_core: 0, bench_strength: 0, positional_fit: 0, creation_coverage: 0, scoring_coverage: 0, postseason_pedigree: 0, team_context_depth: 0 }, best_pick: null, decisive_pick: null, tmw_adapter_version: "v", lineup_model_version: "v", simulator_version: "v", formula_version: "v" } },
      ],
    });
    const created = deferred<TmwMatchView>();
    createPracticeMatch.mockImplementation(() => created.promise);

    render(<ThreeManWeaveGame initialMatch={done} />);
    const again = await screen.findByTestId("tmw-play-again");
    await user.dblClick(again);
    expect(createPracticeMatch).toHaveBeenCalledTimes(1);
    expect(again).toHaveAttribute("data-state", "pending");

    await act(async () => {
      created.resolve(view({ match_id: "m-2", state_version: 0 }));
      await created.promise;
    });
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith("/arena/three-man-weave/m-2"));
    expect(routerPush).not.toHaveBeenCalled();
    // The landing page is still one explicit click away.
    expect(screen.getByTestId("tmw-back-to-mode")).toHaveAttribute("href", "/arena/three-man-weave");
  });
});

// ---------------------------------------------------------------------------
// A room that is still filling
// ---------------------------------------------------------------------------

describe("a forming private room", () => {
  it("waits visibly instead of rendering the empty projection, then mounts the game when the last seat fills", async () => {
    getArenaReadiness.mockResolvedValue({ arena_enabled: true, modes: [{ id: "three_man_weave", seat_count: 3 }] });
    const forming = {
      ...view({ status: "forming", turn_phase: null, current_turn_seat_index: null, room_code: "ABC123", legal_commands: [] }),
      // The server projects NOTHING for a match that has not opened.
      public_state: {} as unknown as TmwPublicState,
      private_state: {},
      seats: SEATS.slice(0, 2),
    } as TmwMatchView;
    let calls = 0;
    getMatch.mockImplementation(async () => (calls++ < 2 ? forming : view({ turn_phase: "intro", current_turn_seat_index: null, legal_commands: [] })));
    render(<ThreeManWeaveLoader matchId="m-1" />);
    await screen.findByTestId("tmw-forming");
    expect(screen.getByTestId("tmw-forming")).toHaveTextContent("2 of 3 seated");
    expect(screen.getByTestId("tmw-forming-code")).toHaveTextContent("ABC123");
    expect(screen.queryByTestId("tmw-room")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("tmw-room")).toBeInTheDocument(), { timeout: 4000 });
    expect(screen.getByTestId("tmw-room")).toHaveAttribute("data-turn-phase", "intro");
  }, 8000);
});
