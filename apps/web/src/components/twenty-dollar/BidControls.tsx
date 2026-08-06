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
  /**
   * The LOCAL countdown has reached zero on this seat's turn.
   *
   * The controls stop offering an action, and say why. This is not the client
   * deciding a timeout — it never submits anything and the server still owns
   * the resolution, with a grace window that lets a genuinely in-time action
   * land. It is the honest end of the previous behaviour, where a live-looking
   * Bid button on an expired turn is what produced the reported "I bid $2 and
   * was told my move was not accepted".
   */
  expired?: boolean;
  onSubmit: (command: "bid" | "pass", amount: number) => void;
}

export default function BidControls({
  publicState,
  privateState,
  seatNames,
  busy,
  expired = false,
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
  const canBid = blocked === null && min <= max && !expired;
  const clamped = Math.min(Math.max(amount, min), Math.max(max, min));
  const opening = publicState.current_bid <= 0;
  const pending = busy || expired;

  /* WHICH command is in flight, not merely THAT one is.
     `busy` is one flag for the whole board, and both buttons were reading it:
     press Bid and the review frame caught the pass control announcing
     "Submitting…" too, so the screen claimed to be doing two contradictory
     things at once. This remembers what was actually pressed. It is label-only
     -- `busy` still disables both, because only one command may be in flight
     -- and it clears when the command settles. */
  const [sent, setSent] = useState<"bid" | "pass" | null>(null);
  useEffect(() => {
    if (!busy) setSent(null);
  }, [busy]);
  const send = (command: "bid" | "pass", value: number) => {
    setSent(command);
    onSubmit(command, value);
  };

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
          disabled={!canBid || pending || clamped <= min}
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
          disabled={!canBid || pending || clamped >= max}
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
          disabled={!canBid || pending || clamped + 1 > max}
          onClick={() => step(1)}
        >
          +$1
        </button>
        <button
          type="button"
          className="td-chip-btn"
          data-testid="td-bid-plus-2"
          disabled={!canBid || pending || clamped + 2 > max}
          onClick={() => step(2)}
        >
          +$2
        </button>
        <button
          type="button"
          className="td-chip-btn"
          data-testid="td-bid-max"
          disabled={!canBid || pending || clamped >= max}
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
          disabled={!canBid || pending}
          data-loading={busy && sent !== "pass" ? "true" : "false"}
          onClick={() => send("bid", clamped)}
        >
          {/* THE PENDING STATE NAMES THE AMOUNT. PART 14 asks for
              "Submitting $2 bid…" specifically, because a spinner that does
              not say what is in flight leaves a player unsure whether their
              number or the previous one is on its way. */}
          {busy && sent !== "pass"
            ? `Submitting ${formatDollars(clamped)} bid…`
            : opening
              ? `Open at ${formatDollars(clamped)}`
              : `Bid ${formatDollars(clamped)}`}
        </button>
        <button
          type="button"
          className="td-btn"
          data-testid="td-pass"
          /* PASSING IS NOT ALWAYS AVAILABLE. `can_pass` is the server's own
             verdict: a seat out of market skips, facing a candidate it can
             legally use with nothing bid, must open. Deriving that here would
             be a second copy of the rule that could disagree with the first. */
          disabled={pending || !privateState.is_your_turn || !privateState.can_pass}
          data-costs-skip={privateState.pass_consumes_skip ? "true" : "false"}
          data-loading={busy && sent === "pass" ? "true" : "false"}
          onClick={() => send("pass", 0)}
        >
          {/* TWO ACTIONS, TWO NAMES, TWO CONSEQUENCES. PART 15: "do not use the
              same visual label for different consequences." A market skip
              spends one of five; conceding a live auction spends nothing, and
              the previous "Skip (−1)" / "Pass" pair left the count implicit on
              the expensive one and the freeness implicit on the other. */}
          {busy && sent === "pass"
            ? "Submitting…"
            : privateState.pass_consumes_skip
              ? `Market Skip — ${privateState.market_skips} of ${publicState.market_skips_per_seat}`
              : "Pass — free"}
        </button>
      </div>

      {expired ? (
        <p className="td-bid-expired" data-testid="td-bid-expired" role="status">
          The clock ran out. The server is settling this lot — its decision will
          appear here in a moment.
        </p>
      ) : null}

      {/* THE REASON. Rendered whenever the bid control is unavailable, beside
          the button rather than in a tooltip. */}
      {blocked ? (
        <p className="td-bid-blocked" data-testid="td-bid-blocked" role="status">
          {blocked}
        </p>
      ) : (
        <p className="td-bid-hint" data-testid="td-bid-hint">
          {/* THE SKIP RULE IS EXPLAINED BEFORE IT BITES, not after. A player
              who learns it by finding "Pass" greyed out has been taught it
              badly, and this is the one rule in the mode that changes the
              whole strategy. */}
          {!privateState.can_pass
            ? `No market skips left — this player fits your roster and nobody has bid, so you must open at ${formatDollars(min)}.`
            : privateState.pass_consumes_skip
              ? `Skipping costs one of your ${privateState.market_skips} remaining market skips. Opening bid is ${formatDollars(min)}.`
              : opening
                ? `Opening bid is ${formatDollars(min)}. Passing costs nothing here.`
                : `Beat ${formatDollars(publicState.current_bid)} by at least $1, or pass — conceding a live auction is free.`}
        </p>
      )}
    </section>
  );
}
