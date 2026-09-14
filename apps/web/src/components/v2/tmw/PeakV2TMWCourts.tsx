"use client";

/**
 * PeakV2TMWCourts — the draft room's board: the turn strip, the decision
 * surface when it is yours, and the three courts.
 *
 * ONE SCROLL, AND IT IS THE PAGE'S (game-feel pass 5).
 *
 * This used to be a flex column capped to a `--tmw-viewport-cap` the room
 * measured and published, with a pinned header and an inner `overflow-y:
 * auto` region holding the courts -- and the pick surface was a fixed modal
 * with two more scroll panes inside it. Three scrollbars on one screen is an
 * app embedded in another app, and the cap existed only to keep the header on
 * screen. `position: sticky` does that job without owning any scrolling, so
 * the cap, the measured header height and the inner region (plus the
 * `tabIndex`/`role="region"` axe needed for a scrollable box) are gone. The
 * page scrolls; nothing inside it does.
 *
 * WHAT THE STRIP SAYS, IN ORDER OF WHAT A DRAFTER NEEDS:
 *   1. the constraint -- franchise × decade, the largest type on the strip,
 *      under the round/pick counter it applies to;
 *   2. the turn -- whose pick it is, beside the clock running on it;
 * and it stays under the site header while the candidate list or the courts
 * scroll beneath it, on an opaque ground so nothing shows through.
 *
 * The strip publishes its own rendered height as `--tmw-strip-h` on the board
 * so anything that sticks BELOW it (the placement column) sits flush, whether
 * or not a move notice or an edge qualifier has added a line. Written to the
 * DOM directly by a `ResizeObserver`: it is a layout fact, not React state,
 * and re-rendering the board to learn it would be the wrong trade.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import PeakV2Shell from "../PeakV2Shell";
import PeakV2GameStatus from "../PeakV2GameStatus";
import PeakV2Timer from "../PeakV2Timer";
import PeakV2TMWCourt from "./PeakV2TMWCourt";
import { useRemainingSeconds } from "@/components/shared/ArenaTimer";
import { ActiveSeat, type ActiveSeatOwner } from "@/components/game-feel";
import { TMW_TURN_SECONDS } from "@/types/three-man-weave";
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
  deadlineAt: number | null;
  /** The OPEN TURN's clock, published by the server to every seat (see
   *  `ThreeManWeaveGame`'s own note). This is what the strip counts down,
   *  so all three competitors watch the same number — `deadlineAt` above is
   *  only "your" clock and is null on somebody else's turn. */
  turnDeadlineAt?: number | null;
  /** The open turn's full length in seconds -- the denominator every seat's
   *  clock bar depletes against. Falls back to the mode's decision window. */
  turnTotalSeconds?: number | null;
  /**
   * Whether the round's roll has actually been REVEALED yet.
   *
   * The server knows the franchise and decade before the ceremony starts —
   * it has to, the reel spins to them — but knowing is not showing. The strip
   * must not print "Detroit Pistons × 2000s" behind a ceremony that is still
   * animating toward it (design-review/13).
   *
   * Defaults to `true` so a caller that has no ceremony (a finished match,
   * a spectator view) still shows the roll.
   */
  rollRevealed?: boolean;
  picksMade: number;
  totalPicks: number;
  /** The decision surface (the pick panel), placed directly under the strip
   *  and above the courts: while it is your pick it is the task, and the
   *  courts are context. Renders nothing when the caller's node does. */
  decision?: ReactNode;
  /** The decision surface is OPEN: it floats over the courts, which dim and
   *  step back beneath it (game-feel pass 5). */
  decisionOpen?: boolean;
  children?: React.ReactNode;
  /**
   * Between-turn rearrangement (Pass 4, TMW-10 ported to V2 — see
   * `RosterBoard.tsx`'s docstring for the full rule set this ports:
   * drag/click-to-select a card, click a highlighted destination, Escape
   * cancels, an occupied destination swaps, and only when the whole
   * resulting assignment is legal for both slots). Commits a COMPLETE
   * final assignment; absent in a finished match. Never consumes a turn.
   */
  onMove?: (placements: Record<string, string>) => Promise<boolean> | void;
  busy?: boolean;
  /**
   * Slots on the VIEWER'S OWN court whose contents are a press this client
   * has made and the server has not answered yet (see `StagedArrangement` in
   * `ThreeManWeaveGame`). Drawn as a quiet pending treatment -- the card is
   * where the player put it, and it says so rather than blocking the board.
   */
  pendingSlots?: readonly TmwSlotType[];
}

export default function PeakV2TMWCourts({
  state,
  seats,
  yourSeatIndex,
  currentTurnSeatIndex,
  deadlineAt,
  turnDeadlineAt = null,
  turnTotalSeconds = null,
  rollRevealed = true,
  picksMade,
  totalPicks,
  decision,
  decisionOpen = false,
  children,
  onMove,
  busy = false,
  pendingSlots = [],
}: PeakV2TMWCourtsProps) {
  // The match clock when the server publishes one, falling back to the
  // viewer's own only if an older API build does not send it.
  const remaining = useRemainingSeconds(turnDeadlineAt ?? deadlineAt);
  const qualifier = edgeQualifier(state);

  // THE STRIP'S HEIGHT, AS A CSS FACT (see the module docstring).
  const boardRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const board = boardRef.current;
    const strip = stripRef.current;
    if (!board || !strip) return;
    const publish = (height: number) => board.style.setProperty("--tmw-strip-h", `${Math.round(height)}px`);
    publish(strip.getBoundingClientRect().height);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => publish(strip.getBoundingClientRect().height));
    observer.observe(strip);
    return () => observer.disconnect();
  }, []);

  // Mobile-only: "deliberate access between YOUR COURT / OTHER COURTS"
  // (brief) rather than three courts crushed into one column. Desktop
  // ignores this entirely and shows the real three-column grid.
  const [mobileSeat, setMobileSeat] = useState<number>(yourSeatIndex ?? state.rosters[0]?.seat_index ?? 0);

  const yourRoster = yourSeatIndex === null ? null : (state.rosters.find((r) => r.seat_index === yourSeatIndex) ?? null);
  const canRearrange = !!onMove && !!yourRoster && !state.is_complete;
  const [pickedUp, setPickedUp] = useState<TmwSlotType | null>(null);
  const [notice, setNotice] = useState<{ tone: "error"; text: string } | null>(null);

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
      // THE MOVE'S RESULT IS ANNOUNCED BY THE SNAPSHOT THAT CONTAINS IT. The
      // room derives the swap moment from the response itself
      // (`describeTransition`), in the same render as the rosters.
      void onMove?.(placementsAfterMove(yourRoster, pickedUp, slot));
      setPickedUp(null);
    },
    [yourRoster, pickedUp, onMove],
  );

  const legalTargets = canRearrange && pickedUp ? legalMoveTargets(yourRoster, pickedUp) : [];

  // ONE CLOCK FOR EVERY SEAT. The active court renders the same depleting
  // `TurnClock` whether the seat is the viewer, a rival or a bot -- the
  // server publishes the open turn's deadline and length to everybody.
  const clockDeadline = turnDeadlineAt ?? deadlineAt;
  const clockTotal = turnTotalSeconds ?? TMW_TURN_SECONDS;
  const ownerOf = (seatIndex: number): ActiveSeatOwner => {
    if (state.is_complete || currentTurnSeatIndex !== seatIndex) return "none";
    if (seatIndex === yourSeatIndex) return "you";
    return seats.find((s) => s.seat_index === seatIndex)?.is_bot ? "bot" : "rival";
  };
  const seatStateOf = (seatIndex: number): "active" | "receded" | "idle" => {
    if (state.is_complete || currentTurnSeatIndex === null) return "idle";
    return currentTurnSeatIndex === seatIndex ? "active" : "receded";
  };
  const stripOwner: ActiveSeatOwner = currentTurnSeatIndex === null ? "none" : ownerOf(currentTurnSeatIndex);

  // Who is on the clock, from real state only: `currentTurnSeatIndex` and the
  // seat's own display name, the same identity every court header uses.
  const onClockSeat = state.rosters.find((r) => r.seat_index === currentTurnSeatIndex);
  const onClockName = state.is_complete
    ? null
    : currentTurnSeatIndex === yourSeatIndex
      ? "You"
      : (seats.find((s) => s.seat_index === currentTurnSeatIndex)?.display_name ??
        (onClockSeat ? `Seat ${currentTurnSeatIndex! + 1}` : null));
  const roll = state.current_roll && rollRevealed ? state.current_roll : null;
  // A Franchise or Decade Draft's one constraint, for the whole draft.
  const constraint = state.constraint ?? null;

  // THE EDGE BAND ONLY EARNS ITS LINE WHEN IT DIFFERENTIATES.
  //
  // `edgeBandFor` is real server data — a seat's competitive standing band —
  // but for most of a draft every seat is in the SAME band, and three courts
  // each captioned "Level with the field" is one fact stated three times
  // that distinguishes nobody (design-review/14, /15). It is suppressed
  // while the bands agree and appears the moment they diverge.
  const seatBands = state.rosters.map((r) => edgeBandFor(state, r.seat_index));
  const distinctBands = new Set(seatBands.filter(Boolean));
  const bandsDiffer = distinctBands.size > 1;

  return (
    <div ref={boardRef} className="tmw-board">
      {/* THE STRIP: constraint first, turn second. Sticky under the site
          header, opaque, full-bleed so the courts scroll cleanly beneath. */}
      <div ref={stripRef} className="tmw-strip" data-testid="tmw-turnbar" data-turn-owner={stripOwner}>
        <PeakV2Shell width="live-wide">
          <div className="tmw-strip-row">
            <div className="tmw-strip-round">
              <PeakV2GameStatus
                label={`Round ${state.current_round ?? "—"} of ${state.total_rounds} · pick ${picksMade + 1} of ${totalPicks}`}
                state="active"
                labelTestId="tmw-turnbar-round"
              />
            </div>

            {/* WHAT WAS ROLLED — only once the ceremony has shown it. A
                Franchise or Decade Draft names its ONE constraint for the
                whole draft instead of a per-round pair (the per-round roll's
                other half is a placeholder: "All decades"). */}
            <p className="tmw-strip-roll" data-testid="tmw-turnbar-roll" data-revealed={roll ? "true" : "false"}>
              {roll && constraint ? (
                <>
                  <span className="tmw-strip-scope">
                    {constraint.kind === "franchise" ? "Franchise Draft" : "Decade Draft"}
                  </span>
                  <span className={constraint.kind === "franchise" ? "tmw-strip-franchise" : "tmw-strip-decade"}>
                    {constraint.label}
                  </span>
                  <span className="tmw-strip-scope-note">· all {totalPicks} picks</span>
                </>
              ) : roll ? (
                <>
                  <span className="tmw-strip-franchise">{roll.franchise_display_name}</span>
                  <span className="tmw-strip-x" aria-hidden="true">
                    ×
                  </span>
                  <span className="sr-only"> in the </span>
                  <span className="tmw-strip-decade">{roll.decade}</span>
                </>
              ) : (
                <span className="tmw-strip-pending">
                  {state.is_complete ? "Draft complete" : "Rolling the next franchise and decade"}
                </span>
              )}
            </p>

            {qualifier ? <p className="tmw-strip-qualifier">{qualifier}</p> : null}

            {/* WHOSE PICK, beside the clock running on it. */}
            <div className="tmw-strip-owner">
              {onClockName ? (
                <span className="tmw-on-clock" data-testid="tmw-on-the-clock">
                  {onClockName === "You" ? "Your pick" : `On the clock · ${onClockName}`}
                </span>
              ) : null}
            </div>

            {/* Gated on a seat actually being on the clock, not merely on a
                deadline existing: during the seatless intro/reveal turns the
                server publishes the viewer's own ~30-minute intro backstop,
                which would otherwise render as a literal four-digit number.
                RESERVED WHEN HIDDEN, so the strip's wrap point -- and its
                height -- is the same on either side of a turn opening. */}
            <div className="tmw-strip-clock">
              {remaining !== null && currentTurnSeatIndex !== null ? (
                <PeakV2Timer secondsRemaining={remaining} urgentAtSeconds={5} />
              ) : (
                <span className="tmw-strip-clock-reserve" aria-hidden="true">
                  88
                </span>
              )}
            </div>
          </div>

          {/* THE RESULT OF A MOVE, SAID ONCE — `role="status"` rather than an
              alert, since a refused drag is a correction, not an emergency. */}
          {notice ? (
            <p role="status" aria-live="polite" className="tmw-strip-notice">
              {notice.text}
            </p>
          ) : null}
        </PeakV2Shell>
      </div>

      <PeakV2Shell width="live-wide">
        {/* Mobile tab bar — one court at a time, every one a tap away. */}
        <div className="tmw-roster-tabs mt-4 flex gap-1 lg:hidden" role="tablist" aria-label="Rosters">
          {state.rosters.map((roster) => {
            const isYou = roster.seat_index === yourSeatIndex;
            const seat = seats.find((s) => s.seat_index === roster.seat_index);
            const filled = Object.values(roster.slots).filter(Boolean).length;
            const selected = mobileSeat === roster.seat_index;
            return (
              <button
                key={roster.seat_index}
                type="button"
                role="tab"
                data-testid={`tmw-roster-tab-${roster.seat_index}`}
                aria-selected={selected}
                onClick={() => setMobileSeat(roster.seat_index)}
                className="flex-1 rounded-t px-2 py-2 text-left"
                style={{
                  borderBottom: `2px solid ${selected ? "var(--v2-color-accent)" : "var(--v2-border-subtle)"}`,
                }}
              >
                {/* No whole-element opacity on an unselected tab: dimming the
                    element also dims its small text below AA. The selected
                    tab is marked by its rule and its primary ink instead. */}
                <span
                  style={{
                    fontFamily: "var(--v2-font-ui)",
                    fontWeight: 700,
                    fontSize: "0.75rem",
                    color: selected ? "var(--v2-text-primary)" : "var(--v2-text-secondary)",
                  }}
                >
                  {isYou ? "You" : (seat?.display_name ?? `Seat ${roster.seat_index + 1}`)}
                </span>
                <span className="block" style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.625rem", color: "var(--v2-text-secondary)" }}>
                  {filled}/6
                </span>
              </button>
            );
          })}
        </div>

        {/* `tmw-courts`: one container for both responsive renderings below.
            DESKTOP FIRST, MOBILE SECOND in source order — CSS (`lg:hidden` /
            `hidden lg:grid`) decides which is actually painted, so the order
            has no visual effect. It does decide which element a
            `data-testid="tmw-seat-court-N"` query resolves to when both are
            mounted for the seat shown on mobile: `.first()` lands on the
            always-present desktop instance, `.last()` on the mobile one. */}
        {/* THE STAGE: the courts, with the pick surface layered OVER them
            (game-feel pass 5). Pass 4 moved the surface into the flow ABOVE
            the courts to end a fixed modal with two nested scroll panes; that
            fixed the scrolling but made choosing a player read as a form
            detached from the board. The two now share one grid cell: the
            surface is a bubble over the teams, the courts dim and stop taking
            presses beneath it, and the page -- not a pane -- still scrolls a
            long pool. Nothing here waits on the server: a press lands on the
            court the frame it is made (the room's staged arrangement). */}
        <div className="tmw-stage" data-testid="tmw-stage" data-decision-open={decisionOpen ? "true" : "false"}>
        {decision ? <div className="tmw-decision">{decision}</div> : null}
        {/* INERT beneath an open pick surface: the courts dim and stop taking
            pointer presses in CSS, and `inert` takes them out of the tab order
            and the accessibility tree too, so focus can never land on a
            control the surface is covering. */}
        <div
          data-testid="tmw-courts"
          aria-label="All three rosters"
          className="tmw-courts"
          inert={decisionOpen || undefined}
        >
          {/* Desktop: the real three-column grid, always. */}
          <div className="mt-4 hidden gap-4 lg:grid lg:grid-cols-3">
            {state.rosters.map((roster) => {
              // The PRIMARY highlight is whoever is actually on the clock,
              // never "whichever court belongs to you". When no seat is on the
              // clock (a seatless reveal turn), nothing is lit.
              const isOnTurn = !state.is_complete && currentTurnSeatIndex === roster.seat_index;
              return (
                <ActiveSeat
                  key={roster.seat_index}
                  state={seatStateOf(roster.seat_index)}
                  owner={ownerOf(roster.seat_index)}
                  complete={roster.complete}
                >
                  <PeakV2TMWCourt
                    roster={roster}
                    seat={seats.find((s) => s.seat_index === roster.seat_index)}
                    isYou={roster.seat_index === yourSeatIndex}
                    isOnTurn={isOnTurn}
                    edge={bandsDiffer ? edgeBandFor(state, roster.seat_index) : null}
                    lit={isOnTurn}
                    clock={isOnTurn ? { deadlineAt: clockDeadline, totalSeconds: clockTotal } : null}
                    interactive={canRearrange && roster.seat_index === yourSeatIndex && !busy}
                    rearrangeEligible={canRearrange && roster.seat_index === yourSeatIndex}
                    pendingSlots={roster.seat_index === yourSeatIndex ? pendingSlots : []}
                    pickedUpSlot={roster.seat_index === yourSeatIndex ? pickedUp : null}
                    legalTargets={roster.seat_index === yourSeatIndex ? legalTargets : []}
                    onPickUp={roster.seat_index === yourSeatIndex ? pickUp : undefined}
                    onDropOn={roster.seat_index === yourSeatIndex ? dropOn : undefined}
                  />
                </ActiveSeat>
              );
            })}
          </div>

          <div className="mt-2 lg:hidden">
            {state.rosters
              .filter((roster) => roster.seat_index === mobileSeat)
              .map((roster) => {
                const isOnTurn = !state.is_complete && currentTurnSeatIndex === roster.seat_index;
                return (
                  <ActiveSeat
                    key={roster.seat_index}
                    state={seatStateOf(roster.seat_index)}
                    owner={ownerOf(roster.seat_index)}
                    complete={roster.complete}
                  >
                    <PeakV2TMWCourt
                      roster={roster}
                      seat={seats.find((s) => s.seat_index === roster.seat_index)}
                      isYou={roster.seat_index === yourSeatIndex}
                      isOnTurn={isOnTurn}
                      edge={bandsDiffer ? edgeBandFor(state, roster.seat_index) : null}
                      lit
                      clock={isOnTurn ? { deadlineAt: clockDeadline, totalSeconds: clockTotal } : null}
                      interactive={canRearrange && roster.seat_index === yourSeatIndex && !busy}
                      rearrangeEligible={canRearrange && roster.seat_index === yourSeatIndex}
                      pendingSlots={roster.seat_index === yourSeatIndex ? pendingSlots : []}
                      pickedUpSlot={roster.seat_index === yourSeatIndex ? pickedUp : null}
                      legalTargets={roster.seat_index === yourSeatIndex ? legalTargets : []}
                      onPickUp={roster.seat_index === yourSeatIndex ? pickUp : undefined}
                      onDropOn={roster.seat_index === yourSeatIndex ? dropOn : undefined}
                    />
                  </ActiveSeat>
                );
              })}
          </div>
        </div>
        </div>

        {children}
      </PeakV2Shell>
    </div>
  );
}
