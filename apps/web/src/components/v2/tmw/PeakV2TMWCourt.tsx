"use client";

/**
 * PeakV2TMWCourt — one seat's court (Pass 3), in the V2 court-card grammar
 * `PeakV2CourtPanel`/`PeakV2CourtSlot` established (Pass 2.5) specifically
 * for this. The active seat is lit (`PeakV2CourtPanel presentation="lit"`);
 * the other two are dimmed but fully legible — "never replace courts with
 * roster tables" (brief). Court positions arranged in a real basketball
 * layout (PG up top, wings either side, PF/C in the paint, bench below) via
 * CSS grid-template-areas rather than a flat list.
 *
 * Every field is the exact same `TmwRoster`/`ArenaSeatPublic` data
 * `SeatCourt` already renders — no second roster shape.
 */

import PeakV2CourtPanel from "../PeakV2CourtPanel";
import PeakV2CourtSlot from "../PeakV2CourtSlot";
import type { ArenaSeatPublic, TmwEdgeBand, TmwRoster, TmwSlotType } from "@/types/three-man-weave";
import { TMW_STARTER_SLOTS, TMW_SLOT_LABELS } from "@/types/three-man-weave";
import { TMW_EDGE_LABELS, benchSlots, positionsLine } from "@/lib/three-man-weave-state";

const AREA: Record<(typeof TMW_STARTER_SLOTS)[number], string> = {
  PG: "pg",
  SG: "sg",
  SF: "sf",
  PF: "pf",
  C: "c",
};

export interface PeakV2TMWCourtProps {
  roster: TmwRoster;
  seat: ArenaSeatPublic | undefined;
  isYou: boolean;
  isOnTurn: boolean;
  edge?: TmwEdgeBand | null;
  lit: boolean;
  /**
   * Between-turn rearrangement (Pass 4, TMW-10 ported to V2) — only ever
   * passed for the viewer's OWN court; the other two stay read-only, same
   * rule legacy `RosterBoard`/`SeatCourt` enforce.
   */
  interactive?: boolean;
  /**
   * Bug fix (mission §10 follow-up): structurally "is this the viewer's own,
   * rearrangeable court" — TRUE across a transient `busy` window (e.g. while
   * `dismissIntro`'s request is in flight), unlike `interactive` itself,
   * which the caller correctly drops to `false` for that same window to
   * disable clicks. Reusing `interactive` alone to decide whether the
   * "Select a card to rearrange…" hint paragraph MOUNTS AT ALL made that
   * paragraph disappear and reappear across every `busy` toggle, which is a
   * real, measured ~32px outer-shell height dip (confirmed live at 1440x900:
   * the court panel shrank from 534.5px to 502px for the ~300ms
   * `dismissIntro` round-trip, before instrument-strip content is even
   * involved). Defaults to `interactive` so a caller that never has a
   * transient-busy distinction keeps its previous behaviour exactly.
   */
  rearrangeEligible?: boolean;
  pickedUpSlot?: TmwSlotType | null;
  legalTargets?: readonly TmwSlotType[];
  onPickUp?: (slot: TmwSlotType) => void;
  onDropOn?: (slot: TmwSlotType) => void;
}

export default function PeakV2TMWCourt({
  roster,
  seat,
  isYou,
  isOnTurn,
  edge,
  lit,
  interactive = false,
  rearrangeEligible = interactive,
  pickedUpSlot = null,
  legalTargets = [],
  onPickUp,
  onDropOn,
}: PeakV2TMWCourtProps) {
  const name = seat?.display_name ?? `Seat ${roster.seat_index + 1}`;
  const filled = Object.values(roster.slots).filter(Boolean).length;
  const bench = benchSlots(roster);
  const moving = pickedUpSlot !== null;
  const legal = new Set(legalTargets);

  function slotState(slotType: TmwSlotType): "empty" | "filled" | "staged" | "current" {
    if (pickedUpSlot === slotType) return "current";
    if (moving && legal.has(slotType)) return "staged";
    return roster.slots[slotType] ? "filled" : "empty";
  }

  function activateLabelFor(slotType: TmwSlotType, pick: TmwRoster["slots"][TmwSlotType]): string | undefined {
    if (!interactive) return undefined;
    if (moving) {
      return legal.has(slotType)
        ? `Move here: ${TMW_SLOT_LABELS[slotType]}${pick ? `, swapping with ${pick.player_name}` : ", currently open"}`
        : `${TMW_SLOT_LABELS[slotType]}: not a legal destination`;
    }
    return pick ? `Rearrange ${pick.player_name}, currently at ${TMW_SLOT_LABELS[slotType]}` : undefined;
  }

  return (
    <PeakV2CourtPanel
      testId={`tmw-seat-court-${roster.seat_index}`}
      label={name}
      status={
        <span
          style={{
            fontFamily: "var(--v2-font-mono)",
            fontSize: "0.6875rem",
            fontWeight: 700,
            color: isYou ? "var(--v2-color-accent)" : "var(--v2-text-muted)",
          }}
        >
          {isYou ? "You" : seat?.is_bot ? "Bot" : "Drafter"} · {filled}/6
          {isOnTurn ? " · On the clock" : ""}
        </span>
      }
      presentation={lit ? "lit" : "dimmed"}
    >
      {edge ? (
        <p style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.6875rem", color: "var(--v2-text-secondary)" }}>
          {TMW_EDGE_LABELS[edge]}
        </p>
      ) : null}

      <div
        className="grid gap-2"
        style={{
          gridTemplateAreas: `"pg pg" "sg sf" "pf c"`,
          gridTemplateColumns: "1fr 1fr",
        }}
      >
        {TMW_STARTER_SLOTS.map((slot) => {
          const pick = roster.slots[slot] ?? null;
          return (
            <div key={slot} style={{ gridArea: AREA[slot] }}>
              <PeakV2CourtSlot
                position={slot}
                player={pick ? { name: pick.player_name, meta: `${pick.scoring_card ? `${pick.scoring_card.season} ${pick.scoring_card.team_id}` : "—"} · ${positionsLine(pick)}` } : undefined}
                metaTestId={pick ? `tmw-slot-season-${slot}` : undefined}
                value={pick?.scoring_card ? pick.scoring_card.prime_score.toFixed(1) : undefined}
                emptyHint={TMW_SLOT_LABELS[slot]}
                state={slotState(slot)}
                interactive={interactive}
                moving={moving}
                onPickUp={interactive ? () => onPickUp?.(slot) : undefined}
                onDropOn={interactive ? () => onDropOn?.(slot) : undefined}
                activateLabel={activateLabelFor(slot, pick)}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-1">
        <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.625rem", fontWeight: 700, color: "var(--v2-text-muted)" }}>
          BENCH
        </span>
        <div className="mt-1 grid grid-cols-1 gap-2">
          {/* THE BENCH CARRIES THE SAME INFORMATION AS A STARTER, because it
              carries the same weight in the score. Three-Man Weave's
              `lineup_score` is a FLAT, equally-weighted mean over all six
              cards (`nba_peak/three_man_weave/evaluation.py::_tmw_talent_core`)
              — unlike 82-0, there is no 0.8/0.2 starters-to-bench split. A
              bench pick therefore moves the final number exactly as much as
              the point guard does, and this slot used to render a bare name
              with no season, no team, no positions and no PEAK3 value
              (design-review/14), which made the single most under-rated
              decision in the draft look like an afterthought. */}
          {bench.map(({ slotType, pick }) => (
            <PeakV2CourtSlot
              key={slotType}
              position={TMW_SLOT_LABELS[slotType]}
              bench
              benchDetail
              player={
                pick
                  ? {
                      name: pick.player_name,
                      meta: `${pick.scoring_card ? `${pick.scoring_card.season} ${pick.scoring_card.team_id}` : "—"} · ${positionsLine(pick)}`,
                    }
                  : undefined
              }
              metaTestId={pick ? `tmw-slot-season-${slotType}` : undefined}
              value={pick?.scoring_card ? pick.scoring_card.prime_score.toFixed(1) : undefined}
              emptyHint="Open"
              state={slotState(slotType)}
              interactive={interactive}
              moving={moving}
              onPickUp={interactive ? () => onPickUp?.(slotType) : undefined}
              onDropOn={interactive ? () => onDropOn?.(slotType) : undefined}
              activateLabel={activateLabelFor(slotType, pick)}
            />
          ))}
        </div>
      </div>

      {rearrangeEligible ? (
        <p
          className="mt-2"
          style={{
            fontFamily: "var(--v2-font-ui)",
            fontSize: "0.6875rem",
            color: "var(--v2-text-muted)",
            // Reserved (mission §10 follow-up): mounted for the whole time
            // this court is structurally rearrangeable, only its
            // visibility toggles across a transient `!interactive` window
            // (e.g. `busy` while a request is in flight) -- never popping
            // in/out, which is what previously moved the outer shell.
            visibility: interactive ? "visible" : "hidden",
          }}
        >
          {moving ? "Choose a highlighted slot, or press Escape to cancel." : "Select a card to rearrange your roster — this never costs a turn."}
        </p>
      ) : null}
    </PeakV2CourtPanel>
  );
}
