"use client";

/**
 * PeakV2TMWCourts — the shared instrument strip + three courts (Pass 3),
 * verified against the reference (E2 page 20): active court fully lit,
 * siblings dimmed but legible, real round/pick/pool/clock instrumentation.
 */

import { useState } from "react";
import PeakV2Shell from "../PeakV2Shell";
import PeakV2LiveHeader from "../PeakV2LiveHeader";
import PeakV2GameStatus from "../PeakV2GameStatus";
import PeakV2Timer from "../PeakV2Timer";
import PeakV2TMWCourt from "./PeakV2TMWCourt";
import { useRemainingSeconds } from "@/components/shared/ArenaTimer";
import { edgeBandFor, edgeQualifier } from "@/lib/three-man-weave-state";
import type { ArenaSeatPublic, TmwPublicState } from "@/types/three-man-weave";

export interface PeakV2TMWCourtsProps {
  state: TmwPublicState;
  seats: ArenaSeatPublic[];
  yourSeatIndex: number | null;
  currentTurnSeatIndex: number | null;
  poolSize: number;
  deadlineAt: number | null;
  picksMade: number;
  totalPicks: number;
  children?: React.ReactNode;
}

export default function PeakV2TMWCourts({
  state,
  seats,
  yourSeatIndex,
  currentTurnSeatIndex,
  poolSize,
  deadlineAt,
  picksMade,
  totalPicks,
  children,
}: PeakV2TMWCourtsProps) {
  const remaining = useRemainingSeconds(deadlineAt);
  const qualifier = edgeQualifier(state);
  // Mobile-only: "deliberate access between YOUR COURT / OTHER COURTS"
  // (brief) rather than three courts crushed into one column. Desktop
  // ignores this entirely and shows the real three-column grid.
  const [mobileSeat, setMobileSeat] = useState<number>(yourSeatIndex ?? state.rosters[0]?.seat_index ?? 0);

  return (
    <PeakV2Shell width="live-wide">
      <div className="py-6">
        <PeakV2LiveHeader
          as="h1"
          title="Three-Man Weave"
          subtitle={qualifier ?? undefined}
          status={<PeakV2GameStatus label={`Round ${state.current_round ?? "—"} of ${state.total_rounds} · pick ${picksMade + 1} of ${totalPicks}`} state="active" />}
          instrument={
            <div className="flex items-center gap-4">
              <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.75rem", color: "var(--v2-text-muted)" }}>
                {poolSize} undrafted
              </span>
              {remaining !== null ? <PeakV2Timer secondsRemaining={remaining} urgentAtSeconds={5} /> : null}
            </div>
          }
        />

        {/* Mobile tab bar — one court at a time, every one a tap away. */}
        <div className="mt-4 flex gap-1 lg:hidden" role="tablist" aria-label="Rosters">
          {state.rosters.map((roster) => {
            const isYou = roster.seat_index === yourSeatIndex;
            const seat = seats.find((s) => s.seat_index === roster.seat_index);
            const filled = Object.values(roster.slots).filter(Boolean).length;
            return (
              <button
                key={roster.seat_index}
                type="button"
                role="tab"
                aria-selected={mobileSeat === roster.seat_index}
                onClick={() => setMobileSeat(roster.seat_index)}
                className="flex-1 rounded-t px-2 py-2 text-left"
                style={{
                  borderBottom: `2px solid ${mobileSeat === roster.seat_index ? "var(--v2-color-accent)" : "var(--v2-border-subtle)"}`,
                  opacity: mobileSeat === roster.seat_index ? 1 : 0.6,
                }}
              >
                <span style={{ fontFamily: "var(--v2-font-ui)", fontWeight: 700, fontSize: "0.75rem", color: "var(--v2-text-primary)" }}>
                  {isYou ? "You" : (seat?.display_name ?? `Seat ${roster.seat_index + 1}`)}
                </span>
                <span className="block" style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.625rem", color: "var(--v2-text-muted)" }}>
                  {filled}/6
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-2 lg:hidden">
          {state.rosters
            .filter((roster) => roster.seat_index === mobileSeat)
            .map((roster) => (
              <PeakV2TMWCourt
                key={roster.seat_index}
                roster={roster}
                seat={seats.find((s) => s.seat_index === roster.seat_index)}
                isYou={roster.seat_index === yourSeatIndex}
                isOnTurn={!state.is_complete && currentTurnSeatIndex === roster.seat_index}
                edge={edgeBandFor(state, roster.seat_index)}
                lit
              />
            ))}
        </div>

        {/* Desktop: the real three-column grid, always. */}
        <div className="mt-4 hidden gap-4 lg:grid lg:grid-cols-3">
          {state.rosters.map((roster) => (
            <PeakV2TMWCourt
              key={roster.seat_index}
              roster={roster}
              seat={seats.find((s) => s.seat_index === roster.seat_index)}
              isYou={roster.seat_index === yourSeatIndex}
              isOnTurn={!state.is_complete && currentTurnSeatIndex === roster.seat_index}
              edge={edgeBandFor(state, roster.seat_index)}
              lit={roster.seat_index === yourSeatIndex || (yourSeatIndex === null && roster.seat_index === currentTurnSeatIndex)}
            />
          ))}
        </div>

        {children}
      </div>
    </PeakV2Shell>
  );
}
