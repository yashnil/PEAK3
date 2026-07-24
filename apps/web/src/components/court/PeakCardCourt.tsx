"use client";
import type { CSSProperties } from "react";
import { BENCH_SLOT_TYPES, CourtSlotPublic, ROLE_FIT_LABELS, RoleFit, SLOT_LABELS } from "@/types/perfect-season";
import PlayerAvatar from "./PlayerAvatar";

interface Props {
  slot: CourtSlotPublic;
  isPendingTarget?: boolean;
  onClick?: () => void;
  /** During placement, whether the currently-pending selection fits this
   * open slot (nba_peak.perfect_season.positions.classify_fit) -- shown as
   * a small badge, never blocking. */
  pendingFit?: RoleFit;
  /** The pending selection's own primary position, so an off-position badge
   * can explain WHY ("plays PG") instead of just flagging it. */
  pendingPrimaryPosition?: string | null;
}

/** "Off-position" alone doesn't say why -- append the player's own primary
 * position when known, e.g. "Off-position (plays PG)". Position eligibility
 * clarity goal: never leave a fit note unexplained. */
function explainedFitLabel(label: string, roleFit: RoleFit | null | undefined, primaryPosition: string | null | undefined): string {
  if (roleFit === "off_position" && primaryPosition) {
    return `${label} (plays ${primaryPosition})`;
  }
  return label;
}

function fitColor(roleFit: RoleFit | null | undefined): string {
  if (roleFit === "off_position") return "#fb923c";
  if (roleFit === "primary") return "var(--peak-accent, #f5c842)";
  return "var(--text-secondary)";
}

/**
 * One court/bench slot card (Phase 6B compact-grid rebuild). Same data
 * contract and reveal discipline as before (server withholds
 * `individual_peak_score`/`individual_peak_rank` until `result_ready`,
 * ARENA_OVERHAUL_PRODUCT_SPEC.md Sec 3.5) -- this pass only changes layout
 * density (a single-line label/name/detail stack plus a small avatar,
 * instead of four stacked lines fighting for a ~70px-wide absolutely-
 * positioned box) so text stops colliding at small viewport widths.
 *
 * Renders as a real <button> only when actionable (onClick provided --
 * i.e. an open slot during the placement step); filled/idle slots render
 * as a plain <div> so already-placed players stay in normal reading/tab
 * order (see prior version's note on why disabled <button> is avoided).
 */
export default function PeakCardCourt({ slot, isPendingTarget, onClick, pendingFit, pendingPrimaryPosition }: Props) {
  const isBench = (BENCH_SLOT_TYPES as string[]).includes(slot.slot_type);
  // Team-year (exact-season) slots carry team_name/season instead of the
  // legacy peak-window's anchor_season, and reveal season_score instead of
  // individual_peak_score -- see nba_peak/perfect_season/exact_season.py's
  // PlayerSeasonCard.
  const isExactSeason = slot.exact_player_season_key != null;
  const revealed = isExactSeason ? slot.season_score != null : slot.individual_peak_score != null;
  const fitLabel = slot.role_fit
    ? explainedFitLabel(ROLE_FIT_LABELS[slot.role_fit], slot.role_fit, slot.primary_position)
    : "";
  const pendingFitLabel = !slot.filled && pendingFit
    ? explainedFitLabel(ROLE_FIT_LABELS[pendingFit], pendingFit, pendingPrimaryPosition)
    : "";

  const content = (
    <>
      <div className="flex items-center justify-between gap-1 w-full">
        <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          {SLOT_LABELS[slot.slot_type]}
        </span>
        {slot.filled && fitLabel && (
          <span
            className="text-[8px] font-semibold uppercase tracking-wide rounded px-1 py-px shrink-0 truncate max-w-[60%]"
            style={{ color: fitColor(slot.role_fit), background: "rgba(255,255,255,0.06)" }}
            data-testid="role-fit-badge"
            title={fitLabel}
          >
            {fitLabel}
          </span>
        )}
      </div>

      {slot.filled ? (
        <div className="flex items-center gap-2 w-full min-w-0">
          <PlayerAvatar name={slot.player_name ?? "?"} size={30} />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold truncate" style={{ color: "var(--text-primary)" }}>
              {slot.player_name}
            </div>
            {isExactSeason ? (
              <div className="text-[10px] truncate" style={{ color: "var(--text-secondary)" }} data-testid="exact-season-line">
                {slot.team_name} · {slot.season}
                {revealed && (
                  <span data-testid="revealed-score-line"> · {Math.round(slot.season_score ?? 0)} pts</span>
                )}
                {!revealed && slot.score_status === "exact_season_unscored" && (
                  <span data-testid="score-unavailable-note"> · No official score</span>
                )}
              </div>
            ) : revealed ? (
              <div className="text-[10px] truncate" style={{ color: "var(--text-secondary)" }} data-testid="revealed-score-line">
                {slot.anchor_season} · {Math.round(slot.individual_peak_score ?? 0)} pts · #{slot.individual_peak_rank}
              </div>
            ) : (
              <div className="text-[10px] truncate" style={{ color: "var(--text-secondary)" }} data-testid="peak-locked-note">
                {slot.anchor_season} · Peak locked
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-0.5 w-full py-1">
          <div className="text-[11px] font-semibold" style={{ color: isPendingTarget ? "var(--peak-accent, #f5c842)" : "var(--text-muted)" }}>
            {isPendingTarget ? "Place here" : "Open"}
          </div>
          {pendingFitLabel && (
            <div
              className="text-[9px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5"
              style={{ color: fitColor(pendingFit), background: "rgba(255,255,255,0.06)" }}
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
    className: "rounded-xl px-2 py-2 flex flex-col items-start justify-center gap-1 min-h-[64px] w-full transition-all",
    style: {
      background: slot.filled ? "var(--bg-elevated)" : "var(--bg-surface)",
      border: isPendingTarget
        ? "2px dashed var(--peak-accent, #f5c842)"
        : `1px solid ${isBench ? "var(--border-emphasis)" : "var(--border-default)"}`,
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
