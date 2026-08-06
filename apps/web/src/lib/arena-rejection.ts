/**
 * Turning a server rejection into a sentence that names what actually happened.
 *
 * THE DEFECT THIS MODULE EXISTS TO FIX, and it was two defects wearing one coat.
 *
 * 1. A FIELD-NAME MISMATCH THAT DISCARDED EVERY EXPLANATION. The API returns
 *    `SubmitCommandResponse { accepted, replayed, rejection_code, message,
 *    match }` — the prose is under `message`. The Showdown client declared the
 *    field as `rejection_message` and rendered
 *    `result.rejection_message || "That move was not accepted."`, so the read
 *    was ALWAYS `undefined` and the fallback fired on 100% of rejections. A
 *    scripted reproduction of the reported Curry bid had the server saying
 *    "This match has moved on (you sent version 1, it is now 2). Reload." while
 *    the player was shown the generic string.
 *
 * 2. EVEN THE SERVER'S OWN SENTENCE IS NOT ENOUGH. "This match has moved on
 *    (you sent version 1, it is now 2)" is true, is precise, and tells a player
 *    nothing they can act on. What they need to know is that the lot closed,
 *    who got the player, and for how much. That information is in the
 *    authoritative state the same response carries, so it is used here.
 *
 * WHAT THIS MODULE IS AND IS NOT. It reads the rejection code and the
 * authoritative state and writes a sentence. It decides no legality, retries
 * nothing, and never invents a cause: an unrecognised code falls through to the
 * server's own prose, and only a rejection with neither a known code nor any
 * prose reaches a generic string — a combination the API cannot currently
 * produce, and one the tests assert against.
 */

import {
  formatDollars,
  type ResolvedLot,
  type TwentyDollarPublicState,
} from "@/lib/twenty-dollar-api";

/**
 * The stable codes the Arena foundation and the auction rules emit.
 *
 * Listed rather than inferred so a new server code shows up as a compile-time
 * gap here instead of as a generic banner in front of a player.
 */
export type ArenaRejectionCode =
  // -- foundation (apps/api/app/repositories/arena_protocols.py)
  | "stale_state_version"
  | "match_not_live"
  | "match_expired"
  | "duplicate_action"
  | "turn_already_resolved"
  // -- auction rules (nba_peak/twenty_dollar/state.py)
  | "not_bidding"
  | "not_your_turn"
  | "roster_full"
  | "bid_not_integer"
  | "bid_too_low"
  | "bid_over_max"
  | "candidate_unfit"
  | "already_passed"
  | "no_market_skips"
  | "ruleset_version_mismatch"
  | "match_over";

/** What the player was trying to do, as the client understood it at click time. */
export interface AttemptedAction {
  command: "bid" | "pass";
  /** Dollars, for a bid. Ignored for a pass. */
  amount: number;
  /** The lot the control was rendered against. */
  lotIndex: number;
  /** The standing bid the control was rendered against. */
  standingBid: number;
  /** Whether the client believed passing would spend a market skip. */
  wouldSpendSkip: boolean;
}

export interface RejectionExplanation {
  /** The sentence to show. Never empty. */
  message: string;
  /** The server's code, carried through for tests and telemetry. */
  code: string | null;
  /**
   * True when the rejection is explained by the board having moved on, rather
   * than by anything the player did wrong. The surface uses this to choose
   * between "here is what happened" and "here is what you must fix".
   */
  boardMovedOn: boolean;
}

function seatName(names: string[], index: number | null, yourSeat: number | null): string {
  if (index === null) return "the other seat";
  if (index === yourSeat) return "you";
  return names[index] ?? `Seat ${index + 1}`;
}

/** The settled lot with this index, if the authoritative state carries it. */
function settledLot(
  state: TwentyDollarPublicState,
  lotIndex: number,
): ResolvedLot | null {
  return state.history.find((lot) => lot.lot_index === lotIndex) ?? null;
}

/**
 * WHAT HAPPENED TO THE LOT THE PLAYER WAS ACTING ON.
 *
 * This is the sentence the reported failure needed and did not get. When the
 * board advanced past the lot the control was rendered against, the player is
 * told the outcome of THAT lot — not that a version number changed.
 */
function lotOutcomeSentence(
  lot: ResolvedLot,
  names: string[],
  yourSeat: number | null,
): string {
  const player = lot.candidate.player_name;
  if (lot.winner_seat === null) {
    return `${player} went unsold.`;
  }
  const who = seatName(names, lot.winner_seat, yourSeat);
  const verb = who === "you" ? "You took" : `${who} took`;
  return `${verb} ${player} for ${formatDollars(lot.price)}.`;
}

/**
 * The one function. `attempt` is what the player tried, `state` is the
 * authoritative state the SAME response returned, so the explanation is always
 * derived from the board as it is now rather than from a stale render.
 */
export function explainRejection(
  code: string | null | undefined,
  serverMessage: string | null | undefined,
  attempt: AttemptedAction,
  state: TwentyDollarPublicState,
  seatNames: string[],
  yourSeat: number | null,
): RejectionExplanation {
  const prose = (serverMessage ?? "").trim();
  const fallback = (): RejectionExplanation => ({
    // The server's own sentence is a good answer and a poor last resort; it
    // names the real constraint but not the consequence. It is used whenever
    // this module has nothing more specific, which is a narrow set.
    message: prose || "The server did not accept that move. The board below is current.",
    code: code ?? null,
    boardMovedOn: false,
  });

  const amount = formatDollars(attempt.amount);
  const verb = attempt.command === "bid" ? `${amount} bid` : "pass";

  switch (code) {
    case "stale_state_version":
    case "turn_already_resolved": {
      // THE CURRY CASE. The board moved between the render and the request.
      // Whether the lot itself closed decides which of two very different
      // things to say.
      const closed = settledLot(state, attempt.lotIndex);
      if (closed) {
        return {
          message:
            `Your ${verb} arrived after lot ${attempt.lotIndex + 1} closed. ` +
            lotOutcomeSentence(closed, seatNames, yourSeat),
          code: code ?? null,
          boardMovedOn: true,
        };
      }
      if (state.current_bid !== attempt.standingBid) {
        return {
          message:
            `The standing bid changed before your ${verb} arrived. It is now ` +
            `${formatDollars(state.current_bid)}. Choose a legal raise or pass.`,
          code: code ?? null,
          boardMovedOn: true,
        };
      }
      return {
        message:
          `The board moved before your ${verb} arrived. It is now ` +
          `${seatName(seatNames, state.active_seat, yourSeat) === "you" ? "your" : `${seatName(seatNames, state.active_seat, yourSeat)}'s`} ` +
          "turn on this lot.",
        code: code ?? null,
        boardMovedOn: true,
      };
    }

    case "not_your_turn": {
      const closed = settledLot(state, attempt.lotIndex);
      if (closed) {
        return {
          message:
            `Your ${verb} arrived after lot ${attempt.lotIndex + 1} closed. ` +
            lotOutcomeSentence(closed, seatNames, yourSeat),
          code: code ?? null,
          boardMovedOn: true,
        };
      }
      return {
        message: `It is ${seatName(seatNames, state.active_seat, yourSeat)}'s turn to act on this player.`,
        code: code ?? null,
        boardMovedOn: true,
      };
    }

    case "already_passed":
      return {
        message: "You had already passed on this player, so this lot was no longer yours to bid on.",
        code: code ?? null,
        boardMovedOn: true,
      };

    case "bid_too_low":
      return {
        message:
          `${amount} is below the minimum. ` +
          (state.current_bid > 0
            ? `Beat ${formatDollars(state.current_bid)} by at least $1 — ${formatDollars(state.minimum_bid)} or more.`
            : `The opening bid is ${formatDollars(state.minimum_bid)}.`),
        code: code ?? null,
        boardMovedOn: false,
      };

    case "bid_over_max":
      // The server's sentence here already names the reserve rule and the exact
      // ceiling from the persisted budget, which is more than this module knows.
      return fallback();

    case "candidate_unfit":
      return {
        message: "You could not field a legal starting five if you won this player, so the bid was refused.",
        code: code ?? null,
        boardMovedOn: false,
      };

    case "no_market_skips":
      return {
        message:
          "You have no market skips left, and this player fits your roster with nothing bid — " +
          `so opening at ${formatDollars(state.minimum_bid)} is the only legal move.`,
        code: code ?? null,
        boardMovedOn: false,
      };

    case "roster_full":
      return {
        message: "Your five are complete, so there is nothing left to bid on.",
        code: code ?? null,
        boardMovedOn: true,
      };

    case "match_over":
    case "match_not_live":
      return {
        message: "The auction has already finished.",
        code: code ?? null,
        boardMovedOn: true,
      };

    case "match_expired":
      return {
        message: "This match expired before your move arrived. Matches run for two hours.",
        code: code ?? null,
        boardMovedOn: true,
      };

    case "bid_not_integer":
      return {
        message: "Bids are whole dollars only.",
        code: code ?? null,
        boardMovedOn: false,
      };

    default:
      return fallback();
  }
}
