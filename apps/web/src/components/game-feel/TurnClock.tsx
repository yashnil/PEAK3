"use client";

/**
 * TurnClock — one clock for every seat.
 *
 * The local player's turn had a live, depleting timer and everybody else's
 * turn had a static number beside "Thinking…", which is why a room went
 * visually dead the moment the human could not act. This is the same
 * mechanism for all three cases: a deadline the server published, a total
 * the server published, a number and a bar that deplete against them, and
 * an owner that only changes the words and the tone.
 *
 * IT DECIDES NOTHING. Reaching zero changes the state attribute and nothing
 * else; the server owns the timeout. The bar is `--gf-clock-fraction` on the
 * root so the stylesheet draws it and a test can read it.
 */

import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/a11y";

export type TurnClockOwner = "you" | "rival" | "bot" | "none";

export interface TurnClockProps {
  /** `performance.now()`-based deadline, or null when nothing is running. */
  deadlineAt: number | null;
  /** The whole turn, in seconds — the bar's denominator. */
  totalSeconds: number;
  owner: TurnClockOwner;
  /** Overrides the owner's default status word. */
  label?: string;
  warnAtSeconds?: number;
  size?: "sm" | "md";
  testId?: string;
  className?: string;
}

const OWNER_LABEL: Record<TurnClockOwner, string> = {
  you: "Your pick",
  rival: "On the clock",
  bot: "Thinking",
  none: "",
};

const TICK_MS = 100;

export default function TurnClock({
  deadlineAt,
  totalSeconds,
  owner,
  label,
  warnAtSeconds = 5,
  size = "md",
  testId = "turn-clock",
  className,
}: TurnClockProps) {
  const reduced = usePrefersReducedMotion();
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (deadlineAt === null) {
      setRemaining(null);
      return;
    }
    const tick = () => setRemaining(Math.max(0, (deadlineAt - performance.now()) / 1000));
    tick();
    const id = window.setInterval(tick, reduced ? 1000 : TICK_MS);
    return () => window.clearInterval(id);
  }, [deadlineAt, reduced]);

  const running = deadlineAt !== null && remaining !== null;
  const whole = running ? Math.ceil(remaining) : null;
  const fraction = running && totalSeconds > 0 ? Math.max(0, Math.min(1, remaining / totalSeconds)) : 0;
  const state = !running ? "idle" : whole !== null && whole <= 0 ? "expired" : whole !== null && whole <= warnAtSeconds ? "warning" : "running";
  const text = label ?? OWNER_LABEL[owner];

  return (
    <div
      className={`gf-clock ${className ?? ""}`}
      data-testid={testId}
      data-state={state}
      data-owner={owner}
      data-size={size}
      data-reduced-motion={reduced ? "true" : "false"}
      style={{ ["--gf-clock-fraction" as string]: fraction.toFixed(3) }}
    >
      {text ? (
        <span className="gf-clock-label" data-testid={`${testId}-label`}>
          {text}
          {owner === "bot" && running ? <span className="gf-clock-ellipsis" aria-hidden="true" /> : null}
        </span>
      ) : null}
      <span className="gf-clock-value" data-testid={`${testId}-value`} aria-hidden="true">
        {running ? whole : "—"}
      </span>
      <span className="gf-clock-track" aria-hidden="true">
        <span className="gf-clock-fill" />
      </span>
    </div>
  );
}
