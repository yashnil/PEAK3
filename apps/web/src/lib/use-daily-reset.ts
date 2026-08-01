"use client";

/**
 * One hook, five modes: "this board just stopped being today's — go and get the
 * new one."
 *
 * WHY THIS EXISTS. Every daily surface fetched its board once, in an effect
 * whose dependencies never changed, and then never asked again. On `/daily/grid`
 * the dependency array was `[date, initialBoard]` and BOTH are permanently
 * `undefined` on the canonical route, so the board was fetched exactly once per
 * mount. Play through the reset and every answer posts yesterday's date; the
 * server then files the session as an archive replay and the player's streak
 * breaks even though they played straight through. Moving the boundary from
 * midnight UTC (17:00 PT — mid-afternoon) to midnight PT does not cause that
 * bug, but it does move it to the hour when the most tabs are sitting open.
 *
 * TWO TRIGGERS, because one is not enough:
 *
 *   1. THE COUNTDOWN REACHING ZERO, for a tab that is genuinely in the
 *      foreground at midnight.
 *   2. `visibilitychange` / `focus`, for the far more common case: the tab was
 *      backgrounded or the laptop was asleep. Timers are throttled to a crawl
 *      in a hidden tab and stop entirely while a machine is suspended, so a
 *      countdown alone would come back reading hours that never elapsed. There
 *      was no visibility or focus listener anywhere in the daily code before
 *      this.
 *
 * The deadline is ABSOLUTE (derived from the server's `ends_at`), never a
 * decremented counter, so sleep, throttling and a clock adjustment are all
 * handled by the same comparison.
 *
 * ARCHIVE BOARDS NEVER ARM. A board whose window has already closed reports
 * `seconds_remaining: 0`; arming on that would refetch in a loop and drag a
 * player off the archive board they deliberately opened.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type DailyWindowPayload,
  secondsRemaining as windowSecondsRemaining,
  todayPacific,
} from "@/lib/daily-time";

export interface UseDailyResetOptions {
  /** The server's `daily.daily_key` for the board currently on screen, or null
   *  while it is still loading. */
  dailyKey: string | null;
  /** The server's `daily.seconds_remaining`, or null while loading. `<= 0`
   *  means an archive board and disarms the hook entirely. */
  secondsRemaining: number | null;
  /** Fetch today's board again. Must be safe to call more than once. */
  onReset: () => void;
  /** Optional: the whole window, when the caller has it. Preferred over
   *  `secondsRemaining` because `ends_at` is absolute and therefore survives a
   *  suspended tab exactly. */
  window?: DailyWindowPayload | null;
  /** Test seam. */
  now?: () => Date;
}

export interface DailyResetState {
  /** Live seconds left on this board, or null when disarmed. */
  secondsLeft: number | null;
  /** True while a rollover is actually being watched for. */
  armed: boolean;
  /** Force the check immediately — used by the visibility listeners and
   *  exposed for a manual "check for a new board" affordance. */
  checkNow: () => void;
}

/** How often the foreground countdown re-renders. One second, so the last
 *  minute of a board reads as a real countdown rather than jumping. */
const TICK_MS = 1000;

export function useDailyReset({
  dailyKey,
  secondsRemaining,
  onReset,
  window: dailyWindow = null,
  now = () => new Date(),
}: UseDailyResetOptions): DailyResetState {
  const armed = dailyKey !== null && secondsRemaining !== null && secondsRemaining > 0;

  const [secondsLeft, setSecondsLeft] = useState<number | null>(
    armed ? secondsRemaining : null,
  );

  // The absolute instant this board stops being today's. Recomputed only when
  // the board itself changes, so a re-render cannot extend the deadline.
  const deadlineRef = useRef<number | null>(null);
  // The board a reset has already been fired for, so a rollover fires exactly
  // one refetch however many listeners notice it at once.
  const firedForRef = useRef<string | null>(null);
  // Latest callback without making it a dependency of the timer effect — a
  // caller that re-creates `onReset` every render must not restart the clock.
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;
  const nowRef = useRef(now);
  nowRef.current = now;

  useEffect(() => {
    if (!armed || dailyKey === null || secondsRemaining === null) {
      deadlineRef.current = null;
      setSecondsLeft(null);
      return;
    }
    const reference = nowRef.current().getTime();
    deadlineRef.current =
      dailyWindow !== null
        ? reference + windowSecondsRemaining(dailyWindow, nowRef.current()) * 1000
        : reference + secondsRemaining * 1000;
    firedForRef.current = null;
    setSecondsLeft(Math.max(0, Math.round((deadlineRef.current - reference) / 1000)));
  }, [armed, dailyKey, secondsRemaining, dailyWindow]);

  const checkNow = useCallback(() => {
    const deadline = deadlineRef.current;
    if (deadline === null || dailyKey === null) return;

    const current = nowRef.current();
    const left = Math.max(0, Math.round((deadline - current.getTime()) / 1000));
    setSecondsLeft(left);

    // Two independent reasons to consider this board stale. The deadline covers
    // the ordinary case; the key comparison covers a device that came back with
    // a corrected clock, or one whose countdown was never accurate to begin
    // with. Either is sufficient — neither is required.
    const pastDeadline = current.getTime() >= deadline;
    const keyMovedOn = todayPacific(current) !== dailyKey;
    if (!pastDeadline && !keyMovedOn) return;

    if (firedForRef.current === dailyKey) return;
    firedForRef.current = dailyKey;
    onResetRef.current();
  }, [dailyKey]);

  // --- the countdown ------------------------------------------------------
  useEffect(() => {
    if (!armed) return;
    const id = globalThis.setInterval(checkNow, TICK_MS);
    return () => globalThis.clearInterval(id);
  }, [armed, checkNow]);

  // --- coming back to the tab ---------------------------------------------
  // The case the countdown cannot cover: `setInterval` is throttled to roughly
  // once a minute in a hidden tab and does not run at all while the machine is
  // asleep, so the first thing that must happen on return is a check against
  // the absolute deadline.
  useEffect(() => {
    if (!armed) return;
    if (typeof document === "undefined") return;

    const onVisible = () => {
      if (document.visibilityState === "visible") checkNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    globalThis.addEventListener?.("focus", checkNow);
    globalThis.addEventListener?.("pageshow", checkNow);
    // Check once on mount too: a page restored from the back/forward cache can
    // be visible and focused without either event ever firing.
    checkNow();
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      globalThis.removeEventListener?.("focus", checkNow);
      globalThis.removeEventListener?.("pageshow", checkNow);
    };
  }, [armed, checkNow]);

  return { secondsLeft, armed, checkNow };
}
