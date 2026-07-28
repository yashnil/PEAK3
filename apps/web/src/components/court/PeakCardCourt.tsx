"use client";
import type { CSSProperties } from "react";
import { BENCH_SLOT_TYPES, CourtSlotPublic, ROLE_FIT_LABELS, RoleFit, SLOT_LABELS } from "@/types/perfect-season";
import PlayerAvatar from "./PlayerAvatar";
import { getTeamColors } from "@/lib/team-colors";

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

/** Phase 6G Part F: the visible pill stays short ("Off-slot") -- the WHY
 * ("plays PG") moves entirely into the title tooltip (fitTooltip below)
 * instead of being appended inline, which was overflowing/truncating in
 * the compact court grid ("OFF-POSITION (PLAYS PG)" at 8px). Position
 * eligibility clarity is preserved via the tooltip, not the badge text. */
function fitPillLabel(label: string): string {
  return label;
}

function fitTooltip(label: string, roleFit: RoleFit | null | undefined, primaryPosition: string | null | undefined): string {
  if (roleFit === "off_position" && primaryPosition) {
    return `${label} -- plays ${primaryPosition}`;
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
  const fitLabel = slot.role_fit ? fitPillLabel(ROLE_FIT_LABELS[slot.role_fit]) : "";
  const fitLabelTooltip = slot.role_fit
    ? fitTooltip(ROLE_FIT_LABELS[slot.role_fit], slot.role_fit, slot.primary_position)
    : "";
  const pendingFitLabel = !slot.filled && pendingFit ? fitPillLabel(ROLE_FIT_LABELS[pendingFit]) : "";
  const pendingFitTooltip = !slot.filled && pendingFit
    ? fitTooltip(ROLE_FIT_LABELS[pendingFit], pendingFit, pendingPrimaryPosition)
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
            title={fitLabelTooltip}
          >
            {fitLabel}
          </span>
        )}
      </div>

      {slot.filled ? (
        <div className="flex items-center gap-2.5 w-full min-w-0">
          <PlayerAvatar name={slot.player_name ?? "?"} size={38} imageUrl={slot.headshot_url} />
          <div className="min-w-0 flex-1">
            <div
              className="text-sm font-bold name-2line"
              style={{
                color: "var(--text-primary)",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                lineHeight: 1.2,
                wordBreak: "break-word",
              } as CSSProperties}
            >
              {slot.player_name}
            </div>
            {isExactSeason ? (
              <div
                className="text-[11px] name-2line"
                style={{ color: "var(--text-secondary)" }}
                data-testid="exact-season-line"
              >
                {slot.team_name} · {slot.season}
                {revealed && (
                  <span data-testid="revealed-score-line"> · {Math.round(slot.season_score ?? 0)} pts</span>
                )}
                {!revealed && slot.score_status === "exact_season_unscored" && (
                  <span data-testid="score-unavailable-note"> · No official score</span>
                )}
                {slot.score_source === "exact_season_aggregate" && (
                  <span
                    data-testid="season-aggregate-note"
                    title="Traded mid-season -- score is the whole-season total, not specific to this exact team stint."
                  >
                    {" "}· Season Aggregate
                  </span>
                )}
              </div>
            ) : revealed ? (
              <div className="text-[11px] name-2line" style={{ color: "var(--text-secondary)" }} data-testid="revealed-score-line">
                {slot.anchor_season} · {Math.round(slot.individual_peak_score ?? 0)} pts · #{slot.individual_peak_rank}
              </div>
            ) : (
              <div className="text-[11px] name-2line" style={{ color: "var(--text-secondary)" }} data-testid="peak-locked-note">
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
              title={pendingFitTooltip}
            >
              {pendingFitLabel}
            </div>
          )}
        </div>
      )}
    </>
  );

  // Phase 8B: real team-color accent rail on filled slots (colors +
  // initials only, never a logo -- see team-colors.ts's own licensing
  // rationale). Bare team_id (legacy peak-window slots) has no team_name,
  // so this quietly no-ops to the plain accent gold via getTeamColors'
  // own null fallback.
  const teamAccent = slot.filled ? getTeamColors(slot.team_name).primary : null;

  const sharedProps = {
    "data-testid": "court-slot",
    "data-slot-type": slot.slot_type,
    "data-filled": slot.filled ? "true" : "false",
    className: `rounded-xl px-2.5 py-2.5 flex flex-col items-start justify-center gap-1 min-h-[72px] w-full transition-all ${isPendingTarget ? "court-slot-drop-target" : ""} ${slot.filled ? "roster-board-slot-card-filled" : ""}`,
    style: {
      background: slot.filled ? "var(--bg-elevated)" : "var(--bg-surface)",
      border: isPendingTarget
        ? undefined
        : `1px solid ${isBench ? "var(--border-emphasis)" : "var(--border-default)"}`,
      ...(teamAccent ? ({ "--slot-accent": teamAccent } as CSSProperties) : {}),
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
