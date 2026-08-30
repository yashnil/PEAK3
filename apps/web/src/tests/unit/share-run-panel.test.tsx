/**
 * ShareRunPanel had zero component-level coverage before Batch 8 (only
 * courtbuilder.spec.ts's e2e download assertion touched it). Covers the
 * four actions and their state transitions; `downloadScorecardPng` is
 * data-driven (draws on an offscreen canvas from `state`/`result` alone,
 * see lib/scorecard-export.ts's own docstring) so it's mocked here rather
 * than exercised for real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ShareRunPanel from "@/components/court/ShareRunPanel";
import * as scorecardExport from "@/lib/scorecard-export";
import type { SharedCourtResult, SimulationResultPublic } from "@/types/perfect-season";

vi.mock("@/lib/scorecard-export", async () => {
  const actual = await vi.importActual<typeof import("@/lib/scorecard-export")>("@/lib/scorecard-export");
  return { ...actual, downloadScorecardPng: vi.fn() };
});

function state(): SharedCourtResult {
  return {
    game_id: "g1",
    mode: "apex_1y",
    board_seed: 1,
    card_pool_version: "v1",
    slots: [],
    challenge_kind: "free_play",
    challenge_date: null,
    experimental_team_year_data_version: null,
    formula_version: null,
    coverage_mode: null,
    eligibility: null,
  } as unknown as SharedCourtResult;
}

function result(): SimulationResultPublic {
  return {
    wins: 60,
    losses: 22,
    lineup_score_status: "complete",
    lineup_peak_score: 55.5,
    best_pick: "Michael Jordan",
    peak_picks_recap: [{ round_number: 1, matched: true }],
  } as unknown as SimulationResultPublic;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ShareRunPanel", () => {
  it("copies a text summary and shows a confirmation", async () => {
    const user = userEvent.setup();
    // Defined after userEvent.setup(), which installs its own clipboard stub.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true, writable: true });
    render(<ShareRunPanel state={state()} result={result()} />);

    await user.click(screen.getByTestId("share-run-copy-text-btn"));
    await waitFor(() => expect(screen.getByTestId("share-run-copy-text-btn")).toHaveTextContent(/copied/i));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("60-22"));
  });

  it("copies the permalink, not the text summary", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true, writable: true });
    render(<ShareRunPanel state={state()} result={result()} />);

    await user.click(screen.getByTestId("share-run-copy-link-btn"));
    await waitFor(() => expect(screen.getByTestId("share-run-copy-link-btn")).toHaveTextContent(/copied/i));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/arena/court/results/g1"));
  });

  it("falls back to copying text when the native share sheet isn't available", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true, writable: true });
    render(<ShareRunPanel state={state()} result={result()} />);

    await user.click(screen.getByTestId("share-run-native-btn"));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
  });

  it("downloads a scorecard image and reports success", async () => {
    vi.mocked(scorecardExport.downloadScorecardPng).mockResolvedValue(true);
    const user = userEvent.setup();
    render(<ShareRunPanel state={state()} result={result()} />);

    await user.click(screen.getByTestId("share-run-download-btn"));
    await waitFor(() => expect(screen.getByTestId("share-run-download-btn")).toHaveTextContent(/downloaded/i));
    expect(scorecardExport.downloadScorecardPng).toHaveBeenCalled();
  });

  it("reports a failed export honestly rather than claiming success", async () => {
    vi.mocked(scorecardExport.downloadScorecardPng).mockResolvedValue(false);
    const user = userEvent.setup();
    render(<ShareRunPanel state={state()} result={result()} />);

    await user.click(screen.getByTestId("share-run-download-btn"));
    await waitFor(() => expect(screen.getByTestId("share-run-download-btn")).toHaveTextContent(/couldn.t export/i));
  });
});
