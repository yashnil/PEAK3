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
 */

import type { ArenaModeInfo } from "@/lib/arena-lobby-api";

export interface ArenaModeMeta {
  /** Must match the server's registered mode id exactly. */
  id: string;
  name: string;
  tagline: string;
  description: string;
  /** Where a live match of this mode is played. */
  matchPath: (matchId: string) => string;
}

export const ARENA_MODES: readonly ArenaModeMeta[] = [
  {
    id: "twenty_dollar",
    name: "The $20 Showdown",
    tagline: "Two players · sealed bids · $20",
    description:
      "One player at a time comes up for auction. You each bid in secret; the higher bid wins and pays. Build a legal PG–C starting five for twenty dollars.",
    matchPath: (matchId) => `/arena/twenty-dollar/${matchId}`,
  },
  {
    id: "three_man_weave",
    name: "Three-Man Weave",
    tagline: "Three players · snake draft",
    description:
      "A three-way draft across franchises and decades. Every pick narrows what the next player can take.",
    matchPath: (matchId) => `/arena/three-man-weave/${matchId}`,
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

// ---------------------------------------------------------------------------
// Entry paths
// ---------------------------------------------------------------------------

export type EntryPathId = "public_queue" | "private_room" | "practice";

export interface EntryPathMeta {
  id: EntryPathId;
  name: string;
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
  /** What the player needs to know before choosing. */
  note: string;
}

export const ENTRY_PATHS: readonly EntryPathMeta[] = [
  {
    id: "public_queue",
    name: "Public match",
    description: "Play a stranger. We look for a human first.",
    rated: true,
    note:
      "Rated. We hold out for a human opponent for 30 seconds; after that the remaining seats are filled with bots and the match still counts.",
  },
  {
    id: "private_room",
    name: "Private game",
    description: "Play someone you know with a six-character code.",
    rated: false,
    note:
      "Unrated. A private room is never filled automatically — it starts the moment every seat is taken.",
  },
  {
    id: "practice",
    name: "Play bots",
    description: "Start immediately against the house bot.",
    rated: false,
    note: "Unrated. Starts straight away.",
  },
] as const;

/** The window the matchmaker holds out for humans, mirrored from
 *  `matchmaking.HUMAN_PREFERENCE_WINDOW` for display copy only. */
export const HUMAN_PREFERENCE_SECONDS = 30;
