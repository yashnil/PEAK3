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
 * authoritative state and writes a sentence. It decides no legality and retries
 * nothing.
 *
 * 3. AND THEN THE PASS-THROUGH BECAME THE DEFECT. The first version fell back
 *    to the server's own prose for any code it did not recognise, which was
 *    fine while every code was recognised and stopped being fine the moment
 *    three were not: `duplicate_action`, `not_bidding` and
 *    `ruleset_version_mismatch` all reached players verbatim, and the last of
 *    those is an engineering string naming two ruleset identifiers
 *    (`mode.py:143-152`). `not_your_seat`, `unknown_command` and the bare
 *    `"rejected"` were not in the union at all. Prose now reaches a player only
 *    for codes on `PROSE_ALLOWLIST`; everything else gets a written state and
 *    the raw text goes to the console.
 *
 * 4. AND HTTP FAILURES NEVER GOT HERE AT ALL. A 404, a 403, a 429 or a 500 was
 *    thrown before any of this ran and rendered as `apiError.message` — which
 *    for a body with no `detail.message` is literally `"HTTP 500"`.
 *    `explainTransportError` is the other half of the surface.
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
  // -- the mode's translation layer (apps/api/app/services/twenty_dollar/mode.py)
  | "not_your_seat"
  | "unknown_command"
  | "ruleset_version_mismatch"
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
  | "match_over"
  // -- the bare string the foundation emits when nothing more specific applies
  | "rejected";

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
  /**
   * How the surface should present this.
   *
   *   * `board`  — the board moved; the banner reports what happened.
   *   * `rule`   — the player must choose differently; keep the controls live.
   *   * `retry`  — transient, and retrying the same action is reasonable.
   *   * `reload` — the client's copy of the match is unusable; reconnect.
   */
  tone: "board" | "rule" | "retry" | "reload";
}

/**
 * The one message a user must never see, in either direction.
 *
 * S20-12: "never expose stack traces or opaque backend wording". Server prose
 * is passed through on an ALLOWLIST of codes whose sentences are written for
 * players (`bid_over_max` names the exact ceiling from the persisted budget,
 * which this module cannot compute). Everything else — including any code
 * added to the API after this file was written — gets the graceful state
 * below, and the raw text goes to the console for diagnosis instead.
 */
const PROSE_ALLOWLIST = new Set(["bid_over_max"]);

const UNKNOWN_MESSAGE =
  "That move did not go through. The board below is up to date — try again.";

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
  /**
   * The last resort. Server prose reaches a player only for a code on
   * `PROSE_ALLOWLIST`; anything else is an engineering string (
   * `"'draft' is not a move in this mode."`, `"This match has moved on (you
   * sent version 1, it is now 2)"`, a ruleset-version dump) and is logged
   * rather than rendered.
   */
  const fallback = (): RejectionExplanation => {
    if (code && PROSE_ALLOWLIST.has(code) && prose) {
      return { message: prose, code, boardMovedOn: false, tone: "rule" };
    }
    if (prose && typeof console !== "undefined") {
      console.warn("[showdown] unmapped rejection", { code, message: prose });
    }
    return {
      message: UNKNOWN_MESSAGE,
      code: code ?? null,
      boardMovedOn: false,
      tone: "retry",
    };
  };

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
          tone: "board",
        };
      }
      if (state.current_bid !== attempt.standingBid) {
        return {
          message:
            `The standing bid changed before your ${verb} arrived. It is now ` +
            `${formatDollars(state.current_bid)}. Choose a legal raise or pass.`,
          code: code ?? null,
          boardMovedOn: true,
          tone: "board",
        };
      }
      return {
        message:
          `The board moved before your ${verb} arrived. It is now ` +
          `${seatName(seatNames, state.active_seat, yourSeat) === "you" ? "your" : `${seatName(seatNames, state.active_seat, yourSeat)}'s`} ` +
          "turn on this lot.",
        code: code ?? null,
        boardMovedOn: true,
        tone: "board",
      };
    }

    case "not_your_turn":
    case "not_bidding": {
      const closed = settledLot(state, attempt.lotIndex);
      if (closed) {
        return {
          message:
            `Your ${verb} arrived after lot ${attempt.lotIndex + 1} closed. ` +
            lotOutcomeSentence(closed, seatNames, yourSeat),
          code: code ?? null,
          boardMovedOn: true,
          tone: "board",
        };
      }
      // `not_bidding` is the auction's own name for "this lot has already
      // moved on" — it fires when the snapshot is no longer in a biddable
      // phase. It was not in the switch at all, so it reached the banner as
      // whatever prose the reducer happened to carry.
      return {
        message:
          code === "not_bidding"
            ? "This lot has already moved on. The board below is the live one."
            : `It is ${seatName(seatNames, state.active_seat, yourSeat)}'s turn to act on this player.`,
        code: code ?? null,
        boardMovedOn: true,
        tone: "board",
      };
    }

    case "duplicate_action":
      // The foundation recognised this exact action as one it has already
      // recorded. Nothing was applied twice — which is the reassurance the
      // player needs, and the previous surface said nothing at all.
      return {
        message: "That action was already processed — the board has been refreshed.",
        code: code ?? null,
        boardMovedOn: true,
        tone: "board",
      };

    case "ruleset_version_mismatch":
      // The server's sentence here is an engineering string naming two
      // ruleset identifiers. It is a reload, and that is all a player can do.
      return {
        message:
          "This match was started on an older version of the rules. Reload the page to pick it up.",
        code: code ?? null,
        boardMovedOn: true,
        tone: "reload",
      };

    case "not_your_seat":
      return {
        message: "You are not seated in this match, so you cannot act in it.",
        code: code ?? null,
        boardMovedOn: true,
        tone: "reload",
      };

    case "unknown_command":
      return {
        message: "That control is out of date. Reload the page to get the current board.",
        code: code ?? null,
        boardMovedOn: true,
        tone: "reload",
      };

    case "already_passed":
      return {
        message: "You had already passed on this player, so this lot was no longer yours to bid on.",
        code: code ?? null,
        boardMovedOn: true,
        tone: "board",
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
        tone: "rule",
      };

    case "bid_over_max":
      // The one allowlisted server sentence: it names the reserve rule and the
      // exact ceiling from the persisted budget, which is more than this module
      // knows. Without prose it degrades to a sentence of our own.
      return prose
        ? fallback()
        : {
            message:
              `${amount} is more than you can commit here — every slot you still have ` +
              "to fill must keep $1 behind it.",
            code: code ?? null,
            boardMovedOn: false,
            tone: "rule",
          };

    case "candidate_unfit":
      return {
        message: "You could not field a legal starting five if you won this player, so the bid was refused.",
        code: code ?? null,
        boardMovedOn: false,
        tone: "rule",
      };

    case "no_market_skips":
      return {
        message:
          "You have no market skips left, and this player fits your roster with nothing bid — " +
          `so opening at ${formatDollars(state.minimum_bid)} is the only legal move.`,
        code: code ?? null,
        boardMovedOn: false,
        tone: "rule",
      };

    case "roster_full":
      return {
        message: "Your five are complete, so there is nothing left to bid on.",
        code: code ?? null,
        boardMovedOn: true,
        tone: "board",
      };

    case "match_over":
    case "match_not_live":
      return {
        message: "The auction has already finished.",
        code: code ?? null,
        boardMovedOn: true,
        tone: "board",
      };

    case "match_expired":
      return {
        message: "This match expired before your move arrived. Matches run for two hours.",
        code: code ?? null,
        boardMovedOn: true,
        tone: "reload",
      };

    case "bid_not_integer":
      return {
        message: "Bids are whole dollars only.",
        code: code ?? null,
        boardMovedOn: false,
        tone: "rule",
      };

    default:
      return fallback();
  }
}

// ---------------------------------------------------------------------------
// HTTP-level failures, which never reached this module at all
// ---------------------------------------------------------------------------

/**
 * What the player is shown when the REQUEST failed rather than the move.
 *
 * THE GAP THIS CLOSES. `explainRejection` only ever saw a 200 response
 * carrying `accepted: false`. Everything else — a 404 `match_not_found`, a 403
 * `not_a_participant`, a 429 `rate_limited`, a 401 `authentication_required`, a
 * 500 — was thrown as a `TwentyDollarAPIError` and rendered as
 * `apiError.message`, which for a body without a `detail.message` is literally
 * the string `"HTTP 500"` (`twenty-dollar-api.ts::parseErrorDetail`).
 *
 * `attempted` changes the wording rather than the meaning: a failed POLL is
 * "the board may be behind", a failed COMMAND is "your move was not sent", and
 * the second is the one a player under a clock needs stated plainly.
 */
export function explainTransportError(
  status: number,
  code: string | null | undefined,
  serverMessage: string | null | undefined,
  attempted: "load" | "bid" | "pass",
): RejectionExplanation {
  const noun = attempted === "load" ? "the board" : attempted === "bid" ? "your bid" : "your pass";
  const sent = attempted === "load" ? null : `${noun} was not sent`;

  const explanation = (
    message: string,
    tone: RejectionExplanation["tone"],
  ): RejectionExplanation => ({ message, code: code ?? null, boardMovedOn: false, tone });

  // Status 0 is this client's own marker for "the network failed", which an
  // HTTP status cannot express.
  if (status === 0 || code === "network_unavailable") {
    return explanation(
      attempted === "load"
        ? "Connection dropped. Reconnecting — the board below is the last state we confirmed."
        : `Connection dropped — ${sent}. It is safe to try again.`,
      "retry",
    );
  }

  switch (code) {
    case "authentication_required":
      return explanation("Your session has expired. Sign in again to keep playing.", "reload");
    case "not_a_participant":
      return explanation("This auction belongs to another pair of bidders.", "reload");
    case "match_not_found":
      return explanation("This match is no longer available. Matches run for two hours.", "reload");
    case "rate_limited":
      return explanation(
        attempted === "load"
          ? "Slowing down for a moment — the board will refresh shortly."
          : `That came through faster than the server accepts — ${sent}. Try once more.`,
        "retry",
      );
    default:
      break;
  }

  if (status === 401 || status === 403) {
    return explanation("You are not able to act in this match right now.", "reload");
  }
  if (status === 404 || status === 410) {
    return explanation("This match is no longer available. Matches run for two hours.", "reload");
  }
  if (status === 409 || status === 422) {
    return explanation(
      "The board moved on before that arrived. It has been refreshed below.",
      "board",
    );
  }

  // ANYTHING ELSE IS OURS TO OWN, not the player's to read. The server's text
  // goes to the console; the player gets a state they can act on.
  if (serverMessage && typeof console !== "undefined") {
    console.warn("[showdown] transport failure", { status, code, message: serverMessage });
  }
  return explanation(
    attempted === "load"
      ? "We could not refresh the board. Retrying — the state below is the last one we confirmed."
      : `Something went wrong on our side and ${sent}. Try again in a moment.`,
    "retry",
  );
}
