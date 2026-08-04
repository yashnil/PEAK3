/**
 * The Arena mode catalogue — PRESENTATION DATA, not behaviour.
 *
 * The lobby is mode-agnostic: it renders whatever the server says exists and
 * has no branch on a mode name anywhere. This file is the one place a mode's
 * human-facing details live, so adding a mode is a new entry here plus a route,
 * never an `if` in a component.
 *
 * WHO OWNS WHAT. The SERVER decides which modes exist -- `GET /arena/readiness`
 * returns `modes: [{id, seat_count}]` from the live registry, and a mode absent
 * from that list is not offered no matter what this file says. This file
 * supplies only the label, the blurb and where to send a player once a match
 * starts.
 *
 * SEAT COUNT IS THE SERVER'S, AND ONLY THE SERVER'S. This file briefly carried
 * a `seatCountHint`, because `readiness` published only mode ids and a lobby
 * that wants to say "2 players" BEFORE a match exists had nowhere else to read
 * it. That field's own comment said to delete it the moment the server
 * published a seat count. The server now does -- read from the same registered
 * mode object the matchmaker sizes matches from -- so the field is gone rather
 * than kept alongside. Two sources for one number is how they drift, and the
 * first symptom would have been a lobby advertising three seats for a two-seat
 * game.
 *
 * `MATCH PATH` IS THE ROUTE THAT MUST EXIST. `three_man_weave` published
 * `/arena/three-man-weave/<id>` here while the app only had
 * `/arena/three-man-weave?match=<id>`, so every created match navigated
 * straight into a Next.js 404 — matchmaking worked perfectly and the game was
 * unreachable. `arena-routes.test.ts` now asserts each `matchPath` against the
 * App Router directory tree, so the two cannot disagree again.
 */

import type { ArenaModeInfo } from "@/lib/arena-lobby-api";

export interface ArenaModeMeta {
  /** Must match the server's registered mode id exactly. */
  id: string;
  name: string;
  tagline: string;
  /** One sentence on what the game IS. Shown on the lobby card. */
  description: string;
  /** Approximate wall-clock length, for the card's fact row. */
  duration: string;
  /** "Multiplayer" / "Auction" — the badge that says what kind of game it is. */
  kindBadge: string;
  /** Where a live match of this mode is played. */
  matchPath: (matchId: string) => string;
  /** The rules a "How to play" disclosure lists, shortest first. */
  rules: readonly string[];
}

export const ARENA_MODES: readonly ArenaModeMeta[] = [
  {
    id: "three_man_weave",
    name: "Three-Man Weave",
    tagline: "Three drafters · six shared rolls",
    description:
      "Six rounds, one shared franchise and decade per round, and a snake order that reverses every time. Every name taken is gone for all three rosters.",
    duration: "10–15 min",
    kindBadge: "Multiplayer",
    matchPath: (matchId) => `/arena/three-man-weave/${matchId}`,
    rules: [
      "Three drafters share one board.",
      "Six rounds. Each opens a franchise × decade roll that every seat drafts from.",
      "The order snakes: A-B-C, then C-B-A, and back again.",
      "Six roster slots each — PG, SG, SF, PF, C and one bench.",
      "A player drafted by anyone is locked for everyone.",
      "A pick is scored on that player's best PEAK3 season anywhere in the drafted decade.",
      "The strongest lineup by PEAK3's own lineup rating wins.",
    ],
  },
  {
    id: "twenty_dollar",
    name: "The $20 Showdown",
    tagline: "Two bidders · $20 each",
    description:
      "One player at a time goes on the block. Bids alternate upward a dollar at a time, and the PEAK3 score stays hidden until the hammer falls.",
    duration: "8–12 min",
    kindBadge: "Auction",
    matchPath: (matchId) => `/arena/twenty-dollar/${matchId}`,
    rules: [
      "Two bidders, $20 each.",
      "One candidate is auctioned at a time; the opening bidder alternates every lot.",
      "With no bid standing you may open at $1 or pass. Once a bid stands, raise by at least $1 or pass.",
      "Passing removes you from that lot — the last bidder standing wins and pays their bid.",
      "Fill one player at each of PG, SG, SF, PF and C.",
      "Keep at least $1 for every slot you still have to fill.",
      "The player's PEAK3 score is hidden until the lot sells.",
      "The higher total of five career-best 1Y PEAK3 scores wins. Leftover money counts for nothing.",
    ],
  },
] as const;

/** A catalogued mode the server is currently serving, carrying the server's
 *  own seat count. There is no client-side default: a mode the server does not
 *  publish is not offerable, so there is never a seat count to guess. */
export interface OfferableMode extends ArenaModeMeta {
  seatCount: number;
}

export function modeMeta(modeId: string): ArenaModeMeta | undefined {
  return ARENA_MODES.find((m) => m.id === modeId);
}

/**
 * The modes actually offerable right now: registered on the server AND known
 * to this catalogue.
 *
 * The intersection is deliberate in both directions. A mode the server has not
 * registered cannot be started, so offering it would be a button that 404s. A
 * mode the server registered but this build has no entry for has no route to
 * send anyone to, so it is skipped rather than rendered as a blank card.
 */
export function offerableModes(
  serverModes: readonly ArenaModeInfo[],
): OfferableMode[] {
  return ARENA_MODES.flatMap((m) => {
    const live = serverModes.find((s) => s.id === m.id);
    return live ? [{ ...m, seatCount: live.seat_count }] : [];
  });
}

/** "3 players" / "2 players", from the server's own seat count. */
export function seatLabel(seatCount: number): string {
  return `${seatCount} player${seatCount === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// Entry paths
// ---------------------------------------------------------------------------

export type EntryPathId = "public_queue" | "private_room" | "practice";

export interface EntryPathMeta {
  id: EntryPathId;
  name: string;
  /** One short line. NOT a paragraph — the brief is explicit that obvious
   *  actions must not be explained at length. */
  description: string;
  /**
   * Whether a match started this way counts towards a rating.
   *
   * MIRRORED FROM THE DATABASE, NEVER DECIDED HERE. The schema enforces
   * `CHECK (rated = (entry_path = 'public_queue'))`, so this is a restatement
   * of a constraint the server owns, published so a player can see it BEFORE
   * committing rather than discovering afterwards that a match did not count.
   * Once a match exists, components read `view.rated` from the server.
   */
  rated: boolean;
}

export const ENTRY_PATHS: readonly EntryPathMeta[] = [
  {
    id: "public_queue",
    name: "Public match",
    description: "Find opponents. Bots fill any empty seat after 30 seconds.",
    rated: true,
  },
  {
    id: "private_room",
    name: "Private room",
    description: "Share a six-character code.",
    rated: false,
  },
  {
    id: "practice",
    name: "Play bots",
    description: "Start now against PEAK3 Bot.",
    rated: false,
  },
] as const;

export function entryPath(id: EntryPathId): EntryPathMeta {
  const found = ENTRY_PATHS.find((p) => p.id === id);
  if (!found) throw new Error(`unknown arena entry path ${id}`);
  return found;
}

/** The window the matchmaker holds out for humans, mirrored from
 *  `matchmaking.HUMAN_PREFERENCE_WINDOW` for display copy only. */
export const HUMAN_PREFERENCE_SECONDS = 30;

/** What the product calls the house opponent. Mirrors `bots.BOT_DISPLAY_NAME`;
 *  an implementation id must never reach a screen. */
export const BOT_DISPLAY_NAME = "PEAK3 Bot";
