"use client";

/**
 * PeakV2CourtSlotCard — the V2 slot renderer for 82-0's real court (Pass 3).
 *
 * Same exact prop contract as legacy `PeakCardCourt` — this is a drop-in
 * `renderSlot` for the REUSED `CourtLayout` component (its real thin-line
 * court markings — paint, arc, rim — are the court identity the brief asks
 * for; this pass restyles the cards on top of that real geometry, not the
 * geometry itself). Built on `PeakV2CourtSlot`'s existing state grammar
 * (empty/filled/staged/current) rather than a second card shape.
 */

import PeakV2CourtSlot from "../PeakV2CourtSlot";
import { fitLabel, type CourtSlotPublic, type RoleFit, type FitSeverity } from "@/types/perfect-season";

/**
 * Mirrors `PeakCardCourt.tsx`'s own `fitColor` exactly (same trust-bug fix:
 * "mild" off-position costs 0.0 fit points -- painting it the same warning
 * color as a real -14.0 structural mismatch told users the model had
 * penalized something it scored as free). V2's court slots were rendering
 * every fit caption in flat muted gray regardless of severity, silently
 * dropping this real, meaningful state -- CLAUDE.md's "positive/negative =
 * true state only" cuts both ways: omitting real state is as much a
 * violation as inventing decorative color.
 */
function fitColor(roleFit: RoleFit | null | undefined, severity?: FitSeverity | null): string {
  if (roleFit === "off_position") {
    if (severity === "mild") return "var(--v2-text-secondary)"; // neutral: costs nothing
    if (severity === "moderate") return "var(--accent-orange)";
    return "var(--v2-color-negative)";
  }
  if (roleFit === "primary") return "var(--v2-color-accent)";
  if (roleFit === "natural" || roleFit === "secondary") return "var(--v2-color-positive)";
  return "var(--v2-text-muted)";
}

/**
 * Human acceptance testing, task §8/Issue 2: placement is "soft" — every
 * OPEN slot is a genuinely legal destination regardless of position
 * (`action_place_card` in `state.py`: "any open slot_type is legal
 * regardless of the player's real position"). The only REAL illegal
 * destination during placement is an already-filled slot, which
 * `blockedDuringPlacement` already renders distinctly (below).
 *
 * What was still generic: every OPEN slot rendered with the exact same
 * loud gold-outlined "Place here" box, whether the pending pick was a
 * natural fit for that slot or a genuine structural mismatch — a real
 * -14.0 point cost visually indistinguishable from a free one, told apart
 * only by a small caption underneath. This tiers the BOX ITSELF (border/
 * background/opacity, via `court-slot-pending-*` classes in `court.css`)
 * to the same three-tier cost model `fitColor` already uses, so a strong
 * fit reads as an inviting, elegant target and a structural mismatch reads
 * as available-but-discouraged at a glance — never disabled, since it is
 * never actually illegal.
 */
export type PendingFitTier = "strong" | "stretch" | "weak" | "neutral";

export function pendingFitTier(roleFit: RoleFit | null | undefined, severity?: FitSeverity | null): PendingFitTier {
  if (!roleFit) return "neutral"; // fit not yet known for this slot -- never render as discouraged
  if (roleFit === "off_position") {
    if (severity === "severe") return "weak";
    if (severity === "moderate") return "stretch";
    return "strong"; // mild costs nothing -- a real, fully-fine fit
  }
  return "strong"; // primary / natural / secondary / flexible / bench
}

export interface PeakV2CourtSlotCardProps {
  slot: CourtSlotPublic;
  isPendingTarget?: boolean;
  onClick?: () => void;
  pendingFit?: RoleFit;
  pendingFitSeverity?: FitSeverity | null;
  pendingPrimaryPosition?: string | null;
  onMove?: () => void;
  onSwapTarget?: () => void;
  onCancelMove?: () => void;
  movingFromSlotLabel?: string | null;
  blockedDuringPlacement?: boolean;
}

export default function PeakV2CourtSlotCard({
  slot,
  isPendingTarget,
  onClick,
  pendingFit,
  pendingFitSeverity,
  pendingPrimaryPosition,
  onMove,
  onSwapTarget,
  onCancelMove,
  movingFromSlotLabel,
  blockedDuringPlacement,
}: PeakV2CourtSlotCardProps) {
  const value =
    slot.filled && slot.individual_peak_score != null
      ? slot.individual_peak_score.toFixed(1)
      : slot.filled && slot.season_score != null
        ? slot.season_score.toFixed(1)
        : undefined;

  const meta = slot.filled
    ? [slot.season ?? slot.anchor_season, slot.team_id].filter(Boolean).join(" · ")
    : undefined;

  const fit = slot.filled ? fitLabel(slot.role_fit, slot.role_fit_severity) : undefined;

  if (onSwapTarget) {
    return (
      <button
        type="button"
        onClick={onSwapTarget}
        className="w-full text-left"
        style={{ outline: "2px dashed var(--v2-color-accent)", outlineOffset: 2, borderRadius: "var(--v2-radius-control)" }}
      >
        <PeakV2CourtSlot
          position={slot.slot_type}
          player={slot.filled ? { name: slot.player_name ?? "", meta } : undefined}
          value={value}
          // Plain "Move here", matching legacy `PeakCardCourt`'s own
          // convention exactly (its visible text is the same generic
          // "Move here"/"Swap here" for every target; the specific
          // "from POSITION" detail lives only in its aria-label). Naming
          // the SOURCE slot's POSITION here instead ("Move Point Guard
          // here") read as an instruction about an abstract position, not
          // about the actual player being moved, and repeated identically
          // across every open destination slot regardless of that slot's
          // own position -- confusing rather than helpful.
          emptyHint={movingFromSlotLabel ? "Move here" : "Open"}
          state="staged"
        />
      </button>
    );
  }

  if (onCancelMove) {
    return (
      <button type="button" onClick={onCancelMove} className="w-full text-left">
        <PeakV2CourtSlot
          position={slot.slot_type}
          player={slot.filled ? { name: slot.player_name ?? "", meta: "Moving — click to cancel" } : undefined}
          value={value}
          state="current"
        />
      </button>
    );
  }

  const clickable = !!onClick;
  const tier = isPendingTarget ? pendingFitTier(pendingFit, pendingFitSeverity) : "neutral";
  const pendingHint = tier === "weak" ? "Off-position" : tier === "stretch" ? "Playable stretch" : "Place here";
  const body = (
    <PeakV2CourtSlot
      position={slot.slot_type}
      player={slot.filled ? { name: slot.player_name ?? "", meta } : undefined}
      value={value}
      valueLabel={slot.filled ? "PEAK3" : undefined}
      state={isPendingTarget ? "staged" : slot.filled ? "filled" : "empty"}
      emptyHint={isPendingTarget ? pendingHint : blockedDuringPlacement ? "Occupied" : "Open"}
      onMove={onMove}
      moveLabel="Move"
      className={
        [blockedDuringPlacement ? "opacity-50" : "", isPendingTarget ? `court-slot-pending-${tier}` : ""]
          .filter(Boolean)
          .join(" ") || undefined
      }
    />
  );

  return (
    <div className="flex flex-col gap-1">
      {clickable ? (
        <button type="button" onClick={onClick} className="w-full text-left" disabled={blockedDuringPlacement}>
          {body}
        </button>
      ) : (
        body
      )}
      {fit ? (
        <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.625rem", color: fitColor(slot.role_fit, slot.role_fit_severity) }}>
          {fit}
        </span>
      ) : null}
      {isPendingTarget && pendingFit === "off_position" && pendingPrimaryPosition ? (
        <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.625rem", color: fitColor(pendingFit, pendingFitSeverity) }}>
          {fitLabel(pendingFit, pendingFitSeverity)} · plays {pendingPrimaryPosition}
        </span>
      ) : null}
    </div>
  );
}
