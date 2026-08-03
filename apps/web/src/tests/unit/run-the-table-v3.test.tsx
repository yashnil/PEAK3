/**
 * RUN THE TABLE v3 (`rtt_ruleset_v3`) — the surfaces and helpers this ruleset
 * added: the opening-roster and boss reveals, the four priced credit sinks, and
 * Scout & Prepare.
 *
 * The API module is mocked wholesale, exactly as `run-the-table-components`
 * does, which is what makes every assertion below a statement about the CLIENT:
 * every card, price, projection and lock reason on screen exists solely because
 * a mocked `public_state()` payload said so. Nothing here is scored, priced,
 * gated or rolled in a component — and the reveal tests in particular exist to
 * prove there is no client-side randomness anywhere in the reel.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const mockGetReadiness = vi.fn();
const mockGetDaily = vi.fn();
const mockGetMeta = vi.fn();
const mockGetRun = vi.fn();
const mockCreateRun = vi.fn();
const mockPostAction = vi.fn();
const mockGetChallenge = vi.fn();

vi.mock("@/lib/run-the-table-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/run-the-table-api")>(
    "@/lib/run-the-table-api",
  );
  return {
    ...actual,
    getRunReadiness: (...a: unknown[]) => mockGetReadiness(...a),
    getDailyRun: (...a: unknown[]) => mockGetDaily(...a),
    getRulesetMeta: (...a: unknown[]) => mockGetMeta(...a),
    getRun: (...a: unknown[]) => mockGetRun(...a),
    createRun: (...a: unknown[]) => mockCreateRun(...a),
    postRunAction: (...a: unknown[]) => mockPostAction(...a),
    createChallenge: vi.fn(),
    getChallenge: (...a: unknown[]) => mockGetChallenge(...a),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/arena/run-the-table",
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * The reduced-motion signal, controllable per test.
 *
 * Mocked at the module boundary rather than by stubbing `matchMedia`, because
 * the requirement is about the COMPONENT's behaviour ("reduced motion reveals
 * instantly"), and the hook's own media-query plumbing has its own coverage.
 */
let reducedMotion = false;
vi.mock("@/lib/a11y", async () => {
  const actual = await vi.importActual<typeof import("@/lib/a11y")>("@/lib/a11y");
  return { ...actual, usePrefersReducedMotion: () => reducedMotion };
});

import RunTheTableGame from "@/components/run-the-table/RunTheTableGame";
import CreditSinks from "@/components/run-the-table/CreditSinks";
import ScoutPrepare from "@/components/run-the-table/ScoutPrepare";
import { runActions } from "@/lib/run-the-table-api";
import {
  needsBossReveal,
  needsOpeningReveal,
  skipAllCount,
} from "@/lib/run-the-table-state";
import type {
  ActiveNode,
  BossRevealTrack,
  CreditSink,
  RevealSlot,
  RevealTrack,
  RunPublicState,
  ScoutReport,
} from "@/types/run-the-table";

// ---------------------------------------------------------------------------
// Fixtures — every one of these is a shape `public_state()` actually emits.
// ---------------------------------------------------------------------------

const SLOT_IDS = [
  "lead_creator",
  "guard_wing",
  "wing_forward",
  "forward_big",
  "anchor",
  "bench_1",
  "bench_2",
] as const;

const SLOT_LABELS = [
  "Lead Creator",
  "Guard/Wing",
  "Wing/Forward",
  "Forward/Big",
  "Anchor",
  "Bench 1",
  "Bench 2",
] as const;

function revealSlot(index: number): RevealSlot {
  return {
    order: index,
    slot_id: SLOT_IDS[index],
    label: SLOT_LABELS[index],
    role: index < 5 ? (SLOT_IDS[index] as never) : null,
    is_starter: index < 5,
    card_id: `card-${index}`,
    player_name: `Player ${index}`,
    anchor_season: "1990-91",
    window: "1988-89–1990-91",
    prime_score: 60 + index,
    base_cost: 10 + index,
  };
}

function rosterTrack(revealed: number): RevealTrack {
  const slots = SLOT_IDS.map((_, i) => revealSlot(i));
  return {
    revealed,
    total: SLOT_IDS.length,
    complete: revealed >= SLOT_IDS.length,
    order: slots.map((s) => ({ order: s.order, slot_id: s.slot_id, label: s.label })),
    revealed_slots: slots.slice(0, revealed),
    next_slot: revealed < slots.length ? slots[revealed] : null,
    can_skip: revealed > 0 && revealed < slots.length,
    remaining: slots.length - revealed,
  };
}

function bossTrack(revealed: number): BossRevealTrack {
  return {
    ...rosterTrack(revealed),
    act: 1,
    boss_id: "the-wall",
    name: "The Wall",
    tagline: "Nothing gets through.",
    rule: { id: "the_wall", name: "The Wall", summary: "A lane is only taken by 1.50 points." },
    source: "curated",
    deterministic: true,
  };
}

const VERSIONS = {
  engine_version: "run_the_table_v1",
  ruleset_version: "rtt_ruleset_v3",
  card_pool_version: "v3",
  peak3_model_version: "peak3_official_weights_v1",
};

function runState(over: Partial<RunPublicState> = {}): RunPublicState {
  return {
    run_id: "run-v3",
    seed: 4242,
    run_type: "standard",
    date: null,
    status: "system_select",
    act: 1,
    stage: 1,
    acts_total: 5,
    stages_per_act: 2,
    final_boss_act: 5,
    roster_size: 7,
    credits: 50,
    lives: 3,
    max_lives: 3,
    starting_credits: 50,
    starters: SLOT_IDS.slice(0, 5).map((slot_id) => ({
      slot_id,
      role: slot_id as never,
      is_starter: true,
      card: null,
    })),
    bench: [
      { slot_id: "bench_1", role: null, is_starter: false, card: null },
      { slot_id: "bench_2", role: null, is_starter: false, card: null },
    ],
    systems: [],
    pending_system_offer: [
      { id: "moneyball", name: "Moneyball", summary: "Cheap cards cost less.", affects: "price" },
    ],
    stage_options: null,
    active_node: null,
    next_boss: null,
    map: [1, 2, 3, 4, 5].map((act) => ({
      act,
      stages: [1, 2].map((stage) => ({
        act,
        stage,
        state: "locked" as const,
        chosen_node_id: null,
        chosen_node_type: null,
        option_types: ["draft_room" as const, "film_room" as const],
        scouted: false,
      })),
      boss: { boss_id: `boss-a${act}`, name: `Boss ${act}`, state: "locked" as const },
    })),
    battles: [],
    lane_profile: [],
    roster_total: 50,
    bench_weight: 0.35,
    veteran_minimum_used_this_act: false,
    reveal: { roster: rosterTrack(0), boss: null },
    armed: {
      prep: null,
      prep_bonus: 2.5,
      role_focus: null,
      reserved_card: null,
      scouted_boss_acts: [],
      emergency_recoveries_used: 0,
      emergency_recoveries_max: 1,
      sink_spend: [],
      sink_spend_total: 0,
    },
    credit_sinks: [],
    action_count: 0,
    receipt: null,
    versions: VERSIONS,
    created_at: "2026-08-01T00:00:00Z",
    last_action_at: "2026-08-01T00:00:00Z",
    ...over,
  };
}

function sink(over: Partial<CreditSink> = {}): CreditSink {
  return {
    id: "market_refresh",
    name: "Market Refresh",
    cost: 7,
    summary: "Spend 7 credits to replace the current offers once.",
    limit: "1 per node",
    offered_at: ["draft_room", "trade_desk"],
    available: true,
    affordable: true,
    selectable: true,
    unavailable_reason: null,
    used: 0,
    limit_total: 1,
    remaining: 1,
    ...over,
  };
}

const SCOUT_REPORT: ScoutReport = {
  boss_id: "the-wall",
  name: "The Wall",
  tagline: "Nothing gets through.",
  act: 1,
  rule_id: "the_wall",
  rule: { id: "the_wall", name: "The Wall", summary: "A lane is only taken by 1.50 points." },
  lane_margin_threshold: 1.5,
  lanes_to_win: 3,
  lanes: [
    { lane: "statistical_impact", label: "Statistical Impact", opponent_score: 70, player_score: 66, margin: -4, projected_winner: "opponent" },
    { lane: "traditional_production", label: "Traditional Production", opponent_score: 68, player_score: 69, margin: 1, projected_winner: "tie" },
    { lane: "individual_recognition", label: "Individual Recognition", opponent_score: 50, player_score: 58, margin: 8, projected_winner: "player" },
    { lane: "postseason_individual_value", label: "Playoff Rate Impact", opponent_score: 61, player_score: 60, margin: -1, projected_winner: "tie" },
    { lane: "team_achievement", label: "Team Result", opponent_score: 40, player_score: 44, margin: 4, projected_winner: "player" },
  ],
  strongest_lanes: ["statistical_impact", "traditional_production"],
  weakest_lane: "team_achievement",
  projected_lanes_won: 2,
  projected_lanes_lost: 1,
  projected_summed_margin: 8,
  projection: "win_on_margin",
  preparations: [
    { lane: "statistical_impact", label: "Statistical Impact", bonus: 2.5, margin_before: -4, margin_after: -1.5, would_flip: false },
    { lane: "traditional_production", label: "Traditional Production", bonus: 2.5, margin_before: 1, margin_after: 3.5, would_flip: true },
    { lane: "individual_recognition", label: "Individual Recognition", bonus: 2.5, margin_before: 8, margin_after: 10.5, would_flip: false },
    { lane: "postseason_individual_value", label: "Playoff Rate Impact", bonus: 2.5, margin_before: -1, margin_after: 1.5, would_flip: false },
    { lane: "team_achievement", label: "Team Result", bonus: 2.5, margin_before: 4, margin_after: 6.5, would_flip: false },
  ],
  starter_mean: 61.2,
};

function scoutNode(over: Partial<ActiveNode> = {}): ActiveNode {
  return {
    node_id: "a1s1o0",
    node_type: "film_room",
    title: "Scout & Prepare",
    summary:
      "Scout the next boss and prepare one lane, shape the next market, or reserve a future card at today's price.",
    credit_sinks: [
      sink({
        id: "role_focus",
        name: "Role Focus",
        cost: 6,
        summary: "Guarantee at least one offer in the next market fits the role you choose.",
        limit: "applies to the next market only",
        offered_at: ["film_room"],
        limit_total: null,
        remaining: null,
      }),
      sink({
        id: "reserve_card",
        name: "Reserve a Card",
        cost: 5,
        summary: "Reserve one revealed future card at its price today.",
        limit: "one live reservation at a time",
        offered_at: ["film_room"],
        limit_total: null,
        remaining: null,
      }),
    ],
    scout: {
      node_id: "a1s1o0",
      choice_ids: ["scout_boss", "shape_market", "reserve_card"],
      prep_bonus: 2.5,
      lanes: SCOUT_REPORT.lanes.map((l) => ({
        lane: l.lane,
        label: l.label,
        token: "si" as const,
      })),
      roles: ["lead_creator", "guard_wing", "wing_forward", "forward_big", "anchor"],
      choices: [
        {
          id: "scout_boss",
          name: "Scout the Boss",
          cost: 0,
          available: true,
          unavailable_reason: null,
          prep_bonus: 2.5,
          report: SCOUT_REPORT,
        },
        {
          id: "shape_market",
          name: "Role Focus",
          cost: 6,
          available: true,
          unavailable_reason: null,
          summary: "Guarantee at least one offer in the next market fits the role you choose.",
          roles: ["lead_creator", "guard_wing", "wing_forward", "forward_big", "anchor"],
        },
        {
          id: "reserve_card",
          name: "Reserve a Card",
          cost: 5,
          available: true,
          unavailable_reason: null,
          summary: "Reserve one revealed future card at its price today.",
          candidates: [
            {
              card_id: "future-1",
              player_name: "Reserved Guard",
              anchor_season: "1996-97",
              prime_score: 71.4,
              locked_cost: 18,
              modifiers: [],
              legal_slots: ["guard_wing"],
            },
            {
              card_id: "future-2",
              player_name: "Already Mine",
              anchor_season: "1988-89",
              prime_score: 64.1,
              locked_cost: 12,
              modifiers: [],
              legal_slots: [],
            },
          ],
        },
      ],
    },
    ...over,
  };
}

beforeEach(() => {
  reducedMotion = false;
  vi.clearAllMocks();
  window.localStorage.clear();
  mockGetReadiness.mockResolvedValue({ enabled: true, daily_enabled: true });
  mockGetDaily.mockResolvedValue({
    date: "2026-08-01", run_id: "rtt-daily", seed: 1, ruleset_version: "rtt_ruleset_v3",
  });
  mockGetMeta.mockResolvedValue({
    versions: VERSIONS,
    lanes: [],
    systems: [],
    boss_rules: [],
    roster: { starters: 5, bench: 2, roles: [] },
    run_shape: {
      acts: 5, stages_per_act: 2, node_choices_per_stage: 2, decision_nodes: 10,
      battles: 5, final_boss_act: 5, roster_size: 7, outcomes: [],
    },
    credit_sinks: [sink(), sink({ id: "emergency_recovery", name: "Emergency Recovery", cost: 20 })],
    economy: {
      starting_credits: 50, starting_lives: 3, max_lives: 3, comeback_credits: 6,
      trade_refund_pct: 0.5, price_formula: "…",
    },
    battle: { starter_weight: 1, bench_weight: 0.35, lanes_to_win: 3, tie_break_order: [] },
    card_pool: {
      duration_years: 3, card_count: 174, excluded_count: 0,
      prime_score_min: 40, prime_score_max: 90,
    },
  });
});

// ---------------------------------------------------------------------------
// Reveal helpers
// ---------------------------------------------------------------------------

describe("reveal gating", () => {
  it("shows the opening reveal only before act 1, and only while it is unfinished", () => {
    expect(needsOpeningReveal(runState())).toBe(true);
    // Finished — the SERVER's flag, so a refresh mid-run never replays it.
    expect(
      needsOpeningReveal(runState({ reveal: { roster: rosterTrack(7), boss: null } })),
    ).toBe(false);
    // A run resumed past the opening has long since met its roster.
    expect(needsOpeningReveal(runState({ act: 3, status: "node_select" }))).toBe(false);
    expect(needsOpeningReveal(runState({ status: "node_select" }))).toBe(false);
  });

  it("never fires for a payload from an older API that carries no reveal block", () => {
    expect(needsOpeningReveal(runState({ reveal: undefined }))).toBe(false);
    expect(needsBossReveal(runState({ status: "boss_ready", reveal: undefined }))).toBe(false);
  });

  it("shows the boss reveal only at boss_ready, and only while unfinished", () => {
    const at = (status: RunPublicState["status"], revealed: number) =>
      needsBossReveal(runState({ status, reveal: { roster: rosterTrack(7), boss: bossTrack(revealed) } }));
    expect(at("boss_ready", 0)).toBe(true);
    expect(at("boss_ready", 7)).toBe(false);
    expect(at("node_select", 0)).toBe(false);
  });

  it("skips exactly what is left, so the recorded action is honest", () => {
    expect(skipAllCount(rosterTrack(0))).toBe(7);
    expect(skipAllCount(rosterTrack(4))).toBe(3);
    // Never zero: a `count` below 1 is refused by the engine.
    expect(skipAllCount(rosterTrack(7))).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// RevealSequenceSurface + useRevealSequence — see
// `run-the-table-reveal.test.tsx` for the dedicated hook-level and
// component-level coverage (superseded `RevealReel`, deleted with this pass:
// PRODUCT_EXPERIENCE_CONTRACT.md §2 replaced its manual, one-card-per-click
// UX with a single-action batched reveal, so its old assertions describe a
// UX that no longer exists).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CreditSinks
// ---------------------------------------------------------------------------

describe("CreditSinks", () => {
  it("renders nothing at all for a node that offers none", () => {
    const { container } = render(<CreditSinks sinks={[]} busy={false} onSpend={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("prints the payload's price, limit and published rule — never its own", () => {
    render(<CreditSinks sinks={[sink()]} busy={false} onSpend={vi.fn()} />);
    expect(screen.getByTestId("rtt-sink-cost-market_refresh")).toHaveTextContent("7 cr");
    expect(screen.getByTestId("rtt-sink-market_refresh")).toHaveTextContent("1 per node");
    expect(screen.getByTestId("rtt-sink-market_refresh")).toHaveTextContent(
      "Spend 7 credits to replace the current offers once.",
    );
  });

  /**
   * A LOCKED CONTROL IS SHOWN, WITH ITS REASON. Hiding it is how a player never
   * learns the sink exists; a greyed-out button with no reason is how they
   * cannot tell "I cannot afford it" from "I already used it".
   */
  it.each([
    ["insufficient_credits", /not enough credits/i],
    ["refresh_limit", /already been refreshed/i],
    ["recovery_limit", /already used this run/i],
    ["lives_full", /already at full lives/i],
  ])("shows %s as a sentence and disables the button", async (code, matcher) => {
    render(
      <CreditSinks
        sinks={[sink({ available: code !== "insufficient_credits", affordable: code === "insufficient_credits" ? false : true, selectable: false, unavailable_reason: code })]}
        busy={false}
        onSpend={vi.fn()}
      />,
    );
    expect(screen.getByTestId("rtt-sink-market_refresh")).toBeDisabled();
    expect(screen.getByTestId("rtt-sink-blocked-market_refresh")).toHaveTextContent(matcher);
  });

  /** `selectable` is the SERVER's conjunction of available AND affordable. The
   *  client never re-derives it from `credits >= cost`, which is how a UI ends
   *  up offering a purchase the server then refuses. */
  it("binds the button to `selectable` alone", async () => {
    const onSpend = vi.fn();
    render(
      <CreditSinks
        sinks={[sink({ available: true, affordable: true, selectable: false, unavailable_reason: "refresh_limit" })]}
        busy={false}
        onSpend={onSpend}
      />,
    );
    expect(screen.getByTestId("rtt-sink-market_refresh")).toHaveAttribute(
      "data-sink-selectable",
      "false",
    );
    await userEvent.click(screen.getByTestId("rtt-sink-market_refresh"));
    expect(onSpend).not.toHaveBeenCalled();
  });

  it("hands the whole sink back so the caller never re-looks-up an id", async () => {
    const onSpend = vi.fn();
    render(<CreditSinks sinks={[sink()]} busy={false} onSpend={onSpend} />);
    await userEvent.click(screen.getByTestId("rtt-sink-market_refresh"));
    expect(onSpend).toHaveBeenCalledWith(expect.objectContaining({ id: "market_refresh", cost: 7 }));
  });
});

// ---------------------------------------------------------------------------
// ScoutPrepare
// ---------------------------------------------------------------------------

describe("ScoutPrepare", () => {
  function renderScout(node = scoutNode(), credits = 50) {
    const handlers = {
      onScoutBoss: vi.fn(),
      onShapeMarket: vi.fn(),
      onReserveCard: vi.fn(),
    };
    render(<ScoutPrepare node={node} credits={credits} busy={false} {...handlers} />);
    return handlers;
  }

  it("offers all three branches with their prices, free branch marked free", () => {
    renderScout();
    expect(screen.getByTestId("rtt-scout-branch-scout_boss")).toBeInTheDocument();
    expect(screen.getByTestId("rtt-scout-branch-shape_market")).toBeInTheDocument();
    expect(screen.getByTestId("rtt-scout-branch-reserve_card")).toBeInTheDocument();
    expect(screen.getByTestId("rtt-scout-cost-scout_boss")).toHaveTextContent("Free");
    expect(screen.getByTestId("rtt-scout-cost-shape_market")).toHaveTextContent("6 cr");
    expect(screen.getByTestId("rtt-scout-cost-reserve_card")).toHaveTextContent("5 cr");
  });

  it("prints the generator's own summary — v3 no longer suppresses it", () => {
    renderScout();
    expect(screen.getByTestId("rtt-scout-prepare")).toHaveTextContent("shape the next market");
  });

  it("shows the full scouting report the engine computed", () => {
    renderScout();
    expect(screen.getByTestId("rtt-scout-rule")).toHaveTextContent("The Wall");
    expect(screen.getByTestId("rtt-scout-strongest")).toHaveTextContent(
      "Statistical Impact, Traditional Production",
    );
    expect(screen.getByTestId("rtt-scout-weakest")).toHaveTextContent("Team Result");
    expect(screen.getByTestId("rtt-scout-projection")).toHaveTextContent("Projected 2–1 on lanes");
    expect(screen.getByTestId("rtt-scout-projection")).toHaveTextContent("3 needed to win");
  });

  /**
   * `would_flip` is the whole reason this node is no longer dead content: it
   * tells the player, BEFORE they commit, whether the capped bonus actually
   * changes a lane result in the fight they are about to take.
   */
  it("marks the lanes a preparation would actually take", () => {
    renderScout();
    expect(screen.getByTestId("rtt-scout-flip-traditional_production")).toBeInTheDocument();
    expect(screen.queryByTestId("rtt-scout-flip-statistical_impact")).not.toBeInTheDocument();
    expect(screen.getByTestId("rtt-scout-prepare-traditional_production")).toHaveAttribute(
      "data-would-flip",
      "true",
    );
  });

  it("sends the lane the player picked", async () => {
    const handlers = renderScout();
    await userEvent.click(screen.getByTestId("rtt-scout-prepare-team_achievement"));
    expect(handlers.onScoutBoss).toHaveBeenCalledWith("team_achievement");
  });

  it("sends the role for Shape the Market", async () => {
    const handlers = renderScout();
    await userEvent.click(screen.getByTestId("rtt-scout-branch-shape_market"));
    await userEvent.click(screen.getByTestId("rtt-scout-role-anchor"));
    expect(handlers.onShapeMarket).toHaveBeenCalledWith("anchor");
  });

  it("sends the card id for Reserve a Card, at its locked price", async () => {
    const handlers = renderScout();
    await userEvent.click(screen.getByTestId("rtt-scout-branch-reserve_card"));
    expect(screen.getByTestId("rtt-scout-reserve-future-1")).toHaveTextContent("18 cr");
    await userEvent.click(screen.getByTestId("rtt-scout-reserve-future-1"));
    expect(handlers.onReserveCard).toHaveBeenCalledWith("future-1");
  });

  it("refuses a candidate with no legal slot, and says why", async () => {
    const handlers = renderScout();
    await userEvent.click(screen.getByTestId("rtt-scout-branch-reserve_card"));
    const blocked = screen.getByTestId("rtt-scout-reserve-future-2");
    expect(blocked).toBeDisabled();
    expect(blocked).toHaveTextContent(/already on your roster/i);
    await userEvent.click(blocked);
    expect(handlers.onReserveCard).not.toHaveBeenCalled();
  });

  /** An unaffordable or already-spent branch stays VISIBLE with its reason —
   *  the free branch is what guarantees the node can never dead-end. */
  it("shows an unavailable priced branch with its reason and keeps scouting free", async () => {
    const node = scoutNode();
    node.scout!.choices[1] = {
      ...node.scout!.choices[1],
      available: false,
      unavailable_reason: "insufficient_credits",
    };
    node.scout!.choices[2] = {
      ...node.scout!.choices[2],
      available: false,
      unavailable_reason: "reservation_active",
    };
    const handlers = renderScout(node, 2);

    expect(screen.getByTestId("rtt-scout-blocked-shape_market")).toHaveTextContent(
      /not enough credits/i,
    );
    expect(screen.getByTestId("rtt-scout-blocked-reserve_card")).toHaveTextContent(
      /already have a card reserved/i,
    );
    // The free branch is unaffected and still resolves the node.
    await userEvent.click(screen.getByTestId("rtt-scout-prepare-statistical_impact"));
    expect(handlers.onScoutBoss).toHaveBeenCalledWith("statistical_impact");
  });

  it("says so plainly when the API is too old to carry a scout block", () => {
    renderScout(scoutNode({ scout: undefined }));
    expect(screen.getByTestId("rtt-scout-prepare")).toHaveTextContent(/needs a newer PEAK3 API/i);
  });
});

// ---------------------------------------------------------------------------
// Action wire shapes
// ---------------------------------------------------------------------------

describe("runActions — v3", () => {
  it("builds the three new action bodies", () => {
    expect(runActions.marketRefresh()).toEqual({ action_type: "market_refresh" });
    expect(runActions.emergencyRecovery()).toEqual({ action_type: "emergency_recovery" });
    expect(runActions.reveal()).toEqual({ action_type: "reveal", target: "roster", count: 1 });
    expect(runActions.reveal("boss", 7)).toEqual({
      action_type: "reveal", target: "boss", count: 7,
    });
  });

  it("carries the branch-specific field for each Scout & Prepare choice", () => {
    expect(runActions.filmRoom("scout_boss", { lane: "team_achievement" })).toEqual({
      action_type: "film_room", choice: "scout_boss", lane: "team_achievement",
    });
    expect(runActions.filmRoom("shape_market", { role: "anchor" })).toEqual({
      action_type: "film_room", choice: "shape_market", role: "anchor",
    });
    expect(runActions.filmRoom("reserve_card", { card_id: "c1" })).toEqual({
      action_type: "film_room", choice: "reserve_card", card_id: "c1",
    });
    // No extra field is invented for a bare call.
    expect(runActions.filmRoom("scout_boss")).toEqual({
      action_type: "film_room", choice: "scout_boss",
    });
  });
});

// ---------------------------------------------------------------------------
// The game shell wires the reveal in
// ---------------------------------------------------------------------------

describe("RunTheTableGame — v3 flow", () => {
  async function startAt(state: RunPublicState) {
    mockCreateRun.mockResolvedValue(state);
    render(<RunTheTableGame />);
    await userEvent.click(await screen.findByTestId("rtt-start-standard"));
    await screen.findByTestId("rtt-shell");
  }

  it("puts the opening reveal in front of act 1, before the perk choice", async () => {
    await startAt(runState());
    expect(screen.getByTestId("rtt-opening-reveal")).toBeInTheDocument();
    expect(screen.queryByTestId("rtt-system-select")).not.toBeInTheDocument();
  });

  // SYNTHESIS_CONTRACT.md §2.2: the opening reveal is now ONE user action →
  // ONE POST → the server's full, already-authoritative response; the client
  // then paces its own presentation of that response. These three tests
  // replace the old one-card-per-click assertions.

  it("fires ONE batched reveal action for the whole roster — nothing shown before the press", async () => {
    await startAt(runState());
    expect(screen.getByTestId("rtt-reveal-start-roster")).toBeInTheDocument();
    expect(screen.queryByText(/Player \d/)).not.toBeInTheDocument();

    mockPostAction.mockResolvedValue(
      runState({ action_count: 1, reveal: { roster: rosterTrack(7), boss: null } }),
    );
    await userEvent.click(screen.getByTestId("rtt-reveal-start-roster"));

    await waitFor(() =>
      expect(mockPostAction).toHaveBeenCalledWith(
        "run-v3",
        { action_type: "reveal", target: "roster", count: 7 },
        expect.any(String),
      ),
    );
    expect(mockPostAction).toHaveBeenCalledTimes(1);
  });

  it("skip all resolves the sequence locally with no second round trip, then hands over to the perk choice", async () => {
    // Matches the OLD behaviour exactly: finishing the reveal (by any means)
    // hands over to the next screen in the same render the completion is
    // observed — `needsOpeningReveal`/`showRosterReveal` and the surface
    // itself are driven by the SAME `rosterSequence`, so there is no frame
    // where "system_select" and "every card visible" are both true at once.
    // The card-by-card visibility DURING an unfinished sequence is covered
    // directly in `run-the-table-reveal.test.tsx`, against the surface
    // component in isolation rather than through this auto-advancing shell.
    await startAt(runState());
    mockPostAction.mockResolvedValue(
      runState({ action_count: 1, reveal: { roster: rosterTrack(7), boss: null } }),
    );
    await userEvent.click(screen.getByTestId("rtt-reveal-start-roster"));
    await userEvent.click(await screen.findByTestId("rtt-reveal-skip-roster"));

    // Skip-all is client-side choreography over the SAME response — never a
    // second POST.
    expect(mockPostAction).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("rtt-system-select")).toBeInTheDocument();
    expect(screen.queryByTestId("rtt-opening-reveal")).not.toBeInTheDocument();
  });

  it("resume before the reveal has ever been started shows the single-action cover, never a mid-reveal state", async () => {
    window.localStorage.setItem(
      "peak3.run-the-table.active",
      JSON.stringify({
        schema_version: 1, run_id: "run-v3", seed: 4242, run_type: "standard",
        run_date: null, updated_at: "2026-08-01T00:00:00Z",
      }),
    );
    mockGetRun.mockResolvedValue(runState({ reveal: { roster: rosterTrack(0), boss: null } }));
    render(<RunTheTableGame />);

    await screen.findByTestId("rtt-opening-reveal");
    expect(screen.getByTestId("rtt-reveal-start-roster")).toBeInTheDocument();
    expect(screen.queryByText(/Player \d/)).not.toBeInTheDocument();
  });

  it("resume of an already-fully-revealed roster skips straight past the reveal — it never replays", async () => {
    window.localStorage.setItem(
      "peak3.run-the-table.active",
      JSON.stringify({
        schema_version: 1, run_id: "run-v3", seed: 4242, run_type: "standard",
        run_date: null, updated_at: "2026-08-01T00:00:00Z",
      }),
    );
    mockGetRun.mockResolvedValue(runState({ reveal: { roster: rosterTrack(7), boss: null } }));
    render(<RunTheTableGame />);

    await screen.findByTestId("rtt-system-select");
    expect(screen.queryByTestId("rtt-opening-reveal")).not.toBeInTheDocument();
  });

  it("puts a boss reveal in front of the boss briefing", async () => {
    await startAt(
      runState({
        status: "boss_ready",
        act: 1,
        reveal: { roster: rosterTrack(7), boss: bossTrack(0) },
        next_boss: {
          boss_id: "the-wall", name: "The Wall", tagline: "Nothing gets through.",
          act: 1, rule: null, source: "curated", revealed: true, deterministic: true,
        },
      }),
    );
    expect(screen.getByTestId("rtt-boss-reveal")).toBeInTheDocument();
    expect(screen.queryByTestId("rtt-boss-preview")).not.toBeInTheDocument();
    expect(screen.getByTestId("rtt-reveal-source-boss")).toHaveTextContent(
      /seed and rule generated/i,
    );
  });

  it("hands over to the briefing once the boss lineup is fully revealed", async () => {
    await startAt(
      runState({
        status: "boss_ready",
        act: 1,
        lane_profile: [],
        reveal: { roster: rosterTrack(7), boss: bossTrack(7) },
        next_boss: {
          boss_id: "the-wall", name: "The Wall", tagline: "Nothing gets through.",
          act: 1, rule: null, source: "curated", revealed: true, deterministic: true,
          starters: [], bench: [], lane_profile: [], roster_total: 60,
        },
      }),
    );
    expect(screen.queryByTestId("rtt-boss-reveal")).not.toBeInTheDocument();
    expect(screen.getByTestId("rtt-boss-preview")).toBeInTheDocument();
  });

  it("renders a market node's priced controls and posts the refresh", async () => {
    await startAt(
      runState({
        status: "node_active",
        reveal: { roster: rosterTrack(7), boss: null },
        active_node: {
          node_id: "a1s1o0",
          node_type: "draft_room",
          title: "Draft Room",
          summary: "Buy one.",
          offers: [],
          can_pass: true,
          refreshes_used: 0,
          credit_sinks: [sink()],
        },
      }),
    );
    expect(screen.getByTestId("rtt-sink-market_refresh")).toBeInTheDocument();

    mockPostAction.mockResolvedValue(runState({ status: "node_select", credits: 43 }));
    await userEvent.click(screen.getByTestId("rtt-sink-market_refresh"));
    await waitFor(() =>
      expect(mockPostAction).toHaveBeenCalledWith(
        "run-v3", { action_type: "market_refresh" }, expect.any(String),
      ),
    );
  });

  it("posts emergency recovery from a Rest / Bank", async () => {
    await startAt(
      runState({
        status: "node_active",
        lives: 1,
        reveal: { roster: rosterTrack(7), boss: null },
        active_node: {
          node_id: "a1s1o1",
          node_type: "rest_bank",
          title: "Rest / Bank",
          summary: "Recover or bank.",
          choices: [
            { id: "recover_life", label: "Recover a life", description: "Back up to 3 lives." },
            { id: "take_credits", label: "Bank 11 credits", description: "Take the credits." },
          ],
          credit_sinks: [
            sink({
              id: "emergency_recovery", name: "Emergency Recovery", cost: 20,
              summary: "Spend 20 credits to recover one life.", limit: "1 per run",
              offered_at: ["rest_bank"],
            }),
          ],
        },
      }),
    );
    mockPostAction.mockResolvedValue(runState({ lives: 2, credits: 30 }));
    await userEvent.click(screen.getByTestId("rtt-sink-emergency_recovery"));
    await waitFor(() =>
      expect(mockPostAction).toHaveBeenCalledWith(
        "run-v3", { action_type: "emergency_recovery" }, expect.any(String),
      ),
    );
  });

  it("routes a Scout & Prepare node to its own surface and posts the branch", async () => {
    await startAt(
      runState({
        status: "node_active",
        reveal: { roster: rosterTrack(7), boss: null },
        active_node: scoutNode(),
      }),
    );
    expect(screen.getByTestId("rtt-scout-prepare")).toBeInTheDocument();
    // Not the generic written-choice surface.
    expect(screen.queryByTestId("rtt-choice-node")).not.toBeInTheDocument();

    mockPostAction.mockResolvedValue(runState({ status: "node_select" }));
    await userEvent.click(screen.getByTestId("rtt-scout-prepare-traditional_production"));
    await waitFor(() =>
      expect(mockPostAction).toHaveBeenCalledWith(
        "run-v3",
        {
          action_type: "film_room",
          choice: "scout_boss",
          lane: "traditional_production",
        },
        expect.any(String),
      ),
    );
  });

  it("draws all five acts on the map without dropping a row", async () => {
    await startAt(runState({ reveal: { roster: rosterTrack(7), boss: null } }));
    // 5 acts x (2 stage rows + 1 boss row) = 15.
    for (const act of [1, 2, 3, 4, 5]) {
      expect(screen.getByTestId(`rtt-map-row-a${act}s1`)).toBeInTheDocument();
      expect(screen.getByTestId(`rtt-map-row-a${act}s2`)).toBeInTheDocument();
      expect(screen.getByTestId(`rtt-map-row-a${act}boss`)).toBeInTheDocument();
    }
  });
});

// ---------------------------------------------------------------------------
// The start gate reads its counts, never hardcodes them
// ---------------------------------------------------------------------------

describe("RunStartGate — counts come from the ruleset", () => {
  it("prints the ruleset's own act, battle and life counts", async () => {
    render(<RunTheTableGame />);
    await screen.findByTestId("rtt-start-gate");

    expect(await screen.findByTestId("rtt-gate-acts")).toHaveTextContent("5 acts");
    expect(screen.getByTestId("rtt-gate-battles")).toHaveTextContent("5 boss battles");
    expect(screen.getByTestId("rtt-gate-lives")).toHaveTextContent("3 lives");
    // The stale literals this replaced.
    const text = screen.getByTestId("rtt-start-gate").textContent ?? "";
    expect(text).not.toMatch(/three acts/i);
    expect(text).not.toMatch(/three lives/i);
    expect(text).not.toMatch(/four escalating/i);
  });

  it("publishes the credit sinks with their prices before a run exists", async () => {
    render(<RunTheTableGame />);
    await screen.findByTestId("rtt-start-gate");
    const sinks = await screen.findByTestId("rtt-gate-credit-sinks");
    expect(sinks).toHaveTextContent("Market Refresh");
    expect(sinks).toHaveTextContent("7 cr");
    expect(sinks).toHaveTextContent("Emergency Recovery");
    expect(sinks).toHaveTextContent("20 cr");
  });

  /** A meta fetch that failed must not blank the gate or invent a number. */
  it("drops the count-bearing clauses when the ruleset could not be fetched", async () => {
    mockGetMeta.mockRejectedValue(new Error("offline"));
    render(<RunTheTableGame />);
    await screen.findByTestId("rtt-start-gate");

    expect(screen.queryByTestId("rtt-gate-acts")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rtt-gate-lives")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rtt-gate-credit-sinks")).not.toBeInTheDocument();
    // And the gate is still fully usable.
    expect(screen.getByTestId("rtt-start-standard")).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// The rail shows what is armed
// ---------------------------------------------------------------------------

describe("RunTray — armed effects", () => {
  function armedState(over: Partial<NonNullable<RunPublicState["armed"]>>) {
    return runState({
      status: "node_select",
      stage_options: [],
      reveal: { roster: rosterTrack(7), boss: null },
      armed: { ...runState().armed!, ...over },
    });
  }

  async function mount(state: RunPublicState) {
    mockCreateRun.mockResolvedValue(state);
    render(<RunTheTableGame />);
    await userEvent.click(await screen.findByTestId("rtt-start-standard"));
    await screen.findByTestId("rtt-shell");
  }

  it("shows nothing when nothing is armed", async () => {
    await mount(armedState({}));
    expect(screen.queryByTestId("rtt-armed")).not.toBeInTheDocument();
  });

  /**
   * These three are the whole reason the block exists: each is credit already
   * spent whose effect lands somewhere the player cannot currently see — a
   * battle two nodes away, a market not yet opened, a Draft Room that does not
   * exist on screen.
   */
  it("names the prepared lane, the focused role and the reserved price", async () => {
    await mount(
      armedState({
        prep: { lane: "team_achievement", label: "Team Result", bonus: 2.5, act: 2 },
        role_focus: {
          role: "anchor", acquired_act: 1, acquired_stage: 2, consumed_node_id: null,
        },
        reserved_card: {
          card_id: "future-1", locked_cost: 18, locked_modifiers: [],
          reserved_act: 1, reserved_stage: 1, offered_node_id: null, status: "live",
        },
      }),
    );
    expect(screen.getByTestId("rtt-armed-prep")).toHaveTextContent("Team Result");
    expect(screen.getByTestId("rtt-armed-prep")).toHaveTextContent("+2.5");
    expect(screen.getByTestId("rtt-armed-prep")).toHaveTextContent("act 2 boss");
    expect(screen.getByTestId("rtt-armed-role-focus")).toHaveTextContent("Anchor");
    expect(screen.getByTestId("rtt-armed-reservation")).toHaveTextContent("18");
    expect(screen.getByTestId("rtt-armed-reservation")).toHaveTextContent(
      /next Draft Room/i,
    );
  });

  it("stops claiming a reservation once it has been used or has expired", async () => {
    const spent = {
      card_id: "future-1", locked_cost: 18, locked_modifiers: [],
      reserved_act: 1, reserved_stage: 1, offered_node_id: "a2s1o0",
      status: "used" as const,
    };
    await mount(armedState({ reserved_card: spent }));
    expect(screen.queryByTestId("rtt-armed")).not.toBeInTheDocument();
  });
});
