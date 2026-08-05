"use client";
import { useEffect, useRef, useState } from "react";

/**
 * One seat's clock. Rendered for EVERY seat, in one of three states.
 *
 * WHY EVERY SEAT HAS ONE. The previous surface showed a single small countdown
 * in the draft-order strip, which answered "how long is left" but not "for
 * whom" -- and in a three-seat draft the second question is the one a player
 * is actually asking. Three visible clocks, one of them live, make the turn
 * itself legible: the dimmed pair are as informative as the running one.
 *
 * A BOT'S CLOCK IS NOT A HUMAN'S. A bot seat shows a short "thinking" state
 * rather than a 45-second countdown, because a bot's move lands on a seeded
 * 1-5 second delay the server enforces against the turn's stored `opened_at`.
 * Counting a human clock down for it would advertise a wait that is not going
 * to happen and make the draft feel four times slower than it is.
 *
 * ANNOUNCEMENTS ARE THRESHOLDED, NOT PER-TICK. `aria-live` on a number that
 * changes every second is a screen reader reading a countdown over whatever
 * the user was doing, for the whole turn. Only YOUR turn announces, only at
 * the moments that change a decision -- the start, thirty seconds, ten, five --
 * and the number itself is exposed as static text a reader can query whenever
 * it wants.
 */

/** Seconds at which the human's own clock announces. Descending, and only
 * crossed once per turn. */
const ANNOUNCE_AT = [30, 10, 5];

export default function SeatClock({
  seatIndex,
  isOnTurn,
  isBot,
  secondsRemaining,
}: {
  seatIndex: number;
  isOnTurn: boolean;
  isBot: boolean;
  secondsRemaining: number | null;
}) {
  const [announcement, setAnnouncement] = useState("");
  const lastCrossed = useRef<number | null>(null);

  useEffect(() => {
    if (!isOnTurn || isBot || secondsRemaining === null) {
      lastCrossed.current = null;
      setAnnouncement("");
      return;
    }
    const seconds = Math.max(0, Math.ceil(secondsRemaining));
    const threshold = ANNOUNCE_AT.find((value) => seconds <= value) ?? null;
    if (threshold !== null && threshold !== lastCrossed.current) {
      lastCrossed.current = threshold;
      setAnnouncement(`${threshold} seconds left to pick`);
    }
  }, [isOnTurn, isBot, secondsRemaining]);

  const state = !isOnTurn ? "idle" : isBot ? "thinking" : "live";
  const seconds =
    state === "live" && secondsRemaining !== null
      ? Math.max(0, Math.ceil(secondsRemaining))
      : null;
  const urgent = seconds !== null && seconds <= 10;

  return (
    <span
      data-testid={`tmw-seat-clock-${seatIndex}`}
      data-state={state}
      data-urgent={urgent ? "true" : "false"}
      className="tmw-clock"
    >
      {state === "live" && (
        <>
          <span className="tmw-clock-value" aria-hidden="true">
            {seconds ?? "—"}
            <span className="tmw-clock-unit">s</span>
          </span>
          <span className="sr-only">{`${seconds ?? 0} seconds left on this pick`}</span>
        </>
      )}
      {state === "thinking" && (
        <span className="tmw-clock-thinking" data-testid={`tmw-seat-thinking-${seatIndex}`}>
          <span className="tmw-clock-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="sr-only">Thinking</span>
        </span>
      )}
      {state === "idle" && (
        <span className="tmw-clock-idle" aria-hidden="true">
          —
        </span>
      )}

      {/* One polite region per seat, written only at the thresholds above. */}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </span>
  );
}
