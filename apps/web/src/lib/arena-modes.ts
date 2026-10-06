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

/**
 * What a bot seat is called when nothing more specific is available. Mirrors
 * `bots.BOT_DISPLAY_NAME` -- an implementation id must never reach a screen.
 *
 * EMERGENCY FALLBACK ONLY. Every seat a real match deals gets its own
 * memorable name from the server (`bots.curated_bot_names` for most modes,
 * Three-Man Weave's own archetypes for its draft) via `ArenaSeatPublic
 * .display_name`, which is what components should read. This constant exists
 * for the one case a seat's name is genuinely unavailable client-side (a
 * lookup miss, not the normal path), so an opponent is never rendered with no
 * name at all.
 */
export const BOT_DISPLAY_NAME = "PEAK3 Opponent";

/**
 * Mode-neutral prose for copy that talks ABOUT bot opponents in general,
 * without naming any specific seat -- entry-path descriptions, capability
 * banners, disabled-state reasons. Used to be six independent hardcoded
 * literals that had to be kept in sync by hand; now there is one place this
 * wording lives.
 */
export const BOT_OPPONENT_COPY = "a bot opponent";

/** Same idea as `BOT_OPPONENT_COPY`, shaped as a noun for copy that names the
 *  practice entry path itself rather than describing an opponent (e.g. "public
 *  matchmaking, private rooms and bot practice"). */
export const BOT_PRACTICE_LABEL = "bot practice";

export interface ArenaModeMeta {
  /** Must match the server's registered mode id exactly. */
  id: string;
  name: string;
  tagline: string;
  /** One sentence on what the game IS. Shown on the lobby card. */
  description: string;
  /** Approximate wall-clock length, for the card's fact row. */
  duration: string;
  /** The AUTHORED menu-sized one-liner (<= 8 words) for compact tiles such as
   *  the homepage's. Optional: a mode without one falls back to `description`. */
  blurb?: string;
  /** "Multiplayer" / "Auction" — the badge that says what kind of game it is. */
  kindBadge: string;
  /** Where a live match of this mode is played. */
  matchPath: (matchId: string) => string;
  /** The rules a "How to play" disclosure lists, shortest first. */
  rules: readonly string[];
  /** A ruleset of another mode, played in that mode's room (and so at its
   *  route). Franchise Draft and Decade Draft are Three-Man Weave with one
   *  constraint for the whole draft -- the same room, not a new game. */
  variantOf?: string;
  /** The ruleset's short name INSIDE its family ("Classic", "Franchise
   *  Draft"), for surfaces that already name the family above it. */
  variantLabel?: string;
  /** One menu-sized line (<= 8 words) saying how this ruleset differs. */
  variantSummary?: string;
  /** Set on a family's parent: how the family introduces itself when it is
   *  shown as one game with several rulesets rather than as one ruleset. */
  family?: {
    tagline: string;
    description: string;
  };
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
    variantLabel: "Classic",
    variantSummary: "A new franchise × decade every round",
    family: {
      tagline: "Three drafters · three ways to draft",
      description:
        "A three-seat snake draft for the six-man lineup PEAK3 rates highest. Every name taken is gone for everyone — the format decides how the pool is drawn.",
    },
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
    id: "three_man_weave_franchise",
    name: "Three-Man Weave: Franchise Draft",
    tagline: "One franchise · all 18 picks",
    description:
      "One franchise is spun before the first pick, and every pick in the match comes from its history. Everyone fights over the same pool, so the skill is building the best six before your rivals take them.",
    duration: "8–12 min",
    kindBadge: "Multiplayer",
    matchPath: (matchId) => `/arena/three-man-weave/${matchId}`,
    variantOf: "three_man_weave",
    variantLabel: "Franchise Draft",
    variantSummary: "One franchise for all 18 picks",
    rules: [
      "Three drafters, one franchise, drawn once before round one.",
      "All eighteen picks come from that franchise's players, in any decade.",
      "The order snakes: A-B-C, then C-B-A, and back again.",
      "Six roster slots each — PG, SG, SF, PF, C and one bench.",
      "A player drafted by anyone is locked for everyone.",
      "A pick is scored on that player's best PEAK3 season with the franchise.",
      "No pick may leave any roster unable to finish; the board marks those players.",
      "The strongest lineup by PEAK3's own lineup rating wins.",
    ],
  },
  {
    id: "three_man_weave_decade",
    name: "Three-Man Weave: Decade Draft",
    tagline: "One decade · all 18 picks",
    description:
      "One decade is spun before the first pick, and every pick in the match comes from it, from any franchise. A deep, shared pool — and the best players in it go early.",
    duration: "8–12 min",
    kindBadge: "Multiplayer",
    matchPath: (matchId) => `/arena/three-man-weave/${matchId}`,
    variantOf: "three_man_weave",
    variantLabel: "Decade Draft",
    variantSummary: "One decade for all 18 picks",
    rules: [
      "Three drafters, one decade, drawn once before round one.",
      "All eighteen picks come from players of that decade, on any franchise.",
      "The order snakes: A-B-C, then C-B-A, and back again.",
      "Six roster slots each — PG, SG, SF, PF, C and one bench.",
      "A player drafted by anyone is locked for everyone.",
      "A pick is scored on that player's best PEAK3 season in the decade.",
      "No pick may leave any roster unable to finish; the board marks those players.",
      "The strongest lineup by PEAK3's own lineup rating wins.",
    ],
  },
  {
    id: "shared_draft",
    name: "Shared Draft",
    tagline: "Two drafters · one board",
    blurb: "Two drafters, one board of last season's players",
    description:
      "Twelve players from the latest completed NBA season on one shared board. Draft five, one at each position — every player you take is one your opponent can't.",
    duration: "3–6 min",
    kindBadge: "Draft",
    matchPath: (matchId) => `/arena/shared-draft/${matchId}`,
    rules: [
      "Two drafters, one board of twelve players from the latest completed season: two or three at every position.",
      "Snake order: one pick, then two each way, until both rosters have five.",
      "Fill one player at each of PG, SG, SF, PF and C. A drafted player is gone for the other side.",
      "Each card is the player's best completed 1-year PEAK3 season; scores stay hidden until the tenth pick.",
      "If your clock runs out, the first open player in board order is drafted for you.",
      "The higher roster total of five PEAK3 scores wins.",
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
  {
    id: "prime_cut",
    name: "Prime Cut",
    tagline: "Four players · three heats",
    blurb: "Eight peaks a heat, keep four",
    description:
      "Eight multi-year peaks arrive one at a time. Keep the four you think were greatest and cut the rest — every call is final, and you never see what is coming next.",
    duration: "3–6 min",
    kindBadge: "Multiplayer",
    matchPath: (matchId) => `/arena/prime-cut/${matchId}`,
    rules: [
      "Three heats: 2-year peaks, then 3-year, then 5-year.",
      "Each heat deals eight peaks, one at a time. Keep exactly four and cut exactly four.",
      "Calls lock immediately. Once your four keeps are used, every remaining card is cut, and the other way round.",
      "Every seat sees the same cards in the same order at the same time.",
      "A heat scores how much of its best possible four you kept, from 0 to 100.",
      "Your match score is the average of the three heats. PEAK3 scores stay hidden until a heat ends.",
    ],
  },
  {
    id: "find_the_prime",
    name: "Find the Prime",
    tagline: "Four players · nine careers",
    blurb: "Pick the stretch PEAK3 rates highest",
    description:
      "One player, one peak length, one career timeline. Pick the stretch PEAK3 rates highest — the closer your window, the more points you earn.",
    duration: "3–5 min",
    kindBadge: "Multiplayer",
    matchPath: (matchId) => `/arena/find-the-prime/${matchId}`,
    rules: [
      "Nine rounds: three 2-year, three 3-year and three 5-year windows, in a shuffled order.",
      "Each round shows a player's career seasons. Choose a contiguous window of the required length.",
      "Lock before the clock runs out. A window you placed but did not lock is locked for you; no window scores nothing.",
      "Up to 100 points a round: PEAK3's highest-rated window, or one it rates as effectively tied, earns all 100.",
      "A nearby window with a close score still earns most of the points.",
      "Highest total out of 900 wins.",
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

// ---------------------------------------------------------------------------
// Families: one game, several rulesets
// ---------------------------------------------------------------------------

/**
 * A game as a player chooses it: one family, and the rulesets it is played
 * under. A mode with no `variantOf` and no variants is a family of one.
 *
 * WHY THIS EXISTS. Franchise Draft and Decade Draft used to render as two more
 * sibling cards beside Three-Man Weave, so the lobby read as three unrelated
 * games instead of one game with three ways to draft. Every surface that lists
 * games (lobby, Play menu, hub) now groups through this, from `variantOf`
 * alone -- no surface names a mode id.
 */
export interface ModeFamily<T extends ArenaModeMeta = ArenaModeMeta> {
  /** The parent mode's id, whether or not the parent itself is in `variants`. */
  id: string;
  /** The parent's name ("Three-Man Weave"). */
  name: string;
  /** The parent's catalogue entry, when this build knows it. */
  parent: ArenaModeMeta | undefined;
  /** The family's rulesets present in the input, parent first, then the
   *  variants in catalogue order. Never empty. */
  variants: T[];
}

/** The family id a mode belongs to. */
export function familyIdOf(mode: Pick<ArenaModeMeta, "id" | "variantOf">): string {
  return mode.variantOf ?? mode.id;
}

/**
 * Groups `modes` into families, in the order each family first appears.
 *
 * Only what is in `modes` is kept: pass the offerable list and a ruleset the
 * server does not serve simply is not a variant here. A family whose parent is
 * not offerable but whose variants are still forms (named after the parent).
 */
export function groupModeFamilies<T extends ArenaModeMeta>(modes: readonly T[]): ModeFamily<T>[] {
  const order: string[] = [];
  const members = new Map<string, T[]>();
  for (const mode of modes) {
    const id = familyIdOf(mode);
    if (!members.has(id)) {
      order.push(id);
      members.set(id, []);
    }
    members.get(id)!.push(mode);
  }
  return order.map((id) => {
    const parent = modeMeta(id);
    const list = members.get(id)!;
    // Parent first, then catalogue order (which `modes` already follows).
    list.sort((a, b) => Number(Boolean(a.variantOf)) - Number(Boolean(b.variantOf)));
    return { id, name: parent?.name ?? list[0].name, parent, variants: list };
  });
}

/** Every catalogued ruleset of a family, parent first. A mode with no
 *  variants returns just itself; an unknown id returns nothing. */
export function familyRulesets(familyId: string): ArenaModeMeta[] {
  return groupModeFamilies(ARENA_MODES.filter((m) => familyIdOf(m) === familyId))[0]?.variants ?? [];
}

/** A ruleset's name inside its family, falling back to its full name. */
export function variantLabelOf(mode: ArenaModeMeta): string {
  return mode.variantLabel ?? mode.name;
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
    // USER-FACING NAME, and deliberately not the id. "Private room" described
    // the mechanism (a room, with a code) rather than the reason anyone would
    // use it. The id stays `private_room` because it is a stored value on
    // `arena_matches.entry_path`; only the label moved.
    name: "Play With Friends",
    description: "Share a six-character code.",
    rated: false,
  },
  {
    id: "practice",
    name: "Play bots",
    description: `Start now against ${BOT_OPPONENT_COPY}.`,
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
