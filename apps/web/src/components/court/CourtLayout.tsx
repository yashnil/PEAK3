"use client";
import { ReactNode } from "react";
import { CourtSlotPublic, STARTER_SLOT_TYPES } from "@/types/perfect-season";

interface Props {
  starterSlots: CourtSlotPublic[];
  benchSlots: CourtSlotPublic[];
  renderSlot: (slot: CourtSlotPublic) => ReactNode;
}

// Court-relative position for each starter slot, as a percentage of the
// court-half container (CSS class .court-half in globals.css). Purely
// visual placement -- PG up top near the key, wings out to the flanks,
// PF/C down low near the basket. DOM order stays PG/SG/SF/PF/C (matches
// STARTER_SLOT_TYPES), so keyboard/screen-reader order is unaffected by
// this visual repositioning.
const STARTER_POSITION: Record<string, { top: string; left: string }> = {
  PG: { top: "12%", left: "50%" },
  SG: { top: "42%", left: "84%" },
  SF: { top: "42%", left: "16%" },
  PF: { top: "76%", left: "28%" },
  C: { top: "88%", left: "50%" },
};

/**
 * Visual basketball half-court: 5 starter slots placed at real
 * court-relative positions (SVG-free, plain CSS shapes -- master plan
 * Sec 13.2's "no canvas/WebGL" instruction), with the 3 bench slots in a
 * distinct rail below, never mixed into the court graphic itself.
 */
export default function CourtLayout({ starterSlots, benchSlots, renderSlot }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div data-testid="half-court" className="court-half">
        <div className="court-hoop" aria-hidden="true" />
        {STARTER_SLOT_TYPES.map((slotType) => {
          const slot = starterSlots.find((s) => s.slot_type === slotType);
          if (!slot) return null;
          const pos = STARTER_POSITION[slotType];
          return (
            <div key={slotType} className="court-half-slot" style={{ top: pos.top, left: pos.left }}>
              {renderSlot(slot)}
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          Bench
        </div>
        <div data-testid="bench-grid" className="grid grid-cols-3 gap-2">
          {benchSlots.map((slot) => (
            <div key={slot.slot_type}>{renderSlot(slot)}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
