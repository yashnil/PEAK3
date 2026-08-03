/**
 * RUN THE TABLE pure state layer.
 *
 * Every case here runs against FIXTURE objects shaped exactly like
 * `public_state()` / `build_receipt()` output — never a live server. That is
 * the point: these helpers must be provably server-driven, so a test that
 * needed the API running would be testing the wrong thing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DECIDED_BY_LABELS,
  LANE_LABELS,
  LANE_TOKEN_BY_FIELD,
  OVERALL_PERCENTILE_BASIS,
  NODE_TYPE_LABELS,
  ROLE_LABELS,
  battleVerdict,
  buildRunShareText,
  challengeUrl,
  clearActiveRun,
  currentBattle,
  decisiveLane,
  describeCostModifiers,
  draftOffers,
  filledCount,
  formatReceiptItem,
  formatSigned,
  isStaleDailyPointer,
  isTerminal,
  isTradeLegal,
  formatCostModifier,
  ladderProgress,
  ladderRows,
  laneColorVar,
  laneSentence,
  loadActiveRun,
  makeIdempotencyKey,
  outgoingAdvisory,
  percentileSentence,
  percentileShort,
  receiptItemColorVar,
  receiptItems,
  receiptLaneProfile,
  runOutcome,
  runVerdict,
  rosterPips,
  runningSeries,
  saveActiveRun,
  cardLaneSummary,
  bossBriefing,
  screenForStatus,
  shouldClearStoredRun,
  signedColorVar,
  slotLabel,
  systemLabel,
  trackRunTheTable,
  tradeIncoming,
  tradeNetCost,
  tradeOutgoing,
} from "@/lib/run-the-table-state";
import {
  ActiveNode,
  BattleLanePublic,
  BattlePublic,
  LaneField,
  MapAct,
  RunPublicState,
  RunReceipt,
  RunStatus,
  StoredActiveRun,
  RUN_THE_TABLE_STORAGE_KEY,
} from "@/types/run-the-table";
import { ordinal, ordinalFixed, ordinalSuffix } from "@/lib/ordinal";

// ---------------------------------------------------------------------------
// Fixtures — shaped field-for-field like the API contract
// ---------------------------------------------------------------------------

function lane(
  over: Partial<BattleLanePublic> & Pick<BattleLanePublic, "lane" | "winner">,
): BattleLanePublic {
  return {
    label: "Statistical Impact",
    token: "si",
    margin: 4.25,
    tie_broken_by_rule: false,
    // -- contract fields (SYNTHESIS_CONTRACT.md §2.3) ----------------------
    player_lineup_rating: 62.5,
    boss_lineup_rating: 58.25,
    pre_perk_rating: 62.5,
    perk_adjustment: 0,
    bench_adjustment: 0,
    final_rating: 62.5,
    top_contributor: null,
    opponent_top_contributor: null,
    ...over,
  };
}

function battle(over: Partial<BattlePublic> = {}): BattlePublic {
  return {
    boss_id: "boss-a1",
    act: 1,
    outcome: "win",
    decided_by: "lanes",
    player_lanes_won: 3,
    opponent_lanes_won: 2,
    ties: 0,
    summed_margin: 6.5,
    player_roster_total: 61.2,
    opponent_roster_total: 59.9,
    bench_weight: 0.35,
    rule_id: "the_wall",
    credits_awarded: 12,
    lives_after: 3,
    lanes: [
      lane({ lane: "statistical_impact", winner: "player" }),
      lane({ lane: "traditional_production", winner: "opponent", token: "tp" }),
      lane({ lane: "individual_recognition", winner: "player", token: "rec" }),
      lane({ lane: "postseason_individual_value", winner: "opponent", token: "po" }),
      lane({ lane: "team_achievement", winner: "player", token: "team" }),
    ],
    ...over,
  };
}

function mapFixture(): MapAct[] {
  return [1, 2, 3].map((act) => ({
    act,
    stages: [1, 2].map((stage) => ({
      act,
      stage,
      state: act === 1 ? "done" : act === 2 && stage === 1 ? "current" : "locked",
      chosen_node_id: act === 1 ? `a${act}s${stage}-draft` : null,
      chosen_node_type: act === 1 ? ("draft_room" as const) : null,
      option_types: ["draft_room" as const, "film_room" as const],
      scouted: act === 2 && stage === 2,
    })),
    boss: {
      boss_id: `boss-a${act}`,
      name: `Boss ${act}`,
      state: act === 1 ? ("won" as const) : ("locked" as const),
    },
  }));
}

function receiptFixture(over: Partial<RunReceipt> = {}): RunReceipt {
  const laneFields: LaneField[] = [
    "statistical_impact",
    "traditional_production",
    "individual_recognition",
    "postseason_individual_value",
    "team_achievement",
  ];
  return {
    verdict: "RUN COMPLETE",
    headline: "Ran the table.",
    story: "Moneyball — defeated all three bosses with Tim Duncan 2002-03 as run MVP.",
    ran_the_table: true,
    bosses_defeated: 3,
    battles_lost: 0,
    record: "3-0",
    lives_remaining: 2,
    systems: [{ id: "moneyball", name: "Moneyball", summary: "Cheap cards cost 35% less." }],
    starters: [],
    bench: [],
    lane_profile: laneFields.map((l, i) => ({
      lane: l,
      label: `Lane ${i}`,
      value: 50 + i,
      lanes_won: i % 2,
    })),
    roster_total: 63.4,
    strongest_lane: { lane: "team_achievement", label: "Team Result", value: 54 },
    weakest_lane: { lane: "statistical_impact", label: "Statistical Impact", value: 50 },
    run_mvp: {
      card_id: "tim-duncan-3yr-200203",
      player_name: "Tim Duncan",
      player_slug: "tim-duncan",
      anchor_season: "2002-03",
      window: "2001-02–2003-04",
      prime_score: 91.2,
      base_cost: 24,
      marginal_contribution: 7.4211,
      is_starter: true,
    },
    marginal_contributions: [],
    best_acquisition: {
      card_id: "x",
      player_name: "Sidney Moncrief",
      player_slug: "sidney-moncrief",
      anchor_season: "1982-83",
      window: "1981-82–1983-84",
      prime_score: 78,
      base_cost: 12,
      cost: 9,
      score_delta: 11.4,
      value_per_credit: 1.2667,
      replaced: null,
      act: 2,
    },
    best_trade: null,
    closest_battle: {
      boss_id: "boss-a2",
      act: 2,
      outcome: "win",
      lanes: "3-2",
      tightest_lane_margin: 0.14,
      summed_margin: 2.1,
    },
    credits_spent: 33,
    credits_refunded: 4,
    credits_remaining: 15,
    starting_credits: 40,
    reasons: [
      { kind: "lane_strength", text: "Statistical Impact won 3 of 3 battles.", signed_value: 3 },
      { kind: "economy", text: "Finished holding 15 unspent credits.", signed_value: -15 },
    ],
    battles: [],
    seed: 123456,
    run_type: "standard",
    date: null,
    versions: {
      engine_version: "run_the_table_v1",
      ruleset_version: "rtt_ruleset_v1",
      card_pool_version: "v3",
      peak3_model_version: "peak3_official_weights_v1",
    },
    ...over,
  };
}

function runFixture(over: Partial<RunPublicState> = {}): RunPublicState {
  return {
    run_id: "run-1",
    seed: 123456,
    run_type: "standard",
    date: null,
    status: "node_select",
    act: 1,
    stage: 1,
    acts_total: 3,
    stages_per_act: 2,
    credits: 40,
    lives: 3,
    max_lives: 3,
    starting_credits: 40,
    starters: [
      { slot_id: "lead_creator", role: "lead_creator", is_starter: true, card: null },
      { slot_id: "guard_wing", role: "guard_wing", is_starter: true, card: null },
      { slot_id: "wing_forward", role: "wing_forward", is_starter: true, card: null },
      { slot_id: "forward_big", role: "forward_big", is_starter: true, card: null },
      { slot_id: "anchor", role: "anchor", is_starter: true, card: null },
    ],
    bench: [
      { slot_id: "bench_1", role: null, is_starter: false, card: null },
      { slot_id: "bench_2", role: null, is_starter: false, card: null },
    ],
    systems: [],
    pending_system_offer: null,
    stage_options: null,
    active_node: null,
    next_boss: null,
    map: mapFixture(),
    battles: [],
    lane_profile: [],
    roster_total: 0,
    bench_weight: 0.35,
    veteran_minimum_used_this_act: false,
    action_count: 0,
    receipt: null,
    versions: receiptFixture().versions,
    created_at: "2026-07-31T00:00:00Z",
    last_action_at: "2026-07-31T00:00:00Z",
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe("run-the-table persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns null when nothing is stored", () => {
    expect(loadActiveRun()).toBeNull();
  });

  it("round-trips a saved run pointer, including the server's daily key", () => {
    saveActiveRun(
      { run_id: "run-9", seed: 42, run_type: "daily", date: "2026-07-31" },
      new Date("2026-07-31T12:00:00Z"),
    );
    expect(loadActiveRun()).toEqual({
      schema_version: 1,
      run_id: "run-9",
      seed: 42,
      run_type: "daily",
      run_date: "2026-07-31",
      updated_at: "2026-07-31T12:00:00.000Z",
    });
  });

  it("stores a null run_date for a run that belongs to no day", () => {
    saveActiveRun({ run_id: "run-9", seed: 42, run_type: "standard", date: null });
    expect(loadActiveRun()?.run_date).toBeNull();
  });

  it("reads a legacy pointer written before run_date existed as run_date null", () => {
    window.localStorage.setItem(
      RUN_THE_TABLE_STORAGE_KEY,
      JSON.stringify({
        schema_version: 1,
        run_id: "old",
        seed: 1,
        run_type: "daily",
        updated_at: "2026-07-30T00:00:00.000Z",
      }),
    );
    expect(loadActiveRun()).toMatchObject({ run_id: "old", run_date: null });
  });

  it("never throws on unparseable JSON — it returns null", () => {
    window.localStorage.setItem(RUN_THE_TABLE_STORAGE_KEY, "{not json");
    expect(loadActiveRun()).toBeNull();
  });

  it("rejects a payload from a different schema version", () => {
    window.localStorage.setItem(
      RUN_THE_TABLE_STORAGE_KEY,
      JSON.stringify({ schema_version: 99, run_id: "x", seed: 1, run_type: "standard" }),
    );
    expect(loadActiveRun()).toBeNull();
  });

  it.each([
    ["missing run_id", { schema_version: 1, seed: 1, run_type: "standard" }],
    ["empty run_id", { schema_version: 1, run_id: "", seed: 1, run_type: "standard" }],
    ["non-numeric seed", { schema_version: 1, run_id: "x", seed: "1", run_type: "standard" }],
    ["unknown run_type", { schema_version: 1, run_id: "x", seed: 1, run_type: "sandbox" }],
    ["not an object", 7],
  ])("rejects %s", (_label, payload) => {
    window.localStorage.setItem(RUN_THE_TABLE_STORAGE_KEY, JSON.stringify(payload));
    expect(loadActiveRun()).toBeNull();
  });

  it("clears the pointer", () => {
    saveActiveRun({ run_id: "run-9", seed: 42, run_type: "standard", date: null });
    clearActiveRun();
    expect(loadActiveRun()).toBeNull();
  });

  it("drops the pointer for 404/409/410 and keeps it for transient failures", () => {
    expect(shouldClearStoredRun(404)).toBe(true);
    expect(shouldClearStoredRun(409)).toBe(true);
    expect(shouldClearStoredRun(410)).toBe(true);
    expect(shouldClearStoredRun(500)).toBe(false);
    expect(shouldClearStoredRun(0)).toBe(false);
  });

  /**
   * THE STALE-DAILY BUG. `StoredActiveRun` carried no date, `getRun` returns
   * 200 for yesterday's daily, and `shouldClearStoredRun` only fires on
   * 404/409/410 — so an unfinished daily was resumed today, and every day
   * after, and the start gate never appeared again.
   */
  describe("stale daily pointer", () => {
    const pointer = (over: Partial<StoredActiveRun> = {}): StoredActiveRun => ({
      schema_version: 1,
      run_id: "run-1",
      seed: 1,
      run_type: "daily",
      run_date: "2026-07-30",
      updated_at: "2026-07-30T12:00:00.000Z",
      ...over,
    });

    it("discards yesterday's daily", () => {
      expect(isStaleDailyPointer(pointer(), "2026-07-31")).toBe(true);
    });

    it("keeps today's daily", () => {
      expect(isStaleDailyPointer(pointer({ run_date: "2026-07-31" }), "2026-07-31")).toBe(false);
    });

    it("discards a legacy daily pointer that cannot prove it is today", () => {
      expect(isStaleDailyPointer(pointer({ run_date: null }), "2026-07-31")).toBe(true);
    });

    it("never discards a standard or challenge run — they belong to no day", () => {
      expect(isStaleDailyPointer(pointer({ run_type: "standard" }), "2026-07-31")).toBe(false);
      expect(isStaleDailyPointer(pointer({ run_type: "challenge" }), "2026-07-31")).toBe(false);
    });

    /** A failed daily-descriptor fetch must never throw away a run in
     *  progress: unknown is not the same as stale. */
    it("keeps everything when the server's daily key is unknown", () => {
      expect(isStaleDailyPointer(pointer(), null)).toBe(false);
      expect(isStaleDailyPointer(pointer(), undefined)).toBe(false);
    });

    it("has nothing to do when there is no pointer", () => {
      expect(isStaleDailyPointer(null, "2026-07-31")).toBe(false);
    });
  });
});

describe("screen derivation", () => {
  it.each<[RunStatus, string]>([
    ["system_select", "system_select"],
    ["node_select", "node_select"],
    ["node_active", "node_active"],
    ["boss_ready", "boss_preview"],
    ["boss_resolved", "battle"],
    ["complete", "result"],
    ["failed", "result"],
  ])("maps %s to %s", (status, screen) => {
    expect(screenForStatus(status)).toBe(screen);
  });

  it("treats only complete and failed as terminal", () => {
    expect(isTerminal("complete")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("boss_resolved")).toBe(false);
  });
});

describe("labels and tokens", () => {
  it("labels a starter slot by role and a bench slot by number", () => {
    expect(slotLabel({ slot_id: "anchor", role: "anchor", is_starter: true })).toBe("Anchor");
    expect(slotLabel({ slot_id: "bench_2", role: null, is_starter: false })).toBe("Bench 2");
    expect(slotLabel({ slot_id: "mystery", role: null, is_starter: false })).toBe("mystery");
  });

  it("has a label for all five roles and all four node types", () => {
    expect(Object.keys(ROLE_LABELS)).toHaveLength(5);
    expect(Object.keys(NODE_TYPE_LABELS)).toHaveLength(4);
  });

  it("maps every lane onto its --comp-* token", () => {
    expect(LANE_TOKEN_BY_FIELD.statistical_impact).toBe("si");
    expect(LANE_TOKEN_BY_FIELD.postseason_individual_value).toBe("po");
    expect(laneColorVar("team")).toBe("var(--comp-team)");
  });

  it("adapts the receipt lane profile, which carries no token", () => {
    const adapted = receiptLaneProfile(receiptFixture().lane_profile);
    expect(adapted).toHaveLength(5);
    expect(adapted[0].token).toBe("si");
    expect(adapted[4].token).toBe("team");
    expect(adapted[2].value).toBe(52);
  });
});

describe("run ladder", () => {
  it("emits two stage rows then a boss row for each of three acts", () => {
    const rows = ladderRows(mapFixture());
    expect(rows).toHaveLength(9);
    expect(rows.map((r) => r.kind)).toEqual([
      "stage",
      "stage",
      "boss",
      "stage",
      "stage",
      "boss",
      "stage",
      "stage",
      "boss",
    ]);
  });

  it("shows the chosen node for a resolved stage and only the SHAPE for a locked one", () => {
    const rows = ladderRows(mapFixture());
    expect(rows[0].sublabel).toBe("Draft Room");
    // "Scout & Prepare", not "Film Room": the engine node_type id is unchanged
    // (every switch resolves on it) but the node's player-facing identity moved
    // with rtt_ruleset_v3, and the ladder is one of the surfaces that prints it.
    expect(rows[7].sublabel).toBe("Draft Room or Scout & Prepare");
  });

  it("carries the scouted flag through", () => {
    const rows = ladderRows(mapFixture());
    expect(rows.find((r) => r.key === "a2s2")?.scouted).toBe(true);
    expect(rows.find((r) => r.key === "a2s1")?.scouted).toBe(false);
  });

  it("counts resolved rows for the mobile progress strip", () => {
    expect(ladderProgress(mapFixture())).toEqual({ done: 3, total: 9 });
  });
});

describe("node narrowing", () => {
  const draft: ActiveNode = {
    node_id: "n1",
    node_type: "draft_room",
    title: "Draft Room",
    summary: "s",
    offers: [{ card_id: "c1" }] as never,
    can_pass: true,
  };
  const trade: ActiveNode = {
    node_id: "n2",
    node_type: "trade_desk",
    title: "Trade Desk",
    summary: "s",
    incoming: [{ card_id: "c2", legal_slots: ["anchor"] }] as never,
    outgoing_options: [{ slot_id: "anchor" }] as never,
    can_decline: true,
  };

  it("only reads a block when the node type matches", () => {
    expect(draftOffers(draft)).toHaveLength(1);
    expect(draftOffers(trade)).toEqual([]);
    expect(tradeIncoming(trade)).toHaveLength(1);
    expect(tradeIncoming(draft)).toEqual([]);
    expect(tradeOutgoing(trade)).toHaveLength(1);
    expect(tradeOutgoing(null)).toEqual([]);
  });

  it("reads trade legality off the server's legal_slots, never a re-derivation", () => {
    const incoming = { legal_slots: ["anchor", "forward_big"] } as never as Parameters<
      typeof isTradeLegal
    >[0];
    expect(isTradeLegal(incoming, "anchor")).toBe(true);
    expect(isTradeLegal(incoming, "lead_creator")).toBe(false);
  });

  it("nets an incoming cost against the outgoing refund the server sent", () => {
    expect(
      tradeNetCost({ cost: 18 } as never, { refund: 6 } as never),
    ).toBe(12);
    expect(tradeNetCost({ cost: 4 } as never, { refund: 9 } as never)).toBe(-5);
  });
});

describe("roster derivations", () => {
  it("counts filled slots", () => {
    const state = runFixture();
    expect(filledCount(state.starters)).toBe(0);
    state.starters[0].card = { player_name: "X" } as never;
    expect(filledCount(state.starters)).toBe(1);
  });

  it("emits seven pips, starters first", () => {
    const pips = rosterPips(runFixture());
    expect(pips).toHaveLength(7);
    expect(pips.slice(0, 5).every((p) => p.is_starter)).toBe(true);
    expect(pips.slice(5).every((p) => !p.is_starter)).toBe(true);
    expect(pips.every((p) => p.filled === false)).toBe(true);
  });
});

describe("battle derivations", () => {
  it("picks the battle for the current act", () => {
    const b1 = battle({ act: 1 });
    const b2 = battle({ act: 2, boss_id: "boss-a2" });
    expect(currentBattle(runFixture({ battles: [b1, b2], act: 2 }))?.boss_id).toBe("boss-a2");
    expect(currentBattle(runFixture({ battles: [] }))).toBeNull();
  });

  it("falls back to the most recent battle when no battle matches the act", () => {
    const b1 = battle({ act: 1 });
    expect(currentBattle(runFixture({ battles: [b1], act: 3 }))?.act).toBe(1);
  });

  it("counts the running series only over the lanes revealed so far", () => {
    const lanes = battle().lanes;
    expect(runningSeries(lanes, 0)).toEqual({ player: 0, opponent: 0, ties: 0 });
    expect(runningSeries(lanes, 2)).toEqual({ player: 1, opponent: 1, ties: 0 });
    expect(runningSeries(lanes, 5)).toEqual({ player: 3, opponent: 2, ties: 0 });
  });

  it("clamps the reveal count rather than reading past the array", () => {
    const lanes = battle().lanes;
    expect(runningSeries(lanes, 99)).toEqual(runningSeries(lanes, 5));
    expect(runningSeries(lanes, -3)).toEqual({ player: 0, opponent: 0, ties: 0 });
  });

  it("counts ties as neither side's lane", () => {
    const lanes = [
      lane({ lane: "statistical_impact", winner: "tie" }),
      lane({ lane: "team_achievement", winner: "player" }),
    ];
    expect(runningSeries(lanes, 2)).toEqual({ player: 1, opponent: 0, ties: 1 });
  });

  it("stamps a verdict that names the tiebreak the engine actually used", () => {
    expect(battleVerdict(battle()).stamp).toBe("VICTORY");
    expect(battleVerdict(battle({ outcome: "loss" })).stamp).toBe("DEFEAT");
    expect(battleVerdict(battle({ outcome: "draw" })).stamp).toBe("DRAW");
    expect(battleVerdict(battle({ decided_by: "summed_margin" })).detail).toContain(
      DECIDED_BY_LABELS.summed_margin,
    );
    expect(battleVerdict(battle()).detail).toContain("3–2");
  });

  it("writes one screen-reader sentence per lane, flagging a rule-broken tie", () => {
    // "lineup rating", never "score" or "total" — the number is a
    // bench-weighted mean across the roster, not any one player's value
    // (SCORE_RECONCILIATION.md §2), and the sentence must not imply otherwise.
    expect(laneSentence(lane({ lane: "statistical_impact", winner: "player" }))).toBe(
      "Statistical Impact lineup rating: 62.5 to 58.3. You win.",
    );
    expect(
      laneSentence(lane({ lane: "team_achievement", winner: "tie", tie_broken_by_rule: true })),
    ).toContain("boss rule broke the tie");
  });

  it("announces the top contributor's own value separately from the lineup rating", () => {
    const withContributors = lane({
      lane: "statistical_impact",
      winner: "player",
      top_contributor: { name: "Tim Duncan", own_lane_index_value: 71 },
      opponent_top_contributor: { name: "Kevin Garnett", own_lane_index_value: 69 },
    });
    const sentence = laneSentence(withContributors);
    expect(sentence).toContain("Top contributor: Tim Duncan 71.0 vs Kevin Garnett 69.0.");
  });
});

describe("number formatting", () => {
  it("never drops the sign on a positive delta", () => {
    expect(formatSigned(3.4)).toBe("+3.4");
    expect(formatSigned(-3.44, 2)).toBe("-3.44");
    expect(formatSigned(0)).toBe("0.0");
    expect(formatSigned(Number.NaN)).toBe("—");
  });

  it("stays neutral at exactly zero rather than claiming a gain", () => {
    expect(signedColorVar(1)).toBe("var(--correct)");
    expect(signedColorVar(-1)).toBe("var(--incorrect)");
    expect(signedColorVar(0)).toBe("var(--text-muted)");
  });
});

describe("share text", () => {
  it("says only what the receipt proves", () => {
    const text = buildRunShareText(receiptFixture(), "peak3.app/x");
    expect(text).toContain("PEAK3 — RUN THE TABLE");
    expect(text).toContain("Ran the table.");
    expect(text).toContain("Record: 3-0");
    expect(text).toContain("Run MVP: Tim Duncan 2002-03 (+7.4 roster total)");
    expect(text).toContain("Seed 123456");
    expect(text).toContain("peak3.app/x");
    // No rank and no percentile — there is no global leaderboard to back one.
    expect(text.toLowerCase()).not.toContain("rank");
    expect(text.toLowerCase()).not.toContain("percentile");
  });

  it("omits an MVP and a best buy the receipt does not have", () => {
    const text = buildRunShareText(receiptFixture({ run_mvp: null, best_acquisition: null }));
    expect(text).not.toContain("Run MVP");
    expect(text).not.toContain("Best buy");
  });

  it("builds the challenge link the RUN THE TABLE route can actually open", () => {
    // NOT `/c/{token}`. That route is Peak Draft's challenge page and resolves
    // tokens through /api/v1/draft/challenges/{token}/meta, so a RUN THE TABLE
    // token sent there lands the recipient on a not-found screen. The mode's
    // own route reads its token from `?c=`.
    expect(challengeUrl("abc123", "https://peak3.app")).toBe(
      "https://peak3.app/arena/run-the-table?c=abc123",
    );
    expect(challengeUrl("abc123", "")).toBe("/arena/run-the-table?c=abc123");
    expect(challengeUrl("abc123", "https://peak3.app")).not.toContain("/c/abc123");
  });
});

describe("idempotency keys", () => {
  it("is stable for a given nonce, so a retry is not a second buy", () => {
    const a = makeIdempotencyKey("run-1", "buy:card:anchor", "n1");
    const b = makeIdempotencyKey("run-1", "buy:card:anchor", "n1");
    expect(a).toBe(b);
    expect(a).toBe("n1:run-1:buy:card:anchor");
  });

  it("stays inside the API's 128-character bound, nonce first", () => {
    const key = makeIdempotencyKey("r".repeat(60), `buy:${"c".repeat(120)}:anchor`, "nonce-1");
    expect(key.length).toBeLessThanOrEqual(128);
    expect(key.startsWith("nonce-1:")).toBe(true);
  });

  it("differs between gestures", () => {
    expect(makeIdempotencyKey("run-1", "a")).not.toBe(makeIdempotencyKey("run-1", "a"));
  });
});

describe("analytics", () => {
  it("emits RUN THE TABLE events without touching lib/analytics", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    trackRunTheTable({ type: "rtt_run_started", run_type: "daily", seed: 7 });
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][1]).toBe("rtt_run_started");
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Cost modifiers — the `[object Object]` fix
// ---------------------------------------------------------------------------

describe("cost modifiers", () => {
  /**
   * `cost_modifiers` is `list[dict]` on the server
   * (`nba_peak/run_the_table/pricing.py:74-86`) and was typed `string[]` here,
   * so `RunCard` did `.join(" · ")` on objects and printed "[object Object]".
   * These helpers are the replacement, and they are pure: every number in the
   * output came off the payload.
   */
  it("turns one engine modifier into a sentence with all four of its fields", () => {
    expect(
      formatCostModifier({ system_id: "moneyball", discount_pct: 35, before: 20, after: 13 }),
    ).toBe("Moneyball · −35% (20 → 13)");
    expect(
      formatCostModifier({ system_id: "two_way_value", discount_pct: 25, before: 19, after: 14 }),
    ).toBe("Two-Way Value · −25% (19 → 14)");
  });

  it("never emits [object Object], whatever the list holds", () => {
    const out = describeCostModifiers([
      { system_id: "moneyball", discount_pct: 35, before: 20, after: 13 },
      { system_id: "no_hardware", discount_pct: 30, before: 13, after: 9 },
    ]);
    expect(out).toHaveLength(2);
    expect(out.join(" ")).not.toContain("[object Object]");
    expect(String(out)).not.toContain("[object Object]");
  });

  it("keeps every shipped System id readable, and de-slugs an unknown one", () => {
    expect(systemLabel("moneyball")).toBe("Moneyball");
    expect(systemLabel("no_hardware")).toBe("No Hardware");
    expect(systemLabel("two_way_value")).toBe("Two-Way Value");
    expect(systemLabel("deep_rotation")).toBe("Deep Rotation");
    expect(systemLabel("trade_machine")).toBe("Trade Machine");
    expect(systemLabel("veteran_minimum")).toBe("Veteran Minimum");
    // Never a raw enum in user-visible copy.
    expect(systemLabel("brand_new_perk")).toBe("Brand New Perk");
  });
});

// ---------------------------------------------------------------------------
// Percentile basis
// ---------------------------------------------------------------------------

describe("overall percentile basis", () => {
  /**
   * VERIFIED against `nba_peak/run_the_table/cards.py:143-201`:
   * `overall_pcts = _percentile_ranks(prime_scores)` is computed over
   * `selected`, i.e. every 3-year card profile that is not `excluded` and has
   * at least one eligible role. The denominator is therefore the RUN THE TABLE
   * card pool — not "all PEAK3 3-year peak windows", which is a larger and
   * different set.
   */
  it("names the pool, not the whole PEAK3 window universe", () => {
    expect(percentileSentence(75.1)).toBe(
      "75.1st percentile of the Run the Table card pool — every eligible PEAK3 3-year peak window",
    );
    expect(OVERALL_PERCENTILE_BASIS).not.toMatch(/all PEAK3/i);
  });

  /**
   * THE ORDINAL BUG. This function appended "th" unconditionally, so every
   * card in the Draft Room and both Trade Desk columns rendered "75.1th".
   */
  it("ordinalises the percentile instead of always saying 'th'", () => {
    expect(percentileShort(75.1)).toBe("75.1st percentile of the card pool");
    expect(percentileShort(21.2)).toBe("21.2nd percentile of the card pool");
    expect(percentileShort(96.3)).toBe("96.3rd percentile of the card pool");
    expect(percentileShort(1.0)).toBe("1.0th percentile of the card pool");
    expect(percentileSentence(75.1)).not.toContain("75.1th");
  });

  it("still says what the percentile is OF, in the short form too", () => {
    expect(percentileShort(50).toLowerCase()).toContain("card pool");
  });
});

// ---------------------------------------------------------------------------
// Ordinals
// ---------------------------------------------------------------------------

describe("ordinal", () => {
  /**
   * Three surfaces grew their own broken copy of this while a correct one sat
   * unexported in `rankings-receipts.ts`: `percentileSentence` ("th" always),
   * `RunCard.tsx` (a hard-coded "th" JSX text node) and `decisiveLane`
   * (`lanesToWin === 3 ? "rd" : "th"`, which prints "1th lane" for anything
   * else). The teens are the half every hand-rolled version forgets.
   */
  it.each<[number, string]>([
    [1, "1st"],
    [2, "2nd"],
    [3, "3rd"],
    [4, "4th"],
    [11, "11th"],
    [12, "12th"],
    [13, "13th"],
    [21, "21st"],
    [22, "22nd"],
    [23, "23rd"],
    [101, "101st"],
    [111, "111th"],
    [0, "0th"],
  ])("renders %i as %s", (n, expected) => {
    expect(ordinal(n)).toBe(expected);
  });

  it("exposes the bare suffix too", () => {
    expect(ordinalSuffix(1)).toBe("st");
    expect(ordinalSuffix(13)).toBe("th");
    expect(ordinalSuffix(22)).toBe("nd");
  });

  it("follows the last PRINTED digit for a fixed-decimal value", () => {
    expect(ordinalFixed(75.1, 1)).toBe("75.1st");
    expect(ordinalFixed(11.1, 1)).toBe("11.1st");
    expect(ordinalFixed(21.0, 1)).toBe("21.0th");
    expect(ordinalFixed(0.96, 1)).toBe("1.0th");
    expect(ordinalFixed(3, 0)).toBe("3rd");
  });

  it("never throws on a non-finite value", () => {
    expect(ordinalSuffix(Number.NaN)).toBe("th");
    expect(ordinal(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });
});

// ---------------------------------------------------------------------------
// Lane labels
// ---------------------------------------------------------------------------

describe("lane labels", () => {
  it("uses the pinned user-facing names for the two renamed components", () => {
    // `component-labels.test.ts` pins these; the canonical FIELD names above
    // them are never renamed.
    expect(LANE_LABELS.postseason_individual_value).toBe("Playoff Rate Impact");
    expect(LANE_LABELS.team_achievement).toBe("Team Result");
    expect(LANE_LABELS.statistical_impact).toBe("Statistical Impact");
    expect(LANE_LABELS.traditional_production).toBe("Traditional Production");
    expect(LANE_LABELS.individual_recognition).toBe("Individual Recognition");
  });
});

// ---------------------------------------------------------------------------
// The decisive lane
// ---------------------------------------------------------------------------

describe("decisive lane", () => {
  function lanesWon(pattern: ("player" | "opponent" | "tie")[]): BattleLanePublic[] {
    const fields: LaneField[] = [
      "statistical_impact",
      "traditional_production",
      "individual_recognition",
      "postseason_individual_value",
      "team_achievement",
    ];
    return pattern.map((winner, i) => lane({ lane: fields[i], winner }));
  }

  it("names the lane at which the winner reached the threshold", () => {
    const b = battle({ lanes: lanesWon(["player", "opponent", "player", "player", "opponent"]) });
    const d = decisiveLane(b, 3);
    expect(d.lane?.lane).toBe("postseason_individual_value");
    expect(d.sentence).toContain("3rd lane you won");
  });

  it("names the opponent's threshold lane on a loss", () => {
    const b = battle({
      outcome: "loss",
      lanes: lanesWon(["opponent", "opponent", "player", "opponent", "player"]),
    });
    const d = decisiveLane(b, 3);
    expect(d.lane?.lane).toBe("postseason_individual_value");
    expect(d.sentence).toContain("their 3rd lane");
  });

  it("nominates no lane at all when neither side got there, and defers to the engine", () => {
    const b = battle({
      decided_by: "summed_margin",
      lanes: lanesWon(["player", "opponent", "tie", "player", "opponent"]),
    });
    const d = decisiveLane(b, 3);
    expect(d.lane).toBeNull();
    expect(d.sentence).toContain(DECIDED_BY_LABELS.summed_margin);
  });

  /**
   * The ordinal was `lanesToWin === 3 ? "rd" : "th"` — correct for the single
   * value the ruleset ships today and wrong for every other, printing
   * "1th lane" and "2th lane". Track D may retune `LANES_TO_WIN`, so the
   * threshold is swept rather than spot-checked at 3.
   */
  it.each<[number, string]>([
    [1, "1st lane you won"],
    [2, "2nd lane you won"],
    [3, "3rd lane you won"],
    [11, "11th lane you won"],
    [12, "12th lane you won"],
    [13, "13th lane you won"],
    [21, "21st lane you won"],
    [22, "22nd lane you won"],
    [23, "23rd lane you won"],
  ])("ordinalises a threshold of %i correctly", (lanesToWin, expected) => {
    const b = battle({
      lanes: Array.from({ length: lanesToWin }, (_, i) =>
        lane({ lane: "statistical_impact", winner: "player", label: `Lane ${i}` }),
      ),
    });
    expect(decisiveLane(b, lanesToWin).sentence).toContain(expected);
  });

  /** The specific strings the old ternary produced. */
  it("never prints '1th lane' or '2th lane'", () => {
    for (const n of [1, 2, 21, 22]) {
      const b = battle({
        lanes: Array.from({ length: n }, (_, i) =>
          lane({ lane: "statistical_impact", winner: "player", label: `Lane ${i}` }),
        ),
      });
      expect(decisiveLane(b, n).sentence).not.toMatch(/\b(1|2|21|22)th\b/);
    }
  });

  it("ordinalises the opponent's threshold lane too", () => {
    const b = battle({
      outcome: "loss",
      lanes: lanesWon(["opponent", "opponent", "player", "opponent", "player"]),
    });
    expect(decisiveLane(b, 3).sentence).toContain("their 3rd lane");
    const one = battle({ lanes: lanesWon(["opponent", "player", "player", "player", "player"]) });
    expect(decisiveLane(one, 1).sentence).toContain("their 1st lane");
  });
});

// ---------------------------------------------------------------------------
// Semantic receipt items (plan §2.3)
// ---------------------------------------------------------------------------

describe("receipt items", () => {
  it("colours by kind and by nothing else", () => {
    expect(receiptItemColorVar("benefit")).toBe("var(--correct)");
    expect(receiptItemColorVar("cost")).toBe("var(--incorrect)");
    expect(receiptItemColorVar("neutral")).toBe("var(--text-muted)");
    expect(receiptItemColorVar("record")).toBe("var(--text-secondary)");
  });

  /**
   * THE BUG THIS KILLS. `receipt.py:235` emitted `"signed_value": -credits`,
   * negating a HOLDING purely to force a red colour, and the component printed
   * the field it coloured with — so the receipt said "Finished holding 68
   * unspent credits" beside -68.0, two sections below a Credits block that
   * said `finished holding 68`.
   */
  it("prints a neutral holding as its true magnitude, unnegated and unmuted-red", () => {
    const item = { kind: "neutral" as const, label: "Finished holding 68 unspent credits", value: 68, unit: "credits" as const };
    expect(formatReceiptItem(item)).toBe("68");
    expect(formatReceiptItem(item)).not.toContain("-");
    expect(receiptItemColorVar(item.kind)).not.toBe("var(--incorrect)");
  });

  it("uses `display` verbatim when the engine supplied one", () => {
    expect(
      formatReceiptItem({ kind: "record", label: "Lanes won", display: "3 of 5 lanes" }),
    ).toBe("3 of 5 lanes");
  });

  it("formats by unit, and renders an em dash rather than 'undefined'", () => {
    expect(formatReceiptItem({ kind: "cost", label: "x", value: 33, unit: "credits" })).toBe("33");
    expect(formatReceiptItem({ kind: "benefit", label: "x", value: 3, unit: "lanes" })).toBe("3");
    expect(formatReceiptItem({ kind: "benefit", label: "x", value: 7.42, unit: "score" })).toBe("7.4");
    expect(formatReceiptItem({ kind: "neutral", label: "x", value: 75.12, unit: "percentage" })).toBe("75.1%");
    expect(formatReceiptItem({ kind: "record", label: "x" })).toBe("—");
  });

  it("prefers the engine's `items` when it sent them", () => {
    const items = [{ kind: "benefit" as const, label: "New shape", value: 1 }];
    expect(receiptItems({ items, reasons: [{ kind: "economy", text: "old", signed_value: -9 }] })).toBe(items);
  });

  /** Plan §2.4: completed v1 receipts must stay readable. */
  it("falls back to the deprecated reasons[] so an old saved receipt still renders", () => {
    const out = receiptItems(receiptFixture());
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ kind: "benefit", label: "Statistical Impact won 3 of 3 battles." });
    // The v1 holding was stored negated. It renders as 68-style magnitude in a
    // neutral tone, not as a red minus.
    expect(out[1]).toMatchObject({ kind: "neutral", value: 15 });
    expect(formatReceiptItem(out[1])).toBe("15");
  });

  it("returns an empty list when a receipt carries neither", () => {
    expect(receiptItems({})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Outcome taxonomy (plan §2.2)
// ---------------------------------------------------------------------------

describe("run outcome", () => {
  it("trusts the engine's own outcome and verdict once it sends them", () => {
    const r = receiptFixture({
      outcome: "ended_in_act",
      verdict: "RUN ENDED IN ACT 2",
      ran_the_table: false,
      battles: [{ act: 1, boss_id: "b1", outcome: "win", decided_by: "lanes", player_lanes_won: 3, opponent_lanes_won: 2, rule_id: null }],
    });
    expect(runOutcome(r, 4)).toBe("ended_in_act");
    expect(runVerdict(r, 4)).toBe("RUN ENDED IN ACT 2");
  });

  it("calls a cleared table cleared", () => {
    expect(runVerdict(receiptFixture({ ran_the_table: true }), 3)).toBe("TABLE CLEARED");
  });

  /** `"RUN COMPLETE"` is retired: it was printed for a 0-for-3 losing run. */
  it("never reprints RUN COMPLETE for a losing run", () => {
    const losing = receiptFixture({
      verdict: "RUN COMPLETE",
      ran_the_table: false,
      record: "0-3",
      battles: [1, 2, 3].map((act) => ({
        act,
        boss_id: `b${act}`,
        outcome: "loss" as const,
        decided_by: "lanes" as const,
        player_lanes_won: 1,
        opponent_lanes_won: 3,
        rule_id: null,
      })),
    });
    expect(runVerdict(losing, 3)).toBe("RUN ENDED AT THE FINAL BOSS");
    expect(runVerdict(losing, 3)).not.toContain("COMPLETE");
  });

  it("names the act a run ran out of lives in", () => {
    const r = receiptFixture({
      verdict: "RUN ENDED",
      ran_the_table: false,
      battles: [1, 2].map((act) => ({
        act,
        boss_id: `b${act}`,
        outcome: "loss" as const,
        decided_by: "lanes" as const,
        player_lanes_won: 0,
        opponent_lanes_won: 3,
        rule_id: null,
      })),
    });
    expect(runOutcome(r, 4)).toBe("ended_in_act");
    expect(runVerdict(r, 4)).toBe("RUN ENDED IN ACT 2");
  });

  it("shares a losing run without victory framing", () => {
    const losing = receiptFixture({ verdict: "RUN COMPLETE", ran_the_table: false, record: "0-3" });
    expect(buildRunShareText(losing)).not.toContain("RUN COMPLETE");
  });
});

// ---------------------------------------------------------------------------
// Card shape
// ---------------------------------------------------------------------------

describe("card lane summary", () => {
  const pcts = (v: Partial<Record<LaneField, number>>): Record<LaneField, number> => ({
    statistical_impact: 50,
    traditional_production: 50,
    individual_recognition: 50,
    postseason_individual_value: 50,
    team_achievement: 50,
    ...v,
  });

  it("names the strongest and weakest lane with the frozen component labels", () => {
    const out = cardLaneSummary(pcts({ statistical_impact: 92, team_achievement: 11 }));
    expect(out.strongest.label).toBe("Statistical Impact");
    expect(out.weakest.label).toBe("Team Result");
    expect(out.strongest.token).toBe("si");
  });

  it("calls a level card Balanced", () => {
    expect(cardLaneSummary(pcts({})).profile).toBe("Balanced");
    expect(cardLaneSummary(pcts({ statistical_impact: 60, team_achievement: 40 })).profile).toBe(
      "Balanced",
    );
  });

  it("labels a lopsided card by its strongest lane", () => {
    expect(cardLaneSummary(pcts({ statistical_impact: 95, team_achievement: 5 })).profile).toBe(
      "Impact-heavy",
    );
    expect(
      cardLaneSummary(pcts({ postseason_individual_value: 95, team_achievement: 5 })).profile,
    ).toBe("Playoff-heavy");
  });

  it("resolves a tie in the engine's own lane order, deterministically", () => {
    const out = cardLaneSummary(pcts({}));
    expect(out.strongest.lane).toBe("statistical_impact");
    expect(out.weakest.lane).toBe("statistical_impact");
    expect(out.spread).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Pre-boss briefing
// ---------------------------------------------------------------------------

describe("boss briefing", () => {
  const laneFields: LaneField[] = [
    "statistical_impact",
    "traditional_production",
    "individual_recognition",
    "postseason_individual_value",
    "team_achievement",
  ];
  const tokens = ["si", "tp", "rec", "po", "team"] as const;
  const profile = (values: number[]) =>
    laneFields.map((l, i) => ({ lane: l, label: `Lane ${i}`, token: tokens[i], value: values[i] }));

  it("splits the five lanes into leans and too-close-to-call", () => {
    const out = bossBriefing(profile([60, 40, 50, 70, 50.2]), profile([50, 55, 50, 40, 50]));
    expect(out).not.toBeNull();
    expect(out!.favouredYou.map((l) => l.lane)).toEqual([
      "postseason_individual_value",
      "statistical_impact",
    ]);
    expect(out!.favouredBoss.map((l) => l.lane)).toEqual(["traditional_production"]);
    expect(out!.level.map((l) => l.lane)).toEqual([
      "individual_recognition",
      "team_achievement",
    ]);
  });

  it("returns null when the boss has not been revealed and carries no profile", () => {
    expect(bossBriefing(profile([60, 40, 50, 70, 50]), null)).toBeNull();
    expect(bossBriefing(profile([60, 40, 50, 70, 50]), [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Trade Desk advisory
// ---------------------------------------------------------------------------

describe("outgoing advisory", () => {
  const incoming = {
    player_name: "Dirk Nowitzki",
    legal_slots: ["anchor"],
  } as never as Parameters<typeof outgoingAdvisory>[1] & { player_name: string };
  const slot = (slot_id: string) =>
    ({ slot_id, role: null, is_starter: true, refund: 7 }) as never as Parameters<
      typeof outgoingAdvisory
    >[0];

  /**
   * The outgoing column is Step 1 and is never gated — gating it made the
   * mandated "changing the outgoing pick clears an incompatible incoming pick"
   * rule unreachable, because the click meant to trigger the clear was itself
   * blocked. So this is an advisory, in a neutral tone, not an error.
   */
  it("warns what a change would cost, and stays silent when nothing is lost", () => {
    expect(outgoingAdvisory(slot("lead_creator"), incoming)).toBe(
      `Picking this clears ${incoming.player_name}`,
    );
    expect(outgoingAdvisory(slot("anchor"), incoming)).toBeNull();
    expect(outgoingAdvisory(slot("lead_creator"), null)).toBeNull();
  });
});
