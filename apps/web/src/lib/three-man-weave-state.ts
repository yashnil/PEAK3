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
 * 1. THE RANKING BASIS IS THE PEAK SCORE, AND THE RECORD IS FLAVOUR.
 *    `lineup_peak_score` decides the match; the 82-game record is decoration.
 *    They disagree about the winner in roughly one match in five (measured
 *    over 40 seeded matches), so a surface that leads with the record would
 *    routinely show a 71-11 roster losing to a 64-18 one with no explanation.
 *    `rankingBasisLabel()` exists so the basis is NAMED wherever a winner is
 *    declared, and `recordLine()` returns the record already marked as the
 *    subordinate line.
 *
 * 2. AN UNSCOREABLE ROSTER HAS A REAL STATE, NOT A BLANK OR A ZERO.
 *    `ranking_score` is `null` — never 0.0 — when a roster could not be fully
 *    scored. The server refuses to fabricate that number and so does this
 *    layer: `scoreDisplay()` returns an explicit "cannot be ranked" state that
 *    a component must handle, rather than a string that happens to read "0".
 */
import type {
  ArenaResultView,
  TmwMatchView,
  TmwPick,
  TmwPlayer,
  TmwPublicState,
  TmwRoll,
  TmwRoster,
  TmwSlotType,
} from "@/types/three-man-weave";
import { TMW_BENCH_SLOTS, TMW_SLOT_TYPES, TMW_STARTER_SLOTS } from "@/types/three-man-weave";

// ---------------------------------------------------------------------------
// Phase
// ---------------------------------------------------------------------------

export type TmwPhase = "waiting" | "revealing" | "picking" | "complete";

/** Map the server's state onto a phase the UI can switch on. */
export function phaseOf(match: TmwMatchView | null): TmwPhase {
  if (!match) return "waiting";
  const state = match.public_state;
  if (state?.is_complete || match.status === "completed") return "complete";
  if (match.status === "forming") return "waiting";
  if (!state?.current_roll) return "revealing";
  return "picking";
}

export function isYourTurn(match: TmwMatchView | null): boolean {
  if (!match || match.your_seat_index === null) return false;
  return match.current_turn_seat_index === match.your_seat_index;
}

/** Can this seat act right now? The server's own `legal_commands` decides —
 * never a local re-derivation of the rules. */
export function canPick(match: TmwMatchView | null): boolean {
  return !!match && match.legal_commands.includes("tmw_pick");
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

export interface TmwCandidate extends TmwPlayer {
  /** The open slots THIS seat may place them in. Empty means "not legal for
   * you", which is a real state: a seat with only C open cannot take a guard. */
  legalSlots: TmwSlotType[];
}

/**
 * The current roll's candidates, annotated with this seat's legality and
 * ordered by the number the roster is actually scored on.
 *
 * Sorting by `prime_score` rather than alphabetically is deliberate: that is
 * the value the match is decided on, so the list a player scans should be
 * ordered by it. Candidates this seat cannot legally place sort last rather
 * than being hidden — a player needs to see that the roll offered someone good
 * and that their own roster shape is why they cannot take them.
 */
export function candidatesForSeat(match: TmwMatchView | null): TmwCandidate[] {
  const roll = match?.public_state?.current_roll;
  if (!roll) return [];
  const legal = match?.private_state?.legal_picks ?? {};
  return roll.candidates
    .map((player) => ({ ...player, legalSlots: legal[player.player_slug] ?? [] }))
    .sort((a, b) => {
      if (!a.legalSlots.length !== !b.legalSlots.length) {
        return a.legalSlots.length ? -1 : 1;
      }
      return (b.scoring_card?.prime_score ?? -1) - (a.scoring_card?.prime_score ?? -1);
    });
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
export function eligibilityLine(player: TmwPlayer): string {
  const { franchise_display_name, seasons } = player.eligibility;
  if (!seasons.length) return franchise_display_name;
  const span =
    seasons.length === 1
      ? seasons[0].season
      : `${seasons[0].season}–${seasons[seasons.length - 1].season}`;
  return `${franchise_display_name} · ${span}`;
}

/** "2016-17 San Antonio Spurs · 1Y PEAK3 87.8" — what the pick is worth. */
export function scoringCardLine(player: TmwPlayer): string | null {
  const card = player.scoring_card;
  if (!card) return null;
  return `${card.season} ${card.team_name} · 1Y PEAK3 ${card.prime_score.toFixed(1)}`;
}

/** Did any eligibility season come from a mid-season trade? Labelled, not hidden. */
export function hasTradedEvidence(player: TmwPlayer): boolean {
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

/** The sentence that must appear wherever a winner is declared. */
export function rankingBasisLabel(): string {
  return `Ranked on ${RANKING_BASIS_LABEL} — the mean PEAK3 score of the six drafted seasons.`;
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

/** The 82-game record, as the SUBORDINATE line it is required to be. */
export function recordLine(wins: number | null | undefined, losses: number | null | undefined): string | null {
  if (typeof wins !== "number" || typeof losses !== "number") return null;
  return `${wins}-${losses} projected`;
}

export interface TmwPodiumRow {
  result: ArenaResultView;
  score: TmwScoreDisplay;
  record: string | null;
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
      record: recordLine(result.detail?.wins, result.detail?.losses),
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
