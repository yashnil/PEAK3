/**
 * Peak Draft — DraftScreen coverage.
 *
 * The legacy draft-game family (Daily/Practice/Labs/DraftScreen) had zero
 * component-level tests before this batch; only e2e (gameplay.spec.ts,
 * daily-challenge.spec.ts) and the pure state-machine/label unit tests
 * (game-state.test.ts, daily-time.test.ts, component-labels.test.ts) covered
 * it. This adds direct coverage of the phase transitions the Batch 7 visual
 * pass touched (selecting → role_select → cancel/confirm, submit failure,
 * completion), so a future pass can catch a regression here without a
 * running API + Playwright.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import DraftScreen from "@/components/draft/DraftScreen";
import * as draftApi from "@/lib/draft-api";
import type {
  DraftCard,
  DraftGameState,
  LineupDNA,
  LineupEvaluation,
} from "@/types/draft";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/lib/draft-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/draft-api")>("@/lib/draft-api");
  return {
    ...actual,
    submitDraftAction: vi.fn(),
    createChallenge: vi.fn(),
    getChallengeComparison: vi.fn(),
  };
});

const dna = (): LineupDNA => ({
  primary_creation: 80,
  scoring_pressure: 70,
  individual_validation: 60,
  postseason_translation: 50,
  team_context: 40,
  context_completeness: 90,
});

function card(overrides: Partial<DraftCard> = {}): DraftCard {
  return {
    peak_window_id: "player-a-1yr-199091",
    player_id: "player-a",
    player_slug: "player-a",
    player_name: "Player A",
    duration_years: 1,
    start_season: "1990-91",
    end_season: "1990-91",
    anchor_season: "1990-91",
    individual_peak_score: 95,
    individual_peak_rank: 3,
    eligible_roles: ["lead_creator", "guard_wing"],
    primary_role: "lead_creator",
    lineup_dna: dna(),
    data_completeness: "complete",
    profile_status: "ok",
    ...overrides,
  };
}

function gameState(overrides: Partial<DraftGameState> = {}): DraftGameState {
  return {
    game_id: "game-1",
    mode: "apex_1y",
    duration_years: 1,
    board_type: "practice",
    status: "round_active",
    current_round: 1,
    total_rounds: 5,
    current_offers: [
      card(),
      card({
        peak_window_id: "player-b-1yr-199192",
        player_name: "Player B",
        eligible_roles: ["anchor"],
        primary_role: "anchor",
      }),
      card({
        peak_window_id: "player-c-1yr-199293",
        player_name: "Player C",
        eligible_roles: ["forward_big"],
        primary_role: "forward_big",
      }),
    ],
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
      board_id: "practice-apex_1y-42",
      lineup_model_version: "v1",
      ruleset_version: "v1",
      card_pool_version: "v1",
    },
    lineup_evaluation: null,
    ...overrides,
  };
}

function evaluation(): LineupEvaluation {
  return {
    lineup_peak_rating: 87.4,
    talent_score: 90,
    coverage_score: 80,
    synergy_total: 0.02,
    final_dna: dna(),
    role_assignments: {
      lead_creator: "player-a-1yr-199091",
      guard_wing: "player-b-1yr-199192",
      wing_forward: "player-c-1yr-199293",
      forward_big: "player-c-1yr-199293",
      anchor: "player-c-1yr-199293",
    },
    board_optimum: 95,
    board_floor: 40,
    draft_efficiency: 0.72,
    board_percentile: 81,
    solver_version: "v1",
    lineup_model_version: "v1",
    ruleset_version: "v1",
    completeness: 1,
    missing_data_warnings: [],
    synergy_items: [],
    receipt_items: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("DraftScreen", () => {
  it("renders the mode/round identity, the heading and every offer", () => {
    render(<DraftScreen initialGameState={gameState()} />);

    expect(screen.getByRole("heading", { name: "Peak Draft" })).toBeVisible();
    expect(screen.getByText("1Y Apex")).toBeVisible();
    expect(screen.getByText("Round 1/5")).toBeVisible();
    expect(screen.getAllByTestId("offer-card")).toHaveLength(3);
  });

  it("selecting an eligible offer opens role assignment, and Cancel returns to the offers", () => {
    render(<DraftScreen initialGameState={gameState()} />);

    const offers = screen.getAllByTestId("offer-card");
    fireEvent.click(offers[0]);

    expect(screen.getByText(/assign role/i)).toBeVisible();
    expect(screen.getAllByTestId("role-btn").length).toBeGreaterThan(0);
    expect(screen.getByTestId("lock-in")).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByText(/assign role/i)).not.toBeInTheDocument();
    expect(screen.getAllByTestId("offer-card")).toHaveLength(3);
  });

  it("picking an eligible role and locking in submits the action and advances the round", async () => {
    const next = gameState({
      current_round: 2,
      selected_cards: [{ round: 1, role: "lead_creator", card: card() }],
      open_roles: ["guard_wing", "wing_forward", "forward_big", "anchor"],
    });
    vi.mocked(draftApi.submitDraftAction).mockResolvedValue(next);

    render(<DraftScreen initialGameState={gameState()} />);
    fireEvent.click(screen.getAllByTestId("offer-card")[0]);

    const eligibleRoleBtn = screen
      .getAllByTestId("role-btn")
      .find((b) => !b.hasAttribute("disabled"))!;
    fireEvent.click(eligibleRoleBtn);
    fireEvent.click(screen.getByTestId("lock-in"));

    await waitFor(() => expect(draftApi.submitDraftAction).toHaveBeenCalledWith(
      "game-1",
      "select_card",
      expect.objectContaining({ card_id: "player-a-1yr-199091" }),
    ));
    await waitFor(() => expect(screen.getByText("Round 2/5")).toBeVisible());
  });

  it("a failed submission surfaces the server's message as an alert, not a crash", async () => {
    vi.mocked(draftApi.submitDraftAction).mockRejectedValue(
      new draftApi.DraftAPIError(409, "That card is no longer available."),
    );

    render(<DraftScreen initialGameState={gameState()} />);
    fireEvent.click(screen.getAllByTestId("offer-card")[0]);
    const eligibleRoleBtn = screen
      .getAllByTestId("role-btn")
      .find((b) => !b.hasAttribute("disabled"))!;
    fireEvent.click(eligibleRoleBtn);
    fireEvent.click(screen.getByTestId("lock-in"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "That card is no longer available.",
      ),
    );
    // Offers are still on screen — a failed submit does not strand the player.
    expect(screen.getAllByTestId("offer-card")).toHaveLength(3);
  });

  it("Hold with no card selected opens the hold prompt rather than submitting immediately", () => {
    render(<DraftScreen initialGameState={gameState()} />);
    fireEvent.click(screen.getByRole("button", { name: /^hold/i }));
    expect(screen.getByText(/select a card from the offers below/i)).toBeVisible();
    expect(draftApi.submitDraftAction).not.toHaveBeenCalled();
  });

  it("renders the receipt, lineup and decision replay once the draft is complete", () => {
    const done = gameState({
      status: "draft_complete",
      current_offers: [],
      selected_cards: [{ round: 1, role: "lead_creator", card: card() }],
      round_history: [
        {
          round: 1,
          reframed: false,
          offers: [card()],
          selected_card_id: card().peak_window_id,
          role: "lead_creator",
        },
      ],
      open_roles: [],
      lineup_evaluation: evaluation(),
    });

    render(<DraftScreen initialGameState={done} />);

    const result = screen.getByTestId("draft-result");
    expect(within(result).getByTestId("peak-receipt")).toBeVisible();
    expect(within(result).getByText("Lineup Peak Rating")).toBeVisible();
    expect(within(result).getByText("Your Lineup")).toBeVisible();
    expect(within(result).getByRole("button", { name: /create challenge link/i })).toBeVisible();
  });
});
