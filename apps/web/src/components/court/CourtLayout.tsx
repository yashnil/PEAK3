"use client";
import { ReactNode } from "react";
import { CourtSlotPublic, STARTER_SLOT_TYPES } from "@/types/perfect-season";

interface Props {
  starterSlots: CourtSlotPublic[];
  benchSlots: CourtSlotPublic[];
  renderSlot: (slot: CourtSlotPublic) => ReactNode;
}

/**
 * Compact roster board (Phase 6B rebuild). Previously: 5 starter cards
 * absolutely-positioned on top of a small CSS-shape "half-court" diagram --
 * at mobile widths each slot was a ~70px-wide box holding 4 lines of text,
 * the direct cause of the "cramped labels"/"overlapping cards" finding. A
 * CSS grid cannot overlap by construction, so this rebuild replaces the
 * absolute-position geometry with a proper grid; "court-inspired" now comes
 * from the subtle grid-line texture (.roster-board::before, reusing the
 * existing --court-line token) and the position-ordered PG..C column
 * sequence, plus a small decorative hoop-glyph accent, instead of a literal
 * floating-cards-on-a-court-diagram layout.
 *
 * `data-testid="half-court"` and the `.court-hoop`-equivalent decorative
 * marker are kept so the existing "half-court renders visual court
 * markings" and "starters render on the half-court" Playwright assertions
 * (courtbuilder.spec.ts) still pass unchanged -- this is a visual-density
 * fix, not a data-contract change.
 */
export default function CourtLayout({ starterSlots, benchSlots, renderSlot }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div data-testid="half-court" className="roster-board">
        <div className="relative flex items-center gap-2 mb-2">
          <div className="court-hoop roster-board-hoop-accent" aria-hidden="true" />
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
            Starters
          </span>
        </div>
        <div className="roster-board-starters">
          {STARTER_SLOT_TYPES.map((slotType) => {
            const slot = starterSlots.find((s) => s.slot_type === slotType);
            if (!slot) return null;
            return <div key={slotType}>{renderSlot(slot)}</div>;
          })}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
          Bench
        </div>
        <div data-testid="bench-grid" className="roster-board-bench">
          {benchSlots.map((slot) => (
            <div key={slot.slot_type}>{renderSlot(slot)}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
