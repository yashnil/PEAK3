/**
 * PeakV2CourtSlot — V2 court-card grammar (brief §Court Design Grammar).
 *
 * Establishes the grammar ONLY — no production court migrates to this in
 * Pass 2 ("basketball courts stay basketball courts": 82-0 keeps its one
 * court, Three-Man Weave keeps its three; this is preparation for Pass 3,
 * not a replacement). Every slot — starter or bench, any position — shares
 * ONE fixed footprint (`--v2-court-slot-min-height`) so a grid of slots
 * never produces uneven row heights by position, which the brief calls out
 * as an anti-pattern by name.
 *
 * Layout, top to bottom, always in this order regardless of state:
 *   position label → player name (+ meta) → value → footer (Move, if any)
 * The Move affordance is a normal `PeakV2SecondaryAction` in the slot's own
 * footer row, never an absolutely-positioned control floating in a corner.
 */

import type { ReactNode } from "react";
import PeakV2PlayerIdentity from "./PeakV2PlayerIdentity";
import PeakV2Score from "./PeakV2Score";
import PeakV2SecondaryAction from "./PeakV2SecondaryAction";

export type PeakV2CourtSlotState = "empty" | "filled" | "staged" | "current";

export interface PeakV2CourtSlotProps {
  position: string;
  /** Present only when `state !== "empty"`. */
  player?: { name: string; meta?: string };
  value?: string | number;
  valueLabel?: string;
  state?: PeakV2CourtSlotState;
  /** Renders as a slightly recessed bench treatment — smaller identity
   *  text, no value column — rather than a second component. */
  bench?: boolean;
  onMove?: () => void;
  moveLabel?: string;
  emptyHint?: ReactNode;
  className?: string;
}

const STATE_BORDER: Record<PeakV2CourtSlotState, string> = {
  empty: "var(--v2-border-subtle)",
  filled: "var(--v2-border)",
  staged: "var(--v2-color-accent)",
  current: "var(--v2-color-accent)",
};

export default function PeakV2CourtSlot({
  position,
  player,
  value,
  valueLabel,
  state = player ? "filled" : "empty",
  bench = false,
  onMove,
  moveLabel = "Move",
  emptyHint,
  className,
}: PeakV2CourtSlotProps) {
  return (
    <div
      data-testid="peak-v2-court-slot"
      data-v2-slot-state={state}
      className={`flex flex-col justify-between ${className ?? ""}`}
      style={{
        minHeight: bench ? "var(--v2-court-bench-min-height, 76px)" : "var(--v2-court-slot-min-height, 104px)",
        padding: "var(--v2-space-3)",
        borderRadius: "var(--v2-radius-control)",
        border: `1px solid ${STATE_BORDER[state]}`,
        background: state === "staged" || state === "current" ? "var(--v2-bg-plane)" : "transparent",
      }}
    >
      <span
        style={{
          fontFamily: "var(--v2-font-mono)",
          fontSize: "0.6875rem",
          fontWeight: 700,
          letterSpacing: "0.04em",
          color: "var(--v2-text-muted)",
        }}
      >
        {position}
      </span>

      <div className="flex flex-1 items-center justify-between gap-3">
        {player ? (
          <PeakV2PlayerIdentity
            name={player.name}
            meta={bench ? undefined : player.meta}
            size={bench ? "sm" : "md"}
            state={state === "current" ? "current" : state === "staged" ? "selected" : "default"}
          />
        ) : (
          <span
            style={{
              fontFamily: "var(--v2-font-ui)",
              fontSize: "0.8125rem",
              color: "var(--v2-text-muted)",
            }}
          >
            {emptyHint ?? "Open"}
          </span>
        )}
        {!bench && value !== undefined ? (
          <PeakV2Score value={value} label={valueLabel} size="sm" />
        ) : null}
      </div>

      {onMove ? (
        <div className="flex justify-end pt-1">
          <PeakV2SecondaryAction size="sm" onClick={onMove}>
            {moveLabel}
          </PeakV2SecondaryAction>
        </div>
      ) : null}
    </div>
  );
}
