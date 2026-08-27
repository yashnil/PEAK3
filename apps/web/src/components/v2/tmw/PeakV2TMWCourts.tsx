"use client";

/**
 * PeakV2TMWCourts — the shared instrument strip + three courts (Pass 3),
 * verified against the reference (E2 page 20): active court fully lit,
 * siblings dimmed but legible, real round/pick/pool/clock instrumentation.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
  deadlineAt: number | null;
  /** The OPEN TURN's clock, published by the server to every seat (see
   *  `ThreeManWeaveGame`'s own note). This is what the header counts down,
   *  so all three competitors watch the same number — `deadlineAt` above is
   *  only "your" clock and is null on somebody else's turn. */
  turnDeadlineAt?: number | null;
  /**
   * Whether the round's roll has actually been REVEALED yet.
   *
   * The server knows the franchise and decade before the ceremony starts —
   * it has to, the reel spins to them — but knowing is not showing. This
   * board used to print "Detroit Pistons · 2000s" the moment
   * `state.current_roll` existed, which meant the round-one roll was
   * legible on the page BEHIND the intro overlay before anything had spun
   * (design-review/13). The spinner was then animating toward a conclusion
   * already printed underneath it.
   *
   * Defaults to `true` so a caller that has no ceremony (a finished match,
   * a spectator view) still shows the roll.
   */
  rollRevealed?: boolean;
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
  deadlineAt,
  turnDeadlineAt = null,
  rollRevealed = true,
  picksMade,
  totalPicks,
  children,
  onMove,
  busy = false,
}: PeakV2TMWCourtsProps) {
  // The match clock when the server publishes one, falling back to the
  // viewer's own only if an older API build does not send it.
  const remaining = useRemainingSeconds(turnDeadlineAt ?? deadlineAt);
  const qualifier = edgeQualifier(state);
  // TMW viewport containment: the header block (title/status/instrument,
  // the roll+on-clock line, the move notice, the mobile roster tabs) stays
  // pinned and never scrolls out of reach; only the court content below it
  // scrolls, capped to whatever's left of `--tmw-viewport-cap` (set by the
  // ancestor `tmw-v2-arena-shell` in `ThreeManWeaveGame.tsx`) once the
  // header's own real height is subtracted. `ResizeObserver`, not a one-time
  // measurement, because the header's height can legitimately change (a
  // move notice appearing/disappearing) and the scroll cap must track it.
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    // Measured synchronously here (not left to wait for the observer's
    // first, inherently-async callback) so the scroll cap below is correct
    // from the very first paint, rather than briefly using the full,
    // uncapped-by-header value for one frame.
    setHeaderHeight(el.getBoundingClientRect().height);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeaderHeight(entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
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
  const rollLine =
    state.current_roll && rollRevealed
      ? `${state.current_roll.franchise_display_name} · ${state.current_roll.decade}`
      : null;
  // Final closure pass, task §1: reserved so the "On the clock" span's own
  // presence/absence can never change whether this row wraps to a second
  // line at narrow widths -- a real, measured outer-shell height change at
  // 390px between the seatless reveal window (`onClockName === null`) and
  // the instant a real turn starts. `state.current_seat` is the server's own
  // "who gets the pick turn next" field, valid during the seatless reveal
  // too (see `ThreeManWeaveGame.tsx`'s `upNextSeat`, which reads the exact
  // same field for its handoff line) -- so the reserved text is the SAME
  // real name that will display once the turn actually starts, not a
  // guessed placeholder of a different length, which is what makes the
  // reservation exact rather than approximate.
  const upcomingSeatIndex = currentTurnSeatIndex ?? state.current_seat;
  const reservedOnClockName =
    upcomingSeatIndex === null
      ? ""
      : upcomingSeatIndex === yourSeatIndex
        ? "You"
        : (seats.find((s) => s.seat_index === upcomingSeatIndex)?.display_name ?? `Seat ${upcomingSeatIndex + 1}`);

  return (
    <PeakV2Shell width="live-wide">
      {/* TMW viewport containment (final closure pass): this outer block is
          a flex column capped to whatever the ancestor published as
          `--tmw-viewport-cap` -- the real remaining space below the nav (and
          anything else already above this component), reserved up front
          rather than left to natural content flow, which was what pushed the
          bottom of the active task surface below the viewport at 1280x800
          and 390x844. `100dvh` in that ancestor calc already accounts for a
          mobile browser's address bar; the `100dvh` fallback here is only
          for the first paint before the ancestor's effect has run. Falls
          back to natural (uncapped) height wherever the real content is
          already shorter than the cap (1440x900's existing presentation),
          so nothing changes there. */}
      <div className="py-6 flex flex-col" style={{ maxHeight: "var(--tmw-viewport-cap, 100dvh)" }}>
        <div ref={headerRef} className="shrink-0" data-testid="tmw-turnbar">
        <PeakV2LiveHeader
          as="h1"
          title="Three-Man Weave"
          subtitle={qualifier ?? undefined}
          status={<PeakV2GameStatus label={`Round ${state.current_round ?? "—"} of ${state.total_rounds} · pick ${picksMade + 1} of ${totalPicks}`} state="active" labelTestId="tmw-turnbar-round" />}
          instrument={
            <div className="flex items-center gap-4">
              {/* WHO IS ON THE CLOCK, not how many players are left.
                  "N undrafted" was the most prominent instrument in this
                  strip and it is a number nobody plays on — the pool is
                  hundreds deep and shrinking it by one per pick changes no
                  decision. It is replaced by the one fact this row was
                  missing: whose pick it is, beside the countdown for it.
                  Not replaced by another metric. */}
              {onClockName ? (
                <span
                  data-testid="tmw-on-the-clock"
                  style={{
                    fontFamily: "var(--v2-font-mono)",
                    fontSize: "0.6875rem",
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--v2-color-accent)",
                  }}
                >
                  {onClockName === "You" ? "Your pick" : `On the clock · ${onClockName}`}
                </span>
              ) : null}
              {/* Final closure pass, task §5: gated on a seat actually being
                  on the clock, not merely on `deadlineAt` existing. During
                  `PHASE_INTRO`/`PHASE_REVEAL` (seatless turns) the server
                  publishes the viewer's own `seconds_remaining` as the
                  ~30-minute intro backstop, and `PeakV2Timer` renders raw
                  seconds with no MM:SS formatting -- without this gate that
                  is a real, literal 4-digit number (confirmed by a
                  deterministic test: `deadlineAt` ~1798s out with no seat on
                  the clock rendered "1798"). Legacy `TurnStatus` has always
                  had the equivalent gate (`yourTurn`/`activeSeat`); this
                  mirrors it rather than inventing a new rule. Changes
                  nothing about timer values or authority -- only whether
                  this header chooses to display a countdown outside an
                  actual pick turn.

                  RESERVED WHEN HIDDEN (final closure pass, task §1): the
                  gate above is correct, but it means this row's own
                  available width -- and therefore whether it wraps at
                  narrow (390px) viewports -- differs between the seatless
                  reveal window and the instant a real turn starts, which
                  measured as a real outer-shell height change at that exact
                  transition. Reserving the timer's own worst-case width
                  (two digits, its real range during a turn is 0-45) with an
                  invisible, `aria-hidden` placeholder keeps this row's wrap
                  point constant regardless of whose turn it is -- no
                  fabricated number is ever shown to a user. */}
              {remaining !== null && currentTurnSeatIndex !== null ? (
                <PeakV2Timer secondsRemaining={remaining} urgentAtSeconds={5} />
              ) : (
                <span
                  aria-hidden="true"
                  style={{
                    visibility: "hidden",
                    fontFamily: "var(--v2-font-mono)",
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: 600,
                    fontSize: "1.125rem",
                  }}
                >
                  88
                </span>
              )}
            </div>
          }
        />

        {/* ONE truthful line: what was rolled, and who is picking right now.
            Stays in this exact spot across every phase -- never jumps. The
            "On the clock" span is always mounted (task §1): reserved with
            `reservedOnClockName` (the SAME real name it will show once
            visible, not a guessed placeholder) and only `visibility`-
            toggled, so this row's own wrap point never depends on whether a
            seat is actually on the clock yet. */}
        {rollLine || onClockName ? (
          <p
            className="mt-2 flex flex-wrap items-center gap-x-2"
            style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem" }}
          >
            {rollLine ? <span style={{ color: "var(--v2-text-secondary)" }}>{rollLine}</span> : null}
            <span
              style={{
                fontWeight: 700,
                color: "var(--v2-color-accent)",
                visibility: onClockName ? "visible" : "hidden",
              }}
            >
              On the clock — {onClockName || reservedOnClockName}
            </span>
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
        </div>
        {/* Scrollable body: capped to whatever's left of the viewport once
            the pinned header above is accounted for. Content that fits does
            not scroll at all (`overflow-y: auto`, not `scroll`); content that
            doesn't fit scrolls INSIDE this region only -- the header, and
            the outer shell's own dimensions, never move.

            `tabIndex={0}` + `role="region"` + `aria-label`: axe's
            `scrollable-region-focusable` (serious) — a scrollable container
            with no way for a keyboard user to focus it has no way to scroll
            it either, since arrow keys only scroll whatever currently has
            focus. The interactive content inside (candidate buttons, roster
            tabs) remains independently focusable and tabbing through it is
            unaffected; this only adds the container itself as one more real
            stop so `PageDown`/arrow keys can act on it directly. */}
        <div
          className="min-h-0 overflow-y-auto"
          style={{ maxHeight: `calc(var(--tmw-viewport-cap, 100dvh) - ${headerHeight}px)` }}
          tabIndex={0}
          role="region"
          aria-label="Three-Man Weave courts"
        >
        {/* `tmw-courts`: one container for both responsive renderings below.
            DESKTOP FIRST, MOBILE SECOND in source order — CSS (`lg:hidden` /
            `hidden lg:grid`) decides which is actually painted at a given
            viewport, so this ordering has no visual effect either way (only
            one of the two is ever non-`display:none`). It does, however,
            decide which element a `data-testid="tmw-seat-court-N"` query
            resolves to when both are mounted for the seat currently shown on
            mobile: `.first()` (desktop tests, e.g. "all three seats visible")
            always lands on the always-present desktop instance, and `.last()`
            (the phone test, after switching tabs) always lands on the
            mobile-only instance that is actually visible there. */}
        <div data-testid="tmw-courts" aria-label="All three rosters">
        {/* Desktop: the real three-column grid, always. */}
        <div className="mt-4 hidden gap-4 lg:grid lg:grid-cols-3">
          {state.rosters.map((roster) => {
            // Bug fix (mission §9): the PRIMARY highlight is whoever is
            // actually on the clock, never "whichever court belongs to
            // you". "YOU" stays visible as a secondary identity badge
            // inside `PeakV2TMWCourt`'s own status line (the `isYou` prop,
            // unchanged below) -- it is no longer what decides `lit`. When
            // a bot is on the clock, the bot's court is the active one and
            // the viewer's own court stays legible-but-dimmed; when no seat
            // is on the clock (a seatless reveal turn), nothing is lit
            // rather than falsely lighting a seat that isn't actually
            // deciding anything right now.
            const isOnTurn = !state.is_complete && currentTurnSeatIndex === roster.seat_index;
            return (
              <PeakV2TMWCourt
                key={roster.seat_index}
                roster={roster}
                seat={seats.find((s) => s.seat_index === roster.seat_index)}
                isYou={roster.seat_index === yourSeatIndex}
                isOnTurn={isOnTurn}
                edge={edgeBandFor(state, roster.seat_index)}
                lit={isOnTurn}
                interactive={canRearrange && roster.seat_index === yourSeatIndex && !busy}
                rearrangeEligible={canRearrange && roster.seat_index === yourSeatIndex}
                pickedUpSlot={roster.seat_index === yourSeatIndex ? pickedUp : null}
                legalTargets={roster.seat_index === yourSeatIndex ? legalTargets : []}
                onPickUp={roster.seat_index === yourSeatIndex ? pickUp : undefined}
                onDropOn={roster.seat_index === yourSeatIndex ? dropOn : undefined}
              />
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
                rearrangeEligible={canRearrange && roster.seat_index === yourSeatIndex}
                pickedUpSlot={roster.seat_index === yourSeatIndex ? pickedUp : null}
                legalTargets={roster.seat_index === yourSeatIndex ? legalTargets : []}
                onPickUp={roster.seat_index === yourSeatIndex ? pickUp : undefined}
                onDropOn={roster.seat_index === yourSeatIndex ? dropOn : undefined}
              />
            ))}
        </div>
        </div>

        {children}
        </div>
      </div>
    </PeakV2Shell>
  );
}
