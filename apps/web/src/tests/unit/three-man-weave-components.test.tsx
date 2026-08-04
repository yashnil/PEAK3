/**
 * THREE-MAN WEAVE — frontend unit tests.
 *
 * WHAT THESE ARE FOR. Legality, scoring, placement and the identity lock all
 * live on the server and are tested there (`tests/three_man_weave/`,
 * `apps/api/tests/test_three_man_weave_mode.py`). What can go wrong HERE is
 * different, and it is what these cover:
 *
 *  * the ranking basis being NAMED where the winner is declared, rather than
 *    hidden in a tooltip -- a player whose 71-11 lost to a 64-18 must be able
 *    to read why without hunting;
 *  * the 82-game record staying visually SUBORDINATE and never becoming the
 *    headline;
 *  * an unscoreable roster rendering as a real state rather than a blank or a
 *    zero;
 *  * eligibility and the scoring card rendering as two separate labelled
 *    facts, which is what stops a 2000s Shaq scored on 2000-01 from reading
 *    as a bug;
 *  * a mid-season trade being disclosed in both directions;
 *  * the API client sending a bearer token, a required idempotency key and the
 *    expected state version -- a client that omitted any of them would be a
 *    double-apply waiting to happen.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PickProvenance from "@/components/three-man-weave/PickProvenance";
import SeatCourt from "@/components/three-man-weave/SeatCourt";
import PodiumReceipt from "@/components/three-man-weave/PodiumReceipt";
import PickPanel from "@/components/three-man-weave/PickPanel";
import IdentityLockPanel from "@/components/three-man-weave/IdentityLockPanel";
import DraftOrderStrip from "@/components/three-man-weave/DraftOrderStrip";
import RollReveal from "@/components/three-man-weave/RollReveal";
import type { TmwCandidate } from "@/lib/three-man-weave-state";
import type { ArenaResultView, TmwPick, TmwPlayer, TmwRoster } from "@/types/three-man-weave";

const getAccessToken = vi.fn();
vi.mock("@/lib/auth", () => ({
  getAccessToken: (...args: unknown[]) => getAccessToken(...args),
}));

function player(overrides: Partial<TmwPlayer> = {}): TmwPlayer {
  return {
    player_slug: "kawhi-leonard",
    player_name: "Kawhi Leonard",
    eligibility: {
      franchise_id: "TOR",
      franchise_display_name: "Toronto Raptors",
      decade: "2010s",
      seasons: [
        { season: "2018-19", team_code: "TOR", games_played: 60, via: "direct_team_season" },
      ],
    },
    scoring_card: {
      season: "2016-17",
      team_id: "SAS",
      team_name: "San Antonio Spurs",
      prime_score: 87.8,
      score_source: "exact_team_stint",
      is_multi_team_season: false,
      formula_version: "peak3_v1",
    },
    ...overrides,
  };
}

function candidate(overrides: Partial<TmwCandidate> = {}): TmwCandidate {
  return { ...player(), legalSlots: ["SF", "PF"], ...overrides };
}

function pick(overrides: Partial<TmwPick> = {}): TmwPick {
  return {
    ...player(),
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

function result(overrides: Partial<ArenaResultView> = {}): ArenaResultView {
  return {
    seat_index: 0,
    display_name: "You",
    placement: 1,
    score: 64.4,
    outcome: "win",
    was_bot: false,
    detail: {
      score_status: "complete",
      lineup_peak_score: 64.4,
      wins: 64,
      losses: 18,
      expected_wins: 64.2,
      fit_components: {
        talent_core: 66,
        bench_strength: 55,
        positional_fit: 100,
        creation_coverage: 80,
        scoring_coverage: 80,
        postseason_pedigree: 80,
        team_context_depth: 80,
      },
      best_pick: "Kawhi Leonard",
      structural_weakness: "thin bench depth",
      tmw_adapter_version: "tmw_six_player_adapter_v1",
      lineup_model_version: "perfect_season_lineup_fit_v2",
      simulator_version: "perfect_season_simulator_v1",
      formula_version: "peak3_v1",
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getAccessToken.mockResolvedValue("tok");
});

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------
describe("PickProvenance", () => {
  it("shows eligibility and the scoring card as two labelled facts", () => {
    render(<PickProvenance player={player()} />);
    expect(screen.getByText("Eligible through")).toBeInTheDocument();
    expect(screen.getByTestId("tmw-eligible-through")).toHaveTextContent("Toronto Raptors · 2018-19");
    expect(screen.getByText("Scoring card")).toBeInTheDocument();
    expect(screen.getByTestId("tmw-scoring-card")).toHaveTextContent(
      "2016-17 San Antonio Spurs · 1Y PEAK3 87.8",
    );
  });

  it("keeps the two seasons distinguishable — the whole point of the block", () => {
    // Eligible through a Toronto season, scored on a San Antonio one. If these
    // ever merged, a 2000s Shaq scored on 2000-01 would read as a bug.
    render(<PickProvenance player={player()} />);
    const eligible = screen.getByTestId("tmw-eligible-through").textContent ?? "";
    const scoring = screen.getByTestId("tmw-scoring-card").textContent ?? "";
    expect(eligible).toContain("2018-19");
    expect(eligible).not.toContain("2016-17");
    expect(scoring).toContain("2016-17");
    expect(scoring).not.toContain("Toronto");
  });

  it("discloses a mid-season trade on the eligibility side", () => {
    render(
      <PickProvenance
        player={player({
          eligibility: {
            ...player().eligibility,
            seasons: [
              { season: "2014-15", team_code: "BOS", games_played: 21, via: "traded_team_stint" },
            ],
          },
        })}
      />,
    );
    expect(screen.getByTestId("tmw-traded-eligibility")).toBeInTheDocument();
  });

  it("labels an aggregate-grain score rather than passing it off as one team's", () => {
    render(
      <PickProvenance
        player={player({
          scoring_card: {
            ...player().scoring_card!,
            score_source: "exact_season_aggregate",
            is_multi_team_season: true,
          },
        })}
      />,
    );
    expect(screen.getByTestId("tmw-score-source-note")).toHaveTextContent(/full season/i);
  });

  it("says so plainly when a player has no scored season in the decade", () => {
    render(<PickProvenance player={player({ scoring_card: null })} />);
    expect(screen.getByTestId("tmw-scoring-card")).toHaveTextContent("No scored season");
  });
});

// ---------------------------------------------------------------------------
// The podium: the binding product rules
// ---------------------------------------------------------------------------
describe("PodiumReceipt", () => {
  const rosters = [roster(0, { SF: pick() }), roster(1), roster(2)];

  it("names the ranking basis where the winner is declared", () => {
    render(<PodiumReceipt results={[result()]} rosters={rosters} yourSeatIndex={0} />);
    const basis = screen.getByTestId("tmw-ranking-basis");
    expect(basis).toHaveTextContent(/PEAK3 lineup score/i);
    // Not a tooltip: it is real, visible text next to the headline.
    expect(basis.tagName.toLowerCase()).toBe("p");
    expect(basis).not.toHaveAttribute("title");
  });

  it("leads with the score and keeps the record subordinate", () => {
    render(<PodiumReceipt results={[result()]} rosters={rosters} yourSeatIndex={0} />);
    expect(screen.getByTestId("tmw-outcome")).toHaveTextContent("You wins");
    expect(screen.getByTestId("tmw-score-0")).toHaveTextContent("64.4");
    const record = screen.getByTestId("tmw-record-0");
    expect(record).toHaveTextContent("64-18 projected");
    // The record must not be the headline anywhere on the podium.
    expect(screen.getByTestId("tmw-outcome").textContent).not.toContain("64-18");
  });

  it("shows the better PEAK3 score winning even when the record is worse", () => {
    // The exact case that would otherwise look broken: 64-18 beats 71-11.
    render(
      <PodiumReceipt
        results={[
          result({ seat_index: 0, placement: 1, score: 64.4 }),
          result({
            seat_index: 1,
            display_name: "Bee",
            placement: 2,
            score: 63.9,
            outcome: "loss",
            detail: { ...result().detail, lineup_peak_score: 63.9, wins: 71, losses: 11 },
          }),
        ]}
        rosters={rosters}
        yourSeatIndex={0}
      />,
    );
    expect(screen.getByTestId("tmw-outcome")).toHaveTextContent("You wins");
    expect(screen.getByTestId("tmw-record-1")).toHaveTextContent("71-11 projected");
    expect(screen.getByTestId("tmw-ranking-basis")).toHaveTextContent(/mean PEAK3 score/i);
  });

  it("renders an unscoreable roster as a real state, never a zero", () => {
    render(
      <PodiumReceipt
        results={[
          result({ seat_index: 0, placement: 1, score: 70 }),
          result({
            seat_index: 1,
            display_name: "Bee",
            placement: 2,
            score: 0,
            outcome: "loss",
            detail: { ...result().detail, score_status: "incomplete", lineup_peak_score: null },
          }),
        ]}
        rosters={rosters}
        yourSeatIndex={0}
      />,
    );
    const cell = screen.getByTestId("tmw-score-1");
    expect(cell).toHaveTextContent("Not ranked");
    expect(cell.textContent).not.toMatch(/^0/);
    expect(screen.getByTestId("tmw-unrankable-note")).toHaveTextContent(/could not be fully scored/i);
  });

  it("marks a shared placement as a tie rather than implying an order", () => {
    render(
      <PodiumReceipt
        results={[
          result({ seat_index: 0, placement: 1, outcome: "draw" }),
          result({ seat_index: 1, display_name: "Bee", placement: 1, outcome: "draw" }),
          result({ seat_index: 2, display_name: "Cee", placement: 3, outcome: "loss" }),
        ]}
        rosters={rosters}
        yourSeatIndex={0}
      />,
    );
    expect(screen.getByTestId("tmw-tied-0")).toBeInTheDocument();
    expect(screen.getByTestId("tmw-tied-1")).toBeInTheDocument();
    expect(screen.queryByTestId("tmw-tied-2")).not.toBeInTheDocument();
    expect(screen.getByTestId("tmw-outcome")).toHaveTextContent("draw for first");
  });

  it("renders all three rosters in the receipt", () => {
    render(
      <PodiumReceipt
        results={[
          result({ seat_index: 0 }),
          result({ seat_index: 1, display_name: "Bee", placement: 2, outcome: "loss" }),
          result({ seat_index: 2, display_name: "Cee", placement: 3, outcome: "loss" }),
        ]}
        rosters={rosters}
        yourSeatIndex={0}
      />,
    );
    expect(screen.getByTestId("tmw-receipt-0")).toBeInTheDocument();
    expect(screen.getByTestId("tmw-receipt-1")).toBeInTheDocument();
    expect(screen.getByTestId("tmw-receipt-2")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------
describe("PickPanel", () => {
  it("is a two-step choose-player-then-choose-slot flow with no drag", async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(
      <PickPanel candidates={[candidate()]} busy={false} disabledReason={null} onPick={onPick} />,
    );

    // No slot buttons until a player is chosen -- there is no half-completed
    // drop state to be in.
    expect(screen.queryByTestId("tmw-slot-choices")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("tmw-candidate-kawhi-leonard"));
    expect(screen.getByTestId("tmw-slot-choices")).toBeInTheDocument();

    await user.click(screen.getByTestId("tmw-place-SF"));
    expect(onPick).toHaveBeenCalledWith("kawhi-leonard", "SF");
  });

  it("offers only the slots the server says this seat may use", async () => {
    const user = userEvent.setup();
    render(
      <PickPanel
        candidates={[candidate({ legalSlots: ["C"] })]}
        busy={false}
        disabledReason={null}
        onPick={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId("tmw-candidate-kawhi-leonard"));
    expect(screen.getByTestId("tmw-place-C")).toBeInTheDocument();
    expect(screen.queryByTestId("tmw-place-PG")).not.toBeInTheDocument();
  });

  it("shows an illegal candidate rather than hiding them, and explains why", async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(
      <PickPanel
        candidates={[candidate({ legalSlots: [] })]}
        busy={false}
        disabledReason={null}
        onPick={onPick}
      />,
    );
    const button = screen.getByTestId("tmw-candidate-kawhi-leonard");
    expect(button).toBeInTheDocument();
    expect(screen.getByTestId("tmw-blocked-kawhi-leonard")).toHaveTextContent(/no open slot/i);
    // aria-disabled, not disabled: it must stay reachable by keyboard, or a
    // keyboard user can never reach the card that explains the grey state.
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    await user.click(button);
    expect(screen.queryByTestId("tmw-slot-choices")).not.toBeInTheDocument();
  });

  it("shows a waiting state instead of controls when it is not your turn", () => {
    render(
      <PickPanel
        candidates={[candidate()]}
        busy={false}
        disabledReason="Waiting for the other seats."
        onPick={vi.fn()}
      />,
    );
    expect(screen.getByTestId("tmw-pick-panel")).toHaveAttribute("data-state", "waiting");
    expect(screen.queryByTestId("tmw-candidates")).not.toBeInTheDocument();
  });

  it("lets a selection be cancelled without picking", async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(
      <PickPanel candidates={[candidate()]} busy={false} disabledReason={null} onPick={onPick} />,
    );
    await user.click(screen.getByTestId("tmw-candidate-kawhi-leonard"));
    await user.click(screen.getByTestId("tmw-cancel-selection"));
    expect(screen.queryByTestId("tmw-slot-choices")).not.toBeInTheDocument();
    expect(onPick).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The lock, the order, the reveal
// ---------------------------------------------------------------------------
describe("IdentityLockPanel", () => {
  const seats = [
    { seat_index: 0, display_name: "You", is_bot: false, status: "active", bot_rating: null },
    { seat_index: 1, display_name: "Bee", is_bot: false, status: "active", bot_rating: null },
    { seat_index: 2, display_name: "Cee", is_bot: true, status: "active", bot_rating: 1200 },
  ];

  it("states the rule and lists who took each name", () => {
    render(
      <IdentityLockPanel
        entries={[
          {
            playerSlug: "lebron-james",
            playerName: "LeBron James",
            seatIndex: 1,
            roundNumber: 2,
            franchiseDisplayName: "Cleveland Cavaliers",
            decade: "2000s",
          },
        ]}
        seats={seats}
      />,
    );
    expect(screen.getByTestId("tmw-identity-lock")).toHaveTextContent(
      /gone for every seat, in every franchise and decade/i,
    );
    expect(screen.getByTestId("tmw-lock-lebron-james")).toHaveTextContent("LeBron James");
    expect(screen.getByTestId("tmw-lock-lebron-james")).toHaveTextContent("Bee");
  });

  it("says nobody is drafted rather than rendering an empty box", () => {
    render(<IdentityLockPanel entries={[]} seats={seats} />);
    expect(screen.getByTestId("tmw-identity-lock")).toHaveTextContent(/nobody drafted yet/i);
  });
});

describe("SeatCourt", () => {
  const seat = {
    seat_index: 0,
    display_name: "You",
    is_bot: false,
    status: "active",
    bot_rating: null,
  };

  it("renders every slot, filled or open, on the shared court geometry", () => {
    render(
      <SeatCourt
        roster={roster(0, { SF: pick() })}
        seat={seat}
        isYou
        isOnTurn={false}
        justPickedSlug={null}
      />,
    );
    for (const slotType of ["PG", "SG", "SF", "PF", "C", "bench_1"]) {
      expect(screen.getByTestId(`tmw-slot-${slotType}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("tmw-slot-SF")).toHaveAttribute("data-filled", "true");
    expect(screen.getByTestId("tmw-slot-PG")).toHaveAttribute("data-filled", "false");
    expect(screen.getByTestId("tmw-seat-progress-0")).toHaveTextContent("1/6");
  });

  it("names the scoring season on the card", () => {
    // Without it, a 2000s-roll Shaq showing 2000-01 rather than his better
    // 1999-00 looks like a bug.
    render(
      <SeatCourt
        roster={roster(0, { SF: pick() })}
        seat={seat}
        isYou
        isOnTurn={false}
        justPickedSlug={null}
      />,
    );
    expect(screen.getByTestId("tmw-slot-season-SF")).toHaveTextContent("2016-17");
    expect(screen.getByTestId("tmw-slot-season-SF")).toHaveTextContent("87.8");
  });

  it("marks the seat on turn so the spotlight is unambiguous", () => {
    const { rerender } = render(
      <SeatCourt roster={roster(0)} seat={seat} isYou isOnTurn={false} justPickedSlug={null} />,
    );
    expect(screen.getByTestId("tmw-seat-court-0")).toHaveAttribute("data-on-turn", "false");
    rerender(
      <SeatCourt roster={roster(0)} seat={seat} isYou isOnTurn justPickedSlug={null} />,
    );
    expect(screen.getByTestId("tmw-seat-court-0")).toHaveAttribute("data-on-turn", "true");
  });

  it("highlights the pick just made without moving anything", () => {
    render(
      <SeatCourt
        roster={roster(0, { SF: pick() })}
        seat={seat}
        isYou
        isOnTurn={false}
        justPickedSlug="kawhi-leonard"
      />,
    );
    expect(screen.getByTestId("tmw-slot-SF")).toHaveAttribute("data-just-picked", "true");
    expect(screen.getByTestId("tmw-slot-PG")).toHaveAttribute("data-just-picked", "false");
  });

  it("labels a bot seat rather than passing it off as a person", () => {
    render(
      <SeatCourt
        roster={roster(2)}
        seat={{ ...seat, seat_index: 2, display_name: "Cee", is_bot: true }}
        isYou={false}
        isOnTurn={false}
        justPickedSlug={null}
      />,
    );
    expect(screen.getByTestId("tmw-seat-court-2")).toHaveTextContent("bot");
  });
});

describe("DraftOrderStrip", () => {
  const seats = [
    { seat_index: 0, display_name: "You", is_bot: false, status: "active", bot_rating: null },
    { seat_index: 1, display_name: "Bee", is_bot: false, status: "active", bot_rating: null },
    { seat_index: 2, display_name: "Cee", is_bot: true, status: "active", bot_rating: 1200 },
  ];
  const order = [
    { roundNumber: 1, seatIndex: 0, done: true, active: false },
    { roundNumber: 1, seatIndex: 1, done: false, active: true },
    { roundNumber: 1, seatIndex: 2, done: false, active: false },
  ];

  it("spotlights whose turn it is by name", () => {
    render(
      <DraftOrderStrip order={order} seats={seats} yourSeatIndex={0} secondsRemaining={31.4} />,
    );
    expect(screen.getByTestId("tmw-turn-spotlight")).toHaveTextContent("Bee is picking");
    expect(screen.getByTestId("tmw-turn-clock")).toHaveTextContent("32s");
  });

  it("says 'Your pick' when the turn is yours", () => {
    render(
      <DraftOrderStrip
        order={[{ roundNumber: 1, seatIndex: 0, done: false, active: true }]}
        seats={seats}
        yourSeatIndex={0}
        secondsRemaining={null}
      />,
    );
    expect(screen.getByTestId("tmw-turn-spotlight")).toHaveTextContent("Your pick");
    expect(screen.queryByTestId("tmw-turn-clock")).not.toBeInTheDocument();
  });

  it("marks done, active and upcoming turns distinctly", () => {
    render(
      <DraftOrderStrip order={order} seats={seats} yourSeatIndex={0} secondsRemaining={null} />,
    );
    expect(screen.getByTestId("tmw-order-1-0")).toHaveAttribute("data-done", "true");
    expect(screen.getByTestId("tmw-order-1-1")).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("tmw-order-1-2")).toHaveAttribute("data-active", "false");
  });
});

describe("RollReveal", () => {
  const roll = {
    round_number: 3,
    roll_id: "tor-2010s",
    franchise_id: "TOR",
    franchise_display_name: "Toronto Raptors",
    decade: "2010s",
    eligible_slugs: ["kawhi-leonard"],
    candidates: [player()],
  };

  it("shows the franchise and the decade as the shared constraint", () => {
    render(<RollReveal roll={roll} roundNumber={3} totalRounds={6} />);
    expect(screen.getByTestId("tmw-roll-franchise")).toHaveTextContent("Toronto Raptors");
    expect(screen.getByTestId("tmw-roll-decade")).toHaveTextContent("2010s");
    expect(screen.getByTestId("tmw-roll")).toHaveTextContent("Round 3 of 6");
  });

  it("is fully legible with no roll animation state — reduced motion loses nothing", () => {
    // Both halves are in the DOM with their real text immediately; only
    // opacity is animated, so a reduced-motion user reads the same thing.
    render(<RollReveal roll={roll} roundNumber={3} totalRounds={6} />);
    const section = screen.getByTestId("tmw-roll");
    expect(within(section).getByText("Toronto Raptors")).toBeInTheDocument();
    expect(within(section).getByText("2010s")).toBeInTheDocument();
  });

  it("shows a rolling state rather than an empty frame between rounds", () => {
    render(<RollReveal roll={null} roundNumber={null} totalRounds={6} />);
    expect(screen.getByTestId("tmw-roll-rolling")).toHaveTextContent(/rolling/i);
  });
});
