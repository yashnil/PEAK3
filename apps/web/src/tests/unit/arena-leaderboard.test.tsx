/**
 * The Arena multiplayer leaderboard: every state says what is true.
 *
 * Loading, closed, failed (with a working retry), empty, low population,
 * populated, signed-out Around You, and the three Around You answers the server
 * can give — plus the reusable skill badge. Nothing here is computed in the
 * browser; the fake API returns exactly the shapes the server does.
 */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ArenaLeaderboardView from "@/components/arena/leaderboard/ArenaLeaderboardView";
import ArenaSkillBadge, { skillBadgeText } from "@/components/arena/leaderboard/ArenaSkillBadge";
import { populationNote, unlistedNote } from "@/components/arena/leaderboard/leaderboard-copy";
import {
  ArenaStandingsError,
  type ArenaAroundMeResponse,
  type ArenaLeaderboardEntry,
  type ArenaLeaderboardResponse,
  type ArenaPopulation,
  type ArenaSkill,
  type ArenaStandingsApi,
} from "@/lib/arena-leaderboard-api";

let authState: { user: { id: string } | null; loading: boolean };
vi.mock("@/lib/auth-context", () => ({ useAuth: () => authState }));
vi.mock("@/lib/auth", () => ({ getAccessToken: vi.fn().mockResolvedValue(null) }));

const MODE = "three_man_weave";

function population(overrides: Partial<ArenaPopulation> = {}): ArenaPopulation {
  return {
    total_rated_players: 0,
    rated_population: 0,
    established_players: 0,
    percentile_min_population: 30,
    provisional_until: 7,
    ...overrides,
  };
}

function entry(overrides: Partial<ArenaLeaderboardEntry> = {}): ArenaLeaderboardEntry {
  return {
    rank: 1,
    handle: "alpha",
    rating: 1712.4,
    rd: 70,
    rated_matches: 12,
    provisional: false,
    tier: "All-Star",
    wins: 8,
    losses: 4,
    draws: 0,
    matches_with_bots: 2,
    matches_all_human: 10,
    average_placement: 1.6,
    podium_rate: 0.6,
    average_score: 70,
    best_score: 81,
    averages: {},
    bests: {},
    ...overrides,
  };
}

function boardOf(entries: ArenaLeaderboardEntry[], pop: Partial<ArenaPopulation> = {}): ArenaLeaderboardResponse {
  return {
    leaderboard_enabled: true,
    mode: MODE,
    entries,
    limit: 50,
    offset: 0,
    population: population({ total_rated_players: entries.length, rated_population: entries.length, ...pop }),
    total_rated_players: pop.total_rated_players ?? entries.length,
    tier_version: "arena_tier_v1+division_v1_provisional",
    tier_ladder: [],
  };
}

function skill(overrides: Partial<ArenaSkill> = {}): ArenaSkill {
  return {
    rated: true,
    rating: 1642,
    rd: 80,
    rated_matches: 9,
    provisional: false,
    matches_until_established: 0,
    tier: "Starter",
    tier_reason: null,
    tier_capped: false,
    next_tier: "All-Star",
    next_tier_rating: 1650,
    rank: 2,
    rank_reason: null,
    listed: true,
    handle: "me",
    percentile: null,
    percentile_reason: "population_too_small",
    wins: 6,
    losses: 3,
    draws: 0,
    rated_matches_counted: 9,
    matches_with_bots: 4,
    matches_all_human: 5,
    best_rated_score: 77.5,
    population: population({ total_rated_players: 3, rated_population: 3, established_players: 3 }),
    tier_version: null,
    ...overrides,
  };
}

function around(overrides: Partial<ArenaAroundMeResponse> = {}): ArenaAroundMeResponse {
  return {
    leaderboard_enabled: true,
    mode: MODE,
    status: "listed",
    me: skill(),
    above: [entry({ rank: 1, handle: "alpha" })],
    below: [entry({ rank: 3, handle: "charlie", rating: 1500 })],
    population: population({ total_rated_players: 3, rated_population: 3 }),
    total_rated_players: 3,
    tier_version: null,
    ...overrides,
  };
}

function fakeApi(overrides: Partial<ArenaStandingsApi> = {}): ArenaStandingsApi {
  return {
    modes: vi.fn().mockResolvedValue([{ id: MODE, seat_count: 3 }]),
    topPlayers: vi.fn().mockResolvedValue(boardOf([])),
    aroundMe: vi.fn().mockResolvedValue(around()),
    skill: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

beforeEach(() => {
  authState = { user: null, loading: false };
});

describe("ArenaLeaderboardView", () => {
  it("shows a loading state while the board is in flight", () => {
    const api = fakeApi({
      modes: vi.fn(() => new Promise<never>(() => {})),
      topPlayers: vi.fn(() => new Promise<ArenaLeaderboardResponse>(() => {})),
    });
    render(<ArenaLeaderboardView mode={MODE} api={api} />);
    expect(screen.getByTestId("alb-board-loading")).toHaveTextContent("Loading the board");
  });

  it("is honest about an empty board rather than inventing players", async () => {
    render(<ArenaLeaderboardView mode={MODE} api={fakeApi()} />);
    expect(await screen.findByTestId("alb-board-empty")).toHaveTextContent("No rated players yet");
    expect(screen.queryByTestId("alb-top-table")).toBeNull();
  });

  it("says how small a low population is and when percentiles appear", async () => {
    const rows = [entry(), entry({ rank: 2, handle: "bravo" }), entry({ rank: 3, handle: "charlie" })];
    render(<ArenaLeaderboardView mode={MODE} api={fakeApi({ topPlayers: vi.fn().mockResolvedValue(boardOf(rows)) })} />);
    expect(await screen.findByTestId("alb-population-note")).toHaveTextContent(
      "3 rated players so far — percentiles appear at 30.",
    );
    expect(screen.getAllByTestId("alb-top-row")).toHaveLength(3);
  });

  it("renders a populated board with tiers, provisional marks and the bot split", async () => {
    const rows = [
      entry(),
      entry({ rank: 3, handle: "newbie", provisional: true, tier: null, rated_matches: 2, matches_with_bots: 1, matches_all_human: 1 }),
    ];
    const data = boardOf(rows, { total_rated_players: 2, rated_population: 40 });
    render(<ArenaLeaderboardView mode={MODE} api={fakeApi({ topPlayers: vi.fn().mockResolvedValue(data) })} />);

    const table = await screen.findByTestId("alb-top-table");
    const [first, second] = within(table).getAllByTestId("alb-top-row");
    expect(first).toHaveTextContent("alpha");
    expect(first).toHaveTextContent("All-Star");
    expect(first).toHaveTextContent("1,712");
    expect(first).toHaveTextContent("10 vs people · 2 with bots");
    expect(second).toHaveTextContent("Provisional");
    expect(second).toHaveAttribute("data-rank", "3");
    expect(screen.getByTestId("alb-population-note")).toHaveTextContent("40 rated players in this mode.");
    expect(screen.getByTestId("alb-unlisted-note")).toHaveTextContent("38 rated players without a public handle");
    expect(screen.getByTestId("alb-bot-disclosure")).toHaveTextContent("completed with bots");
  });

  it("separates a failed request from a closed board, and retry retries", async () => {
    const topPlayers = vi
      .fn()
      .mockRejectedValueOnce(new ArenaStandingsError(0, "offline", "network_unavailable"))
      .mockResolvedValueOnce(boardOf([entry()]));
    render(<ArenaLeaderboardView mode={MODE} api={fakeApi({ topPlayers })} />);

    expect(await screen.findByTestId("alb-board-failed")).toHaveTextContent("not a closed feature");
    await userEvent.click(screen.getByTestId("alb-board-retry"));
    expect(await screen.findByTestId("alb-top-table")).toBeInTheDocument();
    expect(topPlayers).toHaveBeenCalledTimes(2);
  });

  it("shows a closed board as closed", async () => {
    const closed = { ...boardOf([]), leaderboard_enabled: false };
    render(<ArenaLeaderboardView mode={MODE} api={fakeApi({ topPlayers: vi.fn().mockResolvedValue(closed) })} />);
    expect(await screen.findByTestId("alb-board-disabled")).toBeInTheDocument();
  });

  it("prompts a signed-out reader to sign in and makes no Around You request", async () => {
    const api = fakeApi();
    render(<ArenaLeaderboardView mode={MODE} api={api} />);
    const panel = await screen.findByTestId("alb-around");
    expect(panel).toHaveAttribute("data-state", "signed_out");
    expect(screen.getByTestId("alb-around-signin").getAttribute("href")).toContain("/signin");
    expect(api.aroundMe).not.toHaveBeenCalled();
    expect(screen.queryByTestId("alb-skill-card")).toBeNull();
  });

  it("shows a signed-in player's skill card and neighbours", async () => {
    authState = { user: { id: "u1" }, loading: false };
    render(<ArenaLeaderboardView mode={MODE} api={fakeApi()} />);

    expect(await screen.findByTestId("alb-skill-rating")).toHaveTextContent("1,642");
    expect(screen.getByTestId("alb-skill-tier")).toHaveTextContent("Starter");
    expect(screen.getByTestId("alb-skill-rank")).toHaveTextContent("#2 of 3");
    expect(screen.getByTestId("alb-skill-percentile")).toHaveTextContent("percentiles appear at 30");
    expect(screen.getByTestId("alb-skill-composition")).toHaveTextContent("5 vs people · 4 with bots");
    const rows = screen.getAllByTestId("alb-around-row");
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("alpha"), expect.stringContaining("charlie")]);
    expect(screen.getByTestId("alb-around-you")).toHaveTextContent("me");
  });

  it("answers a not-rated player honestly", async () => {
    authState = { user: { id: "u1" }, loading: false };
    const notRated = around({
      status: "not_rated",
      above: [],
      below: [],
      me: skill({ rated: false, rating: null, rank: null, tier: null, tier_reason: "not_rated", percentile_reason: "not_rated" }),
    });
    render(<ArenaLeaderboardView mode={MODE} api={fakeApi({ aroundMe: vi.fn().mockResolvedValue(notRated) })} />);
    expect(await screen.findByTestId("alb-around-not-rated")).toHaveTextContent("Not rated yet");
    expect(screen.getByTestId("alb-skill-card")).toHaveAttribute("data-state", "unrated");
  });

  it("tells a rated player without a handle that they are ranked but unlisted", async () => {
    authState = { user: { id: "u1" }, loading: false };
    const unlisted = around({ status: "unlisted", me: skill({ listed: false, handle: null }) });
    render(<ArenaLeaderboardView mode={MODE} api={fakeApi({ aroundMe: vi.fn().mockResolvedValue(unlisted) })} />);
    expect(await screen.findByTestId("alb-around-unlisted")).toHaveTextContent("ranked but not listed");
    expect(screen.getByTestId("alb-around-you")).toHaveTextContent("You (unlisted)");
  });

  it("lists every mode the server publishes, including ones this build does not catalogue", async () => {
    const modes = vi.fn().mockResolvedValue([
      { id: "three_man_weave", seat_count: 3 },
      { id: "twenty_dollar", seat_count: 2 },
      { id: "three_man_weave_franchise", seat_count: 3 },
      { id: "future_mode_x", seat_count: 2 },
    ]);
    render(<ArenaLeaderboardView mode={MODE} api={fakeApi({ modes })} />);
    const unknown = await screen.findByTestId("alb-mode-future_mode_x");
    expect(unknown).toHaveTextContent("Future Mode X");
    expect(unknown).toHaveAttribute("href", "/arena/leaderboard/future_mode_x");
    // A catalogued ruleset variant gets its catalogue name, not its id.
    const variant = screen.getByTestId("alb-mode-three_man_weave_franchise");
    expect(variant).toHaveTextContent("Franchise Draft");
    expect(variant).toHaveAttribute("href", "/arena/leaderboard/three_man_weave_franchise");
    expect(screen.getByTestId("alb-mode-three_man_weave")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("alb-mode-twenty_dollar")).toHaveTextContent("The $20 Showdown");
  });
});

describe("leaderboard copy", () => {
  it("never states a population the server did not send", () => {
    expect(populationNote(population())).toBeNull();
    expect(populationNote(population({ rated_population: 1 }))).toBe(
      "1 rated player so far — percentiles appear at 30.",
    );
    expect(unlistedNote(population({ rated_population: 5, total_rated_players: 5 }))).toBeNull();
    expect(unlistedNote(population({ rated_population: 5, total_rated_players: 4 }))).toContain("1 rated player");
  });
});

describe("ArenaSkillBadge", () => {
  it("labels unrated, provisional and rated states from server data", () => {
    expect(skillBadgeText(null)).toMatchObject({ state: "unrated", primary: "Unrated" });
    expect(skillBadgeText(skill({ provisional: true, rated_matches: 3, tier: null }))).toMatchObject({
      state: "provisional",
      secondary: "Provisional 3/7",
    });
    expect(skillBadgeText(skill())).toMatchObject({ state: "rated", primary: "1,642", secondary: "Starter" });
  });

  it("links to the mode's board by default and can render without a link", () => {
    const { rerender } = render(<ArenaSkillBadge mode="twenty_dollar" skill={skill()} />);
    const badge = screen.getByTestId("arena-skill-badge");
    expect(badge).toHaveAttribute("href", "/arena/leaderboard/twenty_dollar");
    expect(badge.getAttribute("aria-label")).toContain("The $20 Showdown");

    rerender(<ArenaSkillBadge mode="twenty_dollar" skill={null} href={null} />);
    expect(screen.getByTestId("arena-skill-badge").tagName).toBe("SPAN");
  });
});
