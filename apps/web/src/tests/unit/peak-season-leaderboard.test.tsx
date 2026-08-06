/**
 * The 82-0 PEAK Season board: five states, and they say five different things.
 *
 * THE DEFECT UNDER TEST. The page held the board itself, and its `catch` did
 * this:
 *
 *     .catch(() => { setEnabled(false); })
 *
 * so a request that failed rendered the same sentence as a capability nobody
 * had turned on — "The global leaderboard isn't enabled yet." — with no retry
 * except reloading the page. That is the single most misleading thing a board
 * can say, because it sends a reader to the wrong question entirely: one is
 * "come back later", the other is "your connection dropped, press this".
 *
 * The rest of the board was thin in ways the review named: no date, no seed, no
 * route to the roster behind a row, no pagination past the first page, no way
 * to see where you stand, and nothing marking the entry at the top.
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PeakSeasonLeaderboard from "@/components/court/PeakSeasonLeaderboard";
import type {
  LeaderboardResponse,
  PerfectSeasonRunPublic,
  PersonalPlacementResponse,
} from "@/types/perfect-season";

function run(overrides: Partial<PerfectSeasonRunPublic> = {}): PerfectSeasonRunPublic {
  return {
    id: "run-1",
    display_name: "peakfan",
    mode: "apex_1y",
    game_type: "peak_season",
    game_id: "game-1",
    seed: 431465972,
    wins: 81,
    losses: 1,
    lineup_score: 77.3,
    score_status: "complete",
    exact_cards_scored: 8,
    total_cards: 8,
    team_respins_used: 2,
    season_respins_used: 2,
    data_version: "courtbuilder_team_year.experimental.v3",
    formula_version: null,
    simulation_version: "perfect_season_simulator_v1",
    created_at: "2026-08-04T05:10:16.000Z",
    ...overrides,
  };
}

function board(
  runs: PerfectSeasonRunPublic[],
  overrides: Partial<LeaderboardResponse> = {},
): LeaderboardResponse {
  return { leaderboard_enabled: true, runs, next_cursor: null, ...overrides };
}

function renderBoard(options: {
  fetchBoard?: ReturnType<typeof vi.fn>;
  fetchPlacement?: ReturnType<typeof vi.fn>;
  token?: string | null;
} = {}) {
  const fetchBoard = options.fetchBoard ?? vi.fn(async () => board([run()]));
  const fetchPlacement =
    options.fetchPlacement ??
    vi.fn(async (): Promise<PersonalPlacementResponse> => ({ leaderboard_enabled: true }));
  const readToken = vi.fn(async () => options.token ?? null);
  render(
    <PeakSeasonLeaderboard
      fetchBoard={fetchBoard as never}
      fetchPlacement={fetchPlacement as never}
      readToken={readToken as never}
    />,
  );
  return { fetchBoard, fetchPlacement, readToken };
}

describe("the four states are four different things", () => {
  it("shows a loading state before the first response", async () => {
    let resolve: (value: LeaderboardResponse) => void = () => {};
    const fetchBoard = vi.fn(
      () => new Promise<LeaderboardResponse>((r) => (resolve = r)),
    );
    renderBoard({ fetchBoard });
    expect(screen.getByTestId("ps-board-loading")).toBeInTheDocument();
    resolve(board([run()]));
    await screen.findByTestId("leaderboard-table");
  });

  it("says the board is not open when the SERVER says so", async () => {
    const fetchBoard = vi.fn(async () => board([], { leaderboard_enabled: false }));
    renderBoard({ fetchBoard });
    const panel = await screen.findByTestId("ps-board-disabled");
    expect(panel).toHaveTextContent(/isn't open yet/i);
    // And it tells the reader their runs are not lost, which is the actual
    // consequence: saving is not behind this flag.
    expect(panel).toHaveTextContent(/saved to your own history/i);
    expect(screen.queryByTestId("ps-board-failed")).toBeNull();
  });

  it("says a FAILED request is a connection problem, not a closed feature", async () => {
    // THE HEADLINE REGRESSION. These two used to be one state.
    const fetchBoard = vi.fn(async () => {
      throw new Error("network");
    });
    renderBoard({ fetchBoard });
    const panel = await screen.findByTestId("ps-board-failed");
    expect(panel).toHaveTextContent(/could not be loaded/i);
    expect(panel).toHaveTextContent(/not a closed feature/i);
    expect(screen.queryByTestId("ps-board-disabled")).toBeNull();
  });

  it("retries for real, rather than telling a reader to reload", async () => {
    const fetchBoard = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(board([run()]));
    renderBoard({ fetchBoard: fetchBoard as never });
    await screen.findByTestId("ps-board-failed");
    await userEvent.click(screen.getByTestId("ps-board-retry"));
    await screen.findByTestId("leaderboard-table");
  });

  it("distinguishes an empty board from a disabled one", async () => {
    const fetchBoard = vi.fn(async () => board([]));
    renderBoard({ fetchBoard });
    const panel = await screen.findByTestId("ps-board-empty");
    expect(panel).toHaveTextContent(/first completed/i);
    expect(screen.getByTestId("ps-board-play")).toHaveAttribute(
      "href",
      "/arena/court/daily",
    );
  });
});

describe("a populated board is a finished product", () => {
  const ROWS = [
    run({ id: "a", game_id: "g-a", display_name: "alpha", wins: 82, losses: 0, lineup_score: 91.4 }),
    run({ id: "b", game_id: "g-b", display_name: "peakfan", wins: 81, losses: 1, lineup_score: 77.3 }),
    run({ id: "c", game_id: "g-c", display_name: "gamma", wins: 79, losses: 3, lineup_score: 74.1, team_respins_used: 0, season_respins_used: 0 }),
  ];

  it("carries rank, name, record, score, date, seed and a receipt per row", async () => {
    renderBoard({ fetchBoard: vi.fn(async () => board(ROWS)) });
    const rows = await screen.findAllByTestId("leaderboard-row");
    expect(rows).toHaveLength(3);

    const second = rows[1];
    expect(second).toHaveTextContent("peakfan");
    expect(second).toHaveTextContent("81–1");
    expect(second).toHaveTextContent("77.3");
    expect(second).toHaveTextContent("431465972");
    expect(within(second).getByRole("link")).toHaveAttribute(
      "href",
      "/arena/court/results/g-b",
    );
    // The date is rendered, not omitted — locale formatting varies, so the
    // assertion is that the cell is not the dash the formatter falls back to.
    expect(second.textContent).not.toContain("—");
  });

  it("identifies the number-one entry unmistakably", async () => {
    renderBoard({ fetchBoard: vi.fn(async () => board(ROWS)) });
    const rows = await screen.findAllByTestId("leaderboard-row");
    expect(rows[0]).toHaveAttribute("data-leader", "true");
    expect(rows[1]).toHaveAttribute("data-leader", "false");
    expect(within(rows[0]).getByTestId("ps-board-leader")).toHaveTextContent("1");
  });

  it("numbers rows by their position in the server's order, never re-sorting", async () => {
    // The server's tie-break (wins, then score, then fewer respins, then
    // earliest) is not reproducible here and must not be attempted: the rank a
    // reader sees is the position in the sequence the API returned.
    renderBoard({ fetchBoard: vi.fn(async () => board([...ROWS].reverse())) });
    const rows = await screen.findAllByTestId("leaderboard-row");
    expect(rows.map((r) => r.getAttribute("data-rank"))).toEqual(["1", "2", "3"]);
    expect(rows[0]).toHaveTextContent("gamma");
  });

  it("keeps respin counts as metadata rather than hiding a run", async () => {
    renderBoard({ fetchBoard: vi.fn(async () => board(ROWS)) });
    const rows = await screen.findAllByTestId("leaderboard-row");
    expect(rows[1]).toHaveTextContent(/4 respins/i);
    expect(rows[2].textContent).not.toMatch(/respins/i);
  });

  it("gives the table real column headers", async () => {
    renderBoard({ fetchBoard: vi.fn(async () => board(ROWS)) });
    await screen.findByTestId("leaderboard-table");
    for (const name of [/^#$/, /player/i, /record/i, /lineup score/i, /submitted/i, /seed/i]) {
      expect(screen.getByRole("columnheader", { name })).toBeInTheDocument();
    }
  });
});

describe("pagination", () => {
  it("loads the next page with the server's cursor and appends it", async () => {
    const first = board([run({ id: "a", game_id: "g-a" })], { next_cursor: "cursor-1" });
    const second = board([run({ id: "b", game_id: "g-b", display_name: "beta" })]);
    const fetchBoard = vi.fn(async (params: { cursor?: string }) =>
      params.cursor === "cursor-1" ? second : first,
    );
    renderBoard({ fetchBoard: fetchBoard as never });
    await screen.findByTestId("leaderboard-table");

    await userEvent.click(screen.getByTestId("ps-board-more"));
    await waitFor(() => expect(screen.getAllByTestId("leaderboard-row")).toHaveLength(2));
    expect(fetchBoard).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "cursor-1" }),
    );
    // Ranks continue across the page break rather than restarting.
    expect(
      screen.getAllByTestId("leaderboard-row").map((r) => r.getAttribute("data-rank")),
    ).toEqual(["1", "2"]);
  });

  it("offers no More control when the server publishes no cursor", async () => {
    renderBoard({ fetchBoard: vi.fn(async () => board([run()])) });
    await screen.findByTestId("leaderboard-table");
    expect(screen.queryByTestId("ps-board-more")).toBeNull();
  });
});

describe("your best", () => {
  it("shows the caller's own placement, read from the server not from the page", async () => {
    // THE CASE IT EXISTS FOR: a reader's entry is nowhere near page one.
    const fetchPlacement = vi.fn(async (): Promise<PersonalPlacementResponse> => ({
      leaderboard_enabled: true,
      rank: 412,
      run: run({ id: "mine", game_id: "g-mine", display_name: "peakfan" }),
    }));
    renderBoard({
      fetchBoard: vi.fn(async () => board([run({ id: "other", display_name: "alpha" })])),
      fetchPlacement,
      token: "a-token",
    });
    const panel = await screen.findByTestId("ps-board-your-best");
    expect(panel).toHaveTextContent("#412");
    expect(panel).toHaveTextContent("peakfan");
    expect(panel).toHaveTextContent("81–1");
  });

  it("marks your row inline when it IS on the page", async () => {
    const mine = run({ id: "mine", game_id: "g-mine", display_name: "peakfan" });
    renderBoard({
      fetchBoard: vi.fn(async () => board([run({ id: "other", display_name: "alpha" }), mine])),
      fetchPlacement: vi.fn(async () => ({ leaderboard_enabled: true, rank: 2, run: mine })),
      token: "a-token",
    });
    await screen.findByTestId("ps-board-you-inline");
    const rows = screen.getAllByTestId("leaderboard-row");
    expect(rows[1]).toHaveAttribute("data-you", "true");
    expect(rows[0]).toHaveAttribute("data-you", "false");
  });

  it("asks for no placement at all when nobody is signed in", async () => {
    const fetchPlacement = vi.fn();
    renderBoard({ fetchPlacement: fetchPlacement as never, token: null });
    await screen.findByTestId("leaderboard-table");
    expect(fetchPlacement).not.toHaveBeenCalled();
    expect(screen.queryByTestId("ps-board-your-best")).toBeNull();
  });

  it("never costs a reader the board when the placement lookup fails", async () => {
    renderBoard({
      fetchPlacement: vi.fn(async () => {
        throw new Error("boom");
      }) as never,
      token: "a-token",
    });
    await screen.findByTestId("leaderboard-table");
    expect(screen.queryByTestId("ps-board-your-best")).toBeNull();
  });
});

describe("the mode and window controls", () => {
  it("refetches for a different mode", async () => {
    const { fetchBoard } = renderBoard();
    await screen.findByTestId("leaderboard-table");
    await userEvent.click(screen.getByTestId("ps-board-mode-prime_3y"));
    await waitFor(() =>
      expect(fetchBoard).toHaveBeenLastCalledWith(
        expect.objectContaining({ mode: "prime_3y" }),
      ),
    );
  });

  it("asks the server for the daily window rather than filtering client-side", async () => {
    // "Submitted today" is the SAME query with `created_at >= today`, applied
    // by the API against the one official day boundary. A client-side filter
    // over the current page would silently mean "today, among the twenty-five
    // rows I happen to be holding".
    const { fetchBoard } = renderBoard();
    await screen.findByTestId("leaderboard-table");
    await userEvent.click(screen.getByTestId("ps-board-window-today"));
    await waitFor(() =>
      expect(fetchBoard).toHaveBeenLastCalledWith(expect.objectContaining({ daily: true })),
    );
  });

  it("says nothing was submitted today rather than showing the all-time board", async () => {
    const fetchBoard = vi.fn(async (params: { daily?: boolean }) =>
      params.daily ? board([]) : board([run()]),
    );
    renderBoard({ fetchBoard: fetchBoard as never });
    await screen.findByTestId("leaderboard-table");
    await userEvent.click(screen.getByTestId("ps-board-window-today"));
    const empty = await screen.findByTestId("ps-board-empty");
    expect(empty).toHaveTextContent(/nothing submitted today/i);
  });
});
