"use client";

/**
 * PeakV2ShowdownClock — the auction clock, one depleting instrument for
 * every owner.
 *
 * Four modes, carried on `data-mode` so a test can read them:
 *   countdown — the human's own decision window, counting DOWN with a bar.
 *   elapsed   — the opponent's window, counting DOWN against their published
 *               deadline (the name is historical: it used to count up).
 *   pending   — a command is in flight; the clock is frozen and says what was
 *               sent.
 *   held      — nobody is on the clock (the intro, a seatless beat).
 *
 * The visible instrument is the shared `TurnClock` at its large size; the
 * real expiry authority is the visually hidden `ArenaTimer` below, which
 * announces to screen readers and fires `onExpire`. This never invents a
 * second timer.
 */

import ArenaTimer, { useRemainingSeconds } from "@/components/shared/ArenaTimer";
import { TurnClock } from "@/components/game-feel";
import { TURN_SECONDS, formatDollars } from "@/lib/twenty-dollar-api";
import type { ShowdownPhase } from "@/components/twenty-dollar/useShowdownPhase";

export interface PeakV2ShowdownClockProps {
  phase: ShowdownPhase;
  /** The human's own deadline, null when nothing of theirs is counting. */
  deadlineAt: number | null;
  activeSeat: number | null;
  yourSeat: number | null;
  opponentIsBot: boolean;
  opponentName: string;
  consequence?: string | null;
  /** The open turn's deadline, whoever holds it. */
  opponentDeadlineAt?: number | null;
  /** How long the current seatless beat runs, for the held state's bar. */
  heldLabel?: string | null;
  pendingCommand: "bid" | "pass" | null;
  pendingAmount: number;
  onExpire: () => void;
}

export default function PeakV2ShowdownClock({
  phase,
  deadlineAt,
  activeSeat,
  yourSeat,
  opponentIsBot,
  opponentName,
  consequence,
  opponentDeadlineAt = null,
  heldLabel = null,
  pendingCommand,
  pendingAmount,
  onExpire,
}: PeakV2ShowdownClockProps) {
  const yours = activeSeat !== null && activeSeat === yourSeat;
  const opponentRemaining = useRemainingSeconds(opponentDeadlineAt);

  const mode: "countdown" | "elapsed" | "held" | "pending" =
    phase === "intro"
      ? "held"
      : phase === "pending" && pendingCommand
        ? "pending"
        : phase === "decide" && yours && deadlineAt !== null
          ? "countdown"
          : activeSeat !== null && !yours
            ? "elapsed"
            : "held";

  return (
    <div
      className="sd-clock"
      data-testid="td-clock"
      data-mode={mode}
      data-direction="down"
      data-yours={mode === "countdown" ? "true" : undefined}
    >
      {/* Real expiry authority — visually hidden, screen-reader announcements preserved. */}
      <div className="sr-only">
        <ArenaTimer deadlineAt={deadlineAt} totalSeconds={TURN_SECONDS} label="Time remaining" consequence={consequence} yours onExpire={onExpire} testId="td-timer" />
      </div>

      {mode === "pending" ? (
        <div data-testid="td-pending" className="sd-clock-pending">
          <span className="sd-clock-pending-dot" aria-hidden="true" />
          <span className="sd-clock-pending-text">
            {pendingCommand === "bid" ? `Sending ${formatDollars(pendingAmount)}…` : "Sending your decision…"}
          </span>
        </div>
      ) : mode === "countdown" ? (
        <TurnClock deadlineAt={deadlineAt} totalSeconds={TURN_SECONDS} owner="you" label="To act" size="lg" warnAtSeconds={6} testId="td-turn-clock" />
      ) : mode === "elapsed" ? (
        <>
          <TurnClock
            deadlineAt={opponentDeadlineAt}
            totalSeconds={TURN_SECONDS}
            owner={opponentIsBot ? "bot" : "rival"}
            label={opponentIsBot ? `${opponentName} is thinking` : `${opponentName} on the clock`}
            size="lg"
            warnAtSeconds={6}
            testId="td-turn-clock"
          />
          <span className="sr-only" data-testid="td-elapsed-value">
            {opponentRemaining ?? TURN_SECONDS}s
          </span>
        </>
      ) : (
        <div className="sd-clock-held">
          <span className="sd-clock-held-label">{heldLabel ?? (phase === "intro" ? "Clock starts with lot 1" : "Between lots")}</span>
          <span className="sd-clock-held-value">{TURN_SECONDS}s</span>
          <span className="sd-clock-held-sub">
            {phase === "intro" ? "The intro costs you none of it." : "Your full window opens with the next lot."}
          </span>
        </div>
      )}
    </div>
  );
}
