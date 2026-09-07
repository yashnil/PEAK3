"use client";

/**
 * RoundReveal — "ROUND 4", said once, then out of the way.
 *
 * A round transition is a Level-2 gameplay event: the board dims, the round
 * identifier lands, an optional constraint line reads under it, and the
 * ceremony (a spinner, a card entrance) takes over. The caller decides
 * WHEN — it is state, derived from the server's phase — and this only owns
 * the entrance. Under reduced motion it is simply there.
 */

import type { ReactNode } from "react";
import { usePrefersReducedMotion } from "@/lib/a11y";

export interface RoundRevealProps {
  open: boolean;
  /** "Round 4" / "Round 1 of 8". */
  title: ReactNode;
  /** The round's constraint or context, e.g. the franchise × decade. */
  detail?: ReactNode;
  eyebrow?: ReactNode;
  /** `"overlay"` centres itself over a `position: relative` parent;
   *  `"inline"` sits in flow. */
  placement?: "overlay" | "inline";
  testId?: string;
  className?: string;
}

export default function RoundReveal({
  open,
  title,
  detail,
  eyebrow,
  placement = "overlay",
  testId = "round-reveal",
  className,
}: RoundRevealProps) {
  const reduced = usePrefersReducedMotion();
  if (!open) return null;
  return (
    <div
      className={`gf-round ${className ?? ""}`}
      data-testid={testId}
      data-placement={placement}
      data-reduced-motion={reduced ? "true" : "false"}
      role="status"
      aria-live="polite"
    >
      {eyebrow ? <span className="gf-round-eyebrow">{eyebrow}</span> : null}
      <span className="gf-round-title">{title}</span>
      {detail ? <span className="gf-round-detail">{detail}</span> : null}
      <span className="gf-round-rule" aria-hidden="true" />
    </div>
  );
}
