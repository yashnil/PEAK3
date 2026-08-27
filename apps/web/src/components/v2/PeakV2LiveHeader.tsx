/**
 * PeakV2LiveHeader — the compact header bar for a LIVE decision screen:
 * drafting, bidding, roster arrangement, choosing a duel. Immediate, crisp,
 * minimal container nesting — a title, an optional phase status, and a
 * right-aligned instrumentation slot (a `PeakV2Timer`/`PeakV2Score`),
 * separated from the content below it by a single `PeakV2Rule`, not a
 * bordered card.
 */

import type { ReactNode } from "react";
import PeakV2Rule from "./PeakV2Rule";

export interface PeakV2LiveHeaderProps {
  title: string;
  subtitle?: string;
  /** A `PeakV2GameStatus` or similar — the current phase. */
  status?: ReactNode;
  /** A `PeakV2Timer`/`PeakV2Score` — the right-aligned instrument. */
  instrument?: ReactNode;
  rule?: boolean;
  /** `"h2"` by default — a LIVE header is almost always a SECTION of a
   *  screen that already has its own `<h1>` (a cinematic hero, a page
   *  title). Pass `"h1"` only when this genuinely is the page's one main
   *  heading (a standalone LIVE-only screen with no cinematic stage above
   *  it) — correct heading hierarchy is a hard accessibility requirement,
   *  not a style choice, so this is deliberately explicit rather than
   *  guessed from context. */
  as?: "h1" | "h2";
  className?: string;
}

export default function PeakV2LiveHeader({
  title,
  subtitle,
  status,
  instrument,
  rule = true,
  as = "h2",
  className,
}: PeakV2LiveHeaderProps) {
  const Tag = as;
  return (
    <header className={className}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          {status}
          <Tag
            style={{
              fontFamily: "var(--v2-font-ui)",
              fontWeight: 700,
              fontSize: "1.25rem",
              letterSpacing: "-0.01em",
              color: "var(--v2-text-primary)",
              margin: 0,
            }}
          >
            {title}
          </Tag>
          {subtitle ? (
            <p
              style={{
                fontFamily: "var(--v2-font-ui)",
                fontSize: "0.8125rem",
                color: "var(--v2-text-secondary)",
                margin: 0,
              }}
            >
              {subtitle}
            </p>
          ) : null}
        </div>
        {instrument ? <div className="shrink-0">{instrument}</div> : null}
      </div>
      {rule ? <PeakV2Rule spacing="sm" /> : null}
    </header>
  );
}
