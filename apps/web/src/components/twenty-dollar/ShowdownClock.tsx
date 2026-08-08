"use client";

import { useEffect, useState } from "react";

import ArenaTimer from "@/components/shared/ArenaTimer";
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
 *   elapsed   — somebody else is on the clock. We do NOT have their deadline
 *               and must not invent one, so this counts UP from when the turn
 *               was first seen. Three-Man Weave reached the same conclusion for
 *               the same reason.
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
  pendingCommand,
  pendingAmount,
  onExpire,
}: ShowdownClockProps) {
  const yours = activeSeat !== null && activeSeat === yourSeat;

  const mode: ShowdownClockMode =
    phase === "pending" && pendingCommand
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
      <div className="td-clock" data-testid="td-clock" data-mode="elapsed">
        <ElapsedClock key={turnKey} />
      </div>
    );
  }

  return (
    <div className="td-clock" data-testid="td-clock" data-mode="held">
      <div className="td-clock-held pk-crown" data-testid="td-timer">
        {/* EVERY LABEL HERE IS IN THE TIME DOMAIN. `TurnBanner` directly above
            already names the seat, and this panel's first draft repeated it
            word for word — "PEAK3 Bot is deciding" under "PEAK3 Bot is
            deciding". Two identical sentences stacked is the same defect as
            four different ones. */}
        <span className="td-clock-held-label">
          {activeSeat === null ? "Next clock" : "Your clock"}
        </span>
        <span className="td-clock-held-value pk-numeral">{TURN_SECONDS}s</span>
        <span className="td-clock-held-sub">
          {activeSeat === null
            ? "Starts when the next lot opens."
            : "Opens in a moment — you get the full window."}
        </span>
      </div>
    </div>
  );
}

/**
 * Counting UP, because we do not have the other seat's deadline.
 *
 * `arena.py` reports `seconds_remaining` to exactly one seat — the one on the
 * clock — so the opponent's remaining time is information this client has never
 * been given. Rendering a countdown here would mean manufacturing a deadline
 * out of `TURN_SECONDS` and hoping it matched; what is actually knowable is how
 * long we have been waiting, so that is what is shown.
 *
 * A SEPARATE VALUE TESTID from the countdown's, deliberately: `td-timer-value`
 * means "the human's remaining decision time" to the browser suite, and an
 * elapsed count answering to the same name would let a bot turn satisfy an
 * assertion about the human's window.
 */
function ElapsedClock() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const startedAt = performance.now();
    const id = window.setInterval(() => {
      setSeconds(Math.floor((performance.now() - startedAt) / 1000));
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="td-clock-elapsed pk-crown" data-testid="td-timer">
      {/* "Time elapsed", not "PEAK3 Bot is deciding" — the banner above says
          who, and this said the same sentence again, verbatim. */}
      <span className="td-clock-elapsed-label">Time elapsed</span>
      <span className="td-clock-elapsed-value pk-numeral" data-testid="td-elapsed-value">
        {seconds}s
      </span>
      <span className="td-clock-elapsed-track" aria-hidden="true">
        <span className="td-clock-elapsed-fill" />
      </span>
    </div>
  );
}
