"use client";
import type { CSSProperties } from "react";
import { BENCH_SLOT_TYPES, CourtSlotPublic, ROLE_FIT_LABELS, RoleFit, SLOT_LABELS } from "@/types/perfect-season";

interface Props {
  slot: CourtSlotPublic;
  isPendingTarget?: boolean;
  onClick?: () => void;
  /** During placement, whether the currently-pending selection fits this
   * open slot (nba_peak.perfect_season.positions.classify_fit) -- shown as
   * a small badge, never blocking. */
  pendingFit?: RoleFit;
}

/**
 * One court/bench slot. Empty slots show only the slot label -- once a slot
 * is filled, the server withholds `individual_peak_score`/`individual_peak_rank`
 * until the whole roster is locked and simulated (status "result_ready");
 * before that, this card shows only qualitative info ("peak locked" +
 * `anchor_season`, plus a role-fit note) per
 * docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md Sec 3.5. Once the score IS
 * present (post-reveal), the full line renders -- no separate prop needed,
 * this component just renders whatever the slot payload actually contains.
 *
 * Renders as a real <button> only when actionable (onClick provided --
 * i.e. an open slot during the placement step). Filled slots and idle
 * empty slots render as a plain <div> instead of a disabled <button>:
 * a native `disabled` button drops out of the Tab order and some screen
 * readers skip announcing disabled elements in browse mode, which would
 * make an already-drafted player invisible to keyboard/AT users outside
 * the brief window they placed it in. A static div with the same text
 * content stays reachable through normal document reading order.
 *
 * No opacity dimming on idle slots: the previous `opacity: 0.6` (carried
 * over from when this was a disabled <button>) combined with
 * --text-muted's already-modest contrast to fail WCAG AA color-contrast --
 * axe never caught it before because axe exempts disabled controls from
 * the contrast check. Idle vs. filled is now conveyed by background
 * (--bg-surface vs. --bg-elevated) and content ("Open" vs. a player name)
 * alone, both at full opacity.
 */
export default function PeakCardCourt({ slot, isPendingTarget, onClick, pendingFit }: Props) {
  const isBench = (BENCH_SLOT_TYPES as string[]).includes(slot.slot_type);
  const revealed = slot.individual_peak_score != null;
  const fitLabel = slot.role_fit ? ROLE_FIT_LABELS[slot.role_fit] : "";
  const pendingFitLabel = !slot.filled && pendingFit ? ROLE_FIT_LABELS[pendingFit] : "";

  const content = (
    <>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        {SLOT_LABELS[slot.slot_type]}
      </div>
      {slot.filled ? (
        <>
          <div className="text-sm font-bold text-center" style={{ color: "var(--text-primary)" }}>
            {slot.player_name}
          </div>
          {revealed ? (
            <div className="text-xs" style={{ color: "var(--text-secondary)" }} data-testid="revealed-score-line">
              {slot.anchor_season} · {Math.round(slot.individual_peak_score ?? 0)} pts · #{slot.individual_peak_rank}
            </div>
          ) : (
            <div className="text-xs" style={{ color: "var(--text-secondary)" }} data-testid="peak-locked-note">
              {slot.anchor_season} · Peak locked
            </div>
          )}
          {fitLabel && (
            <div
              className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5"
              style={{
                color: slot.role_fit === "off_position" ? "#fb923c" : "var(--peak-accent, #f5c842)",
                background: "rgba(255,255,255,0.06)",
              }}
              data-testid="role-fit-badge"
            >
              {fitLabel}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center gap-0.5">
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            {isPendingTarget ? "Place here" : "Open"}
          </div>
          {pendingFitLabel && (
            <div
              className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5"
              style={{
                color: pendingFit === "off_position" ? "#fb923c" : "var(--peak-accent, #f5c842)",
                background: "rgba(255,255,255,0.06)",
              }}
              data-testid="pending-fit-badge"
            >
              {pendingFitLabel}
            </div>
          )}
        </div>
      )}
    </>
  );

  const sharedProps = {
    "data-testid": "court-slot",
    "data-slot-type": slot.slot_type,
    "data-filled": slot.filled ? "true" : "false",
    className: "rounded-xl p-3 flex flex-col items-center justify-center gap-1 min-h-[92px] transition-all",
    style: {
      background: slot.filled ? "var(--bg-elevated)" : "var(--bg-surface)",
      border: isPendingTarget
        ? "2px dashed var(--peak-accent, #f5c842)"
        : `1px solid ${isBench ? "var(--border-muted, #333)" : "var(--border-default)"}`,
    } as CSSProperties,
  };

  if (onClick) {
    return (
      <button
        {...sharedProps}
        onClick={onClick}
        style={{ ...sharedProps.style, cursor: "pointer" }}
      >
        {content}
      </button>
    );
  }

  return <div {...sharedProps}>{content}</div>;
}
