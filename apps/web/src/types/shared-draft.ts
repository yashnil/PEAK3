/**
 * SHARED DRAFT — this game's reading of the Arena envelope.
 *
 * Mirrors `nba_peak/shared_draft/state.py::project` and
 * `apps/api/app/services/shared_draft/mode.py::project`. NOTHING HERE IS
 * COMPUTED: legality, the pick order, roster totals, component totals and the
 * placements all arrive from the server.
 *
 * WHAT IS DELIBERATELY ABSENT while the draft is live: any card's
 * `prime_score`, rank or components. The server does not send them until the
 * tenth pick lands, so `SharedDraftCard` marks them optional and every live
 * surface reads only the identity fields.
 */
import type { ArenaMatchView } from "@/types/three-man-weave";

export const SHARED_DRAFT_MODE = "shared_draft";

/** Mirrors `nba_peak/shared_draft/config.py`. Display-only denominators;
 *  every live clock is the server's. */
export const SHARED_DRAFT_PICK_SECONDS = 30;
export const SHARED_DRAFT_SLOTS = ["PG", "SG", "SF", "PF", "C"] as const;
export type SharedDraftSlot = (typeof SHARED_DRAFT_SLOTS)[number];

/** `arrival`: the intro is on screen but its clock waits for every human seat. */
export type SharedDraftPhase = "arrival" | "intro" | "pick" | "complete";

export const SHARED_DRAFT_COMMAND_INTRO_SEEN = "sd_intro_seen";
export const SHARED_DRAFT_COMMAND_PICK = "sd_pick";
export const SHARED_DRAFT_COMMAND_FORFEIT = "sd_forfeit";

export interface SharedDraftCard {
  card_index: number;
  player_slug: string;
  player_name: string;
  /** The ONE position this card is dealt at (the player's primary position). */
  position: SharedDraftSlot;
  /** The completed season the card's PEAK3 score is from, e.g. "2015-16". */
  peak_season: string;
  team: string | null;
  drafted_by: number | null;
  pick_number: number | null;
  /** Present only once the draft is complete. */
  prime_score?: number;
  rank?: number;
  components?: Record<string, number>;
  row_id?: string;
}

export interface SharedDraftPick {
  pick_number: number;
  seat_index: number;
  card_index: number;
  auto: "timeout" | null;
}

export interface SharedDraftSeatPublic {
  seat_index: number;
  display_name: string;
  is_bot: boolean;
  arrived: boolean;
  forfeited: boolean;
  /** slot -> drafted card_index, null while open. */
  roster: Record<SharedDraftSlot, number | null>;
  picks_made: number;
  /** Present only once the draft is complete. */
  roster_total?: number;
  component_totals?: Record<string, number>;
}

export interface SharedDraftPlacement {
  seat_index: number;
  placement: number;
  outcome: "win" | "loss" | "draw";
}

export interface SharedDraftPublicState {
  ruleset_version: string;
  board_version: string;
  model_version: string;
  /** The latest completed season eligibility is measured against (players
   *  who appeared in it -- not a live roster check). */
  latest_season: string;
  phase: SharedDraftPhase;
  slots: SharedDraftSlot[];
  /** The seat on the clock for each pick, in order. */
  order: number[];
  pick_index: number;
  pick_count: number;
  current_seat: number | null;
  cards: SharedDraftCard[];
  picks: SharedDraftPick[];
  seats: SharedDraftSeatPublic[];
  ended_by: "completed" | "forfeit" | null;
  placements?: SharedDraftPlacement[];
}

export interface SharedDraftPrivateState {
  seat_index: number;
  open_positions: SharedDraftSlot[];
  /** Cards this seat may draft right now; empty off the clock. */
  legal_cards: number[];
  forfeited: boolean;
}

export type SharedDraftMatchView = ArenaMatchView<SharedDraftPublicState, SharedDraftPrivateState>;
