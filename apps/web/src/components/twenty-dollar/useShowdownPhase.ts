"use client";

/**
 * ONE COMPETITIVE TIMING MODEL for the $20 Showdown.
 *
 * THE PHASES
 * ----------
 *   intro    — the server's pre-match turn. No clock is displayed, no control
 *              is live. Ends when the server says so (its own deadline or a
 *              skip command), never on a local timer.
 *   decide   — a seat is on the clock. The only phase with a countdown, and
 *              the controls are live when the seat is the local player's.
 *   pending  — this client has submitted and is waiting for the server. The
 *              countdown is FROZEN and the submitted action is displayed.
 *   settling — no seat is active: the server is running a seatless beat (a
 *              candidate nobody can use, a forced fill) or resolving the lot.
 *   complete — the auction is over.
 *
 * WHAT LEFT IN GAME-FEEL PASS 2, AND WHY. The previous model added two
 * CLIENT-SIDE beats on top of the server's clock: a 1.1s "reveal" hold when a
 * new lot appeared and a 0.7s "handoff" hold after every action. Both held
 * the human's controls shut while the server's 25-second decision clock kept
 * running, and measured in play they were the dead time between a bot's
 * reply and the player's next chance to act (about 5.8s per exchange, of
 * which the network accounted for 40ms). A new lot's card ENTERS (see
 * `CardArrival`) and the previous lot's SOLD moment plays over the stage,
 * but neither gates the controls: the action starts the instant the state
 * lands, and the expressive motion runs alongside it.
 *
 * Pending is the one client-side state, and it is not a beat: it is the
 * truth that a command is in flight, and it lasts exactly as long as the
 * request does.
 */

export type ShowdownPhase = "intro" | "decide" | "pending" | "settling" | "complete";

export interface ShowdownPhaseInput {
  /** `public_state.active_seat`. */
  activeSeat: number | null;
  /** `your_seat_index`. */
  yourSeat: number | null;
  /** The local monotonic deadline the room derived from `seconds_remaining`. */
  deadlineAt: number | null;
  /** True while this client has a command in flight. */
  pending: boolean;
  /** `public_state.phase === "complete"`. */
  complete: boolean;
  /** THE SERVER SAYS THE INTRO IS OPEN — `turn_phase === "intro"`. */
  introOpen: boolean;
}

export interface ShowdownPhaseState {
  phase: ShowdownPhase;
  /**
   * The deadline to hand the clock, or null when NOTHING should be counting.
   * Null during the intro, while settling, and — the S20-08 fix — for as long
   * as a command of this client's is in flight.
   */
  clockDeadlineAt: number | null;
  /** May the human act right now? */
  controlsLive: boolean;
}

export function useShowdownPhase(input: ShowdownPhaseInput): ShowdownPhaseState {
  const { activeSeat, yourSeat, deadlineAt, pending, complete, introOpen } = input;
  const onHumanClock = activeSeat !== null && activeSeat === yourSeat;

  const phase: ShowdownPhase = complete
    ? "complete"
    : introOpen
      ? "intro"
      : pending
        ? "pending"
        : activeSeat === null
          ? "settling"
          : "decide";

  return {
    phase,
    // NOTHING COUNTS DOWN OUTSIDE `decide`. `pending` produces `null`, the
    // clock renders its frozen state, and expiry cannot fire behind a request
    // that the server's grace window is about to accept.
    clockDeadlineAt: phase === "decide" ? deadlineAt : null,
    controlsLive: phase === "decide" && onHumanClock,
  };
}
