"use client";
import { ReactNode } from "react";
import { CourtSlotPublic, STARTER_SLOT_TYPES } from "@/types/perfect-season";

interface Props {
  starterSlots: CourtSlotPublic[];
  benchSlots: CourtSlotPublic[];
  renderSlot: (slot: CourtSlotPublic) => ReactNode;
}

/**
 * Spatial half-court roster board (Phase 6C rebuild). Phase 6B replaced an
 * earlier absolute-positioned diagram with a plain PG..C grid row to fix
 * cramped/overlapping labels at mobile widths -- but a flat row of 5 equal
 * cards reads as a form, not a basketball court (Phase 6C manual review
 * finding). This version keeps the Phase 6B fix (a named-area CSS grid
 * cannot overlap by construction, same guarantee as the plain row) while
 * actually placing each position where it's played: PG top (point, furthest
 * from the hoop), SG right wing, SF left wing, PF low block, C paint --
 * see .roster-board-slot-* / .roster-board-starters in globals.css. Real
 * key/free-throw-circle/three-point-arc markings sit behind the grid
 * (.roster-board-court-markings), visible only in the gaps between the
 * opaque player cards -- decorative, pointer-events:none, never intercepts
 * a click, same discipline as the pre-existing .court-hoop accent below.
 *
 * `data-testid="half-court"` (scoped to the starters panel, unchanged) and
 * the `.court-hoop` decorative marker are kept so the pre-existing
 * "half-court renders visual court markings" and "starters render on the
 * half-court" Playwright assertions (courtbuilder.spec.ts) still pass
 * unchanged. Phase 6E adds `court-panel` (the whole starters+bench unit,
 * visually one attached board -- see .court-panel-wrapper/.roster-board-
 * bench-row in globals.css), `court-paint`/`court-arc`/`court-hoop` as
 * dedicated landmark testids on the real court markings (not just the
 * small header accent glyph), and moves the bench row directly beneath the
 * baseline instead of a separate floating block with a visible gap.
 */
export default function CourtLayout({ starterSlots, benchSlots, renderSlot }: Props) {
  return (
    <div data-testid="court-panel" className="court-panel-wrapper">
      <div data-testid="half-court" className="roster-board">
        <div className="relative flex items-center gap-2 mb-2">
          <div className="court-hoop roster-board-hoop-accent" data-testid="court-hoop" aria-hidden="true" />
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
            Starters
          </span>
        </div>
        <div className="roster-board-sideline" aria-hidden="true" />
        <div className="roster-board-court-markings" aria-hidden="true">
          <div className="roster-board-ft-circle" />
          <div className="roster-board-paint" data-testid="court-paint" />
          <div className="roster-board-arc" data-testid="court-arc" />
          <div className="roster-board-rim" />
        </div>
        <div className="roster-board-starters">
          {STARTER_SLOT_TYPES.map((slotType) => {
            const slot = starterSlots.find((s) => s.slot_type === slotType);
            if (!slot) return null;
            return (
              <div key={slotType} className={`roster-board-slot-${slotType}`}>
                {renderSlot(slot)}
              </div>
            );
          })}
        </div>
      </div>
      <div className="roster-board-bench-row">
        <div className="roster-board-bench-label">Bench</div>
        <div data-testid="bench-grid" className="roster-board-bench">
          {benchSlots.map((slot) => (
            <div key={slot.slot_type}>{renderSlot(slot)}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
