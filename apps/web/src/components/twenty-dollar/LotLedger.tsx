"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  formatDollars,
  type ResolvedLot,
  type TwentyDollarPublicState,
} from "@/lib/twenty-dollar-api";
import {
  partitionUnseen,
  readSeenCursor,
  seenCursorKey,
  writeSeenCursor,
} from "@/lib/twenty-dollar-seen";

/**
 * Settled lots: the reveal SEQUENCE, the resume recap, and the history tray.
 *
 * WHAT WAS ACTUALLY WRONG WITH "WHILE YOU WERE AWAY"
 * --------------------------------------------------
 * The reported defect was that an actively-playing user got a "While you were
 * away" banner listing players they had never had a chance to bid on, and that
 * once it appeared it never went away. Three mechanisms, all verified, none of
 * them a reconnect:
 *
 *  1. ONE ACCEPTED COMMAND CAN SETTLE TWO OR MORE LOTS, and this is normal.
 *     `state.py::_advance_lot` draws a candidate and, when neither seat can
 *     legally acquire it, calls `_resolve_lot` on the lot it has just created;
 *     `_resolve_lot` then calls `_advance_lot` again. The market draws from all
 *     500 qualified players regardless of either roster, so unusable candidates
 *     are common rather than rare. The old hook saw `unseen.length > 1` and
 *     called that a reconnect.
 *  2. IT WAS STICKY. The cursor advanced in exactly two places: a self-ack that
 *     fired only when `unseen.length === 1`, and the "Caught up" button. Once a
 *     gap of two or more went undismissed the cursor could never move again —
 *     the banner was permanent and `reveal` was permanently null, so no lot was
 *     revealed for the rest of the match.
 *  3. BLOCKED STORAGE MADE BOTH PERMANENT. `readSeenCursor` answered `-1`
 *     forever and writes did nothing, so the entire history read as missed and
 *     "Caught up" was inert. Fixed in `twenty-dollar-seen.ts` with an in-memory
 *     store; see its docstring.
 *
 * A CORRECTION. The previous version of this comment claimed
 * `drive_pending_bots` "advances up to twelve bot turns inside a single
 * request". It does not. It freezes `now` and compares against the stored
 * `opened_at`, so at most ONE bot command runs per HTTP request; `clock.enforce`
 * fires at most one timeout per call; and `mode.py:274` always opens a new turn
 * at `data.now + TURN_SECONDS`, so a sweep cannot manufacture an already-expired
 * human turn. That claim was load-bearing for the wrong design and it was false.
 *
 * SO THE LEDGER DISTINGUISHES TWO THINGS THE OLD ONE CONFLATED
 * ------------------------------------------------------------
 *   * LOTS THAT SETTLE WHILE THIS CLIENT IS LIVE go into a REVEAL QUEUE and are
 *     played one at a time, each holding centre stage for `REVEAL_HOLD_MS`.
 *     Three lots settling inside one command is a three-beat sequence, not a
 *     catch-up notice, and the player watches it happen.
 *   * LOTS THAT SETTLED ACROSS A RESUME BOUNDARY go into the RECAP. There are
 *     exactly two resume boundaries: first mount with a stored cursor behind
 *     the history, and returning from a genuinely long hidden period
 *     (`RESUME_HIDDEN_MS`). Anything else is live play.
 *
 * The recap is compact by construction — three rows, "View N more", a dismiss
 * control — and it renders BESIDE the live board rather than in place of it, so
 * it cannot push the current lot below the fold and cannot replace the reveal.
 */

/** How long one settled lot holds centre stage before it counts as seen. */
export const REVEAL_HOLD_MS = 1600;

/**
 * How long the tab must have been hidden for the return to count as a resume
 * rather than as a glance away.
 *
 * Twenty seconds is just under one turn: shorter than this and any lot that
 * settled was one the player could plausibly still narrate, so it plays as a
 * reveal sequence. Longer and they have genuinely missed the auction.
 */
export const RESUME_HIDDEN_MS = 20_000;

/** How many recap rows are shown before "View N more". */
const RECAP_PREVIEW = 3;

// ---------------------------------------------------------------------------
// The recap
// ---------------------------------------------------------------------------

export function ResumeRecap({
  lots,
  seatNames,
  yourSeat,
  onDismiss,
}: {
  /** Lots that settled across a genuine resume boundary. */
  lots: ResolvedLot[];
  seatNames: string[];
  yourSeat: number | null;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (lots.length === 0) return null;
  const shown = expanded ? lots : lots.slice(-RECAP_PREVIEW);
  const hidden = lots.length - shown.length;

  return (
    <section
      className="td-recap"
      data-testid="td-missed-lots"
      data-count={lots.length}
      role="status"
      aria-labelledby="td-recap-heading"
    >
      <div className="td-recap-head">
        <h2 id="td-recap-heading" className="td-recap-title">
          While you were away
        </h2>
        <p className="td-recap-sub">
          {lots.length} {lots.length === 1 ? "lot" : "lots"} settled before you got
          back.
        </p>
        <button
          type="button"
          className="td-recap-dismiss"
          data-testid="td-missed-dismiss"
          onClick={onDismiss}
        >
          Caught up
        </button>
      </div>
      <ol className="td-recap-list">
        {shown.map((lot) => (
          <li key={lot.lot_index} className="td-recap-row" data-testid={`td-missed-${lot.lot_index}`}>
            <span className="td-recap-lot pk-numeral">Lot {lot.lot_index + 1}</span>
            <span className="td-recap-name">{lot.candidate.player_name}</span>
            <span className="td-recap-verdict">{verdictOf(lot, seatNames, yourSeat)}</span>
            <span className="td-recap-score pk-numeral">
              {lot.candidate.prime_score.toFixed(1)}
            </span>
          </li>
        ))}
      </ol>
      {hidden > 0 ? (
        <button
          type="button"
          className="td-recap-more"
          data-testid="td-missed-more"
          aria-expanded={expanded}
          onClick={() => setExpanded(true)}
        >
          View {hidden} more
        </button>
      ) : null}
    </section>
  );
}

/**
 * How a settled lot ended, in one clause.
 *
 * EVERY OUTCOME GETS ITS OWN WORDS, because four of them have different
 * consequences and the previous surface rendered three of them identically. A
 * timeout that spent a market skip and a concession that spent nothing must not
 * read the same.
 */
export function verdictOf(
  lot: ResolvedLot,
  seatNames: string[],
  yourSeat: number | null,
): string {
  const who = (index: number) =>
    index === yourSeat ? "You" : (seatNames[index] ?? `Seat ${index + 1}`);

  if (lot.decided_by === "autofill") {
    return lot.winner_seat === null
      ? "Auto-filled."
      : `Auto-filled to ${who(lot.winner_seat).toLowerCase()}.`;
  }
  if (lot.winner_seat === null) {
    const skipped = (lot.actions ?? []).filter((a) => a.consumed_skip).length;
    const timedOut = (lot.actions ?? []).some((a) => a.timed_out);
    if (skipped > 0) {
      return `Unsold — ${skipped === 2 ? "both seats skipped" : "skipped"}${
        timedOut ? " on an expired clock" : ""
      }.`;
    }
    return timedOut ? "Unsold — the clock expired." : "Unsold — nobody bid.";
  }
  const winner = who(lot.winner_seat);
  const price = formatDollars(lot.price);
  const conceded = (lot.actions ?? []).some(
    (a) => a.action === "pass" && a.seat_index !== lot.winner_seat && a.timed_out,
  );
  return `${winner} took them for ${price}${conceded ? " — the other clock expired" : ""}.`;
}

// ---------------------------------------------------------------------------
// The tray
// ---------------------------------------------------------------------------

/**
 * Every settled lot, as a COLLAPSIBLE BOTTOM TRAY rather than a column.
 *
 * The previous layout put this in the right-hand column above the opponent's
 * five, so a match with fifteen settled lots squeezed the roster panel the
 * player most needed to read into a sliver. A tray owns the full width, holds
 * its own scroll, and is closed by default.
 */
export function SettledLotTray({
  history,
  seatNames,
  yourSeat,
}: {
  history: ResolvedLot[];
  seatNames: string[];
  yourSeat: number | null;
}) {
  const [open, setOpen] = useState(false);
  if (history.length === 0) return null;
  const recent = [...history].reverse();

  return (
    <section className="td-tray" data-testid="td-settled-tray" data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="td-tray-toggle"
        data-testid="td-tray-toggle"
        aria-expanded={open}
        aria-controls="td-tray-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="td-tray-title">Settled lots</span>
        <span className="td-tray-count pk-numeral" data-testid="td-tray-count">
          {history.length}
        </span>
        <span className="td-tray-chevron" aria-hidden="true" />
      </button>
      <div
        id="td-tray-panel"
        className="td-tray-panel"
        hidden={!open}
        // A scrollable region with no focusable content is unreachable by
        // keyboard (axe `scrollable-region-focusable`), and these rows are
        // static text, so the container itself takes focus.
        tabIndex={open ? 0 : -1}
      >
        <ol className="td-tray-list">
          {recent.map((lot) => (
            <li key={lot.lot_index} className="td-tray-row" data-testid={`td-history-${lot.lot_index}`}>
              <span className="td-tray-lot pk-numeral">{lot.lot_index + 1}</span>
              <span className="td-tray-name">{lot.candidate.player_name}</span>
              <span className="td-tray-verdict">{verdictOf(lot, seatNames, yourSeat)}</span>
              <span className="td-tray-score pk-numeral">
                {lot.candidate.prime_score.toFixed(1)}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tracking what this client has actually shown
// ---------------------------------------------------------------------------

export interface LotLedgerState {
  /** Lots that settled across a genuine RESUME boundary and are unacknowledged. */
  recap: ResolvedLot[];
  /** The lot currently holding centre stage, if any. */
  reveal: ResolvedLot | null;
  /** How many further lots are queued behind `reveal`. */
  queued: number;
  /** Acknowledge the recap. Advances the persisted cursor past every recap lot. */
  acknowledgeRecap: () => void;
}

const maxLotIndex = (history: readonly ResolvedLot[]): number =>
  history.reduce((best, lot) => Math.max(best, lot.lot_index), -1);

/**
 * Which settled lots this client has shown, and how the rest should be shown.
 *
 * THE RESUME CEILING is the one piece of state that makes this work. It is the
 * highest `lot_index` that had already settled at the last resume boundary.
 * Everything at or below it that the cursor has not reached is a genuine gap
 * and belongs in the recap; everything above it settled while this client was
 * live and rendering, and belongs in the reveal queue.
 *
 *   * At mount the ceiling is the history's own maximum. A brand-new match has
 *     none (`-1`), so nothing is ever recapped on a fresh start.
 *   * Returning from more than `RESUME_HIDDEN_MS` hidden raises the ceiling to
 *     whatever has settled by then.
 *   * Ordinary polling never raises it, which is the whole point.
 *
 * THE CURSOR ONLY MOVES FORWARD, and a played reveal does not jump it past an
 * outstanding recap: those indexes are parked in `playedRef` and flushed when
 * the recap is acknowledged. Without that, playing lot 6 would silently mark
 * lots 2–5 as seen and the recap would vanish unread.
 */
export function useLotLedger(
  matchId: string,
  state: TwentyDollarPublicState,
): LotLedgerState {
  const history = state.history;

  // Bumped whenever the cursor may have changed, here or in another tab. The
  // cursor is not mirrored into React state: the store is the single source,
  // and a copy is a second thing that can disagree with it.
  const [cursorEpoch, setCursorEpoch] = useState(0);
  const [resumeCeiling, setResumeCeiling] = useState(() => maxLotIndex(history));
  const playedRef = useRef<Set<number>>(new Set());

  const cursor = useMemo(
    () => readSeenCursor(matchId),
    // `cursorEpoch` is a real dependency: it is how an acknowledgement — this
    // tab's or another's — re-reads a store the linter cannot see into.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matchId, cursorEpoch],
  );

  const unseen = useMemo(
    () => partitionUnseen(history, cursor),
    [history, cursor],
  );

  const recap = useMemo(
    () => unseen.filter((lot) => lot.lot_index <= resumeCeiling),
    [unseen, resumeCeiling],
  );

  // NOT MEMOISED, deliberately. `playedRef` is a ref — the parking lot for
  // reveals that have played while a recap is still outstanding — so a memo
  // could not name it as a dependency and would go stale. Filtering a handful
  // of settled lots per render is free; a stale queue is a lot that never
  // reveals.
  const queue = unseen.filter(
    (lot) => lot.lot_index > resumeCeiling && !playedRef.current.has(lot.lot_index),
  );

  const recapOutstanding = recap.length > 0;

  const acknowledgeRecap = useCallback(() => {
    const highest = Math.max(
      readSeenCursor(matchId),
      resumeCeiling,
      ...playedRef.current,
    );
    playedRef.current.clear();
    writeSeenCursor(matchId, highest);
    setCursorEpoch((value) => value + 1);
  }, [matchId, resumeCeiling]);

  // THE REVEAL QUEUE PLAYS ITSELF, one lot at a time. Keyed on the head's index
  // so a poll returning the same state cannot restart the hold.
  const headIndex = queue.length > 0 ? queue[0].lot_index : null;
  useEffect(() => {
    if (headIndex === null) return;
    const timer = window.setTimeout(() => {
      playedRef.current.add(headIndex);
      if (!recapOutstanding) writeSeenCursor(matchId, headIndex);
      setCursorEpoch((value) => value + 1);
    }, REVEAL_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [headIndex, matchId, recapOutstanding]);

  // A GENUINELY LONG HIDDEN PERIOD IS A RESUME BOUNDARY. A glance at another
  // tab is not: the lots that settle in those few seconds still play as a
  // reveal sequence, because the player is still in the room.
  const hiddenSince = useRef<number | null>(null);
  const historyRef = useRef(history);
  historyRef.current = history;
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        hiddenSince.current = Date.now();
        return;
      }
      const since = hiddenSince.current;
      hiddenSince.current = null;
      if (since === null || Date.now() - since < RESUME_HIDDEN_MS) return;
      const settled = maxLotIndex(historyRef.current);
      setResumeCeiling((current) => Math.max(current, settled));
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // ANOTHER TAB ACKNOWLEDGED. `storage` does not fire in the tab that wrote,
  // so this only ever means "somebody else moved the cursor".
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === seenCursorKey(matchId)) setCursorEpoch((value) => value + 1);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [matchId]);

  // A COMPLETED MATCH HAS NOTHING LEFT TO CATCH UP ON. The result screen shows
  // every roster in full, so a recap over the top of it reports a gap the
  // player is about to see resolved anyway.
  useEffect(() => {
    if (state.phase !== "complete" || history.length === 0) return;
    writeSeenCursor(matchId, history[history.length - 1].lot_index);
    setCursorEpoch((value) => value + 1);
  }, [state.phase, history, matchId]);

  return {
    recap,
    reveal: queue.length > 0 ? queue[0] : null,
    queued: Math.max(0, queue.length - 1),
    acknowledgeRecap,
  };
}
