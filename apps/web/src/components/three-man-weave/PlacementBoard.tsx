"use client";

import type { TmwPick, TmwRoster, TmwSlotType } from "@/types/three-man-weave";
import { TMW_SLOT_LABELS, TMW_SLOT_TYPES } from "@/types/three-man-weave";
import { slotAbbrev } from "@/lib/three-man-weave-state";

/**
 * THE INTERACTIVE ROSTER. Six slots, every one of them a real target.
 *
 * WHAT THIS REPLACES, AND WHY IT IS THE WHOLE FIX. The pick overlay used to
 * render the roster as a plain `<ul>` of `<li>` elements and put placement
 * behind a `<select>` labelled "Place at". Everything a drafter wants to do —
 * put this player at PF, move that one to the bench, see what a rearrangement
 * would actually do — was either impossible or hidden inside a dropdown that
 * appeared only when more than one slot was legal. The manual finding listed
 * six separate consequences of that one decision:
 *
 *   * "the primary flow relies on a small destination dropdown"
 *   * "the user cannot simply click an open roster slot"
 *   * "the user cannot visually click, move, swap, or reassign existing cards"
 *   * "'Fits after rearrangement' is merely a label"
 *   * "the right side of the dialog is often mostly empty"
 *   * placement being invisible until after a selection was made
 *
 * So the slots ARE the control. Each one is a `<button>` when it is a legal
 * destination and a `<div>` when it is not, which means the keyboard and the
 * accessibility tree agree with what the eye sees — an element that looks
 * clickable and is not is worse than one that never looked clickable.
 *
 * THREE MODES, ONE COMPONENT:
 *
 *   `idle`      — nothing selected. Occupied slots are clickable to START a
 *                 move; empty ones are inert.
 *   `placing`   — a candidate is selected. Legal destinations light up, illegal
 *                 ones dim, and the staged slot shows the incoming player.
 *   `moving`    — one of your own cards is selected. Its legal destinations
 *                 light up, and each says what it would swap with.
 *
 * NOTHING HERE DECIDES LEGALITY. `legalSlots` is computed by the caller from
 * the SERVER's own fit verdict; this component renders a set it is handed. A
 * client that re-derived which slots were legal would be a second copy of the
 * rule, and it would disagree with the first at exactly the moment a player
 * expected a pick to land.
 */

export type PlacementMode = "idle" | "placing" | "moving";

export interface PlacementBoardProps {
  roster: TmwRoster | null;
  mode: PlacementMode;
  /** Slots the current selection may legally land on. */
  legalSlots: readonly TmwSlotType[];
  /** The slot currently staged, if the player has chosen one. */
  stagedSlot: TmwSlotType | null;
  /** Name of the incoming candidate, shown in the staged slot. */
  incomingName: string | null;
  /** Slot the card being moved came from, in `moving` mode. */
  movingFrom: TmwSlotType | null;
  /**
   * Slots a rearrangement plan would vacate, mapped to where their occupant
   * goes. Drives the "→ BN" annotation and the vacating treatment.
   */
  vacating: Record<string, TmwSlotType>;
  onSelectSlot: (slot: TmwSlotType) => void;
  /** Start moving the card already in this slot. Absent when moves are not
   *  currently allowed (an opponent's board, a resolved match). */
  onStartMove?: (slot: TmwSlotType) => void;
}

export default function PlacementBoard({
  roster,
  mode,
  legalSlots,
  stagedSlot,
  incomingName,
  movingFrom,
  vacating,
  onSelectSlot,
  onStartMove,
}: PlacementBoardProps) {
  const legal = new Set(legalSlots);

  return (
    <ul className="tmw-place-slots" data-testid="tmw-place-slots" data-mode={mode}>
      {TMW_SLOT_TYPES.map((slotType) => {
        const occupant: TmwPick | null = roster?.slots[slotType] ?? null;
        const isLegal = legal.has(slotType);
        const isStaged = stagedSlot === slotType;
        const isSource = movingFrom === slotType;
        const goesTo = vacating[slotType] ?? null;

        // WHAT CLICKING THIS SLOT WOULD DO, as one decision made in one place.
        // In `idle` an occupied slot starts a move; in the other two modes a
        // legal slot commits the staged placement. Anything else is inert, and
        // is rendered as a non-interactive element so it does not lie.
        const startsMove = mode === "idle" && !!occupant && !!onStartMove;
        const acceptsDrop = (mode === "placing" || mode === "moving") && isLegal;
        const interactive = startsMove || acceptsDrop;

        const body = (
          <>
            <span className="tmw-place-tag" aria-hidden="true">
              {slotAbbrev(slotType)}
            </span>
            <span className="tmw-place-body">
              {isStaged && incomingName ? (
                <strong className="tmw-place-incoming" data-testid={`tmw-staged-${slotType}`}>
                  {incomingName}
                </strong>
              ) : occupant ? (
                <span className="tmw-place-occupant">{occupant.player_name}</span>
              ) : (
                <span className="tmw-place-open">Open</span>
              )}
              {/* THE MOVEMENT IS SHOWN ON THE SLOT IT AFFECTS, not summarised
                  in a sentence underneath. "Fits after rearrangement" was a
                  label; this is the arrangement. */}
              {goesTo ? (
                <span className="tmw-place-move" data-testid={`tmw-vacating-${slotType}`}>
                  {/* ON THE SLOT THE PICK LANDS ON, THE ARROW NEEDS A NAME.
                      Everywhere else the name immediately to the left of this
                      arrow is the player moving, so a bare "→ PF" reads
                      correctly. On the staged slot that name is the INCOMING
                      player, and a review frame showed what that produces:
                      "D'Angelo Russell → SG" directly above a preview list
                      saying Russell goes to POINT GUARD and Bruce Brown is the
                      one going to shooting guard. */}
                  {isStaged && occupant
                    ? `${occupant.player_name} → ${slotAbbrev(goesTo)}`
                    : `→ ${slotAbbrev(goesTo)}`}
                </span>
              ) : null}
              {acceptsDrop && occupant && !isStaged ? (
                <span className="tmw-place-swap">swaps out</span>
              ) : null}
            </span>
          </>
        );

        const shared = {
          "data-testid": `tmw-place-${slotType}`,
          "data-incoming": isStaged ? "true" : "false",
          "data-vacating": goesTo ? "true" : "false",
          "data-legal": isLegal ? "true" : "false",
          "data-source": isSource ? "true" : "false",
          "data-occupied": occupant ? "true" : "false",
        };

        return (
          <li key={slotType} className="tmw-place-row">
            {interactive ? (
              <button
                type="button"
                {...shared}
                className="tmw-place-slot tmw-place-slot--interactive"
                aria-pressed={isStaged || isSource}
                aria-label={
                  startsMove
                    ? `Move ${occupant!.player_name} out of ${TMW_SLOT_LABELS[slotType]}`
                    : occupant
                      ? `Place at ${TMW_SLOT_LABELS[slotType]}, swapping out ${occupant.player_name}`
                      : `Place at ${TMW_SLOT_LABELS[slotType]}, currently open`
                }
                onClick={() =>
                  startsMove ? onStartMove?.(slotType) : onSelectSlot(slotType)
                }
              >
                {body}
              </button>
            ) : (
              <div
                {...shared}
                className="tmw-place-slot"
                // DIMMED SLOTS SAY WHY THEY ARE DIMMED. An illegal destination
                // during a placement is a rule the player should be able to
                // read off the board rather than infer from an absence.
                aria-label={
                  mode === "placing" || mode === "moving"
                    ? `${TMW_SLOT_LABELS[slotType]}: not a legal destination for this player`
                    : `${TMW_SLOT_LABELS[slotType]}: ${occupant?.player_name ?? "open"}`
                }
              >
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
