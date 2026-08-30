/**
 * A seedless `/arena/practice/{mode}` visit — every link that doesn't spell
 * out `?seed=`, including every "Practice" link on `/arena/labs` — used to
 * send `createDraftGame(mode, "practice", { seed: undefined })`, which
 * `JSON.stringify` drops entirely, and the API rejects a practice board
 * with no seed (`board_error`: "Board config must have either a date
 * (daily) or a seed"). Found during the release-candidate QA pass on
 * commit 0b50745/939f8b2 — confirmed pre-existing, not introduced by the
 * Peak Draft visual batch, but real: every genuinely seedless entry point
 * into Practice was broken.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import PracticeDraftLoader from "@/components/draft/PracticeDraftLoader";
import * as draftApi from "@/lib/draft-api";
import type { DraftGameState } from "@/types/draft";

vi.mock("@/lib/draft-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/draft-api")>("@/lib/draft-api");
  return { ...actual, createDraftGame: vi.fn() };
});

function gameState(): DraftGameState {
  return {
    game_id: "game-1",
    mode: "apex_1y",
    duration_years: 1,
    board_type: "practice",
    status: "round_active",
    current_round: 1,
    total_rounds: 5,
    current_offers: [],
    selected_cards: [],
    round_history: [],
    open_roles: ["lead_creator", "guard_wing", "wing_forward", "forward_big", "anchor"],
    current_dna: null,
    hold_available: true,
    held_card: null,
    reframe_available: true,
    reframed_this_round: false,
    hold_used: false,
    reframe_used: false,
    board_metadata: {
      board_id: "practice-apex_1y-1",
      lineup_model_version: "v1",
      ruleset_version: "v1",
      card_pool_version: "v1",
    },
    lineup_evaluation: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PracticeDraftLoader", () => {
  it("always sends a numeric seed, even with no seed prop", async () => {
    vi.mocked(draftApi.createDraftGame).mockResolvedValue(gameState());

    render(<PracticeDraftLoader mode="apex_1y" />);

    await waitFor(() => expect(draftApi.createDraftGame).toHaveBeenCalledTimes(1));
    const [, , options] = vi.mocked(draftApi.createDraftGame).mock.calls[0];
    expect(options?.seed).toEqual(expect.any(Number));
    expect(Number.isFinite(options?.seed)).toBe(true);
  });

  it("uses the caller's seed when one is given, rather than inventing its own", async () => {
    vi.mocked(draftApi.createDraftGame).mockResolvedValue(gameState());

    render(<PracticeDraftLoader mode="apex_1y" seed={42} />);

    await waitFor(() => expect(draftApi.createDraftGame).toHaveBeenCalledTimes(1));
    expect(draftApi.createDraftGame).toHaveBeenCalledWith(
      "apex_1y",
      "practice",
      { seed: 42 },
    );
  });

  it("shows the loading state, then the draft screen once the board resolves", async () => {
    vi.mocked(draftApi.createDraftGame).mockResolvedValue(gameState());

    render(<PracticeDraftLoader mode="apex_1y" />);

    expect(screen.getByTestId("practice-draft-loading")).toBeVisible();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Peak Draft" })).toBeVisible());
  });

  it("retrying after a failure reuses the same seed rather than picking a new board", async () => {
    vi.mocked(draftApi.createDraftGame).mockRejectedValueOnce(
      new draftApi.DraftAPIError(400, "Board config must have either a date (daily) or a seed"),
    );
    vi.mocked(draftApi.createDraftGame).mockResolvedValueOnce(gameState());

    render(<PracticeDraftLoader mode="apex_1y" />);

    await waitFor(() => expect(screen.getByTestId("practice-draft-retry")).toBeVisible());
    const firstSeed = vi.mocked(draftApi.createDraftGame).mock.calls[0][2]?.seed;

    screen.getByTestId("practice-draft-retry").click();

    await waitFor(() => expect(draftApi.createDraftGame).toHaveBeenCalledTimes(2));
    const secondSeed = vi.mocked(draftApi.createDraftGame).mock.calls[1][2]?.seed;
    expect(secondSeed).toBe(firstSeed);
  });
});
