"use client";

/**
 * PeakV2ShowdownBidControls — V2 presentation of the auction control
 * (Pass 3). Every legality rule is unchanged: this calls the exact same
 * `bidBlockedLabel`/`passActionLabel`/`passKind`/`passActionCost` helpers
 * legacy `BidControls` uses, and the clamp here is the same courtesy
 * (never the actual legality check, which the server re-verifies
 * regardless of what this shows).
 */

import { useEffect, useRef, useState } from "react";
import {
  bidBlockedLabel,
  formatDollars,
  passActionCost,
  passActionLabel,
  type TwentyDollarPrivateState,
  type TwentyDollarPublicState,
} from "@/lib/twenty-dollar-api";
import PeakV2PrimaryAction from "../PeakV2PrimaryAction";
import PeakV2SecondaryAction from "../PeakV2SecondaryAction";

export interface PeakV2ShowdownBidControlsProps {
  publicState: TwentyDollarPublicState;
  privateState: TwentyDollarPrivateState;
  seatNames: string[];
  busy: boolean;
  live?: boolean;
  expired?: boolean;
  onSubmit: (command: "bid" | "pass", amount: number) => void;
}

export default function PeakV2ShowdownBidControls({
  publicState,
  privateState,
  seatNames,
  busy,
  live = true,
  expired = false,
  onSubmit,
}: PeakV2ShowdownBidControlsProps) {
  const min = Math.max(1, privateState.minimum_bid);
  const max = Math.max(0, privateState.max_bid);
  const [amount, setAmount] = useState(min);

  useEffect(() => {
    setAmount(Math.min(Math.max(min, 1), Math.max(max, 1)));
  }, [min, max, publicState.lot_index]);

  const blocked = bidBlockedLabel(privateState.bid_blocked_reason, seatNames, publicState.active_seat);
  // WHEN NO LEGAL BID EXISTS (a reserve floor pushes `max` below `min`),
  // `Math.max(max, min)` degenerates to `min` — the wrong direction: it
  // would display an amount ABOVE the true ceiling instead of capping to
  // it. The button stays correctly disabled via `canBid` either way (the
  // server never sees this number), but the number on screen should still
  // be the honest one, so the clamp only runs when a legal window exists.
  const clamped = min <= max ? Math.min(Math.max(amount, min), max) : max;
  const opening = publicState.current_bid <= 0;
  const pending = busy || expired || !live;
  const canBid = blocked === null && min <= max && !expired;
  const uncontested = publicState.lot_kind === "uncontested" && opening;

  const [sent, setSent] = useState<"bid" | "pass" | null>(null);
  useEffect(() => {
    if (!busy) setSent(null);
  }, [busy]);
  // A REF GUARD, NOT JUST THE `disabled` ATTRIBUTE. Two clicks dispatched in
  // the same tick (an accidental rapid double-click) both fire React's
  // onClick before a render can flip the button's `disabled` prop, so the
  // DOM attribute alone lags by exactly one frame — long enough for a
  // second submit to slip through and reach the server as a duplicate
  // request. This ref is checked and set synchronously, so the second call
  // in the same tick is a no-op regardless of render timing, and it clears
  // once the in-flight command resolves (`busy` returning to false).
  const submittingRef = useRef(false);
  useEffect(() => {
    if (!busy) submittingRef.current = false;
  }, [busy]);
  const send = (command: "bid" | "pass", value: number) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSent(command);
    onSubmit(command, value);
  };
  const step = (delta: number) => setAmount((v) => Math.min(Math.max(v + delta, min), Math.max(max, min)));

  const primaryLabel =
    busy && sent !== "pass"
      ? `Sending ${formatDollars(clamped)}…`
      : uncontested
        ? `Claim for ${formatDollars(clamped)}`
        : opening
          ? `Open at ${formatDollars(clamped)}`
          : `Raise to ${formatDollars(clamped)}`;

  return (
    <div data-testid="td-bid-controls" data-live={live ? "true" : "false"} data-lot-kind={publicState.lot_kind ?? "standard"}>
      <div className="flex items-baseline justify-between">
        <p style={{ fontFamily: "var(--v2-font-ui)", fontWeight: 700, fontSize: "0.875rem", color: "var(--v2-text-primary)" }}>
          {uncontested ? "No one else can compete for this player" : opening ? "Open the bidding" : "Raise or step aside"}
        </p>
        <p style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}>
          {uncontested ? `Floor ${formatDollars(clamped)}` : canBid ? `Legal ${formatDollars(min)}–${formatDollars(max)}` : `Reserve ${formatDollars(privateState.reserve_floor)}`}
        </p>
      </div>

      {!uncontested ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="td-bid-minus"
            disabled={!canBid || pending || clamped <= min}
            onClick={() => step(-1)}
            aria-label="Decrease bid by one dollar"
            className="flex h-9 w-9 items-center justify-center rounded disabled:opacity-40"
            style={{ border: "1px solid var(--v2-border)", color: "var(--v2-text-primary)", fontFamily: "var(--v2-font-mono)" }}
          >
            −
          </button>
          <output
            data-testid="td-bid-amount"
            aria-label={`Bid entry ${formatDollars(clamped)}`}
            style={{ fontFamily: "var(--v2-font-mono)", fontSize: "1.5rem", fontWeight: 700, color: "var(--v2-color-accent)", minWidth: "4ch", textAlign: "center" }}
          >
            {formatDollars(clamped)}
          </output>
          <button
            type="button"
            data-testid="td-bid-plus"
            disabled={!canBid || pending || clamped >= max}
            onClick={() => step(1)}
            aria-label="Increase bid by one dollar"
            className="flex h-9 w-9 items-center justify-center rounded disabled:opacity-40"
            style={{ border: "1px solid var(--v2-border)", color: "var(--v2-text-primary)", fontFamily: "var(--v2-font-mono)" }}
          >
            +
          </button>
          {/* A GENUINELY DIFFERENT JUMP, NOT A DUPLICATE OF THE STEPPER. This
              used to be a second "+$1" chip sitting beside a "+" stepper
              button that already does exactly that — two controls with the
              identical effect is the "too many equally-weighted buttons"
              anti-pattern, not a real quick-jump. "+$2" (legacy's own second
              increment) is a real second speed, same as "Max" is a third. */}
          <div className="ml-2 flex items-center gap-1.5">
            <button
              type="button"
              data-testid="td-bid-plus-2"
              disabled={!canBid || pending || clamped + 2 > max}
              onClick={() => step(2)}
              className="rounded px-2 py-1 text-xs disabled:opacity-40"
              style={{ border: "1px solid var(--v2-border-subtle)", color: "var(--v2-text-secondary)", fontFamily: "var(--v2-font-mono)" }}
            >
              +$2
            </button>
            <button
              type="button"
              data-testid="td-bid-max"
              disabled={!canBid || pending || clamped >= max}
              onClick={() => setAmount(max)}
              className="rounded px-2 py-1 text-xs disabled:opacity-40"
              style={{ border: "1px solid var(--v2-border-subtle)", color: "var(--v2-text-secondary)", fontFamily: "var(--v2-font-mono)" }}
            >
              Max {formatDollars(max)}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-3">
        {/* A STABLE MINIMUM WIDTH. "Open at $1" / "Raise to $16" / "Sending
            $16 bid…" span a wide character-count range as the amount and
            phase change, and this button sits directly beside the stepper a
            player is actively clicking — letting it reflow its own width on
            every keystroke is the "buttons changing width when their label
            changes" defect. 15ch comfortably fits the longest real label
            ("Sending $16 bid…") without the button visibly resizing for the
            common shorter ones. */}
        <PeakV2PrimaryAction
          data-testid="td-submit-bid"
          disabled={!canBid || pending}
          aria-busy={busy && sent !== "pass"}
          onClick={() => send("bid", clamped)}
          style={{ minWidth: "15ch" }}
        >
          {primaryLabel}
        </PeakV2PrimaryAction>
        <PeakV2SecondaryAction
          data-testid="td-pass"
          disabled={pending || !privateState.is_your_turn || !privateState.can_pass}
          onClick={() => send("pass", 0)}
        >
          {busy && sent === "pass" ? "Sending…" : passActionLabel(privateState)}
        </PeakV2SecondaryAction>
      </div>

      <p
        data-testid={blocked ? "td-bid-blocked" : "td-bid-hint"}
        className="mt-2"
        style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: blocked || expired ? "var(--v2-color-negative)" : "var(--v2-text-muted)" }}
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
