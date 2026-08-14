"use client";

import { useEffect, useState } from "react";

import ArenaTimer, { useRemainingSeconds } from "@/components/shared/ArenaTimer";
import { TURN_SECONDS, formatDollars } from "@/lib/twenty-dollar-api";
import type { ShowdownPhase } from "./useShowdownPhase";

/**
 * The Showdown's clock surface.
 *
 * THE DEFECT THIS WAS REBUILT FOR. A review capture of a live auction — the
 * human on the clock, the controls enabled — showed the clock band containing
 * the words "YOUR TURN" and nothing else, and no countdown anywhere on the
 * screen. S20-04 lists time remaining as item five of the required hierarchy;
 * a player could not answer "how long have I got".
 *
 * The cause was a state this component had no answer for. `arena.py` sends
 * `seconds_remaining` ONLY to the seat holding the open turn, so it is `null`
 * for the whole of the opponent's turn and for the gap between a match opening
 * and the bot's first move landing. The old code passed that null straight to
 * `ArenaTimer`, which correctly renders its `--idle` state: a label, no digits.
 * Correct for a shared component, useless as this mode's clock.
 *
 * FOUR MODES, AND EVERY ONE OF THEM SAYS SOMETHING TRUE
 * -----------------------------------------------------
 *   countdown — we hold a real server deadline for our own decision. The one
 *               mode with `td-timer-value`, delegated to `ArenaTimer` so the
 *               tick still re-renders four characters rather than the board.
 *   elapsed   — somebody else is on the clock. This COUNTS DOWN against the
 *               server's own deadline for that seat, published to every seat as
 *               `turn_seconds_remaining`. It used to count UP, because the API
 *               gave `seconds_remaining` only to the seat holding the turn and
 *               inventing a deadline would have been worse; the fix was to
 *               publish the fact. See `OpponentClock`.
 *   held      — a decision is coming but has not opened: the intro, a lot
 *               reveal, an inter-turn handoff, or the beat before the first
 *               deadline arrives. It states the window length rather than
 *               showing a number that is not running.
 *   pending   — we have submitted. The countdown is FROZEN (the room hands
 *               down a null deadline for as long as the command is out) and
 *               the submitted action is what occupies the space. An action
 *               sent inside the server's two-second grace window is designed to
 *               be accepted; painting "time expired" over it was S20-08.
 *
 * WHAT THIS DOES NOT DO. It never says whose turn it is. `TurnBanner` is the
 * single turn surface (S20-03), and this used to be one of four places that
 * answered the same question — the "three stacked rows" defect TMW-07 names,
 * reproduced here. The label is about TIME.
 *
 * `totalSeconds` comes from `TURN_SECONDS`, not from a literal: the room passed
 * `20` while the server gives 25, so the progress arc sat pinned at full for
 * the first fifth of every decision.
 */

export type ShowdownClockMode = "countdown" | "elapsed" | "held" | "pending";

export interface ShowdownClockProps {
  phase: ShowdownPhase;
  /** Already nulled by `useShowdownPhase` outside the `decide` phase. */
  deadlineAt: number | null;
  /** `public_state.active_seat`. */
  activeSeat: number | null;
  yourSeat: number | null;
  /** What expiry will cost, in words. Rendered under the countdown. */
  consequence?: string | null;
  /**
   * Identity of the turn currently being timed. The elapsed clock is remounted
   * when it changes, so a count-up starts from zero on every new turn rather
   * than accumulating across the match.
   */
  turnKey: string;
  /**
   * The open turn's deadline when it belongs to the OPPONENT, as a local
   * monotonic instant. Null when the server published none, in which case the
   * opponent's panel falls back to counting up. See `OpponentClock`.
   */
  opponentDeadlineAt?: number | null;
  /** What this client has in flight, if anything. */
  pendingCommand: "bid" | "pass" | null;
  pendingAmount: number;
  onExpire: () => void;
}

export default function ShowdownClock({
  phase,
  deadlineAt,
  activeSeat,
  yourSeat,
  consequence,
  turnKey,
  opponentDeadlineAt = null,
  pendingCommand,
  pendingAmount,
  onExpire,
}: ShowdownClockProps) {
  const yours = activeSeat !== null && activeSeat === yourSeat;

  const mode: ShowdownClockMode =
    // NOBODY IS DECIDING DURING THE INTRO. The snapshot already names the
    // opening bidder in `active_seat` — that is who will be handed the first
    // lot — but the OPEN TURN is the intro, which accepts no action. Without
    // this branch the panel read as "the opponent is on the clock" and counted
    // down the briefing as if it were their decision time.
    phase === "intro"
      ? "held"
      : phase === "pending" && pendingCommand
        ? "pending"
        : phase === "decide" && yours && deadlineAt !== null
          ? "countdown"
          : activeSeat !== null && !yours
            ? "elapsed"
            : "held";

  if (mode === "pending") {
    return (
      <div className="td-clock" data-testid="td-clock" data-mode="pending">
        <div className="td-pending" data-testid="td-pending">
          <span className="td-pending-mark" aria-hidden="true" />
          <p className="td-pending-text" role="status">
            {pendingCommand === "bid"
              ? `Sending your ${formatDollars(pendingAmount)} bid…`
              : "Sending your decision…"}
          </p>
          <p className="td-pending-sub">The clock is held while this lands.</p>
        </div>
      </div>
    );
  }

  if (mode === "countdown") {
    return (
      <div className="td-clock" data-testid="td-clock" data-mode="countdown" data-yours="true">
        <ArenaTimer
          deadlineAt={deadlineAt}
          totalSeconds={TURN_SECONDS}
          // TIME, NOT TURN. The banner above already says whose move it is.
          label="Time remaining"
          consequence={consequence}
          yours
          onExpire={onExpire}
          testId="td-timer"
        />
      </div>
    );
  }

  if (mode === "elapsed") {
    return (
      <div
        className="td-clock"
        data-testid="td-clock"
        data-mode="elapsed"
        // WHICH DIRECTION THIS IS COUNTING, as data rather than as an inference
        // from a number that happens to be rising or falling.
        data-direction={opponentDeadlineAt === null ? "up" : "down"}
      >
        <OpponentClock key={turnKey} deadlineAt={opponentDeadlineAt} />
      </div>
    );
  }

  return (
    <div className="td-clock" data-testid="td-clock" data-mode="held">
      <div className="td-clock-held pk-crown" data-testid="td-timer">
        {/* EVERY LABEL HERE IS IN THE TIME DOMAIN. `TurnBanner` directly above
            already names the seat, and this panel's first draft repeated it
            word for word — the opponent's name and "is deciding" stacked
            twice. Two identical sentences stacked is the same defect as four
            different ones. */}
        <span className="td-clock-held-label">
          {activeSeat === null || phase === "intro" ? "Next clock" : "Your clock"}
        </span>
        <span className="td-clock-held-value pk-numeral">{TURN_SECONDS}s</span>
        <span className="td-clock-held-sub">
          {phase === "intro"
            ? // THE PROMISE THE INTRO PHASE MAKES, said out loud. It is a real
              // server turn, so reading all of it costs nothing.
              "Starts when the first lot opens — the intro costs you none of it."
            : activeSeat === null
              ? "Starts when the next lot opens."
              : "Opens in a moment — you get the full window."}
        </span>
      </div>
    </div>
  );
}

/**
 * THE OPPONENT'S CLOCK. It counts DOWN, like the human's. (C3)
 *
 * WHAT THIS USED TO BE, AND WHY. It counted UP — "TIME ELAPSED 2s" — for an
 * honest reason: `arena.py` reported `seconds_remaining` to exactly one seat,
 * the one on the clock, so the opponent's remaining time was information this
 * client had never been given. Manufacturing a deadline out of `TURN_SECONDS`
 * and hoping it matched would have been worse than counting what was knowable.
 *
 * THE FIX WAS TO PUBLISH THE FACT rather than to keep working around its
 * absence. A turn deadline is not hidden information: whose turn it is and the
 * mode's turn length are both already public, and nothing about a bid, a
 * budget or a card can be inferred from a clock. The API now sends
 * `turn_seconds_remaining` to every seat, so a player watching the other side
 * think sees "TIME REMAINING 8s, 7s, 6s" against the SERVER's own deadline,
 * in the same direction and the same language as their own countdown.
 *
 * THE COUNT-UP SURVIVES AS THE FALLBACK for a turn whose remaining time the
 * server did not publish. Showing nothing would be worse than showing what is
 * known, and the mode still refuses to invent a deadline it does not hold.
 *
 * A SEPARATE VALUE TESTID from the countdown's, deliberately: `td-timer-value`
 * means "the human's remaining decision time" to the browser suite, and the
 * opponent's clock answering to the same name would let a bot turn satisfy an
 * assertion about the human's window.
 */
function OpponentClock({ deadlineAt }: { deadlineAt: number | null }) {
  const remaining = useRemainingSeconds(deadlineAt);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (deadlineAt !== null) return;
    const startedAt = performance.now();
    const id = window.setInterval(() => {
      setElapsed(Math.floor((performance.now() - startedAt) / 1000));
    }, 250);
    return () => window.clearInterval(id);
  }, [deadlineAt]);

  const counting = deadlineAt !== null && remaining !== null;
  const fraction = counting ? Math.max(0, Math.min(1, remaining / TURN_SECONDS)) : 1;

  return (
    <div
      className="td-clock-elapsed pk-crown"
      data-testid="td-timer"
      style={{ ["--td-opponent-fraction" as string]: String(fraction) }}
    >
      {/* Time domain only. `TurnBanner` directly above already names the seat,
          and this panel's first draft repeated it word for word. */}
      <span className="td-clock-elapsed-label">
        {counting ? "Time remaining" : "Time elapsed"}
      </span>
      <span className="td-clock-elapsed-value pk-numeral" data-testid="td-elapsed-value">
        {counting ? remaining : elapsed}s
      </span>
      <span className="td-clock-elapsed-track" aria-hidden="true">
        <span className="td-clock-elapsed-fill" />
      </span>
    </div>
  );
}
