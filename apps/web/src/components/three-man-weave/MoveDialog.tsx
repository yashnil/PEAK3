"use client";
import { useEffect, useId, useMemo, useState } from "react";
import type { TmwRoster, TmwSlotType } from "@/types/three-man-weave";
import { TMW_SLOT_LABELS, TMW_SLOT_TYPES } from "@/types/three-man-weave";
import { slotAbbrev } from "@/lib/three-man-weave-state";

/**
 * Repositioning your own roster, from the persistent board.
 *
 * CLICK-TO-MOVE IS THE PRIMARY PATH, NOT A FALLBACK. Drag-and-drop is the
 * obvious gesture for a lineup card and it is the one that cannot be made
 * keyboard-operable without building a second, hidden interface anyway -- so
 * the second interface is the only interface. Pick a player, pick a
 * destination, confirm. Every step is a button, every button is reachable by
 * tab, and nothing about the flow changes on a touchscreen.
 *
 * THE SERVER VALIDATES, ALWAYS. What is offered here is a candidate
 * arrangement, not a verdict: this component filters destinations to the ones
 * that are obviously worth offering, and `tmw_rearrange` re-derives legality
 * from the authoritative roster before anything is written. A destination that
 * looks fine here and is refused there is a refusal the player sees, never a
 * roster that quietly ends up illegal.
 *
 * A MOVE IS ALWAYS A SWAP OR A FILL. Moving A into B's slot puts B into A's
 * old one -- there is no state in which a player is holding two slots or none.
 * That is what makes the whole operation expressible as one final assignment,
 * which is the only shape the server accepts.
 */
export default function MoveDialog({
  open,
  roster,
  fromSlot,
  busy,
  error,
  onCommit,
  onClose,
}: {
  open: boolean;
  roster: TmwRoster | null;
  fromSlot: TmwSlotType | null;
  busy: boolean;
  error: string | null;
  /** The COMPLETE final assignment, slot -> player_slug. */
  onCommit: (placements: Record<string, string>) => void;
  onClose: () => void;
}) {
  const headingId = useId();
  const [target, setTarget] = useState<TmwSlotType | null>(null);

  useEffect(() => {
    if (open) setTarget(null);
  }, [open, fromSlot]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const moving = fromSlot ? (roster?.slots[fromSlot] ?? null) : null;

  const destinations = useMemo(() => {
    if (!moving || !fromSlot) return [] as TmwSlotType[];
    // The bench accepts anyone with a recognised position; a starter slot
    // accepts a player who plays it. `positions` is the model's own answer and
    // is on every pick payload, so no rule is re-derived here.
    const plays = new Set(moving.positions ?? []);
    return TMW_SLOT_TYPES.filter(
      (slot) => slot !== fromSlot && (slot === "bench_1" || plays.has(slot)),
    );
  }, [moving, fromSlot]);

  if (!open || !moving || !fromSlot || !roster) return null;

  function commit() {
    if (!target || !fromSlot || !roster) return;
    const placements: Record<string, string> = {};
    for (const slot of TMW_SLOT_TYPES) {
      const occupant = roster.slots[slot];
      if (occupant) placements[slot] = occupant.player_slug;
    }
    const displaced = roster.slots[target];
    placements[target] = moving!.player_slug;
    if (displaced) {
      placements[fromSlot] = displaced.player_slug;
    } else {
      delete placements[fromSlot];
    }
    onCommit(placements);
  }

  return (
    <div className="tmw-overlay-scrim" data-testid="tmw-move-scrim">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        data-testid="tmw-move-dialog"
        className="tmw-move"
      >
        <h2 id={headingId} className="tmw-move-title">
          Move {moving.player_name}
        </h2>
        <p className="tmw-move-from">
          Currently at {TMW_SLOT_LABELS[fromSlot]} · plays{" "}
          {(moving.positions ?? []).join(" / ") || "—"}
        </p>

        {destinations.length === 0 ? (
          <p className="tmw-move-none" data-testid="tmw-move-none">
            {moving.player_name} has no other slot they can legally occupy.
          </p>
        ) : (
          <div role="radiogroup" aria-label="Move to" className="tmw-move-options">
            {destinations.map((slot) => {
              const displaced = roster.slots[slot];
              return (
                <button
                  key={slot}
                  type="button"
                  role="radio"
                  aria-checked={target === slot}
                  data-testid={`tmw-move-to-${slot}`}
                  className="tmw-move-option"
                  onClick={() => setTarget(slot)}
                >
                  <span className="tmw-move-option-tag">{slotAbbrev(slot)}</span>
                  <span className="tmw-move-option-body">
                    <span>{TMW_SLOT_LABELS[slot]}</span>
                    <span className="tmw-move-option-swap">
                      {displaced
                        ? `swaps with ${displaced.player_name}`
                        : "currently open"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {error && (
          <p role="alert" className="tmw-move-error" data-testid="tmw-move-error">
            {error}
          </p>
        )}

        <div className="tmw-move-actions">
          <button
            type="button"
            className="btn-primary"
            data-testid="tmw-move-confirm"
            disabled={!target || busy}
            onClick={commit}
          >
            {busy ? "Moving…" : "Move"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            data-testid="tmw-move-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
