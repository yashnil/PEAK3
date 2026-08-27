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
 *
 * V2-cutover parity fix: this component now also carries the same
 * `data-testid="court-slot"` / `data-slot-type` / `data-filled` / `data-blocked`
 * contract `PeakCardCourt.tsx` always exposed (courtbuilder.spec.ts's
 * `playOneRound`/`openSlot`/geometry helpers all key off it), plus the
 * reveal-discipline testids (`peak-locked-note` / `exact-season-line` /
 * `revealed-score-line` / `role-fit-badge` / `pending-fit-badge`) — real,
 * pre-existing functionality (the fit computation, the reveal gating) that
 * was already correct here; it just had no stable hook to find it by.
 */

import type { ReactNode } from "react";
import PeakV2CourtSlot from "../PeakV2CourtSlot";
import { fitLabel, SLOT_LABELS, type CourtSlotPublic, type RoleFit, type FitSeverity } from "@/types/perfect-season";

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

/** Mirrors `PeakCardCourt.tsx`'s own `fitTooltip` exactly -- an honest title
 * explaining WHY a fit is what it is, not just a bare label. */
function fitTooltip(
  label: string,
  roleFit: RoleFit | null | undefined,
  severity: FitSeverity | null | undefined,
  primaryPosition: string | null | undefined,
  secondaryPositions: string[] | undefined,
): string {
  if (roleFit !== "off_position") {
    const played = [primaryPosition, ...(secondaryPositions ?? [])].filter(Boolean).join(" / ");
    return played ? `${label} -- played ${played}` : label;
  }
  const why = primaryPosition ? `${label} -- plays ${primaryPosition}` : label;
  if (severity === "mild") return `${why}. A routine, near-free positional shift -- PEAK3 charges nothing for it.`;
  if (severity === "moderate") return `${why}. A real stretch, but a playable one.`;
  return `${why}. A genuine structural mismatch for this lineup.`;
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

  // Reveal discipline (ARENA_OVERHAUL_PRODUCT_SPEC.md Sec 3.5, mirrored
  // exactly from PeakCardCourt.tsx): the server withholds the real score
  // until `result_ready`, so every filled slot shows a qualitative
  // "locked"/"exact season" note instead, never a number, until then.
  const isExactSeason = slot.exact_player_season_key != null;
  const revealed = isExactSeason ? slot.season_score != null : slot.individual_peak_score != null;

  const scoreLine: ReactNode = slot.filled
    ? isExactSeason
      ? (
        <span data-testid="exact-season-line">
          {slot.team_name} · {slot.season}
          {revealed ? (
            <span data-testid="revealed-score-line"> · {Math.round(slot.season_score ?? 0)} pts</span>
          ) : null}
          {!revealed && slot.score_status === "exact_season_unscored" ? (
            <span data-testid="score-unavailable-note"> · No official score</span>
          ) : null}
          {slot.score_source === "exact_season_aggregate" ? (
            <span
              data-testid="season-aggregate-note"
              title="Traded mid-season -- score is the whole-season total, not specific to this exact team stint."
            >
              {" "}· Season Aggregate
            </span>
          ) : null}
        </span>
      )
      : revealed
        ? (
          <span data-testid="revealed-score-line">
            {slot.anchor_season} · {Math.round(slot.individual_peak_score ?? 0)} pts · #{slot.individual_peak_rank}
          </span>
        )
        : (
          <span data-testid="peak-locked-note">{slot.anchor_season} · Peak locked</span>
        )
    : undefined;

  const fit = slot.filled ? fitLabel(slot.role_fit, slot.role_fit_severity) : undefined;
  const fitTitle = slot.filled
    ? fitTooltip(fit ?? "", slot.role_fit, slot.role_fit_severity, slot.primary_position, slot.secondary_positions)
    : undefined;
  const pendingFitPill = !slot.filled && isPendingTarget && pendingFit ? fitLabel(pendingFit, pendingFitSeverity) : "";
  const pendingFitTooltip = pendingFitPill
    ? fitTooltip(pendingFitPill, pendingFit, pendingFitSeverity, pendingPrimaryPosition, undefined)
    : "";

  const sharedAttrs = {
    "data-testid": "court-slot",
    "data-slot-type": slot.slot_type,
    "data-filled": slot.filled ? "true" : "false",
  } as const;

  // E2 (court geometry is immutable): `CourtLayout`'s own grid cell
  // (`.roster-board-starters > div`, unchanged, shared with legacy) already
  // fixes each cell to `--court-slot-h` via globals.css -- but that only
  // constrains the CELL. Without this class on the card ITSELF, a filled
  // slot's real content (a two-line name, the reveal/lock note, the fit
  // caption) simply grows the card's own box taller than an empty one's,
  // which is exactly what a bounding-box comparison across states would
  // catch: the cell's overflow:hidden only clips what's PAINTED, not what
  // `getBoundingClientRect()` reports for an overflowing child with no
  // height of its own. `.roster-board-slot-card-fixed` (globals.css) is the
  // same real, already-shared mechanism legacy's own `PeakCardCourt.tsx`
  // uses for this -- reused here verbatim, not re-derived.
  const fixedHeightClass = "roster-board-slot-card-fixed";

  const fitCaption = fit ? (
    <span
      data-testid="role-fit-badge"
      title={fitTitle}
      style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.625rem", color: fitColor(slot.role_fit, slot.role_fit_severity) }}
    >
      {fit}
    </span>
  ) : null;

  if (onSwapTarget) {
    return (
      <button
        type="button"
        {...sharedAttrs}
        data-testid="slot-swap-target"
        onClick={onSwapTarget}
        aria-label={
          movingFromSlotLabel
            ? `Move to ${SLOT_LABELS[slot.slot_type]}${slot.filled ? `, swapping with ${slot.player_name ?? "the player there"}` : ""} (from ${movingFromSlotLabel})`
            : `Move to ${SLOT_LABELS[slot.slot_type]}`
        }
        className={`flex w-full flex-col gap-1 text-left ${fixedHeightClass}`}
        style={{ outline: "2px dashed var(--v2-color-accent)", outlineOffset: 2, borderRadius: "var(--v2-radius-control)" }}
      >
        <PeakV2CourtSlot
          position={SLOT_LABELS[slot.slot_type] ?? slot.slot_type}
          player={slot.filled ? { name: slot.player_name ?? "", meta: scoreLine } : undefined}
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
        {fitCaption}
      </button>
    );
  }

  if (onCancelMove) {
    return (
      <button type="button" {...sharedAttrs} data-testid="slot-moving-source" onClick={onCancelMove} className={`flex w-full flex-col gap-1 text-left ${fixedHeightClass}`} aria-label={`Cancel moving ${slot.player_name ?? "this player"} — they stay at ${SLOT_LABELS[slot.slot_type]}`}>
        <PeakV2CourtSlot
          position={SLOT_LABELS[slot.slot_type] ?? slot.slot_type}
          player={slot.filled ? { name: slot.player_name ?? "", meta: "Moving — click to cancel" } : undefined}
          value={value}
          state="current"
        />
        {fitCaption}
      </button>
    );
  }

  const clickable = !!onClick;
  const tier = isPendingTarget ? pendingFitTier(pendingFit, pendingFitSeverity) : "neutral";
  const pendingHint = tier === "weak" ? "Off-position" : tier === "stretch" ? "Playable stretch" : "Place here";
  const body = (
    <PeakV2CourtSlot
      position={SLOT_LABELS[slot.slot_type] ?? slot.slot_type}
      player={slot.filled ? { name: slot.player_name ?? "", meta: scoreLine } : undefined}
      value={value}
      valueLabel={slot.filled ? "PEAK3" : undefined}
      state={isPendingTarget ? "staged" : slot.filled ? "filled" : "empty"}
      emptyHint={isPendingTarget ? pendingHint : blockedDuringPlacement ? "Occupied" : "Open"}
      onMove={onMove}
      moveLabel="Move"
      moveTestId="slot-move-btn"
      className={isPendingTarget ? `court-slot-pending-${tier}` : undefined}
    />
  );

  const pendingBadge =
    isPendingTarget && pendingFitPill ? (
      <span
        data-testid="pending-fit-badge"
        title={pendingFitTooltip}
        style={{
          fontFamily: "var(--v2-font-ui)",
          fontSize: "0.625rem",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: fitColor(pendingFit, pendingFitSeverity),
        }}
      >
        {pendingFitPill}
      </span>
    ) : null;

  if (blockedDuringPlacement) {
    const reason = `${SLOT_LABELS[slot.slot_type]} is already filled by ${
      slot.player_name ?? "a player"
    }. Place your new pick in an open slot instead.`;
    const fullNote = (
      <span
        style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.625rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--v2-text-muted)" }}
      >
        Full — place in an open slot
      </span>
    );
    // `action_swap_slots` allows rearranging even mid-placement, so `onMove`
    // is live on this same card the moment any slot has a card in it -- see
    // PeakCardCourt.tsx's own comment for why the `onMove` branch (a
    // `role="group"` container, never a `<button disabled>` wrapping a real
    // live one) is the one this actually reaches from the player's second
    // pick onward.
    if (onMove) {
      return (
        <div
          {...sharedAttrs}
          data-blocked="true"
          role="group"
          aria-disabled="true"
          aria-label={reason}
          className={`flex flex-col gap-1 ${fixedHeightClass}`}
          style={{ opacity: 0.85 }}
        >
          {body}
          {fullNote}
          {fitCaption}
        </div>
      );
    }
    return (
      <button
        type="button"
        {...sharedAttrs}
        disabled
        data-blocked="true"
        aria-disabled="true"
        aria-label={reason}
        className={`flex w-full flex-col gap-1 text-left ${fixedHeightClass}`}
        style={{ opacity: 0.55, cursor: "not-allowed" }}
      >
        {body}
        {fullNote}
        {fitCaption}
      </button>
    );
  }

  if (clickable) {
    return (
      <button type="button" {...sharedAttrs} onClick={onClick} className={`flex w-full flex-col gap-1 text-left ${fixedHeightClass}`}>
        {body}
        {fitCaption}
        {pendingBadge}
      </button>
    );
  }

  return (
    <div {...sharedAttrs} className={`flex flex-col gap-1 ${fixedHeightClass}`}>
      {body}
      {fitCaption}
      {pendingBadge}
    </div>
  );
}
