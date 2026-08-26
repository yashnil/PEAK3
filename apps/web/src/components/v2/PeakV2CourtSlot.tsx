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

import type { CSSProperties, ReactNode } from "react";
import PeakV2PlayerIdentity from "./PeakV2PlayerIdentity";
import PeakV2Score from "./PeakV2Score";
import PeakV2SecondaryAction from "./PeakV2SecondaryAction";

export type PeakV2CourtSlotState = "empty" | "filled" | "staged" | "current";

export interface PeakV2CourtSlotProps {
  position: string;
  /** Present only when `state !== "empty"`. `meta` accepts a `ReactNode` so
   *  a caller can embed a real, stably-testid'd reveal/lock note. */
  player?: { name: string; meta?: ReactNode };
  value?: string | number;
  valueLabel?: string;
  state?: PeakV2CourtSlotState;
  /** Renders as a slightly recessed bench treatment — smaller identity
   *  text, no value column — rather than a second component. */
  bench?: boolean;
  onMove?: () => void;
  moveLabel?: string;
  /** Optional `data-testid` for the Move button, set only by callers that
   *  need a stable hook for it (e.g. 82-0's court, `slot-move-btn`) —
   *  omitted by every other caller of this shared primitive, so their
   *  Move button is completely unaffected. */
  moveTestId?: string;
  emptyHint?: ReactNode;
  className?: string;
  /** Optional `data-testid` on the occupant's meta line (season/team) —
   *  see `PeakV2PlayerIdentity`'s `metaTestId`. */
  metaTestId?: string;
  /**
   * Between-turn pick-up/drop rearrangement (Pass 4), mirroring legacy
   * `SeatCourt`'s own `SlotCard` exactly: the whole slot becomes a real
   * `<button>` (keyboard + pointer + drag all fire the same `onActivate`)
   * when `interactive` and either the slot holds a player or a card is
   * already in hand (`moving`) — an empty, non-moving slot stays inert,
   * same as legacy's `!pick && !moving` gate. Legality is NEVER decided
   * here: every slot is a real target while `moving`, including illegal
   * ones, so the caller's specific rejection reason is reachable rather
   * than a dead click — the caller signals a legal target purely through
   * the `"staged"` `state` value, which already carries the visual accent.
   */
  interactive?: boolean;
  /** True while ANY slot on this court is currently picked up (not
   *  necessarily this one) — legacy's `moving` — since an empty slot only
   *  becomes a real target once something is in hand. */
  moving?: boolean;
  /** Fires on click/Enter/Space AND on drag-start — this slot's own
   *  occupant is what gets picked up. Omitted on an empty slot. */
  onPickUp?: () => void;
  /** Fires on click/Enter/Space (while `moving`) AND on drop — this slot
   *  is the destination. The caller decides legality; every slot is a
   *  real target while `moving`. */
  onDropOn?: () => void;
  /** The accessible name while interactive — callers build the exact
   *  "rearrange"/"move here"/"not a legal destination" sentence, since
   *  only they hold the player names on both ends of a prospective move. */
  activateLabel?: string;
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
  moveTestId,
  emptyHint,
  className,
  interactive = false,
  moving = false,
  onPickUp,
  onDropOn,
  activateLabel,
  metaTestId,
}: PeakV2CourtSlotProps) {
  // Same gate as legacy `SlotCard`: an empty, non-moving slot has nothing to
  // pick up and stays inert. Everything else — a filled slot, or ANY slot
  // while a card is already in hand — is a real target.
  const activatable = interactive && (!!player || moving);
  const containerStyle: CSSProperties = {
    minHeight: bench ? "var(--v2-court-bench-min-height, 76px)" : "var(--v2-court-slot-min-height, 104px)",
    padding: "var(--v2-space-3)",
    borderRadius: "var(--v2-radius-control)",
    border: `1px solid ${STATE_BORDER[state]}`,
    // `current` (the card in hand) and `staged` (a legal place to put it
    // down) share the same accent border — intentional, both are "in play"
    // — but need to read apart from each other, not just from a plain
    // filled/empty slot: `current` gets a faint accent WASH on top of the
    // elevated plane so the one card actually picked up is the thing that
    // visually pops, while `staged` destinations stay on the plain elevated
    // plane. Never touches the `staged`/`filled`/`empty` cases, so this is
    // additive only.
    background:
      state === "current"
        ? "color-mix(in srgb, var(--v2-color-accent) 12%, var(--v2-bg-plane))"
        : state === "staged"
          ? "var(--v2-bg-plane)"
          : state === "empty"
            ? "color-mix(in srgb, var(--v2-bg-page) 55%, transparent)"
            : "transparent",
  };

  const body = (
    <>
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
            metaTestId={bench ? undefined : metaTestId}
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
          <PeakV2SecondaryAction size="sm" onClick={onMove} data-testid={moveTestId}>
            {moveLabel}
          </PeakV2SecondaryAction>
        </div>
      ) : null}
    </>
  );

  if (activatable) {
    return (
      <button
        type="button"
        data-testid="peak-v2-court-slot"
        data-v2-slot-state={state}
        className={`pk-lift pk-press flex w-full flex-col justify-between text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${className ?? ""}`}
        style={containerStyle}
        aria-pressed={state === "current"}
        aria-label={activateLabel}
        draggable={!!player}
        onDragStart={() => onPickUp?.()}
        onDragOver={(event) => {
          if (moving) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          onDropOn?.();
        }}
        onClick={() => (moving ? onDropOn?.() : onPickUp?.())}
      >
        {body}
      </button>
    );
  }

  return (
    <div
      data-testid="peak-v2-court-slot"
      data-v2-slot-state={state}
      className={`flex flex-col justify-between ${className ?? ""}`}
      style={containerStyle}
    >
      {body}
    </div>
  );
}
