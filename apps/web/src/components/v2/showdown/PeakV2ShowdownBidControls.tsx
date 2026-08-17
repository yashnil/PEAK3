"use client";

/**
 * PeakV2ShowdownBidControls — V2 presentation of the auction control
 * (Pass 3). Every legality rule is unchanged: this calls the exact same
 * `bidBlockedLabel`/`passActionLabel`/`passKind`/`passActionCost` helpers
 * legacy `BidControls` uses, and the clamp here is the same courtesy
 * (never the actual legality check, which the server re-verifies
 * regardless of what this shows).
 */

import { useEffect, useState } from "react";
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
  const clamped = Math.min(Math.max(amount, min), Math.max(max, min));
  const opening = publicState.current_bid <= 0;
  const pending = busy || expired || !live;
  const canBid = blocked === null && min <= max && !expired;
  const uncontested = publicState.lot_kind === "uncontested" && opening;

  const [sent, setSent] = useState<"bid" | "pass" | null>(null);
  useEffect(() => {
    if (!busy) setSent(null);
  }, [busy]);
  const send = (command: "bid" | "pass", value: number) => {
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
    <div data-lot-kind={publicState.lot_kind ?? "standard"}>
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
            disabled={!canBid || pending || clamped <= min}
            onClick={() => step(-1)}
            aria-label="Decrease bid by one dollar"
            className="flex h-9 w-9 items-center justify-center rounded disabled:opacity-40"
            style={{ border: "1px solid var(--v2-border)", color: "var(--v2-text-primary)", fontFamily: "var(--v2-font-mono)" }}
          >
            −
          </button>
          <output
            aria-label={`Bid entry ${formatDollars(clamped)}`}
            style={{ fontFamily: "var(--v2-font-mono)", fontSize: "1.5rem", fontWeight: 700, color: "var(--v2-color-accent)", minWidth: "4ch", textAlign: "center" }}
          >
            {formatDollars(clamped)}
          </output>
          <button
            type="button"
            disabled={!canBid || pending || clamped >= max}
            onClick={() => step(1)}
            aria-label="Increase bid by one dollar"
            className="flex h-9 w-9 items-center justify-center rounded disabled:opacity-40"
            style={{ border: "1px solid var(--v2-border)", color: "var(--v2-text-primary)", fontFamily: "var(--v2-font-mono)" }}
          >
            +
          </button>
          <div className="ml-2 flex items-center gap-1.5">
            <button
              type="button"
              disabled={!canBid || pending || clamped + 1 > max}
              onClick={() => step(1)}
              className="rounded px-2 py-1 text-xs disabled:opacity-40"
              style={{ border: "1px solid var(--v2-border-subtle)", color: "var(--v2-text-secondary)", fontFamily: "var(--v2-font-mono)" }}
            >
              +$1
            </button>
            <button
              type="button"
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
        <PeakV2PrimaryAction disabled={!canBid || pending} aria-busy={busy && sent !== "pass"} onClick={() => send("bid", clamped)}>
          {primaryLabel}
        </PeakV2PrimaryAction>
        <PeakV2SecondaryAction disabled={pending || !privateState.is_your_turn || !privateState.can_pass} onClick={() => send("pass", 0)}>
          {busy && sent === "pass" ? "Sending…" : passActionLabel(privateState)}
        </PeakV2SecondaryAction>
      </div>

      <p className="mt-2" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: blocked || expired ? "var(--v2-color-negative)" : "var(--v2-text-muted)" }}>
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
