import { describe, expect, it } from "vitest";
import {
  RANKING_BASIS_LABEL,
  candidatesForSeat,
  connectionState,
  eligibilityLine,
  hasTradedEvidence,
  identityLock,
  isYourTurn,
  outcomeHeadline,
  phaseOf,
  pickFeed,
  podium,
  rankingBasisLabel,
  recordLine,
  scoreDisplay,
  scoreSourceNote,
  scoringCardLine,
  turnOrder,
} from "@/lib/three-man-weave-state";
import type {
  ArenaResultView,
  TmwMatchView,
  TmwPick,
  TmwPlayer,
  TmwPublicState,
  TmwRoster,
} from "@/types/three-man-weave";

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

function roster(seatIndex: number, slots: Partial<Record<string, TmwPick | null>> = {}): TmwRoster {
  return {
    seat_index: seatIndex,
    slots: { PG: null, SG: null, SF: null, PF: null, C: null, bench_1: null, ...slots },
    complete: false,
  };
}

function publicState(overrides: Partial<TmwPublicState> = {}): TmwPublicState {
  return {
    mode_version: "tmw_ruleset_v1",
    formula_version: "peak3_v1",
    slot_types: ["PG", "SG", "SF", "PF", "C", "bench_1"],
    total_rounds: 6,
    current_round: 1,
    current_seat: 0,
    is_complete: false,
    rosters: [roster(0), roster(1), roster(2)],
    drafted_identities: [],
    used_roll_ids: ["tor-2010s"],
    current_roll: {
      round_number: 1,
      roll_id: "tor-2010s",
      franchise_id: "TOR",
      franchise_display_name: "Toronto Raptors",
      decade: "2010s",
      eligible_slugs: ["kawhi-leonard"],
      candidates: [player()],
    },
    ...overrides,
  };
}

function matchView(overrides: Partial<TmwMatchView> = {}): TmwMatchView {
  return {
    match_id: "m1",
    mode: "three_man_weave",
    mode_version: "tmw_ruleset_v1",
    model_version: "peak3_v1",
    status: "active",
    state_version: 3,
    seat_count: 3,
    entry_path: "practice",
    rated: false,
    your_seat_index: 0,
    seats: [
      { seat_index: 0, display_name: "You", is_bot: false, status: "active", bot_rating: null },
      { seat_index: 1, display_name: "Bee", is_bot: false, status: "active", bot_rating: null },
      { seat_index: 2, display_name: "Cee", is_bot: true, status: "active", bot_rating: 1200 },
    ],
    public_state: publicState(),
    private_state: { seat_index: 0, open_slots: ["PG", "SG", "SF", "PF", "C", "bench_1"] },
    legal_commands: [],
    current_turn_seat_index: 0,
    seconds_remaining: 45,
    latest_event_seq: 2,
    room_code: null,
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
      lineup_peak_score: 72.4,
      wins: 64,
      losses: 18,
      expected_wins: 64.2,
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
      structural_weakness: "thin bench depth",
      tmw_adapter_version: "tmw_six_player_adapter_v1",
      lineup_model_version: "perfect_season_lineup_fit_v2",
      simulator_version: "perfect_season_simulator_v1",
      formula_version: "peak3_v1",
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Provenance: two facts, never merged
// ---------------------------------------------------------------------------
describe("eligibility vs scoring card", () => {
  it("describes eligibility by the franchise and the season that proves it", () => {
    expect(eligibilityLine(player())).toBe("Toronto Raptors · 2018-19");
  });

  it("describes the scoring card by a different season entirely", () => {
    // The whole point: eligible through Toronto, scored on San Antonio.
    expect(scoringCardLine(player())).toBe("2016-17 San Antonio Spurs · 1Y PEAK3 87.8");
  });

  it("spans multiple eligibility seasons rather than naming only the first", () => {
    const multi = player({
      eligibility: {
        franchise_id: "BOS",
        franchise_display_name: "Boston Celtics",
        decade: "2010s",
        seasons: [
          { season: "2014-15", team_code: "BOS", games_played: 21, via: "traded_team_stint" },
          { season: "2016-17", team_code: "BOS", games_played: 76, via: "direct_team_season" },
        ],
      },
    });
    expect(eligibilityLine(multi)).toBe("Boston Celtics · 2014-15–2016-17");
  });

  it("returns null for a player with no scored season in the decade", () => {
    expect(scoringCardLine(player({ scoring_card: null }))).toBeNull();
  });
});

describe("traded disclosure", () => {
  it("flags eligibility earned through a mid-season trade", () => {
    expect(hasTradedEvidence(player())).toBe(false);
    const traded = player({
      eligibility: {
        ...player().eligibility,
        seasons: [
          { season: "2014-15", team_code: "BOS", games_played: 21, via: "traded_team_stint" },
        ],
      },
    });
    expect(hasTradedEvidence(traded)).toBe(true);
  });

  it("labels an aggregate-grain score rather than hiding it", () => {
    expect(scoreSourceNote(player())).toBeNull();
    const aggregate = player({
      scoring_card: {
        ...player().scoring_card!,
        score_source: "exact_season_aggregate",
        is_multi_team_season: true,
      },
    });
    expect(scoreSourceNote(aggregate)).toContain("full season");
  });
});

// ---------------------------------------------------------------------------
// The ranking rule
// ---------------------------------------------------------------------------
describe("ranking basis", () => {
  it("names the basis in a sentence a surface can print verbatim", () => {
    expect(rankingBasisLabel()).toContain(RANKING_BASIS_LABEL);
    expect(rankingBasisLabel()).toMatch(/mean PEAK3 score/i);
  });

  it("renders a real score as the deciding number", () => {
    const display = scoreDisplay(72.4, "complete");
    expect(display.kind).toBe("scored");
    expect(display.text).toBe("72.4");
  });

  it("NEVER renders an unscoreable roster as zero", () => {
    const display = scoreDisplay(null, "incomplete", ["bench_1"]);
    expect(display.kind).toBe("unrankable");
    expect(display.text).toBe("Not ranked");
    expect(display.text).not.toMatch(/0/);
    if (display.kind === "unrankable") {
      expect(display.reason).toContain("bench_1");
      expect(display.reason).toContain(RANKING_BASIS_LABEL);
    }
  });

  it("treats an incomplete status as unrankable even when a number is present", () => {
    // A 0.0 arriving alongside `incomplete` is the exact shape the server
    // warned about; it must not be rendered as a score.
    expect(scoreDisplay(0, "incomplete").kind).toBe("unrankable");
  });

  it("marks the record as projected so it cannot read as the headline", () => {
    expect(recordLine(64, 18)).toBe("64-18 projected");
    expect(recordLine(null, 18)).toBeNull();
  });
});

describe("podium", () => {
  it("orders by the server's placement and never re-ranks", () => {
    const rows = podium([
      result({ seat_index: 0, placement: 3, score: 61.0, outcome: "loss" }),
      result({ seat_index: 1, placement: 1, score: 74.5 }),
      result({ seat_index: 2, placement: 2, score: 68.2, outcome: "loss" }),
    ]);
    expect(rows.map((row) => row.result.seat_index)).toEqual([1, 2, 0]);
  });

  it("marks a shared placement as a genuine tie", () => {
    const rows = podium([
      result({ seat_index: 0, placement: 1, score: 70, outcome: "draw" }),
      result({ seat_index: 1, display_name: "Bee", placement: 1, score: 70, outcome: "draw" }),
      result({ seat_index: 2, display_name: "Cee", placement: 3, score: 60, outcome: "loss" }),
    ]);
    expect(rows.filter((row) => row.tied).map((row) => row.result.seat_index)).toEqual([0, 1]);
    expect(outcomeHeadline(rows)).toBe("You and Bee draw for first");
  });

  it("declares a three-way draw as one", () => {
    const rows = podium([
      result({ seat_index: 0, placement: 1, outcome: "draw" }),
      result({ seat_index: 1, placement: 1, outcome: "draw", display_name: "Bee" }),
      result({ seat_index: 2, placement: 1, outcome: "draw", display_name: "Cee" }),
    ]);
    expect(outcomeHeadline(rows)).toBe("A three-way draw");
  });

  it("carries the record as a subordinate line, not the score", () => {
    const [row] = podium([result()]);
    expect(row.score.text).toBe("72.4");
    expect(row.record).toBe("64-18 projected");
  });

  it("gives an unscoreable roster a real state on the podium", () => {
    const [row] = podium([
      result({
        score: 0,
        detail: { ...result().detail, score_status: "incomplete", lineup_peak_score: null },
      }),
    ]);
    expect(row.score.kind).toBe("unrankable");
    expect(row.score.text).toBe("Not ranked");
  });
});

// ---------------------------------------------------------------------------
// Draft mechanics
// ---------------------------------------------------------------------------
describe("turn order", () => {
  it("is a fixed A-B-C / C-B-A snake, not a rotation", () => {
    const order = turnOrder(publicState(), 3);
    expect(order).toHaveLength(18);
    expect(order.slice(0, 6).map((slot) => slot.seatIndex)).toEqual([0, 1, 2, 2, 1, 0]);
    expect(order.slice(-3).map((slot) => slot.seatIndex)).toEqual([2, 1, 0]);
  });

  it("marks exactly one turn active, after the picks already made", () => {
    const state = publicState({
      rosters: [roster(0, { SF: pick() }), roster(1), roster(2)],
    });
    const order = turnOrder(state, 3);
    expect(order.filter((slot) => slot.active)).toHaveLength(1);
    expect(order.findIndex((slot) => slot.active)).toBe(1);
    expect(order[0].done).toBe(true);
  });
});

describe("phase", () => {
  it("reports complete for a finished match", () => {
    expect(phaseOf(matchView({ public_state: publicState({ is_complete: true }) }))).toBe(
      "complete",
    );
  });

  it("reports revealing while there is no roll yet", () => {
    expect(phaseOf(matchView({ public_state: publicState({ current_roll: null }) }))).toBe(
      "revealing",
    );
  });

  it("reports picking with a roll on the board", () => {
    expect(phaseOf(matchView())).toBe("picking");
  });

  it("knows whose turn it is", () => {
    expect(isYourTurn(matchView())).toBe(true);
    expect(isYourTurn(matchView({ current_turn_seat_index: 2 }))).toBe(false);
    expect(isYourTurn(null)).toBe(false);
  });
});

describe("candidates", () => {
  it("annotates each candidate with THIS seat's legal slots", () => {
    const match = matchView({
      private_state: { seat_index: 0, legal_picks: { "kawhi-leonard": ["SF", "PF"] } },
    });
    expect(candidatesForSeat(match)[0].legalSlots).toEqual(["SF", "PF"]);
  });

  it("keeps an illegal candidate visible rather than hiding it", () => {
    // A player must be able to see that a strong name was on the board and
    // that their own roster shape is why they could not take them.
    const match = matchView({ private_state: { seat_index: 0, legal_picks: {} } });
    const candidates = candidatesForSeat(match);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].legalSlots).toEqual([]);
  });

  it("sorts legal candidates ahead of illegal ones, then by scoring card", () => {
    const strongIllegal = player({
      player_slug: "shaquille-o-neal",
      player_name: "Shaquille O'Neal",
      scoring_card: { ...player().scoring_card!, prime_score: 93.6 },
    });
    const weakLegal = player({
      player_slug: "john-stockton",
      player_name: "John Stockton",
      scoring_card: { ...player().scoring_card!, prime_score: 60.1 },
    });
    const match = matchView({
      public_state: publicState({
        current_roll: {
          ...publicState().current_roll!,
          candidates: [strongIllegal, weakLegal, player()],
        },
      }),
      private_state: {
        seat_index: 0,
        legal_picks: { "john-stockton": ["PG"], "kawhi-leonard": ["SF"] },
      },
    });
    expect(candidatesForSeat(match).map((c) => c.player_slug)).toEqual([
      "kawhi-leonard",
      "john-stockton",
      "shaquille-o-neal",
    ]);
  });

  it("is empty when no roll is on the board", () => {
    expect(candidatesForSeat(matchView({ public_state: publicState({ current_roll: null }) }))).toEqual(
      [],
    );
  });
});

describe("identity lock", () => {
  it("lists every drafted name with who took it", () => {
    const state = publicState({
      rosters: [
        roster(0, { SF: pick() }),
        roster(1, {
          PG: pick({
            seat_index: 1,
            slot_type: "PG",
            player_slug: "kyle-lowry",
            player_name: "Kyle Lowry",
          }),
        }),
        roster(2),
      ],
    });
    const lock = identityLock(state);
    expect(lock.map((entry) => entry.playerSlug)).toEqual(["kawhi-leonard", "kyle-lowry"]);
    expect(lock[1].seatIndex).toBe(1);
  });

  it("is empty before anyone drafts", () => {
    expect(identityLock(publicState())).toEqual([]);
  });

  it("orders the shared feed newest round first", () => {
    const state = publicState({
      rosters: [
        roster(0, {
          SF: pick(),
          PG: pick({ round_number: 2, slot_type: "PG", player_slug: "b", player_name: "B" }),
        }),
        roster(1),
        roster(2),
      ],
    });
    expect(pickFeed(state).map((p) => p.round_number)).toEqual([2, 1]);
  });
});

describe("connection", () => {
  it("escalates from live through reconnecting to offline", () => {
    expect(connectionState(0)).toBe("live");
    expect(connectionState(1)).toBe("reconnecting");
    expect(connectionState(2)).toBe("reconnecting");
    expect(connectionState(3)).toBe("offline");
  });
});
