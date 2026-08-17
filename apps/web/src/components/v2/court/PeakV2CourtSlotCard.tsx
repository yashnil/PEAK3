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
          emptyHint={movingFromSlotLabel ? `Move ${movingFromSlotLabel} here` : "Open"}
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
  const body = (
    <PeakV2CourtSlot
      position={slot.slot_type}
      player={slot.filled ? { name: slot.player_name ?? "", meta } : undefined}
      value={value}
      valueLabel={slot.filled ? "PEAK3" : undefined}
      state={isPendingTarget ? "staged" : slot.filled ? "filled" : "empty"}
      emptyHint={isPendingTarget ? "Place here" : blockedDuringPlacement ? "Occupied" : "Open"}
      onMove={onMove}
      moveLabel="Move"
      className={blockedDuringPlacement ? "opacity-50" : undefined}
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
        <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.625rem", color: "var(--v2-text-muted)" }}>{fit}</span>
      ) : null}
      {isPendingTarget && pendingFit === "off_position" && pendingPrimaryPosition ? (
        <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.625rem", color: "var(--v2-color-accent)" }}>
          {fitLabel(pendingFit, pendingFitSeverity)} · plays {pendingPrimaryPosition}
        </span>
      ) : null}
    </div>
  );
}
