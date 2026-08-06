"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
 * Settled lots: the compact tray, and the "while you were away" summary.
 *
 * TWO DEFECTS, ONE CAUSE. The manual finding was "players appeared in settled
 * history without a sufficiently clear lot sequence, making it seem like random
 * players were being inserted without the user seeing the auction". The board
 * really can advance several lots between two client renders, for three
 * independent server-side reasons:
 *
 *   1. `_advance_lot` resolves an UNSOLD lot synchronously and recursively.
 *      When neither seat can legally acquire the drawn candidate there is no
 *      active seat, so the lot settles inside the same call that created it,
 *      which then draws the next one. A run of unusable candidates settles
 *      entirely within one command.
 *   2. `drive_pending_bots` advances up to twelve bot turns inside a single
 *      request, so several complete lots can resolve before one response is
 *      written.
 *   3. The room polls every two seconds. Anything that happens between two
 *      polls is only ever seen as a finished result.
 *
 * None of those is a bug on its own — the first is how termination stays
 * provable, the second is how a bot moves without a background worker. What was
 * a bug is that the surface said nothing about any of it: it rendered
 * `history[history.length - 1]` and appended the rest to a scrolling column.
 *
 * SO THE CLIENT TRACKS WHAT IT HAS SHOWN, AND THAT RECORD SURVIVES A RELOAD.
 * `useLotVisibility` compares the authoritative history against a PERSISTED
 * cursor -- the highest `lot_index` this browser has actually displayed, kept
 * per match id (`lib/twenty-dollar-seen.ts`). One new lot is an ordinary
 * reveal. More than one is a gap, and a gap gets named and itemised rather than
 * silently absorbed.
 *
 * The cursor is what makes this work across a real reconnect. The first version
 * baselined at `history.length` on mount, so closing a tab and coming back
 * started a fresh slate and reported no gap at all -- correct for bursts within
 * one session, and wrong for the case the feature is named after.
 */

// ---------------------------------------------------------------------------
// The gap summary
// ---------------------------------------------------------------------------

export function MissedLotsSummary({
  lots,
  seatNames,
  yourSeat,
  onDismiss,
}: {
  /** The lots that settled without this client ever rendering them live. */
  lots: ResolvedLot[];
  seatNames: string[];
  yourSeat: number | null;
  onDismiss: () => void;
}) {
  if (lots.length === 0) return null;
  return (
    <section
      className="td-missed"
      data-testid="td-missed-lots"
      data-count={lots.length}
      role="status"
      aria-labelledby="td-missed-heading"
    >
      <header className="td-missed-head">
        <h3 id="td-missed-heading" className="td-missed-title">
          While you were away
        </h3>
        <p className="td-missed-sub">
          {lots.length} {lots.length === 1 ? "lot" : "lots"} settled before this
          board caught up. Here is each one.
        </p>
      </header>
      <ol className="td-missed-list">
        {lots.map((lot) => (
          <li key={lot.lot_index} className="td-missed-row" data-testid={`td-missed-${lot.lot_index}`}>
            <span className="td-missed-lot">Lot {lot.lot_index + 1}</span>
            <span className="td-missed-name">{lot.candidate.player_name}</span>
            <span className="td-missed-verdict">{verdictOf(lot, seatNames, yourSeat)}</span>
            <span className="td-missed-score">{lot.candidate.prime_score.toFixed(1)}</span>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="td-btn"
        data-testid="td-missed-dismiss"
        onClick={onDismiss}
      >
        Caught up
      </button>
    </section>
  );
}

/**
 * How a settled lot ended, in one clause.
 *
 * EVERY OUTCOME GETS ITS OWN WORDS, because four of them have different
 * consequences and the previous surface rendered three of them identically. A
 * timeout that spent a market skip and a concession that spent nothing must not
 * read the same, which is the whole of PART 15's "do not use the same visual
 * label for different consequences".
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
  const verb = winner === "You" ? "took" : "took";
  return `${winner} ${verb} them for ${price}${conceded ? " — the other clock expired" : ""}.`;
}

// ---------------------------------------------------------------------------
// The tray
// ---------------------------------------------------------------------------

/**
 * Every settled lot, as a COLLAPSIBLE BOTTOM TRAY rather than a column.
 *
 * PART 19: "do not allow a tall history list to compress the opponent roster."
 * The previous layout put this in the right-hand column above the opponent's
 * five, so a match with fifteen settled lots squeezed the roster panel the
 * player most needed to read into a sliver. A tray owns the full width, holds
 * its own scroll, and is closed by default after the first few lots.
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
        <span className="td-tray-count" data-testid="td-tray-count">
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
              <span className="td-tray-lot">{lot.lot_index + 1}</span>
              <span className="td-tray-name">{lot.candidate.player_name}</span>
              <span className="td-tray-verdict">{verdictOf(lot, seatNames, yourSeat)}</span>
              <span className="td-tray-score">{lot.candidate.prime_score.toFixed(1)}</span>
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

export interface LotVisibility {
  /** Lots that settled without ever being shown to this player. */
  missed: ResolvedLot[];
  /** The single lot to hold on centre stage, if exactly one just settled. */
  reveal: ResolvedLot | null;
  /** Acknowledge the gap. Advances the persisted cursor past every missed lot. */
  acknowledge: () => void;
}

/** How long a single settled lot holds centre stage before it counts as seen.
 *  PART 17 asks for "approximately 1.2-2 seconds". */
const REVEAL_HOLD_MS = 1600;

/**
 * Which settled lots this client has already shown the player.
 *
 * THE CURSOR IS PERSISTED, and that is the whole of the reload fix. This hook
 * used to baseline itself at `history.length` on first render, so a reload
 * started a fresh slate and reported no gap -- correct for bursts within a
 * session, wrong for the case the feature is named after. It now reads
 * `readSeenCursor(matchId)`, the highest `lot_index` this browser has actually
 * displayed, so closing a tab and coming back reports every lot that settled in
 * between.
 *
 * WHAT ADVANCES THE CURSOR, and why the two paths differ:
 *
 *   * ONE unseen lot is an ordinary reveal. It holds centre stage for
 *     `REVEAL_HOLD_MS` and then counts as seen, because it WAS seen -- the
 *     player was looking at the board when it landed.
 *   * MORE THAN ONE is a gap, and a gap needs a deliberate dismissal.
 *     Auto-advancing there would be the original defect wearing a cursor: the
 *     lots would be marked shown without anybody having read them.
 *
 * TWO TABS. The cursor lives in one place, so whichever tab acknowledges first
 * wins and the other stops reporting the same lots. `storage` fires only in the
 * OTHER tabs, which is exactly the direction that needs it: the acting tab
 * already knows, and re-reads through its own state bump.
 */
export function useLotVisibility(
  matchId: string,
  state: TwentyDollarPublicState,
): LotVisibility {
  // Bumped whenever the cursor may have changed, in this tab or another. The
  // cursor itself is not React state: localStorage is the single source, and a
  // mirrored copy is a second thing that can disagree with it.
  const [cursorEpoch, setCursorEpoch] = useState(0);
  const history = state.history;

  const unseen = useMemo(
    () => partitionUnseen(history, readSeenCursor(matchId)),
    // `cursorEpoch` is a real dependency: it is how an acknowledgement, or
    // another tab's acknowledgement, re-runs this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history, matchId, cursorEpoch],
  );

  const acknowledge = useCallback(() => {
    const highest = history.reduce(
      (best, lot) => Math.max(best, lot.lot_index),
      readSeenCursor(matchId),
    );
    writeSeenCursor(matchId, highest);
    setCursorEpoch((value) => value + 1);
  }, [history, matchId]);

  // ANOTHER TAB ACKNOWLEDGED. `storage` does not fire in the tab that wrote,
  // so this only ever means "somebody else moved the cursor".
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === seenCursorKey(matchId)) setCursorEpoch((value) => value + 1);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [matchId]);

  // A SINGLE REVEAL ACKNOWLEDGES ITSELF, after its hold. Keyed on the lot index
  // so a poll that returns the same state does not restart the timer.
  const soloLotIndex = unseen.length === 1 ? unseen[0].lot_index : null;
  useEffect(() => {
    if (soloLotIndex === null) return;
    const timer = window.setTimeout(() => {
      writeSeenCursor(matchId, soloLotIndex);
      setCursorEpoch((value) => value + 1);
    }, REVEAL_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [soloLotIndex, matchId]);

  // A COMPLETED MATCH HAS NOTHING LEFT TO CATCH UP ON. The result screen
  // replaces the auction, so a "while you were away" over the top of it would
  // be reporting a gap the player is about to see resolved in full anyway.
  useEffect(() => {
    if (state.phase !== "complete" || history.length === 0) return;
    writeSeenCursor(matchId, history[history.length - 1].lot_index);
  }, [state.phase, history, matchId]);

  return {
    missed: unseen.length > 1 ? unseen : [],
    reveal: unseen.length === 1 ? unseen[0] : null,
    acknowledge,
  };
}
