"use client";
import { useState, type CSSProperties } from "react";
import { Lock, Target } from "lucide-react";
import {
  BENCH_SLOT_TYPES,
  CourtSlotPublic,
  FitSeverity,
  RoleFit,
  SLOT_LABELS,
  fitLabel,
} from "@/types/perfect-season";
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
  /** Severity of that pending fit when it's off-position -- required to label
   * it honestly (a "mild" shift costs the simulator 0.0 points). */
  pendingFitSeverity?: FitSeverity | null;
  /** The pending selection's own primary position, so an off-position badge
   * can explain WHY ("plays PG") instead of just flagging it. */
  pendingPrimaryPosition?: string | null;
  /** Phase 9B rearrange mode: render a "Move" affordance on this filled slot. */
  onMove?: () => void;
  /** Phase 9B rearrange mode: this slot is a candidate destination for the
   * card currently being moved -- render it as a labeled target button. */
  onSwapTarget?: () => void;
  /** The slot whose card is currently being moved (for the target's label). */
  movingFromSlotLabel?: string | null;
  /** Launch-polish §5, gap 3. True for a FILLED slot while a fresh selection
   * is waiting to be placed (`phase === "placing"`) -- `action_place_card`
   * (state.py) rejects placing into an occupied slot outright, so this is a
   * genuinely illegal destination, not an oversight. It used to render as a
   * plain, un-styled `<div>`: clicking it did literally nothing, with no
   * signal that it was even a destination candidate at all. Now it renders
   * as a real, visibly disabled control that says why, and points at the
   * actual way to free the slot (rearrange after placing). */
  blockedDuringPlacement?: boolean;
}

function fitTooltip(
  label: string,
  roleFit: RoleFit | null | undefined,
  severity: FitSeverity | null | undefined,
  primaryPosition: string | null | undefined,
  secondaryPositions: string[] | undefined,
): string {
  if (roleFit !== "off_position") {
    // Naming the real positions is what makes "Natural fit" believable
    // instead of a bare assertion.
    const played = [primaryPosition, ...(secondaryPositions ?? [])].filter(Boolean).join(" / ");
    return played ? `${label} -- played ${played}` : label;
  }
  const why = primaryPosition ? `${label} -- plays ${primaryPosition}` : label;
  if (severity === "mild") return `${why}. A routine, near-free positional shift -- PEAK3 charges nothing for it.`;
  if (severity === "moderate") return `${why}. A real stretch, but a playable one.`;
  return `${why}. A genuine structural mismatch for this lineup.`;
}

/** Phase 9B: color follows the placement's REAL simulation cost, not just
 * "is it off-position". The mild tier costs exactly 0.0 fit points (see
 * simulation.py::_OFF_POSITION_SEVERITY_POINTS), so painting it the same
 * warning orange as a -14.0 severe mismatch told users the model had
 * penalized something it scored as free -- the specific trust bug this pass
 * fixes. Orange is now reserved for "Role stretch" (-5.0) and red for
 * "Structural mismatch" (-14.0). */
function fitColor(roleFit: RoleFit | null | undefined, severity?: FitSeverity | null): string {
  if (roleFit === "off_position") {
    if (severity === "mild") return "var(--text-secondary)"; // neutral: costs nothing
    if (severity === "moderate") return "var(--accent-orange)";
    return "var(--incorrect)";
  }
  if (roleFit === "primary") return "var(--peak-accent-text, #f5c842)";
  if (roleFit === "natural" || roleFit === "secondary") return "var(--accent-emerald)";
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
export default function PeakCardCourt({
  slot,
  isPendingTarget,
  onClick,
  pendingFit,
  pendingFitSeverity,
  pendingPrimaryPosition,
  onMove,
  onSwapTarget,
  movingFromSlotLabel,
  blockedDuringPlacement,
}: Props) {
  const [logoFailed, setLogoFailed] = useState(false);
  const isBench = (BENCH_SLOT_TYPES as string[]).includes(slot.slot_type);
  // Team-year (exact-season) slots carry team_name/season instead of the
  // legacy peak-window's anchor_season, and reveal season_score instead of
  // individual_peak_score -- see nba_peak/perfect_season/exact_season.py's
  // PlayerSeasonCard.
  const isExactSeason = slot.exact_player_season_key != null;
  const revealed = isExactSeason ? slot.season_score != null : slot.individual_peak_score != null;
  const fitPill = fitLabel(slot.role_fit, slot.role_fit_severity);
  const fitPillTooltip = fitTooltip(
    fitPill,
    slot.role_fit,
    slot.role_fit_severity,
    slot.primary_position,
    slot.secondary_positions,
  );
  const pendingFitPill = !slot.filled && pendingFit ? fitLabel(pendingFit, pendingFitSeverity) : "";
  const pendingFitTooltip = !slot.filled && pendingFit
    ? fitTooltip(pendingFitPill, pendingFit, pendingFitSeverity, pendingPrimaryPosition, undefined)
    : "";

  const content = (
    <>
      <div className="flex items-center justify-between gap-1 w-full">
        <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          {SLOT_LABELS[slot.slot_type]}
        </span>
        {slot.filled && fitPill && (
          <span
            className="text-[8px] font-semibold uppercase tracking-wide rounded px-1 py-px shrink-0 truncate max-w-[60%]"
            style={{ color: fitColor(slot.role_fit, slot.role_fit_severity), background: "var(--pk-surface-inset, var(--bg-elevated))" }}
            data-testid="role-fit-badge"
            title={fitPillTooltip}
          >
            {fitPill}
          </span>
        )}
      </div>

      {slot.filled ? (
        <div className="flex items-center gap-2.5 w-full min-w-0">
          {/* Phase 8C: portrait "medallion" -- a colored ring in the
              player's real team color (never a logo) instead of a plain
              inline avatar, so the card reads as a collectible object with
              a real identity anchor, not a label with a small icon. */}
          <div
            className="rounded-full shrink-0 flex items-center justify-center"
            style={{
              padding: 2,
              background: `color-mix(in srgb, var(--slot-accent, var(--peak-accent)) 55%, transparent)`,
            }}
          >
            <PlayerAvatar name={slot.player_name ?? "?"} size={42} imageUrl={slot.headshot_url} />
          </div>
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
                {/* Phase 8F: real team logo when the asset flag resolved
                    one, same graceful onError fallback to the color dot
                    as every other logo/headshot spot in this codebase --
                    reinforces the same real team identity as the medallion
                    ring above, now with an actual picture, not just color. */}
                {slot.team_logo_url && !logoFailed ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    data-testid="slot-team-logo"
                    src={slot.team_logo_url}
                    alt=""
                    aria-hidden="true"
                    width={12}
                    height={12}
                    style={{ width: 12, height: 12, objectFit: "contain", display: "inline-block", verticalAlign: "-2px", marginRight: 4 }}
                    onError={() => setLogoFailed(true)}
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="inline-block rounded-full mr-1"
                    style={{ width: 6, height: 6, background: "var(--slot-accent, var(--peak-accent))" }}
                  />
                )}
                {slot.team_name} · {slot.season}
                {revealed && (
                  <span data-testid="revealed-score-line"> · {Math.round(slot.season_score ?? 0)} pts</span>
                )}
                {!revealed && slot.score_status === "exact_season_unscored" && (
                  <span data-testid="score-unavailable-note" className="inline-flex items-center gap-0.5">
                    {" · "}<Lock size={9} aria-hidden="true" /> No official score
                  </span>
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
              <div className="text-[11px] name-2line inline-flex items-center gap-0.5" style={{ color: "var(--text-secondary)" }} data-testid="peak-locked-note">
                {slot.anchor_season} · <Lock size={9} aria-hidden="true" /> Peak locked
              </div>
            )}
            {/* Phase 9B: rearrange affordance. A real <button>, not
                drag-and-drop: keyboard- and screen-reader-operable by
                default, and it can't half-succeed the way a pointer drag
                can. Only rendered on filled slots while rearranging is
                allowed, and only when this card ISN'T the one being moved
                (see onSwapTarget's branch below). */}
            {onMove && (
              // Launch-polish §5, gap 4: was `px-1.5 py-0.5` at a 9px font --
              // well under the ~44px touch-target guidance despite being the
              // ONLY way into rearrange mode. Grown to a ~32px tap target;
              // not the full 44px -- this card is only `min-h-[72px]` and
              // already carries a name, a team/season line and a fit badge,
              // so a literal 44px button would overwhelm it -- but a real,
              // deliberate improvement over the original pill rather than a
              // token nudge.
              <button
                type="button"
                data-testid="slot-move-btn"
                onClick={onMove}
                className="mt-1.5 min-h-[32px] rounded px-3 py-2 text-[10px] font-semibold uppercase tracking-wide"
                style={{ background: "var(--bg-surface)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}
                aria-label={`Move ${slot.player_name ?? "player"} out of ${SLOT_LABELS[slot.slot_type]}`}
              >
                Move
              </button>
            )}
          </div>
        </div>
      ) : (
        <div
          className="relative flex flex-col items-center justify-center gap-1 w-full py-1.5 draft-target"
          data-pending={isPendingTarget ? "true" : "false"}
        >
          {/* Phase 8H: a large, near-invisible position-letter watermark --
              court-density fix. An empty slot used to be just a small icon
              + "Open" text centered in a lot of flat dark space; this gives
              the card a designed silhouette (like a real trading-card slot
              waiting to be filled) instead of reading as dead/blank area,
              without adding any real visual noise (opacity stays under 10%
              even on hover). Bench slots skip it (no single position). */}
          {!isBench && (
            <span aria-hidden="true" className="roster-board-slot-watermark">
              {slot.slot_type}
            </span>
          )}
          <Target
            size={18}
            aria-hidden="true"
            style={{ color: isPendingTarget ? "var(--peak-accent-text, #f5c842)" : "var(--text-muted)", opacity: isPendingTarget ? 1 : 0.55 }}
          />
          <div className="text-[11px] font-semibold" style={{ color: isPendingTarget ? "var(--peak-accent-text, #f5c842)" : "var(--text-muted)" }}>
            {isPendingTarget ? "Place here" : "Open"}
          </div>
          {pendingFitPill && (
            <div
              className="text-[9px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5"
              style={{ color: fitColor(pendingFit, pendingFitSeverity), background: "var(--pk-surface-inset, var(--bg-elevated))" }}
              data-testid="pending-fit-badge"
              title={pendingFitTooltip}
            >
              {pendingFitPill}
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
    // `transition-colors`, not `transition-all` (launch-polish §13): the only
    // things that actually change here are `border`/background, both
    // colour-bearing, whether from this component's own inline `style` swap
    // or from the `roster-board-slot-card-*` class swap below.
    className: `rounded-xl px-2.5 py-2.5 flex flex-col items-start justify-center gap-1 min-h-[72px] w-full transition-colors ${isPendingTarget ? "court-slot-drop-target" : ""} ${slot.filled ? "roster-board-slot-card-filled" : "roster-board-slot-card-open"}`,
    style: {
      // Phase 8C: empty slots get a dashed border -- reads as an active
      // draft target waiting for a card, not an inert disabled box.
      border: isPendingTarget
        ? undefined
        : `1px ${slot.filled ? "solid" : "dashed"} ${isBench ? "var(--border-emphasis)" : "var(--border-default)"}`,
      ...(teamAccent ? ({ "--slot-accent": teamAccent } as CSSProperties) : {}),
    } as CSSProperties,
  };

  // Phase 9B: while a card is being moved, every OTHER slot becomes a real
  // destination button. Takes precedence over onClick/onMove so the card can
  // never render a button inside a button (invalid HTML, and it would swallow
  // the target's own click).
  if (onSwapTarget) {
    return (
      <button
        {...sharedProps}
        type="button"
        data-testid="slot-swap-target"
        onClick={onSwapTarget}
        aria-label={
          movingFromSlotLabel
            ? `Move to ${SLOT_LABELS[slot.slot_type]}${slot.filled ? `, swapping with ${slot.player_name ?? "the player there"}` : ""} (from ${movingFromSlotLabel})`
            : `Move to ${SLOT_LABELS[slot.slot_type]}`
        }
        style={{
          ...sharedProps.style,
          cursor: "pointer",
          border: "1px dashed var(--peak-accent, #f5c842)",
        }}
      >
        {content}
        <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--peak-accent-text, #f5c842)" }}>
          {slot.filled ? "Swap here" : "Move here"}
        </span>
      </button>
    );
  }

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

  // Launch-polish §5, gap 3 (the sharpest gap in the audit): a filled slot
  // during the "placing" step used to fall all the way through to the plain
  // `<div>` below -- not a `<button>`, not `disabled`, no styling
  // distinguishing it from an idle roster card, and no accessible name
  // saying why a click did nothing. It genuinely IS illegal (`action_place_card`
  // in state.py rejects placing into an occupied slot), so the fix is not to
  // make it clickable as a PLACEMENT target -- it is to say so.
  if (blockedDuringPlacement) {
    const reason = `${SLOT_LABELS[slot.slot_type]} is already filled by ${
      slot.player_name ?? "a player"
    }. Place your new pick in an open slot instead.`;
    const fullNote = (
      <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        Full — place in an open slot
      </span>
    );
    // `action_swap_slots` allows rearranging even mid-placement (state.py's
    // own docstring: "including with a selection pending"), so `onMove` can
    // legitimately be live on this same card at the same time. A `<button
    // disabled>` wrapping a real, clickable "Move" button would be invalid,
    // inert HTML -- so when both apply, this stays a plain container (the
    // reason is still stated in visible text, just not as this card's own
    // accessible name) and the inner Move button keeps working normally.
    if (onMove) {
      return (
        <div {...sharedProps} style={{ ...sharedProps.style, opacity: 0.85 }}>
          {content}
          {fullNote}
        </div>
      );
    }
    return (
      <button
        {...sharedProps}
        type="button"
        disabled
        data-testid="court-slot-blocked"
        aria-label={reason}
        style={{
          ...sharedProps.style,
          cursor: "not-allowed",
          opacity: 0.55,
        }}
      >
        {content}
        {fullNote}
      </button>
    );
  }

  return <div {...sharedProps}>{content}</div>;
}
