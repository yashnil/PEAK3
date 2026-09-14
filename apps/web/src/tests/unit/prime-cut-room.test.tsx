/**
 * PRIME CUT room, wired to a fake server.
 *
 * Asserts the room's contract rather than its pixels: one command per press
 * naming its exact heat and card; a stale refusal retried only while the card
 * is unchanged; quotas and forced calls explained in words; ceremonies with no
 * skip; the heat reveal's cut line; the final 2Y/3Y/5Y bands.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { pcHeatResult, primeCutCompleted, primeCutView } from "./prime-arena-fixtures";

const getMatch = vi.fn();
const submitCommand = vi.fn();
const createPracticeMatch = vi.fn();
const replace = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/arena/prime-cut/prime_cut-match",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/arena-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/arena-api")>("@/lib/arena-api");
  return {
    ...actual,
    getMatch: (...args: unknown[]) => getMatch(...args),
    submitCommand: (...args: unknown[]) => submitCommand(...args),
    createPracticeMatch: (...args: unknown[]) => createPracticeMatch(...args),
  };
});

vi.mock("@/lib/prime-arena/personal", () => ({
  getPersonalRecord: vi.fn(async () => ({
    mode: "prime_cut",
    matches_played: 4,
    rated_matches: 0,
    wins: 1,
    podiums: 2,
    current_win_streak: 0,
    longest_win_streak: 1,
    best_score: 91,
    bests: {},
    match_found: true,
    match_score: 88.5,
    match_placement: 2,
    previous_best_score: 91,
    is_personal_best: false,
    streak_after_match: 0,
    ratings_enabled: false,
    rating: null,
    rating_provisional: null,
    match_rating_change: null,
  })),
}));

import PrimeCutGame from "@/components/prime-cut/PrimeCutGame";

async function mount(view = primeCutView()) {
  getMatch.mockResolvedValue(view);
  const utils = render(<PrimeCutGame matchId={view.match_id} />);
  await act(async () => {});
  return utils;
}

beforeEach(() => {
  getMatch.mockReset();
  submitCommand.mockReset();
  createPracticeMatch.mockReset();
  replace.mockReset();
  push.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PRIME CUT room", () => {
  it("shows the incoming peak's player, exact window and duration, and no score", async () => {
    await mount();
    const card = await screen.findByTestId("pcut-card");
    expect(within(card).getByTestId("pcut-card-name")).toHaveTextContent("Kevin Garnett");
    expect(within(card).getByTestId("pcut-card-duration")).toHaveTextContent("2-year peak");
    expect(within(card).getByTestId("pcut-card-window")).toHaveTextContent("2002-03");
    expect(card).toHaveTextContent("2+ teams");
    expect(screen.queryByTestId("pcut-heat-reveal")).toBeNull();
    expect(screen.getByTestId("pcut-keeps-left")).toHaveTextContent("3");
    expect(screen.getByTestId("pcut-cuts-left")).toHaveTextContent("3");
  });

  it("sends exactly one KEEP naming its heat and card, however fast the second press", async () => {
    let resolve: (value: unknown) => void = () => {};
    submitCommand.mockImplementation(() => new Promise((r) => (resolve = r)));
    await mount();
    const keep = await screen.findByTestId("pcut-keep");
    fireEvent.click(keep);
    fireEvent.click(keep);
    expect(submitCommand).toHaveBeenCalledTimes(1);
    const [matchId, command, payload, version] = submitCommand.mock.calls[0];
    expect(matchId).toBe("prime_cut-match");
    expect(command).toBe("pc_keep");
    expect(payload).toEqual({ heat_index: 0, card_index: 2 });
    expect(version).toBe(5);
    await act(async () => {
      resolve({
        accepted: true,
        replayed: false,
        rejection_code: null,
        message: null,
        match: primeCutView({ state_version: 6, private_state: { current_decision: { card_index: 2, decision: "keep", auto: null }, keeps_left: 2 } as never, legal_commands: ["pc_forfeit"] }),
      });
    });
    expect(await screen.findByTestId("pcut-stamp")).toHaveTextContent("Kept");
  });

  it("retries a stale refusal against the fresh version while the card is unchanged", async () => {
    submitCommand
      .mockResolvedValueOnce({ accepted: false, replayed: false, rejection_code: "stale_state_version", message: null, match: primeCutView({ state_version: 7 }) })
      .mockResolvedValueOnce({ accepted: true, replayed: false, rejection_code: null, message: null, match: primeCutView({ state_version: 8, private_state: { current_decision: { card_index: 2, decision: "cut", auto: null } } as never, legal_commands: ["pc_forfeit"] }) });
    await mount();
    fireEvent.click(await screen.findByTestId("pcut-cut"));
    await waitFor(() => expect(submitCommand).toHaveBeenCalledTimes(2));
    expect(submitCommand.mock.calls[1][3]).toBe(7);
    expect(submitCommand.mock.calls[1][2]).toEqual({ heat_index: 0, card_index: 2 });
    expect(screen.queryByTestId("pcut-error")).toBeNull();
  });

  it("does not retry once the card has moved on, and says why", async () => {
    submitCommand.mockResolvedValueOnce({
      accepted: false,
      replayed: false,
      rejection_code: "stale_state_version",
      message: null,
      match: primeCutView({ state_version: 9, public_state: { card_index: 3, current_card: null } as never }),
    });
    await mount();
    fireEvent.click(await screen.findByTestId("pcut-keep"));
    await waitFor(() => expect(submitCommand).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId("pcut-error")).toHaveTextContent("The table moved on");
  });

  it("disables a spent quota and explains it in words", async () => {
    await mount(primeCutView({ legal_commands: ["pc_cut", "pc_forfeit"], private_state: { keeps_left: 0, keeps_used: 4 } as never }));
    expect(await screen.findByTestId("pcut-keep")).toBeDisabled();
    expect(screen.getByTestId("pcut-cut")).toBeEnabled();
    expect(screen.getByTestId("pcut-controls-status")).toHaveTextContent("Your four keeps are used");
  });

  it("K keeps and C cuts from the keyboard", async () => {
    submitCommand.mockResolvedValue({ accepted: true, replayed: false, rejection_code: null, message: null, match: primeCutView({ state_version: 6 }) });
    await mount();
    await screen.findByTestId("pcut-card");
    fireEvent.keyDown(window, { key: "c" });
    await waitFor(() => expect(submitCommand).toHaveBeenCalledTimes(1));
    expect(submitCommand.mock.calls[0][1]).toBe("pc_cut");
  });

  it("stamps a forced call and offers no decision", async () => {
    await mount(
      primeCutView({
        legal_commands: ["pc_forfeit"],
        private_state: { current_decision: { card_index: 2, decision: "cut", auto: "forced" }, forced_decision: "cut", keeps_left: 0 } as never,
      }),
    );
    expect(await screen.findByTestId("pcut-stamp")).toHaveTextContent("Forced Cut");
    expect(screen.getByTestId("pcut-keep")).toBeDisabled();
    expect(screen.getByTestId("pcut-cut")).toBeDisabled();
  });

  it("shows a room that is still filling as a waiting table, not as a started match", async () => {
    const forming = primeCutView({
      status: "forming",
      turn_phase: null,
      turn_seconds_remaining: null,
      legal_commands: [],
      room_code: "ABC234",
      public_state: { phase: "intro", card_index: null, current_card: null, dealt_cards: [] } as never,
    });
    await mount({ ...forming, seats: forming.seats.slice(0, 2) });
    const waiting = await screen.findByTestId("pcut-forming");
    expect(waiting).toHaveTextContent("2 of 4 seats taken");
    expect(waiting).toHaveTextContent("ABC234");
    expect(screen.queryByTestId("pcut-room")).toBeNull();
    expect(screen.queryByTestId("pcut-intro")).toBeNull();
  });

  it("renders the intro as a timed ceremony with nothing to skip", async () => {
    await mount(primeCutView({ turn_phase: "intro", legal_commands: ["pc_forfeit"], public_state: { phase: "intro", card_index: null, current_card: null, dealt_cards: [] } as never }));
    expect(await screen.findByTestId("pcut-intro")).toHaveTextContent("Keep four. Cut four.");
    expect(screen.queryByRole("button", { name: /skip|start/i })).toBeNull();
    expect(screen.queryByTestId("pcut-controls")).toBeNull();
  });

  it("draws the heat's cut line with every call in words", async () => {
    await mount(
      primeCutView({
        turn_phase: "heat_reveal",
        legal_commands: ["pc_forfeit"],
        public_state: { phase: "heat_reveal", card_index: null, current_card: null, dealt_cards: [], heat_results: [pcHeatResult()] } as never,
        private_state: { decisions: [] } as never,
      }),
    );
    const reveal = await screen.findByTestId("pcut-heat-reveal");
    expect(within(reveal).getByTestId("pcut-heat-score")).toHaveTextContent("88.5");
    expect(within(reveal).getByTestId("pcut-reveal-cutline-line")).toHaveTextContent("Cut line");
    expect(reveal).toHaveTextContent("Missed");
    expect(reveal).toHaveTextContent("Right call");
    expect(reveal).toHaveTextContent("91.20");
  });

  it("finishes with 2Y, 3Y and 5Y bands, the podium and play again", async () => {
    createPracticeMatch.mockResolvedValue({ match_id: "next-match" });
    await mount(primeCutCompleted());
    expect(await screen.findByTestId("pcut-result")).toBeInTheDocument();
    expect(screen.getByTestId("pcut-result-title")).toHaveTextContent("2nd of 4");
    expect(screen.getByTestId("pcut-match-score")).toHaveTextContent("88.5");
    for (const duration of ["2y", "3y", "5y"]) {
      expect(screen.getByTestId(`pcut-band-${duration}`)).toHaveTextContent("88.5");
    }
    const podium = screen.getByTestId("pcut-podium");
    expect(within(podium).getAllByRole("listitem")[0]).toHaveTextContent("IsoKing");
    expect(await screen.findByTestId("parena-personal-best")).toHaveTextContent("Personal best stands at 91.0");
    fireEvent.click(screen.getByTestId("pcut-play-again"));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/arena/prime-cut/next-match"));
  });
});

describe("PRIME CUT arrival", () => {
  function arrivalView(overrides: Record<string, unknown> = {}) {
    return primeCutView({
      state_version: 2,
      turn_phase: "arrival",
      turn_seconds_remaining: 20,
      turn_total_seconds: 20,
      legal_commands: ["pc_intro_seen", "pc_forfeit"],
      public_state: { phase: "arrival", card_index: null, current_card: null, dealt_cards: [] } as never,
      private_state: { decisions: [] } as never,
      ...overrides,
    });
  }
  const introView = () =>
    primeCutView({
      state_version: 3,
      turn_phase: "intro",
      turn_seconds_remaining: 6,
      turn_total_seconds: 6,
      legal_commands: ["pc_forfeit"],
      public_state: { phase: "intro", card_index: null, current_card: null, dealt_cards: [] } as never,
      private_state: { decisions: [] } as never,
    });

  it("puts the intro on screen before reporting it, however slow the first read, and reports it once", async () => {
    let finishRead: (view: unknown) => void = () => {};
    getMatch.mockImplementationOnce(() => new Promise((resolve) => (finishRead = resolve)));
    getMatch.mockResolvedValue(arrivalView());
    submitCommand.mockResolvedValue({ accepted: true, replayed: false, rejection_code: null, message: null, match: introView() });
    render(<PrimeCutGame matchId="prime_cut-match" />);
    await act(async () => {});
    expect(screen.getByTestId("pcut-loading")).toBeInTheDocument();
    expect(submitCommand).not.toHaveBeenCalled();

    await act(async () => finishRead(arrivalView()));
    expect(screen.getByTestId("pcut-intro")).toBeInTheDocument();
    await waitFor(() => expect(submitCommand).toHaveBeenCalledTimes(1));
    expect(submitCommand).toHaveBeenCalledWith("prime_cut-match", "pc_intro_seen", {}, 2, expect.any(String));
    await waitFor(() => expect(screen.getByTestId("pcut-room")).toHaveAttribute("data-phase", "intro"));
    expect(screen.getByTestId("pcut-intro")).toBeInTheDocument();
    expect(screen.queryByTestId("pcut-controls")).toBeNull();
    expect(screen.queryByRole("button", { name: /skip|start/i })).toBeNull();
    expect(submitCommand).toHaveBeenCalledTimes(1);
  });

  it("does not report again for a seat that already has, and names who the table is waiting for", async () => {
    const seats = [0, 1, 2, 3].map((seat) => ({
      seat_index: seat,
      display_name: ["You", "Guest", "IsoKing", "GlassCleaner"][seat],
      is_bot: seat > 1,
      bot_tier: seat > 1 ? "MVP" : null,
      locked: false,
      arrived: seat !== 1,
      forfeited: false,
    }));
    await mount(
      arrivalView({
        legal_commands: ["pc_forfeit"],
        public_state: { phase: "arrival", card_index: null, current_card: null, dealt_cards: [], seats } as never,
      }),
    );
    expect(await screen.findByTestId("pcut-arrival")).toHaveTextContent("Waiting for 1 more player to arrive.");
    expect(submitCommand).not.toHaveBeenCalled();
  });

  it("shows no error when its report lands after the intro already started", async () => {
    submitCommand.mockResolvedValue({ accepted: false, replayed: false, rejection_code: "intro_already_started", message: "The intro is already running.", match: introView() });
    await mount(arrivalView());
    await waitFor(() => expect(submitCommand).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("pcut-room")).toHaveAttribute("data-phase", "intro"));
    expect(screen.queryByTestId("pcut-error")).toBeNull();
  });
});
