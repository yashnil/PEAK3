/**
 * THE SERVER'S SHARE OF AN ACTION'S ROUND TRIP, read off `Server-Timing`.
 *
 * The API stamps every Arena poll and command with stage durations
 * (`api/v1/arena.py::_RouteTiming`: `read`, `clock`, `apply`, `bots`, `view`,
 * `total`). Attaching the parsed header to the response object it arrived
 * with -- as a non-enumerable property, so it never reaches a renderer, a
 * snapshot comparison or a JSON dump -- lets the room split a slow action into
 * network time and server time without a second request or a shared "last
 * timing" that a concurrent poll could overwrite.
 */

export interface ServerTiming {
  /** The route's own total, in milliseconds, or null when absent. */
  totalMs: number | null;
  /** Every named stage, in milliseconds. */
  stages: Record<string, number>;
}

const SERVER_TIMING = Symbol.for("peak3.serverTiming");

/** Parse `name;dur=1.2, other;dur=3.4`. Unknown shapes are skipped, never thrown. */
export function parseServerTiming(header: string | null | undefined): ServerTiming | null {
  if (!header) return null;
  const stages: Record<string, number> = {};
  for (const entry of header.split(",")) {
    const [rawName, ...params] = entry.trim().split(";");
    const name = rawName?.trim();
    if (!name) continue;
    const dur = params.map((p) => p.trim()).find((p) => p.startsWith("dur="));
    if (!dur) continue;
    const value = Number(dur.slice(4));
    if (Number.isFinite(value)) stages[name] = value;
  }
  if (Object.keys(stages).length === 0) return null;
  return { totalMs: stages.total ?? null, stages };
}

/** Attach a parsed header to a decoded response body. Returns the body. */
export function attachServerTiming<T>(body: T, header: string | null | undefined): T {
  const timing = parseServerTiming(header);
  if (timing && body !== null && typeof body === "object") {
    try {
      Object.defineProperty(body, SERVER_TIMING, { value: timing, enumerable: false, configurable: true });
    } catch {
      // A frozen body simply carries no timing.
    }
  }
  return body;
}

/** The server timing a response body arrived with, or null. */
export function serverTimingOf(body: unknown): ServerTiming | null {
  if (body === null || typeof body !== "object") return null;
  return ((body as Record<symbol, unknown>)[SERVER_TIMING] as ServerTiming | undefined) ?? null;
}
