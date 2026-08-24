"use client";

/**
 * PeakV2TMWCourts — the shared instrument strip + three courts (Pass 3),
 * verified against the reference (E2 page 20): active court fully lit,
 * siblings dimmed but legible, real round/pick/pool/clock instrumentation.
 */

import { useCallback, useEffect, useState } from "react";
import PeakV2Shell from "../PeakV2Shell";
import PeakV2LiveHeader from "../PeakV2LiveHeader";
import PeakV2GameStatus from "../PeakV2GameStatus";
import PeakV2Timer from "../PeakV2Timer";
import PeakV2TMWCourt from "./PeakV2TMWCourt";
import { useRemainingSeconds } from "@/components/shared/ArenaTimer";
import {
  edgeBandFor,
  edgeQualifier,
  legalMoveTargets,
  moveRejection,
  placementsAfterMove,
} from "@/lib/three-man-weave-state";
import type { ArenaSeatPublic, TmwPublicState, TmwSlotType } from "@/types/three-man-weave";

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
  /**
   * Between-turn rearrangement (Pass 4, TMW-10 ported to V2 — see
   * `RosterBoard.tsx`'s docstring for the full rule set this ports:
   * drag/click-to-select a card, click a highlighted destination, Escape
   * cancels, an occupied destination swaps, and only when the whole
   * resulting assignment is legal for both slots). Commits a COMPLETE
   * final assignment; absent in a finished match. Never consumes a turn.
   */
  onMove?: (placements: Record<string, string>) => void;
  busy?: boolean;
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
  onMove,
  busy = false,
}: PeakV2TMWCourtsProps) {
  const remaining = useRemainingSeconds(deadlineAt);
  const qualifier = edgeQualifier(state);
  // Mobile-only: "deliberate access between YOUR COURT / OTHER COURTS"
  // (brief) rather than three courts crushed into one column. Desktop
  // ignores this entirely and shows the real three-column grid.
  const [mobileSeat, setMobileSeat] = useState<number>(yourSeatIndex ?? state.rosters[0]?.seat_index ?? 0);

  const yourRoster = yourSeatIndex === null ? null : (state.rosters.find((r) => r.seat_index === yourSeatIndex) ?? null);
  const canRearrange = !!onMove && !!yourRoster && !state.is_complete;
  const [pickedUp, setPickedUp] = useState<TmwSlotType | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "done"; text: string } | null>(null);

  // ESCAPE CANCELS — the accessible half of "drop it" — same as legacy.
  useEffect(() => {
    if (pickedUp === null) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setPickedUp(null);
      setNotice(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickedUp]);

  const pickUp = useCallback((slot: TmwSlotType) => {
    setNotice(null);
    setPickedUp((current) => (current === slot ? null : slot));
  }, []);

  const dropOn = useCallback(
    (slot: TmwSlotType) => {
      if (!yourRoster || pickedUp === null) return;
      if (slot === pickedUp) {
        setPickedUp(null);
        return;
      }
      const rejection = moveRejection(yourRoster, pickedUp, slot);
      if (rejection) {
        // IMMEDIATE AND SPECIFIC — a drag that simply snaps back teaches
        // nothing; this names the player and the rule that stopped it.
        setNotice({ tone: "error", text: rejection });
        return;
      }
      const moving = yourRoster.slots[pickedUp];
      const displaced = yourRoster.slots[slot];
      onMove?.(placementsAfterMove(yourRoster, pickedUp, slot));
      setNotice({
        tone: "done",
        text: displaced
          ? `${moving?.player_name} and ${displaced.player_name} swapped.`
          : `${moving?.player_name} moved.`,
      });
      setPickedUp(null);
    },
    [yourRoster, pickedUp, onMove],
  );

  const legalTargets = canRearrange && pickedUp ? legalMoveTargets(yourRoster, pickedUp) : [];

  // Pass 7 (human acceptance testing, task §11): "who is picking, how much
  // time is left, what was rolled, what pick/round are we on" must all read
  // in under a second from ONE always-visible strip. Every value here is
  // already-computed real state (`state.current_roll`, the same server
  // field `PickOverlay`'s own header reads; `currentTurnSeatIndex`/`seats`,
  // the same identity `PeakV2TMWCourt`'s "On the clock" suffix already
  // uses) — nothing invented.
  const onClockSeat = state.rosters.find((r) => r.seat_index === currentTurnSeatIndex);
  const onClockName = state.is_complete
    ? null
    : currentTurnSeatIndex === yourSeatIndex
      ? "You"
      : (seats.find((s) => s.seat_index === currentTurnSeatIndex)?.display_name ??
        (onClockSeat ? `Seat ${currentTurnSeatIndex! + 1}` : null));
  const rollLine = state.current_roll
    ? `${state.current_roll.franchise_display_name} · ${state.current_roll.decade}`
    : null;

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

        {/* ONE truthful line: what was rolled, and who is picking right now.
            Stays in this exact spot across every phase -- never jumps. */}
        {rollLine || onClockName ? (
          <p
            className="mt-2 flex flex-wrap items-center gap-x-2"
            style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem" }}
          >
            {rollLine ? <span style={{ color: "var(--v2-text-secondary)" }}>{rollLine}</span> : null}
            {onClockName ? (
              <span style={{ fontWeight: 700, color: "var(--v2-color-accent)" }}>
                On the clock — {onClockName}
              </span>
            ) : null}
          </p>
        ) : null}

        {/* THE RESULT OF A MOVE, SAID ONCE — `role="status"` rather than an
            alert, since a refused drag is a correction, not an emergency. */}
        {notice ? (
          <p
            role="status"
            aria-live="polite"
            className="mt-2"
            style={{
              fontFamily: "var(--v2-font-ui)",
              fontSize: "0.75rem",
              fontWeight: 600,
              color: notice.tone === "error" ? "var(--v2-color-negative)" : "var(--v2-color-positive)",
            }}
          >
            {notice.text}
          </p>
        ) : null}

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
                data-testid={`tmw-roster-tab-${roster.seat_index}`}
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
                interactive={canRearrange && roster.seat_index === yourSeatIndex && !busy}
                pickedUpSlot={roster.seat_index === yourSeatIndex ? pickedUp : null}
                legalTargets={roster.seat_index === yourSeatIndex ? legalTargets : []}
                onPickUp={roster.seat_index === yourSeatIndex ? pickUp : undefined}
                onDropOn={roster.seat_index === yourSeatIndex ? dropOn : undefined}
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
              interactive={canRearrange && roster.seat_index === yourSeatIndex && !busy}
              pickedUpSlot={roster.seat_index === yourSeatIndex ? pickedUp : null}
              legalTargets={roster.seat_index === yourSeatIndex ? legalTargets : []}
              onPickUp={roster.seat_index === yourSeatIndex ? pickUp : undefined}
              onDropOn={roster.seat_index === yourSeatIndex ? dropOn : undefined}
            />
          ))}
        </div>

        {children}
      </div>
    </PeakV2Shell>
  );
}
