"use client";

/**
 * RosterSlotLock — an empty slot is a goal; a filled slot is a piece.
 *
 * Every roster in the product is a list of positions with either a player
 * or nothing in each. This is the one shape for a slot: `empty` (a dashed
 * goal, quietly), `targeted` (the live candidate could land here), `pending`
 * (an action that would fill it is in flight) and `filled` (a piece on the
 * board). When a slot goes from empty to filled in the same render the
 * server's snapshot lands, the caller passes `arrived` (from `useArrivals`)
 * and the slot LOCKS with a short Level-2 beat; a `swapped` slot flashes
 * without moving.
 *
 * Paint-only by default so a roster's geometry never changes between states
 * (the same contract 82-0's court holds); the beat is light, edge and a
 * short settle. Reduced motion shows the final state.
 */

import type { ReactNode } from "react";
import { usePrefersReducedMotion } from "@/lib/a11y";

export type RosterSlotState = "empty" | "targeted" | "pending" | "filled";

export interface RosterSlotLockProps {
  slot: string;
  state: RosterSlotState;
  /** `useArrivals` result for this slot, if any. */
  beat?: "arrived" | "swapped" | null;
  /** The occupant, when filled. */
  children?: ReactNode;
  /** Shown while empty: "Open", "Needs a C", a target hint. */
  placeholder?: ReactNode;
  /** A trailing figure: price, score, pick number. */
  figure?: ReactNode;
  align?: "start" | "end";
  size?: "sm" | "md";
  tone?: "you" | "rival" | "bot";
  testId?: string;
  className?: string;
}

export default function RosterSlotLock({
  slot,
  state,
  beat = null,
  children,
  placeholder = "Open",
  figure,
  align = "start",
  size = "md",
  tone = "you",
  testId,
  className,
}: RosterSlotLockProps) {
  const reduced = usePrefersReducedMotion();
  return (
    <li
      className={`gf-slot ${className ?? ""}`}
      data-testid={testId}
      data-slot={slot}
      data-state={state}
      data-filled={state === "filled" ? "true" : "false"}
      data-gf-lock={beat ?? undefined}
      data-align={align}
      data-size={size}
      data-tone={tone}
      data-reduced-motion={reduced ? "true" : "false"}
    >
      <span className="gf-slot-position" aria-hidden="true">
        {slot}
      </span>
      <span className="gf-slot-body">
        <span className="sr-only">{slot}: </span>
        {state === "filled" ? children : <span className="gf-slot-placeholder">{placeholder}</span>}
      </span>
      {figure !== undefined ? <span className="gf-slot-figure">{figure}</span> : null}
    </li>
  );
}
