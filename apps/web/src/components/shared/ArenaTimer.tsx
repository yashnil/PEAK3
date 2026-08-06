"use client";

import { useEffect, useRef, useState } from "react";

import { usePrefersReducedMotion } from "@/lib/a11y";

/**
 * The decision clock. One component, one state, and NOTHING above it rerenders
 * on a tick.
 *
 * WHY IT IS ITS OWN COMPONENT (PART 2 and PART 25). Both game rooms used to
 * hold `countdown` in the ROOM's state and pass it down, so every second the
 * whole tree re-rendered: both roster panels, the candidate card, the bid
 * controls, the settled-lot list. That is twenty full reconciliations per turn
 * for a number that occupies four characters, and it is the largest single
 * cause of the reported lag. The countdown now lives here; the room passes a
 * DEADLINE, which changes only when the authoritative state does.
 *
 * WHY THE INPUT IS A DEADLINE AND NOT A NUMBER OF SECONDS. The server sends
 * `seconds_remaining` as a DURATION, which is right — a client with a skewed
 * wall clock still counts down correctly. But a duration re-seeded on every
 * poll drifts: the room polls every two seconds, so a value could be up to a
 * poll interval stale, and the old surface then ticked it down locally from
 * that stale start. A player watching "3" could genuinely be at zero. Here the
 * room converts the duration into a LOCAL MONOTONIC DEADLINE the instant the
 * response lands (`performance.now() + seconds * 1000`) and the tick measures
 * against that, so the only error left is the round trip itself.
 *
 * IT DECIDES NOTHING. Reaching zero fires `onExpire` so the surface can say
 * "settling…" and stop offering an action that cannot succeed; it never submits
 * anything and never resolves a turn. The server owns the timeout, and it
 * allows a grace window (`ACTION_GRACE_SECONDS`) precisely so an action sent at
 * the last moment still lands.
 *
 * ACCESSIBILITY. The value is `aria-hidden` and announced only at 10 seconds, 5
 * seconds and expiry through a polite live region — a per-second live region
 * would talk over everything else on the page, which is why the thresholds are
 * a requirement rather than a nicety.
 */

/** Seconds at which the clock announces itself to assistive technology. */
const ANNOUNCE_AT = [10, 5] as const;

/** Below this, the clock reads as urgent. */
const URGENT_BELOW = 5;

export interface ArenaTimerProps {
  /**
   * `performance.now()`-based deadline, or null when this seat is not on the
   * clock. Null is a real state and NOT "zero": between lots, and on the
   * opponent's turn, there is nothing to count.
   */
  deadlineAt: number | null;
  /** Total seconds in the turn, for the progress arc. */
  totalSeconds: number;
  /** "YOUR TURN" / "Floor General" — attached to the participant, per PART 2. */
  label: string;
  /** What expiry will do, in words. Rendered under the number. */
  consequence?: string | null;
  /** Whether this is the local player's clock (changes the urgency treatment). */
  yours?: boolean;
  /** Fired once when the local countdown reaches zero. Never submits anything. */
  onExpire?: () => void;
  testId?: string;
}

export default function ArenaTimer({
  deadlineAt,
  totalSeconds,
  label,
  consequence,
  yours = false,
  onExpire,
  testId = "arena-timer",
}: ArenaTimerProps) {
  const reduced = usePrefersReducedMotion();
  const [remaining, setRemaining] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const announced = useRef<Set<number>>(new Set());
  const expired = useRef(false);
  // Held in a ref so a parent that re-creates the callback cannot restart the
  // interval mid-turn.
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    announced.current = new Set();
    expired.current = false;
    setAnnouncement("");
    if (deadlineAt === null) {
      setRemaining(null);
      return;
    }

    const tick = () => {
      const left = Math.max(0, (deadlineAt - performance.now()) / 1000);
      setRemaining(left);
      const whole = Math.ceil(left);
      for (const threshold of ANNOUNCE_AT) {
        if (whole === threshold && !announced.current.has(threshold)) {
          announced.current.add(threshold);
          setAnnouncement(`${threshold} seconds remaining.`);
        }
      }
      if (left <= 0 && !expired.current) {
        expired.current = true;
        setAnnouncement("Time expired.");
        onExpireRef.current?.();
      }
    };

    tick();
    // 250 ms rather than 1 s so the displayed number changes at the moment it
    // should rather than up to a second late. This component is four
    // characters of DOM, so the cost of a finer tick is nil — which is exactly
    // the argument for isolating it from the tree in the first place.
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [deadlineAt]);

  if (deadlineAt === null || remaining === null) {
    return (
      <div className="ar-timer ar-timer--idle" data-testid={testId} data-state="idle">
        <span className="ar-timer-label">{label}</span>
      </div>
    );
  }

  const whole = Math.ceil(remaining);
  const urgent = whole <= URGENT_BELOW;
  const fraction = totalSeconds > 0 ? Math.max(0, Math.min(1, remaining / totalSeconds)) : 0;

  return (
    <div
      className="ar-timer"
      data-testid={testId}
      data-state={whole <= 0 ? "expired" : urgent ? "urgent" : "running"}
      data-yours={yours ? "true" : "false"}
      data-reduced-motion={reduced ? "true" : "false"}
      style={{ ["--ar-timer-fraction" as string]: String(fraction) }}
    >
      <span className="ar-timer-label">{label}</span>
      <span className="ar-timer-value" data-testid={`${testId}-value`} aria-hidden="true">
        {whole}
      </span>
      <span className="ar-timer-unit" aria-hidden="true">
        {whole === 1 ? "second" : "seconds"}
      </span>
      <span className="ar-timer-track" aria-hidden="true">
        <span className="ar-timer-fill" />
      </span>
      {consequence ? (
        <span className="ar-timer-consequence" data-testid={`${testId}-consequence`}>
          {consequence}
        </span>
      ) : null}
      {/* THRESHOLDS, NOT EVERY SECOND. See the module docstring. */}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}

/**
 * Convert the server's `seconds_remaining` duration into a local monotonic
 * deadline, at the instant the response is applied.
 *
 * Exported so both game rooms use the same conversion and neither can
 * accidentally hold a duration in state and tick it down — the drift this
 * component exists to remove.
 */
export function deadlineFromSeconds(seconds: number | null | undefined): number | null {
  if (seconds === null || seconds === undefined) return null;
  if (typeof performance === "undefined") return null;
  return performance.now() + Math.max(0, seconds) * 1000;
}
