/**
 * RUN THE TABLE — game-feel pass 3.
 *
 * The run around the decision: newer-wins commits, the run track, transition
 * moments derived from two snapshots, lives as pieces, the progressive coach,
 * the dealt draft room, the staged battle, and the ending sequence.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

let reducedMotion = false;
vi.mock("@/lib/a11y", async () => {
  const actual = await vi.importActual<typeof import("@/lib/a11y")>("@/lib/a11y");
  return { ...actual, usePrefersReducedMotion: () => reducedMotion };
});

import LifeMeter from "@/components/game-feel/LifeMeter";
import RunTrack from "@/components/game-feel/RunTrack";
import PeakV2RTTDraftRoom from "@/components/v2/rtt/PeakV2RTTDraftRoom";
import PeakV2RTTBattleResult from "@/components/v2/rtt/PeakV2RTTBattleResult";
import PeakV2RTTBossIntro, { BOSS_INTRO_HOLD_MS } from "@/components/v2/rtt/PeakV2RTTBossIntro";
import PeakV2RTTResult from "@/components/v2/rtt/PeakV2RTTResult";
import PeakV2RTTShell from "@/components/v2/rtt/PeakV2RTTShell";
import PeakV2RTTCoach from "@/components/v2/rtt/PeakV2RTTCoach";
import { RTT_COACH_STORAGE_KEY, coachSeen, markCoachSeen, resetCoach } from "@/lib/run-the-table-coach";
import {
  RUN_THE_TABLE_BEST_KEY,
  actNumeral,
  battleResolution,
  describeRunTransition,
  isNewerRun,
  loadPersonalBest,
  recordPersonalBest,
  runIdentity,
  runTrackActs,
} from "@/lib/run-the-table-state";
import type { ActiveNode, BattlePublic, BossPublic, DraftOffer, MapAct, RunCardPublic, RunPublicState, RunReceipt } from "@/types/run-the-table";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SLOT_IDS = ["lead_creator", "guard_wing", "wing_forward", "forward_big", "anchor", "bench_1", "bench_2"] as const;

function card(id: string, name: string, score = 60, role = "forward_big"): RunCardPublic {
  return {
    card_id: id,
    player_name: name,
    player_slug: id,
    start_season: "1990-91",
    end_season: "1992-93",
    anchor_season: "1991-92",
    window_label: "1990-91 – 1992-93",
    prime_score: score,
    overall_percentile: 70,
    eligible_roles: [role as never, "bench_1" as never],
    primary_role: role as never,
    lane_index: { statistical_impact: 40, traditional_production: 50, individual_recognition: 30, postseason_individual_value: 20, team_achievement: 10 },
    lane_percentiles: { statistical_impact: 60, traditional_production: 80, individual_recognition: 30, postseason_individual_value: 20, team_achievement: 10 },
    base_cost: 25,
    cost: 25,
    cost_modifiers: [],
    refund_value: 12,
  };
}

function offer(id: string, name: string, over: Partial<DraftOffer> = {}): DraftOffer {
  return {
    ...card(id, name),
    veteran_minimum_eligible: false,
    effective_cost: 25,
    legal_slots: ["forward_big", "bench_1"],
    affordable: true,
    selectable: true,
    blocked_reason: null,
    ...over,
  };
}

function map(over: Partial<{ stageStates: string[][]; bossStates: string[] }> = {}): MapAct[] {
  return [1, 2, 3].map((act) => ({
    act,
    stages: [1, 2].map((stage) => ({
      act,
      stage,
      state: (over.stageStates?.[act - 1]?.[stage - 1] ?? "locked") as never,
      chosen_node_id: null,
      chosen_node_type: over.stageStates?.[act - 1]?.[stage - 1] === "done" ? ("draft_room" as const) : null,
      option_types: ["draft_room" as const, "film_room" as const],
      scouted: false,
    })),
    boss: { boss_id: `boss-${act}`, name: `Boss ${act}`, state: (over.bossStates?.[act - 1] ?? "locked") as never },
  }));
}

function runState(over: Partial<RunPublicState> = {}): RunPublicState {
  return {
    run_id: "run-1",
    seed: 11,
    run_type: "standard",
    date: null,
    status: "node_select",
    act: 1,
    stage: 1,
    acts_total: 3,
    stages_per_act: 2,
    credits: 50,
    lives: 3,
    max_lives: 3,
    starting_credits: 50,
    starters: SLOT_IDS.slice(0, 5).map((slot_id, i) => ({ slot_id, role: slot_id as never, is_starter: true, card: card(`c${i}`, `Starter ${i}`, 50 + i, slot_id) })),
    bench: [
      { slot_id: "bench_1", role: null, is_starter: false, card: null },
      { slot_id: "bench_2", role: null, is_starter: false, card: null },
    ],
    systems: [],
    pending_system_offer: null,
    stage_options: null,
    active_node: null,
    next_boss: null,
    map: map({ stageStates: [["current", "locked"]], bossStates: ["locked"] }),
    battles: [],
    lane_profile: [
      { lane: "statistical_impact", label: "Statistical Impact", token: "si", value: 30 },
      { lane: "traditional_production", label: "Traditional Production", token: "tp", value: 35 },
      { lane: "individual_recognition", label: "Individual Recognition", token: "rec", value: 12 },
      { lane: "postseason_individual_value", label: "Playoff Rate Impact", token: "po", value: 20 },
      { lane: "team_achievement", label: "Team Result", token: "team", value: 21 },
    ],
    roster_total: 27,
    bench_weight: 0.35,
    veteran_minimum_used_this_act: false,
    reveal: { roster: { revealed: 7, total: 7, complete: true, order: [], revealed_slots: [], next_slot: null, can_skip: false, remaining: 0 }, boss: null },
    action_count: 3,
    receipt: null,
    versions: { engine_version: "e", ruleset_version: "r", card_pool_version: "c", peak3_model_version: "m" },
    created_at: "2026-09-06T00:00:00Z",
    last_action_at: "2026-09-06T00:00:00Z",
    ...over,
  };
}

function battle(outcome: BattlePublic["outcome"], over: Partial<BattlePublic> = {}): BattlePublic {
  const lanes = ["statistical_impact", "traditional_production", "individual_recognition", "postseason_individual_value", "team_achievement"] as const;
  const winners: BattlePublic["lanes"][number]["winner"][] = outcome === "win" ? ["player", "player", "opponent", "player", "tie"] : outcome === "loss" ? ["opponent", "player", "opponent", "opponent", "tie"] : ["tie", "tie", "tie", "tie", "tie"];
  return {
    boss_id: "boss-1",
    act: 1,
    outcome,
    decided_by: "lanes",
    player_lanes_won: winners.filter((w) => w === "player").length,
    opponent_lanes_won: winners.filter((w) => w === "opponent").length,
    ties: winners.filter((w) => w === "tie").length,
    summed_margin: 1,
    player_roster_total: 27,
    opponent_roster_total: 26,
    bench_weight: 0.35,
    rule_id: null,
    credits_awarded: outcome === "win" ? 9 : outcome === "loss" ? 6 : 0,
    lives_after: outcome === "loss" ? 2 : 3,
    lanes: lanes.map((lane, i) => ({
      lane,
      label: lane,
      token: (["si", "tp", "rec", "po", "team"] as const)[i],
      winner: winners[i],
      margin: 1,
      tie_broken_by_rule: false,
      player_lineup_rating: 30,
      boss_lineup_rating: 29,
      pre_perk_rating: 30,
      perk_adjustment: 0,
      bench_adjustment: 0,
      final_rating: 30,
      starters_only_rating: 30,
      bench_contribution: 0,
      bench_suppressed_by: null,
      top_contributor: null,
      opponent_top_contributor: null,
    })),
    lanes_to_win: 3,
    ...over,
  };
}

const boss: BossPublic = { boss_id: "boss-1", name: "The Wall", tagline: "Nothing gets through.", act: 1, rule: null, source: "curated", revealed: true, lanes_to_win: 3 };

function receipt(over: Partial<RunReceipt> = {}): RunReceipt {
  return {
    verdict: "RUN ENDED IN ACT 2",
    outcome: "ended_in_act",
    headline: "Two bosses in, out of lives.",
    story: "A story.",
    ran_the_table: false,
    table_cleared: false,
    bosses_defeated: 1,
    battles_lost: 2,
    record: "1–2",
    lives_remaining: 0,
    systems: [],
    starters: SLOT_IDS.slice(0, 5).map((slot_id, i) => ({ slot_id, role: slot_id as never, card_id: `c${i}`, player_name: `Starter ${i}`, player_slug: `c${i}`, anchor_season: "1991-92", window: "1990-91 – 1992-93", prime_score: 50 + i, base_cost: 20 })),
    bench: [],
    lane_profile: [
      { lane: "statistical_impact", label: "Statistical Impact", value: 30, lanes_won: 1 },
      { lane: "traditional_production", label: "Traditional Production", value: 35, lanes_won: 1 },
      { lane: "individual_recognition", label: "Individual Recognition", value: 12, lanes_won: 0 },
      { lane: "postseason_individual_value", label: "Playoff Rate Impact", value: 20, lanes_won: 0 },
      { lane: "team_achievement", label: "Team Result", value: 21, lanes_won: 0 },
    ],
    roster_total: 27.4,
    strongest_lane: { lane: "traditional_production", label: "Traditional Production", value: 35 },
    weakest_lane: { lane: "individual_recognition", label: "Individual Recognition", value: 12 },
    run_mvp: null,
    marginal_contributions: [],
    best_acquisition: null,
    best_trade: null,
    closest_battle: null,
    credits_spent: 30,
    credits_refunded: 0,
    credits_remaining: 20,
    starting_credits: 50,
    items: [],
    battles: [
      { act: 1, boss_id: "boss-1", outcome: "win", decided_by: "lanes", player_lanes_won: 3, opponent_lanes_won: 1, rule_id: null },
      { act: 2, boss_id: "boss-2", outcome: "loss", decided_by: "lanes", player_lanes_won: 1, opponent_lanes_won: 3, rule_id: null },
    ],
    seed: 11,
    run_type: "standard",
    date: null,
    versions: { engine_version: "e", ruleset_version: "r", card_pool_version: "c", peak3_model_version: "m" },
    ...over,
  };
}

beforeEach(() => {
  cleanup();
  reducedMotion = false;
  window.localStorage.clear();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

describe("isNewerRun — newer wins, older is dropped", () => {
  it("applies a strictly newer action_count and refuses an older one", () => {
    const current = { run_id: "r", action_count: 5, status: "node_select" as const };
    expect(isNewerRun(current, { run_id: "r", action_count: 6, status: "node_active" })).toBe(true);
    expect(isNewerRun(current, { run_id: "r", action_count: 4, status: "node_active" })).toBe(false);
    expect(isNewerRun(current, { run_id: "r", action_count: 5, status: "node_select" })).toBe(false);
  });
  it("always applies a different run (a restart, Run it back) and the first snapshot", () => {
    expect(isNewerRun(null, { run_id: "r", action_count: 0, status: "system_select" })).toBe(true);
    expect(isNewerRun({ run_id: "r", action_count: 40, status: "complete" }, { run_id: "r2", action_count: 0, status: "system_select" })).toBe(true);
  });
});

describe("runTrackActs — the run as chapters", () => {
  it("draws every act with its stops and boss, and keeps a lost boss's scar", () => {
    const acts = runTrackActs(map({ stageStates: [["done", "done"], ["done", "current"]], bossStates: ["lost", "locked"] }));
    expect(acts).toHaveLength(3);
    expect(acts[0].numeral).toBe("I");
    expect(acts[0].state).toBe("done");
    expect(acts[0].boss.lifeLost).toBe(true);
    expect(acts[1].state).toBe("current");
    expect(acts[1].nodes[1].state).toBe("current");
    expect(acts[2].state).toBe("locked");
    // A future stop says only its shape, never its content.
    expect(acts[2].nodes[0].label).toBe("Draft Room or Scout");
    expect(acts[0].nodes[0].label).toBe("Draft Room");
  });
  it("numbers acts as chapters", () => {
    expect([1, 2, 5].map(actNumeral)).toEqual(["I", "II", "V"]);
  });
});

describe("runIdentity — which board this is", () => {
  it("names a daily by its key and a practice run by its seed", () => {
    expect(runIdentity({ run_type: "daily", seed: 4471, date: "2026-09-06" }).detail).toContain("2026-09-06");
    expect(runIdentity({ run_type: "daily", seed: 4471, date: "2026-09-06" }).title).toBe("Daily run");
    expect(runIdentity({ run_type: "standard", seed: 11, date: null }).title).toBe("Practice run");
    expect(runIdentity({ run_type: "challenge", seed: 11, date: null }).title).toBe("Challenge run");
  });
});

describe("describeRunTransition — the moment, from two snapshots", () => {
  it("announces a signing with the slot and the credits it cost", () => {
    const prev = runState({ status: "node_active", active_node: { node_id: "n1", node_type: "draft_room", title: "", summary: "" } });
    const next = runState({ action_count: 4, credits: 25, bench: [{ slot_id: "bench_1", role: null, is_starter: false, card: card("x", "Charles Barkley") }, prev.bench[1]] });
    const m = describeRunTransition(prev, next);
    expect(m?.kind).toBe("signed");
    expect(m?.title).toBe("Charles Barkley");
    expect(m?.detail).toContain("Bench 1");
    expect(m?.detail).toContain("25 credits");
  });
  it("does NOT announce the opening reveal as a signing", () => {
    const prev = runState({ status: "system_select", reveal: { roster: { revealed: 0, total: 7, complete: false, order: [], revealed_slots: [], next_slot: null, can_skip: false, remaining: 7 }, boss: null }, starters: SLOT_IDS.slice(0, 5).map((slot_id) => ({ slot_id, role: slot_id as never, is_starter: true, card: null })) });
    const next = runState({ status: "system_select", action_count: 4 });
    expect(describeRunTransition(prev, next)).toBeNull();
  });
  it("announces a lost life over anything else, with the boss's name", () => {
    const prev = runState({ status: "boss_ready", next_boss: boss });
    const next = runState({ status: "boss_resolved", action_count: 4, lives: 2, credits: 56, battles: [battle("loss")], next_boss: boss });
    const m = describeRunTransition(prev, next);
    expect(m?.kind).toBe("life_lost");
    expect(m?.detail).toContain("The Wall");
    expect(m?.detail).toContain("2 lives left");
  });
  it("announces an act cleared when the act advances", () => {
    const prev = runState({ status: "boss_resolved", act: 1, battles: [battle("win")] });
    const next = runState({ status: "node_select", act: 2, action_count: 4, battles: [battle("win")] });
    const m = describeRunTransition(prev, next);
    expect(m?.kind).toBe("act_cleared");
    expect(m?.title).toBe("Act I cleared");
  });
  it("is silent across runs and when nothing announceable changed", () => {
    expect(describeRunTransition(runState(), runState({ run_id: "other" }))).toBeNull();
    expect(describeRunTransition(runState(), runState({ action_count: 4, status: "node_active" }))).toBeNull();
    expect(describeRunTransition(null, runState())).toBeNull();
  });
});

describe("battleResolution — the outcome can never read as a contradiction", () => {
  it("states first-to-N when a side reached it", () => {
    const r = battleResolution(battle("win"), 3);
    expect(r.stamp).toBe("VICTORY");
    expect(r.count).toBe("3–1 on lanes");
    expect(r.target).toBe("first to 3");
    expect(r.decider).toBe("Decided on lanes won");
    expect(r.fellShort).toBe(false);
  });
  it("says 3–2 is NOT enough under a four-lane rule and names the margin that decided a loss", () => {
    const b = battle("win", { outcome: "loss", decided_by: "summed_margin", summed_margin: -4.2, player_lanes_won: 3, opponent_lanes_won: 2, ties: 0, lanes_to_win: 4 });
    const r = battleResolution(b, 4);
    expect(r.stamp).toBe("DEFEAT");
    expect(r.count).toBe("3–2 on lanes");
    expect(r.target).toBe("4 needed — 3–2 is not enough");
    expect(r.decider).toBe("Decided on total lane margin -4.2");
    expect(r.fellShort).toBe(true);
    expect(r.sentence).toContain("DEFEAT. 3–2 on lanes, 4 needed");
  });
  it("explains a level count with drawn lanes and a roster-total decider", () => {
    const b = battle("draw", { outcome: "win", decided_by: "roster_total", player_lanes_won: 1, opponent_lanes_won: 1, ties: 3, summed_margin: 0, player_roster_total: 27.4, opponent_roster_total: 26.1 });
    const r = battleResolution(b, 3);
    expect(r.target).toBe("3 needed — level with 3 lanes drawn");
    expect(r.decider).toBe("Decided on overall roster total 27.4 to 26.1");
    expect(r.stamp).toBe("VICTORY");
  });
});

describe("personal best — local, never a leaderboard", () => {
  it("records the first run, then only a better one", () => {
    expect(loadPersonalBest()).toBeNull();
    const first = recordPersonalBest(receipt({ bosses_defeated: 1, roster_total: 27.4 }));
    expect(first.isNew).toBe(true);
    expect(first.previous).toBeNull();
    const worse = recordPersonalBest(receipt({ bosses_defeated: 1, roster_total: 26 }));
    expect(worse.isNew).toBe(false);
    expect(worse.previous?.roster_total).toBe(27.4);
    const better = recordPersonalBest(receipt({ bosses_defeated: 3, roster_total: 20 }));
    expect(better.isNew).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(RUN_THE_TABLE_BEST_KEY) ?? "{}").bosses_defeated).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// The progressive coach
// ---------------------------------------------------------------------------

describe("the progressive coach", () => {
  it("shows a chip once, remembers a dismissal, and can be reset", async () => {
    render(<PeakV2RTTCoach coach="first_choice" />);
    const chip = await screen.findByTestId("rtt-coach-first_choice");
    expect(chip).toHaveTextContent("Pick one. It joins your lineup.");
    await userEvent.click(screen.getByTestId("rtt-coach-dismiss-first_choice"));
    expect(screen.queryByTestId("rtt-coach-first_choice")).not.toBeInTheDocument();
    expect(coachSeen("first_choice")).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(RTT_COACH_STORAGE_KEY) ?? "{}").seen).toEqual(["first_choice"]);
    resetCoach();
    expect(coachSeen("first_choice")).toBe(false);
  });
  it("never shows for a returning player, and never while inactive", async () => {
    markCoachSeen("first_boss");
    render(
      <>
        <PeakV2RTTCoach coach="first_boss" />
        <PeakV2RTTCoach coach="first_credit" active={false} />
      </>,
    );
    await act(async () => {});
    expect(screen.queryByTestId("rtt-coach-first_boss")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rtt-coach-first_credit")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

describe("LifeMeter — lives as pieces", () => {
  it("draws one pip per life, scars the lost ones, and flags danger at one life", () => {
    const { rerender } = render(<LifeMeter lives={3} max={3} testId="lm" valueTestId="lm-value" />);
    const meter = screen.getByTestId("lm");
    expect(meter).toHaveAttribute("aria-label", "3 of 3 lives");
    expect(meter.querySelectorAll('.gf-lives-pip[data-alive="true"]')).toHaveLength(3);
    expect(meter).toHaveAttribute("data-danger", "false");
    rerender(<LifeMeter lives={1} max={3} testId="lm" valueTestId="lm-value" />);
    expect(meter.querySelectorAll('.gf-lives-pip[data-alive="false"]')).toHaveLength(2);
    expect(meter).toHaveAttribute("data-danger", "true");
    expect(meter).toHaveAttribute("data-beat", "lost");
    expect(meter.querySelector('.gf-lives-pip[data-just-lost="true"]')).not.toBeNull();
    expect(screen.getByTestId("lm-value")).toHaveTextContent("1/3");
  });
});

describe("RunTrack — where you are in the run", () => {
  it("marks every stop with its kind, state and scar, and the current one as the step", () => {
    const acts = runTrackActs(map({ stageStates: [["done", "done"], ["current", "locked"]], bossStates: ["lost", "locked"] }));
    render(
      <RunTrack
        chapters={acts.map((a) => ({ key: `a${a.act}`, numeral: a.numeral, state: a.state, marks: [...a.nodes, a.boss].map((n) => ({ key: n.key, kind: n.kind, state: n.state, label: n.label, lifeLost: n.lifeLost })) }))}
        markTestIdPrefix="rtt-map-row"
        testId="track"
      />,
    );
    expect(screen.getByTestId("rtt-map-row-a1boss")).toHaveAttribute("data-row-kind", "boss");
    expect(screen.getByTestId("rtt-map-row-a1boss")).toHaveAttribute("data-row-state", "lost");
    expect(screen.getByTestId("rtt-map-row-a1boss")).toHaveAttribute("data-life-lost", "true");
    expect(screen.getByTestId("rtt-map-row-a2s1")).toHaveAttribute("aria-current", "step");
    expect(screen.getByTestId("rtt-map-row-a3s2")).toHaveAttribute("data-row-state", "locked");
    expect(screen.getByTestId("track-chapter-a2")).toHaveAttribute("data-state", "current");
    expect(screen.getAllByTestId(/^rtt-map-row-/)).toHaveLength(9);
  });
});

// ---------------------------------------------------------------------------
// The draft room
// ---------------------------------------------------------------------------

describe("PeakV2RTTDraftRoom — deal, pick, lock", () => {
  const node: ActiveNode = { node_id: "n1", node_type: "draft_room", title: "Draft Room", summary: "Three on the board.", offers: [offer("a", "Charles Barkley"), offer("b", "Tyrese Maxey", { cost: 7, effective_cost: 7 }), offer("c", "Blocked Guy", { selectable: false, blocked_reason: "Already on your roster." })], can_pass: true, credit_sinks: [] };
  const slots = runState().starters.concat(runState().bench);

  it("deals the offers as cards, and shows no commit bar until one is picked", () => {
    render(<PeakV2RTTDraftRoom node={node} slots={slots} credits={50} busy={false} act={1} stage={1} stagesPerAct={2} onBuy={vi.fn(async () => null)} onPass={vi.fn(async () => null)} />);
    expect(screen.getAllByTestId(/^rtt-offer-/)).toHaveLength(3);
    expect(screen.queryByTestId("rtt-draft-commit")).not.toBeInTheDocument();
    expect(screen.getByTestId("rtt-offer-c")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("rtt-offer-c")).toHaveTextContent("Already on your roster.");
    expect(screen.getByText("Choose your peak.")).toBeInTheDocument();
  });

  it("projects the cost and the legal slots on pick, then locks with ONE promise per press", async () => {
    const onBuy = vi.fn(() => new Promise((r) => setTimeout(() => r(true), 40)));
    const onProject = vi.fn();
    render(<PeakV2RTTDraftRoom node={node} slots={slots} credits={50} busy={false} act={1} stage={1} stagesPerAct={2} onBuy={onBuy} onPass={vi.fn(async () => null)} onProject={onProject} />);
    await userEvent.click(screen.getByTestId("rtt-offer-a"));
    expect(screen.getByTestId("rtt-offer-a")).toHaveAttribute("aria-pressed", "true");
    expect(onProject).toHaveBeenLastCalledWith(25, ["forward_big", "bench_1"]);
    expect(screen.getByText("Sign Charles Barkley?")).toBeInTheDocument();
    const commit = screen.getByTestId("rtt-draft-commit");
    expect(within(commit).getByTestId("rtt-draft-slot-forward_big")).toHaveTextContent("replaces Starter 3");
    expect(within(commit).getByTestId("rtt-draft-slot-bench_1")).toHaveTextContent("open");

    // Two presses in the same tick — one signing.
    const slot = within(commit).getByTestId("rtt-draft-slot-bench_1");
    fireEvent.click(slot);
    fireEvent.click(slot);
    expect(onBuy).toHaveBeenCalledTimes(1);
    expect(onBuy).toHaveBeenCalledWith(expect.objectContaining({ card_id: "a" }), "bench_1", false);
    expect(slot).toHaveAttribute("data-state", "pending");
    expect(slot).toHaveTextContent("Signing…");
  });

  it("refuses a slot the player cannot afford, and passes through one promise", async () => {
    const onPass = vi.fn(async () => null);
    render(<PeakV2RTTDraftRoom node={node} slots={slots} credits={10} busy={false} act={1} stage={1} stagesPerAct={2} onBuy={vi.fn(async () => null)} onPass={onPass} />);
    await userEvent.click(screen.getByTestId("rtt-offer-a"));
    expect(screen.getByRole("alert")).toHaveTextContent("Not enough credits");
    expect(screen.getByTestId("rtt-draft-slot-bench_1")).toBeDisabled();
    await userEvent.click(screen.getByTestId("rtt-draft-pass"));
    expect(onPass).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// The boss encounter
// ---------------------------------------------------------------------------

describe("PeakV2RTTBossIntro — the title card", () => {
  it("names the boss, the rule and the stakes, and ends its hold on its own — once", () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    render(<PeakV2RTTBossIntro boss={{ ...boss, rule: { id: "the_wall", name: "The Wall", summary: "s" } }} lanesToWin={3} lives={2} maxLives={3} reducedMotion={false} onComplete={onComplete} />);
    expect(screen.getByTestId("rtt-boss-intro")).toHaveTextContent("Boss battle · Act I");
    expect(screen.getByTestId("rtt-boss-intro-win-condition")).toHaveTextContent("Win 3 of the five lanes");
    expect(screen.getByTestId("rtt-boss-intro")).toHaveTextContent("2 of 3");
    act(() => {
      vi.advanceTimersByTime(BOSS_INTRO_HOLD_MS + 10);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("rtt-boss-intro-skip"));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
  it("skips the hold entirely under reduced motion", () => {
    const onComplete = vi.fn();
    render(<PeakV2RTTBossIntro boss={boss} lanesToWin={3} lives={3} maxLives={3} reducedMotion onComplete={onComplete} />);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
  it("wears the final-boss treatment only for the final boss", () => {
    render(<PeakV2RTTBossIntro boss={{ ...boss, is_final: true, act: 5 }} lives={1} maxLives={3} reducedMotion onComplete={vi.fn()} />);
    expect(screen.getByTestId("rtt-boss-intro")).toHaveAttribute("data-final", "true");
    expect(screen.getByTestId("rtt-boss-intro")).toHaveTextContent("Final boss · Act V");
  });
});

describe("PeakV2RTTBattleResult — lanes, verdict, consequence", () => {
  it("stages the lanes, then the verdict, then the lost life, then the action", () => {
    vi.useFakeTimers();
    render(<PeakV2RTTBattleResult battle={battle("loss")} boss={boss} busy={false} lives={2} maxLives={3} actsTotal={3} lanesToWin={3} onAdvance={vi.fn(async () => null)} advanceLabel="On to Act II" />);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("rtt-battle-lane-statistical_impact")).toHaveAttribute("data-revealed", "true");
    expect(screen.getByTestId("rtt-battle-verdict")).toHaveAttribute("data-revealed", "false");
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByTestId("rtt-battle-verdict")).toHaveAttribute("data-revealed", "true");
    expect(screen.getByTestId("rtt-battle-verdict")).toHaveTextContent("DEFEAT");
    expect(screen.getByTestId("rtt-battle-consequence")).toHaveAttribute("data-revealed", "false");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId("rtt-battle-life-lost")).toHaveTextContent("Life lost");
    expect(screen.getByTestId("rtt-battle-lives")).toHaveAttribute("data-lives", "2");
    expect(screen.getByTestId("rtt-battle-advance")).toHaveTextContent("On to Act II");
    expect(screen.getByTestId("rtt-battle-series")).toHaveTextContent("1—3");
  });
  it("completes at once on a click, and reads a cleared act on a win", () => {
    render(<PeakV2RTTBattleResult battle={battle("win")} boss={boss} busy={false} lives={3} maxLives={3} actsTotal={3} onAdvance={vi.fn(async () => null)} advanceLabel="On to Act II" />);
    fireEvent.click(screen.getByTestId("rtt-battle-reveal"));
    expect(screen.getByTestId("rtt-battle-reveal")).toHaveAttribute("data-complete", "true");
    expect(screen.getByTestId("rtt-battle-won")).toHaveTextContent("Act I cleared");
    expect(screen.getByTestId("rtt-battle-won")).toHaveTextContent("+9 credits");
    expect(screen.getByTestId("rtt-battle-verdict")).toHaveTextContent("VICTORY");
  });
  it("calls the final boss's clear a cleared table, and shows a resumed battle complete", () => {
    render(<PeakV2RTTBattleResult battle={battle("win", { act: 3 })} boss={boss} busy={false} lives={3} maxLives={3} actsTotal={3} onAdvance={vi.fn(async () => null)} advanceLabel="See the receipt" resumed />);
    expect(screen.getByTestId("rtt-battle-reveal")).toHaveAttribute("data-complete", "true");
    expect(screen.getByTestId("rtt-battle-won")).toHaveTextContent("Table cleared");
  });
});

// ---------------------------------------------------------------------------
// The ending
// ---------------------------------------------------------------------------

describe("PeakV2RTTResult — the run ends in a sequence", () => {
  it("opens on the ending stamp, holds everything else back, then offers Run it back — and records a personal best", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<PeakV2RTTResult receipt={receipt()} versions={receipt().versions} busy={false} actsTotal={3} map={map({ bossStates: ["won", "lost", "locked"] })} onRunItBack={vi.fn(async () => null)} onReplaySeed={vi.fn()} onChallenge={vi.fn(async () => null)} />);
    expect(screen.getByTestId("rtt-result")).toHaveAttribute("data-outcome", "ended_in_act");
    expect(screen.getByTestId("rtt-ending-kind")).toHaveTextContent("Run ended");
    expect(screen.getByTestId("rtt-result-verdict")).toHaveTextContent("RUN ENDED IN ACT 2");
    expect(screen.getByTestId("rtt-result-battles")).toHaveAttribute("data-revealed", "false");
    act(() => {
      vi.advanceTimersByTime(2600);
    });
    expect(screen.getByTestId("rtt-result-battles")).toHaveAttribute("data-revealed", "true");
    expect(screen.getByTestId("rtt-result-battle-2")).toHaveTextContent("Lost · life");
    expect(screen.getByTestId("rtt-run-it-back")).toBeInTheDocument();
    await act(async () => {});
    expect(screen.getByTestId("rtt-result-best-new")).toHaveTextContent("New personal best");
  });
  it("calls a full clear a cleared table and shows a resumed receipt complete", () => {
    render(<PeakV2RTTResult receipt={receipt({ outcome: "table_cleared", table_cleared: true, verdict: "TABLE CLEARED", bosses_defeated: 3, lives_remaining: 2 })} versions={receipt().versions} busy={false} actsTotal={3} map={null} onRunItBack={vi.fn(async () => null)} onReplaySeed={vi.fn()} onChallenge={vi.fn(async () => null)} resumed />);
    expect(screen.getByTestId("rtt-result")).toHaveAttribute("data-outcome", "table_cleared");
    expect(screen.getByTestId("rtt-ending-kind")).toHaveTextContent("Final boss cleared");
    expect(screen.getByTestId("rtt-result-reveal")).toHaveAttribute("data-complete", "true");
    expect(screen.getByTestId("rtt-run-it-back")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// The shell
// ---------------------------------------------------------------------------

describe("PeakV2RTTShell — the run around the decision", () => {
  it("names the board, meters credits with a projection, draws lives and the track, and announces a moment", () => {
    render(
      <PeakV2RTTShell
        state={runState({ run_type: "daily", date: "2026-09-06", seed: 4471, lives: 1 })}
        objective="Draft Room"
        layout="live"
        content={<div>decision</div>}
        projectedCredits={25}
        targetedSlots={["bench_1"]}
        moment={{ id: "m1", kind: "signed", title: "Charles Barkley", detail: "Bench 1 · 25 credits", tone: "accent" }}
      />,
    );
    expect(screen.getByTestId("rtt-run-identity")).toHaveTextContent("Daily run · 2026-09-06 · seed 4471");
    expect(screen.getByTestId("rtt-run-identity")).toHaveAttribute("data-run-kind", "daily");
    expect(screen.getByTestId("rtt-hud-objective")).toHaveTextContent("Draft Room");
    expect(screen.getByTestId("rtt-credits")).toHaveTextContent("50");
    expect(screen.getByTestId("rtt-credits-projected")).toHaveTextContent("25");
    expect(screen.getByTestId("rtt-lives")).toHaveTextContent("1/3");
    expect(screen.getByTestId("rtt-shell")).toHaveAttribute("data-danger", "true");
    expect(screen.getByTestId("rtt-run-track")).toBeInTheDocument();
    expect(screen.getByTestId("rtt-map-row-a1s1")).toHaveAttribute("data-row-state", "current");
    expect(screen.getByTestId("rtt-moment")).toHaveTextContent("Charles Barkley");
    expect(screen.getByTestId("rtt-roster-slot-bench_1")).toHaveAttribute("data-state", "targeted");
    expect(screen.getByTestId("rtt-roster-slot-lead_creator")).toHaveAttribute("data-state", "filled");
    expect(screen.getByTestId("rtt-lane-profile")).toHaveTextContent("27.0");
  });
  it("shows the act-cleared card as a non-blocking overlay and no rail in focus layout", () => {
    render(<PeakV2RTTShell state={runState({ act: 2 })} objective="Boss" layout="focus" content={<button>go</button>} actTransition={{ id: "a1", numeral: "I", detail: "Act II begins" }} boss />);
    expect(screen.getByTestId("rtt-act-transition")).toHaveTextContent("Act I");
    expect(screen.getByTestId("rtt-act-transition")).toHaveTextContent("Cleared");
    expect(screen.getByTestId("rtt-shell")).toHaveAttribute("data-boss", "true");
    expect(screen.queryByTestId("rtt-roster")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "go" })).toBeEnabled();
  });
});
