/**
 * SHARED DRAFT room, wired to a fake server.
 *
 * The room's contract rather than its pixels: the shared pool shows every
 * card's state in words, taken cards stay on the board locked, a tap SELECTS
 * and only Draft commits (one command naming the card and the pick number),
 * nothing is pickable off your clock, no score is ever rendered live, and the
 * result shows the server's totals and the slot-by-slot head to head.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

import type { SharedDraftCard, SharedDraftMatchView, SharedDraftSlot } from "@/types/shared-draft";

const getMatch = vi.fn();
const submitCommand = vi.fn();
const createPracticeMatch = vi.fn();
const replace = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/arena/shared-draft/shared_draft-match",
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
  getPersonalRecord: vi.fn(async () => null),
}));

import SharedDraftGame from "@/components/shared-draft/SharedDraftGame";

const SLOTS: SharedDraftSlot[] = ["PG", "SG", "SF", "PF", "C"];
const NAMES: [string, SharedDraftSlot, number][] = [
  ["Stephen Curry", "PG", 93.9],
  ["Chris Paul", "PG", 88.08],
  ["James Harden", "SG", 88.79],
  ["Devin Booker", "SG", 59.99],
  ["Anthony Edwards", "SG", 60.55],
  ["LeBron James", "SF", 95.85],
  ["Kawhi Leonard", "SF", 87.84],
  ["Giannis Antetokounmpo", "PF", 91.28],
  ["Evan Mobley", "PF", 68.36],
  ["Nikola Jokic", "C", 93.48],
  ["Joel Embiid", "C", 86.18],
  ["Victor Wembanyama", "C", 90.06],
];

function cards(drafted: Record<number, [number, number]> = {}, revealed = false): SharedDraftCard[] {
  return NAMES.map(([name, position, score], index) => ({
    card_index: index,
    player_slug: name.toLowerCase().replace(/ /g, "-"),
    player_name: name,
    position,
    peak_season: "2015-16",
    team: "GSW",
    drafted_by: drafted[index]?.[0] ?? null,
    pick_number: drafted[index]?.[1] ?? null,
    ...(revealed ? { prime_score: score, rank: index + 1, components: { statistical_impact: score / 3 } } : {}),
  }));
}

function roster(map: Partial<Record<SharedDraftSlot, number>>): Record<SharedDraftSlot, number | null> {
  return Object.fromEntries(SLOTS.map((s) => [s, map[s] ?? null])) as Record<SharedDraftSlot, number | null>;
}

function view(overrides: Partial<SharedDraftMatchView> & { public?: Partial<SharedDraftMatchView["public_state"]>; private?: Partial<SharedDraftMatchView["private_state"]> } = {}): SharedDraftMatchView {
  const { public: pub, private: priv, ...rest } = overrides;
  return {
    match_id: "shared_draft-match",
    mode: "shared_draft",
    mode_version: "shared_draft_v1",
    model_version: "peak3_v1",
    status: "active",
    state_version: 7,
    seat_count: 2,
    entry_path: "practice",
    rated: false,
    your_seat_index: 0,
    seats: [
      { seat_index: 0, display_name: "You", is_bot: false, status: "active", bot_rating: null },
      { seat_index: 1, display_name: "IsoKing", is_bot: true, status: "active", bot_rating: 1250 },
    ] as never,
    current_turn_seat_index: 0,
    seconds_remaining: 30,
    turn_phase: "pick",
    turn_seconds_remaining: 30,
    turn_seq: 4,
    turn_elapsed_seconds: 0,
    turn_total_seconds: 30,
    latest_event_seq: 6,
    room_code: null,
    legal_commands: ["sd_pick", "sd_forfeit"],
    public_state: {
      ruleset_version: "shared_draft_v1",
      board_version: "shared_draft_board_v1",
      model_version: "peak3_v1",
      latest_season: "2025-26",
      phase: "pick",
      slots: SLOTS,
      order: [0, 1, 1, 0, 0, 1, 1, 0, 0, 1],
      pick_index: 3,
      pick_count: 10,
      current_seat: 0,
      // You took Curry (pick 1); IsoKing took LeBron and Jokic (picks 2, 3).
      cards: cards({ 0: [0, 1], 5: [1, 2], 9: [1, 3] }),
      picks: [
        { pick_number: 1, seat_index: 0, card_index: 0, auto: null },
        { pick_number: 2, seat_index: 1, card_index: 5, auto: null },
        { pick_number: 3, seat_index: 1, card_index: 9, auto: null },
      ],
      seats: [
        { seat_index: 0, display_name: "You", is_bot: false, arrived: true, forfeited: false, roster: roster({ PG: 0 }), picks_made: 1 },
        { seat_index: 1, display_name: "IsoKing", is_bot: true, arrived: true, forfeited: false, roster: roster({ SF: 5, C: 9 }), picks_made: 2 },
      ],
      ended_by: null,
      ...pub,
    },
    private_state: {
      seat_index: 0,
      open_positions: ["SG", "SF", "PF", "C"],
      legal_cards: [2, 3, 4, 6, 7, 8, 10, 11],
      forfeited: false,
      ...priv,
    },
    ...rest,
  } as SharedDraftMatchView;
}

async function mount(v = view()) {
  getMatch.mockResolvedValue(v);
  const utils = render(<SharedDraftGame matchId={v.match_id} />);
  await act(async () => {});
  return utils;
}

beforeEach(() => {
  getMatch.mockReset();
  submitCommand.mockReset();
  createPracticeMatch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SHARED DRAFT room", () => {
  it("shows the whole shared pool with each card's state in words, and both rosters", async () => {
    await mount();
    const pool = await screen.findByTestId("sdraft-pool");
    expect(within(pool).getAllByRole("button")).toHaveLength(12);
    expect(screen.getByTestId("sdraft-pool-count")).toHaveTextContent("9 of 12 left");
    // Taken by the opponent: still on the board, locked, named.
    expect(screen.getByTestId("sdraft-card-5")).toHaveAttribute("data-state", "theirs");
    expect(screen.getByTestId("sdraft-card-5")).toHaveTextContent("IsoKing · pick 2");
    expect(screen.getByTestId("sdraft-card-5")).toHaveAttribute("aria-disabled", "true");
    // Yours.
    expect(screen.getByTestId("sdraft-card-0")).toHaveTextContent("Yours · pick 1");
    // Your PG is filled, so Chris Paul is not yours to take.
    expect(screen.getByTestId("sdraft-card-1")).toHaveAttribute("data-state", "filled");
    expect(screen.getByTestId("sdraft-card-1")).toHaveTextContent("Your PG is set");
    expect(within(screen.getByTestId("sdraft-roster-you")).getByText("Stephen Curry")).toBeInTheDocument();
    expect(within(screen.getByTestId("sdraft-roster-opponent")).getByText("Nikola Jokic")).toBeInTheDocument();
    expect(screen.getByTestId("sdraft-heading")).toHaveTextContent("Pick 4 of 10 · your pick");
  });

  it("never renders a PEAK3 score while the draft is live", async () => {
    const { container } = await mount();
    for (const [, , score] of NAMES) {
      expect(container.textContent).not.toContain(score.toFixed(2));
    }
  });

  it("a tap selects, only Draft commits, and it sends one pick naming the card and pick number", async () => {
    submitCommand.mockImplementation(() => new Promise(() => {}));
    await mount();
    const draft = await screen.findByTestId("sdraft-draft");
    expect(draft).toBeDisabled();
    fireEvent.click(screen.getByTestId("sdraft-card-2"));
    expect(submitCommand).not.toHaveBeenCalled();
    expect(screen.getByTestId("sdraft-card-2")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("sdraft-controls")).toHaveTextContent("James Harden");
    fireEvent.click(draft);
    fireEvent.click(draft);
    expect(submitCommand).toHaveBeenCalledTimes(1);
    const [matchId, command, payload, version] = submitCommand.mock.calls[0];
    expect(matchId).toBe("shared_draft-match");
    expect(command).toBe("sd_pick");
    expect(payload).toEqual({ card_index: 2, pick_number: 4 });
    expect(version).toBe(7);
  });

  it("taken and filled cards cannot be selected", async () => {
    await mount();
    fireEvent.click(await screen.findByTestId("sdraft-card-5"));
    fireEvent.click(screen.getByTestId("sdraft-card-1"));
    expect(screen.getByTestId("sdraft-draft")).toBeDisabled();
    expect(screen.getByTestId("sdraft-card-5")).not.toHaveAttribute("data-selected");
  });

  it("off your clock nothing is pickable and the room says who is picking", async () => {
    await mount(
      view({
        legal_commands: ["sd_forfeit"],
        current_turn_seat_index: 1,
        public: { pick_index: 1, current_seat: 1, cards: cards({ 0: [0, 1] }), picks: [{ pick_number: 1, seat_index: 0, card_index: 0, auto: null }] },
        private: { legal_cards: [] },
      }),
    );
    expect(await screen.findByTestId("sdraft-waiting")).toHaveTextContent("IsoKing is on the clock");
    expect(screen.queryByTestId("sdraft-draft")).toBeNull();
    fireEvent.click(screen.getByTestId("sdraft-card-2"));
    expect(screen.getByTestId("sdraft-card-2")).not.toHaveAttribute("data-selected");
    expect(screen.getByTestId("sdraft-order").querySelector('[aria-current="step"]')).toHaveAttribute(
      "aria-label",
      "Pick 2: IsoKing, on the clock",
    );
  });

  it("reports arrival once during the intro and shows the intro without a skip", async () => {
    // The report stays in flight: the intro is still what is on screen.
    submitCommand.mockImplementation(() => new Promise(() => {}));
    await mount(
      view({
        legal_commands: ["sd_intro_seen", "sd_forfeit"],
        turn_phase: "arrival",
        current_turn_seat_index: null,
        public: { phase: "arrival", pick_index: 0, current_seat: null, cards: cards(), picks: [] },
        private: { legal_cards: [] },
      }),
    );
    expect(await screen.findByTestId("sdraft-intro")).toHaveTextContent("One board. Two drafts.");
    expect(submitCommand).toHaveBeenCalledTimes(1);
    expect(submitCommand.mock.calls[0][1]).toBe("sd_intro_seen");
    expect(screen.queryByRole("button", { name: /skip/i })).toBeNull();
  });

  it("the result shows the server's totals and the five positions head to head", async () => {
    const full = cards({ 0: [0, 1], 5: [1, 2], 9: [1, 3], 2: [0, 4], 6: [0, 5], 7: [1, 6], 3: [1, 7], 10: [0, 8], 8: [0, 9], 1: [1, 10] }, true);
    await mount(
      view({
        status: "completed",
        legal_commands: [],
        turn_phase: null,
        public: {
          phase: "complete",
          pick_index: 10,
          current_seat: null,
          cards: full,
          seats: [
            { seat_index: 0, display_name: "You", is_bot: false, arrived: true, forfeited: false, roster: roster({ PG: 0, SG: 2, SF: 6, PF: 8, C: 10 }), picks_made: 5, roster_total: 425.15, component_totals: { statistical_impact: 140.1 } },
            { seat_index: 1, display_name: "IsoKing", is_bot: true, arrived: true, forfeited: false, roster: roster({ PG: 1, SG: 3, SF: 5, PF: 7, C: 9 }), picks_made: 5, roster_total: 428.69, component_totals: { statistical_impact: 142.9 } },
          ],
          ended_by: "completed",
          placements: [
            { seat_index: 0, placement: 2, outcome: "loss" },
            { seat_index: 1, placement: 1, outcome: "win" },
          ],
        },
      }),
    );
    expect(await screen.findByTestId("sdraft-result-title")).toHaveTextContent("IsoKing won the draft");
    expect(screen.getByTestId("sdraft-total-you")).toHaveTextContent("425.15");
    expect(screen.getByTestId("sdraft-total-opponent")).toHaveTextContent("428.69");
    const h2h = screen.getByTestId("sdraft-h2h");
    const pg = within(h2h).getByText("PG", { selector: "th" }).closest("tr") as HTMLElement;
    expect(pg).toHaveTextContent("Stephen Curry");
    expect(pg).toHaveTextContent("Chris Paul");
    expect(pg).toHaveTextContent("+5.82");
    expect(screen.getByTestId("sdraft-undrafted")).toHaveTextContent("Anthony Edwards");
    expect(screen.getByTestId("sdraft-undrafted")).toHaveTextContent("Victor Wembanyama");
  });
});
