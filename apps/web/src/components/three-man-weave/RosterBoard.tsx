"use client";
import { useCallback, useEffect, useState } from "react";
import type { ArenaSeatPublic, TmwPublicState, TmwSlotType } from "@/types/three-man-weave";
import {
  edgeBandFor,
  edgeQualifier,
  legalMoveTargets,
  moveRejection,
  placementsAfterMove,
  seatAccent,
  slotLabel,
} from "@/lib/three-man-weave-state";
import SeatCourt from "./SeatCourt";

/**
 * ALL THREE ROSTERS, as the persistent centre of the game.
 *
 * DESKTOP: three teams side by side, always, at every phase including while the
 * pick overlay is open. The overlay sits ABOVE this board rather than replacing
 * it, because "what do my opponents still need" is the question a draft pick is
 * an answer to. The width is constrained by `.tmw-board-grid` so three teams
 * read as three teams and not as an ultra-wide spreadsheet (TMW-09).
 *
 * MOBILE: tabs, not three crushed columns. Three courts abreast at 390px gives
 * each about 120px, which renders the position labels and drops the names. Tabs
 * keep one team legible and every team ONE ACTION away, with the active seat
 * brought forward and each tab carrying its own count and edge band so the
 * hidden two are summarised rather than simply gone.
 *
 * THE ACTIVE TAB FOLLOWS THE CLOCK, and stops following it the moment the
 * player touches a tab: someone who deliberately opened an opponent's roster to
 * plan a pick should not have it yanked away when the next turn opens.
 *
 * REARRANGEMENT LIVES HERE (TMW-10)
 * ---------------------------------
 * Managing your own roster used to be possible only inside the draft modal --
 * that is, only during your own turn, only while a clock ran. This board owns
 * the interaction between turns as well:
 *
 *   * drag a card onto another slot, starter to starter or starter to bench;
 *   * or select a card and click a highlighted destination (tap-friendly);
 *   * or do exactly the same from the keyboard, since every slot is a button;
 *   * Escape cancels a selection;
 *   * dropping onto an occupied slot SWAPS, and only when the whole resulting
 *     assignment is legal for both players;
 *   * an illegal drop is refused immediately, by name and by rule.
 *
 * `tmw_rearrange` does not consume a turn, so this is safe at any point in the
 * match, and the arrangement is server state -- a refresh or a reconnect
 * restores it because it was never client state to begin with.
 */
export default function RosterBoard({
  state,
  seats,
  yourSeatIndex,
  currentTurnSeatIndex,
  justPickedSlug,
  onMove,
  busy = false,
}: {
  state: TmwPublicState;
  seats: ArenaSeatPublic[];
  yourSeatIndex: number | null;
  currentTurnSeatIndex: number | null;
  justPickedSlug?: string | null;
  /** Commit a COMPLETE final assignment. Absent in a finished match. */
  onMove?: (placements: Record<string, string>) => void;
  busy?: boolean;
}) {
  const [tab, setTab] = useState<number>(yourSeatIndex ?? 0);
  const [pinned, setPinned] = useState(false);
  const [pickedUp, setPickedUp] = useState<TmwSlotType | null>(null);
  const [notice, setNotice] = useState<{ tone: "error" | "done"; text: string } | null>(
    null,
  );
  const qualifier = edgeQualifier(state);

  const yourRoster =
    yourSeatIndex === null
      ? null
      : (state.rosters.find((entry) => entry.seat_index === yourSeatIndex) ?? null);
  const canRearrange = !!onMove && !!yourRoster && !state.is_complete;

  useEffect(() => {
    if (pinned || currentTurnSeatIndex === null) return;
    setTab(currentTurnSeatIndex);
  }, [currentTurnSeatIndex, pinned]);

  // ESCAPE CANCELS, everywhere, which is the accessible half of "drop it".
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
        // IMMEDIATE AND SPECIFIC. A drag that simply snaps back teaches
        // nothing; this names the player and the rule that stopped the move.
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
          : `${moving?.player_name} moved to ${slotLabel(slot).toLowerCase()}.`,
      });
      setPickedUp(null);
    },
    [yourRoster, pickedUp, onMove],
  );

  const legalTargets =
    canRearrange && pickedUp ? legalMoveTargets(yourRoster, pickedUp) : [];

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
        interactive={isYou && canRearrange}
        selectedSlot={isYou ? pickedUp : null}
        legalTargets={isYou ? legalTargets : []}
        busy={busy}
        onPickUp={isYou ? pickUp : undefined}
        onDropOn={isYou ? dropOn : undefined}
      />
    );
  }

  return (
    <section className="tmw-board" data-testid="tmw-courts" aria-label="All three rosters">
      {qualifier && (
        <p className="tmw-board-qualifier" data-testid="tmw-edge-qualifier">
          {qualifier}. Positions are provisional until every roster is full.
        </p>
      )}

      {/* THE RESULT OF A MOVE, SAID ONCE. `role="status"` rather than an alert:
          a refused drag is a correction, not an emergency, and an assertive
          region would cut across the turn announcement. */}
      <p
        className="tmw-board-notice"
        data-testid="tmw-move-notice"
        data-tone={notice?.tone ?? "none"}
        role="status"
        aria-live="polite"
        hidden={!notice}
      >
        {notice?.text ?? ""}
      </p>

      {/* Desktop: every roster rendered, no tab state involved. */}
      <div className="tmw-board-grid">
        {state.rosters.map((roster) => courtFor(roster.seat_index))}
      </div>

      {/* Mobile: the same teams, one at a time, every one a tap away. */}
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
                data-is-you={roster.seat_index === yourSeatIndex ? "true" : "false"}
                data-seat-accent={seatAccent(roster.seat_index)}
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
                <span className="tmw-tab-meta pk-numeral">
                  {filled}/6
                  {band
                    ? ` · ${
                        band === "leading"
                          ? "Leading"
                          : band === "close_behind"
                            ? "Close"
                            : band === "needs_a_response"
                              ? "Behind"
                              : "Level"
                      }`
                    : ""}
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
