/**
 * Which settled lots this player has actually been shown, across reloads.
 *
 * WHAT THIS CURSOR IS. `lot_index` is the authoritative, monotonic,
 * server-assigned ordinal of a settled lot. It is already in every history
 * row, it never renumbers, and it orders the history by construction. So "the
 * highest lot_index this browser has acknowledged" is a complete description
 * of what the player has seen, in one integer, derived entirely from state the
 * server already publishes.
 *
 *   * NOT a count. A count would be wrong the moment the server settles a lot
 *     the client never enumerated, and it carries no ordering.
 *   * NOT `state_version`. That advances on every accepted command including
 *     bids and passes, so it cannot answer "which LOTS did I miss" without
 *     replaying the event log.
 *   * NOT a server-side column. That is a migration, and "while you were away"
 *     is a statement about one reader's attention, not about the match.
 *
 * A CORRECTION TO WHAT THIS FILE USED TO CLAIM. The previous docstring said
 * `drive_pending_bots` "runs up to twelve bot turns inside one request". That
 * is false and it mattered, because it was used to justify treating any
 * multi-lot jump as a reconnect. `drive_pending_bots` freezes `now` and
 * compares it against the stored `opened_at`, so at most ONE bot command runs
 * per HTTP request; `clock.enforce` fires at most one timeout per call; and
 * `mode.py` always opens a new turn at `data.now + TURN_SECONDS`, so a sweep
 * cannot manufacture an already-expired human turn. The one real multi-lot
 * mechanism is `_advance_lot` → `_resolve_lot` → `_advance_lot`: a drawn
 * candidate that neither seat can legally acquire settles inside the call that
 * created it. That is ordinary live play, not a reconnect, and `LotLedger`
 * now presents it as a reveal SEQUENCE rather than a catch-up banner.
 *
 * STORAGE CAN BE BLOCKED, AND THAT USED TO BE PERMANENT. In private mode, with
 * cookies disabled, or inside a partitioned iframe, `localStorage` throws.
 * Reads then answered `-1` forever and writes silently did nothing, so the
 * cursor could never advance: the catch-up banner became undismissable and the
 * single-lot reveal never fired. The documented intent ("degrade to
 * per-session") did not hold, because a per-session degrade needs somewhere to
 * put the session's value. There is now a MODULE-LEVEL IN-MEMORY STORE that
 * takes over whenever `localStorage` is unavailable: acknowledgement works for
 * the life of the tab, and only the cross-reload guarantee is lost — which is
 * exactly what "degrade to per-session" was always supposed to mean.
 *
 * IT ONLY EVER MOVES FORWARD. `writeSeenCursor` takes the max of the stored
 * value and the new one, so an out-of-order response, a stale tab or a user
 * pressing "Caught up" twice cannot rewind the cursor and replay a summary the
 * player has already dismissed.
 */

/** localStorage key for one match's acknowledgement cursor. */
export function seenCursorKey(matchId: string): string {
  return `peak3-td-seen:${matchId}`;
}

/**
 * The per-session fallback, used only when `localStorage` is unusable.
 *
 * Module-level rather than React state on purpose: `useLotLedger` remounts on
 * every route transition inside the same match, and a cursor that resets on
 * remount is the undismissable-banner bug in a different costume.
 */
const memoryStore = new Map<string, number>();

/** Test seam. Clears the in-memory fallback without touching localStorage. */
export function resetMemoryCursors(): void {
  memoryStore.clear();
}

/** Is `localStorage` actually usable in this document? */
function localStorageAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    // Reading the property itself throws in a partitioned third-party
    // context, so the access has to be inside the try.
    return window.localStorage !== null && window.localStorage !== undefined;
  } catch {
    return false;
  }
}

/**
 * The highest `lot_index` this browser has shown the player for this match.
 *
 * `-1` means "nothing acknowledged", which is the correct answer both for a
 * brand-new match (its history is empty, so nothing is reported) and for a
 * match this browser is genuinely seeing for the first time.
 */
export function readSeenCursor(matchId: string): number {
  const key = seenCursorKey(matchId);
  if (localStorageAvailable()) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        const value = Number.parseInt(raw, 10);
        // A corrupt value is treated as "nothing acknowledged" rather than
        // trusted. Showing a summary twice is a small annoyance; skipping one
        // silently is the defect this module exists to remove.
        if (Number.isFinite(value)) return value;
        return memoryStore.get(key) ?? -1;
      }
    } catch {
      /* fall through to the in-memory store */
    }
  }
  return memoryStore.get(key) ?? -1;
}

/** Record that everything up to and including `lotIndex` has been shown. */
export function writeSeenCursor(matchId: string, lotIndex: number): void {
  const key = seenCursorKey(matchId);
  // MONOTONIC, and written to BOTH stores. See the module docstring: a rewind
  // would replay a dismissed summary, and the memory copy is what keeps the
  // cursor advancing when persistence is refused.
  const next = Math.max(readSeenCursor(matchId), lotIndex);
  memoryStore.set(key, next);
  if (!localStorageAvailable()) return;
  try {
    window.localStorage.setItem(key, String(next));
  } catch {
    /* storage blocked — the in-memory value above IS the per-session degrade */
  }
}

/** Forget a match's cursor. Test seam, and the natural home for any future
 *  "clear my local history" control. */
export function clearSeenCursor(matchId: string): void {
  const key = seenCursorKey(matchId);
  memoryStore.delete(key);
  if (!localStorageAvailable()) return;
  try {
    window.localStorage.removeItem(key);
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
