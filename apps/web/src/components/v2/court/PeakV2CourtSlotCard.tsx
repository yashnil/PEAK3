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

  // DESKTOP DRAG-AND-DROP, ADDED ON TOP OF — NEVER INSTEAD OF — THE EXISTING
  // WAYS TO MOVE A PLAYER.
  //
  // The tile is already a real <button> that picks a player up on click, tap
  // and Enter/Space, and the court already lights its legal destinations.
  // Dragging is a fourth route to the same reducer path (`onMove` then
  // `onSwapTarget`), so a pointer user gets the direct manipulation they
  // expect while click, tap and keyboard remain fully sufficient. Nothing
  // here is reachable ONLY by dragging.
  //
  // WHY THE NATIVE HTML5 API. It is pointer-only by definition, so it cannot
  // hijack a touch scroll (mobile keeps the tap flow untouched), and the
  // browser suppresses the click that would otherwise follow a drag — so a
  // drop can never also fire the source tile's own `onClick` and immediately
  // re-pick-up the player it just placed.
  //
  // The drag image is the tile itself, captured at its real size, so the
  // thing under the cursor is the piece being moved rather than a
  // semi-transparent slice of the page at some arbitrary offset.
  const dragSourceProps = onMove
    ? {
        draggable: true,
        onDragStart: (event: React.DragEvent<HTMLElement>) => {
          event.dataTransfer.effectAllowed = "move";
          // Some browsers refuse to start a drag with no payload set.
          event.dataTransfer.setData("text/plain", slot.slot_type);
          if (event.currentTarget instanceof HTMLElement) {
            const rect = event.currentTarget.getBoundingClientRect();
            event.dataTransfer.setDragImage(event.currentTarget, rect.width / 2, rect.height / 2);
          }
          onMove();
        },
      }
    : {};

  const dropTargetProps = onSwapTarget
    ? {
        onDragOver: (event: React.DragEvent<HTMLElement>) => {
          // Calling preventDefault is what MARKS this element as a legal
          // drop target; an untouched dragover means "not droppable", which
          // is exactly the treatment an illegal destination should get —
          // the browser shows the no-drop cursor and the drop never fires,
          // so an invalid destination cannot move anything.
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        },
        onDrop: (event: React.DragEvent<HTMLElement>) => {
          event.preventDefault();
          onSwapTarget();
        },
      }
    : {};

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
        {...dropTargetProps}
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
  // ONE VOCABULARY FOR FIT, NOT TWO. This line used to say "Off-position" /
  // "Playable stretch" / "Place here" — a second set of words for exactly the
  // axis `pending-fit-badge` already names authoritatively, in the server's own
  // wording ("Flex fit" / "Role stretch" / "Structural mismatch", mirrored from
  // `nba_peak/perfect_season/positions.py::fit_label`). A placement board that
  // says "Playable stretch" here and "Role stretch" two lines below is asking
  // the player to work out whether those are the same thing.
  //
  // So the hint is now purely the ACTION, and fit is carried by the two
  // channels that already exist and do not need reading: the slot's own border
  // tier (`court-slot-pending-{strong,stretch,weak}`) and the single badge.
  const pendingHint = "Place here";
  const body = (
    <PeakV2CourtSlot
      position={SLOT_LABELS[slot.slot_type] ?? slot.slot_type}
      player={slot.filled ? { name: slot.player_name ?? "", meta: scoreLine } : undefined}
      value={value}
      valueLabel={slot.filled ? "PEAK3" : undefined}
      state={isPendingTarget ? "staged" : slot.filled ? "filled" : "empty"}
      emptyHint={isPendingTarget ? pendingHint : blockedDuringPlacement ? "Occupied" : "Open"}
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
    // ONE WORD, NOT A SENTENCE. This used to read "Full — place in an open
    // slot": a 10px uppercase grey instruction stamped on EVERY occupied
    // slot during placement — five copies of the same sentence, and because
    // the tile's height is fixed it pushed the fit caption underneath it
    // out of the box and clipped it in half (design-review/10).
    //
    // The instruction half is now carried by the COURT (open slots
    // illuminate, occupied ones recede) and, for assistive tech, by
    // `aria-label={reason}` on the container below. What stays is the
    // one-word STATE, in the same caption slot the fit label occupies on
    // every other tile — so it is sized for, and cannot clip.
    const blockedNote = (
      <span
        data-testid="slot-blocked-note"
        style={{
          fontFamily: "var(--v2-font-mono)",
          fontSize: "0.5625rem",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--v2-text-muted)",
        }}
      >
        Occupied
      </span>
    );
    // `action_swap_slots` allows rearranging even mid-placement, so `onMove`
    // is live on this same card the moment any slot has a card in it -- see
    // PeakCardCourt.tsx's own comment for why the `onMove` branch (a
    // `role="group"` container, never a `<button disabled>` wrapping a real
    // live one) is the one this actually reaches from the player's second
    // pick onward.
    // A FILLED SLOT IS INERT WHILE A PICK IS IN HAND. The tile is the
    // pickup control everywhere else (see the `onMove` branch further
    // down), but NOT here: the player already has a card selected and
    // waiting for a home, and letting them pick a second one up mid
    // placement is a state with no sensible meaning. Selection and
    // placement never overlap — the same rule that closes the candidate
    // panel the instant a pick is pending.
    //
    // Rendered as a `role="group"`/`aria-disabled` container rather than a
    // `<button disabled>` for the reason the original branch already
    // documented, and still carrying `aria-label={reason}` so a screen
    // reader is told WHY this is not a target rather than meeting an
    // unlabeled dead element.
    if (onMove) {
      return (
        <div
          {...sharedAttrs}
          data-blocked="true"
          role="group"
          aria-disabled="true"
          aria-label={reason}
          className={`flex flex-col gap-1 ${fixedHeightClass}`}
        >
          {body}
          {blockedNote}
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
        {blockedNote}
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

  // A placed player, court idle: the TILE is the pickup control. See the
  // note on the blocked branch above for why the Move button is gone.
  if (onMove) {
    return (
      <button
        type="button"
        {...sharedAttrs}
        data-pickup="true"
        onClick={onMove}
        {...dragSourceProps}
        aria-label={`${slot.player_name ?? SLOT_LABELS[slot.slot_type]} at ${SLOT_LABELS[slot.slot_type]} — pick up to move`}
        className={`flex w-full flex-col gap-1 text-left ${fixedHeightClass}`}
      >
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
