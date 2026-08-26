/**
 * PeakV2PlayerIdentity — UI/PLAYER IDENTITY role: a player's name plus its
 * real metadata (team · season window, position). This is the identity row
 * used across every court/roster/duel surface — the thing that must
 * preserve left/right continuity, never swap or re-sort by outcome.
 *
 * No photo slot: PEAK3 uses no player photographs (CLAUDE.md, unlicensed).
 * Position renders as a compact instrumentation-styled tag, not a pill —
 * per the brief's anti-badge rule, this is text with alignment, not a
 * bordered chip.
 */

import type { ReactNode } from "react";

export interface PeakV2PlayerIdentityProps {
  name: string;
  /** e.g. "Utah Jazz · 2010s" — a real window label, never invented.
   *  Accepts a `ReactNode` (not just a string) so a caller can embed a
   *  real, stably-testid'd reveal/lock note inline (e.g. 82-0's
   *  `exact-season-line`/`peak-locked-note`/`revealed-score-line`) rather
   *  than flattening it to unstructured text. */
  meta?: ReactNode;
  position?: string;
  /** `"current"` — this identity is the thing the screen is about right
   *  now (gets the gold accent). `"selected"` — staged/chosen but not yet
   *  committed. `"default"` — plain. */
  state?: "default" | "current" | "selected";
  size?: "sm" | "md" | "lg";
  align?: "start" | "center" | "end";
  className?: string;
  /** Optional `data-testid` on the meta line itself, for a caller whose
   *  meta text carries the one piece of state a test needs to read (e.g.
   *  a court slot's scoring season). Omitted entirely when not supplied. */
  metaTestId?: string;
}

const ALIGN_CLASS: Record<NonNullable<PeakV2PlayerIdentityProps["align"]>, string> = {
  start: "items-start text-left",
  center: "items-center text-center",
  end: "items-end text-right",
};

const NAME_SIZE: Record<NonNullable<PeakV2PlayerIdentityProps["size"]>, string> = {
  sm: "0.875rem",
  md: "1rem",
  lg: "1.25rem",
};

export default function PeakV2PlayerIdentity({
  name,
  meta,
  position,
  state = "default",
  size = "md",
  align = "start",
  className,
  metaTestId,
}: PeakV2PlayerIdentityProps) {
  return (
    <div className={`flex flex-col ${ALIGN_CLASS[align]} ${className ?? ""}`}>
      <div className="flex items-center gap-2" style={align === "end" ? { flexDirection: "row-reverse" } : undefined}>
        {position ? (
          <span
            style={{
              fontFamily: "var(--v2-font-mono)",
              fontSize: "0.6875rem",
              fontWeight: 700,
              letterSpacing: "0.02em",
              color: "var(--v2-text-muted)",
            }}
          >
            {position}
          </span>
        ) : null}
        <span
          style={{
            fontFamily: "var(--v2-font-ui)",
            fontWeight: 700,
            fontSize: NAME_SIZE[size],
            letterSpacing: "-0.006em",
            color: state === "current" ? "var(--v2-color-accent)" : "var(--v2-text-primary)",
          }}
        >
          {name}
        </span>
        {state === "selected" ? (
          <span
            aria-hidden="true"
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--v2-color-accent)",
              flexShrink: 0,
            }}
          />
        ) : null}
      </div>
      {meta ? (
        <span
          data-testid={metaTestId}
          style={{
            fontFamily: "var(--v2-font-ui)",
            fontSize: "0.75rem",
            color: "var(--v2-text-secondary)",
          }}
        >
          {meta}
        </span>
      ) : null}
    </div>
  );
}
