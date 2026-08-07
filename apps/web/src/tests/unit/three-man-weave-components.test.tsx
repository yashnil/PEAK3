/**
 * Three-Man Weave component tests.
 *
 * WHAT IS ASSERTED HERE IS PRODUCT RULES, NOT RENDERING. Each block below
 * corresponds to a rule the mode would be wrong without: that a candidate
 * carries no score, that a disabled candidate says why, that all three teams
 * are on screen at once, that the result publishes no projected record.
 *
 * THE HEADLINE CONTRACT IN THIS FILE is the one in `ThreeManWeaveGame`: the
 * round-opening ceremony may never overlap a running human decision window.
 * That is the reveal/clock race SHARED-01 forbids and it is asserted directly,
 * from the server's own turn state, rather than trusted to a timer.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SeatCourt from "@/components/three-man-weave/SeatCourt";
import RosterBoard from "@/components/three-man-weave/RosterBoard";
import PodiumReceipt from "@/components/three-man-weave/PodiumReceipt";
import PickOverlay from "@/components/three-man-weave/PickOverlay";
import IdentityLockPanel from "@/components/three-man-weave/IdentityLockPanel";
import TurnStatus from "@/components/three-man-weave/TurnStatus";
import WeaveSpinner from "@/components/three-man-weave/WeaveSpinner";
import ThreeManWeaveGame from "@/components/three-man-weave/ThreeManWeaveGame";
import type { TmwCandidate } from "@/lib/three-man-weave-state";
import type {
  ArenaResultView,
  ArenaSeatPublic,
  TmwMatchView,
  TmwPick,
  TmwPublicState,
  TmwRoll,
  TmwRoster,
} from "@/types/three-man-weave";
import {
  TMW_REVEAL_SECONDS,
  TMW_TURN_PHASE_PICK,
  TMW_TURN_PHASE_REVEAL,
} from "@/types/three-man-weave";

/** Installs a `matchMedia` stub whose `(prefers-reduced-motion: reduce)` answer
 * is `reduced`. jsdom has no `matchMedia` at all, so without this every
 * component under test reads the hook's "unavailable" fallback of `false`. */
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

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

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
  commandIdempotencyKey: () => "idem",
  getMatch: (...args: unknown[]) => getMatch(...args),
  getMatchResults: (...args: unknown[]) => getMatchResults(...args),
  submitCommand: (...args: unknown[]) => submitCommand(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function pick(overrides: Partial<TmwPick> = {}): TmwPick {
  return {
    player_slug: "kawhi-leonard",
    player_name: "Kawhi Leonard",
    positions: ["SF", "PF"],
    eligibility: {
      franchise_id: "TOR",
      franchise_display_name: "Toronto Raptors",
      decade: "2010s",
      seasons: [
        { season: "2018-19", team_code: "TOR", games_played: 60, via: "direct_team_season" },
      ],
    },
    scoring_card: {
      season: "2018-19",
      team_id: "TOR",
      team_name: "Toronto Raptors",
      prime_score: 84.0,
      score_source: "exact_team_stint",
      is_multi_team_season: false,
      formula_version: "peak3_v1",
    },
    seat_index: 0,
    round_number: 1,
    slot_type: "SF",
    franchise_id: "TOR",
    decade: "2010s",
    ...overrides,
  };
}

function roster(seatIndex: number, slots: Record<string, TmwPick | null> = {}): TmwRoster {
  return {
    seat_index: seatIndex,
    slots: { PG: null, SG: null, SF: null, PF: null, C: null, bench_1: null, ...slots },
    complete: false,
  };
}

const SEATS: ArenaSeatPublic[] = [
  { seat_index: 0, display_name: "You", is_bot: false, status: "active", bot_rating: null },
  { seat_index: 1, display_name: "Floor General", is_bot: true, status: "active", bot_rating: 1100 },
  { seat_index: 2, display_name: "Board Man", is_bot: true, status: "active", bot_rating: 1100 },
];

const ROLL: TmwRoll = {
  round_number: 1,
  roll_id: "tor-2010s",
  franchise_id: "TOR",
  franchise_display_name: "Toronto Raptors",
  decade: "2010s",
  eligible_slugs: ["kawhi-leonard", "kyle-lowry"],
  candidates: [
    {
      player_slug: "kawhi-leonard",
      player_name: "Kawhi Leonard",
      positions: ["SF", "PF"],
      eligibility: {
        franchise_id: "TOR",
        franchise_display_name: "Toronto Raptors",
        decade: "2010s",
        seasons: [
          { season: "2018-19", team_code: "TOR", games_played: 60, via: "direct_team_season" },
        ],
      },
    },
    {
      player_slug: "kyle-lowry",
      player_name: "Kyle Lowry",
      positions: ["PG"],
      eligibility: {
        franchise_id: "TOR",
        franchise_display_name: "Toronto Raptors",
        decade: "2010s",
        seasons: [
          { season: "2015-16", team_code: "TOR", games_played: 77, via: "direct_team_season" },
        ],
      },
    },
  ],
};

function candidate(
  slug: string,
  overrides: Partial<TmwCandidate> = {},
): TmwCandidate {
  const base = ROLL.candidates.find((entry) => entry.player_slug === slug)!;
  return {
    ...base,
    fit: {
      player_slug: slug,
      state: "fits_now",
      direct_slots: ["SF"],
      plan: null,
      moves: [],
      reason: null,
    },
    selectable: true,
    ...overrides,
  };
}

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
    used_roll_ids: ["tor-2010s"],
    current_roll: ROLL,
    current_edge: {
      is_live: true,
      compared_after_picks: 1,
      seats: { "0": "leading", "1": "close_behind", "2": "needs_a_response" },
    },
    ...overrides,
  };
}

function matchView(overrides: Partial<TmwMatchView> = {}): TmwMatchView {
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
        "kawhi-leonard": {
          player_slug: "kawhi-leonard",
          state: "fits_now",
          direct_slots: ["SF"],
          plan: null,
          moves: [],
          reason: null,
        },
      },
    },
    legal_commands: ["tmw_pick", "tmw_rearrange"],
    current_turn_seat_index: 0,
    seconds_remaining: 45,
    turn_phase: TMW_TURN_PHASE_PICK,
    latest_event_seq: 3,
    room_code: null,
    ...overrides,
  };
}

/**
 * THE MATCH AS THE SERVER SENDS IT DURING THE CEREMONY, field for field.
 *
 * Every one of these is what `_build_view` actually publishes while the reveal
 * turn is open, and each is load-bearing:
 *
 *   * `turn_phase: "reveal"` — the only thing the room switches on;
 *   * `current_turn_seat_index: null` — the ceremony belongs to no seat;
 *   * `seconds_remaining` — published to EVERY seat when a turn names none, so
 *     all three participants count the same beat down;
 *   * `legal_commands` still containing `tmw_pick` — `project` derives it from
 *     the snapshot's `current_seat`, which already names the seat that picks
 *     next. A room that trusted `legal_commands` alone would open the pick
 *     panel over the ceremony, which is the regression these tests hold shut.
 */
function ceremonyView(overrides: Partial<TmwMatchView> = {}): TmwMatchView {
  return matchView({
    turn_phase: TMW_TURN_PHASE_REVEAL,
    current_turn_seat_index: null,
    seconds_remaining: TMW_REVEAL_SECONDS,
    legal_commands: ["tmw_pick", "tmw_rearrange"],
    ...overrides,
  });
}

function result(overrides: Partial<ArenaResultView> = {}): ArenaResultView {
  return {
    seat_index: 0,
    display_name: "You",
    placement: 1,
    score: 72.4,
    outcome: "win",
    was_bot: false,
    detail: {
      score_status: "complete",
      lineup_score: 72.4,
      mean_season_score: 81.9,
      fit_components: {
        talent_core: 70,
        bench_strength: 55,
        positional_fit: 100,
        creation_coverage: 80,
        scoring_coverage: 80,
        postseason_pedigree: 80,
        team_context_depth: 80,
      },
      best_pick: "Kawhi Leonard",
      decisive_pick: {
        slot_type: "SF",
        player_slug: "kawhi-leonard",
        player_name: "Kawhi Leonard",
        season: "2018-19",
        team_id: "TOR",
        round_number: 1,
        lineup_quality_drop: 4.12,
      },
      tmw_adapter_version: "tmw_six_player_adapter_v2",
      lineup_model_version: "perfect_season_lineup_fit_v2",
      simulator_version: "perfect_season_simulator_v1",
      formula_version: "peak3_v1",
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// THE REVEAL/CLOCK RACE (SHARED-01, TMW-06)
// ---------------------------------------------------------------------------

describe("the ceremony is the server's reveal phase, and nothing else", () => {
  beforeEach(() => {
    mockMatchMedia(false);
    getMatch.mockReset();
    getMatchResults.mockReset();
    submitCommand.mockReset();
    getMatch.mockImplementation(async () => matchView());
    getMatchResults.mockResolvedValue({ results: [] });
  });

  it("mounts the ceremony on a round the HUMAN leads, and holds the pick panel shut", () => {
    // THE REGRESSION THIS EXISTS TO PREVENT, IN BOTH ITS FORMS.
    //
    // First form: the ceremony was a 2270ms client `setTimeout` gating the pick
    // overlay while the server's 45-second deadline -- stamped when the turn
    // opened -- was already running, so a player leading a round lost the whole
    // ceremony off a clock counting down behind an overlay that would not open.
    //
    // Second form, the workaround: the room refused to mount the ceremony at
    // all when `!yourTurn` was false, which removed the race by removing the
    // product requirement. On every round the human led, there was no reveal.
    //
    // Neither is possible now. The reveal is a server turn; the room shows it
    // whenever the server says it is open, and the pick panel is shut for
    // exactly as long -- even though `legal_commands` already advertises
    // `tmw_pick`, because the snapshot's `current_seat` names this seat.
    render(<ThreeManWeaveGame initialMatch={ceremonyView({ your_seat_index: 0 })} />);

    expect(screen.getByTestId("tmw-ceremony-scrim")).toBeInTheDocument();
    expect(screen.getByTestId("tmw-roll")).toBeInTheDocument();
    expect(screen.queryByTestId("tmw-pick-overlay")).toBeNull();
    expect(screen.getByTestId("tmw-room")).toHaveAttribute("data-turn-phase", "reveal");
  });

  it("opens the pick panel only once the server's phase flips to pick", () => {
    const { rerender } = render(
      <ThreeManWeaveGame initialMatch={ceremonyView({ your_seat_index: 0 })} />,
    );
    expect(screen.queryByTestId("tmw-pick-overlay")).toBeNull();

    // The same match, one phase later: the sweep ended the ceremony and the
    // mode opened the pick turn with a FULL window measured from that instant.
    rerender(
      <ThreeManWeaveGame
        key="pick"
        initialMatch={matchView({
          turn_phase: TMW_TURN_PHASE_PICK,
          current_turn_seat_index: 0,
          seconds_remaining: 45,
        })}
      />,
    );
    expect(screen.queryByTestId("tmw-ceremony-scrim")).toBeNull();
    expect(screen.getByTestId("tmw-pick-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("tmw-overlay-roll")).toHaveTextContent("Toronto Raptors");
    expect(screen.getByTestId("tmw-overlay-roll")).toHaveTextContent("2010s");
  });

  it("plays the same ceremony on a round a bot leads", () => {
    // Identical assertions to the human-led case, deliberately: the whole point
    // of moving the reveal server-side is that the two are the same event.
    render(
      <ThreeManWeaveGame
        initialMatch={ceremonyView({
          public_state: publicState({ current_seat: 1 }),
        })}
      />,
    );
    expect(screen.getByTestId("tmw-ceremony-scrim")).toBeInTheDocument();
    expect(screen.getByTestId("tmw-roll")).toBeInTheDocument();
    expect(screen.queryByTestId("tmw-pick-overlay")).toBeNull();
  });

  it("resumes a reload mid-ceremony where the server says it is, not from the start", () => {
    // A reload is a fresh mount with whatever `seconds_remaining` the server
    // sends. With 0.3s of a 3.2s window left the ceremony is nearly over, so it
    // must render RESOLVED -- not replay the reel it already finished, and not
    // vanish either.
    const nearlyDone = render(
      <ThreeManWeaveGame initialMatch={ceremonyView({ seconds_remaining: 0.3 })} />,
    );
    expect(nearlyDone.getByTestId("tmw-roll")).toHaveAttribute("data-revealed", "true");
    expect(nearlyDone.queryByTestId("tmw-pick-overlay")).toBeNull();
    nearlyDone.unmount();

    // ...whereas a match that has only just opened the reveal is at its start.
    const justOpened = render(<ThreeManWeaveGame initialMatch={ceremonyView()} />);
    expect(justOpened.getByTestId("tmw-roll")).toHaveAttribute("data-revealed", "false");
  });

  it("has exactly one turn-status region and none of the three it replaced", () => {
    // TMW-07 and TMW-08: the spinner banner, the "X is selecting" band, the
    // "X is scouting / X drafted" tray and the eighteen-chip snake strip were
    // four surfaces describing one turn.
    render(<ThreeManWeaveGame initialMatch={matchView({ current_turn_seat_index: 1 })} />);
    expect(screen.getAllByTestId("tmw-turnbar")).toHaveLength(1);
    expect(screen.queryByTestId("tmw-draft-order")).toBeNull();
    expect(screen.queryByTestId("tmw-bot-reveal")).toBeNull();
  });

  it("never renders the duplicate final-rosters disclosure on the result", async () => {
    getMatchResults.mockResolvedValue({ results: [result()] });
    render(
      <ThreeManWeaveGame
        initialMatch={matchView({
          status: "completed",
          current_turn_seat_index: null,
          seconds_remaining: null,
          public_state: publicState({ is_complete: true }),
        })}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("tmw-podium")).toBeInTheDocument());
    // TMW-14: the rosters ARE the ranking cards now, so a second collapsed copy
    // of all three courts under the podium is duplication, not disclosure.
    expect(screen.queryByTestId("tmw-final-courts-toggle")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The three-team board
// ---------------------------------------------------------------------------

describe("RosterBoard", () => {
  it("renders all three teams at once, not one at a time", () => {
    render(
      <RosterBoard
        state={publicState()}
        seats={SEATS}
        yourSeatIndex={0}
        currentTurnSeatIndex={0}
      />,
    );
    // Desktop grid AND the mobile tab panel both mount, so the visible seat
    // court appears twice for the active tab. What matters is that no seat is
    // missing.
    for (const index of [0, 1, 2]) {
      expect(screen.getAllByTestId(`tmw-seat-court-${index}`).length).toBeGreaterThan(0);
    }
  });

  it("offers every team as a tab on mobile, with its own count", () => {
    render(
      <RosterBoard
        state={publicState()}
        seats={SEATS}
        yourSeatIndex={0}
        currentTurnSeatIndex={0}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[1]).toHaveTextContent("Floor General");
  });

  it("marks the live edge as provisional rather than presenting a total", () => {
    render(
      <RosterBoard
        state={publicState()}
        seats={SEATS}
        yourSeatIndex={0}
        currentTurnSeatIndex={0}
      />,
    );
    expect(screen.getByTestId("tmw-edge-qualifier")).toHaveTextContent(
      /Live · compared after 1 pick each/,
    );
    expect(screen.getAllByTestId("tmw-seat-edge-0")[0]).toHaveTextContent("Leading");
  });

  // -- rearrangement during normal gameplay (TMW-10) -------------------------

  function boardWithRoster() {
    const onMove = vi.fn();
    const state = publicState({
      rosters: [
        roster(0, {
          SF: pick({ player_slug: "larry-bird", player_name: "Larry Bird", slot_type: "SF" }),
          PG: pick({
            player_slug: "kyle-lowry",
            player_name: "Kyle Lowry",
            positions: ["PG"],
            slot_type: "PG",
          }),
        }),
        roster(1),
        roster(2),
      ],
    });
    render(
      <RosterBoard
        state={state}
        seats={SEATS}
        yourSeatIndex={0}
        // NOT your turn: the whole point of TMW-10 is that roster management is
        // not locked behind the draft modal.
        currentTurnSeatIndex={1}
        onMove={onMove}
      />,
    );
    return { onMove };
  }

  it("moves a card to a legal slot between turns and commits a COMPLETE assignment", async () => {
    const { onMove } = boardWithRoster();
    const court = screen.getAllByTestId("tmw-seat-court-0")[0];
    await userEvent.click(within(court).getByTestId("tmw-slot-SF"));
    expect(within(court).getByTestId("tmw-slot-SF")).toHaveAttribute(
      "data-picked-up",
      "true",
    );
    // The bench accepts anyone, so it lights up.
    expect(within(court).getByTestId("tmw-slot-bench_1")).toHaveAttribute(
      "data-legal",
      "true",
    );
    await userEvent.click(within(court).getByTestId("tmw-slot-bench_1"));
    expect(onMove).toHaveBeenCalledWith({ PG: "kyle-lowry", bench_1: "larry-bird" });
  });

  it("refuses an illegal destination immediately, by player and by rule", async () => {
    const { onMove } = boardWithRoster();
    const court = screen.getAllByTestId("tmw-seat-court-0")[0];
    // Larry Bird plays SF/PF. Point guard is not a legal destination, and the
    // slot is still a real target so the refusal can be specific rather than a
    // dead click.
    await userEvent.click(within(court).getByTestId("tmw-slot-SF"));
    expect(within(court).getByTestId("tmw-slot-PG")).toHaveAttribute("data-legal", "false");
    await userEvent.click(within(court).getByTestId("tmw-slot-PG"));
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByTestId("tmw-move-notice")).toHaveTextContent(/Larry Bird/);
    expect(screen.getByTestId("tmw-move-notice")).toHaveTextContent(/SF \/ PF/);
  });

  it("cancels a selection with Escape", async () => {
    boardWithRoster();
    const court = screen.getAllByTestId("tmw-seat-court-0")[0];
    await userEvent.click(within(court).getByTestId("tmw-slot-SF"));
    await userEvent.keyboard("{Escape}");
    expect(within(court).getByTestId("tmw-slot-SF")).toHaveAttribute(
      "data-picked-up",
      "false",
    );
  });

  it("never makes an opponent's court interactive", () => {
    boardWithRoster();
    const theirs = screen.getAllByTestId("tmw-seat-court-1")[0];
    expect(theirs).toHaveAttribute("data-interactive", "false");
    expect(within(theirs).getByTestId("tmw-slot-SF").tagName).not.toBe("BUTTON");
  });
});

describe("SeatCourt", () => {
  it("names the seat, its occupant kind and its progress", () => {
    render(
      <SeatCourt
        roster={roster(1, { SF: pick({ seat_index: 1 }) })}
        seat={SEATS[1]}
        isYou={false}
        isOnTurn
        edge="close_behind"
      />,
    );
    const panel = screen.getByTestId("tmw-seat-court-1");
    expect(within(panel).getByRole("heading")).toHaveTextContent("Floor General");
    expect(within(panel).getByTestId("tmw-seat-progress-1")).toHaveTextContent("1/6");
    expect(within(panel).getByTestId("tmw-seat-onclock-1")).toBeInTheDocument();
  });

  it("gives every seat its own accent AND says which one is yours in words", () => {
    // TMW-09. All three seats used to be painted in the single brand gold and
    // told apart by a letter glyph, and `data-is-you` was emitted with zero CSS
    // attached. Colour is now a real signal -- and never the only one.
    const { rerender } = render(
      <SeatCourt roster={roster(0)} seat={SEATS[0]} isYou isOnTurn={false} />,
    );
    const yours = screen.getByTestId("tmw-seat-court-0");
    expect(yours).toHaveAttribute("data-seat-accent", "1");
    expect(yours).toHaveAttribute("data-is-you", "true");
    expect(yours).toHaveTextContent("You");

    rerender(
      <SeatCourt roster={roster(2)} seat={SEATS[2]} isYou={false} isOnTurn={false} />,
    );
    expect(screen.getByTestId("tmw-seat-court-2")).toHaveAttribute("data-seat-accent", "3");
  });

  it("shows a headshot, the scoring season and the score on a drafted card", () => {
    render(
      <SeatCourt roster={roster(0, { SF: pick() })} seat={SEATS[0]} isYou isOnTurn={false} />,
    );
    const slot = screen.getByTestId("tmw-slot-SF");
    // SHARED-03: the one shared avatar primitive, not a second image path.
    expect(within(slot).getByTestId("player-avatar")).toBeInTheDocument();
    expect(within(slot).getByTestId("tmw-slot-season-SF")).toHaveTextContent("2018-19 TOR");
    expect(slot).toHaveTextContent("84.0");
    // The position label is on the card, which is what makes a legal/illegal
    // rearrangement readable without opening anything.
    expect(slot).toHaveTextContent("SF / PF");
    // "via trade" appeared beside most stars and told a reader nothing they
    // could act on; the team and season already say where the card comes from.
    expect(slot).not.toHaveTextContent(/via trade/i);
  });

  it("is read-only unless it is your own court in a live match", () => {
    render(
      <SeatCourt roster={roster(0, { SF: pick() })} seat={SEATS[0]} isYou isOnTurn={false} />,
    );
    expect(screen.getByTestId("tmw-slot-SF").tagName).not.toBe("BUTTON");
  });

  it("marks exactly one roster as being on the clock", () => {
    const { rerender } = render(
      <SeatCourt roster={roster(0)} seat={SEATS[0]} isYou isOnTurn />,
    );
    expect(screen.getByTestId("tmw-seat-court-0")).toHaveAttribute("data-on-turn", "true");
    expect(screen.getByTestId("tmw-seat-onclock-0")).toBeInTheDocument();

    rerender(<SeatCourt roster={roster(0)} seat={SEATS[0]} isYou isOnTurn={false} />);
    expect(screen.getByTestId("tmw-seat-court-0")).toHaveAttribute("data-on-turn", "false");
    expect(screen.queryByTestId("tmw-seat-onclock-0")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The one turn-status surface
// ---------------------------------------------------------------------------

describe("TurnStatus", () => {
  function renderStatus(
    overrides: Partial<React.ComponentProps<typeof TurnStatus>> = {},
  ) {
    render(
      <TurnStatus
        state={publicState()}
        seats={SEATS}
        currentTurnSeatIndex={1}
        yourSeatIndex={0}
        complete={false}
        pickNumber={2}
        totalPicks={18}
        deadlineAt={null}
        turnSeconds={45}
        timeoutConsequence="Running out drafts a weaker legal fallback for you."
        {...overrides}
      />,
    );
  }

  it("carries everything the four deleted strips used to say, in one place", () => {
    renderStatus();
    // TMW-08: round, pick, the rolled constraint, the active seat, progress.
    expect(screen.getByTestId("tmw-turnbar-round")).toHaveTextContent("Round 1 of 6");
    expect(screen.getByTestId("tmw-turnbar-round")).toHaveTextContent("Pick 2 of 18");
    expect(screen.getByTestId("tmw-turnbar-roll")).toHaveTextContent("Toronto Raptors");
    expect(screen.getByTestId("tmw-turnbar-roll")).toHaveTextContent("2010s");
    expect(screen.getByTestId("tmw-turn-spotlight")).toHaveTextContent(
      "Floor General is on the clock",
    );
    expect(screen.getByTestId("tmw-turn-progress")).toHaveTextContent("0/6");
  });

  it("announces turn changes politely and never announces a ticking number", () => {
    renderStatus();
    expect(screen.getByTestId("tmw-turn-spotlight")).toHaveAttribute("aria-live", "polite");
    // The only live region in this surface is the headline.
    const regions = document.querySelectorAll(
      '[data-testid="tmw-turnbar"] [aria-live]',
    );
    expect(regions).toHaveLength(1);
  });

  it("shows a visible clock for a deliberating bot", async () => {
    // TMW-05: the bot's think time is now 4-10 seconds, longer than the client
    // poll interval, so the deliberation is genuinely observable. The API sends
    // no deadline for a seat that is not yours, so this clock counts UP rather
    // than inventing a countdown.
    renderStatus();
    await waitFor(() =>
      expect(screen.getByTestId("tmw-bot-clock")).toHaveTextContent(/Deliberating/),
    );
  });

  it("states what running out of time does, and never promises the best available", () => {
    renderStatus({
      currentTurnSeatIndex: 0,
      deadlineAt: performance.now() + 30_000,
    });
    const consequence = screen.getByTestId("tmw-turn-clock-consequence");
    expect(consequence).toHaveTextContent(/weaker legal fallback/i);
    expect(consequence.textContent).not.toMatch(/best available/i);
  });
});

// ---------------------------------------------------------------------------
// The pick surface
// ---------------------------------------------------------------------------

describe("PickOverlay", () => {
  function renderOverlay(overrides: Partial<React.ComponentProps<typeof PickOverlay>> = {}) {
    const onPick = vi.fn();
    const onMove = vi.fn();
    render(
      <PickOverlay
        open
        roll={ROLL}
        roundNumber={1}
        pickNumber={1}
        totalRounds={6}
        candidates={[
          candidate("kawhi-leonard"),
          candidate("kyle-lowry", {
            fit: {
              player_slug: "kyle-lowry",
              state: "fits_now",
              direct_slots: ["PG"],
              plan: null,
              moves: [],
              reason: null,
            },
          }),
        ]}
        roster={roster(0)}
        seats={SEATS}
        yourSeatIndex={0}
        deadlineAt={null}
        turnSeconds={45}
        busy={false}
        onPick={onPick}
        onMove={onMove}
        onClose={vi.fn()}
        {...overrides}
      />,
    );
    return { onPick, onMove };
  }

  it("shows no score for any candidate", () => {
    renderOverlay();
    const list = screen.getByTestId("tmw-candidate-list");
    // The card Kawhi would be scored on is 84.0. It must not be anywhere in
    // the pre-pick list, in any form.
    expect(list.textContent).not.toMatch(/84/);
    expect(screen.getByTestId("tmw-candidate-kawhi-leonard")).toHaveTextContent(
      "Toronto Raptors · 2018-19",
    );
  });

  it("puts the shared headshot primitive on every candidate row", () => {
    renderOverlay();
    const row = screen.getByTestId("tmw-candidate-kawhi-leonard");
    expect(within(row).getByTestId("player-avatar")).toBeInTheDocument();
  });

  it("states how many of the pool a filter is hiding", async () => {
    renderOverlay();
    expect(screen.getByTestId("tmw-pool-count")).toHaveTextContent(
      "Showing 2 of 2 eligible",
    );
    await userEvent.click(screen.getByTestId("tmw-filter-PG"));
    expect(screen.getByTestId("tmw-pool-count")).toHaveTextContent("1 hidden by filters");
  });

  it("searches by name and keeps the whole pool one clear away", async () => {
    renderOverlay();
    await userEvent.type(screen.getByTestId("tmw-pick-search"), "lowry");
    expect(screen.queryByTestId("tmw-candidate-kawhi-leonard")).toBeNull();
    await userEvent.clear(screen.getByTestId("tmw-pick-search"));
    expect(screen.getByTestId("tmw-candidate-kawhi-leonard")).toBeInTheDocument();
  });

  // -- the three genuinely different empty states (TMW-11) -------------------

  it("says a searched name is ALREADY DRAFTED, and by whom", async () => {
    // THE DENNIS RODMAN REPORT, as a test. He was never missing from the Spurs
    // pool; the lock is global, so a Rodman taken off an earlier roll is gone
    // from every later one. One sentence used to cover this case, the filter
    // case and genuine ineligibility alike.
    renderOverlay({
      lockedEntries: [
        {
          playerSlug: "dennis-rodman",
          playerName: "Dennis Rodman",
          seatIndex: 2,
          roundNumber: 2,
          franchiseDisplayName: "Detroit Pistons",
          decade: "1990s",
        },
      ],
    });
    await userEvent.type(screen.getByTestId("tmw-pick-search"), "rodman");
    const empty = screen.getByTestId("tmw-pool-empty-locked");
    expect(empty).toHaveTextContent("Dennis Rodman");
    expect(empty).toHaveTextContent("Board Man");
    expect(empty).toHaveTextContent("round 2");
  });

  it("says a position filter is what is hiding the pool, and offers to clear it", async () => {
    renderOverlay();
    await userEvent.type(screen.getByTestId("tmw-pick-search"), "kawhi");
    await userEvent.click(screen.getByTestId("tmw-filter-PG"));
    const empty = screen.getByTestId("tmw-pool-empty-filtered");
    expect(empty).toHaveTextContent(/position filter/i);
    await userEvent.click(within(empty).getByRole("button", { name: /clear filters/i }));
    expect(screen.getByTestId("tmw-candidate-kawhi-leonard")).toBeInTheDocument();
  });

  it("says a name is genuinely not eligible for THIS franchise and decade", async () => {
    renderOverlay();
    await userEvent.type(screen.getByTestId("tmw-pick-search"), "jordan");
    const empty = screen.getByTestId("tmw-pool-empty-ineligible");
    expect(empty).toHaveTextContent(/Toronto Raptors/);
    expect(empty).toHaveTextContent(/2010s/);
  });

  it("disables a candidate with no legal arrangement and says why", () => {
    renderOverlay({
      candidates: [
        candidate("kawhi-leonard", {
          selectable: false,
          fit: {
            player_slug: "kawhi-leonard",
            state: "no_legal_arrangement",
            direct_slots: [],
            plan: null,
            moves: [],
            reason: "Every slot they could play is filled.",
          },
        }),
      ],
    });
    const button = screen.getByTestId("tmw-candidate-kawhi-leonard");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("No legal arrangement");
    expect(button).toHaveTextContent("Every slot they could play is filled.");
  });

  it("explains a rearrangement and commits it with the pick", async () => {
    const { onPick } = renderOverlay({
      roster: roster(0, { SF: pick({ player_slug: "larry-bird", player_name: "Larry Bird" }) }),
      candidates: [
        candidate("kawhi-leonard", {
          fit: {
            player_slug: "kawhi-leonard",
            state: "fits_after_rearrangement",
            direct_slots: [],
            plan: { SF: "kawhi-leonard", bench_1: "larry-bird" },
            moves: [{ player_slug: "larry-bird", from_slot: "SF", to_slot: "bench_1" }],
            reason: null,
          },
        }),
      ],
    });
    await userEvent.click(screen.getByTestId("tmw-candidate-kawhi-leonard"));
    expect(screen.getByTestId("tmw-rearrange-note")).toHaveTextContent(
      /Kawhi Leonard → Small forward/,
    );
    expect(screen.getByTestId("tmw-rearrange-note")).toHaveTextContent(
      /Larry Bird: Small forward → Bench/,
    );
    expect(screen.getByTestId("tmw-vacating-SF")).toHaveTextContent("Larry Bird → BN");
    await userEvent.click(screen.getByTestId("tmw-confirm-pick"));
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ player_slug: "kawhi-leonard" }),
      "SF",
    );
  });

  it("shows the clock inside the overlay, not only on the board", () => {
    renderOverlay({ deadlineAt: performance.now() + 40_000 });
    expect(screen.getByTestId("tmw-overlay-clock-value")).toHaveTextContent("40");
  });

  it("locks into a resolution state at zero rather than staying live", async () => {
    // `ArenaTimer` has always supported `onExpire` and neither of this mode's
    // timers passed it. At 0s the panel stayed fully interactive, and a click
    // then landed outside the server's two-second grace and came back as
    // `stale_state_version` -- which reads as the game refusing a legal pick.
    const { onPick } = renderOverlay({ deadlineAt: performance.now() - 10 });
    await waitFor(() =>
      expect(screen.getByTestId("tmw-overlay-expired")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("tmw-overlay-expired")).toHaveTextContent(
      "Time expired — assigning a legal fallback.",
    );
    expect(screen.getByTestId("tmw-pick-overlay")).toHaveAttribute("data-expired", "true");
    expect(screen.getByTestId("tmw-pick-search")).toBeDisabled();
    expect(screen.getByTestId("tmw-candidate-kawhi-leonard")).toBeDisabled();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("never promises the best available player on timeout", () => {
    renderOverlay({ deadlineAt: performance.now() + 20_000 });
    const consequence = screen.getByTestId("tmw-overlay-clock-consequence");
    expect(consequence.textContent).not.toMatch(/best available/i);
    expect(consequence).toHaveTextContent(/weaker legal fallback/i);
  });

  // -- direct placement, which is the whole of the rescue ------------------

  it("places by CLICKING A ROSTER SLOT, not through a dropdown", async () => {
    const { onPick } = renderOverlay({
      candidates: [
        candidate("kawhi-leonard", {
          fit: {
            player_slug: "kawhi-leonard",
            state: "fits_now",
            direct_slots: ["SF", "PF"],
            plan: null,
            moves: [],
            reason: null,
          },
        }),
      ],
    });
    await userEvent.click(screen.getByTestId("tmw-candidate-kawhi-leonard"));
    const sf = screen.getByTestId("tmw-place-SF");
    expect(sf.tagName).toBe("BUTTON");
    expect(sf).toHaveAttribute("data-legal", "true");
    expect(screen.getByTestId("tmw-place-PG").tagName).not.toBe("BUTTON");
    expect(screen.getByTestId("tmw-place-PG")).toHaveAttribute("data-legal", "false");

    await userEvent.click(screen.getByTestId("tmw-place-PF"));
    expect(screen.getByTestId("tmw-staged-PF")).toHaveTextContent("Kawhi Leonard");
    expect(screen.getByTestId("tmw-confirm-pick")).toHaveTextContent(
      "Draft Kawhi Leonard at Power forward",
    );
    await userEvent.click(screen.getByTestId("tmw-confirm-pick"));
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ player_slug: "kawhi-leonard" }),
      "PF",
    );
  });

  it("keeps a labelled select as an accessible fallback, never as the default", async () => {
    renderOverlay({
      candidates: [
        candidate("kawhi-leonard", {
          fit: {
            player_slug: "kawhi-leonard",
            state: "fits_now",
            direct_slots: ["SF", "PF"],
            plan: null,
            moves: [],
            reason: null,
          },
        }),
      ],
    });
    await userEvent.click(screen.getByTestId("tmw-candidate-kawhi-leonard"));
    const select = screen.getByTestId("tmw-place-select");
    expect(select.closest("label")).toHaveTextContent(/Or choose a slot from a list/);
  });

  it("stages the only legal slot immediately, so one candidate is one click", async () => {
    renderOverlay({
      candidates: [
        candidate("kawhi-leonard", {
          fit: {
            player_slug: "kawhi-leonard",
            state: "fits_now",
            direct_slots: ["SF"],
            plan: null,
            moves: [],
            reason: null,
          },
        }),
      ],
    });
    await userEvent.click(screen.getByTestId("tmw-candidate-kawhi-leonard"));
    expect(screen.getByTestId("tmw-staged-SF")).toBeInTheDocument();
    expect(screen.queryByTestId("tmw-place-select")).toBeNull();
    expect(screen.getByTestId("tmw-confirm-pick")).toBeEnabled();
  });

  it("uses real buttons, not text, for both actions", async () => {
    renderOverlay();
    await userEvent.click(screen.getByTestId("tmw-candidate-kawhi-leonard"));
    expect(screen.getByTestId("tmw-confirm-pick")).toHaveClass("btn-primary");
    expect(screen.getByTestId("tmw-cancel-pick")).toHaveClass("btn-secondary");
    expect(screen.getByTestId("tmw-cancel-pick")).toHaveTextContent("Cancel selection");
  });

  // -- roster movement from the same surface --------------------------------

  it("moves an existing roster card by clicking it and then a destination", async () => {
    const { onMove } = renderOverlay({
      roster: roster(0, {
        SF: pick({ player_slug: "larry-bird", player_name: "Larry Bird", slot_type: "SF" }),
      }),
    });
    await userEvent.click(screen.getByTestId("tmw-place-SF"));
    expect(screen.getByTestId("tmw-pick-overlay")).toHaveAttribute("data-mode", "moving");
    expect(screen.getByTestId("tmw-place-SF")).toHaveAttribute("data-source", "true");

    await userEvent.click(screen.getByTestId("tmw-place-bench_1"));
    await userEvent.click(screen.getByTestId("tmw-move-confirm"));
    // A COMPLETE final arrangement, which is the only shape the server accepts.
    expect(onMove).toHaveBeenCalledWith({ bench_1: "larry-bird" });
  });

  it("swaps two placed cards atomically, and only when BOTH halves are legal", async () => {
    const { onMove } = renderOverlay({
      roster: roster(0, {
        SF: pick({ player_slug: "larry-bird", player_name: "Larry Bird", slot_type: "SF" }),
        bench_1: pick({
          player_slug: "kevin-mchale",
          player_name: "Kevin McHale",
          slot_type: "bench_1",
        }),
      }),
    });
    await userEvent.click(screen.getByTestId("tmw-place-SF"));
    await userEvent.click(screen.getByTestId("tmw-place-bench_1"));
    await userEvent.click(screen.getByTestId("tmw-move-confirm"));
    expect(onMove).toHaveBeenCalledWith({
      SF: "kevin-mchale",
      bench_1: "larry-bird",
    });
  });

  it("does not offer a swap that would leave the displaced player somewhere illegal", async () => {
    // THE WESTBROOK-AT-SF SHAPE. The previous destination filter checked only
    // the player being moved, so a starter slot whose occupant could not play
    // the SOURCE slot was offered as legal and refused by the server on commit.
    renderOverlay({
      roster: roster(0, {
        SF: pick({ player_slug: "larry-bird", player_name: "Larry Bird", slot_type: "SF" }),
        PG: pick({
          player_slug: "kyle-lowry",
          player_name: "Kyle Lowry",
          positions: ["PG"],
          slot_type: "PG",
        }),
      }),
    });
    // Bird could physically occupy nothing at PG, and Lowry could not take SF,
    // so neither direction of that swap is offered.
    await userEvent.click(screen.getByTestId("tmw-place-PG"));
    expect(screen.getByTestId("tmw-place-SF")).toHaveAttribute("data-legal", "false");
  });

  it("cancels a move without touching the roster", async () => {
    const { onMove } = renderOverlay({
      roster: roster(0, {
        SF: pick({ player_slug: "larry-bird", player_name: "Larry Bird", slot_type: "SF" }),
      }),
    });
    await userEvent.click(screen.getByTestId("tmw-place-SF"));
    await userEvent.click(screen.getByTestId("tmw-move-cancel"));
    expect(screen.getByTestId("tmw-pick-overlay")).toHaveAttribute("data-mode", "idle");
    expect(onMove).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The finish
// ---------------------------------------------------------------------------

describe("PodiumReceipt", () => {
  function renderResult(
    overrides: Partial<React.ComponentProps<typeof PodiumReceipt>> = {},
  ) {
    render(
      <PodiumReceipt
        results={[result()]}
        rosters={[roster(0, { SF: pick() })]}
        yourSeatIndex={0}
        seed="m-1"
        onPlayAgain={vi.fn()}
        {...overrides}
      />,
    );
  }

  it("opens on a placement badge and a response line, not on a report", () => {
    renderResult();
    // TMW-14 rejects the robotic "You finished 3rd" and the analytics paragraph
    // that used to sit directly under the headline.
    expect(screen.getByTestId("tmw-your-placement")).toHaveTextContent("1st");
    expect(screen.getByTestId("tmw-result-line").textContent).toBeTruthy();
    const podium = screen.getByTestId("tmw-podium");
    expect(podium).toHaveAttribute("data-band", "won_clear");
  });

  it("keeps the response line deterministic for one completed match", () => {
    renderResult();
    const first = screen.getByTestId("tmw-result-line").textContent;
    screen.getByTestId("tmw-result-line").remove();
    renderResult();
    expect(screen.getByTestId("tmw-result-line").textContent).toBe(first);
  });

  it("reads a near miss differently from a rout", () => {
    const rosters = [roster(0, { SF: pick() }), roster(1)];
    render(
      <PodiumReceipt
        results={[
          result({ seat_index: 0, placement: 2, score: 70.5, outcome: "loss" }),
          result({ seat_index: 1, display_name: "Floor General", placement: 1, score: 71.0 }),
        ]}
        rosters={rosters}
        yourSeatIndex={0}
        seed="m-2"
        onPlayAgain={vi.fn()}
      />,
    );
    expect(screen.getByTestId("tmw-podium")).toHaveAttribute("data-band", "close_loss");
  });

  it("shows every team's COMPLETE final roster on its ranking card", () => {
    renderResult();
    const card = screen.getByTestId("tmw-result-0");
    // Six slots, all of them, with the headshot primitive on the filled one.
    expect(card.querySelectorAll(".tmw-result-slot")).toHaveLength(6);
    expect(within(card).getByText("Kawhi Leonard")).toBeInTheDocument();
    expect(within(card).getByText("2018-19 Toronto Raptors")).toBeInTheDocument();
    expect(within(card).getAllByTestId("player-avatar").length).toBeGreaterThan(0);
  });

  it("moves the methodology behind a Full receipt disclosure", async () => {
    renderResult();
    const receipt = screen.getByTestId("tmw-receipt");
    // THE MODULE RULE STILL HOLDS -- the basis is named where the winner is
    // declared -- but it is no longer the second line of the celebration.
    expect(receipt).toContainElement(screen.getByTestId("tmw-ranking-basis"));
    expect(screen.getByTestId("tmw-ranking-basis")).toHaveTextContent(
      /lineup-quality index/i,
    );
    expect(screen.getByTestId("tmw-ranking-basis")).toHaveTextContent(/Not an average/i);
    // And so do the three explanations TMW-14 removed from the primary screen.
    expect(receipt).toContainElement(screen.getByTestId("tmw-decisive-0"));
    expect(receipt).toContainElement(screen.getByTestId("tmw-fit-0"));
    expect(receipt).toContainElement(screen.getByTestId("tmw-mean-0"));
    expect(screen.getByTestId("tmw-receipt-toggle")).toBeInTheDocument();
  });

  it("publishes no projected record anywhere", () => {
    renderResult();
    const panel = screen.getByTestId("tmw-podium");
    expect(panel.textContent).not.toMatch(/\b\d{2}-\d{2}\s*projected/i);
    expect(panel.textContent).not.toMatch(/projected record/i);
  });

  it("celebrates a win and offers both exits", async () => {
    const onPlayAgain = vi.fn();
    renderResult({ onPlayAgain });
    expect(screen.getByTestId("tmw-celebration")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("tmw-back-to-arena")).toHaveAttribute("href", "/arena");
    await userEvent.click(screen.getByTestId("tmw-play-again"));
    expect(onPlayAgain).toHaveBeenCalled();
  });

  it("does not celebrate a loss, and does not punish it either", () => {
    renderResult({ results: [result({ placement: 3, outcome: "loss" })] });
    expect(screen.getByTestId("tmw-celebration")).toHaveAttribute("data-active", "false");
    expect(screen.getByTestId("tmw-your-placement")).toHaveTextContent("3rd");
  });

  it("shows an unscoreable roster as a real state, never as zero", () => {
    renderResult({
      results: [
        result({
          score: 0,
          detail: { ...result().detail, score_status: "incomplete", lineup_score: null },
        }),
      ],
      rosters: [roster(0)],
    });
    expect(screen.getByTestId("tmw-result-0")).toHaveTextContent("Not ranked");
  });
});

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

describe("WeaveSpinner", () => {
  beforeEach(() => {
    mockMatchMedia(false);
  });

  it("carries the server's answer from the first frame", () => {
    render(
      <WeaveSpinner
        roll={ROLL}
        roundNumber={1}
        totalRounds={6}
        revealSeconds={TMW_REVEAL_SECONDS}
      />,
    );
    // The reel cannot resolve to anything else: the value is decided before
    // the animation starts and is exposed as data from t=0.
    expect(screen.getByTestId("tmw-roll-franchise")).toHaveAttribute(
      "data-final-value",
      "Toronto Raptors",
    );
    expect(screen.getByTestId("tmw-roll-decade")).toHaveAttribute(
      "data-final-value",
      "2010s",
    );
  });

  it("renders nothing at all when the room has closed it", () => {
    // The room closes it whenever the server's turn phase is not `reveal`, so
    // "closed" has to mean absent, not hidden.
    const { container } = render(
      <WeaveSpinner
        open={false}
        roll={ROLL}
        roundNumber={1}
        totalRounds={6}
        revealSeconds={TMW_REVEAL_SECONDS}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("opens round one on the matchup: the three competitors and the objective", () => {
    render(
      <WeaveSpinner
        roll={ROLL}
        roundNumber={1}
        totalRounds={6}
        seats={SEATS}
        yourSeatIndex={0}
        showIntro
        revealSeconds={TMW_REVEAL_SECONDS}
      />,
    );
    expect(screen.getByTestId("tmw-intro")).toBeInTheDocument();
    expect(screen.getByTestId("tmw-intro-seat-0")).toHaveAttribute("data-is-you", "true");
    expect(screen.getByTestId("tmw-intro-seat-1")).toHaveTextContent("Floor General");
    expect(screen.getByTestId("tmw-intro-objective")).toHaveTextContent(
      /6 franchise × decade rounds/i,
    );
  });

  it("says it is rolling when there is no roll yet", () => {
    render(
      <WeaveSpinner
        roll={null}
        roundNumber={null}
        totalRounds={6}
        revealSeconds={TMW_REVEAL_SECONDS}
      />,
    );
    expect(screen.getByTestId("tmw-roll-rolling")).toBeInTheDocument();
  });

  it("fits its whole sequence inside the server's window", () => {
    // THE CEREMONY'S LENGTH IS NOT THIS COMPONENT'S TO CHOOSE any more. Every
    // stage boundary is a fraction of the window the server published, so the
    // reel cannot still be spinning when the phase ends -- which is what would
    // put a live pick panel on top of a moving wheel.
    vi.useFakeTimers();
    try {
      render(
        <WeaveSpinner
          roll={ROLL}
          roundNumber={1}
          totalRounds={6}
          revealSeconds={TMW_REVEAL_SECONDS}
        />,
      );
      expect(screen.getByTestId("tmw-roll")).toHaveAttribute("data-revealed", "false");
      // One millisecond before the window closes it has resolved...
      act(() => {
        vi.advanceTimersByTime(TMW_REVEAL_SECONDS * 1000 - 1);
      });
      expect(screen.getByTestId("tmw-roll")).toHaveAttribute("data-revealed", "true");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the SAME beat under prefers-reduced-motion, and drops only the movement", () => {
    // REDUCED MOTION IS NOT A SHORTER CEREMONY. The pair still has to be READ,
    // and the phase is the server's either way -- cutting the hold would give a
    // reduced-motion player less time to take in the same information. So the
    // schedule is identical and only the travel is removed: the reels show
    // their value instead of spinning to it.
    vi.useFakeTimers();
    mockMatchMedia(true);
    try {
      render(
        <WeaveSpinner
          roll={ROLL}
          roundNumber={1}
          totalRounds={6}
          revealSeconds={TMW_REVEAL_SECONDS}
        />,
      );
      const section = screen.getByTestId("tmw-roll");
      expect(section).toHaveAttribute("data-reduced-motion", "true");
      // No strip to travel -- the answer is simply there.
      expect(screen.getByTestId("tmw-roll-franchise")).toHaveAttribute(
        "data-stage",
        "reduced",
      );
      expect(screen.getByTestId("tmw-roll-franchise")).toHaveTextContent(
        "Toronto Raptors",
      );
      // ...and the beat is NOT collapsed: a second in, it has not resolved.
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(section).toHaveAttribute("data-revealed", "false");
      act(() => {
        vi.advanceTimersByTime(TMW_REVEAL_SECONDS * 1000);
      });
      expect(section).toHaveAttribute("data-revealed", "true");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("IdentityLockPanel", () => {
  function entries(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      playerSlug: `player-${index}`,
      playerName: `Player ${index}`,
      seatIndex: index % 3,
      roundNumber: index + 1,
      franchiseDisplayName: "Toronto Raptors",
      decade: "2010s",
    }));
  }

  it("lists who is off the board and to whom", () => {
    render(
      <IdentityLockPanel
        entries={[
          {
            playerSlug: "kawhi-leonard",
            playerName: "Kawhi Leonard",
            seatIndex: 1,
            roundNumber: 1,
            franchiseDisplayName: "Toronto Raptors",
            decade: "2010s",
          },
        ]}
        seats={SEATS}
      />,
    );
    expect(screen.getByTestId("tmw-lock-count")).toHaveTextContent("1");
    expect(screen.getByTestId("tmw-identity-lock")).toHaveTextContent("Floor General");
  });

  it("keeps the live rail compact and moves the rest behind a disclosure", () => {
    // TMW-12: the ledger used to grow to eighteen rows and sat permanently
    // between the board and the pick surface.
    render(<IdentityLockPanel entries={entries(9)} seats={SEATS} />);
    expect(screen.getByTestId("tmw-lock-list").querySelectorAll("li")).toHaveLength(4);
    expect(screen.getByTestId("tmw-lock-history-toggle")).toHaveTextContent("(9)");
    expect(screen.getByTestId("tmw-lock-history").querySelectorAll("li")).toHaveLength(9);
  });

  it("offers no disclosure at all while the rail still holds everything", () => {
    render(<IdentityLockPanel entries={entries(3)} seats={SEATS} />);
    expect(screen.queryByTestId("tmw-lock-history-toggle")).toBeNull();
  });
});
