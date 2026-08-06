/**
 * Which settled lots this player has actually been shown, across reloads.
 *
 * THE DEFECT THIS FIXES. `useLotVisibility` used to baseline itself at the
 * history length on first render, so a reload started a fresh slate and
 * reported no gap at all. That was defensible while the summary was only
 * covering bursts WITHIN a session — several lots settling between two polls,
 * which really does happen (`_advance_lot` resolves unsold lots recursively,
 * and `drive_pending_bots` runs up to twelve bot turns inside one request). It
 * was wrong for the case the feature is named after: closing a tab, coming
 * back, and finding players on a roster you never saw bought.
 *
 * WHAT THE CURSOR IS, AND WHY IT IS THIS AND NOT SOMETHING ELSE.
 *
 * `lot_index` is the authoritative, monotonic, server-assigned ordinal of a
 * settled lot. It is already in every history row, it never renumbers, and it
 * orders the history by construction. So "the highest lot_index this browser
 * has acknowledged" is a complete description of what the player has seen, in
 * one integer, derived entirely from state the server already publishes.
 *
 *   * NOT a count. A count would be wrong the moment the server settles a lot
 *     the client never enumerated, and it carries no ordering.
 *   * NOT `state_version`. That advances on every accepted command including
 *     bids and passes, so it cannot answer "which LOTS did I miss" without
 *     replaying the event log.
 *   * NOT a server-side column. That is a migration, and the specification asks
 *     for none unless unavoidable. This is unavoidable only if the cursor must
 *     survive a device change, and it must not: "while you were away" is a
 *     statement about one reader's attention, not about the match.
 *
 * KEYED TO THE AUTHORITATIVE MATCH IDENTITY, so two matches cannot contaminate
 * each other and a replayed match id resumes exactly where it left off. Stored
 * under the app's existing `peak3-` prefix, beside `peak3-theme` and the
 * daily-grid progress keys.
 *
 * IT ONLY EVER MOVES FORWARD. `acknowledge` takes the max of the stored value
 * and the new one, so an out-of-order response, a stale tab or a user pressing
 * "Caught up" twice cannot rewind the cursor and replay a summary the player
 * has already dismissed.
 */

/** localStorage key for one match's acknowledgement cursor. */
export function seenCursorKey(matchId: string): string {
  return `peak3-td-seen:${matchId}`;
}

/**
 * The highest `lot_index` this browser has shown the player for this match.
 *
 * `-1` means "nothing acknowledged", which is the correct answer both for a
 * brand-new match (its history is empty, so nothing is reported) and for a
 * match this browser is genuinely seeing for the first time (every settled lot
 * is one the reader missed, which is exactly what the summary is for).
 */
export function readSeenCursor(matchId: string): number {
  if (typeof window === "undefined") return -1;
  try {
    const raw = window.localStorage.getItem(seenCursorKey(matchId));
    if (raw === null) return -1;
    const value = Number.parseInt(raw, 10);
    // A corrupt value is treated as "nothing acknowledged" rather than trusted.
    // Showing a summary twice is a small annoyance; skipping one silently is
    // the defect this module exists to remove.
    return Number.isFinite(value) ? value : -1;
  } catch {
    // Storage blocked (private mode, disabled cookies). The summary then
    // behaves exactly as it did before this module existed — per-session — and
    // nothing throws. Same discipline as `theme.ts` and `run-the-table-state.ts`.
    return -1;
  }
}

/** Record that everything up to and including `lotIndex` has been shown. */
export function writeSeenCursor(matchId: string, lotIndex: number): void {
  if (typeof window === "undefined") return;
  try {
    // MONOTONIC. See the module docstring: a rewind would replay a dismissed
    // summary, and two tabs progressing at different speeds would fight.
    const next = Math.max(readSeenCursor(matchId), lotIndex);
    window.localStorage.setItem(seenCursorKey(matchId), String(next));
  } catch {
    /* storage blocked — degrade to per-session, never throw */
  }
}

/** Forget a match's cursor. Test seam, and the natural home for any future
 *  "clear my local history" control. */
export function clearSeenCursor(matchId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(seenCursorKey(matchId));
  } catch {
    /* storage blocked */
  }
}

/**
 * Split a settled history into what the player has seen and what they have not.
 *
 * PURE, so the reconciliation rule is testable without a DOM, a poll or a
 * React render. `history` is the server's own array and is assumed to be in
 * ascending `lot_index` order — which it is, because it is only ever appended
 * to — but the result is sorted regardless, because "ordering preserved" is a
 * requirement rather than an assumption about an upstream array.
 */
export function partitionUnseen<T extends { lot_index: number }>(
  history: readonly T[],
  cursor: number,
): T[] {
  return history
    .filter((lot) => lot.lot_index > cursor)
    .slice()
    .sort((a, b) => a.lot_index - b.lot_index);
}
