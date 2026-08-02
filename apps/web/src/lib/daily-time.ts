/**
 * The client half of the shared daily-window contract.
 *
 * THE SERVER OWNS "TODAY". Every daily API response carries one object at the
 * top level under the key `daily`, produced by `DailyWindow.to_payload()` in
 * `nba_peak/daily_key.py`:
 *
 *   { daily_key, timezone, starts_at, ends_at, seconds_remaining }
 *
 * The browser's job is to COUNT DOWN from it, not to re-derive it. That
 * division is the whole point: before it, three of the five daily modes let the
 * browser compute `today` and sent it to the server as `?date=`, so a device
 * one timezone ahead played tomorrow's board, a device behind played
 * yesterday's, and a tab left open through the rollover played a board that no
 * longer existed while its answers were filed as an archive replay.
 *
 * The Pacific helpers below are a deliberately narrow FALLBACK, used only when
 * no server window is at hand (a purely local surface such as the streak
 * archive, or an API that could not be reached). They convert through the
 * browser's own IANA tz database rather than a hardcoded -08:00, so the
 * spring-forward and fall-back days are handled correctly; but where a server
 * window exists, it always wins.
 */

/** The product-wide daily reset zone. Mirrors `DAILY_TIMEZONE` in nba_peak/daily_key.py. */
export const DAILY_TIMEZONE = "America/Los_Angeles";

/** The wire object every daily API response embeds under the key `daily`. */
export interface DailyWindowPayload {
  /** YYYY-MM-DD in `timezone`. The identity of the board. */
  daily_key: string;
  /** IANA zone name — always "America/Los_Angeles" today. */
  timezone: string;
  /** ISO-8601 UTC instant the window opens (inclusive). */
  starts_at: string;
  /** ISO-8601 UTC instant the window closes (exclusive). */
  ends_at: string;
  /** Seconds from when the server answered until `ends_at`. Floored at 0. */
  seconds_remaining: number;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Runtime shape check — the payload crosses a network boundary, so it is
 *  validated rather than asserted. An older API that predates the `daily` block
 *  must degrade to "no window", never to a NaN countdown. */
export function isDailyWindowPayload(value: unknown): value is DailyWindowPayload {
  if (!value || typeof value !== "object") return false;
  const w = value as Partial<DailyWindowPayload>;
  return (
    typeof w.daily_key === "string" &&
    DATE_PATTERN.test(w.daily_key) &&
    typeof w.timezone === "string" &&
    typeof w.starts_at === "string" &&
    typeof w.ends_at === "string" &&
    typeof w.seconds_remaining === "number" &&
    Number.isFinite(w.seconds_remaining)
  );
}

/** Pull the `daily` block off any daily API response, or null.
 *
 *  Takes `unknown` on purpose: the generated response types do not all declare
 *  the field yet, and a cast would turn a missing block into a crash at the
 *  first property read instead of a graceful fallback. */
export function extractDailyWindow(payload: unknown): DailyWindowPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const daily = (payload as { daily?: unknown }).daily;
  return isDailyWindowPayload(daily) ? daily : null;
}

// ---------------------------------------------------------------------------
// Counting down
// ---------------------------------------------------------------------------

/**
 * Seconds left in `window` as of `now`, measured from the ABSOLUTE `ends_at`.
 *
 * Deliberately not "the number the server sent, minus ticks since": a tab that
 * was suspended for six hours stops receiving timer callbacks entirely, so a
 * decremented counter would come back reading six hours too high. An absolute
 * deadline is correct across sleep, throttling and clock adjustment alike.
 */
export function secondsRemaining(
  window: DailyWindowPayload,
  now: Date = new Date(),
): number {
  const ends = Date.parse(window.ends_at);
  if (Number.isNaN(ends)) return Math.max(0, Math.floor(window.seconds_remaining));
  return Math.max(0, Math.floor((ends - now.getTime()) / 1000));
}

/** Has this board's window closed? True for any archive board. */
export function hasWindowClosed(
  window: DailyWindowPayload,
  now: Date = new Date(),
): boolean {
  return secondsRemaining(window, now) <= 0;
}

/**
 * "6h 41m", "12m", "48s". Coarse above a minute on purpose: a second-by-second
 * countdown to a board fourteen hours away is noise, not information.
 */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

// ---------------------------------------------------------------------------
// Pacific fallback — only for surfaces with no server window
// ---------------------------------------------------------------------------

/** The Pacific wall-clock parts of an absolute instant, via the browser's own
 *  IANA tz data (so DST is real, not assumed). */
function pacificParts(instant: Date): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DAILY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // Intl renders midnight as "24" in some engines for hourCycle h23/h24 edge
  // cases; normalise it to 0 so a boundary comparison cannot silently miss.
  const hour = Number(get("hour")) % 24;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour,
    minute: Number(get("minute")),
  };
}

/** Today's daily key in the reset zone, derived locally.
 *
 *  A FALLBACK. Prefer the server's `daily.daily_key` wherever a response is
 *  available — that is the value the board was actually generated from. */
export function todayPacific(now: Date = new Date()): string {
  return pacificParts(now).date;
}

/** `key` shifted by `days`, as YYYY-MM-DD. Pure calendar arithmetic on a date
 *  string, so leap days and year boundaries are handled by Date, not by us. */
export function shiftDailyKey(key: string, days: number): string {
  const ms = Date.parse(`${key}T00:00:00Z`);
  if (Number.isNaN(ms)) return key;
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, both YYYY-MM-DD. Negative if `to` is
 *  earlier, NaN if either is unparseable. Both are read as UTC midnight, so a
 *  DST day cannot come out as 0 or 2. */
export function daysBetweenKeys(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.round((b - a) / 86_400_000);
}

/**
 * The absolute instant at which local midnight begins for a Pacific date.
 *
 * Pacific is UTC-7 or UTC-8 depending on the season, so both candidates are
 * tried and the one that genuinely reads back as 00:00 on that date is the
 * answer. On the spring-forward date only the -8 candidate round-trips and on
 * the fall-back date only the -7 one does, which is precisely what makes those
 * two days 23 and 25 hours long instead of 24.
 */
export function pacificMidnightUtc(dailyKey: string): Date | null {
  const base = Date.parse(`${dailyKey}T00:00:00Z`);
  if (Number.isNaN(base)) return null;
  for (const offsetHours of [7, 8]) {
    const candidate = new Date(base + offsetHours * 3_600_000);
    const parts = pacificParts(candidate);
    if (parts.date === dailyKey && parts.hour === 0 && parts.minute === 0) {
      return candidate;
    }
  }
  return null;
}

/** Seconds until the next Pacific midnight. Fallback only — prefer counting
 *  down from a server window. */
export function secondsUntilNextPacificMidnight(now: Date = new Date()): number {
  const next = pacificMidnightUtc(shiftDailyKey(todayPacific(now), 1));
  if (next === null) return 0;
  return Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000));
}

/**
 * A window synthesised from the local clock, for a surface that has no server
 * response to read one from. Marked by construction: it uses the same zone and
 * the same arithmetic the server does, so it agrees with the server except
 * across a device whose own clock is wrong.
 */
export function localDailyWindow(now: Date = new Date()): DailyWindowPayload {
  const key = todayPacific(now);
  const starts = pacificMidnightUtc(key);
  const ends = pacificMidnightUtc(shiftDailyKey(key, 1));
  return {
    daily_key: key,
    timezone: DAILY_TIMEZONE,
    starts_at: (starts ?? now).toISOString(),
    ends_at: (ends ?? now).toISOString(),
    seconds_remaining: secondsUntilNextPacificMidnight(now),
  };
}
