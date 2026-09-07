"use client";

/**
 * PeakV2RTTDecisionHead — the one header every RUN THE TABLE decision wears.
 *
 * Eyebrow (where in the run: "Act II · Stop 1 of 2 · Draft Room"), the
 * question as the title, and at most ONE line of context. Anything longer
 * belongs behind a disclosure or in "How to play" — the player is here to
 * decide, not to read.
 */

import type { ReactNode } from "react";

export interface PeakV2RTTDecisionHeadProps {
  eyebrow: ReactNode;
  title: string;
  context?: ReactNode;
  /** A right-aligned instrument (a count, a stakes line). */
  aside?: ReactNode;
  as?: "h1" | "h2";
  tone?: "default" | "boss";
  className?: string;
}

export default function PeakV2RTTDecisionHead({ eyebrow, title, context, aside, as = "h1", tone = "default", className }: PeakV2RTTDecisionHeadProps) {
  const Tag = as;
  return (
    <header className={`rtt-decision-head ${className ?? ""}`} data-tone={tone}>
      <div className="rtt-decision-head-main">
        <span className="rtt-eyebrow">{eyebrow}</span>
        <Tag className="rtt-decision-title">{title}</Tag>
        {context ? <p className="rtt-decision-context">{context}</p> : null}
      </div>
      {aside ? <div className="rtt-decision-head-aside">{aside}</div> : null}
    </header>
  );
}
