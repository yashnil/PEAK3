/**
 * The client half of the daily-window contract.
 *
 * Two things are being proved here, and they are different things:
 *
 *   1. THE CLIENT AGREES WITH THE SERVER. The Pacific fallback in
 *      `lib/daily-time.ts` has to produce exactly the key `nba_peak/daily_key.py`
 *      would — one minute either side of midnight PT, on the spring-forward and
 *      fall-back days, on a leap day and across a year boundary. The expected
 *      values below are the same ones asserted in `tests/test_daily_key.py`, so
 *      a divergence fails on both sides.
 *   2. A ROLLOVER ACTUALLY REFETCHES. The bug this pass fixes is not that the
 *      boundary was in the wrong place; it is that nothing ever asked the
 *      server for a new board once the countdown expired, and that a
 *      backgrounded tab never noticed at all.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  DAILY_TIMEZONE,
  type DailyWindowPayload,
  daysBetweenKeys,
  extractDailyWindow,
  formatCountdown,
  hasWindowClosed,
  isDailyWindowPayload,
  localDailyWindow,
  pacificMidnightUtc,
  secondsRemaining,
  secondsUntilNextPacificMidnight,
  shiftDailyKey,
  todayPacific,
} from "@/lib/daily-time";
import { useDailyReset } from "@/lib/use-daily-reset";

const HOUR = 3600;

function window_(overrides: Partial<DailyWindowPayload> = {}): DailyWindowPayload {
  return {
    daily_key: "2026-08-01",
    timezone: DAILY_TIMEZONE,
    starts_at: "2026-08-01T07:00:00Z",
    ends_at: "2026-08-02T07:00:00Z",
    seconds_remaining: 24 * HOUR,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Agreeing with the server about what day it is
// ---------------------------------------------------------------------------

describe("the Pacific boundary", () => {
  it("rolls over at midnight PT, not midnight UTC", () => {
    // 23:59 PDT on 2026-07-31.
    expect(todayPacific(new Date("2026-08-01T06:59:00Z"))).toBe("2026-07-31");
    // 00:00 PDT on 2026-08-01.
    expect(todayPacific(new Date("2026-08-01T07:00:00Z"))).toBe("2026-08-01");
    expect(todayPacific(new Date("2026-08-01T07:01:00Z"))).toBe("2026-08-01");
    // Midnight UTC is 17:00 the previous afternoon in California. This is the
    // whole regression: it used to swap the board out mid-session.
    expect(todayPacific(new Date("2026-08-01T00:00:00Z"))).toBe("2026-07-31");
  });

  it("is eight hours behind UTC in winter and seven in summer", () => {
    expect(todayPacific(new Date("2026-01-15T07:59:00Z"))).toBe("2026-01-14");
    expect(todayPacific(new Date("2026-01-15T08:00:00Z"))).toBe("2026-01-15");
    expect(todayPacific(new Date("2026-07-15T06:59:00Z"))).toBe("2026-07-14");
    expect(todayPacific(new Date("2026-07-15T07:00:00Z"))).toBe("2026-07-15");
  });

  it("handles the leap day", () => {
    expect(todayPacific(new Date("2028-02-29T07:59:00Z"))).toBe("2028-02-28");
    expect(todayPacific(new Date("2028-02-29T08:00:00Z"))).toBe("2028-02-29");
    expect(todayPacific(new Date("2028-03-01T07:59:00Z"))).toBe("2028-02-29");
    expect(todayPacific(new Date("2028-03-01T08:00:00Z"))).toBe("2028-03-01");
  });

  it("handles the year boundary", () => {
    expect(todayPacific(new Date("2027-01-01T07:59:00Z"))).toBe("2026-12-31");
    expect(todayPacific(new Date("2027-01-01T08:00:00Z"))).toBe("2027-01-01");
  });

  it("resolves local midnight to the right absolute instant on both DST days", () => {
    // Spring forward: the day OPENS at UTC-8.
    expect(pacificMidnightUtc("2026-03-08")?.toISOString()).toBe("2026-03-08T08:00:00.000Z");
    // ...and CLOSES at UTC-7, which is what makes it 23 hours.
    expect(pacificMidnightUtc("2026-03-09")?.toISOString()).toBe("2026-03-09T07:00:00.000Z");
    // Fall back: opens at UTC-7, closes at UTC-8 — 25 hours.
    expect(pacificMidnightUtc("2026-11-01")?.toISOString()).toBe("2026-11-01T07:00:00.000Z");
    expect(pacificMidnightUtc("2026-11-02")?.toISOString()).toBe("2026-11-02T08:00:00.000Z");
  });

  it("makes the spring-forward day 23 hours and the fall-back day 25", () => {
    expect(secondsUntilNextPacificMidnight(new Date("2026-03-08T08:00:00Z"))).toBe(23 * HOUR);
    expect(secondsUntilNextPacificMidnight(new Date("2026-11-01T07:00:00Z"))).toBe(25 * HOUR);
    expect(secondsUntilNextPacificMidnight(new Date("2026-07-15T07:00:00Z"))).toBe(24 * HOUR);
  });

  it("gives one key for the repeated local hour on the fall-back day", () => {
    // 01:30 PT happens twice. Both instants belong to the 1st.
    expect(todayPacific(new Date("2026-11-01T08:30:00Z"))).toBe("2026-11-01");
    expect(todayPacific(new Date("2026-11-01T09:30:00Z"))).toBe("2026-11-01");
  });

  it("shifts and differences keys without tripping over month or year ends", () => {
    expect(shiftDailyKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDailyKey("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDailyKey("2026-03-08", -1)).toBe("2026-03-07");
    expect(daysBetweenKeys("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetweenKeys("2026-12-31", "2027-01-01")).toBe(1);
    expect(Number.isNaN(daysBetweenKeys("nope", "2027-01-01"))).toBe(true);
  });

  it("synthesises a local window that matches its own helpers", () => {
    const now = new Date("2026-08-01T18:00:00Z");
    const w = localDailyWindow(now);
    expect(w.daily_key).toBe("2026-08-01");
    expect(w.timezone).toBe(DAILY_TIMEZONE);
    expect(w.starts_at).toBe("2026-08-01T07:00:00.000Z");
    expect(w.ends_at).toBe("2026-08-02T07:00:00.000Z");
    expect(w.seconds_remaining).toBe(13 * HOUR);
  });
});

// ---------------------------------------------------------------------------
// The wire object
// ---------------------------------------------------------------------------

describe("the daily window payload", () => {
  it("accepts the frozen contract and rejects anything else", () => {
    expect(isDailyWindowPayload(window_())).toBe(true);
    expect(isDailyWindowPayload({ ...window_(), daily_key: "01-08-2026" })).toBe(false);
    expect(isDailyWindowPayload({ ...window_(), seconds_remaining: "soon" })).toBe(false);
    expect(isDailyWindowPayload(null)).toBe(false);
    expect(isDailyWindowPayload(undefined)).toBe(false);
    expect(isDailyWindowPayload({})).toBe(false);
  });

  it("is pulled off a response by key, and degrades to null when absent", () => {
    expect(extractDailyWindow({ date: "2026-08-01", daily: window_() })).toEqual(window_());
    // An API old enough not to send the block must degrade, never crash.
    expect(extractDailyWindow({ date: "2026-08-01" })).toBeNull();
    expect(extractDailyWindow({ daily: { nonsense: true } })).toBeNull();
    expect(extractDailyWindow(null)).toBeNull();
  });

  it("counts down from the absolute ends_at, not from the number it was sent", () => {
    // A tab suspended for six hours receives no timer callbacks at all, so a
    // decremented counter would come back six hours too high.
    const w = window_({ seconds_remaining: 24 * HOUR });
    expect(secondsRemaining(w, new Date("2026-08-02T01:00:00Z"))).toBe(6 * HOUR);
    expect(secondsRemaining(w, new Date("2026-08-02T06:59:00Z"))).toBe(60);
  });

  it("never reports a negative countdown", () => {
    const w = window_();
    expect(secondsRemaining(w, new Date("2026-08-05T00:00:00Z"))).toBe(0);
    expect(hasWindowClosed(w, new Date("2026-08-05T00:00:00Z"))).toBe(true);
    expect(hasWindowClosed(w, new Date("2026-08-01T12:00:00Z"))).toBe(false);
  });

  it("formats a countdown coarsely above a minute", () => {
    expect(formatCountdown(6 * HOUR + 41 * 60)).toBe("6h 41m");
    expect(formatCountdown(12 * 60)).toBe("12m");
    expect(formatCountdown(48)).toBe("48s");
    expect(formatCountdown(0)).toBe("0s");
    expect(formatCountdown(-5)).toBe("0s");
  });
});

// ---------------------------------------------------------------------------
// The rollover itself
// ---------------------------------------------------------------------------

describe("useDailyReset", () => {
  /** A window that is internally consistent: `ends_at` really is
   *  `secondsLeft` away from the clock the hook is about to read. The hook
   *  trusts `ends_at` over the number, because only the absolute instant
   *  survives a suspended tab. */
  function setup(
    secondsLeft: number,
    startedAt = "2026-08-01T12:00:00Z",
    dailyKey = "2026-08-01",
  ) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(startedAt));
    const onReset = vi.fn();
    const w = window_({
      daily_key: dailyKey,
      ends_at: new Date(Date.parse(startedAt) + secondsLeft * 1000).toISOString(),
      seconds_remaining: secondsLeft,
    });
    const hook = renderHook(() =>
      useDailyReset({
        dailyKey: w.daily_key,
        secondsRemaining: w.seconds_remaining,
        window: w,
        onReset,
      }),
    );
    return { hook, onReset };
  }

  it("fires exactly once when the countdown reaches zero", () => {
    const { hook, onReset } = setup(5);
    expect(onReset).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(onReset).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onReset).toHaveBeenCalledTimes(1);
    // Still exactly once after the timer keeps running — a rollover must not
    // turn into a refetch loop.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(hook.result.current.secondsLeft).toBe(0);
  });

  it("exposes a live countdown while the board is current", () => {
    const { hook } = setup(120);
    expect(hook.result.current.secondsLeft).toBe(120);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(hook.result.current.secondsLeft).toBe(90);
    expect(hook.result.current.armed).toBe(true);
  });

  it("fires when a backgrounded tab comes back past the boundary", () => {
    // The case a countdown alone cannot cover: `setInterval` is throttled in a
    // hidden tab and stops entirely while the machine is asleep, so the first
    // thing that must happen on return is a check against the absolute
    // deadline. There was no visibilitychange or focus listener at all before
    // this hook existed.
    const { onReset } = setup(6 * HOUR);
    expect(onReset).not.toHaveBeenCalled();

    // Eight hours pass with no timer callbacks whatsoever.
    vi.setSystemTime(new Date("2026-08-01T20:00:00Z"));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("also fires on window focus", () => {
    const { onReset } = setup(6 * HOUR);
    vi.setSystemTime(new Date("2026-08-01T20:00:00Z"));
    act(() => {
      globalThis.dispatchEvent(new Event("focus"));
    });
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("does nothing when a visible tab is still inside its window", () => {
    const { onReset } = setup(6 * HOUR);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      globalThis.dispatchEvent(new Event("focus"));
      vi.advanceTimersByTime(60_000);
    });
    expect(onReset).not.toHaveBeenCalled();
  });

  it("never arms on an archive board", () => {
    // An archive board reports `seconds_remaining: 0`. Arming would refetch in
    // a loop and drag the player off the board they deliberately opened.
    const { hook, onReset } = setup(0, "2026-08-01T12:00:00Z", "2026-01-01");
    expect(hook.result.current.armed).toBe(false);
    expect(hook.result.current.secondsLeft).toBeNull();
    act(() => {
      vi.advanceTimersByTime(60_000);
      document.dispatchEvent(new Event("visibilitychange"));
      globalThis.dispatchEvent(new Event("focus"));
    });
    expect(onReset).not.toHaveBeenCalled();
  });

  it("stays disarmed while the board is still loading", () => {
    vi.useFakeTimers();
    const onReset = vi.fn();
    const hook = renderHook(() =>
      useDailyReset({ dailyKey: null, secondsRemaining: null, onReset }),
    );
    expect(hook.result.current.armed).toBe(false);
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(onReset).not.toHaveBeenCalled();
  });

  it("fires when the local day has moved on even if the deadline says otherwise", () => {
    // Belt and braces for a device whose clock was wrong when the window was
    // received and has since been corrected.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T12:00:00Z")); // already the 2nd in PT
    const onReset = vi.fn();
    renderHook(() =>
      useDailyReset({
        dailyKey: "2026-08-01",
        secondsRemaining: 10 * HOUR,
        onReset,
      }),
    );
    act(() => {
      globalThis.dispatchEvent(new Event("focus"));
    });
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
