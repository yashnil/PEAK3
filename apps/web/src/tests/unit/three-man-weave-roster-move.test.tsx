/**
 * THREE-MAN WEAVE — rearranging a roster, as regressions.
 *
 * THE PRODUCTION CRASH THIS FILE EXISTS FOR. Selecting one of your own
 * drafted cards inside the pick overlay and moving it to another slot could
 * take the whole page down with
 * `TypeError: Cannot read properties of null (reading 'player_name')`, which
 * Next.js paints as "Application error: a client-side exception has
 * occurred". The mechanism, and why it was intermittent:
 *
 *   - `movingFrom` is a SLOT NAME held in `PickOverlay`'s local state, and
 *     `mode === "moving"` was derived from it ALONE;
 *   - `movingPick` -- whoever the authoritative roster says is standing in
 *     that slot -- can be null, and three places dereferenced it with `!`;
 *   - `open` gates a `return null` BELOW the hooks, so a closed overlay is
 *     not an unmounted one: a half-made move survived every closed window and
 *     every authoritative roster replacement, and the "fresh turn, fresh
 *     decision" effect could only clear it AFTER a render that had already
 *     thrown.
 *
 * Moving a card to an EMPTY slot is exactly the case that empties the source,
 * which is why the report was "SG -> PG, then the page dies".
 *
 * `mode` is now derived from the RESOLVED pick, so "moving" implies a
 * non-null `movingPick` structurally and there is no assertion left to get
 * wrong; the overlay additionally clears its transient state on close, and
 * self-heals a slot whose occupant has gone.
 *
 * The rest of the file pins the behaviour the same pass added: a press is
 * acknowledged in its own frame (the optimistic arrangement), the server
 * remains the authority (a refusal rolls back), one press sends one command,
 * and "time ran out" is only ever said when the SERVER says the timeout
 * fallback chose.
 */
import React, { act } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ThreeManWeaveGame from "@/components/three-man-weave/ThreeManWeaveGame";
import type {
  ArenaSeatPublic,
  TmwMatchView,
  TmwPick,
  TmwPublicState,
  TmwRoll,
  TmwRoster,
} from "@/types/three-man-weave";
import { TMW_TURN_PHASE_PICK } from "@/types/three-man-weave";

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const getMatch = vi.fn();
const getMatchResults = vi.fn();
const submitCommand = vi.fn();

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
  createPracticeMatch: vi.fn(),
  getArenaReadiness: vi.fn(),
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
// Fixtures — a Spurs 2000s roll, because the report named Manu Ginobili.
// ---------------------------------------------------------------------------

const SEATS: ArenaSeatPublic[] = [
  { seat_index: 0, display_name: "You", is_bot: false, status: "active", bot_rating: null },
  { seat_index: 1, display_name: "Rim Runner", is_bot: true, status: "active", bot_rating: 50 },
  { seat_index: 2, display_name: "The Enforcer", is_bot: true, status: "active", bot_rating: 50 },
];

function card(
  slug: string,
  name: string,
  slot: TmwPick["slot_type"],
  positions: string[],
): TmwPick {
  return {
    player_slug: slug,
    player_name: name,
    positions: positions as TmwPick["positions"],
    eligibility: {
      franchise_id: "SAS",
      franchise_display_name: "San Antonio Spurs",
      decade: "2000s",
      seasons: [{ season: "2004-05", team_code: "SAS", games_played: 74, via: "direct_team_season" }],
    },
    scoring_card: {
      season: "2004-05",
      team_id: "SAS",
      team_name: "San Antonio Spurs",
      prime_score: 74.2,
      score_source: "exact_team_stint",
      is_multi_team_season: false,
      formula_version: "peak3_v1",
    },
    seat_index: 0,
    round_number: 1,
    slot_type: slot,
    franchise_id: "SAS",
    decade: "2000s",
    resolution: "action",
  };
}

/** Manu plays both guard slots, which is what makes SG -> PG legal. */
const MANU_SG = card("manu-ginobili", "Manu Ginobili", "SG", ["PG", "SG"]);
const MANU_PG: TmwPick = { ...MANU_SG, slot_type: "PG" };
const MANU_BENCH: TmwPick = { ...MANU_SG, slot_type: "bench_1" };
const PARKER_PG = card("tony-parker", "Tony Parker", "PG", ["PG", "SG"]);
const PARKER_SG: TmwPick = { ...PARKER_PG, slot_type: "SG" };
const BOWEN_BENCH = card("bruce-bowen", "Bruce Bowen", "bench_1", ["SF", "SG"]);
const BOWEN_SF: TmwPick = { ...BOWEN_BENCH, slot_type: "SF" };

function roster(seatIndex: number, slots: Record<string, TmwPick | null> = {}): TmwRoster {
  return {
    seat_index: seatIndex,
    slots: { PG: null, SG: null, SF: null, PF: null, C: null, bench_1: null, ...slots },
    complete: false,
  };
}

const ROLL: TmwRoll = {
  round_number: 3,
  roll_id: "roll-3",
  franchise_id: "SAS",
  franchise_display_name: "San Antonio Spurs",
  decade: "2000s",
  eligible_slugs: ["tim-duncan"],
  candidates: [
    {
      player_slug: "tim-duncan",
      player_name: "Tim Duncan",
      positions: ["PF", "C"],
      eligibility: {
        franchise_id: "SAS",
        franchise_display_name: "San Antonio Spurs",
        decade: "2000s",
        seasons: [{ season: "2004-05", team_code: "SAS", games_played: 66, via: "direct_team_season" }],
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
    current_round: 3,
    current_seat: 0,
    is_complete: false,
    rosters: [roster(0, { SG: MANU_SG }), roster(1), roster(2)],
    drafted_identities: ["manu-ginobili"],
    used_roll_ids: ["roll-3"],
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
    state_version: 10,
    seat_count: 3,
    entry_path: "practice",
    rated: false,
    your_seat_index: 0,
    seats: SEATS,
    public_state: publicState(),
    private_state: {
      seat_index: 0,
      candidate_fits: {
        "tim-duncan": {
          player_slug: "tim-duncan",
          state: "fits_now",
          direct_slots: ["PF"],
          plan: null,
          moves: [],
          reason: null,
        },
      },
      legal_picks: { "tim-duncan": ["PF"] },
    },
    legal_commands: ["tmw_pick", "tmw_rearrange", "tmw_stage_pick"],
    current_turn_seat_index: 0,
    seconds_remaining: 45,
    turn_seconds_remaining: 45,
    turn_elapsed_seconds: 0,
    turn_total_seconds: 45,
    turn_seq: 7,
    turn_phase: TMW_TURN_PHASE_PICK,
    latest_event_seq: 7,
    room_code: null,
    ...overrides,
  };
}

function accepted(match: TmwMatchView) {
  return { accepted: true, replayed: false, rejection_code: null, message: null, match };
}

function refused(match: TmwMatchView, message: string) {
  return { accepted: false, replayed: false, rejection_code: "illegal_slot", message, match };
}

/** The overlay's own copy of your roster, so a court behind it cannot answer. */
function overlaySlot(slot: string) {
  return screen.getByTestId(`tmw-place-${slot}`);
}

beforeEach(() => {
  mockMatchMedia(false);
  getMatch.mockReset();
  getMatchResults.mockReset();
  submitCommand.mockReset();
  getMatchResults.mockResolvedValue({ results: [] });
  getMatch.mockImplementation(async () => view());
});

// ---------------------------------------------------------------------------
// The crash
// ---------------------------------------------------------------------------

describe("the roster-move crash", () => {
  it("survives the overlay closing mid-move and reopening on a roster that has changed", async () => {
    const user = userEvent.setup();
    // Off-turn, and the source slot is empty: the move landed (or a court
    // rearrangement between turns did), and SG no longer holds anybody.
    const offTurn = view({
      state_version: 11,
      current_turn_seat_index: 1,
      seconds_remaining: null,
      legal_commands: ["tmw_rearrange"],
      public_state: publicState({
        current_seat: 1,
        rosters: [roster(0, { PG: MANU_PG }), roster(1), roster(2)],
      }),
    });
    const backOnTurn = view({
      state_version: 12,
      public_state: publicState({ rosters: [roster(0, { PG: MANU_PG }), roster(1), roster(2)] }),
    });
    let phase = 0;
    getMatch.mockImplementation(async () => (phase === 0 ? offTurn : backOnTurn));
    submitCommand.mockImplementation(async () => accepted(view()));

    render(<ThreeManWeaveGame initialMatch={view()} />);
    // Start a move from SG and leave it unresolved -- a player deciding.
    await user.click(overlaySlot("SG"));
    expect(screen.getByTestId("tmw-pick-overlay")).toHaveAttribute("data-mode", "moving");

    // The turn passes. THIS IS THE FRAME THAT USED TO THROW when it came back.
    await waitFor(() => expect(screen.queryByTestId("tmw-pick-overlay")).toBeNull(), {
      timeout: 6000,
    });
    phase = 1;
    await waitFor(() => expect(screen.getByTestId("tmw-pick-overlay")).toBeInTheDocument(), {
      timeout: 8000,
    });
    // Reopened idle, on the roster the server actually published.
    expect(screen.getByTestId("tmw-pick-overlay")).toHaveAttribute("data-mode", "idle");
    expect(overlaySlot("PG")).toHaveTextContent("Manu Ginobili");
    expect(overlaySlot("SG")).toHaveTextContent("Open");
  }, 20_000);

  it("drops a move whose source slot is emptied underneath it, without throwing", async () => {
    const user = userEvent.setup();
    const gate = deferred<ReturnType<typeof accepted>>();
    submitCommand.mockImplementation(async () => gate.promise);
    // A poll that lands with SG already empty -- another tab, or this seat's
    // own court rearrangement -- while the overlay is mid-move.
    getMatch.mockImplementation(async () =>
      view({
        state_version: 30,
        public_state: publicState({ rosters: [roster(0, { PG: MANU_PG }), roster(1), roster(2)] }),
      }),
    );

    render(<ThreeManWeaveGame initialMatch={view()} />);
    await user.click(overlaySlot("SG"));
    expect(screen.getByTestId("tmw-pick-overlay")).toHaveAttribute("data-mode", "moving");

    await waitFor(
      () => expect(screen.getByTestId("tmw-pick-overlay")).toHaveAttribute("data-mode", "idle"),
      { timeout: 8000 },
    );
    expect(screen.getByTestId("tmw-room")).toBeInTheDocument();
    gate.resolve(accepted(view()));
  }, 20_000);
});

// ---------------------------------------------------------------------------
// Every legal shape of move
// ---------------------------------------------------------------------------

describe("legal moves", () => {
  async function moveAndAssert(
    from: string,
    to: string,
    startingSlots: Record<string, TmwPick | null>,
    landedSlots: Record<string, TmwPick | null>,
    expectedPlacements: Record<string, string>,
  ) {
    const user = userEvent.setup();
    const start = view({ public_state: publicState({ rosters: [roster(0, startingSlots), roster(1), roster(2)] }) });
    const landed = view({
      state_version: 11,
      public_state: publicState({ rosters: [roster(0, landedSlots), roster(1), roster(2)] }),
    });
    getMatch.mockImplementation(async () => start);
    submitCommand.mockImplementation(async (_id: string, type: string) =>
      type === "tmw_rearrange" ? accepted(landed) : accepted(start),
    );

    render(<ThreeManWeaveGame initialMatch={start} />);
    await user.click(overlaySlot(from));
    await user.click(overlaySlot(to));
    await user.click(screen.getByTestId("tmw-move-confirm"));

    await waitFor(() => expect(submitCommand).toHaveBeenCalled());
    const rearrangeCall = submitCommand.mock.calls.find((c) => c[1] === "tmw_rearrange");
    expect(rearrangeCall).toBeDefined();
    // THE COMPLETE FINAL ASSIGNMENT, which is the only shape the server takes.
    expect(rearrangeCall![2]).toEqual({ placements: expectedPlacements });
    await waitFor(() =>
      expect(screen.getByTestId("tmw-pick-overlay")).toHaveAttribute("data-mode", "idle"),
    );
    expect(screen.getByTestId("tmw-room")).toBeInTheDocument();
  }

  it("starter to an open starter slot — the reported SG to PG", async () => {
    await moveAndAssert("SG", "PG", { SG: MANU_SG }, { PG: MANU_PG }, { PG: "manu-ginobili" });
  });

  it("starter to the bench", async () => {
    await moveAndAssert(
      "SG",
      "bench_1",
      { SG: MANU_SG },
      { bench_1: MANU_BENCH },
      { bench_1: "manu-ginobili" },
    );
  });

  it("bench to a starter slot", async () => {
    await moveAndAssert(
      "bench_1",
      "SF",
      { bench_1: BOWEN_BENCH },
      { SF: BOWEN_SF },
      { SF: "bruce-bowen" },
    );
  });

  it("a swap, when the destination is occupied and both halves are legal", async () => {
    await moveAndAssert(
      "SG",
      "PG",
      { SG: MANU_SG, PG: PARKER_PG },
      { PG: MANU_PG, SG: PARKER_SG },
      { PG: "manu-ginobili", SG: "tony-parker" },
    );
  });
});

// ---------------------------------------------------------------------------
// Acknowledgement, authority, and the press contract
// ---------------------------------------------------------------------------

describe("the press contract", () => {
  it("shows the move on the board before the server answers, and confirms it after", async () => {
    const user = userEvent.setup();
    const gate = deferred<ReturnType<typeof accepted>>();
    submitCommand.mockImplementation(async (_id: string, type: string) =>
      type === "tmw_rearrange" ? gate.promise : accepted(view()),
    );

    render(<ThreeManWeaveGame initialMatch={view()} />);
    await user.click(overlaySlot("SG"));
    await user.click(overlaySlot("PG"));
    await user.click(screen.getByTestId("tmw-move-confirm"));

    // NO SERVER ANSWER YET. The card is already where the player put it, and
    // the slot says it is waiting.
    expect(overlaySlot("PG")).toHaveTextContent("Manu Ginobili");
    expect(overlaySlot("SG")).toHaveTextContent("Open");
    const court = screen.getAllByTestId("tmw-seat-court-0")[0];
    expect(within(court).getByText("Manu Ginobili")).toBeInTheDocument();
    expect(court.querySelector('[data-gf-pending="true"]')).not.toBeNull();

    await act(async () => {
      gate.resolve(
        accepted(
          view({
            state_version: 11,
            public_state: publicState({
              rosters: [roster(0, { PG: MANU_PG }), roster(1), roster(2)],
            }),
          }),
        ),
      );
      await gate.promise;
    });

    await waitFor(() =>
      expect(
        screen.getAllByTestId("tmw-seat-court-0")[0].querySelector('[data-gf-pending="true"]'),
      ).toBeNull(),
    );
    expect(overlaySlot("PG")).toHaveTextContent("Manu Ginobili");
  });

  it("rolls back to the server's roster when the move is refused", async () => {
    const user = userEvent.setup();
    submitCommand.mockImplementation(async (_id: string, type: string) =>
      type === "tmw_rearrange"
        ? refused(view(), "Manu Ginobili plays PG / SG — not center.")
        : accepted(view()),
    );

    render(<ThreeManWeaveGame initialMatch={view()} />);
    await user.click(overlaySlot("SG"));
    await user.click(overlaySlot("PG"));
    await user.click(screen.getByTestId("tmw-move-confirm"));

    await waitFor(() => expect(screen.getByTestId("tmw-rejection")).toBeInTheDocument());
    // THE SERVER'S ROSTER IS WHAT IS ON SCREEN. Manu is back at SG.
    await waitFor(() => expect(overlaySlot("SG")).toHaveTextContent("Manu Ginobili"));
    expect(overlaySlot("PG")).toHaveTextContent("Open");
    expect(screen.getByTestId("tmw-room")).toBeInTheDocument();
  });

  it("sends exactly one command for a double press", async () => {
    const user = userEvent.setup();
    const gate = deferred<ReturnType<typeof accepted>>();
    submitCommand.mockImplementation(async (_id: string, type: string) =>
      type === "tmw_rearrange" ? gate.promise : accepted(view()),
    );

    render(<ThreeManWeaveGame initialMatch={view()} />);
    await user.click(overlaySlot("SG"));
    await user.click(overlaySlot("PG"));
    const confirm = screen.getByTestId("tmw-move-confirm");
    await user.click(confirm);
    await user.click(confirm).catch(() => {});
    await user.click(confirm).catch(() => {});

    const rearranges = submitCommand.mock.calls.filter((c) => c[1] === "tmw_rearrange");
    expect(rearranges).toHaveLength(1);
    gate.resolve(accepted(view({ state_version: 11 })));
  });

  it("cancelling a move sends nothing and restores the idle board", async () => {
    const user = userEvent.setup();
    submitCommand.mockImplementation(async () => accepted(view()));
    render(<ThreeManWeaveGame initialMatch={view()} />);
    await user.click(overlaySlot("SG"));
    await user.click(overlaySlot("PG"));
    await user.click(screen.getByTestId("tmw-move-cancel"));
    expect(screen.getByTestId("tmw-pick-overlay")).toHaveAttribute("data-mode", "idle");
    expect(submitCommand.mock.calls.filter((c) => c[1] === "tmw_rearrange")).toHaveLength(0);
  });

  it("a move followed immediately by a draft lands both", async () => {
    const user = userEvent.setup();
    const moved = view({
      state_version: 11,
      public_state: publicState({ rosters: [roster(0, { PG: MANU_PG }), roster(1), roster(2)] }),
    });
    const drafted = view({
      state_version: 12,
      current_turn_seat_index: 1,
      seconds_remaining: null,
      legal_commands: [],
      public_state: publicState({
        current_seat: 1,
        rosters: [
          roster(0, { PG: MANU_PG, PF: card("tim-duncan", "Tim Duncan", "PF", ["PF", "C"]) }),
          roster(1),
          roster(2),
        ],
      }),
    });
    getMatch.mockImplementation(async () => moved);
    submitCommand.mockImplementation(async (_id: string, type: string) => {
      if (type === "tmw_rearrange") return accepted(moved);
      if (type === "tmw_pick") return accepted(drafted);
      return accepted(moved);
    });

    render(<ThreeManWeaveGame initialMatch={view()} />);
    await user.click(overlaySlot("SG"));
    await user.click(overlaySlot("PG"));
    await user.click(screen.getByTestId("tmw-move-confirm"));
    await waitFor(() => expect(overlaySlot("PG")).toHaveTextContent("Manu Ginobili"));

    await user.click(screen.getByTestId("tmw-candidate-tim-duncan"));
    const confirm = await screen.findByTestId("tmw-confirm-pick");
    await user.click(confirm);
    await waitFor(() => expect(screen.queryByTestId("tmw-pick-overlay")).toBeNull());
    const court = screen.getAllByTestId("tmw-seat-court-0")[0];
    expect(within(court).getByText("Tim Duncan")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// "Time ran out" may only be said when the server says so
// ---------------------------------------------------------------------------

describe("the timeout message", () => {
  it("is NOT shown for a pick the seat sent and the server accepted, however it arrives", async () => {
    const user = userEvent.setup();
    const landedByPoll = view({
      state_version: 20,
      current_turn_seat_index: 1,
      seconds_remaining: null,
      legal_commands: [],
      public_state: publicState({
        current_seat: 1,
        rosters: [
          roster(0, {
            SG: MANU_SG,
            // THE PLAYER'S OWN PICK, accepted by the server -- `resolution`
            // says so -- but delivered on a POLL because the command's own
            // response was lost. The old rule inferred "timeout" from that.
            PF: { ...card("tim-duncan", "Tim Duncan", "PF", ["PF", "C"]), resolution: "action" },
          }),
          roster(1),
          roster(2),
        ],
      }),
    });
    getMatch.mockImplementation(async () => landedByPoll);
    submitCommand.mockImplementation(async () => {
      throw new Error("dropped");
    });

    render(<ThreeManWeaveGame initialMatch={view()} />);
    await user.click(screen.getByTestId("tmw-candidate-tim-duncan"));
    const confirm = await screen.findByTestId("tmw-confirm-pick");
    await user.click(confirm);

    await waitFor(() => expect(screen.getByTestId("tmw-moment")).toBeInTheDocument(), {
      timeout: 8000,
    });
    const moment = screen.getByTestId("tmw-moment");
    expect(moment).toHaveTextContent("Tim Duncan → PF");
    expect(moment).toHaveAttribute("data-kind", "pick");
    expect(moment).not.toHaveTextContent(/time ran out/i);
  }, 20_000);

  it("IS shown when the server records the timeout fallback as the chooser", async () => {
    const timedOut = view({
      state_version: 21,
      current_turn_seat_index: 1,
      seconds_remaining: null,
      legal_commands: [],
      public_state: publicState({
        current_seat: 1,
        rosters: [
          roster(0, {
            SG: MANU_SG,
            PF: { ...card("tim-duncan", "Tim Duncan", "PF", ["PF", "C"]), resolution: "timeout" },
          }),
          roster(1),
          roster(2),
        ],
      }),
    });
    getMatch.mockImplementation(async () => timedOut);

    render(<ThreeManWeaveGame initialMatch={view()} />);
    await waitFor(() => expect(screen.getByTestId("tmw-moment")).toBeInTheDocument(), {
      timeout: 8000,
    });
    const moment = screen.getByTestId("tmw-moment");
    expect(moment).toHaveAttribute("data-kind", "timeout");
    expect(moment).toHaveTextContent(/time ran out/i);
  }, 20_000);
});
