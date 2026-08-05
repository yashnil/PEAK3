"use client";
import { useEffect, useState } from "react";
import type {
  ArenaSeatPublic,
  TmwPublicState,
  TmwSlotType,
} from "@/types/three-man-weave";
import { edgeBandFor, edgeQualifier } from "@/lib/three-man-weave-state";
import SeatCourt from "./SeatCourt";

/**
 * All three rosters, as the persistent centre of the game.
 *
 * DESKTOP: three courts side by side, always, at every phase including while
 * the pick overlay is open. The overlay sits ABOVE this board rather than
 * replacing it, because "what do my opponents still need" is the question a
 * draft pick is an answer to, and a surface that hides the other two rosters at
 * the exact moment you are choosing has hidden the game.
 *
 * MOBILE: tabs, not three crushed columns. Three courts abreast at 390px gives
 * each one about 120px, which renders the position labels and drops the names,
 * so the panel that was meant to be the centre of the screen becomes
 * unreadable. Tabs keep one roster legible and every roster ONE ACTION away,
 * and the tab strip itself carries each seat's count and edge band so the
 * hidden two are still summarised rather than simply gone.
 *
 * THE ACTIVE TAB FOLLOWS THE CLOCK, and stops following it the moment the
 * player touches a tab. Auto-switching is right until it fights someone: a
 * player who deliberately opened their opponent's roster to plan a pick should
 * not have it yanked away when the next seat's turn opens.
 */
export default function RosterBoard({
  state,
  seats,
  yourSeatIndex,
  currentTurnSeatIndex,
  justPickedSlug,
  secondsRemaining,
  onMoveRequest,
}: {
  state: TmwPublicState;
  seats: ArenaSeatPublic[];
  yourSeatIndex: number | null;
  currentTurnSeatIndex: number | null;
  justPickedSlug?: string | null;
  secondsRemaining: number | null;
  onMoveRequest?: (slot: TmwSlotType) => void;
}) {
  const [tab, setTab] = useState<number>(yourSeatIndex ?? 0);
  const [pinned, setPinned] = useState(false);
  const qualifier = edgeQualifier(state);

  useEffect(() => {
    if (pinned || currentTurnSeatIndex === null) return;
    setTab(currentTurnSeatIndex);
  }, [currentTurnSeatIndex, pinned]);

  function courtFor(seatIndex: number) {
    const roster = state.rosters.find((entry) => entry.seat_index === seatIndex);
    if (!roster) return null;
    const isYou = seatIndex === yourSeatIndex;
    return (
      <SeatCourt
        key={seatIndex}
        roster={roster}
        seat={seats.find((seat) => seat.seat_index === seatIndex)}
        isYou={isYou}
        isOnTurn={!state.is_complete && currentTurnSeatIndex === seatIndex}
        justPickedSlug={justPickedSlug}
        edge={edgeBandFor(state, seatIndex)}
        secondsRemaining={
          currentTurnSeatIndex === seatIndex ? secondsRemaining : null
        }
        onMoveRequest={isYou ? onMoveRequest : undefined}
      />
    );
  }

  return (
    <section
      className="tmw-board"
      data-testid="tmw-courts"
      aria-label="All three rosters"
    >
      {qualifier && (
        <p className="tmw-board-qualifier" data-testid="tmw-edge-qualifier">
          {qualifier}. Positions are provisional until every roster is full.
        </p>
      )}

      {/* Desktop: every roster rendered, no tab state involved. */}
      <div className="tmw-board-grid">
        {state.rosters.map((roster) => courtFor(roster.seat_index))}
      </div>

      {/* Mobile: the same courts, one at a time, every one a tap away. */}
      <div className="tmw-board-tabs">
        <div role="tablist" aria-label="Rosters" className="tmw-tablist">
          {state.rosters.map((roster) => {
            const seat = seats.find((s) => s.seat_index === roster.seat_index);
            const filled = Object.values(roster.slots).filter(Boolean).length;
            const band = edgeBandFor(state, roster.seat_index);
            return (
              <button
                key={roster.seat_index}
                type="button"
                role="tab"
                id={`tmw-tab-${roster.seat_index}`}
                aria-selected={tab === roster.seat_index}
                aria-controls={`tmw-tabpanel-${roster.seat_index}`}
                data-testid={`tmw-roster-tab-${roster.seat_index}`}
                data-on-turn={currentTurnSeatIndex === roster.seat_index}
                className="tmw-tab"
                onClick={() => {
                  setTab(roster.seat_index);
                  setPinned(true);
                }}
              >
                <span className="tmw-tab-name">
                  {seat?.display_name ?? `Seat ${roster.seat_index + 1}`}
                  {roster.seat_index === yourSeatIndex ? " · You" : ""}
                </span>
                <span className="tmw-tab-meta">
                  {filled}/6{band ? ` · ${band === "leading" ? "Leading" : band === "close_behind" ? "Close" : band === "needs_a_response" ? "Behind" : "Level"}` : ""}
                </span>
              </button>
            );
          })}
        </div>
        {state.rosters.map((roster) => (
          <div
            key={roster.seat_index}
            role="tabpanel"
            id={`tmw-tabpanel-${roster.seat_index}`}
            aria-labelledby={`tmw-tab-${roster.seat_index}`}
            hidden={tab !== roster.seat_index}
          >
            {tab === roster.seat_index ? courtFor(roster.seat_index) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
