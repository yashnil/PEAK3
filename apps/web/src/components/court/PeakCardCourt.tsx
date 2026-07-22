"use client";
import { CourtSlotPublic, SLOT_LABELS } from "@/types/perfect-season";

interface Props {
  slot: CourtSlotPublic;
  isPendingTarget?: boolean;
  onClick?: () => void;
}

/**
 * One court/bench slot. Empty slots show only the slot label -- once a slot
 * is filled (locked), the resolved card's score/rank IS shown, since the
 * pick is no longer reversible (ADR-005 Decision 6 applies to pre-lock
 * candidates only, not to already-placed slots).
 */
export default function PeakCardCourt({ slot, isPendingTarget, onClick }: Props) {
  const isBench = slot.slot_type.startsWith("bench");

  return (
    <button
      data-testid="court-slot"
      data-slot-type={slot.slot_type}
      data-filled={slot.filled ? "true" : "false"}
      onClick={onClick}
      disabled={!onClick}
      className="rounded-xl p-3 flex flex-col items-center justify-center gap-1 min-h-[92px] transition-all"
      style={{
        background: slot.filled ? "var(--bg-elevated)" : "var(--bg-surface)",
        border: isPendingTarget
          ? "2px dashed var(--peak-accent, #f5c842)"
          : `1px solid ${isBench ? "var(--border-muted, #333)" : "var(--border-default)"}`,
        opacity: onClick || slot.filled ? 1 : 0.6,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        {SLOT_LABELS[slot.slot_type]}
      </div>
      {slot.filled ? (
        <>
          <div className="text-sm font-bold text-center" style={{ color: "var(--text-primary)" }}>
            {slot.player_name}
          </div>
          <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {slot.anchor_season} · {Math.round(slot.individual_peak_score ?? 0)} pts · #{slot.individual_peak_rank}
          </div>
        </>
      ) : (
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
          {isPendingTarget ? "Place here" : "Open"}
        </div>
      )}
    </button>
  );
}
