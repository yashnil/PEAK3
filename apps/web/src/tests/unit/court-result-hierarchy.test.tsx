/**
 * 82-0 result screen — reading order and the absence of the "Data receipt"
 * tag (final pre-deploy polish). The result used to be one undifferentiated
 * column of small grey text below the hero; it is now a hero followed by
 * five indexed sections and a footnote block, in this order. The order is
 * asserted from the DOM, so a refactor that moves the actions above the
 * roster or the small print above the analysis fails here.
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import type { CourtLineupPublicState, CourtSlotPublic, SimulationResultPublic } from "@/types/perfect-season";

vi.mock("@/lib/perfect-season-api", () => ({
  getLeaderboard: vi.fn(async () => ({ leaderboard_enabled: true, entries: [] })),
  getMyRuns: vi.fn(async () => ({ runs: [] })),
  saveCourtRun: vi.fn(),
  submitToLeaderboard: vi.fn(),
  PerfectSeasonAPIError: class PerfectSeasonAPIError extends Error {},
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ user: null, loading: false }) }));

import PeakV2CourtResult from "@/components/v2/court/PeakV2CourtResult";

const SLOT_TYPES = ["PG", "SG", "SF", "PF", "C", "bench_1", "bench_2", "bench_3"] as const;

function slots(): CourtSlotPublic[] {
  return SLOT_TYPES.map(
    (slot_type, i) =>
      ({
        slot_type,
        filled: true,
        player_name: `Player ${i + 1}`,
        team_name: "Test City Testers",
        season: "2020-21",
        season_score: 60 + i,
        score_status: "exact_season_scored",
        exact_player_season_key: `${slot_type}-key`,
        primary_position: slot_type.startsWith("bench") ? "SF" : slot_type,
        role_fit: "primary",
      }) as unknown as CourtSlotPublic,
  );
}

const result = {
  wins: 58,
  losses: 24,
  lineup_peak_score: 63.5,
  lineup_score_status: "complete",
  is_perfect_season: false,
  tier: "contender",
  best_pick: "Player 8",
  structural_weakness: "Player 1",
  structural_weakness_detail: "Relative to the all-time peak scale, the point guard spot is the ceiling.",
  decisive_factors: ["Talent core carried the season", "Bench depth held up"],
  experimental_notice: "The 82-0 simulator is experimental.",
  lineup_model_version: "lineup.v3",
  simulator_version: "sim.v0",
  fit_components: { talent_core: 70, bench_strength: 60, positional_fit: 80, creation_coverage: 60, scoring_coverage: 60, postseason_pedigree: 50, team_context_depth: 40 },
  peak_picks_recap: [],
} as unknown as SimulationResultPublic;

const state = {
  game_id: "game-1",
  status: "result_ready",
  mode: "apex_1y",
  current_round: 8,
  total_rounds: 8,
  slots: slots(),
  board_seed: 4471,
  card_pool_version: "pool.v1",
  board_generator_version: "gen.v1",
  experimental_team_year_data_version: "ty.v3",
  formula_version: "f.v1",
  coverage_mode: "full",
  simulation_result: result,
  challenge_kind: "free_play",
  challenge_date: null,
  eligibility: { savable: true, leaderboard_eligible: true, reason: null, reason_detail: null },
  respin_history: [],
  state_version: 20,
} as unknown as CourtLineupPublicState;

describe("82-0 result hierarchy", () => {
  it("reads hero -> roster -> analysis -> factors -> model detail -> actions -> footnotes, with no Data receipt tag", async () => {
    render(<PeakV2CourtResult state={state} result={result} onPlayAgain={() => undefined} />);
    const ids = [
      "result-hero",
      "result-section-roster",
      "result-section-analysis",
      "result-section-factors",
      "result-section-model",
      "result-actions",
      "result-footnotes",
    ];
    const nodes = ids.map((id) => screen.getByTestId(id));
    for (let i = 1; i < nodes.length; i++) {
      // DOCUMENT_POSITION_FOLLOWING: nodes[i] comes after nodes[i - 1].
      expect(nodes[i - 1].compareDocumentPosition(nodes[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `${ids[i - 1]} before ${ids[i]}`).toBeTruthy();
    }

    // The primary result is the record, its tier and its framing -- all in the hero.
    const hero = screen.getByTestId("result-hero");
    expect(within(hero).getByTestId("result-tier")).toHaveTextContent("Strong Playoff Team");
    expect(within(hero).getByTestId("season-record")).toBeInTheDocument();
    expect(within(hero).getByTestId("record-framing")).toHaveTextContent(/season/);

    // The analysis keeps its checkable numbers and its emphasis.
    const analysis = screen.getByTestId("result-section-analysis");
    expect(within(analysis).getByTestId("lineup-peak-score")).toHaveTextContent("63.5");
    expect(within(analysis).getByTestId("best-pick-score")).toHaveTextContent("67 PEAK3");
    expect(within(analysis).getByTestId("weakness-label")).toHaveAttribute("data-tone", "caution");
    expect(within(analysis).getByTestId("weakness-detail")).toBeInTheDocument();

    // Actions are grouped together, after the result has been read.
    const actions = screen.getByTestId("result-actions");
    expect(within(actions).getByTestId("play-again-btn")).toBeInTheDocument();
    expect(within(actions).getByTestId("share-run-panel")).toBeInTheDocument();
    expect(within(actions).getByTestId("save-run-panel")).toBeInTheDocument();
    // The leaderboard panel mounts once its readiness fetch resolves.
    expect(await within(actions).findByTestId("leaderboard-submit-panel")).toBeInTheDocument();

    // The small print is last, and the receipt has no tag: its summary is the seed.
    const foot = screen.getByTestId("result-footnotes");
    expect(within(foot).getByTestId("experimental-notice")).toHaveTextContent("experimental");
    const receipt = within(foot).getByTestId("result-receipt");
    expect(receipt.querySelector("summary")).toHaveTextContent("Seed 4471");
    expect(receipt).toHaveTextContent("sim.v0");
    expect(screen.queryByText(/data receipt/i)).toBeNull();
  });

  it("a read-only shared result keeps the same order, hides owner-only actions, and offers 'Build your own'", () => {
    render(<PeakV2CourtResult state={state} result={result} readOnly />);
    expect(screen.getByTestId("result-section-roster")).toBeInTheDocument();
    const actions = screen.getByTestId("result-actions");
    expect(within(actions).getByRole("link", { name: /build your own/i })).toBeInTheDocument();
    expect(screen.queryByTestId("leaderboard-submit-panel")).toBeNull();
    expect(screen.queryByTestId("play-again-btn")).toBeNull();
    expect(screen.queryByText(/data receipt/i)).toBeNull();
  });
});
