/**
 * Daily Grid e2e board solver — finds nine real, server-scored squares with
 * nine DIFFERENT players, for any valid board, through the public API only.
 *
 * THE DEFECT THIS REPLACES (daily-grid.spec.ts `solveBoardViaApi`, 2026-10-06):
 *
 *   1. CANDIDATES. Answers were looked up only among a fixed list of ~200
 *      famous names. A square like Undrafted x Oklahoma City Thunder has real
 *      answers (Alex Caruso 2024-25, ...) and none of them is a probe name, so
 *      the helper threw "no distinct-player answer found" on a board the
 *      generator had proved solvable (its own distinct-player backtracking,
 *      `nba_peak/daily_grid/generator.py::_solvable_with_distinct_players`).
 *   2. ASSIGNMENT. Squares were locked greedily in row-major order with the
 *      first probe name that fit, so even with enough candidates an early
 *      square could spend the only player a later square needed.
 *
 * NOW: candidate NAMES come from the probe list first (so previously solvable
 * boards keep their fast path), then from every player name the public
 * rankings endpoints serve (`/api/v1/peaks`, `/api/v1/seasons`) -- real names,
 * never an answer key, and measured to cover a full distinct solution for
 * every board sampled. Each name is checked per square through the same
 * cell-scoped SEARCH the UI uses; the nine squares are then matched globally
 * (`assignDistinctPlayers`, backtracking), and only then locked through
 * POST /answer, which re-validates eligibility and the distinct-player rule
 * server-side. Deterministic: names are processed in a fixed order whatever
 * order concurrent responses arrive in.
 */
import type { APIRequestContext } from "@playwright/test";

export interface Candidate {
  /** The player identity the distinct-player rule is keyed on. */
  playerSlug: string;
  /** The player-season answer id the search route marked available. */
  answerId: string;
}

/**
 * One candidate per square, all nine players distinct, or null if none exists.
 *
 * `candidates[i]` is square i's options IN PREFERENCE ORDER; the first legal
 * global assignment in that order is returned (indices into each list).
 * Backtracks over squares fewest-options-first (ties by square index), so a
 * binding square is decided before an open one -- the same order the
 * generator's own solvability check uses. Pure and deterministic.
 */
export function assignDistinctPlayers(candidates: readonly (readonly Candidate[])[]): number[] | null {
  const order = candidates
    .map((options, square) => ({ square, size: new Set(options.map((c) => c.playerSlug)).size }))
    .sort((a, b) => a.size - b.size || a.square - b.square)
    .map((entry) => entry.square);
  const chosen = new Array<number>(candidates.length).fill(-1);
  const used = new Set<string>();

  const assign = (k: number): boolean => {
    if (k === order.length) return true;
    const square = order[k];
    const tried = new Set<string>();
    for (let i = 0; i < candidates[square].length; i++) {
      const slug = candidates[square][i].playerSlug;
      // A second season of the same player is the same identity: trying it
      // again cannot change the outcome.
      if (used.has(slug) || tried.has(slug)) continue;
      tried.add(slug);
      used.add(slug);
      chosen[square] = i;
      if (assign(k + 1)) return true;
      used.delete(slug);
      chosen[square] = -1;
    }
    return false;
  };

  return assign(0) ? chosen : null;
}

/** The most distinct candidates a square is ever searched for: with nine
 *  squares, nine distinct options always leave one free. */
const MAX_NEEDED_PER_SQUARE = 9;
/** Searches in flight at once. Folded back in a fixed order, so the result
 *  does not depend on which response lands first. */
const BATCH = 8;

export interface SolvedCell {
  row: number;
  col: number;
  player_season: { player_slug: string };
  cell_score: { arena_points: number };
}

async function publicPlayerNames(request: APIRequestContext, apiBase: string): Promise<string[]> {
  const names: string[] = [];
  const urls = [
    ...["1y", "2y", "3y", "5y"].map((w) => `${apiBase}/api/v1/peaks?window=${w}&limit=1000`),
    `${apiBase}/api/v1/seasons?limit=1000`,
  ];
  for (const url of urls) {
    const response = await request.get(url);
    if (!response.ok()) continue;
    const { rows } = (await response.json()) as { rows: { player_name: string }[] };
    for (const row of rows) names.push(row.player_name);
  }
  return names;
}

async function availableFor(
  request: APIRequestContext,
  apiBase: string,
  date: string,
  name: string,
  square: number,
): Promise<Candidate[]> {
  const query = new URLSearchParams({
    q: name,
    date,
    row: String(Math.floor(square / 3)),
    col: String(square % 3),
    limit: "50",
  });
  const response = await request.get(`${apiBase}/api/v1/daily-grid/search?${query.toString()}`);
  if (!response.ok()) return [];
  const { results } = (await response.json()) as {
    results: { status: string; id: string; player_slug: string }[];
  };
  return results
    .filter((r) => r.status === "available")
    .map((r) => ({ playerSlug: r.player_slug, answerId: r.id }));
}

const solvedByDate = new Map<string, SolvedCell[]>();

/**
 * Nine locked, server-scored squares for `date`'s board.
 *
 * Cached per date for this worker: a board is a pure function of its date and
 * POST /answer is a stateless validation, so a second solve of the same board
 * can only reproduce the first.
 */
export async function solveDailyGridBoard(
  request: APIRequestContext,
  apiBase: string,
  date: string,
  probeNames: readonly string[],
): Promise<SolvedCell[]> {
  const cached = solvedByDate.get(date);
  if (cached) return structuredClone(cached);

  const candidates: Candidate[][] = Array.from({ length: 9 }, () => []);
  const seen: Set<string>[] = Array.from({ length: 9 }, () => new Set());
  const distinct = (square: number) => new Set(candidates[square].map((c) => c.playerSlug)).size;

  // SEARCH ONLY WHAT THE MATCHING NEEDS. Each square has its own cursor into
  // the name list and starts out wanting ONE candidate; only when the global
  // matching fails does every square ask for one more (up to nine). The
  // previous version searched every square until it had nine, and a rare
  // square with fewer than nine reachable answers then walked the whole list:
  // ~4,100 searches and ~66 s on the 2026-10-06 board.
  const names: string[] = [];
  const nameKeys = new Set<string>();
  const addNames = (list: readonly string[]) => {
    for (const name of list) {
      const key = name.toLowerCase();
      if (nameKeys.has(key)) continue;
      nameKeys.add(key);
      names.push(name);
    }
  };
  addNames(probeNames);
  let publicLoaded = false;
  const cursor = new Array<number>(9).fill(0);
  const needed = new Array<number>(9).fill(1);

  let assignment: number[] | null = null;
  for (;;) {
    const open = [...Array(9).keys()].filter((s) => distinct(s) < needed[s] && cursor[s] < names.length);
    if (open.length === 0 && !publicLoaded && [...Array(9).keys()].some((s) => distinct(s) < needed[s])) {
      publicLoaded = true;
      addNames(await publicPlayerNames(request, apiBase));
      continue;
    }
    if (open.length === 0) {
      if (candidates.every((list) => list.length > 0)) {
        assignment = assignDistinctPlayers(candidates);
        if (assignment !== null) break;
      }
      // Not solvable from what has been found: every square that can still
      // grow asks for one more distinct player.
      let grew = false;
      for (let s = 0; s < 9; s++) {
        if (needed[s] < MAX_NEEDED_PER_SQUARE && (cursor[s] < names.length || !publicLoaded)) {
          needed[s] = Math.max(needed[s], distinct(s)) + 1;
          grew = true;
        }
      }
      if (!grew) break;
      continue;
    }
    // Up to BATCH more names for each open square, in square-then-cursor order.
    const jobs: { square: number; name: string }[] = [];
    for (const square of open) {
      const end = Math.min(cursor[square] + BATCH, names.length);
      for (; cursor[square] < end; cursor[square]++) jobs.push({ square, name: names[cursor[square]] });
    }
    const results = await Promise.all(jobs.map((job) => availableFor(request, apiBase, date, job.name, job.square)));
    results.forEach((hits, k) => {
      const square = jobs[k].square;
      for (const hit of hits) {
        if (seen[square].has(hit.answerId)) continue;
        seen[square].add(hit.answerId);
        candidates[square].push(hit);
      }
    });
  }

  if (assignment === null) {
    const empty = [...Array(9).keys()].filter((s) => candidates[s].length === 0);
    throw new Error(
      `no nine-distinct-player assignment found for ${date} from ${names.length} candidate names` +
        (empty.length ? `; no candidate at all for squares ${empty.map((s) => `(${Math.floor(s / 3)}, ${s % 3})`).join(", ")}` : ""),
    );
  }

  // Lock in board order, exactly as a player filling the grid would: the
  // server re-checks each answer against the board AND the players used so far.
  const filled: SolvedCell[] = [];
  const used: string[] = [];
  for (let square = 0; square < 9; square++) {
    const row = Math.floor(square / 3);
    const col = square % 3;
    const pick = candidates[square][assignment[square]];
    const answer = await request.post(`${apiBase}/api/v1/daily-grid/answer`, {
      data: {
        date,
        row,
        col,
        answer_id: pick.answerId,
        used_player_slugs: used,
        filled_cells: filled.map((c) => [c.row, c.col]),
      },
    });
    const body = await answer.json();
    if (!body.valid) {
      throw new Error(`server refused ${pick.answerId} for square (${row}, ${col}) on ${date}: ${JSON.stringify(body)}`);
    }
    used.push(body.player_season.player_slug);
    filled.push({ row, col, player_season: body.player_season, cell_score: body.cell_score });
  }
  solvedByDate.set(date, filled);
  return structuredClone(filled);
}
