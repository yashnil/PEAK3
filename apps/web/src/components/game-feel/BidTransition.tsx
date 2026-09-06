"use client";

/**
 * BidTransition — the standing figure changes hands, visibly.
 *
 * A current bid, a standing record, a lead: a number that other players
 * MOVE, not one that drifts. Unlike `ScoreTransition` (a tween to the
 * server's value, right for a total) this is a discrete swap: the old
 * figure leaves, the new one locks, and the element carries WHO moved it
 * and whether that was for or against the local player, so the stylesheet
 * can give an opponent's raise a different weight from the player's own and
 * a test can read the same facts.
 *
 * `holder` changes the tone; `beat` bumps on every change so the same value
 * arriving twice (a poll) does not restart the swap. Under reduced motion the
 * new figure is simply there.
 */

import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/a11y";

export interface BidTransitionProps {
  value: number;
  format?: (value: number) => string;
  /** Who set this value: the local player, a rival, or nobody (the floor). */
  holder: "you" | "rival" | "bot" | "none";
  /** Optional line under the figure ("You lead", "IsoKing leads"). */
  caption?: string;
  /** A pending, not-yet-authoritative figure the local player has just sent. */
  pendingValue?: number | null;
  size?: "md" | "lg";
  testId?: string;
  valueTestId?: string;
  captionTestId?: string;
  className?: string;
}

const SWAP_MS = 380;

export default function BidTransition({
  value,
  format = (n) => String(Math.round(n)),
  holder,
  caption,
  pendingValue = null,
  size = "lg",
  testId = "bid-transition",
  valueTestId,
  captionTestId,
  className,
}: BidTransitionProps) {
  const reduced = usePrefersReducedMotion();
  const previous = useRef<number>(value);
  const [swap, setSwap] = useState<{ from: number; direction: "up" | "down"; id: number } | null>(null);
  const counter = useRef(0);

  useEffect(() => {
    const from = previous.current;
    if (from === value) return;
    previous.current = value;
    if (reduced) return;
    counter.current += 1;
    setSwap({ from, direction: value > from ? "up" : "down", id: counter.current });
    const id = window.setTimeout(() => setSwap((current) => (current?.id === counter.current ? null : current)), SWAP_MS);
    return () => window.clearTimeout(id);
  }, [value, reduced]);

  const showing = pendingValue !== null && pendingValue !== value;

  return (
    <div
      className={`gf-bid ${className ?? ""}`}
      data-testid={testId}
      data-holder={holder}
      data-size={size}
      data-swapping={swap ? "true" : "false"}
      data-direction={swap?.direction ?? undefined}
      data-pending={showing ? "true" : "false"}
      data-reduced-motion={reduced ? "true" : "false"}
    >
      <span className="gf-bid-figure">
        {swap ? (
          <span className="gf-bid-outgoing" aria-hidden="true" key={`out-${swap.id}`}>
            {format(swap.from)}
          </span>
        ) : null}
        <span className="gf-bid-value" data-testid={valueTestId} key={`in-${swap?.id ?? 0}`}>
          {format(value)}
        </span>
        {showing ? (
          <span className="gf-bid-pending" data-testid={valueTestId ? `${valueTestId}-pending` : undefined}>
            → {format(pendingValue as number)}
          </span>
        ) : null}
      </span>
      {caption ? (
        <span className="gf-bid-caption" data-testid={captionTestId}>
          {caption}
        </span>
      ) : null}
    </div>
  );
}
