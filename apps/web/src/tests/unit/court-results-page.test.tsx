/**
 * `/arena/court/results/[id]` had no component-level coverage before Batch
 * 8 (only courtbuilder.spec.ts's e2e not-found/read-only-scorecard tests
 * touched it). Added when this page was switched from the legacy
 * `SeasonResultStub` to the same `PeakV2CourtResult` the owner's own result
 * screen uses — pins that the swap didn't change what a shared link shows.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import CourtResultsPage from "@/app/(main)/arena/court/results/[id]/page";
import * as perfectSeasonApi from "@/lib/perfect-season-api";
import type { SharedCourtResult, SimulationResultPublic } from "@/types/perfect-season";

vi.mock("@/lib/perfect-season-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/perfect-season-api")>("@/lib/perfect-season-api");
  return { ...actual, getSharedCourtResult: vi.fn() };
});

function sharedResult(): SharedCourtResult {
  return {
    game_id: "shared-1",
    mode: "apex_1y",
    status: "result_ready",
    board_seed: 1,
    card_pool_version: "v1",
    slots: [],
    challenge_kind: "free_play",
    challenge_date: null,
    experimental_team_year_data_version: null,
    formula_version: null,
    coverage_mode: null,
    eligibility: { savable: false, leaderboard_eligible: false, reason: "game_not_complete", reason_detail: null },
    simulation_result: {
      wins: 61,
      losses: 21,
      lineup_score_status: "complete",
      lineup_peak_score: 70.2,
      is_perfect_season: false,
      best_pick: null,
      structural_weakness: null,
      structural_weakness_detail: null,
      weakness_framing: null,
      decisive_factors: [],
      peak_picks_recap: [],
      fit_components: {},
      experimental_notice: "Experimental simulator.",
      lineup_model_version: "v1",
      simulator_version: "v1",
    } as unknown as SimulationResultPublic,
  } as unknown as SharedCourtResult;
}

describe("CourtResultsPage", () => {
  it("renders the read-only scorecard for a finished, shareable run", async () => {
    vi.mocked(perfectSeasonApi.getSharedCourtResult).mockResolvedValue(sharedResult());

    const ui = await CourtResultsPage({ params: Promise.resolve({ id: "shared-1" }) });
    render(ui);

    expect(screen.getByTestId("season-result")).toBeVisible();
    expect(screen.getByText("61-21")).toBeVisible();
    // Read-only: no owner-only leaderboard action.
    expect(screen.queryByTestId("leaderboard-submit-panel")).not.toBeInTheDocument();
    expect(screen.getByText(/build your own/i)).toBeVisible();
  });

  it("shows a clean not-found state when the API rejects the id", async () => {
    vi.mocked(perfectSeasonApi.getSharedCourtResult).mockRejectedValue(new Error("404"));

    const ui = await CourtResultsPage({ params: Promise.resolve({ id: "nope" }) });
    render(ui);

    expect(screen.getByRole("heading", { name: /run not found/i })).toBeVisible();
    expect(screen.getByRole("link", { name: /build your own roster/i })).toHaveAttribute(
      "href",
      "/arena/court/practice/apex_1y",
    );
  });

  it("shows a clean not-found state for a run that isn't actually finished (belt and braces)", async () => {
    vi.mocked(perfectSeasonApi.getSharedCourtResult).mockResolvedValue({
      ...sharedResult(),
      status: "rounds_complete",
      simulation_result: null,
    } as unknown as SharedCourtResult);

    const ui = await CourtResultsPage({ params: Promise.resolve({ id: "shared-1" }) });
    render(ui);

    expect(screen.getByRole("heading", { name: /run not found/i })).toBeVisible();
  });
});
