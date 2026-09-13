/**
 * FIND THE PRIME: the career rail on its own, then the room wired to a fake
 * server. Selection never requires a drag, snaps only to legal starts, never
 * spans a gap, stages privately, locks explicitly, survives a reload, and the
 * reveal teaches with PEAK3's own numbers.
 */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { FTP_LEGAL_STARTS, FTP_SEASONS, findThePrimeView, ftpReveal } from "./prime-arena-fixtures";

const getMatch = vi.fn();
const submitCommand = vi.fn();
const createPracticeMatch = vi.fn();

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
  getPersonalRecord: vi.fn(async () => {
    throw new Error("offline");
  }),
}));

import CareerRail, { startForTap } from "@/components/find-the-prime/CareerRail";
import FindThePrimeGame from "@/components/find-the-prime/FindThePrimeGame";

beforeEach(() => {
  getMatch.mockReset();
  submitCommand.mockReset();
  createPracticeMatch.mockReset();
});

describe("career rail", () => {
  it("maps a tap to the window that starts there, or the latest legal window containing it", () => {
    expect(startForTap(2005, FTP_LEGAL_STARTS, 2)).toBe(2005);
    // 2006 starts no legal 2Y window (2007 is a gap) but 2005's window contains it.
    expect(startForTap(2006, FTP_LEGAL_STARTS, 2)).toBe(2005);
    expect(startForTap(2010, FTP_LEGAL_STARTS, 2)).toBe(2009);
    expect(startForTap(2003, FTP_LEGAL_STARTS, 2)).toBeNull();
  });

  it("draws gaps as breaks, never as selectable seasons", () => {
    const onSelect = vi.fn();
    render(<CareerRail seasons={FTP_SEASONS} legalStarts={FTP_LEGAL_STARTS} duration={2} selectedStart={null} locked={false} onSelect={onSelect} />);
    expect(screen.getByLabelText("Seasons with no PEAK3 rating")).toBeInTheDocument();
    expect(screen.queryByTestId("fprime-season-2007")).toBeNull();
    fireEvent.click(screen.getByTestId("fprime-season-2006"));
    expect(onSelect).toHaveBeenCalledWith(2005);
  });

  it("moves between legal starts with arrow keys and the step buttons", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <CareerRail seasons={FTP_SEASONS} legalStarts={FTP_LEGAL_STARTS} duration={2} selectedStart={2005} locked={false} onSelect={onSelect} />,
    );
    const rail = screen.getByRole("slider");
    expect(rail).toHaveAttribute("aria-valuetext", "2004-05 to 2005-06");
    fireEvent.keyDown(rail, { key: "ArrowRight" });
    expect(onSelect).toHaveBeenLastCalledWith(2008); // skips the gap-spanning start
    fireEvent.keyDown(rail, { key: "Home" });
    expect(onSelect).toHaveBeenLastCalledWith(2004);
    fireEvent.click(screen.getByTestId("fprime-later"));
    expect(onSelect).toHaveBeenLastCalledWith(2008);
    rerender(<CareerRail seasons={FTP_SEASONS} legalStarts={FTP_LEGAL_STARTS} duration={2} selectedStart={2004} locked={false} onSelect={onSelect} />);
    expect(screen.getByTestId("fprime-earlier")).toBeDisabled();
    expect(screen.getByTestId("fprime-season-2004")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("fprime-season-2005")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("fprime-season-2006")).toHaveAttribute("aria-pressed", "false");
  });

  it("is inert once locked", () => {
    const onSelect = vi.fn();
    render(<CareerRail seasons={FTP_SEASONS} legalStarts={FTP_LEGAL_STARTS} duration={2} selectedStart={2008} locked onSelect={onSelect} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowLeft" });
    fireEvent.click(screen.getByTestId("fprime-season-2004"));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("FIND THE PRIME room", () => {
  it("shows the player, the length and the rail, with no score or ridge before the reveal", async () => {
    getMatch.mockResolvedValue(findThePrimeView());
    render(<FindThePrimeGame matchId="find_the_prime-match" />);
    expect(await screen.findByTestId("fprime-player-name")).toHaveTextContent("Steve Nash");
    expect(screen.getByTestId("fprime-length")).toHaveTextContent("2-year window");
    expect(screen.getByTestId("fprime-rail")).toBeInTheDocument();
    expect(screen.queryByTestId("fprime-ridge")).toBeNull();
    expect(screen.getByTestId("fprime-lock")).toBeDisabled();
  });

  it("stages a tapped window privately after a short pause and locks it on request", async () => {
    getMatch.mockResolvedValue(findThePrimeView());
    submitCommand.mockImplementation(async (_id: string, command: string) => ({
      accepted: true,
      replayed: false,
      rejection_code: null,
      message: null,
      match: findThePrimeView({
        state_version: command === "ftp_lock" ? 7 : 6,
        legal_commands: command === "ftp_lock" ? ["ftp_forfeit"] : ["ftp_stage", "ftp_lock", "ftp_forfeit"],
        private_state: command === "ftp_lock" ? { staged_start: 2008, locked_start: 2008 } : { staged_start: 2008 },
      }),
    }));
    render(<FindThePrimeGame matchId="find_the_prime-match" />);
    fireEvent.click(await screen.findByTestId("fprime-season-2009"));
    expect(screen.getByTestId("fprime-selection")).toHaveTextContent("2008-09 to 2009-10");
    await waitFor(() => expect(submitCommand).toHaveBeenCalledWith("find_the_prime-match", "ftp_stage", { round_index: 0, start_season_end: 2009 }, 5, expect.any(String)), { timeout: 1500 });

    fireEvent.click(screen.getByTestId("fprime-lock"));
    await waitFor(() => expect(submitCommand.mock.calls.some((call) => call[1] === "ftp_lock")).toBe(true));
    const lock = submitCommand.mock.calls.find((call) => call[1] === "ftp_lock")!;
    expect(lock[2]).toEqual({ round_index: 0, start_season_end: 2009 });
  });

  it("restores a staged window after a reload", async () => {
    getMatch.mockResolvedValue(findThePrimeView({ private_state: { staged_start: 2005 } }));
    render(<FindThePrimeGame matchId="find_the_prime-match" />);
    await waitFor(() => expect(screen.getByTestId("fprime-selection")).toHaveTextContent("2004-05 to 2005-06"));
    expect(screen.getByTestId("fprime-lock")).toBeEnabled();
  });

  it("reveals the ridge, PEAK3's best window and every seat's answer", async () => {
    getMatch.mockResolvedValue(
      findThePrimeView({
        turn_phase: "reveal",
        legal_commands: ["ftp_forfeit"],
        public_state: { phase: "reveal", prompt: null, round_results: [ftpReveal()] },
      }),
    );
    render(<FindThePrimeGame matchId="find_the_prime-match" />);
    const reveal = await screen.findByTestId("fprime-reveal");
    expect(within(reveal).getByTestId("fprime-ridge")).toBeInTheDocument();
    expect(within(reveal).getByTestId("fprime-round-receipt")).toHaveTextContent("2004-05 to 2005-06");
    expect(within(reveal).getByTestId("fprime-your-answer")).toHaveTextContent("1.50 behind PEAK3's best");
    expect(within(reveal).getByTestId("fprime-round-points")).toHaveTextContent("93 pts");
    expect(within(reveal).getByTestId("fprime-round-table")).toHaveTextContent("No window placed — 0 points");
  });

  it("finishes with a total out of 900 and says so when the record cannot load", async () => {
    getMatch.mockResolvedValue(
      findThePrimeView({
        status: "completed",
        turn_phase: null,
        turn_seconds_remaining: null,
        legal_commands: [],
        public_state: {
          phase: "complete",
          prompt: null,
          round_results: [ftpReveal()],
          ended_by: "completed",
          standings: [0, 1, 2, 3].map((seat) => ({ seat_index: seat, total: [640, 812, 402, 555][seat], found_primes: seat, total_regret: 10, rounds_scored: 9, rounds_answered: 9, average_regret: 1.11, position: [2, 1, 4, 3][seat], forfeited: false })),
          placements: [
            { seat_index: 0, placement: 2, outcome: "loss" },
            { seat_index: 1, placement: 1, outcome: "win" },
            { seat_index: 2, placement: 4, outcome: "loss" },
            { seat_index: 3, placement: 3, outcome: "loss" },
          ],
        },
      }),
    );
    render(<FindThePrimeGame matchId="find_the_prime-match" />);
    expect(await screen.findByTestId("fprime-total")).toHaveTextContent("640");
    expect(screen.getByTestId("fprime-result")).toHaveTextContent("points of a possible 900");
    await waitFor(() => expect(screen.getByTestId("parena-personal")).toHaveTextContent("could not be loaded"));
    await act(async () => {});
  });
});
