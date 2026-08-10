/**
 * Client-side derivations for THREE-MAN WEAVE.
 *
 * The server is always authoritative. Everything here is a pure, UI-facing
 * reading of a projection the server already produced — never a source of
 * game-rule enforcement, which lives in the mode's reducer
 * (`apps/api/app/services/three_man_weave/mode.py`) and in the pure rules
 * package (`nba_peak/three_man_weave/`).
 *
 * TWO PRODUCT RULES ARE ENFORCED HERE RATHER THAN LEFT TO EACH COMPONENT,
 * because "every component remembered" is not a property a codebase can keep:
 *
 * 1. THE RANKING BASIS IS NAMED WHEREVER A WINNER IS DECLARED, AND THERE IS
 *    NO PROJECTED RECORD.
 *    The match is decided by the 82-0 model's LINEUP-QUALITY INDEX over the six
 *    drafted cards -- the weighted combination of talent, bench, position fit
 *    and coverage that its record projection is built from. It is deliberately
 *    NOT the mean of the six season scores (that mean is reported separately,
 *    labelled, and decides nothing: it cannot tell a correctly-placed lineup
 *    from a scrambled one). And it is deliberately NOT a win total: the 82-0
 *    record projection is calibrated for an eight-card roster, so no record is
 *    published here at all rather than one that reads as a claim.
 *    `rankingBasisLabel()` exists so the basis is stated rather than assumed.
 *
 * 2. AN UNSCOREABLE ROSTER HAS A REAL STATE, NOT A BLANK OR A ZERO.
 *    `ranking_score` is `null` — never 0.0 — when a roster could not be fully
 *    scored. The server refuses to fabricate that number and so does this
 *    layer: `scoreDisplay()` returns an explicit "cannot be ranked" state that
 *    a component must handle, rather than a string that happens to read "0".
 */
import type {
  ArenaResultView,
  ArenaSeatPublic,
  TmwCandidateFit,
  TmwCandidatePublic,
  TmwEdgeBand,
  TmwMatchView,
  TmwPick,
  TmwPlayer,
  TmwPublicState,
  TmwRoll,
  TmwRoster,
  TmwSlotType,
} from "@/types/three-man-weave";
import {
  TMW_BENCH_SLOTS,
  TMW_FITS_AFTER_REARRANGEMENT,
  TMW_FITS_NOW,
  TMW_NO_LEGAL_ARRANGEMENT,
  TMW_SLOT_LABELS,
  TMW_SLOT_TYPES,
  TMW_STARTER_SLOTS,
  TMW_TURN_PHASE_REVEAL,
} from "@/types/three-man-weave";

// ---------------------------------------------------------------------------
// Phase
// ---------------------------------------------------------------------------

export type TmwPhase = "waiting" | "revealing" | "picking" | "complete";

/**
 * IS THE FRANCHISE × DECADE CEREMONY RUNNING?
 *
 * Read from the server's own `turn_phase` and from nothing else. The ceremony
 * used to be a client `setTimeout` that the room tried to keep out of the way
 * of a server deadline already counting down; it is now a turn the server opens
 * and closes, so this is a question about state rather than about an animation
 * some client happens to be part-way through. That is what makes a reload
 * mid-ceremony resolve to the same answer everywhere.
 *
 * TRUE FOR EVERY SEAT, including the one that picks next: nobody drafts under
 * the ceremony, so there is no seat for which it is not running.
 */
export function isRevealing(match: TmwMatchView | null): boolean {
  return !!match && match.turn_phase === TMW_TURN_PHASE_REVEAL;
}

/** Map the server's state onto a phase the UI can switch on. */
export function phaseOf(match: TmwMatchView | null): TmwPhase {
  if (!match) return "waiting";
  const state = match.public_state;
  if (state?.is_complete || match.status === "completed") return "complete";
  if (match.status === "forming") return "waiting";
  // The roll exists during the reveal -- that is the point of the ceremony --
  // so the phase is read from the turn, not from the roll's absence.
  if (isRevealing(match)) return "revealing";
  if (!state?.current_roll) return "revealing";
  return "picking";
}

export function isYourTurn(match: TmwMatchView | null): boolean {
  if (!match || match.your_seat_index === null) return false;
  return match.current_turn_seat_index === match.your_seat_index;
}

/**
 * Can this seat act right now? The server's own `legal_commands` decides —
 * never a local re-derivation of the rules.
 *
 * WITH ONE SUBTRACTION THE SERVER CANNOT MAKE FOR US. `project` derives
 * `legal_commands` from the SNAPSHOT's `current_seat`, which during the reveal
 * already names the seat that picks next — so `tmw_pick` is advertised while
 * the ceremony is still running and the reducer would refuse it. The turn phase
 * is the authority on *when*, so it is applied here rather than at each of the
 * three call sites that ask this question.
 */
export function canPick(match: TmwMatchView | null): boolean {
  return !!match && !isRevealing(match) && match.legal_commands.includes("tmw_pick");
}

// ---------------------------------------------------------------------------
// Draft order
// ---------------------------------------------------------------------------

export interface TmwTurnSlot {
  roundNumber: number;
  seatIndex: number;
  /** Already played. */
  done: boolean;
  /** The turn currently being taken. */
  active: boolean;
}

/**
 * The full A-B-C / C-B-A snake, with each turn marked done / active / upcoming.
 *
 * Recomputed from `total_rounds`, `seat_count` and how many picks exist rather
 * than read from a server field, because the order is a fixed rule rather than
 * state. Odd rounds run forward, even rounds reversed — the fixed snake, not a
 * rotation; the residual seat advantage is intentional.
 */
export function turnOrder(state: TmwPublicState | null, seatCount = 3): TmwTurnSlot[] {
  if (!state) return [];
  const rounds = state.total_rounds ?? 0;
  const played = state.rosters.reduce(
    (total, roster) => total + Object.values(roster.slots).filter(Boolean).length,
    0,
  );
  const out: TmwTurnSlot[] = [];
  let index = 0;
  for (let round = 1; round <= rounds; round += 1) {
    const seats = Array.from({ length: seatCount }, (_, i) => i);
    const order = round % 2 === 1 ? seats : [...seats].reverse();
    for (const seatIndex of order) {
      out.push({
        roundNumber: round,
        seatIndex,
        done: index < played,
        active: index === played,
      });
      index += 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rosters
// ---------------------------------------------------------------------------

export function starterSlots(roster: TmwRoster): { slotType: TmwSlotType; pick: TmwPick | null }[] {
  return TMW_STARTER_SLOTS.map((slotType) => ({
    slotType,
    pick: roster.slots[slotType] ?? null,
  }));
}

export function benchSlots(roster: TmwRoster): { slotType: TmwSlotType; pick: TmwPick | null }[] {
  return TMW_BENCH_SLOTS.map((slotType) => ({
    slotType,
    pick: roster.slots[slotType] ?? null,
  }));
}

export function openSlots(roster: TmwRoster): TmwSlotType[] {
  return TMW_SLOT_TYPES.filter((slotType) => !roster.slots[slotType]);
}

export function filledCount(roster: TmwRoster): number {
  return TMW_SLOT_TYPES.filter((slotType) => !!roster.slots[slotType]).length;
}

/** Every pick made so far, newest first — the shared draft feed. */
export function pickFeed(state: TmwPublicState | null): TmwPick[] {
  if (!state) return [];
  const picks = state.rosters.flatMap((roster) =>
    TMW_SLOT_TYPES.map((slotType) => roster.slots[slotType]).filter(
      (pick): pick is TmwPick => !!pick,
    ),
  );
  return picks.sort(
    (a, b) => b.round_number - a.round_number || a.seat_index - b.seat_index,
  );
}

// ---------------------------------------------------------------------------
// The identity lock
// ---------------------------------------------------------------------------

export interface TmwLockEntry {
  playerSlug: string;
  playerName: string;
  seatIndex: number;
  roundNumber: number;
  franchiseDisplayName: string;
  decade: string;
}

/**
 * The global identity lock, as something a player can actually look at.
 *
 * The lock is on the PERSON, not the card: a Cavaliers-2000s LeBron blocks a
 * Heat-2010s LeBron. Surfacing it as a list of who is gone (and to whom) is
 * what makes that rule legible rather than something a player discovers by
 * having a pick refused.
 */
export function identityLock(state: TmwPublicState | null): TmwLockEntry[] {
  return pickFeed(state).map((pick) => ({
    playerSlug: pick.player_slug,
    playerName: pick.player_name,
    seatIndex: pick.seat_index,
    roundNumber: pick.round_number,
    franchiseDisplayName: pick.eligibility.franchise_display_name,
    decade: pick.decade,
  }));
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export interface TmwCandidate extends TmwCandidatePublic {
  /** The server's verdict for THIS seat. Never re-derived here — legality is
   * the reducer's, and a client that recomputed it would eventually disagree. */
  fit: TmwCandidateFit;
  /** Convenience: can this candidate be selected at all? */
  selectable: boolean;
}

/**
 * The current roll's candidates, annotated with this seat's fit verdict.
 *
 * ORDER IS THE SERVER'S, WHICH IS ALPHABETICAL BY SLUG. That is a product rule,
 * not an oversight. The list used to be sorted by `prime_score`, and sorting by
 * the number the match is decided on made the number visible whether or not it
 * was printed: the correct pick was always the top row. Three-Man Weave is a
 * game about knowing who these players were, so the list is ordered by nothing
 * the model knows — and `searchCandidates` reorders only by what the player
 * typed.
 *
 * NOTHING IS FILTERED OUT. A candidate this seat cannot use stays in the list,
 * marked and disabled with a reason. Hiding them would hide the roll.
 */
export function candidatesForSeat(match: TmwMatchView | null): TmwCandidate[] {
  const roll = match?.public_state?.current_roll;
  if (!roll) return [];
  const fits = match?.private_state?.candidate_fits ?? {};
  return roll.candidates.map((player) => {
    const fit: TmwCandidateFit = fits[player.player_slug] ?? {
      player_slug: player.player_slug,
      // Absent means this seat is not on the clock, so nothing is selectable
      // for it yet. Not an error, and not "illegal".
      state: TMW_NO_LEGAL_ARRANGEMENT,
      direct_slots: [],
      plan: null,
      moves: [],
      reason: null,
    };
    return {
      ...player,
      fit,
      selectable: fit.state !== TMW_NO_LEGAL_ARRANGEMENT,
    };
  });
}

/** Case- and accent-insensitive substring match on the displayed name.
 *
 * Search RE-ORDERS by relevance (prefix matches first) rather than by anything
 * the model knows, which is the one ordering the product allows. */
export function searchCandidates(
  candidates: TmwCandidate[],
  query: string,
): TmwCandidate[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return candidates;
  const scored = candidates
    .map((candidate) => {
      const name = candidate.player_name.toLowerCase();
      const index = name.indexOf(needle);
      const surname = name.split(" ").slice(1).join(" ");
      if (index < 0 && !surname.startsWith(needle)) return null;
      // 0 = the name starts with it, 1 = a later word does, 2 = anywhere.
      const rank = index === 0 ? 0 : surname.startsWith(needle) ? 1 : 2;
      return { candidate, rank };
    })
    .filter((entry): entry is { candidate: TmwCandidate; rank: number } => !!entry);
  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.candidate.player_name.localeCompare(b.candidate.player_name),
  );
  return scored.map((entry) => entry.candidate);
}

/** Keep only candidates who could land on one of `slots`.
 *
 * A FILTER NARROWS THE VIEW AND SAYS SO; it never becomes the pool. The caller
 * is expected to show the count it removed, because a player who cannot tell a
 * short list from an empty roll has been misled about the board. */
export function filterCandidatesByPosition(
  candidates: TmwCandidate[],
  slots: TmwSlotType[],
): TmwCandidate[] {
  if (!slots.length) return candidates;
  const wanted = new Set<string>(slots);
  return candidates.filter((candidate) => {
    if (candidate.fit.direct_slots.some((slot) => wanted.has(slot))) return true;
    const landing = landingSlot(candidate);
    return landing !== null && wanted.has(landing);
  });
}

/** Where this candidate would go if taken with no further choices made. */
export function landingSlot(candidate: TmwCandidate): TmwSlotType | null {
  if (candidate.fit.direct_slots.length) return candidate.fit.direct_slots[0];
  const plan = candidate.fit.plan;
  if (!plan) return null;
  const entry = Object.entries(plan).find(
    ([, slug]) => slug === candidate.player_slug,
  );
  return (entry?.[0] as TmwSlotType) ?? null;
}

/** The human sentence for a fit verdict. Authored once so every surface — the
 * list row, the overlay, the disabled tooltip — says the same thing. */
export function fitLabel(candidate: TmwCandidate): string {
  switch (candidate.fit.state) {
    case TMW_FITS_NOW:
      return "Fits now";
    case TMW_FITS_AFTER_REARRANGEMENT:
      return "Fits after rearrangement";
    default:
      return "No legal arrangement";
  }
}

/** A one-line description of what a plan actually moves, or null when nothing
 * moves. Built from `moves`, which the server already reduced to genuine
 * relocations — a player the plan leaves in place is not announced as moved. */
export function rearrangementSummary(
  candidate: TmwCandidate,
  nameOf: (slug: string) => string,
): string | null {
  const moves = candidate.fit.moves ?? [];
  if (!moves.length) return null;
  return moves
    .map(
      (move) =>
        `${nameOf(move.player_slug)} moves ${slotLabel(move.from_slot)} → ${slotLabel(move.to_slot)}`,
    )
    .join(", ");
}

export function slotLabel(slot: TmwSlotType | string): string {
  return TMW_SLOT_LABELS[slot as TmwSlotType] ?? String(slot);
}

/** Short slot chip text: "PG", "BN". */
export function slotAbbrev(slot: TmwSlotType | string): string {
  return slot === "bench_1" ? "BN" : String(slot);
}

// ---------------------------------------------------------------------------
// The live edge
// ---------------------------------------------------------------------------

/**
 * The band, as a phrase rather than a bare word.
 *
 * WHY NOT "LEADING" / "LEVEL". These render as a small uppercase label directly
 * above a roster court, and the review capture showed the result: a court
 * captioned "LEVEL", which reads as a level NUMBER rather than as a standing
 * against the other two seats. Every label now names what it is level with, so
 * it cannot be read as anything else.
 */
export const TMW_EDGE_LABELS: Record<TmwEdgeBand, string> = {
  leading: "Leading the field",
  close_behind: "Just behind",
  needs_a_response: "Needs a response",
  level: "Level with the field",
};

/**
 * The ordinal band for one seat, or null when there is nothing to say yet.
 *
 * NO NUMBER EVER CROSSES. The server deliberately publishes a band and not a
 * partial total, because a partial total is not on the same scale as the final
 * one (an unfinished roster scores an empty bench as zero rather than as
 * absent) and a player shown both would reasonably read them as comparable.
 */
export function edgeBandFor(
  state: TmwPublicState | null,
  seatIndex: number,
): TmwEdgeBand | null {
  const edge = state?.current_edge;
  if (!edge?.is_live) return null;
  return edge.seats?.[String(seatIndex)] ?? null;
}

/** "Live after 2 picks each" — the qualifier that keeps the band honest. */
export function edgeQualifier(state: TmwPublicState | null): string | null {
  const edge = state?.current_edge;
  if (!edge?.is_live || !edge.compared_after_picks) return null;
  const picks = edge.compared_after_picks;
  return `Live · compared after ${picks} pick${picks === 1 ? "" : "s"} each`;
}

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

export function seatLabel(
  seats: ArenaSeatPublic[],
  seatIndex: number,
): string {
  return (
    seats.find((seat) => seat.seat_index === seatIndex)?.display_name ??
    `Seat ${seatIndex + 1}`
  );
}

// ---------------------------------------------------------------------------
// Provenance: two facts, never one
// ---------------------------------------------------------------------------

/**
 * "Toronto Raptors · 2018-19" — the evidence that makes a pick legal.
 *
 * Deliberately a separate function from `scoringCardLine`. The two answer
 * different questions about different seasons, and a Shaq drafted on a 2000s
 * roll being scored on 2000-01 rather than his better 1999-00 reads as a bug
 * unless both are shown and labelled.
 */
export function eligibilityLine(player: TmwCandidatePublic): string {
  const { franchise_display_name, seasons } = player.eligibility;
  if (!seasons.length) return franchise_display_name;
  const span =
    seasons.length === 1
      ? seasons[0].season
      : `${seasons[0].season}–${seasons[seasons.length - 1].season}`;
  return `${franchise_display_name} · ${span}`;
}

/** "2018-19 Toronto Raptors · 1Y PEAK3 84.0" — what a DRAFTED pick is worth.
 *
 * Reachable only for a pick, because only a pick has a `scoring_card`. The
 * season named always belongs to the franchise that was rolled. */
export function scoringCardLine(player: TmwPlayer): string | null {
  const card = player.scoring_card;
  if (!card) return null;
  return `${card.season} ${card.team_name} · 1Y PEAK3 ${card.prime_score.toFixed(1)}`;
}

/** Did any eligibility season come from a mid-season trade?
 *
 * NO LONGER SURFACED AS A "via trade" CHIP. Every roster cell used to carry
 * one, and on a board where most stars have at least one traded season it was
 * repetitive to the point of being noise — it told a reader nothing they could
 * act on, because the team and season beside it already say where the card
 * comes from. Retained only for the traded-SCORE disclosure below, which is a
 * different and genuinely material claim: that the number is a whole-season
 * figure rather than a single-team one. */
export function hasTradedEvidence(player: TmwCandidatePublic): boolean {
  return player.eligibility.seasons.some((season) => season.via === "traded_team_stint");
}

/**
 * A note for a scoring card whose score exists only at whole-season aggregate
 * grain, or null when there is nothing to disclose.
 *
 * About 5% of scoring cards are this shape. The number is real and complete —
 * an aggregate IS the season — but it is not a single-team figure, so it is
 * labelled rather than presented as one.
 */
export function scoreSourceNote(player: TmwPlayer): string | null {
  const card = player.scoring_card;
  if (!card || !card.is_multi_team_season) return null;
  return "Traded that season — PEAK3 scores the full season, not one team's share.";
}

// ---------------------------------------------------------------------------
// Ranking: the basis is named, and "unscoreable" is a real state
// ---------------------------------------------------------------------------

export const RANKING_BASIS_LABEL = "PEAK3 lineup score";

/** The sentence that must appear wherever a winner is declared.
 *
 * It names the evaluator and what it weighs, because "lineup score" alone
 * invites the reader to assume it is an average of the six numbers on screen —
 * which is exactly what it is not, and what it used to be. */
export function rankingBasisLabel(): string {
  return (
    `Ranked on ${RANKING_BASIS_LABEL} — the 82-0 model's lineup-quality index ` +
    "over these six seasons, weighing starter talent, bench, position fit and coverage. " +
    "Not an average of the six scores."
  );
}

export type TmwScoreDisplay =
  | { kind: "scored"; value: number; text: string }
  | { kind: "unrankable"; text: string; reason: string };

/**
 * How to render one roster's comparison value.
 *
 * Returns a discriminated union rather than a string so a component CANNOT
 * accidentally render an unscoreable roster as "0.0" — it has to handle the
 * `unrankable` case to compile. The server already refuses to fabricate the
 * number; this makes it equally hard for the UI to fabricate it.
 */
export function scoreDisplay(
  score: number | null | undefined,
  scoreStatus?: string,
  unscoredSlots: string[] = [],
): TmwScoreDisplay {
  if (typeof score === "number" && scoreStatus !== "incomplete") {
    return { kind: "scored", value: score, text: score.toFixed(1) };
  }
  const slots = unscoredSlots.length ? ` (${unscoredSlots.join(", ")})` : "";
  return {
    kind: "unrankable",
    text: "Not ranked",
    reason: `This roster could not be fully scored${slots}, so it has no comparable ${RANKING_BASIS_LABEL}.`,
  };
}

export interface TmwPodiumRow {
  result: ArenaResultView;
  score: TmwScoreDisplay;
  /** The mean of the six drafted seasons. Reported, labelled, and never the
   * basis — see this module's rule 1. */
  meanSeasonScore: number | null;
  /** True when this row shares its placement with another — a real tie, not a
   * near miss. */
  tied: boolean;
}

/**
 * The final podium, in the server's own placement order.
 *
 * Placements come from the server and use standard competition ranking with
 * ties sharing a placement (1/1/1 then 4). This never re-ranks — it only
 * marks which rows are genuinely tied so the surface can say "draw" rather
 * than implying an order the data does not have.
 */
export function podium(results: ArenaResultView[]): TmwPodiumRow[] {
  const counts = new Map<number, number>();
  for (const result of results) {
    counts.set(result.placement, (counts.get(result.placement) ?? 0) + 1);
  }
  return [...results]
    .sort((a, b) => a.placement - b.placement || a.seat_index - b.seat_index)
    .map((result) => ({
      result,
      score: scoreDisplay(
        result.detail?.score_status === "incomplete" ? null : result.score,
        result.detail?.score_status,
      ),
      meanSeasonScore: result.detail?.mean_season_score ?? null,
      tied: (counts.get(result.placement) ?? 0) > 1,
    }));
}

/** "Seat 2 wins" / "A three-way draw" — the headline, on the ranking basis. */
export function outcomeHeadline(rows: TmwPodiumRow[]): string {
  const leaders = rows.filter((row) => row.result.placement === 1);
  if (!leaders.length) return "No result";
  if (leaders.length === 1) return `${leaders[0].result.display_name} wins`;
  if (leaders.length === rows.length) return "A three-way draw";
  return `${leaders.map((row) => row.result.display_name).join(" and ")} draw for first`;
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

export type TmwConnection = "live" | "reconnecting" | "offline";

/**
 * How to describe the client's own connection.
 *
 * Separate from the match's status because they fail differently: a match can
 * be perfectly healthy while this browser cannot reach it, and telling a player
 * "your move was refused" when the truth is "we could not ask" is the wrong
 * sentence. `consecutiveFailures` is the caller's count of failed polls.
 */
export function connectionState(consecutiveFailures: number): TmwConnection {
  if (consecutiveFailures === 0) return "live";
  if (consecutiveFailures < 3) return "reconnecting";
  return "offline";
}

export function rollHeadline(roll: TmwRoll | null): string {
  if (!roll) return "Rolling…";
  return `${roll.franchise_display_name} · ${roll.decade}`;
}

// ---------------------------------------------------------------------------
// Seat identity
// ---------------------------------------------------------------------------

/**
 * WHICH OF THE THREE SEAT ACCENTS THIS SEAT WEARS.
 *
 * All three courts used to be painted in the single brand gold and were told
 * apart by a capital letter in the corner, which is the weakest possible
 * identity signal on a screen whose whole job is "three competing teams". The
 * palette (`--seat-1-*` gold, `--seat-2-*` blue, `--seat-3-*` emerald) is
 * defined once in globals.css with per-theme inks, and this is the only place
 * a seat index turns into one of them — so the court, the tab, the turn status
 * and the result card cannot disagree about which colour a seat is.
 *
 * Returned as the token SUFFIX rather than a `var(...)` string so a caller can
 * build `--seat-N-fill` or `--seat-N-ink` from it, and so it can also be
 * written to the DOM as `data-seat-accent` for the stylesheet to key off.
 */
export function seatAccent(seatIndex: number): "1" | "2" | "3" {
  return (["1", "2", "3"] as const)[((seatIndex % 3) + 3) % 3];
}

// ---------------------------------------------------------------------------
// The one turn-status line
// ---------------------------------------------------------------------------

/**
 * Whose pick it is, in words that need no legend.
 *
 * ONE SURFACE READS THIS, NOT THREE. The room used to stack a spinner banner, a
 * "X is selecting" band and a "X is scouting / X drafted" tray, all describing
 * the same fact in three different registers a few pixels apart. This sentence
 * is the single source for the turn-status region; nothing else restates it.
 *
 * Moved here from the deleted `BotPickReveal` so that deleting a component
 * could not delete the copy rule with it.
 */
export function turnHeadline(
  seats: ArenaSeatPublic[],
  currentTurnSeatIndex: number | null,
  yourSeatIndex: number | null,
  complete: boolean,
): string {
  if (complete) return "Draft complete";
  if (currentTurnSeatIndex === null) return "Rolling the next franchise and decade";
  if (currentTurnSeatIndex === yourSeatIndex) return "Your pick";
  return `${seatLabel(seats, currentTurnSeatIndex)} is on the clock`;
}

/** "The Spark selected Bradley Beal" — the brief post-pick beat, same surface. */
export function pickedHeadline(
  seats: ArenaSeatPublic[],
  pick: TmwPick,
  yourSeatIndex: number | null,
): string {
  const who =
    pick.seat_index === yourSeatIndex
      ? "You drafted"
      : `${seatLabel(seats, pick.seat_index)} selected`;
  return `${who} ${pick.player_name}`;
}

// ---------------------------------------------------------------------------
// What running out of time actually does (TMW-01, UI half)
// ---------------------------------------------------------------------------

/**
 * WHAT EXPIRY WILL DO, said before it happens.
 *
 * The overlay used to promise "Timeout drafts the best available player for
 * you", which was both false and an instruction to exploit it: a player who
 * knew nothing about the roll did strictly better by not clicking. The server
 * policy now draws deterministically from the LOWER-VALUE half of the legal,
 * completability-preserving pool, so the copy must never say "best available"
 * and must make inaction the worse option in plain words.
 *
 * Authored once, here, because it is printed by both the turn-status clock and
 * the pick surface's clock and they must not drift.
 */
export const TMW_TIMEOUT_CONSEQUENCE =
  "Running out drafts a weaker legal fallback for you.";

/** The locked state shown WHILE the server resolves an expired turn. */
export const TMW_TIMEOUT_RESOLVING = "Time expired — assigning a legal fallback.";

// ---------------------------------------------------------------------------
// Rearrangement legality (TMW-10)
// ---------------------------------------------------------------------------

/**
 * MAY THIS EXACT PLAYER-SEASON OCCUPY THIS EXACT SLOT?
 *
 * `positions` is the model's own canonical starter-position list, published on
 * every pick payload, and the bench accepts any drafted player. There is no
 * "someone else can move, therefore this player can go anywhere" rule here and
 * there must never be one — see TMW-02. Every edge a drag, a click or a
 * keyboard move can produce is checked against this single predicate, and the
 * server re-validates the complete final assignment regardless.
 */
export function slotAcceptsPick(slotType: TmwSlotType, pick: TmwPick): boolean {
  if (slotType === "bench_1") return true;
  return (pick.positions ?? []).includes(slotType);
}

/**
 * Why this move is illegal, or null when it is legal.
 *
 * BOTH HALVES OF A SWAP ARE CHECKED. Dropping onto an occupied slot moves two
 * players, and validating only the one being dragged is exactly how a
 * Westbrook-at-SF assignment gets created by an interaction that looked
 * careful. The returned string is the message the surface shows immediately on
 * rejection — it names the player and the rule, never "invalid move".
 */
export function moveRejection(
  roster: TmwRoster | null,
  from: TmwSlotType,
  to: TmwSlotType,
): string | null {
  if (!roster) return "That roster is not yours to move.";
  if (from === to) return null;
  const moving = roster.slots[from] ?? null;
  if (!moving) return "That slot is empty.";
  if (!slotAcceptsPick(to, moving)) {
    return `${moving.player_name} plays ${positionsLine(moving)} — not ${slotLabel(to).toLowerCase()}.`;
  }
  const displaced = roster.slots[to] ?? null;
  if (displaced && !slotAcceptsPick(from, displaced)) {
    return `Swapping would put ${displaced.player_name} at ${slotLabel(from).toLowerCase()}, which they do not play.`;
  }
  return null;
}

/** Every slot this occupant may legally move to right now. */
export function legalMoveTargets(
  roster: TmwRoster | null,
  from: TmwSlotType,
): TmwSlotType[] {
  if (!roster || !roster.slots[from]) return [];
  return TMW_SLOT_TYPES.filter(
    (slot) => slot !== from && moveRejection(roster, from, slot) === null,
  );
}

/**
 * The COMPLETE final assignment after a move or swap — the only shape the
 * server's `tmw_rearrange` command accepts, and the reason no half-move can
 * exist even if a request is retried.
 */
export function placementsAfterMove(
  roster: TmwRoster,
  from: TmwSlotType,
  to: TmwSlotType,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const slotType of TMW_SLOT_TYPES) {
    const occupant = roster.slots[slotType];
    if (occupant) out[slotType] = occupant.player_slug;
  }
  const moving = roster.slots[from];
  const displaced = roster.slots[to] ?? null;
  if (!moving) return out;
  out[to] = moving.player_slug;
  if (displaced) out[from] = displaced.player_slug;
  else delete out[from];
  return out;
}

/** "SF / PF", or "no listed position" — used in rejection copy and on cards. */
export function positionsLine(player: TmwCandidatePublic): string {
  const positions = player.positions ?? [];
  return positions.length ? positions.join(" / ") : "no listed position";
}

// ---------------------------------------------------------------------------
// Why a name is not in the pool (TMW-11)
// ---------------------------------------------------------------------------

/**
 * The drafted-but-locked identities whose NAME matches a search.
 *
 * THE DENNIS RODMAN REPORT WAS A UI DEFECT, NOT A MISSING PLAYER. The lock is
 * global: a Rodman taken off a Pistons roll is gone from a later Spurs roll,
 * and the empty state said only "No eligible player matches that search" — the
 * same sentence it printed for a position filter and for genuine ineligibility.
 * The client already receives `drafted_identities` and the full pick feed, so
 * it can name the seat and the round instead of implying the pool is broken.
 */
export function lockedMatches(
  entries: TmwLockEntry[],
  query: string,
): TmwLockEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return entries.filter((entry) => entry.playerName.toLowerCase().includes(needle));
}

/** Why the candidate list is showing nothing. Three genuinely different facts. */
export type TmwEmptyReason =
  | { kind: "locked"; entries: TmwLockEntry[] }
  | { kind: "filtered"; hidden: number }
  | { kind: "not_eligible"; query: string }
  | { kind: "no_pool" };

export function emptyPoolReason(input: {
  poolSize: number;
  hiddenByFilter: number;
  query: string;
  locked: TmwLockEntry[];
}): TmwEmptyReason {
  if (input.locked.length) return { kind: "locked", entries: input.locked };
  if (input.hiddenByFilter > 0) return { kind: "filtered", hidden: input.hiddenByFilter };
  if (input.query.trim()) return { kind: "not_eligible", query: input.query.trim() };
  if (input.poolSize === 0) return { kind: "no_pool" };
  return { kind: "not_eligible", query: "" };
}

// ---------------------------------------------------------------------------
// The result response bank (TMW-14)
// ---------------------------------------------------------------------------

export type TmwResultBand =
  | "won_clear"
  | "won_close"
  | "drawn"
  | "close_loss"
  | "clear_loss"
  | "unknown";

/** Lineup-score gap, in points, below which a result counts as close. */
const CLOSE_MARGIN = 2.0;

/**
 * How this match ENDED, for the human — placement plus how near it was.
 *
 * Derived from the server's own placements and scores; nothing is re-ranked and
 * no number is invented. A roster that could not be scored yields "unknown"
 * rather than a fabricated margin.
 */
export function resultBand(
  rows: TmwPodiumRow[],
  yourSeatIndex: number | null,
): TmwResultBand {
  const yours = rows.find((row) => row.result.seat_index === yourSeatIndex) ?? null;
  if (!yours) return "unknown";
  if (yours.tied && yours.result.placement === 1) return "drawn";
  const scored = rows.filter((row) => row.score.kind === "scored");
  const best = scored.length
    ? Math.max(...scored.map((row) => (row.score.kind === "scored" ? row.score.value : 0)))
    : null;
  if (yours.score.kind !== "scored" || best === null) {
    return yours.result.placement === 1 ? "won_clear" : "clear_loss";
  }
  if (yours.result.placement === 1) {
    const runnerUp = scored
      .filter((row) => row.result.seat_index !== yours.result.seat_index)
      .map((row) => (row.score.kind === "scored" ? row.score.value : 0))
      .sort((a, b) => b - a)[0];
    if (runnerUp === undefined) return "won_clear";
    return yours.score.value - runnerUp <= CLOSE_MARGIN ? "won_close" : "won_clear";
  }
  return best - yours.score.value <= CLOSE_MARGIN ? "close_loss" : "clear_loss";
}

/**
 * The celebration line, per band.
 *
 * TASTEFUL AND FINITE. TMW-14 rejects the robotic "You finished 3rd" and also
 * rejects overdone slang, so the bank is short, plain and written for a
 * basketball room rather than a scoreboard. Nothing here is generated.
 */
const RESULT_LINES: Record<Exclude<TmwResultBand, "unknown">, readonly string[]> = {
  won_clear: ["That's the board.", "You took the room.", "Built different.", "Never in doubt."],
  won_close: ["Won it by a hair.", "You held on.", "Close one. Yours.", "Held the room."],
  drawn: ["Dead level.", "Nothing between you.", "Split the room."],
  close_loss: ["One pick away.", "That was close.", "Run it back.", "So near."],
  clear_loss: [
    "The room got you this time.",
    "Better luck next draft.",
    "They out-drafted you.",
    "Not your night.",
  ],
};

/**
 * A deterministic line from the bank.
 *
 * DETERMINISTIC PER COMPLETED MATCH, not random per render: a hero line that
 * changed on every poll or resize would read as a glitch, and a screen reader
 * would re-announce it. `seed` should be the match id, so repeat plays vary and
 * a reload of the SAME result says the same thing.
 */
export function resultLine(band: TmwResultBand, seed: string): string {
  if (band === "unknown") return "Match complete.";
  const bank = RESULT_LINES[band];
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return bank[Math.abs(hash) % bank.length];
}

/** "1st" / "2nd" / "3rd". */
export function ordinal(value: number): string {
  const suffix = value === 1 ? "st" : value === 2 ? "nd" : value === 3 ? "rd" : "th";
  return `${value}${suffix}`;
}
