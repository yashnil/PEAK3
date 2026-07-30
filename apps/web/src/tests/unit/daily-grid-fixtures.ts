/**
 * Shared fixtures for the Daily Grid Challenge unit tests.
 *
 * Every player-season named here is a real NBA season (real player, real
 * team, real year); only the model numbers (`prime_score`, `arena_points`)
 * are fixture stand-ins, and they never leave the test process -- no
 * fabricated data is ever rendered as real PEAK3 output in the app, which
 * takes those values exclusively from the API response.
 *
 * Not a .test.ts file, so vitest's default include pattern skips it.
 */
import {
  DAILY_GRID_PROGRESS_SCHEMA_VERSION,
  DailyGridBoard,
  DailyGridProgress,
  FilledCell,
  GridResultResponse,
  PlayerSeasonCard,
  RarityBucket,
  ResultCell,
} from "@/types/daily-grid";

export const BOARD: DailyGridBoard = {
  board_id: "grid-2026-07-30",
  date: "2026-07-30",
  version: "1.0.0",
  difficulty: "medium",
  rows: [
    {
      id: "team-bos",
      label: "Boston Celtics",
      short_label: "Celtics",
      category: "team",
      description: "Played at least one regular-season game for the Boston Celtics that season.",
    },
    {
      id: "award-dpoy",
      label: "Defensive Player of the Year",
      short_label: "DPOY",
      category: "award",
      description: "Won the NBA Defensive Player of the Year award for that season.",
    },
    {
      id: "outcome-champ",
      label: "NBA Champion",
      short_label: "Champion",
      category: "outcome",
      description: "Was on the roster of the team that won the NBA title that season.",
    },
  ],
  cols: [
    {
      id: "era-1990s",
      label: "1990s",
      short_label: "1990s",
      category: "era",
      description: "The season began in a year from 1990 through 1999.",
    },
    {
      id: "pos-center",
      label: "Center",
      short_label: "C",
      category: "position",
      description: "Listed at center for that season.",
    },
    {
      id: "peak-85",
      label: "85+ PEAK Season",
      short_label: "85+ PEAK",
      category: "peak",
      description: "The season's calibrated PEAK3 score is 85 or higher.",
    },
  ],
  cells: [
    { row: 0, col: 0, row_constraint_id: "team-bos", col_constraint_id: "era-1990s", rarity_bucket: "common" },
    { row: 0, col: 1, row_constraint_id: "team-bos", col_constraint_id: "pos-center", rarity_bucket: "uncommon" },
    { row: 0, col: 2, row_constraint_id: "team-bos", col_constraint_id: "peak-85", rarity_bucket: "rare" },
    { row: 1, col: 0, row_constraint_id: "award-dpoy", col_constraint_id: "era-1990s", rarity_bucket: "uncommon" },
    { row: 1, col: 1, row_constraint_id: "award-dpoy", col_constraint_id: "pos-center", rarity_bucket: "rare" },
    { row: 1, col: 2, row_constraint_id: "award-dpoy", col_constraint_id: "peak-85", rarity_bucket: "very_rare" },
    { row: 2, col: 0, row_constraint_id: "outcome-champ", col_constraint_id: "era-1990s", rarity_bucket: "very_common" },
    { row: 2, col: 1, row_constraint_id: "outcome-champ", col_constraint_id: "pos-center", rarity_bucket: "common" },
    { row: 2, col: 2, row_constraint_id: "outcome-champ", col_constraint_id: "peak-85", rarity_bucket: "rare" },
  ],
  rules: { unique_player_identity: true, grid_size: 3 },
};

export function playerSeason(overrides: Partial<PlayerSeasonCard> = {}): PlayerSeasonCard {
  return {
    id: "hakeem-olajuwon-1993-94",
    player_slug: "hakeem-olajuwon",
    player_name: "Hakeem Olajuwon",
    season: "1993-94",
    team: "HOU",
    team_name: "Houston Rockets",
    position: "C",
    prime_score: 92.4,
    label: "1993-94 Hakeem Olajuwon",
    ...overrides,
  };
}

/**
 * Phase 11B: strips `prime_score` off the card before storing it, exactly as
 * the real submit response does. A locked square's score lives ONLY in
 * `cell_score.quality_points` -- keeping the field on the fixture would let a
 * component read a score from a place production never provides one, and the
 * "no score before lock" tests would pass against a shape that cannot happen.
 */
export function filledCell(
  row: number,
  col: number,
  season: PlayerSeasonCard,
  arenaPoints: number,
  rarity: RarityBucket,
): FilledCell {
  const { prime_score, ...identity } = season;
  return {
    row,
    col,
    player_season: identity,
    cell_score: {
      arena_points: arenaPoints,
      quality_points: Math.round(prime_score),
      rarity_bucket: rarity,
      rarity_label: rarity === "very_rare" ? "Very rare square" : "Rare square",
      rarity_multiplier: rarity === "very_rare" ? 1.4 : 1.1,
      rarity_bonus: arenaPoints - Math.round(prime_score),
    },
  };
}

/** Nine real player-seasons, one per square, all different identities. */
const NINE: Array<[number, number, Partial<PlayerSeasonCard>, number, RarityBucket]> = [
  [0, 0, {}, 120, "common"],
  [
    0,
    1,
    {
      id: "david-robinson-1991-92",
      player_slug: "david-robinson",
      player_name: "David Robinson",
      season: "1991-92",
      team: "SAS",
      team_name: "San Antonio Spurs",
      prime_score: 88.1,
      label: "1991-92 David Robinson",
    },
    100,
    "uncommon",
  ],
  [
    0,
    2,
    {
      id: "patrick-ewing-1989-90",
      player_slug: "patrick-ewing",
      player_name: "Patrick Ewing",
      season: "1989-90",
      team: "NYK",
      team_name: "New York Knicks",
      prime_score: 85.7,
      label: "1989-90 Patrick Ewing",
    },
    95,
    "rare",
  ],
  [
    1,
    0,
    {
      id: "dikembe-mutombo-1999-00",
      player_slug: "dikembe-mutombo",
      player_name: "Dikembe Mutombo",
      season: "1999-00",
      team: "ATL",
      team_name: "Atlanta Hawks",
      prime_score: 76.2,
      label: "1999-00 Dikembe Mutombo",
    },
    90,
    "uncommon",
  ],
  [
    1,
    1,
    {
      id: "alonzo-mourning-1998-99",
      player_slug: "alonzo-mourning",
      player_name: "Alonzo Mourning",
      season: "1998-99",
      team: "MIA",
      team_name: "Miami Heat",
      prime_score: 80.3,
      label: "1998-99 Alonzo Mourning",
    },
    88,
    "rare",
  ],
  [
    1,
    2,
    {
      id: "shaquille-oneal-1999-00",
      player_slug: "shaquille-oneal",
      player_name: "Shaquille O'Neal",
      season: "1999-00",
      team: "LAL",
      team_name: "Los Angeles Lakers",
      prime_score: 96.0,
      label: "1999-00 Shaquille O'Neal",
    },
    100,
    "very_rare",
  ],
  [
    2,
    0,
    {
      id: "ben-wallace-2003-04",
      player_slug: "ben-wallace",
      player_name: "Ben Wallace",
      season: "2003-04",
      team: "DET",
      team_name: "Detroit Pistons",
      prime_score: 71.5,
      label: "2003-04 Ben Wallace",
    },
    85,
    "very_common",
  ],
  [
    2,
    1,
    {
      id: "dwight-howard-2010-11",
      player_slug: "dwight-howard",
      player_name: "Dwight Howard",
      season: "2010-11",
      team: "ORL",
      team_name: "Orlando Magic",
      prime_score: 82.9,
      label: "2010-11 Dwight Howard",
    },
    84,
    "common",
  ],
  [
    2,
    2,
    {
      id: "rudy-gobert-2016-17",
      player_slug: "rudy-gobert",
      player_name: "Rudy Gobert",
      season: "2016-17",
      team: "UTA",
      team_name: "Utah Jazz",
      prime_score: 74.8,
      label: "2016-17 Rudy Gobert",
    },
    80,
    "rare",
  ],
];

/** Total arena_points of `completedProgress()`: 842. */
export function completedProgress(): DailyGridProgress {
  return {
    board_id: BOARD.board_id,
    date: BOARD.date,
    schema_version: DAILY_GRID_PROGRESS_SCHEMA_VERSION,
    filled: NINE.map(([row, col, o, pts, rarity]) => filledCell(row, col, playerSeason(o), pts, rarity)),
    incorrect_attempts: 3,
    completed_at: "2026-07-30T12:00:00Z",
  };
}

/**
 * A post-completion comparison against today's maximum, shaped exactly like
 * POST /daily-grid/result. Built from `completedProgress()` so the two agree:
 * the player's own totals here are the ones that fixture actually scored.
 *
 * The "optimal" seasons are real player-seasons; the point values are stand-in
 * model numbers that never leave the test process.
 */
export function gridResult(overrides: Partial<GridResultResponse> = {}): GridResultResponse {
  const progress = completedProgress();
  const userTotal = progress.filled.reduce((s, c) => s + c.cell_score.arena_points, 0);
  const cells: ResultCell[] = progress.filled.map((c, i) => {
    // One deliberate miss (the last square) so `biggest_miss` has something to
    // name; every other square is treated as matching the maximum.
    const isMiss = i === progress.filled.length - 1;
    const optimalSeason: PlayerSeasonCard = isMiss
      ? {
          id: "nikola-jokic-2021-22",
          player_slug: "nikola-jokic",
          player_name: "Nikola Jokic",
          season: "2021-22",
          team: "DEN",
          team_name: "Denver Nuggets",
          position: "C",
          prime_score: 95.1,
          label: "2021-22 Nikola Jokic",
        }
      : { ...c.player_season, prime_score: c.cell_score.quality_points };
    const optimalPoints = isMiss ? c.cell_score.arena_points + 41 : c.cell_score.arena_points;
    return {
      row: c.row,
      col: c.col,
      row_constraint_label: `Row ${c.row + 1}`,
      col_constraint_label: `Column ${c.col + 1}`,
      user_player_season: { ...c.player_season, prime_score: c.cell_score.quality_points },
      user_points: c.cell_score.arena_points,
      optimal_player_season: optimalSeason,
      optimal_points: optimalPoints,
      points_left: optimalPoints - c.cell_score.arena_points,
      matched_optimal: !isMiss,
    };
  });
  const optimalTotal = cells.reduce((s, c) => s + c.optimal_points, 0);
  return {
    board_id: BOARD.board_id,
    date: BOARD.date,
    user_total: userTotal,
    optimal_total: optimalTotal,
    percent_of_best: Math.round((1000 * userTotal) / optimalTotal) / 10,
    exact_optimal: true,
    incorrect_attempts: progress.incorrect_attempts,
    squares_matching_optimal: cells.filter((c) => c.matched_optimal).length,
    cells,
    best_cell: cells[0],
    biggest_miss: cells[cells.length - 1],
    ...overrides,
  };
}
