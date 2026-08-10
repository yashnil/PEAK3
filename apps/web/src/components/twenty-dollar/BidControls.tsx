"use client";

import { useEffect, useState } from "react";

import {
  bidBlockedLabel,
  formatDollars,
  passActionCost,
  passActionLabel,
  passKind,
  type TwentyDollarPrivateState,
  type TwentyDollarPublicState,
} from "@/lib/twenty-dollar-api";

/**
 * The auction control (S20-05).
 *
 * WHAT IT REPLACED. A `−  $1  +` stepper with a three-chip row under it, a
 * transparent "primary" button whose only decoration was an accent border, and
 * four lines of legal-range microcopy — the whole thing reading as a form, on
 * the one surface in the mode that is a decision under a clock. `.td-btn-primary`
 * was `background: transparent`, so the mode's single most important control
 * was visually weaker than the "Back to Arena" link on the result screen.
 *
 * WHAT IS DELIBERATELY UNCHANGED. Every monetary rule. `minimum_bid` and
 * `max_bid` come from the server's own projection, and the reducer re-checks
 * every bid against the persisted budget regardless of what arrives. The clamp
 * here is a COURTESY so a player is shown their range instead of being told
 * "rejected" for something the UI could have prevented. Nothing here decides
 * legality.
 *
 * THE TWO ACTIONS ARE NAMED, NOT PUNCTUATED (S20-06 / S20-07). The old decline
 * control read either `Market Skip — 4 of 5` or `Pass — free`, which taught the
 * rule through a suffix and left the running count inside a button label. The
 * server now publishes `pass_kind`, so the control says which of the three
 * declines it will perform — `Market skip`, `Pass on this lot`, `Concede the
 * lot` — and the count lives on the seat card as a first-class number.
 *
 * A DISABLED CONTROL ALWAYS SAYS WHY. `bid_blocked_reason` is machine-readable;
 * `bidBlockedLabel` turns it into a sentence next to the button rather than
 * into a tooltip. Greying a control out with no reason beside it reads as a
 * broken app rather than as a rule.
 */
export interface BidControlsProps {
  publicState: TwentyDollarPublicState;
  privateState: TwentyDollarPrivateState;
  seatNames: string[];
  /** True while a command is in flight. */
  busy: boolean;
  /**
   * The room's phase machine says the human may act right now.
   *
   * False during the intro, during a lot reveal, during an inter-turn handoff
   * and while a command is pending — every case where offering an action would
   * be offering one that has not opened yet or has already been sent.
   */
  live?: boolean;
  /**
   * The LOCAL countdown reached zero on this seat's turn, with nothing in
   * flight.
   *
   * The controls stop offering an action and say why. This is not the client
   * deciding a timeout — it never submits anything and the server still owns
   * the resolution. Critically it is NOT set while a command is pending: an
   * action sent inside the server's two-second grace window is designed to be
   * accepted, and painting "the clock ran out" over it was defect S20-08.
   */
  expired?: boolean;
  onSubmit: (command: "bid" | "pass", amount: number) => void;
}

export default function BidControls({
  publicState,
  privateState,
  seatNames,
  busy,
  live = true,
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
  const clamped = Math.min(Math.max(amount, min), Math.max(max, min));
  const opening = publicState.current_bid <= 0;
  // `pending` disables; `canBid` is about legality. Kept apart so a control
  // that is merely waiting does not read as one that is refused.
  const pending = busy || expired || !live;
  const canBid = blocked === null && min <= max && !expired;
  const kind = passKind(privateState);

  /* WHICH command is in flight, not merely THAT one is. `busy` is one flag for
     the whole board and both buttons were reading it, so pressing Bid made the
     pass control announce "Submitting…" as well — the screen claimed to be
     doing two contradictory things at once. Label-only: `busy` still disables
     both, because only one command may be in flight. */
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

  const primaryLabel =
    busy && sent !== "pass"
      ? `Sending ${formatDollars(clamped)}…`
      : opening
        ? `Open at ${formatDollars(clamped)}`
        : `Raise to ${formatDollars(clamped)}`;

  return (
    <section className="td-bid" data-testid="td-bid-controls" data-live={live ? "true" : "false"}>
      <div className="td-bid-head">
        <p className="td-bid-label" id="td-bid-label">
          {opening ? "Open the bidding" : "Raise or step aside"}
        </p>
        {/* THE BUDGET LIMIT IS OBVIOUS, and it is a value rather than a
            parenthetical: "$1–$16 legal" was 12 px of grey beside the label. */}
        <p className="td-bid-range pk-numeral" data-testid="td-bid-range">
          {canBid ? `${formatDollars(min)}–${formatDollars(max)}` : `Reserve ${formatDollars(privateState.reserve_floor)}`}
        </p>
      </div>

      <div className="td-stepper" role="group" aria-labelledby="td-bid-label">
        <button
          type="button"
          className="td-step pk-lift pk-press"
          data-testid="td-bid-minus"
          disabled={!canBid || pending || clamped <= min}
          onClick={() => step(-1)}
          aria-label="Decrease bid by one dollar"
        >
          &minus;
        </button>
        <output
          className="td-bid-amount pk-numeral"
          data-testid="td-bid-amount"
          aria-label={`Bid entry ${formatDollars(clamped)}`}
        >
          {formatDollars(clamped)}
        </output>
        <button
          type="button"
          className="td-step pk-lift pk-press"
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
          className="td-chip-btn pk-lift pk-press"
          data-testid="td-bid-plus-1"
          disabled={!canBid || pending || clamped + 1 > max}
          onClick={() => step(1)}
        >
          +$1
        </button>
        <button
          type="button"
          className="td-chip-btn pk-lift pk-press"
          data-testid="td-bid-plus-2"
          disabled={!canBid || pending || clamped + 2 > max}
          onClick={() => step(2)}
        >
          +$2
        </button>
        <button
          type="button"
          className="td-chip-btn pk-lift pk-press"
          data-testid="td-bid-max"
          disabled={!canBid || pending || clamped >= max}
          onClick={() => setAmount(max)}
        >
          Max {formatDollars(max)}
        </button>
      </div>

      <div className="td-bid-actions">
        {/* A REAL FILLED PRIMARY, carrying the amount it will submit.
            IT IS THE ONE ELEMENT IN THIS MODE WITH `.pk-sheen`. A specular
            pass is the effect in the shared set that turns into noise the
            moment a second control has it, so it goes on the single button
            that commits money and nowhere else. Under
            `prefers-reduced-motion` the pass is removed entirely rather than
            shortened, because a fast sheen is a flash. */}
        <button
          type="button"
          className="td-btn td-btn-primary pk-lift pk-press pk-sheen"
          data-testid="td-submit-bid"
          disabled={!canBid || pending}
          data-loading={busy && sent !== "pass" ? "true" : "false"}
          onClick={() => send("bid", clamped)}
        >
          {primaryLabel}
        </button>
        <button
          type="button"
          className="td-btn td-btn-decline pk-lift pk-press"
          data-testid="td-pass"
          /* PASSING IS NOT ALWAYS AVAILABLE. `can_pass` is the server's own
             verdict: a seat out of market skips, facing a candidate it can
             legally use with nothing bid, must open. Deriving that here would
             be a second copy of the rule that could disagree with the first. */
          disabled={pending || !privateState.is_your_turn || !privateState.can_pass}
          data-pass-kind={kind}
          data-costs-skip={kind === "market_skip" ? "true" : "false"}
          data-loading={busy && sent === "pass" ? "true" : "false"}
          onClick={() => send("pass", 0)}
        >
          {busy && sent === "pass" ? "Sending…" : passActionLabel(privateState)}
        </button>
      </div>

      {/* ONE SUPPORTING LINE, NOT FOUR. Whichever of these is true is the only
          thing a player needs read to them at this instant. */}
      {blocked ? (
        <p className="td-bid-blocked" data-testid="td-bid-blocked" role="status">
          {blocked}
        </p>
      ) : expired ? (
        <p className="td-bid-blocked" data-testid="td-bid-expired" role="status">
          The clock ran out. The server is settling this lot — its decision will
          appear here in a moment.
        </p>
      ) : (
        <p className="td-bid-hint" data-testid="td-bid-hint">
          {!privateState.can_pass
            ? `No market skips left, and this player fits your roster — you must open at ${formatDollars(min)}.`
            : passActionCost(privateState, publicState)}
        </p>
      )}
    </section>
  );
}
