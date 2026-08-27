"use client";

/**
 * PeakV2ShowdownClock — V2 presentation of the four real clock modes
 * (Pass 3): countdown (your decision), elapsed (opponent's, counting down
 * against their published deadline), held (nobody on the clock yet) and
 * pending (a command is in flight, clock frozen). Same mode-selection logic
 * as legacy `ShowdownClock`; the real countdown/expiry authority is the
 * hidden `ArenaTimer` instance below — this never invents a second timer.
 */

import { useEffect, useState } from "react";
import ArenaTimer, { useRemainingSeconds } from "@/components/shared/ArenaTimer";
import { TURN_SECONDS, formatDollars } from "@/lib/twenty-dollar-api";
import type { ShowdownPhase } from "@/components/twenty-dollar/useShowdownPhase";

function useElapsedFallback(deadlineAt: number | null): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (deadlineAt !== null) return;
    const startedAt = performance.now();
    const id = window.setInterval(() => setElapsed(Math.floor((performance.now() - startedAt) / 1000)), 250);
    return () => window.clearInterval(id);
  }, [deadlineAt]);
  return elapsed;
}

export interface PeakV2ShowdownClockProps {
  phase: ShowdownPhase;
  deadlineAt: number | null;
  activeSeat: number | null;
  yourSeat: number | null;
  consequence?: string | null;
  turnKey: string;
  opponentDeadlineAt?: number | null;
  pendingCommand: "bid" | "pass" | null;
  pendingAmount: number;
  onExpire: () => void;
}

export default function PeakV2ShowdownClock({
  phase,
  deadlineAt,
  activeSeat,
  yourSeat,
  consequence,
  opponentDeadlineAt = null,
  pendingCommand,
  pendingAmount,
  onExpire,
}: PeakV2ShowdownClockProps) {
  const yours = activeSeat !== null && activeSeat === yourSeat;
  const yourRemaining = useRemainingSeconds(phase === "decide" && yours ? deadlineAt : null);
  const opponentRemaining = useRemainingSeconds(opponentDeadlineAt);
  const opponentElapsed = useElapsedFallback(opponentDeadlineAt);

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
      className="flex flex-col items-center gap-1"
      data-testid="td-clock"
      data-mode={mode}
      // C3: every mode that shows a real number counts DOWN toward zero
      // (your own countdown, or the opponent's published remaining time) —
      // never up. `elapsed`'s own label still says "Their time" when the
      // server publishes a real remaining figure, and "Time elapsed" only
      // in the no-figure fallback, but the direction is down either way.
      data-direction="down"
      data-yours={mode === "countdown" ? "true" : undefined}
    >
      {/* Real expiry authority — visually hidden, screen-reader announcements preserved. */}
      <div className="sr-only">
        <ArenaTimer deadlineAt={deadlineAt} totalSeconds={TURN_SECONDS} label="Time remaining" consequence={consequence} yours onExpire={onExpire} testId="td-timer" />
      </div>

      {mode === "pending" ? (
        <div data-testid="td-pending" className="flex flex-col items-center gap-1">
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--v2-color-accent)" }} />
          <p style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", color: "var(--v2-text-secondary)" }}>
            {pendingCommand === "bid" ? `Sending your ${formatDollars(pendingAmount)} bid…` : "Sending your decision…"}
          </p>
        </div>
      ) : mode === "countdown" ? (
        <>
          <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--v2-text-muted)" }}>
            To act
          </span>
          <span
            style={{
              fontFamily: "var(--v2-font-mono)",
              fontVariantNumeric: "tabular-nums",
              fontSize: "3rem",
              fontWeight: 700,
              lineHeight: 1,
              color: yourRemaining !== null && yourRemaining <= 5 ? "var(--v2-color-negative)" : "var(--v2-color-accent)",
            }}
          >
            {yourRemaining ?? TURN_SECONDS}
          </span>
          <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.6875rem", color: "var(--v2-text-muted)" }}>seconds</span>
        </>
      ) : mode === "elapsed" ? (
        <>
          <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--v2-text-muted)" }}>
            {opponentRemaining !== null ? "Their time" : "Time elapsed"}
          </span>
          <span
            data-testid="td-elapsed-value"
            style={{ fontFamily: "var(--v2-font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "2rem", fontWeight: 700, lineHeight: 1, color: "var(--v2-text-secondary)" }}
          >
            {opponentRemaining ?? opponentElapsed}s
          </span>
        </>
      ) : (
        <>
          <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--v2-text-muted)" }}>
            {activeSeat === null || phase === "intro" ? "Next clock" : "Your clock"}
          </span>
          <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "2rem", fontWeight: 700, color: "var(--v2-text-muted)" }}>{TURN_SECONDS}s</span>
          <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.6875rem", color: "var(--v2-text-muted)" }}>
            {phase === "intro"
              ? "Starts when the first lot opens — the intro costs you none of it."
              : activeSeat === null
                ? "Starts when the next lot opens."
                : "Opens in a moment — you get the full window."}
          </span>
        </>
      )}
    </div>
  );
}
