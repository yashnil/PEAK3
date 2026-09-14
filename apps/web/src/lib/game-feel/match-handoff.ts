/**
 * THE MATCH A PAGE JUST RECEIVED, HANDED TO THE ROOM IT NAVIGATES TO.
 *
 * Starting bot practice answers with the match's full authoritative view, and
 * the lobby then navigates to the room -- which used to throw that view away
 * and read the same match again, showing "Loading the draft room…" for one
 * more round trip (about 750 ms at 750 ms of latency) before anything was on
 * screen. The view is the server's own response from milliseconds earlier, so
 * the room can mount on it immediately and let its normal polling take over.
 *
 * WHY THIS IS SAFE. It is authoritative server state, never client-built; it
 * is consumed once; it is keyed by match id; and it expires after
 * `HANDOFF_TTL_MS`, so a stale view can never be resurrected by a later
 * visit. Every read after it still goes through the room's version guard,
 * which refuses anything older than what is on screen.
 *
 * In-memory only: a reload has no handoff and reads the match as before.
 */

export const HANDOFF_TTL_MS = 15_000;

interface Handoff {
  view: unknown;
  at: number;
}

const handoffs = new Map<string, Handoff>();

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Keep a just-received match view for the room about to open it. */
export function primeMatchView(view: { match_id?: unknown } | null | undefined): void {
  if (!view || typeof view.match_id !== "string") return;
  handoffs.set(view.match_id, { view, at: now() });
}

/** Take (and forget) a fresh handed-off view for `matchId`, or null. */
export function takeMatchView<T>(matchId: string): T | null {
  const entry = handoffs.get(matchId);
  handoffs.delete(matchId);
  if (!entry || now() - entry.at > HANDOFF_TTL_MS) return null;
  return entry.view as T;
}

/** Test seam. */
export function clearMatchHandoffs(): void {
  handoffs.clear();
}
