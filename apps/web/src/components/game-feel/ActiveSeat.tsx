"use client";

/**
 * ActiveSeat — one vocabulary for "whose moment is it".
 *
 * A seat panel is `active` (on the clock), `receded` (somebody else is), or
 * `idle` (no turn is running). The owner says who: the local player, a
 * rival human, or a bot. Both are carried as data attributes so the
 * stylesheet does the emphasis and every mode's panels agree on what
 * "active" looks like — a stronger edge, a lit floor, a slight lift — and
 * what "receded" looks like — legible, quieter, never hidden.
 */

import type { ReactNode } from "react";

export type ActiveSeatState = "active" | "receded" | "idle";
export type ActiveSeatOwner = "you" | "rival" | "bot" | "none";

export interface ActiveSeatProps {
  state: ActiveSeatState;
  owner?: ActiveSeatOwner;
  children: ReactNode;
  className?: string;
  testId?: string;
  /** A finished roster, for the completion trace. */
  complete?: boolean;
}

export default function ActiveSeat({ state, owner = "none", children, className, testId, complete = false }: ActiveSeatProps) {
  return (
    <div
      className={`gf-seat ${className ?? ""}`}
      data-testid={testId}
      data-gf-seat={state}
      data-gf-owner={owner}
      data-gf-complete={complete ? "true" : "false"}
    >
      {children}
    </div>
  );
}
