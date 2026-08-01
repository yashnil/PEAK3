/**
 * RUN THE TABLE UI.
 *
 * The API module is mocked wholesale so nothing here needs a running FastAPI —
 * which also proves the tree treats the server as the only authority: every
 * card, price and lane value rendered below exists solely because a mocked
 * `public_state()` payload said so. Nothing is scored, priced or resolved in a
 * component.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const mockGetReadiness = vi.fn();
const mockGetDaily = vi.fn();
const mockGetRun = vi.fn();
const mockCreateRun = vi.fn();
const mockPostAction = vi.fn();
const mockCreateChallenge = vi.fn();
const mockGetChallenge = vi.fn();

// The error class is deliberately NOT mocked: the components branch on
// `instanceof RunTheTableAPIError`, so the tests must throw the real one.
vi.mock("@/lib/run-the-table-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/run-the-table-api")>(
    "@/lib/run-the-table-api",
  );
  return {
    ...actual,
    getRunReadiness: (...a: unknown[]) => mockGetReadiness(...a),
    getDailyRun: (...a: unknown[]) => mockGetDaily(...a),
    getRun: (...a: unknown[]) => mockGetRun(...a),
    createRun: (...a: unknown[]) => mockCreateRun(...a),
    postRunAction: (...a: unknown[]) => mockPostAction(...a),
    createChallenge: (...a: unknown[]) => mockCreateChallenge(...a),
    getChallenge: (...a: unknown[]) => mockGetChallenge(...a),
  };
});

// `next/navigation` is mocked globally in `tests/setup.ts` with a fresh
// `vi.fn()` per call, which cannot be inspected. This override keeps one
// shared `replace` spy so the `?start=` contract's "strip the param" half is
// actually observable.
const mockRouterReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: mockRouterReplace, prefetch: vi.fn() }),
  usePathname: () => "/arena/run-the-table",
  useSearchParams: () => new URLSearchParams(),
}));

import { RunTheTableAPIError } from "@/lib/run-the-table-api";
import RunTheTableGame, {
  readStartParam,
  urlWithoutStartParam,
} from "@/components/run-the-table/RunTheTableGame";
import BattleReveal from "@/components/run-the-table/BattleReveal";
import DraftRoom from "@/components/run-the-table/DraftRoom";
import TradeDesk from "@/components/run-the-table/TradeDesk";
import RunCard from "@/components/run-the-table/RunCard";
import RunResult from "@/components/run-the-table/RunResult";
import RunMap from "@/components/run-the-table/RunMap";
import LaneProfile from "@/components/run-the-table/LaneProfile";
import RunSkeleton from "@/components/run-the-table/RunSkeleton";
import ChoiceNode from "@/components/run-the-table/ChoiceNode";
import SystemSelect from "@/components/run-the-table/SystemSelect";
import BossPreview from "@/components/run-the-table/BossPreview";
import {
  ActiveNode,
  BattlePublic,
  BossPublic,
  DraftOffer,
  LaneField,
  MapAct,
  RosterSlotPublic,
  RunCardPublic,
  RunPublicState,
  RunReceipt,
  RUN_THE_TABLE_STORAGE_KEY,
} from "@/types/run-the-table";

// ---------------------------------------------------------------------------
// Fixtures — shaped field-for-field like public.py
// ---------------------------------------------------------------------------

const LANES: LaneField[] = [
  "statistical_impact",
  "traditional_production",
  "individual_recognition",
  "postseason_individual_value",
  "team_achievement",
];

function laneMap(v: number): Record<LaneField, number> {
  return Object.fromEntries(LANES.map((l) => [l, v])) as Record<LaneField, number>;
}

function card(over: Partial<RunCardPublic> = {}): RunCardPublic {
  return {
    card_id: "tim-duncan-3yr-200203",
    player_name: "Tim Duncan",
    player_slug: "tim-duncan",
    start_season: "2001-02",
    end_season: "2003-04",
    anchor_season: "2002-03",
    window_label: "2001-02 – 2003-04",
    prime_score: 91.2,
    overall_percentile: 96.4,
    eligible_roles: ["forward_big", "anchor"],
    primary_role: "anchor",
    lane_index: laneMap(72),
    lane_percentiles: laneMap(88),
    base_cost: 26,
    cost: 26,
    // The DEFAULT is empty, and that emptiness is why `[object Object]`
    // shipped: `cost_modifiers` is `list[dict]` on the server, was typed
    // `string[]` on the client, and every fixture in this file hardcoded `[]`
    // so `.join(" · ")` was never exercised. `discountedCard()` below is the
    // non-empty counterpart, and it is used by the RunCard tests.
    cost_modifiers: [],
    refund_value: 13,
    ...over,
  };
}

/** A card a System actually discounted — shaped field-for-field like
 *  `pricing.price_for()`'s `applied` list. */
function discountedCard(over: Partial<RunCardPublic> = {}): RunCardPublic {
  return card({
    card_id: "sidney-moncrief-3yr-198283",
    player_name: "Sidney Moncrief",
    base_cost: 24,
    cost: 19,
    cost_modifiers: [{ system_id: "moneyball", discount_pct: 20, before: 24, after: 19 }],
    ...over,
  });
}

function offer(over: Partial<DraftOffer> = {}): DraftOffer {
  return {
    ...card(),
    veteran_minimum_eligible: false,
    effective_cost: 26,
    legal_slots: ["anchor", "forward_big"],
    affordable: true,
    selectable: true,
    blocked_reason: null,
    ...over,
  };
}

function starters(): RosterSlotPublic[] {
  return [
    { slot_id: "lead_creator", role: "lead_creator", is_starter: true, card: card({ card_id: "a", player_name: "Oscar Robertson" }) },
    { slot_id: "guard_wing", role: "guard_wing", is_starter: true, card: null },
    { slot_id: "wing_forward", role: "wing_forward", is_starter: true, card: null },
    { slot_id: "forward_big", role: "forward_big", is_starter: true, card: null },
    { slot_id: "anchor", role: "anchor", is_starter: true, card: null },
  ];
}

function bench(): RosterSlotPublic[] {
  return [
    { slot_id: "bench_1", role: null, is_starter: false, card: null },
    { slot_id: "bench_2", role: null, is_starter: false, card: null },
  ];
}

function mapFixture(): MapAct[] {
  return [1, 2, 3].map((act) => ({
    act,
    stages: [1, 2].map((stage) => ({
      act,
      stage,
      state: "locked" as const,
      chosen_node_id: null,
      chosen_node_type: null,
      option_types: ["draft_room" as const, "trade_desk" as const],
      scouted: false,
    })),
    boss: { boss_id: `boss-a${act}`, name: `Boss ${act}`, state: "locked" as const },
  }));
}

const VERSIONS = {
  engine_version: "run_the_table_v1",
  ruleset_version: "rtt_ruleset_v1",
  card_pool_version: "v3",
  peak3_model_version: "peak3_official_weights_v1",
};

function runState(over: Partial<RunPublicState> = {}): RunPublicState {
  return {
    run_id: "run-1",
    seed: 999,
    run_type: "standard",
    date: null,
    status: "system_select",
    act: 1,
    stage: 1,
    acts_total: 3,
    stages_per_act: 2,
    credits: 40,
    lives: 3,
    max_lives: 3,
    starting_credits: 40,
    starters: starters(),
    bench: bench(),
    systems: [],
    pending_system_offer: [
      { id: "moneyball", name: "Moneyball", summary: "Cheap cards cost 35% less.", affects: "price" },
      { id: "deep_rotation", name: "Deep Rotation", summary: "Bench counts 0.65.", affects: "battle" },
    ],
    stage_options: null,
    active_node: null,
    next_boss: null,
    map: mapFixture(),
    battles: [],
    lane_profile: LANES.map((l, i) => ({
      lane: l,
      label: `Lane ${i}`,
      token: (["si", "tp", "rec", "po", "team"] as const)[i],
      value: 50 + i,
      peak3_weight: 0.2,
    })),
    roster_total: 52,
    bench_weight: 0.35,
    veteran_minimum_used_this_act: false,
    action_count: 0,
    receipt: null,
    versions: VERSIONS,
    created_at: "2026-07-31T00:00:00Z",
    last_action_at: "2026-07-31T00:00:00Z",
    ...over,
  };
}

function battleFixture(over: Partial<BattlePublic> = {}): BattlePublic {
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
    lanes: LANES.map((l, i) => ({
      lane: l,
      label: `Lane ${i}`,
      token: (["si", "tp", "rec", "po", "team"] as const)[i],
      player_score: 60 + i,
      opponent_score: 58,
      winner: i % 2 === 0 ? ("player" as const) : ("opponent" as const),
      margin: 2 + i,
      tie_broken_by_rule: false,
      player_top_card: card({ player_name: "Tim Duncan" }),
      opponent_top_card: card({ card_id: "z", player_name: "Kevin Garnett" }),
    })),
    ...over,
  };
}

function receiptFixture(over: Partial<RunReceipt> = {}): RunReceipt {
  return {
    verdict: "RUN COMPLETE",
    headline: "Ran the table.",
    story: "Moneyball — defeated all three bosses.",
    ran_the_table: true,
    bosses_defeated: 3,
    battles_lost: 0,
    record: "3-0",
    lives_remaining: 2,
    systems: [{ id: "moneyball", name: "Moneyball", summary: "Cheap cards cost 35% less." }],
    starters: [
      {
        slot_id: "anchor",
        role: "anchor",
        card_id: "tim",
        player_name: "Tim Duncan",
        player_slug: "tim-duncan",
        anchor_season: "2002-03",
        window: "2001-02–2003-04",
        prime_score: 91.2,
        base_cost: 26,
      },
    ],
    bench: [],
    lane_profile: LANES.map((l, i) => ({ lane: l, label: `Lane ${i}`, value: 50 + i, lanes_won: i % 2 })),
    roster_total: 63.4,
    strongest_lane: { lane: "team_achievement", label: "Team Result", value: 54 },
    weakest_lane: { lane: "statistical_impact", label: "Statistical Impact", value: 50 },
    run_mvp: {
      card_id: "tim",
      player_name: "Tim Duncan",
      player_slug: "tim-duncan",
      anchor_season: "2002-03",
      window: "2001-02–2003-04",
      prime_score: 91.2,
      base_cost: 26,
      marginal_contribution: 7.42,
      is_starter: true,
    },
    marginal_contributions: [],
    best_acquisition: null,
    best_trade: null,
    closest_battle: null,
    credits_spent: 33,
    credits_refunded: 4,
    credits_remaining: 15,
    starting_credits: 40,
    reasons: [
      { kind: "lane_strength", text: "Statistical Impact won 3 of 3 battles.", signed_value: 3 },
      { kind: "economy", text: "Finished holding 15 unspent credits.", signed_value: -15 },
    ],
    battles: [],
    seed: 999,
    run_type: "standard",
    date: null,
    versions: VERSIONS,
    ...over,
  };
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  // Every test but the `?start=` block runs on a bare route.
  window.history.replaceState({}, "", "/arena/run-the-table");
  mockGetReadiness.mockResolvedValue({
    enabled: true,
    daily_enabled: true,
    card_pool: { available: true, card_count: 174 },
  });
  mockGetDaily.mockResolvedValue({
    date: "2026-07-31",
    run_id: "rtt-daily-2026-07-31",
    seed: 4242,
    ruleset_version: "rtt_ruleset_v1",
  });
  mockGetChallenge.mockResolvedValue({
    seed: 777777,
    run_type: "standard",
    date: null,
    versions: VERSIONS,
  });
});

describe("RunTheTableGame — the start gate", () => {
  it("creates NO run on mount; the gate is the only way in", async () => {
    render(<RunTheTableGame />);
    expect(await screen.findByTestId("rtt-start-gate")).toBeInTheDocument();
    expect(mockCreateRun).not.toHaveBeenCalled();
    expect(mockPostAction).not.toHaveBeenCalled();
  });

  it("states the promise of the mode in one sentence", async () => {
    render(<RunTheTableGame />);
    await screen.findByTestId("rtt-start-gate");
    expect(
      screen.getByText(/Build and evolve a roster of exact NBA 3-year peaks/i),
    ).toBeInTheDocument();
  });

  it("shows today's daily seed so both entry points are distinguishable", async () => {
    render(<RunTheTableGame />);
    expect(await screen.findByTestId("rtt-daily-note")).toHaveTextContent("4242");
  });

  it("starts a standard run only on an explicit click", async () => {
    mockCreateRun.mockResolvedValue(runState());
    render(<RunTheTableGame />);
    await userEvent.click(await screen.findByTestId("rtt-start-standard"));
    await waitFor(() => expect(mockCreateRun).toHaveBeenCalledWith("standard", expect.anything()));
    expect(await screen.findByTestId("rtt-shell")).toBeInTheDocument();
  });

  it("starts today's run through the daily button", async () => {
    mockCreateRun.mockResolvedValue(runState({ run_type: "daily" }));
    render(<RunTheTableGame />);
    await userEvent.click(await screen.findByTestId("rtt-start-daily"));
    await waitFor(() => expect(mockCreateRun).toHaveBeenCalledWith("daily", expect.anything()));
  });

  it("labels a database-unavailable environment instead of blanking or crashing", async () => {
    mockGetReadiness.mockResolvedValue({
      enabled: true,
      daily_enabled: true,
      card_pool: { available: false, error: "card pool not built" },
    });
    render(<RunTheTableGame />);
    expect(await screen.findByTestId("rtt-local-demo-notice")).toHaveTextContent(/Local demo mode/i);
    expect(screen.getByTestId("rtt-start-standard")).toBeEnabled();
  });

  it("says so, retryably, when the API cannot be reached", async () => {
    mockGetReadiness.mockRejectedValue(new RunTheTableAPIError(0, "network"));
    render(<RunTheTableGame />);
    const err = await screen.findByTestId("rtt-start-error");
    expect(within(err).getByRole("alert")).toHaveTextContent(/Could not reach the PEAK3 API/i);
    expect(screen.getByTestId("rtt-start-retry")).toBeInTheDocument();
  });
});

describe("RunTheTableGame — the ?start= contract (plan §5.1)", () => {
  function at(search: string) {
    window.history.replaceState({}, "", `/arena/run-the-table${search}`);
  }

  it("parses only `standard` — the one run type a URL may create", () => {
    expect(readStartParam("?start=standard")).toBe("standard");
    // `daily` is deliberately NOT accepted. A standard run costs nothing to
    // create, but the daily is one shared board and one attempt per UTC day, so
    // letting the URL spend it would burn the attempt of everyone the link is
    // forwarded to. `?mode=daily` lands on the gate instead.
    expect(readStartParam("?start=daily")).toBeNull();
    expect(readStartParam("?start=challenge")).toBeNull();
    expect(readStartParam("?start=")).toBeNull();
    expect(readStartParam("?mode=daily")).toBeNull();
    expect(readStartParam("")).toBeNull();
  });

  it("strips only `start`, keeping the path and every other param", () => {
    expect(urlWithoutStartParam("/arena/run-the-table", "?start=daily&mode=daily")).toBe(
      "/arena/run-the-table?mode=daily",
    );
    expect(urlWithoutStartParam("/arena/run-the-table", "?start=standard")).toBe(
      "/arena/run-the-table",
    );
  });

  it("starts exactly ONE run and removes the param so a refresh cannot start a second", async () => {
    at("?start=standard");
    mockCreateRun.mockResolvedValue(runState());
    render(<RunTheTableGame />);
    expect(await screen.findByTestId("rtt-shell")).toBeInTheDocument();
    expect(mockCreateRun).toHaveBeenCalledTimes(1);
    expect(mockCreateRun).toHaveBeenCalledWith("standard", expect.anything());
    expect(mockRouterReplace).toHaveBeenCalledWith(
      "/arena/run-the-table",
      expect.objectContaining({ scroll: false }),
    );
    at("");
  });

  it("never starts the daily from a URL — the attempt is spent by a click", async () => {
    // The inverse of the test above, and the reason it changed. `?start=daily`
    // made the address bar itself the trigger for a once-per-day resource.
    at("?start=daily&mode=daily");
    render(<RunTheTableGame preferredMode="daily" />);
    await screen.findByTestId("rtt-start-gate");
    expect(mockCreateRun).not.toHaveBeenCalled();
    at("");
  });

  it("ignores ?start= when a challenge token is present", async () => {
    // `?c=<token>&start=standard` must not quietly start a fresh random-seed run
    // and drop the token: the recipient came for one specific shared board.
    at("?c=tok&start=standard");
    render(<RunTheTableGame challengeToken="tok" />);
    await screen.findByTestId("rtt-start-gate");
    expect(mockCreateRun).not.toHaveBeenCalled();
    at("");
  });

  it("never starts a second run when a stored run resumed first", async () => {
    at("?start=standard");
    window.localStorage.setItem(
      RUN_THE_TABLE_STORAGE_KEY,
      JSON.stringify({
        schema_version: 1,
        run_id: "run-1",
        seed: 999,
        run_type: "standard",
        updated_at: "2026-07-31T00:00:00.000Z",
      }),
    );
    mockGetRun.mockResolvedValue(runState({ status: "node_select", stage_options: [] }));
    render(<RunTheTableGame />);
    await screen.findByTestId("rtt-shell");
    expect(mockCreateRun).not.toHaveBeenCalled();
    // The param is still consumed and stripped — it just creates nothing.
    expect(mockRouterReplace).toHaveBeenCalled();
    at("");
  });

  it("a bare route still gates and creates nothing", async () => {
    // The invariant `play-routing.spec.ts:112-134` and
    // `run-the-table.spec.ts`'s "navigating to the route creates no run" both
    // depend on: following a link must never burn a run.
    at("");
    render(<RunTheTableGame />);
    expect(await screen.findByTestId("rtt-start-gate")).toBeInTheDocument();
    expect(mockCreateRun).not.toHaveBeenCalled();
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });
});

describe("RunTheTableGame — challenge links", () => {
  /**
   * The gate used to render only "Start a run" and "Today's run", so a visitor
   * who followed a `?c=` link had nothing to press that carried the token: the
   * obvious button silently started a fresh, unrelated seed. A challenge link
   * that does not reproduce its board is worse than no link at all.
   */
  it("offers a challenge start button only when a token is present", async () => {
    render(<RunTheTableGame />);
    await screen.findByTestId("rtt-start-gate");
    expect(screen.queryByTestId("rtt-start-challenge")).toBeNull();
  });

  it("names the challenged board before anything is committed", async () => {
    render(<RunTheTableGame challengeToken="tok-abc" />);
    expect(await screen.findByTestId("rtt-challenge-note")).toHaveTextContent("777777");
    expect(mockGetChallenge).toHaveBeenCalledWith("tok-abc");
    expect(mockCreateRun).not.toHaveBeenCalled();
  });

  it("starts a CHALLENGE run carrying the token, not a fresh random seed", async () => {
    mockCreateRun.mockResolvedValue(runState({ run_type: "challenge", seed: 777777 }));
    render(<RunTheTableGame challengeToken="tok-abc" />);
    await userEvent.click(await screen.findByTestId("rtt-start-challenge"));
    await waitFor(() =>
      expect(mockCreateRun).toHaveBeenCalledWith(
        "challenge",
        expect.objectContaining({ challengeToken: "tok-abc" }),
      ),
    );
    expect(await screen.findByTestId("rtt-shell")).toBeInTheDocument();
  });

  it("explains an expired or forged link instead of offering a dead button", async () => {
    mockGetChallenge.mockRejectedValue(
      new RunTheTableAPIError(404, "This challenge link is invalid or has expired."),
    );
    render(<RunTheTableGame challengeToken="tok-bad" />);
    expect(await screen.findByTestId("rtt-challenge-note")).toHaveTextContent(/invalid or has expired/i);
    expect(screen.getByTestId("rtt-start-challenge")).toBeDisabled();
    // The visitor is not stranded — a run of their own is still one click away.
    expect(screen.getByTestId("rtt-start-standard")).toBeEnabled();
  });
});

describe("RunTheTableGame — resume", () => {
  function storePointer() {
    window.localStorage.setItem(
      RUN_THE_TABLE_STORAGE_KEY,
      JSON.stringify({
        schema_version: 1,
        run_id: "run-1",
        seed: 999,
        run_type: "standard",
        updated_at: "2026-07-31T00:00:00.000Z",
      }),
    );
  }

  it("resumes a stored run at the SAME screen its status maps to", async () => {
    storePointer();
    mockGetRun.mockResolvedValue(
      runState({
        status: "node_select",
        stage_options: [
          { node_id: "n1", node_type: "draft_room", title: "Open tryouts", summary: "Three cards." },
          { node_id: "n2", node_type: "film_room", title: "Tape session", summary: "Look ahead." },
        ],
      }),
    );
    render(<RunTheTableGame />);
    expect(await screen.findByTestId("rtt-node-choice")).toBeInTheDocument();
    expect(mockGetRun).toHaveBeenCalledWith("run-1");
    expect(mockCreateRun).not.toHaveBeenCalled();
  });

  it("clears the pointer and explains itself when the stored run is gone (404)", async () => {
    storePointer();
    mockGetRun.mockRejectedValue(new RunTheTableAPIError(404, "not found"));
    render(<RunTheTableGame />);
    expect(await screen.findByTestId("rtt-resume-notice")).toHaveTextContent(/expired/i);
    expect(window.localStorage.getItem(RUN_THE_TABLE_STORAGE_KEY)).toBeNull();
    expect(screen.getByTestId("rtt-start-gate")).toBeInTheDocument();
  });

  it("clears the pointer on a ruleset version mismatch (409)", async () => {
    storePointer();
    mockGetRun.mockRejectedValue(new RunTheTableAPIError(409, "version"));
    render(<RunTheTableGame />);
    expect(await screen.findByTestId("rtt-resume-notice")).toHaveTextContent(/ruleset changed/i);
    expect(window.localStorage.getItem(RUN_THE_TABLE_STORAGE_KEY)).toBeNull();
  });

  it("keeps the pointer for a transient failure so a retry can still find the run", async () => {
    storePointer();
    mockGetRun.mockRejectedValue(new RunTheTableAPIError(500, "boom"));
    render(<RunTheTableGame />);
    await screen.findByTestId("rtt-resume-notice");
    expect(window.localStorage.getItem(RUN_THE_TABLE_STORAGE_KEY)).not.toBeNull();
  });

  it("does not report a resumed run as a STARTED run", async () => {
    /**
     * `rtt_run_started` used to be an effect keyed on `run_id`, which the
     * resume path also sets — so resuming, and every subsequent reload of that
     * same run, re-fired "started" for a run that had started once, hours
     * earlier. Starting is an event, not a state.
     */
    const { analytics } = await import("@/lib/analytics");
    const track = vi.spyOn(analytics, "track").mockImplementation(() => {});
    try {
      storePointer();
      mockGetRun.mockResolvedValue(runState({ status: "node_select", stage_options: [] }));
      render(<RunTheTableGame />);
      await screen.findByTestId("rtt-shell");

      const types = track.mock.calls.map((c) => (c[0] as { type: string }).type);
      expect(types).toContain("rtt_run_resumed");
      expect(types).not.toContain("rtt_run_started");
    } finally {
      track.mockRestore();
    }
  });

  it("reports a run started exactly once, from the start path", async () => {
    const { analytics } = await import("@/lib/analytics");
    const track = vi.spyOn(analytics, "track").mockImplementation(() => {});
    try {
      mockCreateRun.mockResolvedValue(runState());
      render(<RunTheTableGame />);
      await userEvent.click(await screen.findByTestId("rtt-start-standard"));
      await screen.findByTestId("rtt-shell");

      const started = track.mock.calls
        .map((c) => c[0] as { type: string; seed?: number })
        .filter((e) => e.type === "rtt_run_started");
      expect(started).toHaveLength(1);
      expect(started[0].seed).toBe(999);
    } finally {
      track.mockRestore();
    }
  });

  it("writes the pointer once a run exists, so a reload can resume it", async () => {
    mockCreateRun.mockResolvedValue(runState());
    render(<RunTheTableGame />);
    await userEvent.click(await screen.findByTestId("rtt-start-standard"));
    await screen.findByTestId("rtt-shell");
    expect(JSON.parse(window.localStorage.getItem(RUN_THE_TABLE_STORAGE_KEY) ?? "{}")).toMatchObject(
      { run_id: "run-1", seed: 999, schema_version: 1 },
    );
  });

  it("records the SERVER's daily key on a daily pointer", async () => {
    mockCreateRun.mockResolvedValue(runState({ run_type: "daily", date: "2026-07-31" }));
    render(<RunTheTableGame />);
    await userEvent.click(await screen.findByTestId("rtt-start-daily"));
    await screen.findByTestId("rtt-shell");
    expect(JSON.parse(window.localStorage.getItem(RUN_THE_TABLE_STORAGE_KEY) ?? "{}")).toMatchObject(
      { run_type: "daily", run_date: "2026-07-31" },
    );
  });

  /**
   * THE STALE-DAILY BUG (plan §4, path B). `StoredActiveRun` had no date,
   * `getRun` returns 200 for yesterday's daily, and `shouldClearStoredRun`
   * only fires on 404/409/410 — so an unfinished daily was resumed today, and
   * every day after, and the start gate never appeared again.
   */
  it("discards yesterday's unfinished daily and shows today's gate", async () => {
    window.localStorage.setItem(
      RUN_THE_TABLE_STORAGE_KEY,
      JSON.stringify({
        schema_version: 1,
        run_id: "run-yesterday",
        seed: 1,
        run_type: "daily",
        run_date: "2026-07-30",
        updated_at: "2026-07-30T23:59:00.000Z",
      }),
    );
    // `mockGetDaily` resolves 2026-07-31 — the server's key, never the
    // browser's clock.
    render(<RunTheTableGame />);
    expect(await screen.findByTestId("rtt-resume-notice")).toHaveTextContent(/earlier day/i);
    expect(screen.getByTestId("rtt-start-gate")).toBeInTheDocument();
    expect(window.localStorage.getItem(RUN_THE_TABLE_STORAGE_KEY)).toBeNull();
    expect(mockGetRun).not.toHaveBeenCalled();
  });

  it("resumes TODAY's daily normally", async () => {
    window.localStorage.setItem(
      RUN_THE_TABLE_STORAGE_KEY,
      JSON.stringify({
        schema_version: 1,
        run_id: "run-today",
        seed: 4242,
        run_type: "daily",
        run_date: "2026-07-31",
        updated_at: "2026-07-31T09:00:00.000Z",
      }),
    );
    mockGetRun.mockResolvedValue(
      runState({ run_type: "daily", date: "2026-07-31", status: "node_select", stage_options: [] }),
    );
    render(<RunTheTableGame />);
    await screen.findByTestId("rtt-shell");
    expect(mockGetRun).toHaveBeenCalledWith("run-today");
  });

  /** A failed daily-descriptor fetch must never throw away a run in progress:
   *  unknown is not the same as stale. */
  it("keeps the pointer when the server's daily key could not be fetched", async () => {
    mockGetDaily.mockRejectedValue(new RunTheTableAPIError(0, "network"));
    window.localStorage.setItem(
      RUN_THE_TABLE_STORAGE_KEY,
      JSON.stringify({
        schema_version: 1,
        run_id: "run-daily",
        seed: 1,
        run_type: "daily",
        run_date: "2026-07-30",
        updated_at: "2026-07-30T23:59:00.000Z",
      }),
    );
    mockGetRun.mockResolvedValue(
      runState({ run_type: "daily", date: "2026-07-30", status: "node_select", stage_options: [] }),
    );
    render(<RunTheTableGame />);
    await screen.findByTestId("rtt-shell");
    expect(mockGetRun).toHaveBeenCalledWith("run-daily");
  });
});

describe("RunTheTableGame — actions and errors", () => {
  async function startAt(state: RunPublicState) {
    mockCreateRun.mockResolvedValue(state);
    render(<RunTheTableGame />);
    await userEvent.click(await screen.findByTestId("rtt-start-standard"));
    await screen.findByTestId("rtt-shell");
  }

  /**
   * "System selected." was the only surface in the game using the internal
   * name as the primary term — and it was the one place a screen-reader user
   * met it first. The display term is "Front Office Perk".
   */
  it("announces the display term, not the internal one", async () => {
    await startAt(runState());
    mockPostAction.mockResolvedValue(runState({ status: "node_select", stage_options: [] }));
    await userEvent.click(screen.getByTestId("rtt-system-moneyball"));
    await waitFor(() =>
      expect(screen.getByTestId("rtt-live")).toHaveTextContent("Front Office Perk selected."),
    );
  });

  it("posts the system the player picked and replaces the whole state", async () => {
    await startAt(runState());
    mockPostAction.mockResolvedValue(
      runState({ status: "node_select", systems: [{ id: "moneyball", name: "Moneyball", summary: "s", affects: "price" }], stage_options: [] }),
    );
    await userEvent.click(screen.getByTestId("rtt-system-moneyball"));
    await waitFor(() =>
      expect(mockPostAction).toHaveBeenCalledWith(
        "run-1",
        { action_type: "select_system", system_id: "moneyball" },
        expect.stringContaining(":run-1:system:moneyball"),
      ),
    );
    expect(await screen.findByTestId("rtt-node-choice")).toBeInTheDocument();
  });

  it("surfaces a failed action as a retryable alert, not a crash", async () => {
    await startAt(runState());
    mockPostAction.mockRejectedValue(new RunTheTableAPIError(500, "Engine exploded"));
    await userEvent.click(screen.getByTestId("rtt-system-moneyball"));
    const alert = await screen.findByTestId("rtt-error");
    expect(alert).toHaveTextContent("Engine exploded");
    expect(within(alert).getByTestId("rtt-error-retry")).toBeInTheDocument();
    // Still on the same screen — nothing was lost.
    expect(screen.getByTestId("rtt-system-select")).toBeInTheDocument();
  });

  it("retries the SAME action, with the same idempotency key", async () => {
    await startAt(runState());
    mockPostAction.mockRejectedValueOnce(new RunTheTableAPIError(500, "boom"));
    await userEvent.click(screen.getByTestId("rtt-system-moneyball"));
    const firstKey = mockPostAction.mock.calls[0][2];
    mockPostAction.mockResolvedValue(runState({ status: "node_select", stage_options: [] }));
    await userEvent.click(await screen.findByTestId("rtt-error-retry"));
    await waitFor(() => expect(mockPostAction).toHaveBeenCalledTimes(2));
    expect(mockPostAction.mock.calls[1][2]).toBe(firstKey);
  });

  it("renders the persistent tray with the server's credits and lives", async () => {
    await startAt(runState({ credits: 27, lives: 2 }));
    expect(screen.getAllByTestId("rtt-credits")[0]).toHaveTextContent("27");
    expect(screen.getAllByTestId("rtt-lives")[0]).toHaveTextContent("2/3");
    expect(screen.getByTestId("rtt-mobile-tray")).toBeInTheDocument();
  });

  /**
   * The rail used to print the plain line AND the dense threshold line
   * unconditionally, so the thing a player glances at mid-run was two
   * sentences of percentiles. Three layers here too — and the exact rule is
   * still in the document, just collapsed.
   */
  it("gives the tray's active perks all three layers", async () => {
    await startAt(
      runState({
        status: "node_select",
        stage_options: [],
        systems: [
          {
            id: "deep_rotation",
            name: "Deep Rotation",
            summary: "Your bench counts at 0.65 instead of 0.35 in every lane.",
            affects: "battle",
          },
        ],
      }),
    );
    const block = screen.getByTestId("rtt-tray-system-deep_rotation");
    expect(block).toHaveTextContent("Your bench matters almost twice as much in most battles.");
    expect(block).toHaveTextContent(/actually spend on the bench/i);
    const rule = screen.getByTestId("rtt-tray-system-rule-deep_rotation");
    expect(rule).not.toHaveAttribute("open");
    expect(rule).toHaveTextContent("Your bench counts at 0.65 instead of 0.35 in every lane.");
  });

  it("does not render a decision surface it has no payload for", async () => {
    await startAt(runState({ status: "node_active", active_node: null }));
    expect(await screen.findByTestId("rtt-inconsistent-state")).toBeInTheDocument();
  });
});

describe("RunMap", () => {
  it("draws two stage rows plus a boss row per act, boss rows marked", () => {
    render(<RunMap map={mapFixture()} />);
    expect(screen.getAllByTestId(/^rtt-map-row-/)).toHaveLength(9);
    expect(screen.getByTestId("rtt-map-row-a1boss")).toHaveAttribute("data-row-kind", "boss");
    expect(screen.getByTestId("rtt-map-row-a1s1")).toHaveAttribute("data-row-state", "locked");
  });

  it("colours the state word with a FOREGROUND token, never the row border", () => {
    const map: MapAct[] = [
      {
        act: 1,
        stages: [
          { act: 1, stage: 1, state: "current", chosen_node_id: null, chosen_node_type: null, option_types: ["draft_room", "trade_desk"], scouted: false },
          { act: 1, stage: 2, state: "locked", chosen_node_id: null, chosen_node_type: null, option_types: ["draft_room", "film_room"], scouted: false },
        ],
        boss: { boss_id: "boss-a1", name: "The Wall", state: "lost" },
      },
      {
        act: 2,
        stages: [
          { act: 2, stage: 1, state: "done", chosen_node_id: "n", chosen_node_type: "draft_room", option_types: ["draft_room", "trade_desk"], scouted: false },
          { act: 2, stage: 2, state: "locked", chosen_node_id: null, chosen_node_type: null, option_types: ["draft_room", "rest_bank"], scouted: false },
        ],
        boss: { boss_id: "boss-a2", name: "Strength", state: "won" },
      },
      {
        act: 3,
        stages: [
          { act: 3, stage: 1, state: "locked", chosen_node_id: null, chosen_node_type: null, option_types: ["draft_room", "trade_desk"], scouted: false },
          { act: 3, stage: 2, state: "locked", chosen_node_id: null, chosen_node_type: null, option_types: ["draft_room", "rest_bank"], scouted: false },
        ],
        boss: { boss_id: "boss-a3", name: "The Ceiling", state: "drawn" },
      },
    ];
    render(<RunMap map={map} />);
    // Border tokens as text measured 1.11:1 (locked) to 3.36:1 (done) — all
    // fail AA, and this word is the only TEXTUAL state indicator in the rail.
    // Each of these is >= 4.5:1 against the fill its own row paints.
    const colorOf = (key: string) => screen.getByTestId(`rtt-map-state-${key}`).style.color;
    expect(colorOf("a1s1")).toBe("var(--peak-accent)"); // 10.95:1 on the accent wash
    expect(colorOf("a1s2")).toBe("var(--text-muted)"); // 5.21:1 on --bg-elevated
    expect(colorOf("a2s1")).toBe("var(--correct)"); // 7.40:1 on --bg-surface
    expect(colorOf("a2boss")).toBe("var(--correct)");
    expect(colorOf("a3boss")).toBe("var(--text-secondary)"); // 5.31:1 on --bg-surface
    // --incorrect neat is only 4.48:1 on --bg-surface, so "lost" mixes toward
    // --text-primary to reach 5.17:1 rather than shipping a near-miss.
    expect(colorOf("a1boss")).toContain("color-mix");
    // And no border token is ever used as a text colour.
    for (const key of ["a1s1", "a1s2", "a2s1", "a3boss", "a1boss", "a2boss"]) {
      expect(colorOf(key)).not.toContain("--border-");
      expect(colorOf(key)).not.toContain("-dim)");
    }
  });

  it("recesses a locked row by fill and border, not by a blanket opacity", () => {
    render(<RunMap map={mapFixture()} />);
    const locked = screen.getByTestId("rtt-map-row-a1s1");
    expect(locked).toHaveAttribute("data-row-state", "locked");
    // `opacity: 0.72` dragged EVERY label in the row down with it.
    expect(locked.style.opacity).toBe("");
    expect(locked.style.background).toBe("var(--bg-elevated)");
    expect(locked.style.borderColor).toBe("var(--border-subtle)");
  });
});

describe("LaneProfile", () => {
  const lanes = LANES.map((l, i) => ({
    lane: l,
    label: `Lane ${i}`,
    token: (["si", "tp", "rec", "po", "team"] as const)[i],
    value: 50 + i,
    peak3_weight: 0.2,
  }));

  it("puts the scouted opponent's lane values in text, not only in a title", () => {
    const compare = lanes.map((l) => ({ ...l, value: l.value + 4 }));
    render(<LaneProfile lanes={lanes} compare={compare} compareLabel="The Wall" />);
    // `title` on an `aria-hidden` tick is exposed to nobody — the entire
    // payoff of a Film Room scout used to be unreachable.
    expect(screen.getByTestId("rtt-lane-sr-statistical_impact")).toHaveTextContent(
      "The Wall in Lane 0: 54.0.",
    );
    expect(screen.getByTestId("rtt-lane-sr-team_achievement")).toHaveTextContent(
      "The Wall in Lane 4: 58.0.",
    );
  });

  it("puts the PEAK3 weight in text when it is shown at all", () => {
    render(<LaneProfile lanes={lanes} showWeights />);
    expect(screen.getByTestId("rtt-lane-sr-statistical_impact")).toHaveTextContent(
      "Lane 0 is 20% of the PEAK3 score.",
    );
  });

  it("adds no extra text when there is nothing title-only to expose", () => {
    render(<LaneProfile lanes={lanes} />);
    expect(screen.queryByTestId("rtt-lane-sr-statistical_impact")).not.toBeInTheDocument();
  });
});

describe("RunCard", () => {
  /**
   * P0 regression. `cost_modifiers` is `list[dict]` on the server
   * (`nba_peak/run_the_table/pricing.py:74-86`), passed through untouched by
   * `public.py`, and was declared `string[]` here — so `.join(" · ")` printed
   * "[object Object]" on every card any of `moneyball`, `no_hardware` or
   * `two_way_value` discounted, in the Draft Room and both Trade Desk columns.
   */
  it("renders a cost modifier as human copy, never [object Object]", () => {
    const { container } = render(<RunCard card={discountedCard()} cost={19} strikeCost={24} />);
    expect(container.textContent).not.toContain("[object Object]");
    expect(screen.getByTestId("rtt-card-modifier-moneyball")).toHaveTextContent(
      "Moneyball · −20% (24 → 19)",
    );
  });

  it("names every System that touched the price, in the engine's own order", () => {
    render(
      <RunCard
        card={discountedCard({
          cost: 14,
          cost_modifiers: [
            { system_id: "moneyball", discount_pct: 20, before: 24, after: 19 },
            { system_id: "two_way_value", discount_pct: 25, before: 19, after: 14 },
          ],
        })}
        cost={14}
      />,
    );
    const rows = within(screen.getByTestId("rtt-card-modifiers")).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Moneyball");
    expect(rows[1]).toHaveTextContent("Two-Way Value · −25% (19 → 14)");
  });

  it("renders nothing at all when the engine applied no modifier", () => {
    render(<RunCard card={card()} cost={26} />);
    expect(screen.queryByTestId("rtt-card-modifiers")).not.toBeInTheDocument();
  });

  /**
   * "75.1th pct" of WHAT was HALF the defect. The denominator is verified
   * against `cards.build_pool()`, which percentile-ranks `prime_score` over
   * the SELECTED (eligible) profiles — so it is the RUN THE TABLE card pool,
   * not "all PEAK3 3-year peak windows", which would be a larger, different
   * set.
   *
   * The other half was the ordinal: this assertion used to PIN `"75.1th"`,
   * which is not a word. `percentileSentence` appended "th" unconditionally and
   * `RunCard` hard-coded the same "th" as a JSX text node, so every card in the
   * Draft Room and both Trade Desk columns rendered it. Both now go through
   * `lib/ordinal.ts`.
   */
  it("says what the percentile is a percentile of, with a real ordinal", () => {
    render(<RunCard card={card({ overall_percentile: 75.1 })} cost={26} />);
    const pct = screen.getByTestId("rtt-card-percentile");
    expect(pct).toHaveTextContent("75.1st percentile of the card pool");
    expect(pct.textContent).not.toContain("75.1th");
    expect(pct).toHaveTextContent(/every eligible PEAK3 3-year peak window/i);
    // The wrong denominator would be a fabricated claim about the model.
    expect(pct.textContent).not.toMatch(/all PEAK3 3-year peak windows/i);
  });

  it.each<[number, string]>([
    [1.0, "1.0th"],
    [21.1, "21.1st"],
    [12.2, "12.2nd"],
    [96.3, "96.3rd"],
  ])("ordinalises %f as %s", (percentile, expected) => {
    render(<RunCard card={card({ overall_percentile: percentile })} cost={26} />);
    expect(screen.getByTestId("rtt-card-percentile")).toHaveTextContent(expected);
  });

  /**
   * FIRST-SCAN ORDER (plan §6): player · window · role · cost · PEAK3 score ·
   * strongest lane · weakest lane · profile label. The last three did not
   * exist — five equal-height bars were the only statement of a card's shape,
   * and a player cannot read three bar charts under a decision.
   */
  it("names the strongest lane, the weakest lane and the profile", () => {
    render(
      <RunCard
        card={card({
          lane_percentiles: {
            statistical_impact: 94,
            traditional_production: 61,
            individual_recognition: 40,
            postseason_individual_value: 72,
            team_achievement: 12,
          },
        })}
        cost={26}
      />,
    );
    const shape = screen.getByTestId("rtt-card-shape");
    expect(within(shape).getByTestId("rtt-card-strongest")).toHaveTextContent(
      "Statistical Impact",
    );
    expect(within(shape).getByTestId("rtt-card-weakest")).toHaveTextContent("Team Result");
    // A lopsided card is labelled by its strongest lane.
    expect(within(shape).getByTestId("rtt-card-profile")).toHaveTextContent("Impact-heavy");
  });

  it("calls a level card Balanced", () => {
    render(<RunCard card={card()} cost={26} />);
    expect(screen.getByTestId("rtt-card-profile")).toHaveTextContent("Balanced");
  });

  it("keeps the full five-lane sr-only sentence alongside the new summary", () => {
    render(<RunCard card={card()} cost={26} />);
    expect(screen.getByTestId("rtt-card-fingerprint-sr")).toHaveTextContent(
      "Lane percentiles — Statistical Impact 88, Traditional Production 88, Individual Recognition 88, Playoff Rate Impact 88, Team Result 88.",
    );
  });
});

describe("DraftRoom", () => {
  const node: ActiveNode = {
    node_id: "n1",
    node_type: "draft_room",
    title: "Open tryouts",
    summary: "Three cards on the board.",
    can_pass: true,
    offers: [
      offer(),
      offer({
        card_id: "b",
        player_name: "Sidney Moncrief",
        cost: 40,
        effective_cost: 40,
        affordable: false,
        selectable: false,
        blocked_reason: "Not enough credits",
      }),
      offer({
        card_id: "c",
        player_name: "Alex English",
        veteran_minimum_eligible: true,
        cost: 9,
        effective_cost: 0,
      }),
    ],
  };

  it("shows the server's cost and the server's blocked reason, verbatim", () => {
    render(
      <DraftRoom node={node} slots={[...starters(), ...bench()]} credits={30} busy={false} onBuy={vi.fn()} onPass={vi.fn()} />,
    );
    expect(screen.getByText("Not enough credits")).toBeInTheDocument();
    // A11y: blocked offers are `aria-disabled`, NOT `disabled` — `disabled`
    // takes them out of the tab order, so a keyboard user could never reach
    // the reason the card is grey.
    expect(screen.getByTestId("rtt-offer-b")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("rtt-offer-b")).toBeEnabled();
    expect(screen.getByTestId("rtt-offer-tim-duncan-3yr-200203")).toBeEnabled();
    expect(screen.getByTestId("rtt-offer-tim-duncan-3yr-200203")).not.toHaveAttribute(
      "aria-disabled",
    );
  });

  it("keeps a blocked offer focusable but inert, and always explains it", async () => {
    const blockedNode: ActiveNode = {
      ...node,
      offers: [
        offer(),
        // `selectable: false` with a NULL reason: the server is allowed to
        // send this, and it used to grey the card with no explanation at all.
        offer({
          card_id: "silent",
          player_name: "Sidney Moncrief",
          selectable: false,
          blocked_reason: null,
        }),
      ],
    };
    render(
      <DraftRoom
        node={blockedNode}
        slots={[...starters(), ...bench()]}
        credits={30}
        busy={false}
        onBuy={vi.fn()}
        onPass={vi.fn()}
      />,
    );
    const blocked = screen.getByTestId("rtt-offer-silent");
    expect(blocked).toHaveAttribute("aria-disabled", "true");
    // Reachable by keyboard.
    blocked.focus();
    expect(blocked).toHaveFocus();
    // Fallback reason, never a silent grey card.
    expect(screen.getByTestId("rtt-offer-blocked-silent")).toHaveTextContent(
      "Cannot be drafted right now.",
    );
    // Inert: clicking it must not open the slot picker.
    await userEvent.click(blocked);
    expect(screen.queryByTestId("rtt-draft-slot-picker")).not.toBeInTheDocument();
  });

  it("gives the Veteran Minimum toggle a 44px label target", async () => {
    render(
      <DraftRoom
        node={node}
        slots={[...starters(), ...bench()]}
        credits={30}
        busy={false}
        onBuy={vi.fn()}
        onPass={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId("rtt-offer-c"));
    // The <label> is the target and carries the min-height; the box itself is
    // sized in `.rtt-checkbox-row input[type="checkbox"]`.
    const row = await screen.findByTestId("rtt-vet-min-row");
    expect(row.className).toContain("rtt-checkbox-row");
    expect(row.tagName).toBe("LABEL");
    expect(row).toContainElement(screen.getByTestId("rtt-vet-min-toggle"));
  });

  it("uses container breakpoints, never viewport ones, for the offer grid", () => {
    render(
      <DraftRoom
        node={node}
        slots={[...starters(), ...bench()]}
        credits={30}
        busy={false}
        onBuy={vi.fn()}
        onPass={vi.fn()}
      />,
    );
    // The decision column SHRINKS as the viewport grows, so `md:`/`lg:` are
    // measuring the wrong box entirely.
    const grid = screen.getByTestId("rtt-draft-offers");
    expect(grid.className).toContain("@[560px]:grid-cols-2");
    expect(grid.className).not.toMatch(/\b(sm|md|lg):grid-cols/);
    expect(screen.getByTestId("rtt-draft-room").className).toContain("rtt-decision-surface");
  });

  it("exposes every card's lane fingerprint as text, not only as bars", () => {
    render(
      <DraftRoom
        node={node}
        slots={[...starters(), ...bench()]}
        credits={30}
        busy={false}
        onBuy={vi.fn()}
        onPass={vi.fn()}
      />,
    );
    // The bars themselves stay hidden — bar height is not information AT can
    // use — but the percentiles must exist somewhere in the accessible tree.
    const bars = screen.getAllByTestId("rtt-card-fingerprint");
    expect(bars[0]).toHaveAttribute("aria-hidden", "true");
    const sr = screen.getAllByTestId("rtt-card-fingerprint-sr");
    expect(sr).toHaveLength(3);
    expect(sr[0]).toHaveTextContent(
      "Lane percentiles — Statistical Impact 88, Traditional Production 88, Individual Recognition 88, Playoff Rate Impact 88, Team Result 88.",
    );
  });

  it("buys into a legal slot only after the slot is chosen", async () => {
    const onBuy = vi.fn();
    render(
      <DraftRoom node={node} slots={[...starters(), ...bench()]} credits={30} busy={false} onBuy={onBuy} onPass={vi.fn()} />,
    );
    expect(screen.queryByTestId("rtt-draft-slot-picker")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("rtt-offer-tim-duncan-3yr-200203"));
    expect(await screen.findByTestId("rtt-draft-slot-picker")).toBeInTheDocument();
    // Only the slots the SERVER called legal are offered.
    expect(screen.getByTestId("rtt-draft-slot-anchor")).toBeInTheDocument();
    expect(screen.queryByTestId("rtt-draft-slot-lead_creator")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("rtt-draft-slot-anchor"));
    expect(onBuy).toHaveBeenCalledWith(expect.objectContaining({ card_id: "tim-duncan-3yr-200203" }), "anchor", false);
  });

  it("defaults the Veteran Minimum on for an eligible card and lets it be turned off", async () => {
    const onBuy = vi.fn();
    render(
      <DraftRoom node={node} slots={[...starters(), ...bench()]} credits={30} busy={false} onBuy={onBuy} onPass={vi.fn()} />,
    );
    await userEvent.click(screen.getByTestId("rtt-offer-c"));
    expect(screen.getByTestId("rtt-vet-min-toggle")).toBeChecked();
    await userEvent.click(screen.getByTestId("rtt-draft-slot-anchor"));
    expect(onBuy).toHaveBeenCalledWith(expect.objectContaining({ card_id: "c" }), "anchor", true);

    onBuy.mockClear();
    await userEvent.click(screen.getByTestId("rtt-vet-min-toggle"));
    await userEvent.click(screen.getByTestId("rtt-draft-slot-anchor"));
    expect(onBuy).toHaveBeenCalledWith(expect.objectContaining({ card_id: "c" }), "anchor", false);
  });

  it("offers a real button to pass", async () => {
    const onPass = vi.fn();
    render(
      <DraftRoom node={node} slots={[...starters(), ...bench()]} credits={30} busy={false} onBuy={vi.fn()} onPass={onPass} />,
    );
    const pass = screen.getByTestId("rtt-draft-pass");
    expect(pass.tagName).toBe("BUTTON");
    await userEvent.click(pass);
    expect(onPass).toHaveBeenCalled();
  });
});

describe("TradeDesk", () => {
  const node: ActiveNode = {
    node_id: "n2",
    node_type: "trade_desk",
    title: "Phones are ringing",
    summary: "Three names available.",
    can_decline: true,
    incoming: [
      { ...card({ card_id: "in-legal", player_name: "Dave Cowens", cost: 18 }), legal_slots: ["anchor"] },
      { ...card({ card_id: "in-illegal", player_name: "Nate Archibald", cost: 12 }), legal_slots: ["lead_creator"] },
    ],
    outgoing_options: [
      {
        slot_id: "anchor",
        role: "anchor",
        is_starter: true,
        card: card({ card_id: "out", player_name: "Bill Walton" }),
        refund: 6,
      },
    ],
  };

  it("nets the server's incoming cost against the server's refund", async () => {
    render(<TradeDesk node={node} credits={40} busy={false} onTrade={vi.fn()} onDecline={vi.fn()} />);
    await userEvent.click(screen.getByTestId("rtt-trade-in-in-legal"));
    await userEvent.click(screen.getByTestId("rtt-trade-out-anchor"));
    expect(screen.getByTestId("rtt-trade-summary")).toHaveTextContent("net 12 credits");
  });

  /**
   * CHANGED in the UX pass, deliberately.
   *
   * Was: pick the illegal incoming card, then pick the outgoing slot, and
   * expect the summary to explain the illegal pairing. That assertion pinned
   * the defect — it required the desk to hold an illegal pair in a "selected"
   * state, which is precisely how a card that had become illegal ended up
   * painted accent-gold with a red "Not eligible" badge and `aria-pressed`
   * still true. Choosing the outgoing slot now recomputes legality from the
   * SERVER's `legal_slots` and drops an incompatible incoming pick, so there
   * is no illegal pair left to describe.
   *
   * The product rule is unchanged and still asserted: a pairing the server did
   * not call legal cannot be confirmed. It is now unreachable rather than
   * reachable-and-then-refused.
   */
  it("makes a pairing the server did not call legal unreachable, not just refused", async () => {
    render(<TradeDesk node={node} credits={40} busy={false} onTrade={vi.fn()} onDecline={vi.fn()} />);
    await userEvent.click(screen.getByTestId("rtt-trade-out-anchor"));

    const illegal = screen.getByTestId("rtt-trade-in-in-illegal");
    expect(illegal).toHaveAttribute("aria-disabled", "true");
    expect(illegal).toHaveAttribute("data-eligible", "false");
    await userEvent.click(illegal);
    // Click guard held: it is not selected, and nothing can be confirmed.
    expect(illegal).toHaveAttribute("data-selected", "false");
    expect(illegal).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("rtt-trade-confirm")).toBeDisabled();
  });

  /**
   * CHANGED in the UX pass, deliberately.
   *
   * Was: assert `borderColor === "var(--incorrect-dim)"` on an
   * incompatible-but-unselected card. That red border is exactly what the
   * reported screenshot reads as "Steve Francis is highlighted" — an error
   * colour on a card the player has done nothing wrong with. Ineligible cards
   * are now recessed the way `DraftRoom` already recesses a blocked offer
   * (`--border-subtle` + `--bg-page`), so accent-gold means "selected" and
   * nothing else in this surface is painted with an error colour.
   *
   * The a11y half of the original assertion is kept verbatim: still no opacity
   * wash, and the reason text is still present and readable.
   */
  it("recesses an ineligible offer by fill and border, never by an opacity wash", async () => {
    render(<TradeDesk node={node} credits={40} busy={false} onTrade={vi.fn()} onDecline={vi.fn()} />);
    await userEvent.click(screen.getByTestId("rtt-trade-out-anchor"));
    const illegal = screen.getByTestId("rtt-trade-in-in-illegal");
    // `aria-disabled` + a click guard, NOT `disabled`: `disabled` strips it
    // from the tab order, and the reason is what a keyboard user needs.
    expect(illegal).toBeEnabled();
    expect(illegal.style.opacity).toBe("");
    expect(illegal.style.borderColor).toBe("var(--border-subtle)");
    expect(illegal.style.background).toBe("var(--bg-page)");
    // And never the error colour, which is what read as "highlighted".
    expect(illegal.style.borderColor).not.toContain("incorrect");
    expect(screen.getByTestId("rtt-trade-in-in-legal").style.opacity).toBe("");
    expect(within(illegal).getByText(/Cannot play Anchor/i)).toBeInTheDocument();
  });

  it("uses container breakpoints for its two columns", () => {
    render(<TradeDesk node={node} credits={40} busy={false} onTrade={vi.fn()} onDecline={vi.fn()} />);
    const desk = screen.getByTestId("rtt-trade-desk");
    expect(desk.className).toContain("rtt-decision-surface");
    expect(desk.querySelector(".grid")?.className).toContain("@[520px]:grid-cols-2");
    expect(desk.querySelector(".grid")?.className).not.toMatch(/\blg:grid-cols/);
  });

  it("blocks a legal trade the player cannot afford", async () => {
    render(<TradeDesk node={node} credits={5} busy={false} onTrade={vi.fn()} onDecline={vi.fn()} />);
    await userEvent.click(screen.getByTestId("rtt-trade-in-in-legal"));
    await userEvent.click(screen.getByTestId("rtt-trade-out-anchor"));
    expect(screen.getByTestId("rtt-trade-confirm")).toBeDisabled();
  });

  it("passes the net cost back with the trade", async () => {
    const onTrade = vi.fn();
    render(<TradeDesk node={node} credits={40} busy={false} onTrade={onTrade} onDecline={vi.fn()} />);
    await userEvent.click(screen.getByTestId("rtt-trade-in-in-legal"));
    await userEvent.click(screen.getByTestId("rtt-trade-out-anchor"));
    await userEvent.click(screen.getByTestId("rtt-trade-confirm"));
    expect(onTrade).toHaveBeenCalledWith("anchor", "in-legal", 12);
  });
});

describe("BattleReveal", () => {
  it("announces the COMPLETE verdict as a MUTATION of an already-mounted region", async () => {
    // The region used to render its text inline, so it entered the DOM already
    // populated. That is not a mutation of an existing live region, and screen
    // readers generally do not announce it — meaning the entire battle result
    // was announced to nobody. `LiveRegion.tsx` states the rule and `SpinStage`
    // already followed it; this now does too.
    //
    // So the assertion is deliberately two-phase: EMPTY at first paint, then
    // filled. Asserting the text "at t=0" was asserting the bug.
    render(
      <BattleReveal battle={battleFixture()} boss={null} busy={false} onAdvance={vi.fn()} advanceLabel="Next act" />,
    );
    const live = screen.getByTestId("rtt-battle-verdict-live");
    expect(live).toHaveAttribute("role", "status");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent("");

    // Filled on the next frame — long before any reveal animation resolves, so
    // the verdict is still never "late".
    await waitFor(() => expect(live).toHaveTextContent("VICTORY"));
    expect(live).toHaveTextContent("Decided on lanes won");
    for (let i = 0; i < 5; i += 1) {
      expect(live).toHaveTextContent(`Lane ${i}:`);
    }
    expect(live).toHaveTextContent("Credits awarded: 12");
  });

  it("keeps a persistent skip control, not one that appears mid-animation", () => {
    render(
      <BattleReveal battle={battleFixture()} boss={null} busy={false} onAdvance={vi.fn()} advanceLabel="Next act" />,
    );
    expect(screen.getByTestId("rtt-battle-skip")).toBeVisible();
  });

  it("renders all five lanes with the server's winner on each", () => {
    render(
      <BattleReveal battle={battleFixture()} boss={null} busy={false} onAdvance={vi.fn()} advanceLabel="Next act" />,
    );
    expect(screen.getByTestId("rtt-lane-statistical_impact")).toHaveAttribute("data-lane-winner", "player");
    expect(screen.getByTestId("rtt-lane-traditional_production")).toHaveAttribute("data-lane-winner", "opponent");
    expect(within(screen.getByTestId("rtt-battle-lanes")).getAllByRole("listitem")).toHaveLength(5);
  });

  it("names the top contributor the server sent on each side", () => {
    render(
      <BattleReveal battle={battleFixture()} boss={null} busy={false} onAdvance={vi.fn()} advanceLabel="Next act" />,
    );
    const first = screen.getByTestId("rtt-lane-statistical_impact");
    expect(within(first).getByText("Tim Duncan")).toBeInTheDocument();
    expect(within(first).getByText("Kevin Garnett")).toBeInTheDocument();
  });

  it("shows the full series count immediately once the reveal is skipped", async () => {
    render(
      <BattleReveal battle={battleFixture()} boss={null} busy={false} onAdvance={vi.fn()} advanceLabel="Next act" />,
    );
    await userEvent.click(screen.getByTestId("rtt-battle-skip"));
    const series = screen.getByTestId("rtt-battle-series");
    expect(series).toHaveTextContent("3");
    expect(series).toHaveTextContent("2");
    expect(screen.getByTestId("rtt-battle-stamp")).toHaveAttribute("data-outcome", "win");
  });

  it("advances on a real button", async () => {
    const onAdvance = vi.fn();
    render(
      <BattleReveal battle={battleFixture()} boss={null} busy={false} onAdvance={onAdvance} advanceLabel="See the receipt" />,
    );
    const btn = screen.getByTestId("rtt-battle-advance");
    expect(btn.tagName).toBe("BUTTON");
    await userEvent.click(btn);
    expect(onAdvance).toHaveBeenCalled();
  });
});

describe("RunResult", () => {
  function renderResult(over: Partial<RunReceipt> = {}, actsTotal?: number) {
    return render(
      <RunResult
        receipt={receiptFixture(over)}
        versions={VERSIONS}
        actsTotal={actsTotal}
        busy={false}
        onRunItBack={vi.fn()}
        onReplaySeed={vi.fn()}
        onChallenge={vi.fn().mockResolvedValue("tok-1")}
      />,
    );
  }

  /**
   * `"RUN COMPLETE"` is RETIRED (plan §2.2). This assertion used to pin it —
   * and the engine printed it for a 0-for-3 losing run, which is victory
   * framing on a defeat. The three legal strings are `TABLE CLEARED`,
   * `RUN ENDED AT THE FINAL BOSS` and `RUN ENDED IN ACT {n}`.
   */
  it("uses the share-card shell and stamps the §2.2 verdict", () => {
    const { container } = renderResult();
    expect(container.querySelector(".share-card-shell")).not.toBeNull();
    const stamp = screen.getByTestId("rtt-result-verdict");
    expect(stamp).toHaveTextContent("TABLE CLEARED");
    expect(stamp).toHaveAttribute("data-outcome", "table_cleared");
    expect(stamp.textContent).not.toContain("RUN COMPLETE");
    // The engine's own prose is still the engine's.
    expect(screen.getByText("Ran the table.")).toBeInTheDocument();
    expect(screen.getByText("Moneyball — defeated all three bosses.")).toBeInTheDocument();
  });

  it("never shows victory framing for a losing run", () => {
    renderResult({
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
    }, 3);
    const stamp = screen.getByTestId("rtt-result-verdict");
    expect(stamp).toHaveTextContent("RUN ENDED AT THE FINAL BOSS");
    expect(stamp.textContent).not.toContain("COMPLETE");
  });

  it("names the act a run ran out of lives in", () => {
    renderResult({
      verdict: "RUN ENDED",
      ran_the_table: false,
      record: "1-1",
      battles: [1, 2].map((act) => ({
        act,
        boss_id: `b${act}`,
        outcome: act === 1 ? ("win" as const) : ("loss" as const),
        decided_by: "lanes" as const,
        player_lanes_won: act === 1 ? 3 : 0,
        opponent_lanes_won: act === 1 ? 2 : 3,
        rule_id: null,
      })),
    }, 4);
    expect(screen.getByTestId("rtt-result-verdict")).toHaveTextContent("RUN ENDED IN ACT 2");
  });

  it("renders the engine's own verdict verbatim once it also sends an outcome", () => {
    renderResult({ outcome: "ended_in_act", verdict: "RUN ENDED IN ACT 3", ran_the_table: false });
    expect(screen.getByTestId("rtt-result-verdict")).toHaveTextContent("RUN ENDED IN ACT 3");
  });

  /**
   * THE RECEIPT BUG (plan §2.3). This assertion used to pin `"-15.0"`, which is
   * the engine negating a HOLDING purely so a shared `signedColorVar()` would
   * paint it red — so the receipt said "Finished holding 15 unspent credits"
   * beside -15.0, two sections below a Credits block that said
   * `finished holding 15`. Colour now comes from `kind` and the value is the
   * true magnitude.
   */
  it("renders §2.3 items, colouring by kind and never by the sign of a number", () => {
    renderResult({
      items: [
        { kind: "benefit", label: "Statistical Impact won 3 of 3 battles.", value: 3, unit: "lanes" },
        { kind: "neutral", label: "Finished holding 68 unspent credits.", value: 68, unit: "credits" },
        { kind: "record", label: "Boss record", display: "3 of 3" },
      ],
    });
    const reasons = screen.getByTestId("rtt-result-reasons");
    const holding = within(reasons).getByTestId("rtt-result-item-1");
    expect(holding).toHaveAttribute("data-kind", "neutral");
    expect(holding).toHaveTextContent("68");
    expect(holding.textContent).not.toContain("-68");
    expect(within(holding).getByText("68").style.color).toBe("var(--text-muted)");
    expect(within(reasons).getByTestId("rtt-result-item-0").style).toBeTruthy();
    expect(within(within(reasons).getByTestId("rtt-result-item-0")).getByText("3").style.color).toBe(
      "var(--correct)",
    );
    expect(within(reasons).getByText("3 of 3")).toBeInTheDocument();
  });

  /** Plan §2.4: a completed v1 receipt must still render. */
  it("falls back to the deprecated reasons[] for an old saved receipt", () => {
    renderResult();
    const reasons = screen.getByTestId("rtt-result-reasons");
    expect(within(reasons).getByText(/Finished holding 15 unspent credits/)).toBeInTheDocument();
    // Read back as a magnitude in the neutral tone, NOT as the red -15.0 the
    // engine's negation used to produce.
    const holding = within(reasons).getByTestId("rtt-result-item-1");
    expect(holding).toHaveAttribute("data-kind", "neutral");
    expect(holding).toHaveTextContent("15");
    expect(holding.textContent).not.toContain("-15");
  });

  /**
   * Progressive disclosure (plan §6). This surface showed NO plain line at
   * all — just the perk name and the dense threshold summary — so the one
   * screen a player reads after the run never said what their perk did.
   */
  it("gives each perk all three layers, with the exact rule still present", async () => {
    renderResult();
    const block = screen.getByTestId("rtt-result-system-moneyball");
    expect(block).toHaveTextContent("Lower-rated cards are much cheaper.");
    expect(block).toHaveTextContent(/fill several empty slots/i);
    const rule = screen.getByTestId("rtt-result-system-rule-moneyball");
    expect(within(rule).getByText(/See exact rule/)).toBeInTheDocument();
    // Transparency is MOVED, never removed: the engine's own summary is there.
    expect(rule).toHaveTextContent("Cheap cards cost 35% less.");
  });

  it("shows the MVP's marginal contribution rather than a bare name", () => {
    renderResult();
    expect(screen.getByText("7.42")).toBeInTheDocument();
  });

  it("puts the seed and all four version strings in the data receipt", () => {
    renderResult();
    const receipt = screen.getByTestId("rtt-data-receipt");
    expect(within(receipt).getByText("999")).toBeInTheDocument();
    expect(within(receipt).getByText("run_the_table_v1")).toBeInTheDocument();
    expect(within(receipt).getByText("rtt_ruleset_v1")).toBeInTheDocument();
    expect(within(receipt).getByText("v3")).toBeInTheDocument();
    expect(within(receipt).getByText("peak3_official_weights_v1")).toBeInTheDocument();
  });

  it("confirms a copy by swapping the button's own label for two seconds — no toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderResult();
    await userEvent.click(screen.getByTestId("rtt-copy-summary"));
    await waitFor(() => expect(screen.getByTestId("rtt-copy-summary")).toHaveTextContent("Copied!"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("PEAK3 — RUN THE TABLE"));
    expect(screen.queryByRole("status")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    await waitFor(() =>
      expect(screen.getByTestId("rtt-copy-summary")).toHaveTextContent("Copy summary"),
    );
    vi.useRealTimers();
  });

  it("copies ${origin}/arena/run-the-table?c=${token} for a challenge", async () => {
    // The copied link has to be one the recipient can open. `/c/{token}` is
    // Peak Draft's challenge route and cannot resolve a RUN THE TABLE token.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderResult();
    await userEvent.click(screen.getByTestId("rtt-challenge"));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/arena/run-the-table?c=tok-1`,
      ),
    );
  });

  it("reports a failed challenge as an alert rather than silently doing nothing", async () => {
    render(
      <RunResult
        receipt={receiptFixture()}
        versions={VERSIONS}
        busy={false}
        onRunItBack={vi.fn()}
        onReplaySeed={vi.fn()}
        onChallenge={vi.fn().mockResolvedValue(null)}
      />,
    );
    await userEvent.click(screen.getByTestId("rtt-challenge"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not create a challenge link/i);
  });

  it("offers both replays as distinct actions", async () => {
    const onRunItBack = vi.fn();
    const onReplaySeed = vi.fn();
    render(
      <RunResult
        receipt={receiptFixture()}
        versions={VERSIONS}
        busy={false}
        onRunItBack={onRunItBack}
        onReplaySeed={onReplaySeed}
        onChallenge={vi.fn().mockResolvedValue("t")}
      />,
    );
    await userEvent.click(screen.getByTestId("rtt-run-it-back"));
    await userEvent.click(screen.getByTestId("rtt-replay-seed"));
    expect(onRunItBack).toHaveBeenCalledTimes(1);
    expect(onReplaySeed).toHaveBeenCalledTimes(1);
  });
});

describe("RunSkeleton", () => {
  it("announces the load even though the shell itself is aria-hidden", () => {
    render(<RunSkeleton />);
    expect(screen.getByTestId("rtt-skeleton")).toHaveAttribute("aria-hidden", "true");
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading your run…");
    // The status must NOT be inside the hidden subtree, or it says nothing.
    expect(screen.getByTestId("rtt-skeleton")).not.toContainElement(status);
  });
});

describe("ChoiceNode", () => {
  function choiceNodeFixture(node_type: "film_room" | "rest_bank"): ActiveNode {
    return {
      node_id: "n9",
      node_type,
      title: "A written choice",
      summary: "Pick one.",
      can_pass: false,
      choices: [
        { id: "take", label: "Take it", description: "Do the thing." },
        { id: "blocked", label: "Blocked", description: "Cannot.", disabled: true },
      ],
    };
  }

  it("uses the rest_bank sentence only on a rest_bank node", () => {
    render(<ChoiceNode node={choiceNodeFixture("rest_bank")} busy={false} onChoose={vi.fn()} />);
    expect(screen.getByTestId("rtt-choice-disabled-blocked")).toHaveTextContent(
      "Nothing to recover — you are already at full lives.",
    );
  });

  it("falls back to a neutral reason on any other node type", () => {
    // The same component serves film_room, where "already at full lives" is
    // simply not true.
    render(<ChoiceNode node={choiceNodeFixture("film_room")} busy={false} onChoose={vi.fn()} />);
    expect(screen.getByTestId("rtt-choice-disabled-blocked")).toHaveTextContent(
      "Not available on this node.",
    );
    expect(screen.queryByText(/full lives/i)).not.toBeInTheDocument();
  });
});


describe("SystemSelect — progressive disclosure (plan §6)", () => {
  const offerSystems = [
    {
      id: "moneyball",
      name: "Moneyball",
      summary: "Cards in the bottom 55% of PEAK3 3Y overall cost 35% less.",
      affects: "price",
    },
    {
      id: "deep_rotation",
      name: "Deep Rotation",
      summary: "Your bench counts at 0.65 instead of 0.35 in every lane.",
      affects: "battle",
    },
  ];

  function renderSelect() {
    return render(
      <SystemSelect offer={offerSystems} active={[]} act={1} busy={false} onSelect={vi.fn()} />,
    );
  }

  it("leads with the plain effect, then ONE hint — the thresholds are not on the first scan", () => {
    renderSelect();
    expect(screen.getByTestId("rtt-system-effect-moneyball")).toHaveTextContent(
      "Lower-rated cards are much cheaper.",
    );
    expect(screen.getByTestId("rtt-system-hint-moneyball")).toHaveTextContent(
      /fill several empty slots/i,
    );
    // The dense line is present but collapsed, not competing with the choice.
    expect(screen.getByTestId("rtt-system-rule-moneyball")).not.toHaveAttribute("open");
  });

  /**
   * TRANSPARENCY IS MOVED, NEVER REMOVED. The engine's own `summary` — guarded
   * by `config.py`'s `SYSTEM_PUBLISHED_THRESHOLDS` table — is still in the DOM,
   * verbatim, one interaction away.
   */
  it("carries the engine's exact rule verbatim behind `See exact rule`", async () => {
    renderSelect();
    const rule = screen.getByTestId("rtt-system-rule-moneyball");
    expect(within(rule).getByText(/See exact rule/)).toBeInTheDocument();
    expect(screen.getByTestId("rtt-system-summary-moneyball")).toHaveTextContent(
      "Cards in the bottom 55% of PEAK3 3Y overall cost 35% less.",
    );
    await userEvent.click(within(rule).getByText(/See exact rule/));
    expect(rule).toHaveAttribute("open");
  });

  /**
   * DOM ORDER IS LOAD-BEARING. `e2e/run-the-table.spec.ts:108` clicks the FIRST
   * button inside this surface. Layer 3 is a `<details>`, not a `<button>`, so
   * it cannot capture that click.
   */
  it("keeps the first button in the subtree an option button", () => {
    const { container } = renderSelect();
    const first = container.querySelector('[data-testid="rtt-system-select"] button');
    expect(first).toHaveAttribute("data-testid", "rtt-system-moneyball");
  });

  it("falls back to the engine summary alone for a perk this build does not know", () => {
    render(
      <SystemSelect
        offer={[{ id: "brand_new", name: "Brand New", summary: "Does a thing.", affects: "price" }]}
        active={[]}
        act={1}
        busy={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId("rtt-system-effect-brand_new")).toHaveTextContent("Does a thing.");
    // Never printed twice.
    expect(screen.queryByTestId("rtt-system-rule-brand_new")).not.toBeInTheDocument();
  });
});

describe("BossPreview — the pre-boss briefing (plan §6)", () => {
  const playerLanes = LANES.map((l, i) => ({
    lane: l,
    label: `Lane ${i}`,
    token: (["si", "tp", "rec", "po", "team"] as const)[i],
    value: [70, 40, 50, 62, 50][i],
  }));

  function boss(over: Partial<BossPublic> = {}): BossPublic {
    return {
      boss_id: "boss-a1",
      name: "The Wall",
      tagline: "Nothing gets through.",
      act: 1,
      rule: {
        id: "the_wall",
        name: "The Wall",
        summary: "A lane is only taken if it is won by more than 0.75 points.",
      },
      source: "generated",
      revealed: true,
      starters: [],
      bench: [],
      roster_total: 58.4,
      lane_profile: LANES.map((l, i) => ({
        lane: l,
        label: `Lane ${i}`,
        token: (["si", "tp", "rec", "po", "team"] as const)[i],
        value: [50, 55, 50, 40, 50][i],
      })),
      ...over,
    };
  }

  function renderPreview(over: Partial<BossPublic> = {}, lanesToWin: number | undefined = 3) {
    return render(
      <BossPreview
        boss={boss(over)}
        playerLanes={playerLanes}
        playerTotal={61.2}
        benchWeight={0.35}
        lives={3}
        busy={false}
        onResolve={vi.fn()}
        lanesToWin={lanesToWin}
      />,
    );
  }

  it("states the win condition from the payload, never a literal", () => {
    renderPreview({}, 4);
    expect(screen.getByTestId("rtt-boss-win-condition")).toHaveTextContent("First to 4 of 5 lanes");
  });

  it("puts the boss rule in plain language ABOVE the engine's exact summary", () => {
    renderPreview();
    expect(screen.getByTestId("rtt-boss-rule-plain")).toHaveTextContent(
      "A lane has to be won clearly.",
    );
    // The published threshold is still there, verbatim.
    expect(screen.getByTestId("rtt-boss-rule-summary")).toHaveTextContent("0.75 points");
  });

  it("summarises the five comparisons the player used to have to eyeball", () => {
    renderPreview();
    const briefing = screen.getByTestId("rtt-boss-briefing");
    expect(within(briefing).getByTestId("rtt-boss-briefing-you")).toHaveTextContent("Lane 0");
    expect(within(briefing).getByTestId("rtt-boss-briefing-you")).toHaveTextContent("Lane 3");
    expect(within(briefing).getByTestId("rtt-boss-briefing-boss")).toHaveTextContent("Lane 1");
    expect(within(briefing).getByTestId("rtt-boss-strengths")).toHaveTextContent("Lane 0");
  });

  /**
   * The two profiles are NOT computed under identical bench-weight conditions
   * (`public_state` passes no boss rule for the player, `boss_public` passes
   * one for the boss), and a rule's tie-break is not modelled at all. So the
   * word "estimate" is on the screen, not only in a comment.
   */
  it("labels the lean an estimate, and never implies a simulated game", () => {
    renderPreview();
    const briefing = screen.getByTestId("rtt-boss-briefing");
    expect(briefing).toHaveTextContent(/estimate/i);
    expect(briefing).toHaveTextContent(/Nothing is played out/i);
    expect(screen.getByTestId("rtt-boss-win-condition")).toHaveTextContent(/No game is simulated/i);
  });

  it("shows no briefing at all for an unscouted boss — it invents nothing", () => {
    renderPreview({ revealed: false, lane_profile: undefined, starters: undefined });
    expect(screen.queryByTestId("rtt-boss-briefing")).not.toBeInTheDocument();
  });
});

describe("ChoiceNode — node copy", () => {
  /**
   * THE SUPPRESSION IS GONE, AND THAT IS THE ASSERTION.
   *
   * Under v2, `generation.py` set the Film Room's server summary to "…then take
   * one prep advantage" and the engine had no such mechanic, so the component
   * substituted its own line. v3's Scout & Prepare implements exactly what its
   * generated summary describes, so the substitution would now HIDE the correct
   * sentence — and `shouldSuppressServerSummary` returns false for every node
   * type. This test proves the server line reaches the screen, which is the
   * property the old one could not have.
   */
  it("prints the generator's own summary for a v3 node", () => {
    const node: ActiveNode = {
      node_id: "n9",
      node_type: "film_room",
      title: "Tape session",
      summary:
        "Scout the next boss and prepare one lane, shape the next market, or reserve a future card at today's price.",
      choices: [
        { id: "scout_boss", label: "Scout the boss", description: "Free.", cost: 0 },
      ],
    };
    const { container } = render(<ChoiceNode node={node} busy={false} onChoose={vi.fn()} />);
    expect(container.textContent).toContain("shape the next market");
    // The two mechanics the engine has never had must not appear anywhere.
    expect(container.textContent).not.toContain("prep advantage");
    expect(container.textContent?.toLowerCase()).not.toContain("bank 10 credits");
  });

  it("still prints the generator's own summary for every other node type", () => {
    const node: ActiveNode = {
      node_id: "n1",
      node_type: "rest_bank",
      title: "Down week",
      summary: "A distinctive per-node line.",
      choices: [{ id: "recover_life", label: "Recover", description: "Get a life back." }],
    };
    render(<ChoiceNode node={node} busy={false} onChoose={vi.fn()} />);
    expect(screen.getByText("A distinctive per-node line.")).toBeInTheDocument();
  });
});
