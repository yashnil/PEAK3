/**
 * Gameplay-polish: the per-run Easy/Hard difficulty selector on the pre-game
 * gate (PeakSeasonStartGate).
 *
 * WHAT THIS PROTECTS. The difficulty is chosen exactly once, before a run
 * exists, and the server freezes it onto the run for good
 * (CourtLineupState.difficulty) -- there is no later "change difficulty"
 * control anywhere in the game itself. That makes the gate's selector the
 * ONLY place this choice can go wrong: if the wrong value (or none at all)
 * reaches `createCourtGame`, the whole feature silently defaults to Easy for
 * every player who thought they picked Hard.
 */
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const createCourtGame = vi.fn();
const getCourtGame = vi.fn();

vi.mock("@/lib/perfect-season-api", () => ({
  createCourtGame: (...args: unknown[]) => createCourtGame(...args),
  getCourtGame: (...args: unknown[]) => getCourtGame(...args),
  PerfectSeasonAPIError: class PerfectSeasonAPIError extends Error {
    status: number;
    code?: string;
    constructor(status: number, detail: string, code?: string) {
      super(detail);
      this.status = status;
      this.code = code;
    }
  },
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ loading: false }),
}));

// CourtBuilder itself is heavy (spin ceremony, court layout, etc.) and is
// exercised by its own tests -- stub it here so this file stays scoped to
// the GATE's own responsibility: collecting the difficulty choice and
// passing it to `createCourtGame`.
vi.mock("@/components/court/CourtBuilder", () => ({
  default: () => <div data-testid="court-builder-stub" />,
}));

import PeakSeasonStartGate from "@/components/court/PeakSeasonStartGate";

function renderGate() {
  return render(
    <PeakSeasonStartGate
      mode="apex_1y"
      challengeKind="free_play"
      franchiseNames={["Test City Testers"]}
    />,
  );
}

beforeEach(() => {
  createCourtGame.mockReset();
  getCourtGame.mockReset();
  createCourtGame.mockResolvedValue({ game_id: "g-1", difficulty: "easy" });
});

describe("PeakSeasonStartGate difficulty selector", () => {
  it("renders both options with Easy selected by default", () => {
    renderGate();
    const easyBtn = screen.getByTestId("difficulty-easy-btn");
    const hardBtn = screen.getByTestId("difficulty-hard-btn");
    expect(easyBtn).toHaveAttribute("aria-pressed", "true");
    expect(hardBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("states Hard's tradeoff up front, before the run starts", () => {
    renderGate();
    // The exact tradeoff the product spec requires to be stated up front:
    // 1 team respin + 1 season respin for the whole run, no hint.
    expect(screen.getByTestId("difficulty-hard-btn")).toHaveTextContent(
      /only 1 team \+ 1 season respin for the run, no hint/i,
    );
  });

  it("passes difficulty: 'easy' to createCourtGame when Easy (the default) is begun", async () => {
    const user = userEvent.setup();
    renderGate();
    await user.click(screen.getByTestId("begin-run-btn"));
    await waitFor(() => expect(createCourtGame).toHaveBeenCalledTimes(1));
    const [, , options] = createCourtGame.mock.calls[0];
    expect(options).toMatchObject({ difficulty: "easy" });
  });

  it("switches the selection and passes difficulty: 'hard' through to createCourtGame", async () => {
    const user = userEvent.setup();
    renderGate();

    await user.click(screen.getByTestId("difficulty-hard-btn"));
    expect(screen.getByTestId("difficulty-hard-btn")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("difficulty-easy-btn")).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByTestId("begin-run-btn"));
    await waitFor(() => expect(createCourtGame).toHaveBeenCalledTimes(1));
    const [, , options] = createCourtGame.mock.calls[0];
    expect(options).toMatchObject({ difficulty: "hard" });
  });

  it("renders the started run once createCourtGame resolves", async () => {
    const user = userEvent.setup();
    renderGate();
    await user.click(screen.getByTestId("begin-run-btn"));
    await waitFor(() => expect(screen.getByTestId("court-builder-stub")).toBeInTheDocument());
  });
});
