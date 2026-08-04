"use client";

import { useEffect, useState } from "react";

import {
  bidBlockedLabel,
  formatDollars,
  type TwentyDollarPrivateState,
  type TwentyDollarPublicState,
} from "@/lib/twenty-dollar-api";

/**
 * Whole-dollar bid entry for an ascending auction.
 *
 * WHY THE SLIDER IS GONE. A `range` input is the wrong instrument for money you
 * name to the dollar: it cannot be typed, it has no visible increment, and
 * dragging it below a legal minimum you cannot see is how a player ends up
 * submitting `$0` and being told it is too low. This is a stepper with explicit
 * jumps — the amounts a bidder actually reaches for — plus a Max that means the
 * legal ceiling rather than "everything you have".
 *
 * THE CLAMP HERE IS A COURTESY, NOT THE ENFORCEMENT. `minimum_bid` and
 * `max_bid` come from the server's own projection, and the reducer re-checks
 * every bid against the persisted budget regardless of what arrives. Clamping
 * in the control just means a player is shown their range instead of being told
 * "rejected" for something the UI could have prevented. Nothing here decides
 * legality.
 *
 * A DISABLED CONTROL ALWAYS SAYS WHY. `bid_blocked_reason` is a machine-readable
 * string the server computes; `bidBlockedLabel` turns it into a sentence, and it
 * renders next to the button rather than in a tooltip. Greying a control out
 * with no reason beside it reads as a broken app rather than as a rule, and the
 * brief lists it as a defect in its own right.
 */
export interface BidControlsProps {
  publicState: TwentyDollarPublicState;
  privateState: TwentyDollarPrivateState;
  seatNames: string[];
  /** True while a command is in flight, or while the view is known stale. */
  busy: boolean;
  onSubmit: (command: "bid" | "pass", amount: number) => void;
}

export default function BidControls({
  publicState,
  privateState,
  seatNames,
  busy,
  onSubmit,
}: BidControlsProps) {
  const min = Math.max(1, privateState.minimum_bid);
  const max = Math.max(0, privateState.max_bid);
  const [amount, setAmount] = useState(min);

  // Re-seed whenever the lot or the standing bid moves, so a number chosen
  // against the previous price can never be submitted against this one.
  useEffect(() => {
    setAmount(Math.min(Math.max(min, 1), Math.max(max, 1)));
  }, [min, max, publicState.lot_index]);

  const blocked = bidBlockedLabel(
    privateState.bid_blocked_reason,
    seatNames,
    publicState.active_seat,
  );
  const canBid = blocked === null && min <= max;
  const clamped = Math.min(Math.max(amount, min), Math.max(max, min));
  const opening = publicState.current_bid <= 0;

  const step = (delta: number) =>
    setAmount((value) => Math.min(Math.max(value + delta, min), Math.max(max, min)));

  return (
    <section className="td-bid" data-testid="td-bid-controls" aria-live="polite">
      <div className="td-bid-head">
        <p className="td-bid-label" id="td-bid-label">
          {opening ? "Open the bidding" : "Raise or pass"}
        </p>
        <p className="td-bid-range" data-testid="td-bid-range">
          {canBid
            ? `${formatDollars(min)}–${formatDollars(max)} legal`
            : `Reserve ${formatDollars(privateState.reserve_floor)}`}
        </p>
      </div>

      <div className="td-stepper" role="group" aria-labelledby="td-bid-label">
        <button
          type="button"
          className="td-step"
          data-testid="td-bid-minus"
          disabled={!canBid || busy || clamped <= min}
          onClick={() => step(-1)}
          aria-label="Decrease bid by one dollar"
        >
          &minus;
        </button>
        <output
          className="td-bid-amount"
          data-testid="td-bid-amount"
          aria-label={`Bid entry ${formatDollars(clamped)}`}
        >
          {formatDollars(clamped)}
        </output>
        <button
          type="button"
          className="td-step"
          data-testid="td-bid-plus"
          disabled={!canBid || busy || clamped >= max}
          onClick={() => step(1)}
          aria-label="Increase bid by one dollar"
        >
          +
        </button>
      </div>

      <div className="td-quick">
        <button
          type="button"
          className="td-chip-btn"
          data-testid="td-bid-plus-1"
          disabled={!canBid || busy || clamped + 1 > max}
          onClick={() => step(1)}
        >
          +$1
        </button>
        <button
          type="button"
          className="td-chip-btn"
          data-testid="td-bid-plus-2"
          disabled={!canBid || busy || clamped + 2 > max}
          onClick={() => step(2)}
        >
          +$2
        </button>
        <button
          type="button"
          className="td-chip-btn"
          data-testid="td-bid-max"
          disabled={!canBid || busy || clamped >= max}
          onClick={() => setAmount(max)}
        >
          Max {formatDollars(max)}
        </button>
      </div>

      <div className="td-bid-actions">
        <button
          type="button"
          className="td-btn td-btn-primary"
          data-testid="td-submit-bid"
          disabled={!canBid || busy}
          onClick={() => onSubmit("bid", clamped)}
        >
          {opening ? `Open at ${formatDollars(clamped)}` : `Bid ${formatDollars(clamped)}`}
        </button>
        <button
          type="button"
          className="td-btn"
          data-testid="td-pass"
          disabled={busy || !privateState.is_your_turn}
          onClick={() => onSubmit("pass", 0)}
        >
          Pass
        </button>
      </div>

      {/* THE REASON. Rendered whenever the bid control is unavailable, beside
          the button rather than in a tooltip. */}
      {blocked ? (
        <p className="td-bid-blocked" data-testid="td-bid-blocked" role="status">
          {blocked}
        </p>
      ) : (
        <p className="td-bid-hint" data-testid="td-bid-hint">
          {opening
            ? `Opening bid is ${formatDollars(min)}. Passing costs nothing.`
            : `Beat ${formatDollars(publicState.current_bid)} by at least $1, or pass and let it go.`}
        </p>
      )}
    </section>
  );
}
