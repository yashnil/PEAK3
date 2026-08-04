"use client";
import { useState } from "react";
import type { TmwSlotType } from "@/types/three-man-weave";
import { TMW_SLOT_LABELS } from "@/types/three-man-weave";
import type { TmwCandidate } from "@/lib/three-man-weave-state";
import PickProvenance from "./PickProvenance";

/**
 * Pick a player, then pick a slot.
 *
 * The same two-step pattern as `run-the-table/DraftRoom.tsx`, and for the
 * reason its own header comment gives: it works with a keyboard and a screen
 * reader with no drag machinery, and there is no half-completed drop. A drag
 * interaction here would also have to survive a poll landing mid-gesture,
 * which is a race this shape simply does not have.
 *
 * A candidate this seat cannot legally place is shown, not hidden. Hiding
 * would make the roll look thinner than it is and would silently conceal the
 * most useful information a player has: that a strong player is on the board
 * and their own roster shape is what is stopping them. It is `aria-disabled`
 * rather than `disabled` so it stays in the tab order — otherwise a keyboard
 * user can never reach the one card that explains the greyed-out state.
 */
export default function PickPanel({
  candidates,
  busy,
  disabledReason,
  onPick,
}: {
  candidates: TmwCandidate[];
  busy: boolean;
  /** Non-null when this seat may not act — e.g. it is not their turn. */
  disabledReason: string | null;
  onPick: (playerSlug: string, slotType: TmwSlotType) => void;
}) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const selected = candidates.find((c) => c.player_slug === selectedSlug) ?? null;

  if (disabledReason) {
    return (
      <section
        data-testid="tmw-pick-panel"
        data-state="waiting"
        className="rounded-lg border p-4"
        style={{ borderColor: "var(--border-subtle)", background: "var(--bg-elevated)" }}
      >
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {disabledReason}
        </p>
      </section>
    );
  }

  return (
    <section
      data-testid="tmw-pick-panel"
      data-state="active"
      aria-labelledby="tmw-pick-heading"
      className="flex flex-col gap-3 rounded-lg border p-3"
      style={{
        borderColor: "var(--peak-accent)",
        background: "var(--bg-elevated)",
        // CONTAINER breakpoints below, not viewport ones — and a `@[...]`
        // variant silently never matches without this. Same reason
        // `.rtt-decision-surface` sets it: this panel sits in a
        // `lg:grid-cols-[minmax(0,1fr)_20rem]` grid, so its width does not
        // track the viewport and a `sm:`/`md:` breakpoint would go two-up at
        // exactly the wrong moments.
        containerType: "inline-size",
      }}
    >
      <header className="flex flex-col gap-0.5">
        <span
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: "var(--peak-accent-text)" }}
        >
          Your pick
        </span>
        <h2 id="tmw-pick-heading" className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {selected
            ? `Now choose a slot for ${selected.player_name}.`
            : "Choose a player, then choose the slot they fill."}
        </h2>
      </header>

      <ul className="grid max-h-[26rem] gap-2 overflow-y-auto @[560px]:grid-cols-2" data-testid="tmw-candidates">
        {candidates.map((candidate) => {
          const isSelected = candidate.player_slug === selectedSlug;
          const blocked = candidate.legalSlots.length === 0;
          return (
            <li key={candidate.player_slug} className="min-w-0">
              <button
                type="button"
                data-testid={`tmw-candidate-${candidate.player_slug}`}
                data-blocked={blocked ? "true" : "false"}
                aria-pressed={isSelected}
                aria-disabled={blocked || undefined}
                disabled={busy}
                onClick={() => {
                  if (blocked) return;
                  setSelectedSlug(isSelected ? null : candidate.player_slug);
                }}
                className="h-full w-full rounded border p-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  borderColor: isSelected
                    ? "var(--peak-accent)"
                    : blocked
                      ? "var(--border-subtle)"
                      : "var(--border-default)",
                  // Recessed by fill, never by opacity — a wash would drag the
                  // blocked reason below AA on the card that most needs reading.
                  background: isSelected
                    ? "var(--peak-accent-bg)"
                    : blocked
                      ? "var(--bg-page)"
                      : "var(--bg-elevated)",
                }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className="min-w-0 truncate text-sm font-semibold"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {candidate.player_name}
                  </span>
                  <span
                    className="shrink-0 text-sm font-bold tabular-nums"
                    style={{ color: "var(--peak-accent-text)" }}
                  >
                    {candidate.scoring_card ? candidate.scoring_card.prime_score.toFixed(1) : "—"}
                  </span>
                </div>
                <div className="mt-1">
                  <PickProvenance player={candidate} compact />
                </div>
                {blocked && (
                  <p
                    data-testid={`tmw-blocked-${candidate.player_slug}`}
                    className="mt-1 text-[10px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    No open slot on your roster they can play.
                  </p>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {selected && (
        <div
          data-testid="tmw-slot-choices"
          className="flex flex-wrap gap-2 border-t pt-3"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          {selected.legalSlots.map((slotType) => (
            <button
              key={slotType}
              type="button"
              data-testid={`tmw-place-${slotType}`}
              disabled={busy}
              onClick={() => {
                onPick(selected.player_slug, slotType);
                setSelectedSlug(null);
              }}
              className="rounded px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-60"
              style={{ background: "var(--peak-accent)", color: "var(--peak-accent-on)" }}
            >
              {slotType === "bench_1" ? "Bench" : slotType}
              <span className="sr-only">{` — place ${selected.player_name} at ${TMW_SLOT_LABELS[slotType]}`}</span>
            </button>
          ))}
          <button
            type="button"
            data-testid="tmw-cancel-selection"
            disabled={busy}
            onClick={() => setSelectedSlug(null)}
            className="rounded px-3 py-1.5 text-xs disabled:opacity-60"
            style={{ color: "var(--text-secondary)" }}
          >
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
