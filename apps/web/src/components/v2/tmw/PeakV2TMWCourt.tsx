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
import type { ArenaSeatPublic, TmwEdgeBand, TmwRoster } from "@/types/three-man-weave";
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
}

export default function PeakV2TMWCourt({ roster, seat, isYou, isOnTurn, edge, lit }: PeakV2TMWCourtProps) {
  const name = seat?.display_name ?? `Seat ${roster.seat_index + 1}`;
  const filled = Object.values(roster.slots).filter(Boolean).length;
  const bench = benchSlots(roster);

  return (
    <PeakV2CourtPanel
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
                value={pick?.scoring_card ? pick.scoring_card.prime_score.toFixed(1) : undefined}
                emptyHint={TMW_SLOT_LABELS[slot]}
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
          {bench.map(({ slotType, pick }) => (
            <PeakV2CourtSlot
              key={slotType}
              position={slotType}
              bench
              player={pick ? { name: pick.player_name } : undefined}
              emptyHint="Open"
            />
          ))}
        </div>
      </div>
    </PeakV2CourtPanel>
  );
}
