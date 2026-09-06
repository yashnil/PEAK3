"use client";

/**
 * CardArrival — a new object ENTERS; it is never swapped in place.
 *
 * A lot going on the block, a boss lining up, a dealt hand: when the thing
 * on stage changes identity, the old one leaves and the new one arrives.
 * The caller keys the arrival on the object's identity (`arrivalKey`), so a
 * re-render with the same object does nothing and a new object restarts the
 * entrance. The entrance is a Level-2 event (under half a second), starts on
 * the same frame the state lands, and never blocks anything beneath it —
 * controls under a card that is still arriving are live.
 *
 * `direction` says where it comes from; `variant="stage"` is the larger
 * entrance for the hero object of a screen.
 */

import type { ReactNode } from "react";
import { usePrefersReducedMotion } from "@/lib/a11y";

export interface CardArrivalProps {
  /** The object's identity. A new key is a new arrival. */
  arrivalKey: string | number;
  children: ReactNode;
  direction?: "up" | "down" | "left" | "right";
  variant?: "stage" | "slot";
  as?: "div" | "section" | "li";
  className?: string;
  testId?: string;
  /** Skip the entrance for the very first render (a page load is not an event). */
  skipInitial?: boolean;
}

export default function CardArrival({
  arrivalKey,
  children,
  direction = "up",
  variant = "stage",
  as = "div",
  className,
  testId,
  skipInitial = false,
}: CardArrivalProps) {
  const reduced = usePrefersReducedMotion();
  const Tag = as;
  return (
    <Tag
      key={arrivalKey}
      className={`gf-arrival ${className ?? ""}`}
      data-testid={testId}
      data-arrival-key={String(arrivalKey)}
      data-direction={direction}
      data-variant={variant}
      data-reduced-motion={reduced ? "true" : "false"}
      data-skip-initial={skipInitial ? "true" : "false"}
    >
      {children}
    </Tag>
  );
}
