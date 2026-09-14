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
import {
  TMW_PICK_SETTLE_SECONDS,
  TMW_REVEAL_SECONDS,
  TMW_TURN_PHASE_PICK,
  TMW_TURN_PHASE_REVEAL,
} from "@/types/three-man-weave";
import { revealLeadMs } from "@/lib/three-man-weave-state";
import PeakV2TMWReveal from "@/components/v2/tmw/PeakV2TMWReveal";
import {
  TMW_CEREMONY,
  TMW_CEREMONY_MARKS,
  TMW_CEREMONY_NOMINAL_MS,
  ceremonyMarks,
} from "@/components/v2/tmw/PeakV2TMWReveal";
import { TMW_PREVIOUS_PICK_BEAT_MS } from "@/components/three-man-weave/ThreeManWeaveGame";

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

  it("stages only a SETTLED selection: rapid re-selection sends one request for the final intent, never a repeat", async () => {
    const user = userEvent.setup();
    getMatch.mockImplementation(async () => view());
    submitCommand.mockImplementation(async (_id: string, _type: string, payload: { player_slug?: string }) =>
      accepted(
        view({
          state_version: 5,
          private_state: {
            ...view().private_state,
            staged_pick: { player_slug: payload.player_slug ?? "", slot_type: payload.player_slug === "john-stockton" ? "PG" : "PF" },
          },
        }),
      ),
    );
    render(<ThreeManWeaveGame initialMatch={view()} />);
    await user.click(screen.getByTestId("tmw-candidate-john-stockton"));
    await user.click(screen.getByTestId("tmw-candidate-john-stockton"));
    await user.click(screen.getByTestId("tmw-candidate-karl-malone"));
    await user.click(screen.getByTestId("tmw-candidate-john-stockton"));
    // Browsing costs no request: staging exists for the timeout, and a choice
    // still being made is not one the timeout should draft.
    expect(submitCommand).not.toHaveBeenCalled();

    await waitFor(() => expect(submitCommand).toHaveBeenCalledTimes(1), { timeout: 2000 });
    const staged = submitCommand.mock.calls.map((c) => (c[2] as { player_slug?: string }).player_slug);
    expect(staged).toEqual(["john-stockton"]);

    // The same intent again is not re-sent.
    await user.click(screen.getByTestId("tmw-candidate-john-stockton"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    expect(submitCommand).toHaveBeenCalledTimes(1);
  });

  it("a Draft pressed before the selection settles sends the pick alone, with no staging round trip in front of it", async () => {
    const user = userEvent.setup();
    getMatch.mockImplementation(async () => view());
    const afterPick = view({
      state_version: 5,
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
      if (type === "tmw_pick") {
        expect(version).toBe(4);
        return accepted(afterPick);
      }
      throw new Error(`unexpected ${type}`);
    });
    render(<ThreeManWeaveGame initialMatch={view()} />);
    await user.click(screen.getByTestId("tmw-candidate-john-stockton"));
    await user.click(screen.getByTestId("tmw-confirm-pick"));
    await waitFor(() => expect(screen.queryByTestId("tmw-pick-overlay")).toBeNull());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    expect(submitCommand.mock.calls.map((c) => c[1])).toEqual(["tmw_pick"]);
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
    // Pre-deploy polish moved the settle from 1.75 s of a 3.0 s window to
    // the ceremony's published `locked` mark of a 4.0 s window; the elapsed
    // time is read off the marks so this pins "settled means settled", not
    // a number.
    const settled = TMW_CEREMONY_MARKS.resolved / 1000 + 0.1;
    expect(settled).toBeLessThan(TMW_REVEAL_SECONDS);
    const late = render(<ThreeManWeaveGame initialMatch={ceremony(settled)} />);
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

// ---------------------------------------------------------------------------
// Pre-deploy polish: the previous-pick beat
// ---------------------------------------------------------------------------

describe("the previous-pick beat", () => {
  /** A bot's turn, nothing on the board yet. */
  function botOnClock(): TmwMatchView {
    return view({
      current_turn_seat_index: 1,
      seconds_remaining: null,
      legal_commands: [],
      public_state: publicState({ current_seat: 1 }),
    });
  }
  /** The same match one snapshot later: the bot's pick landed AND the turn is yours. */
  function handedToYou(): TmwMatchView {
    return view({
      state_version: 5,
      turn_seq: 4,
      current_turn_seat_index: 0,
      public_state: publicState({
        current_seat: 0,
        rosters: [roster(0), roster(1, { PF: pick("karl-malone", "Karl Malone", "PF", 1) }), roster(2)],
      }),
    });
  }

  it("shows the previous seat's pick over the applied state BEFORE the pick surface opens, then opens it", async () => {
    vi.useFakeTimers();
    try {
      getMatch.mockImplementation(async () => handedToYou());
      render(<ThreeManWeaveGame initialMatch={botOnClock()} />);
      expect(screen.queryByTestId("tmw-pick-overlay")).toBeNull();

      // The opponent-turn poll (1 s) lands the handoff snapshot.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });
      // STATE IS APPLIED: their card is on their court and the turn is yours.
      expect(within(screen.getAllByTestId("tmw-seat-court-1")[0]).getByText("Karl Malone")).toBeInTheDocument();
      expect(screen.getByTestId("tmw-on-the-clock")).toHaveTextContent(/you/i);
      // PRESENTATION HOLDS THE OVERLAY: the moment names the pick, the beat is on.
      expect(screen.getByTestId("tmw-room")).toHaveAttribute("data-beat", "previous-pick");
      expect(screen.getByTestId("tmw-moment")).toHaveTextContent("Karl Malone → PF");
      expect(screen.getByTestId("tmw-moment")).toHaveTextContent("Rim Runner");
      expect(screen.getByTestId("tmw-moment")).toHaveTextContent("You're up");
      expect(screen.getByTestId("tmw-previous-pick-beat")).toBeInTheDocument();
      expect(screen.queryByTestId("tmw-pick-overlay")).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(TMW_PREVIOUS_PICK_BEAT_MS + 20);
      });
      expect(screen.getByTestId("tmw-room")).not.toHaveAttribute("data-beat");
      expect(screen.getByTestId("tmw-pick-overlay")).toBeInTheDocument();
      expect(screen.queryByTestId("tmw-previous-pick-beat")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never gates the player: a press during the beat opens the surface at once", async () => {
    vi.useFakeTimers();
    try {
      getMatch.mockImplementation(async () => handedToYou());
      render(<ThreeManWeaveGame initialMatch={botOnClock()} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });
      expect(screen.getByTestId("tmw-room")).toHaveAttribute("data-beat", "previous-pick");
      await act(async () => {
        window.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      });
      expect(screen.getByTestId("tmw-pick-overlay")).toBeInTheDocument();
      expect(screen.getByTestId("tmw-room")).not.toHaveAttribute("data-beat");
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds no beat under reduced motion, and none when the turn is not handed over on a pick", async () => {
    vi.useFakeTimers();
    try {
      mockMatchMedia(true);
      getMatch.mockImplementation(async () => handedToYou());
      const reduced = render(<ThreeManWeaveGame initialMatch={botOnClock()} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5);
      });
      expect(reduced.getByTestId("tmw-pick-overlay")).toBeInTheDocument();
      reduced.unmount();

      // A reload straight into your turn is not a handoff: no beat.
      mockMatchMedia(false);
      getMatch.mockImplementation(async () => handedToYou());
      const fresh = render(<ThreeManWeaveGame initialMatch={handedToYou()} />);
      expect(fresh.getByTestId("tmw-pick-overlay")).toBeInTheDocument();
      expect(fresh.getByTestId("tmw-room")).not.toHaveAttribute("data-beat");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Pre-deploy polish: the round card is deliberate, and the ceremony fits
// ---------------------------------------------------------------------------

describe("the round card", () => {
  function ceremony(elapsed: number, total = TMW_REVEAL_SECONDS): TmwMatchView {
    return view({
      turn_phase: TMW_TURN_PHASE_REVEAL,
      current_turn_seat_index: null,
      legal_commands: ["tmw_pick"],
      turn_seq: 7,
      turn_elapsed_seconds: elapsed,
      turn_total_seconds: total,
      turn_seconds_remaining: total - elapsed,
      seconds_remaining: total - elapsed,
    });
  }

  // Pass 4 laid the ceremony out for a 1.5 s window, and played end to end it
  // read as a flash. Pass 5 (3.8 s) builds anticipation and two releases: the
  // franchise lands while the decade still turns, then the pair locks. The
  // behavioural rules are kept: the result is resolved with half a second of
  // the window to spare, and every stage is read off the server's elapsed time.
  it("resolves inside the server window with half a second of the result held, without flashing past", () => {
    expect(TMW_CEREMONY_NOMINAL_MS).toBe(TMW_REVEAL_SECONDS * 1000);
    // At least half a second of the result on screen before the server can
    // open the pick turn, on the nominal window.
    expect(TMW_CEREMONY_MARKS.resolved + 500).toBeLessThanOrEqual(TMW_REVEAL_SECONDS * 1000);
    // ...and real anticipation before it: the reels take seconds, not a blink.
    expect(TMW_CEREMONY_MARKS.resolved).toBeGreaterThanOrEqual(2500);
    expect(TMW_CEREMONY.roundCardMs).toBeGreaterThanOrEqual(300);
    expect(TMW_CEREMONY.roundCardMs).toBeLessThanOrEqual(700);
    expect(TMW_CEREMONY.armedMs).toBeGreaterThanOrEqual(150);
    // Two releases: the franchise lands a readable beat before the decade.
    expect(TMW_CEREMONY_MARKS.landing + 500).toBeLessThanOrEqual(TMW_CEREMONY_MARKS.locked);
    // The last reel lands before the lock begins.
    expect(TMW_CEREMONY_MARKS.spinning + TMW_CEREMONY_MARKS.secondaryReelMs).toBeLessThanOrEqual(TMW_CEREMONY_MARKS.locked);
  });

  it("names the round from the first frame and walks slate, armed, locked, resolved off the server's elapsed time", () => {
    const early = render(<ThreeManWeaveGame initialMatch={ceremony(0)} />);
    expect(early.getByTestId("tmw-round-reveal")).toHaveTextContent("Round 1");
    expect(early.getByTestId("tmw-roll")).toHaveAttribute("data-stage", "round");
    early.unmount();

    const armed = render(<ThreeManWeaveGame initialMatch={ceremony(TMW_CEREMONY_MARKS.armed / 1000 + 0.01)} />);
    expect(armed.getByTestId("tmw-roll")).toHaveAttribute("data-stage", "armed");
    // The round stays named on the slate: it is what the roll applies to.
    expect(armed.getByTestId("tmw-round-reveal")).toHaveTextContent("Round 1");
    armed.unmount();

    const locked = render(<ThreeManWeaveGame initialMatch={ceremony(TMW_CEREMONY_MARKS.locked / 1000 + 0.02)} />);
    expect(locked.getByTestId("tmw-roll")).toHaveAttribute("data-stage", "locked");
    expect(locked.getByTestId("tmw-ceremony-status")).toHaveTextContent(/locked in/i);
    locked.unmount();

    const resolved = render(<ThreeManWeaveGame initialMatch={ceremony(TMW_CEREMONY_MARKS.resolved / 1000 + 0.02)} />);
    expect(resolved.getByTestId("tmw-roll")).toHaveAttribute("data-revealed", "true");
    expect(resolved.queryByTestId("tmw-pick-overlay")).toBeNull();
    resolved.unmount();
  });

  it("a longer published window changes no beat, it only lengthens the hold", () => {
    expect(ceremonyMarks(4000)).toEqual(ceremonyMarks(TMW_CEREMONY_NOMINAL_MS));
    const long = render(<ThreeManWeaveGame initialMatch={ceremony(TMW_CEREMONY_MARKS.resolved / 1000 + 0.02, 4.0)} />);
    expect(long.getByTestId("tmw-roll")).toHaveAttribute("data-revealed", "true");
    long.unmount();
  });

  it("compresses to a window shorter than 1.5 s so the reels are settled before it ends", () => {
    const marks = ceremonyMarks(1000);
    expect(marks.resolved).toBeLessThan(1000);
    const short = render(<ThreeManWeaveGame initialMatch={ceremony(0.95, 1.0)} />);
    expect(short.getByTestId("tmw-roll")).toHaveAttribute("data-revealed", "true");
    short.unmount();
  });

  it("compresses to a shorter published window so the pair is never still turning when the server opens the pick turn", () => {
    // An API still serving a 3.0 s reveal: 2.9 s in, the ceremony is resolved.
    const shortWindow = render(<ThreeManWeaveGame initialMatch={ceremony(2.9, 3.0)} />);
    expect(shortWindow.getByTestId("tmw-roll")).toHaveAttribute("data-revealed", "true");
    shortWindow.unmount();
  });
});

// ---------------------------------------------------------------------------
// Arrival (game-feel pass 4): the briefing's clock starts when this client has
// it on screen, never at match creation.
// ---------------------------------------------------------------------------

describe("arrival", () => {
  const arriving = () =>
    view({
      state_version: 1,
      current_turn_seat_index: null,
      seconds_remaining: 20,
      turn_seconds_remaining: 20,
      turn_elapsed_seconds: 0.2,
      turn_total_seconds: 20,
      turn_seq: 0,
      turn_phase: "arrival",
      legal_commands: ["tmw_intro_seen"],
      private_state: { seat_index: 0 },
    });
  const briefing = () =>
    view({
      state_version: 2,
      current_turn_seat_index: null,
      seconds_remaining: 4,
      turn_seconds_remaining: 4,
      turn_elapsed_seconds: 0,
      turn_total_seconds: 4,
      turn_seq: 1,
      turn_phase: "intro",
      legal_commands: [],
      private_state: { seat_index: 0 },
    });

  it("reports the briefing on screen exactly once, then runs the briefing's own clock", async () => {
    getMatch.mockResolvedValue(arriving());
    submitCommand.mockResolvedValue(accepted(briefing()));
    render(<ThreeManWeaveGame initialMatch={arriving()} />);

    // The briefing is up, held: its clock has not started.
    expect(screen.getByTestId("tmw-intro")).toBeVisible();
    expect(screen.getByTestId("tmw-intro-countdown")).toHaveAttribute("data-arriving", "true");

    await waitFor(() => expect(submitCommand).toHaveBeenCalledTimes(1));
    expect(submitCommand.mock.calls[0][1]).toBe("tmw_intro_seen");
    expect(submitCommand.mock.calls[0][3]).toBe(1);

    await waitFor(() => expect(screen.getByTestId("tmw-room")).toHaveAttribute("data-turn-phase", "intro"));
    expect(screen.getByTestId("tmw-intro-countdown")).toHaveAttribute("data-arriving", "false");
    await act(async () => {});
    expect(submitCommand).toHaveBeenCalledTimes(1);
  });

  it("tries again when the report did not land", async () => {
    getMatch.mockResolvedValue(arriving());
    submitCommand.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(accepted(briefing()));
    render(<ThreeManWeaveGame initialMatch={arriving()} />);
    await waitFor(() => expect(submitCommand).toHaveBeenCalledTimes(2));
    expect(submitCommand.mock.calls.every((call) => call[1] === "tmw_intro_seen")).toBe(true);
    await waitFor(() => expect(screen.getByTestId("tmw-room")).toHaveAttribute("data-turn-phase", "intro"));
  });
});

// ---------------------------------------------------------------------------
// Game-feel pass 5: pacing beats and the pick surface over the courts
// ---------------------------------------------------------------------------

describe("the roll's two releases", () => {
  function rolling(elapsed: number, constraint: TmwPublicState["constraint"] = undefined): TmwMatchView {
    return view({
      turn_phase: TMW_TURN_PHASE_REVEAL,
      current_turn_seat_index: null,
      legal_commands: [],
      turn_seq: 7,
      turn_elapsed_seconds: elapsed,
      turn_total_seconds: TMW_REVEAL_SECONDS,
      turn_seconds_remaining: TMW_REVEAL_SECONDS - elapsed,
      seconds_remaining: TMW_REVEAL_SECONDS - elapsed,
      public_state: publicState(constraint ? { constraint } : {}),
    });
  }

  it("lands the franchise first, with the decade still turning, and says so", () => {
    const at = TMW_CEREMONY_MARKS.landing / 1000 + 0.02;
    const landing = render(<ThreeManWeaveGame initialMatch={rolling(at)} />);
    expect(landing.getByTestId("tmw-roll")).toHaveAttribute("data-stage", "landing");
    expect(landing.getByTestId("tmw-ceremony-status")).toHaveTextContent("Utah Jazz… and the decade?");
    expect(landing.getByTestId("tmw-roll")).toHaveAttribute("data-revealed", "false");
    landing.unmount();
  });

  it("a one-constraint draft has a single reel, so no landing stage", () => {
    const at = TMW_CEREMONY_MARKS.landing / 1000 + 0.02;
    const single = render(
      <ThreeManWeaveGame initialMatch={rolling(at, { kind: "franchise", value: "UTA", label: "Utah Jazz" })} />,
    );
    expect(single.getByTestId("tmw-roll")).toHaveAttribute("data-stage", "spinning");
    single.unmount();
  });
});

describe("the settle lead before a round's roll", () => {
  const total = TMW_PICK_SETTLE_SECONDS + TMW_REVEAL_SECONDS;
  function settleReveal(elapsed: number): TmwMatchView {
    return view({
      turn_phase: TMW_TURN_PHASE_REVEAL,
      current_turn_seat_index: null,
      legal_commands: [],
      turn_seq: 9,
      turn_elapsed_seconds: elapsed,
      turn_total_seconds: total,
      turn_seconds_remaining: total - elapsed,
      seconds_remaining: total - elapsed,
      public_state: publicState({
        current_round: 2,
        current_roll: { ...ROLL, round_number: 2, roll_id: "roll-2" },
        rosters: [roster(0, { PG: pick("john-stockton", "John Stockton", "PG", 0, 1) }), roster(1), roster(2)],
      }),
    });
  }

  it("reads the lead off the server's own window, and never gives the opening reveal one", () => {
    expect(revealLeadMs(settleReveal(0))).toBe(TMW_PICK_SETTLE_SECONDS * 1000);
    // An API whose reveal carries no lead.
    expect(revealLeadMs({ ...settleReveal(0), turn_total_seconds: TMW_REVEAL_SECONDS })).toBe(0);
    // Round one: no pick came before it.
    expect(
      revealLeadMs({ ...settleReveal(0), public_state: publicState({ current_round: 1 }) }),
    ).toBe(0);
    // Not a reveal at all.
    expect(revealLeadMs(view())).toBe(0);
  });

  it("keeps the board up while the pick settles, then rolls on the rest of the server's window", async () => {
    vi.useFakeTimers();
    try {
      getMatch.mockImplementation(async () => settleReveal(0));
      render(<ThreeManWeaveGame initialMatch={settleReveal(0)} />);
      expect(screen.getByTestId("tmw-room")).toHaveAttribute("data-beat", "settle");
      expect(screen.queryByTestId("tmw-ceremony-scrim")).toBeNull();
      expect(within(screen.getAllByTestId("tmw-seat-court-0")[0]).getByText("John Stockton")).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(TMW_PICK_SETTLE_SECONDS * 1000 + 30);
      });
      expect(screen.getByTestId("tmw-room")).not.toHaveAttribute("data-beat");
      expect(screen.getByTestId("tmw-ceremony-scrim")).toBeInTheDocument();
      // The roll starts at its own beginning, not 1.4 s in.
      expect(screen.getByTestId("tmw-roll")).toHaveAttribute("data-stage", "round");
      expect(screen.getByTestId("tmw-round-reveal")).toHaveTextContent("Round 2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a reconnect after the lead lands straight on the roll", () => {
    const late = render(<ThreeManWeaveGame initialMatch={settleReveal(TMW_PICK_SETTLE_SECONDS + 0.1)} />);
    expect(late.getByTestId("tmw-room")).not.toHaveAttribute("data-beat");
    expect(late.getByTestId("tmw-roll")).toHaveAttribute("data-stage", "round");
    late.unmount();
  });
});

describe("the pick surface over the courts", () => {
  it("layers the surface over the courts on your turn, and leaves them bare otherwise", () => {
    const yours = render(<ThreeManWeaveGame initialMatch={view()} />);
    const stage = yours.getByTestId("tmw-stage");
    expect(stage).toHaveAttribute("data-decision-open", "true");
    // One cell: the surface and the courts are both children of the stage.
    expect(within(stage).getByTestId("tmw-pick-overlay")).toBeInTheDocument();
    expect(within(stage).getByTestId("tmw-courts")).toBeInTheDocument();
    yours.unmount();

    const theirs = render(
      <ThreeManWeaveGame
        initialMatch={view({ current_turn_seat_index: 1, seconds_remaining: null, legal_commands: [], public_state: publicState({ current_seat: 1 }) })}
      />,
    );
    expect(theirs.getByTestId("tmw-stage")).toHaveAttribute("data-decision-open", "false");
    expect(theirs.queryByTestId("tmw-pick-overlay")).toBeNull();
    theirs.unmount();
  });
});

describe("the snake's edge in a one-constraint draft", () => {
  const constraint = { kind: "franchise", value: "UTA", label: "Utah Jazz" } as const;

  it("holds the surface for a beat when your own pick turns the round back to you, then opens it", async () => {
    const mine = view({ public_state: publicState({ constraint }) });
    const next = view({
      state_version: 5,
      turn_seq: 4,
      public_state: publicState({
        constraint,
        current_round: 2,
        current_seat: 0,
        rosters: [roster(0, { PG: pick("john-stockton", "John Stockton", "PG", 0, 1) }), roster(1), roster(2)],
        drafted_identities: ["john-stockton"],
        current_roll: { ...ROLL, round_number: 2, roll_id: "roll-2", eligible_slugs: ["karl-malone"], candidates: [ROLL.candidates[1]] },
      }),
      private_state: {
        seat_index: 0,
        candidate_fits: {
          "karl-malone": { player_slug: "karl-malone", state: "fits_now", direct_slots: ["PF"], plan: null, moves: [], reason: null },
        },
        legal_picks: { "karl-malone": ["PF"] },
      },
    });
    submitCommand.mockImplementation(async () => accepted(next));
    getMatch.mockImplementation(async () => next);
    const user = userEvent.setup();
    render(<ThreeManWeaveGame initialMatch={mine} />);
    await act(async () => {});
    await user.click(screen.getByTestId("tmw-candidate-john-stockton"));
    await user.click(screen.getByTestId("tmw-confirm-pick"));

    await waitFor(() => expect(screen.getByTestId("tmw-room")).toHaveAttribute("data-beat", "round-turn"));
    expect(screen.getByTestId("tmw-previous-pick-beat")).toHaveTextContent("Round 2 · your pick again");
    expect(screen.queryByTestId("tmw-pick-overlay")).toBeNull();
    expect(screen.getByTestId("tmw-moment")).toHaveTextContent("Round 2 opens with you");

    await waitFor(() => expect(screen.getByTestId("tmw-pick-overlay")).toBeInTheDocument(), {
      timeout: TMW_PREVIOUS_PICK_BEAT_MS + 1500,
    });
  });
});

describe("review fixes", () => {
  it("a roll that opens late starts from the server's elapsed time, not from zero", () => {
    // The room mounts the ceremony shut during the settle lead; if its timer
    // fires late, the roll must land where the server already is.
    const props = {
      roll: ROLL,
      roundNumber: 2,
      totalRounds: 6,
      phase: "reveal" as const,
      turnKey: "m-1:9:reveal",
      seats: SEATS,
      yourSeatIndex: 0,
      totalSeconds: TMW_REVEAL_SECONDS,
    };
    const startedAt = performance.now();
    const { rerender, queryByTestId, getByTestId } = render(
      <PeakV2TMWReveal {...props} open={false} startedAt={startedAt} />,
    );
    expect(queryByTestId("tmw-roll")).toBeNull();
    // Opened 2.6 s into the roll's own timeline.
    rerender(
      <PeakV2TMWReveal {...props} open startedAt={startedAt - (TMW_CEREMONY_MARKS.landing + 100)} />,
    );
    expect(getByTestId("tmw-roll")).toHaveAttribute("data-stage", "landing");
  });

  it("takes the covered courts out of the tab order while the pick surface is open", () => {
    const yours = render(<ThreeManWeaveGame initialMatch={view()} />);
    expect(yours.getByTestId("tmw-courts")).toHaveAttribute("inert");
    yours.unmount();
    const theirs = render(
      <ThreeManWeaveGame
        initialMatch={view({ current_turn_seat_index: 1, seconds_remaining: null, legal_commands: [], public_state: publicState({ current_seat: 1 }) })}
      />,
    );
    expect(theirs.getByTestId("tmw-courts")).not.toHaveAttribute("inert");
    theirs.unmount();
  });
});
