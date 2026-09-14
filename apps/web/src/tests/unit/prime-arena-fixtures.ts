/**
 * Server-shaped fixtures for the PRIME CUT and FIND THE PRIME room tests.
 *
 * Every field mirrors what the API's projection sends. Live states carry NO
 * PEAK3 score for a card or window, exactly as the server never does; revealed
 * states carry them only inside `heat_results` / `round_results`.
 */
import type { PrimeCutCard, PrimeCutHeatResult, PrimeCutMatchView } from "@/types/prime-cut";
import type { FindThePrimeMatchView, FindThePrimeRoundReveal, FindThePrimeSeason } from "@/types/find-the-prime";

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

const SEATS = [
  { seat_index: 0, display_name: "You", is_bot: false, status: "active", bot_rating: null },
  { seat_index: 1, display_name: "IsoKing", is_bot: true, status: "active", bot_rating: 1388 },
  { seat_index: 2, display_name: "GlassCleaner", is_bot: true, status: "active", bot_rating: 1200 },
  { seat_index: 3, display_name: "CornerThree", is_bot: true, status: "active", bot_rating: 1059 },
];

const TIERS = [null, "MVP", "Starter", "Rotation"];

function envelope(mode: string, overrides: Record<string, unknown>) {
  return {
    match_id: `${mode}-match`,
    mode,
    mode_version: `${mode}_v1`,
    model_version: "peak3_v1",
    status: "active",
    state_version: 5,
    seat_count: 4,
    entry_path: "practice",
    rated: false,
    your_seat_index: 0,
    seats: SEATS,
    current_turn_seat_index: null,
    seconds_remaining: 12,
    turn_seconds_remaining: 12,
    turn_seq: 3,
    turn_elapsed_seconds: 0,
    turn_total_seconds: 12,
    latest_event_seq: 4,
    room_code: null,
    ...overrides,
  };
}

export const PLAYERS = ["LeBron James", "Tim Duncan", "Kevin Garnett", "Chris Paul", "Dirk Nowitzki", "Paul Pierce", "Jason Kidd", "Tracy McGrady"];

export function pcCard(index: number, duration = 2): PrimeCutCard {
  const start = 2001 + index;
  return {
    card_index: index,
    window_id: `player-${index}-${duration}yr-from-${start - 1}${String(start).slice(2)}`,
    player_slug: `player-${index}`,
    player_name: PLAYERS[index],
    duration,
    start_season: `${start - 1}-${String(start).slice(2)}`,
    end_season: `${start + duration - 2}-${String(start + duration - 1).slice(2)}`,
    seasons: Array.from({ length: duration }, (_, i) => ({
      season: `${start - 1 + i}-${String(start + i).slice(2)}`,
      team: i === 1 ? "Multiple teams" : "SAS",
    })),
  };
}

export function pcHeatResult(heatIndex = 0, duration = 2): PrimeCutHeatResult {
  const scores = [91.2, 88.4, 85.1, 80.3, 78.9, 72.0, 66.5, 60.1];
  const cards = Array.from({ length: 8 }, (_, i) => ({ ...pcCard(i, duration), prime_score: scores[i], canonical_rank: 10 + i * 12 }));
  return {
    heat_index: heatIndex,
    duration,
    cards,
    optimal_card_indexes: [0, 1, 2, 3],
    cut_line: 79.6,
    optimal_total: 345.0,
    floor_total: 277.5,
    seats: [0, 1, 2, 3].map((seat) => ({
      seat_index: seat,
      capture: [88.5, 100, 64.2, 71.0][seat],
      kept_card_indexes: seat === 0 ? [0, 1, 2, 4] : [0, 1, 2, 3],
      cut_card_indexes: seat === 0 ? [3, 5, 6, 7] : [4, 5, 6, 7],
      optimal_kept: seat === 0 ? 3 : 4,
      kept_total: 343.6,
      decisions: Array.from({ length: 8 }, (_, i) => ({
        card_index: i,
        decision: (seat === 0 ? [0, 1, 2, 4] : [0, 1, 2, 3]).includes(i) ? ("keep" as const) : ("cut" as const),
        auto: null,
      })),
      strongest_correct_keep: 0,
      weakest_keep: seat === 0 ? 4 : 3,
      costliest_cut: seat === 0 ? 3 : null,
      best_call: 2,
    })),
  };
}

function pcSeats(locked: boolean[] = [false, true, false, true]) {
  return SEATS.map((s, i) => ({
    seat_index: s.seat_index,
    display_name: s.display_name,
    is_bot: s.is_bot,
    bot_tier: TIERS[i],
    locked: locked[i],
    forfeited: false,
  }));
}

function pcStandings(scores: (number | null)[] = [null, null, null, null]) {
  return [0, 1, 2, 3].map((seat) => ({
    seat_index: seat,
    heat_scores: {},
    heats_completed: 0,
    match_score: scores[seat],
    optimal_keeps: 0,
    captured_ratio: null,
    position: 1,
    forfeited: false,
  }));
}

export function primeCutView(overrides: DeepPartial<PrimeCutMatchView> & Record<string, unknown> = {}): PrimeCutMatchView {
  const { public_state, private_state, ...rest } = overrides as { public_state?: Record<string, unknown>; private_state?: Record<string, unknown> };
  return {
    ...envelope("prime_cut", { legal_commands: ["pc_keep", "pc_cut", "pc_forfeit"], turn_phase: "card", ...rest }),
    public_state: {
      ruleset_version: "prime_cut_v1",
      board_version: "prime_cut_board_v1",
      artifact_version: "career_windows.v1",
      model_version: "peak3-v1",
      phase: "card",
      heat_index: 0,
      heat_count: 3,
      durations: [2, 3, 5],
      cards_per_heat: 8,
      keeps_per_heat: 4,
      cuts_per_heat: 4,
      card_index: 2,
      current_card: pcCard(2),
      dealt_cards: [pcCard(0), pcCard(1), pcCard(2)],
      seats: pcSeats(),
      heat_results: [],
      standings: pcStandings(),
      ended_by: null,
      ...(public_state ?? {}),
    },
    private_state: {
      seat_index: 0,
      keeps_used: 1,
      cuts_used: 1,
      keeps_left: 3,
      cuts_left: 3,
      decisions: [
        { card_index: 0, decision: "keep", auto: null },
        { card_index: 1, decision: "cut", auto: null },
      ],
      current_decision: null,
      forced_decision: null,
      forfeited: false,
      ...(private_state ?? {}),
    },
  } as unknown as PrimeCutMatchView;
}

export function primeCutCompleted(): PrimeCutMatchView {
  const results = [pcHeatResult(0, 2), pcHeatResult(1, 3), pcHeatResult(2, 5)];
  return primeCutView({
    status: "completed",
    turn_phase: null,
    turn_seconds_remaining: null,
    legal_commands: [],
    public_state: {
      phase: "complete",
      heat_index: 2,
      card_index: null,
      current_card: null,
      dealt_cards: [],
      heat_results: results,
      ended_by: "completed",
      standings: [0, 1, 2, 3].map((seat) => ({
        seat_index: seat,
        heat_scores: { "2": 88.5, "3": 88.5, "5": 88.5 },
        heats_completed: 3,
        match_score: [88.5, 100, 64.2, 71][seat],
        optimal_keeps: seat === 0 ? 9 : 12,
        captured_ratio: 0.98,
        position: [2, 1, 4, 3][seat],
        forfeited: false,
      })),
      placements: [
        { seat_index: 0, placement: 2, outcome: "loss" },
        { seat_index: 1, placement: 1, outcome: "win" },
        { seat_index: 2, placement: 4, outcome: "loss" },
        { seat_index: 3, placement: 3, outcome: "loss" },
      ],
    } as never,
    private_state: { decisions: [], current_decision: null, keeps_left: 4, cuts_left: 4 } as never,
  });
}

// ---------------------------------------------------------------------------
// FIND THE PRIME
// ---------------------------------------------------------------------------

/** 2003-04 .. 2009-10 with the 2006-07 season missing (a gap). */
export const FTP_SEASONS: FindThePrimeSeason[] = [2004, 2005, 2006, 2008, 2009, 2010].map((end) => ({
  season: `${end - 1}-${String(end).slice(2)}`,
  season_end: end,
  team: end === 2008 ? "Multiple teams" : "PHO",
}));

/** Legal 2-year starts over those seasons: 2004, 2005, 2008, 2009 (2006 would span the gap). */
export const FTP_LEGAL_STARTS = [2004, 2005, 2008, 2009];

export function ftpReveal(): FindThePrimeRoundReveal {
  const scores: Record<number, number> = { 2004: 71.2, 2005: 88.4, 2008: 86.9, 2009: 74.0 };
  const windows = FTP_LEGAL_STARTS.map((start) => ({
    window_id: `steve-nash-2yr-from-${start}`,
    start_season: `${start - 1}-${String(start).slice(2)}`,
    end_season: `${start}-${String(start + 1).slice(2)}`,
    start_season_end: start,
    end_season_end: start + 1,
    prime_score: scores[start],
  }));
  return {
    round_index: 0,
    duration: 2,
    player_slug: "steve-nash",
    player_name: "Steve Nash",
    seasons: FTP_SEASONS,
    legal_starts: FTP_LEGAL_STARTS,
    career_first_season: "2003-04",
    career_last_season: "2009-10",
    windows,
    best_window_id: "steve-nash-2yr-from-2005",
    equivalent_window_ids: ["steve-nash-2yr-from-2005"],
    best_score: 88.4,
    scale: 20.47,
    seats: [
      { seat_index: 0, round_index: 0, window_id: "steve-nash-2yr-from-2008", start_season_end: 2008, prime_score: 86.9, points: 92.67, regret: 1.5, found_prime: false, locked_by: "lock" },
      { seat_index: 1, round_index: 0, window_id: "steve-nash-2yr-from-2005", start_season_end: 2005, prime_score: 88.4, points: 100, regret: 0, found_prime: true, locked_by: "lock" },
      { seat_index: 2, round_index: 0, window_id: null, start_season_end: null, prime_score: null, points: 0, regret: 17.2, found_prime: false, locked_by: "no_selection" },
      { seat_index: 3, round_index: 0, window_id: "steve-nash-2yr-from-2004", start_season_end: 2004, prime_score: 71.2, points: 15.97, regret: 17.2, found_prime: false, locked_by: "lock" },
    ],
  };
}

export function findThePrimeView(overrides: Record<string, unknown> = {}): FindThePrimeMatchView {
  const { public_state, private_state, ...rest } = overrides as { public_state?: Record<string, unknown>; private_state?: Record<string, unknown> };
  return {
    ...envelope("find_the_prime", {
      legal_commands: ["ftp_stage", "ftp_lock", "ftp_forfeit"],
      turn_phase: "decide",
      seconds_remaining: 20,
      turn_seconds_remaining: 20,
      turn_total_seconds: 20,
      ...rest,
    }),
    public_state: {
      ruleset_version: "find_the_prime_v1",
      board_version: "find_the_prime_board_v1",
      artifact_version: "career_windows.v1",
      model_version: "peak3-v1",
      phase: "decide",
      round_index: 0,
      round_count: 9,
      max_match_score: 900,
      durations_by_round_played: [],
      prompt: {
        round_index: 0,
        duration: 2,
        player_slug: "steve-nash",
        player_name: "Steve Nash",
        seasons: FTP_SEASONS,
        legal_starts: FTP_LEGAL_STARTS,
        career_first_season: "2003-04",
        career_last_season: "2009-10",
      },
      seats: SEATS.map((s, i) => ({ seat_index: s.seat_index, display_name: s.display_name, is_bot: s.is_bot, bot_tier: TIERS[i], locked: i === 1, forfeited: false })),
      round_results: [],
      standings: [0, 1, 2, 3].map((seat) => ({ seat_index: seat, total: 0, found_primes: 0, total_regret: 0, rounds_scored: 0, rounds_answered: 0, average_regret: null, position: 1, forfeited: false })),
      ended_by: null,
      ...(public_state ?? {}),
    },
    private_state: { seat_index: 0, staged_start: null, locked_start: null, forfeited: false, ...(private_state ?? {}) },
  } as unknown as FindThePrimeMatchView;
}
