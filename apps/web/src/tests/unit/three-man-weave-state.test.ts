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
  edgeBandFor,
  edgeQualifier,
  fitLabel,
  landingSlot,
  rearrangementSummary,
  searchCandidates,
  scoreDisplay,
  scoreSourceNote,
  scoringCardLine,
  turnOrder,
} from "@/lib/three-man-weave-state";
import type {
  ArenaResultView,
  TmwCandidateFit,
  TmwCandidatePublic,
  TmwMatchView,
  TmwPick,
  TmwPlayer,
  TmwPublicState,
  TmwRoster,
} from "@/types/three-man-weave";

/** An UNDRAFTED candidate: no scoring card exists on this payload at all. */
function candidate(overrides: Partial<TmwCandidatePublic> = {}): TmwCandidatePublic {
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
    ...overrides,
  };
}

/** A DRAFTED player: the candidate payload plus the card they are scored on.
 * The card belongs to the ROLLED franchise, which is the ruleset correction. */
function player(overrides: Partial<TmwPlayer> = {}): TmwPlayer {
  return {
    ...candidate(),
    scoring_card: {
      season: "2018-19",
      team_id: "TOR",
      team_name: "Toronto Raptors",
      prime_score: 84.0,
      score_source: "exact_team_stint",
      is_multi_team_season: false,
      formula_version: "peak3_v1",
    },
    ...overrides,
  };
}

function fit(overrides: Partial<TmwCandidateFit> = {}): TmwCandidateFit {
  return {
    player_slug: "kawhi-leonard",
    state: "fits_now",
    direct_slots: ["SF"],
    plan: null,
    moves: [],
    reason: null,
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
    current_roll: {
      round_number: 1,
      roll_id: "tor-2010s",
      franchise_id: "TOR",
      franchise_display_name: "Toronto Raptors",
      decade: "2010s",
      eligible_slugs: ["kawhi-leonard"],
      candidates: [candidate()],
    },
    ...overrides,
  };
}

function matchView(overrides: Partial<TmwMatchView> = {}): TmwMatchView {
  return {
    match_id: "m1",
    mode: "three_man_weave",
    mode_version: "tmw_ruleset_v2",
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
// Provenance: two facts, never merged
// ---------------------------------------------------------------------------
describe("eligibility vs scoring card", () => {
  it("describes eligibility by the franchise and the season that proves it", () => {
    expect(eligibilityLine(player())).toBe("Toronto Raptors · 2018-19");
  });

  it("describes the scoring card by the ROLLED franchise's own season", () => {
    // The ruleset correction, as an assertion. Kawhi's best 2010s season is
    // 2016-17 San Antonio; a Raptors roll must not reach for it.
    expect(scoringCardLine(player())).toBe("2018-19 Toronto Raptors · 1Y PEAK3 84.0");
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
    // It must NOT describe itself as a mean -- that is what it used to be,
    // and what it must never be mistaken for again.
    expect(rankingBasisLabel()).not.toMatch(/mean PEAK3 score/i);
    expect(rankingBasisLabel()).toMatch(/lineup-quality index/i);
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

  it("exports no way to render a projected record at all", async () => {
    // The 82-0 record projection is calibrated for an eight-card roster and
    // this mode plays six, so the helper was removed rather than hedged. A
    // component cannot print "64-18 projected" because nothing formats one.
    const stateLib = await import("@/lib/three-man-weave-state");
    expect("recordLine" in stateLib).toBe(false);
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

  it("reports the lineup score and the mean SEPARATELY, and no record", () => {
    const [row] = podium([result()]);
    expect(row.score.text).toBe("72.4");
    // The mean is carried for reading and is visibly not the basis.
    expect(row.meanSeasonScore).toBe(81.9);
    expect(row.meanSeasonScore).not.toBe(row.score.kind === "scored" ? row.score.value : null);
    // NO PROJECTED RECORD EXISTS on the row at all -- there is no field a
    // component could render one from.
    expect("record" in row).toBe(false);
  });

  it("names the basis without calling it an average", () => {
    const label = rankingBasisLabel();
    expect(label).toContain(RANKING_BASIS_LABEL);
    expect(label).toContain("lineup-quality index");
    expect(label).toContain("Not an average");
  });

  it("gives an unscoreable roster a real state on the podium", () => {
    const [row] = podium([
      result({
        score: 0,
        detail: { ...result().detail, score_status: "incomplete", lineup_score: null },
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
  it("annotates each candidate with THIS seat's fit verdict", () => {
    const match = matchView({
      private_state: {
        seat_index: 0,
        candidate_fits: { "kawhi-leonard": fit({ direct_slots: ["SF", "PF"] }) },
      },
    });
    const [entry] = candidatesForSeat(match);
    expect(entry.fit.direct_slots).toEqual(["SF", "PF"]);
    expect(entry.selectable).toBe(true);
    expect(fitLabel(entry)).toBe("Fits now");
  });

  it("carries NO scoring card for an undrafted candidate", () => {
    // The product rule, enforced by the payload rather than by remembering:
    // there is no field on a candidate a component could read a score from.
    const [entry] = candidatesForSeat(matchView());
    expect("scoring_card" in entry).toBe(false);
  });

  it("keeps an unusable candidate visible, disabled, with a reason", () => {
    // A player must be able to see that a strong name was on the board and
    // that their own roster shape is why they could not take them.
    const match = matchView({
      private_state: {
        seat_index: 0,
        candidate_fits: {
          "kawhi-leonard": fit({
            state: "no_legal_arrangement",
            direct_slots: [],
            reason: "Every slot they could play is filled.",
          }),
        },
      },
    });
    const candidates = candidatesForSeat(match);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].selectable).toBe(false);
    expect(fitLabel(candidates[0])).toBe("No legal arrangement");
    expect(candidates[0].fit.reason).toBeTruthy();
  });

  it("preserves the server's order and never re-sorts by anything", () => {
    // The list used to be sorted by `prime_score`, which made the number
    // visible whether or not it was printed: the right pick was the top row.
    const shaq = candidate({
      player_slug: "shaquille-o-neal",
      player_name: "Shaquille O'Neal",
      positions: ["C"],
    });
    const stockton = candidate({
      player_slug: "john-stockton",
      player_name: "John Stockton",
      positions: ["PG"],
    });
    const match = matchView({
      public_state: publicState({
        current_roll: {
          ...publicState().current_roll!,
          candidates: [shaq, stockton, candidate()],
        },
      }),
      private_state: {
        seat_index: 0,
        candidate_fits: {
          "john-stockton": fit({ player_slug: "john-stockton", direct_slots: ["PG"] }),
          "kawhi-leonard": fit(),
          "shaquille-o-neal": fit({
            player_slug: "shaquille-o-neal",
            state: "no_legal_arrangement",
            direct_slots: [],
            reason: "no room",
          }),
        },
      },
    });
    expect(candidatesForSeat(match).map((c) => c.player_slug)).toEqual([
      "shaquille-o-neal",
      "john-stockton",
      "kawhi-leonard",
    ]);
  });

  it("reorders on search by relevance, and by nothing else", () => {
    const stockton = candidate({
      player_slug: "john-stockton",
      player_name: "John Stockton",
    });
    const match = matchView({
      public_state: publicState({
        current_roll: {
          ...publicState().current_roll!,
          candidates: [candidate(), stockton],
        },
      }),
      private_state: { seat_index: 0, candidate_fits: {} },
    });
    const all = candidatesForSeat(match);
    expect(searchCandidates(all, "stock").map((c) => c.player_slug)).toEqual([
      "john-stockton",
    ]);
    expect(searchCandidates(all, "").map((c) => c.player_slug)).toEqual([
      "kawhi-leonard",
      "john-stockton",
    ]);
  });

  it("reports where a rearrangement would land a candidate, and what moves", () => {
    const match = matchView({
      private_state: {
        seat_index: 0,
        candidate_fits: {
          "kawhi-leonard": fit({
            state: "fits_after_rearrangement",
            direct_slots: [],
            plan: { SF: "kawhi-leonard", bench_1: "larry-bird" },
            moves: [
              { player_slug: "larry-bird", from_slot: "SF", to_slot: "bench_1" },
            ],
          }),
        },
      },
    });
    const [entry] = candidatesForSeat(match);
    expect(landingSlot(entry)).toBe("SF");
    expect(
      rearrangementSummary(entry, (slug) =>
        slug === "larry-bird" ? "Larry Bird" : slug,
      ),
    ).toBe("Larry Bird moves Small forward → Bench");
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


// ---------------------------------------------------------------------------
// The live edge
// ---------------------------------------------------------------------------
describe("the current edge", () => {
  it("reports an ordinal band and never a total", () => {
    const state = publicState({
      current_edge: {
        is_live: true,
        compared_after_picks: 2,
        seats: { "0": "leading", "1": "close_behind", "2": "needs_a_response" },
      },
    });
    expect(edgeBandFor(state, 0)).toBe("leading");
    expect(edgeBandFor(state, 2)).toBe("needs_a_response");
    expect(edgeQualifier(state)).toBe("Live · compared after 2 picks each");
  });

  it("says nothing at all once the draft is over", () => {
    const state = publicState({
      is_complete: true,
      current_edge: { is_live: false, compared_after_picks: 0, seats: {} },
    });
    expect(edgeBandFor(state, 0)).toBeNull();
    expect(edgeQualifier(state)).toBeNull();
  });
});
