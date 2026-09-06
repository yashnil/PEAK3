"use client";

/**
 * PeakV2ShowdownBidControls — the bidder's hands.
 *
 * THE PROPOSED BID IS LOCAL AND IMMEDIATE. Stepping the amount updates the
 * figure, the primary action's label ("Bid $7") and the projected budget in
 * the same frame, with no request. Only pressing the primary action sends
 * anything, and that press:
 *
 *   * goes through `GameActionButton`, so it is acknowledged on pointer-down,
 *     shows pending for exactly as long as the request lasts, and reads the
 *     lane's answer for its confirmed or error beat;
 *   * emits exactly one command (the lane refuses a duplicate before any
 *     handler runs; the button's own guard refuses a same-tick double press);
 *   * locks the proposed figure for the request's duration.
 *
 * Every legality rule is the server's: `minimum_bid`, `max_bid`,
 * `bid_blocked_reason`, `can_pass` and `pass_kind` are read, never derived,
 * and the clamp here is a courtesy so a player is not told "rejected" for
 * something the UI could have shown.
 */

import {
  bidBlockedLabel,
  formatDollars,
  isWaitingBlockedReason,
  passActionCost,
  passActionLabel,
  type TwentyDollarPrivateState,
  type TwentyDollarPublicState,
} from "@/lib/twenty-dollar-api";
import { GameActionButton } from "@/components/game-feel";

export interface PeakV2ShowdownBidControlsProps {
  publicState: TwentyDollarPublicState;
  privateState: TwentyDollarPrivateState;
  seatNames: string[];
  /** The proposed amount, owned by the stage so budgets can project it. */
  amount: number;
  onAmountChange: (amount: number) => void;
  /** True while a command of this client's is in flight. */
  pending: boolean;
  /** Which command is in flight, for the labels. */
  pendingCommand?: "bid" | "pass" | null;
  live?: boolean;
  expired?: boolean;
  /** Resolves true when the server accepted the action. */
  onAct: (command: "bid" | "pass", amount: number) => Promise<boolean>;
}

export default function PeakV2ShowdownBidControls({
  publicState,
  privateState,
  seatNames,
  amount,
  onAmountChange,
  pending,
  pendingCommand = null,
  live = true,
  expired = false,
  onAct,
}: PeakV2ShowdownBidControlsProps) {
  const min = Math.max(1, privateState.minimum_bid);
  const max = Math.max(0, privateState.max_bid);
  const legal = min <= max;
  // WHEN NO LEGAL BID EXISTS (a reserve floor pushes `max` below `min`) the
  // displayed figure stays honest -- the ceiling, not something above it.
  const clamped = legal ? Math.min(Math.max(amount, min), max) : max;

  const blocked = bidBlockedLabel(privateState.bid_blocked_reason, seatNames, publicState.active_seat);
  const opening = publicState.current_bid <= 0;
  const inactive = pending || expired || !live;
  const canBid = blocked === null && legal && !expired;
  const uncontested = publicState.lot_kind === "uncontested" && opening;
  const step = (delta: number) => onAmountChange(Math.min(Math.max(clamped + delta, min), Math.max(max, min)));

  const primaryLabel = uncontested ? `Claim for ${formatDollars(clamped)}` : `Bid ${formatDollars(clamped)}`;
  const passLabel = passActionLabel(privateState);

  return (
    <div className="sd-controls" data-testid="td-bid-controls" data-live={live ? "true" : "false"} data-lot-kind={publicState.lot_kind ?? "standard"}>
      <div className="sd-controls-head">
        <p className="sd-controls-title">
          {uncontested ? "Nobody else can use this player" : opening ? "Open the bidding" : "Raise or step aside"}
        </p>
        <p className="sd-controls-range">
          {uncontested ? `Floor ${formatDollars(clamped)}` : canBid ? `Legal ${formatDollars(min)}–${formatDollars(max)}` : `Reserve ${formatDollars(privateState.reserve_floor)}`}
        </p>
      </div>

      {!uncontested ? (
        <div className="sd-stepper" data-locked={pending ? "true" : "false"}>
          <button
            type="button"
            className="sd-step"
            data-testid="td-bid-minus"
            disabled={!canBid || inactive || clamped <= min}
            onClick={() => step(-1)}
            aria-label="Decrease bid by one dollar"
          >
            −
          </button>
          <output className="sd-stepper-amount pk-numeral" data-testid="td-bid-amount" aria-label={`Bid entry ${formatDollars(clamped)}`}>
            {formatDollars(clamped)}
          </output>
          <button
            type="button"
            className="sd-step"
            data-testid="td-bid-plus"
            disabled={!canBid || inactive || clamped >= max}
            onClick={() => step(1)}
            aria-label="Increase bid by one dollar"
          >
            +
          </button>
          <div className="sd-quick">
            <button type="button" className="sd-chip" data-testid="td-bid-plus-2" disabled={!canBid || inactive || clamped + 2 > max} onClick={() => step(2)}>
              +$2
            </button>
            <button type="button" className="sd-chip" data-testid="td-bid-max" disabled={!canBid || inactive || clamped >= max} onClick={() => onAmountChange(max)}>
              Max {formatDollars(max)}
            </button>
          </div>
        </div>
      ) : null}

      <div className="sd-actions">
        <GameActionButton
          data-testid="td-submit-bid"
          disabled={!canBid || inactive}
          pending={pending && pendingCommand === "bid"}
          pendingLabel={`Sending ${formatDollars(clamped)}…`}
          onAction={() => onAct("bid", clamped)}
          className="sd-primary"
          style={{ minWidth: "12ch" }}
        >
          {primaryLabel}
        </GameActionButton>
        <GameActionButton
          data-testid="td-pass"
          variant="secondary"
          disabled={inactive || !privateState.is_your_turn || !privateState.can_pass}
          pending={pending && pendingCommand === "pass"}
          pendingLabel="Sending…"
          onAction={() => onAct("pass", 0)}
        >
          {passLabel}
        </GameActionButton>
      </div>

      <p
        data-testid={blocked ? "td-bid-blocked" : "td-bid-hint"}
        className="sd-hint"
        data-tone={(blocked && !isWaitingBlockedReason(privateState.bid_blocked_reason)) || expired ? "negative" : "muted"}
      >
        {blocked
          ? blocked
          : expired
            ? "The clock ran out. The server is settling this lot."
            : uncontested
              ? "The other roster has no legal way to use this player."
              : !privateState.can_pass
                ? `No market skips left — you must open at ${formatDollars(min)}.`
                : passActionCost(privateState, publicState)}
      </p>
    </div>
  );
}
