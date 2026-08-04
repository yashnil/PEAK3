"use client";

import { useEffect, useState } from "react";

import {
  formatDollars,
  type TwentyDollarPrivateState,
  type TwentyDollarPublicState,
} from "@/lib/twenty-dollar-api";

/**
 * Sealed-bid entry and the lock-in state.
 *
 * THE CLAMP HERE IS A COURTESY, NOT THE ENFORCEMENT. `max` comes from the
 * server's `private_state.max_bid`, and the reducer re-checks every bid against
 * the persisted budget regardless of what arrives. Clamping in the input just
 * means a player is shown their ceiling instead of being told "rejected" for
 * something the UI could have prevented. Nothing here decides legality.
 *
 * ONCE LOCKED, THE AMOUNT IS GONE FROM THE UI'S CONTROL. There is no unlock,
 * because the server has no unlock: `submit_bid` refuses a second bid in the
 * same round (`already_locked`). Rendering an editable field after locking
 * would promise something the rules do not allow.
 */
export interface BidControlsProps {
  publicState: TwentyDollarPublicState;
  privateState: TwentyDollarPrivateState;
  disabled: boolean;
  onSubmit: (command: "bid" | "pass", amount: number) => void;
}

export default function BidControls({
  publicState,
  privateState,
  disabled,
  onSubmit,
}: BidControlsProps) {
  const max = Math.max(0, privateState.max_bid);
  const [amount, setAmount] = useState(0);

  // Reset the field whenever a new candidate arrives, so a number typed for
  // the previous player cannot be submitted against this one.
  useEffect(() => {
    setAmount(0);
  }, [publicState.round_index]);

  if (privateState.your_locked) {
    return (
      <section className="td-bid td-bid-locked" aria-live="polite" data-testid="td-bid-locked">
        <p className="td-bid-locked-label">Bid locked</p>
        <p className="td-bid-locked-amount" data-testid="td-your-locked-amount">
          {privateState.your_bid && privateState.your_bid > 0
            ? formatDollars(privateState.your_bid)
            : "Pass"}
        </p>
        <p className="td-bid-hint">
          Sealed until both seats are in. Your opponent can see that you have
          locked, never what you bid.
        </p>
      </section>
    );
  }

  const cannotBuy = !privateState.can_acquire_candidate;

  return (
    <section className="td-bid" data-testid="td-bid-controls">
      <label className="td-bid-label" htmlFor="td-bid-amount">
        Your sealed bid
      </label>

      <div className="td-bid-row">
        <input
          id="td-bid-amount"
          data-testid="td-bid-input"
          type="range"
          min={0}
          max={max}
          step={1}
          value={Math.min(amount, max)}
          disabled={disabled || cannotBuy || max < 1}
          onChange={(e) => setAmount(Number(e.target.value))}
          aria-describedby="td-bid-ceiling"
        />
        <output className="td-bid-amount" htmlFor="td-bid-amount" data-testid="td-bid-amount">
          {amount > 0 ? formatDollars(amount) : "Pass"}
        </output>
      </div>

      <p id="td-bid-ceiling" className="td-bid-hint" data-testid="td-bid-ceiling">
        {cannotBuy ? (
          <>You cannot field a legal roster if you win this player.</>
        ) : (
          <>
            Maximum {formatDollars(max)} — {formatDollars(privateState.reserve_floor)} must
            stay behind for the slots you have left.
          </>
        )}
      </p>

      <div className="td-bid-actions">
        <button
          type="button"
          className="td-btn td-btn-primary"
          data-testid="td-lock-bid"
          disabled={disabled || cannotBuy || amount < 1}
          onClick={() => onSubmit("bid", amount)}
        >
          Lock {amount > 0 ? formatDollars(amount) : "bid"}
        </button>
        <button
          type="button"
          className="td-btn"
          data-testid="td-pass"
          disabled={disabled}
          onClick={() => onSubmit("pass", 0)}
        >
          Pass
        </button>
      </div>
    </section>
  );
}
