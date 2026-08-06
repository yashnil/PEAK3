/**
 * Three-Man Weave component tests.
 *
 * WHAT IS ASSERTED HERE IS PRODUCT RULES, NOT RENDERING. Each block below
 * corresponds to a rule the mode would be wrong without: that a candidate
 * carries no score, that a disabled candidate says why, that all three rosters
 * are on screen at once, that the result declares its basis and publishes no
 * projected record. A test that only checked "the component rendered" would
 * pass for every version of these components including the broken ones.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SeatCourt from "@/components/three-man-weave/SeatCourt";
import RosterBoard from "@/components/three-man-weave/RosterBoard";
import PodiumReceipt from "@/components/three-man-weave/PodiumReceipt";
import PickOverlay from "@/components/three-man-weave/PickOverlay";
import IdentityLockPanel from "@/components/three-man-weave/IdentityLockPanel";
import DraftOrderStrip from "@/components/three-man-weave/DraftOrderStrip";
import BotPickReveal from "@/components/three-man-weave/BotPickReveal";
import WeaveSpinner from "@/components/three-man-weave/WeaveSpinner";
import type { TmwCandidate } from "@/lib/three-man-weave-state";
import type {
  ArenaResultView,
  ArenaSeatPublic,
  TmwPick,
  TmwPublicState,
  TmwRoll,
  TmwRoster,
} from "@/types/three-man-weave";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

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
// The roster board
// ---------------------------------------------------------------------------

describe("RosterBoard", () => {
  it("renders all three rosters at once, not one at a time", () => {
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

  it("offers every roster as a tab on mobile, with its own count", () => {
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
    // THE ON-THE-CLOCK STATE, not a per-seat countdown. Three of those ticked
    // once a second and re-rendered three whole court panels for a number that
    // belongs beside the controls; `ArenaTimer` owns the count now, and this
    // seat carries only the state -- which changes when the turn does.
    expect(within(panel).getByTestId("tmw-seat-onclock-1")).toBeInTheDocument();
  });

  it("shows bot thinking and the pick reveal in the room, not on each court", () => {
    // PART 9. A bot pick used to appear between two polls with no transition:
    // a seat went from empty to filled and nothing marked the moment. The
    // server already enforces a 1-5s think time against `arena_turns.opened_at`,
    // so the board genuinely does render the bot on the clock first -- the
    // client simply had nowhere to say so.
    render(
      <BotPickReveal
        state={publicState({ rosters: [roster(0), roster(1), roster(2)] })}
        seats={SEATS}
        currentTurnSeatIndex={1}
        yourSeatIndex={0}
      />,
    );
    const tray = screen.getByTestId("tmw-bot-reveal");
    expect(tray).toHaveAttribute("data-state", "scouting");
    expect(tray).toHaveTextContent("Floor General is scouting");
  });

  it("shows the scoring season and score on a drafted card, and no trade chip", () => {
    render(
      <SeatCourt
        roster={roster(0, { SF: pick() })}
        seat={SEATS[0]}
        isYou
        isOnTurn={false}
      />,
    );
    const cell = screen.getByTestId("tmw-slot-season-SF");
    expect(cell).toHaveTextContent("2018-19 TOR");
    expect(cell).toHaveTextContent("84.0");
    // "via trade" appeared beside most stars and told a reader nothing they
    // could act on; the team and season already say where the card comes from.
    expect(cell).not.toHaveTextContent(/via trade/i);
  });

  it("no longer offers a move control on the board itself", () => {
    // THE MOVEMENT CONTROL MOVED INTO THE DRAFT ROOM. A card that was a button
    // on all three courts -- two of which belong to opponents and did nothing
    // when pressed -- was offering an interaction it could not honour, and the
    // move it did offer opened a second dialog over the board that manual
    // acceptance found nobody discovered. `PlacementBoard` owns it now, where a
    // move can be previewed against a staged pick and committed with it.
    render(
      <SeatCourt
        roster={roster(0, { SF: pick() })}
        seat={SEATS[0]}
        isYou
        isOnTurn={false}
      />,
    );
    expect(screen.getByTestId("tmw-slot-SF").tagName).not.toBe("BUTTON");
  });

  it("marks exactly one roster as being on the clock", () => {
    // PART 8. The active treatment used to be a 2px inline inset shadow, which
    // is the "indicated by tiny text and a small badge" finding. It is now a
    // data attribute the stylesheet turns into a bright border, a glow and a
    // dimming of the inactive courts -- and it carries a text label too, so the
    // signal is not colour alone.
    const { rerender } = render(
      <SeatCourt roster={roster(0)} seat={SEATS[0]} isYou isOnTurn />,
    );
    expect(screen.getByTestId("tmw-seat-court-0")).toHaveAttribute(
      "data-on-turn",
      "true",
    );
    expect(screen.getByTestId("tmw-seat-onclock-0")).toBeInTheDocument();

    rerender(<SeatCourt roster={roster(0)} seat={SEATS[0]} isYou isOnTurn={false} />);
    expect(screen.getByTestId("tmw-seat-court-0")).toHaveAttribute(
      "data-on-turn",
      "false",
    );
    expect(screen.queryByTestId("tmw-seat-onclock-0")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The pick overlay
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
        candidates={[candidate("kawhi-leonard"), candidate("kyle-lowry", {
          fit: {
            player_slug: "kyle-lowry",
            state: "fits_now",
            direct_slots: ["PG"],
            plan: null,
            moves: [],
            reason: null,
          },
        })]}
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
    // THE PREVIEW IS ACTIONABLE, NOT A LABEL. It names both halves of the
    // arrangement in order, and the same information is drawn on the slots
    // themselves -- Larry Bird's SF slot carries its destination.
    expect(screen.getByTestId("tmw-rearrange-note")).toHaveTextContent(
      /Kawhi Leonard → Small forward/,
    );
    expect(screen.getByTestId("tmw-rearrange-note")).toHaveTextContent(
      /Larry Bird: Small forward → Bench/,
    );
    // THE ARROW ON THE STAGED SLOT NAMES WHO IS MOVING. That slot now shows
    // the INCOMING player in bold, so an unattributed "→ BN" beside it reads as
    // the arriving player leaving again -- which is what a review frame of a
    // four-move rearrangement actually said.
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
    // Legal destinations are real buttons; illegal ones are not.
    const sf = screen.getByTestId("tmw-place-SF");
    expect(sf.tagName).toBe("BUTTON");
    expect(sf).toHaveAttribute("data-legal", "true");
    expect(screen.getByTestId("tmw-place-PG").tagName).not.toBe("BUTTON");
    expect(screen.getByTestId("tmw-place-PG")).toHaveAttribute("data-legal", "false");

    await userEvent.click(screen.getByTestId("tmw-place-PF"));
    expect(screen.getByTestId("tmw-staged-PF")).toHaveTextContent("Kawhi Leonard");
    // THE BUTTON NAMES THE WHOLE DECISION -- who, and where.
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
    // PART 3 permits a compact select to EXIST; it forbids it being the
    // principal interaction. It appears only when more than one slot is legal,
    // is labelled as an alternative, and offers nothing the board does not.
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
    // `btn-primary` and `btn-secondary` were used by four surfaces and defined
    // in NO stylesheet, so under Tailwind Preflight every one of them painted
    // as plain text. The classes are the contract; `arena.css` now defines
    // them, and `styles.test.ts` asserts the rules exist.
    expect(screen.getByTestId("tmw-cancel-pick")).toHaveClass("btn-secondary");
    expect(screen.getByTestId("tmw-cancel-pick")).toHaveTextContent("Cancel selection");
  });

  // -- direct roster movement, from the same surface -----------------------

  it("moves an existing roster card by clicking it and then a destination", async () => {
    const { onMove } = renderOverlay({
      roster: roster(0, {
        SF: pick({ player_slug: "larry-bird", player_name: "Larry Bird", slot_type: "SF" }),
      }),
    });
    // Clicking your own placed card starts a move.
    await userEvent.click(screen.getByTestId("tmw-place-SF"));
    expect(screen.getByTestId("tmw-pick-overlay")).toHaveAttribute("data-mode", "moving");
    expect(screen.getByTestId("tmw-place-SF")).toHaveAttribute("data-source", "true");

    await userEvent.click(screen.getByTestId("tmw-place-bench_1"));
    await userEvent.click(screen.getByTestId("tmw-move-confirm"));
    // A COMPLETE final arrangement, which is the only shape the server accepts
    // and the reason no half-move can exist.
    expect(onMove).toHaveBeenCalledWith({ bench_1: "larry-bird" });
  });

  it("swaps two placed cards atomically", async () => {
    const { onMove } = renderOverlay({
      roster: roster(0, {
        SF: pick({ player_slug: "larry-bird", player_name: "Larry Bird", slot_type: "SF" }),
        bench_1: pick({ player_slug: "kevin-mchale", player_name: "Kevin McHale", slot_type: "bench_1" }),
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
// The result
// ---------------------------------------------------------------------------

describe("PodiumReceipt", () => {
  it("names the basis and never calls it an average", () => {
    render(
      <PodiumReceipt
        results={[result()]}
        rosters={[roster(0, { SF: pick() })]}
        yourSeatIndex={0}
        onPlayAgain={vi.fn()}
      />,
    );
    const basis = screen.getByTestId("tmw-ranking-basis");
    expect(basis).toHaveTextContent(/lineup-quality index/i);
    expect(basis).toHaveTextContent(/Not an average/i);
  });

  it("publishes no projected record anywhere", () => {
    render(
      <PodiumReceipt
        results={[result()]}
        rosters={[roster(0, { SF: pick() })]}
        yourSeatIndex={0}
        onPlayAgain={vi.fn()}
      />,
    );
    const panel = screen.getByTestId("tmw-podium");
    expect(panel.textContent).not.toMatch(/\b\d{2}-\d{2}\s*projected/i);
    expect(panel.textContent).not.toMatch(/projected record/i);
  });

  it("reports the decisive pick as a measured drop, not an opinion", () => {
    render(
      <PodiumReceipt
        results={[result()]}
        rosters={[roster(0, { SF: pick() })]}
        yourSeatIndex={0}
        onPlayAgain={vi.fn()}
      />,
    );
    expect(screen.getByTestId("tmw-decisive-0")).toHaveTextContent(
      /removing them costs 4.12 lineup score/,
    );
  });

  it("celebrates a win and offers both exits", async () => {
    const onPlayAgain = vi.fn();
    render(
      <PodiumReceipt
        results={[result()]}
        rosters={[roster(0, { SF: pick() })]}
        yourSeatIndex={0}
        onPlayAgain={onPlayAgain}
      />,
    );
    expect(screen.getByTestId("tmw-celebration")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("tmw-back-to-arena")).toHaveAttribute("href", "/arena");
    await userEvent.click(screen.getByTestId("tmw-play-again"));
    expect(onPlayAgain).toHaveBeenCalled();
  });

  it("does not celebrate a loss, and does not punish it either", () => {
    render(
      <PodiumReceipt
        results={[result({ placement: 3, outcome: "loss" })]}
        rosters={[roster(0, { SF: pick() })]}
        yourSeatIndex={0}
        onPlayAgain={vi.fn()}
      />,
    );
    expect(screen.getByTestId("tmw-celebration")).toHaveAttribute("data-active", "false");
    // WHOSE PLACEMENT. "3RD PLACE" sat directly above "The Closer wins", and the
    // two lines together parse as "The Closer won third place" -- caught in the
    // review capture. The eyebrow is about YOU; it now says so.
    expect(screen.getByTestId("tmw-your-placement")).toHaveTextContent("You finished 3rd");
  });

  it("shows an unscoreable roster as a real state, never as zero", () => {
    render(
      <PodiumReceipt
        results={[
          result({
            score: 0,
            detail: { ...result().detail, score_status: "incomplete", lineup_score: null },
          }),
        ]}
        rosters={[roster(0)]}
        yourSeatIndex={0}
        onPlayAgain={vi.fn()}
      />,
    );
    expect(screen.getByTestId("tmw-result-0")).toHaveTextContent("Not ranked");
  });
});

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

describe("WeaveSpinner", () => {
  it("carries the server's answer from the first frame", () => {
    render(<WeaveSpinner roll={ROLL} roundNumber={1} totalRounds={6} />);
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

  it("says it is rolling when there is no roll yet", () => {
    render(<WeaveSpinner roll={null} roundNumber={null} totalRounds={6} />);
    expect(screen.getByTestId("tmw-roll-rolling")).toBeInTheDocument();
  });
});

describe("IdentityLockPanel", () => {
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
});

describe("DraftOrderStrip", () => {
  it("shows the full published snake, upcoming turns included", () => {
    render(
      <DraftOrderStrip
        order={[
          { roundNumber: 1, seatIndex: 0, done: true, active: false },
          { roundNumber: 1, seatIndex: 1, done: false, active: true },
          { roundNumber: 1, seatIndex: 2, done: false, active: false },
        ]}
        seats={SEATS}
        yourSeatIndex={0}
      />,
    );
    expect(screen.getByTestId("tmw-order-1-2")).toHaveAttribute("data-done", "false");
    // WHO, not a seat index. A numbered square meant reading the order required
    // holding an index-to-name mapping in your head while a clock ran.
    expect(screen.getByTestId("tmw-order-1-0")).toHaveTextContent("You");
    expect(screen.getByTestId("tmw-order-1-1")).toHaveAttribute("data-active", "true");
    // The NEXT pick is marked too, not only the current one.
    expect(screen.getByTestId("tmw-order-1-2")).toHaveAttribute("data-next", "true");
  });
});
