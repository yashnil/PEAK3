"use client";

/**
 * PeakV2TMWReveal — Three-Man Weave's two seatless phases, on the server's clock.
 *
 * THE BRIEFING (`phase="intro"`) and THE ROLL (`phase="reveal"`) are both
 * short server turns that every seat watches at once. This component renders
 * whichever is open and derives everything it animates from ONE fact the
 * server published: how far into the turn the server was when the snapshot
 * landed (`startedAt` + `totalSeconds`, converted by the room the instant the
 * response arrived). It never decides when a phase ends and it offers no way
 * to end one. A client that joins mid-phase computes the same elapsed time as
 * everyone else and lands on the same stage; one that joins after the reels
 * have settled renders the settled result without replaying the travel
 * (`still`).
 *
 * THE ROLL, AS A DRAFT-LOTTERY SLATE (game-feel pass 5). One card, laid out
 * from the first frame so nothing pops in: the round and the picks it owns
 * across the top, scoreboard apertures for FRANCHISE × DECADE, the round's
 * draft order beneath, and the handoff line that says when drafting becomes
 * actionable. Restrained on purpose -- a slate being filled in, not a slot
 * machine: no flashing, one gold rule and one gold baseline.
 *
 * A FRANCHISE OR DECADE DRAFT (`constraint` set) rolls ONCE, before round one,
 * and the slate says so: "Franchise Draft · all 18 picks", one aperture for
 * the one constraint, and the opening order. It is never presented as a
 * per-round pair, because the other half is not rolled at all.
 *
 * THE TIMELINE (absolute ms from the turn's start, laid out for the server's
 * 3.8 s `REVEAL_SECONDS` window, and resolved with half a second of that window
 * still to run). Game-feel pass 5 re-laid it from 1.5 s: the roll read as a
 * flash. It is now built as anticipation -> release, in two releases:
 *
 *     0      SLATE    "ROUND 2 OF 6 · PICKS 4–6" lands, rule draws; the
 *                     apertures are on screen, empty
 *     450    ARMED    apertures light and pulse -- "here it comes", 250 ms
 *     700    SPINNING both reels travel and decelerate; a light sweeps the card
 *     2440   LANDING  the FRANCHISE reel has landed (1.6 s + settle) and flashes;
 *                     the decade keeps turning -- "Chicago Bulls… and the decade?"
 *     3090   LOCKED   the decade lands (2.25 s + settle); both windows flash
 *                     gold, the × pops, "Locked in"
 *     3300   RESOLVED the result holds, the order row marks who opens, and the
 *                     handoff reads "You're up" / "<Seat> is up" for the last
 *                     500 ms of the window and until the poll lands the pick
 *
 * A one-constraint draft has one aperture, so it has no LANDING stage: its
 * single reel takes the long 2.25 s travel.
 *
 * A SHORTER published window compresses every beat by the same ratio, so the
 * reels are never still turning when the server ends the phase; a LONGER one
 * changes no beat and only lengthens the resolved hold. Every seat receives
 * the same `turn_total_seconds`, so every seat stays in step.
 *
 * REDUCED MOTION runs the identical machine with nothing travelling: the
 * settled result, the order row and the handoff are simply there, carrying the
 * same information.
 *
 * GEOMETRY IS RESERVED. The briefing and the roll are both always mounted,
 * stacked in one grid cell, so the card is the taller of the two at every
 * stage. The scrim is fixed below the site header: a round can open while the
 * player is scrolled anywhere on the board, and the roll must be in view.
 *
 * The reels render through the shared `PeakV2SpinReveal` (also 82-0's); every
 * TMW-specific choice is a class on this card, never a change to that
 * component.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/a11y";
import PeakV2SpinReveal, { type PeakV2SpinAxis, type PeakV2SpinStage } from "../PeakV2SpinReveal";
import PeakV2ResultHeadline from "../PeakV2ResultHeadline";
import PeakV2DisplayEmphasis from "../PeakV2DisplayEmphasis";
import { roundPickOrder, seatAccent } from "@/lib/three-man-weave-state";
import type { ArenaSeatPublic, TmwPublicState, TmwRoll } from "@/types/three-man-weave";

const DECADES = ["1980s", "1990s", "2000s", "2010s", "2020s"] as const;
const FRANCHISE_FILLER = [
  "Boston Celtics", "Chicago Bulls", "Detroit Pistons", "Golden State Warriors",
  "Houston Rockets", "Los Angeles Lakers", "Miami Heat", "New York Knicks",
  "Philadelphia 76ers", "Phoenix Suns", "San Antonio Spurs", "Utah Jazz",
];

/** The roll's beats, in ms. Every seat derives the same stage from the same
 *  server elapsed time, so changing a number here changes it for the whole
 *  table at once. */
export const TMW_CEREMONY = {
  /** The slate lands: round, picks, rule. Apertures already on screen. */
  roundCardMs: 450,
  /** The armed beat: apertures lit and pulsing, still empty. */
  armedMs: 250,
  /** The franchise reel: lands first, with the decade still turning. */
  primaryReelMs: 1600,
  /** The decade reel (or a one-constraint draft's only reel). */
  secondaryReelMs: 2250,
  /** Reel settle after its travel, before the lock begins. The shared reel's
   *  own overshoot (`SpinReel` SETTLE_MS, 220 ms) finishes inside the lock. */
  settleMs: 140,
  lockMs: 210,
} as const;
/** The server window these beats were laid out for (`REVEAL_SECONDS`). */
export const TMW_CEREMONY_NOMINAL_MS = 3800;

export interface TmwCeremonyMarks {
  armed: number;
  spinning: number;
  /** The first reel has landed (two-axis rolls only; equals `locked` otherwise). */
  landing: number;
  locked: number;
  resolved: number;
  primaryReelMs: number;
  secondaryReelMs: number;
}

/**
 * Absolute marks on the turn's timeline, for a window of `totalMs`.
 *
 * Compresses proportionally for a window SHORTER than the nominal 3.8 s, so
 * the result is always locked before the server opens the pick turn. A longer
 * window is not stretched: the beats keep their nominal length and only the
 * resolved hold grows.
 */
export function ceremonyMarks(totalMs: number = TMW_CEREMONY_NOMINAL_MS): TmwCeremonyMarks {
  const k = totalMs > 0 && totalMs < TMW_CEREMONY_NOMINAL_MS ? totalMs / TMW_CEREMONY_NOMINAL_MS : 1;
  const armed = Math.round(TMW_CEREMONY.roundCardMs * k);
  const spinning = armed + Math.round(TMW_CEREMONY.armedMs * k);
  const secondaryReelMs = Math.round(TMW_CEREMONY.secondaryReelMs * k);
  const primaryReelMs = Math.round(TMW_CEREMONY.primaryReelMs * k);
  const locked = spinning + secondaryReelMs + Math.round(TMW_CEREMONY.settleMs * k);
  const landing = Math.min(locked, spinning + primaryReelMs + Math.round(TMW_CEREMONY.settleMs * k));
  const resolved = locked + Math.round(TMW_CEREMONY.lockMs * k);
  return {
    armed,
    spinning,
    landing,
    locked,
    resolved,
    primaryReelMs,
    secondaryReelMs,
  };
}
/** The nominal marks, for callers and tests that reason about the design. */
export const TMW_CEREMONY_MARKS = ceremonyMarks();

type Stage = "intro" | "round" | "armed" | "spinning" | "landing" | "locked" | "resolved";

function stageAt(
  phase: "intro" | "reveal",
  elapsedMs: number,
  reduced: boolean,
  marks: TmwCeremonyMarks,
  twoAxes: boolean,
): Stage {
  if (phase === "intro") return "intro";
  // Reduced motion: an immediate lock. The result is simply there.
  if (reduced) return "resolved";
  if (elapsedMs < marks.armed) return "round";
  if (elapsedMs < marks.spinning) return "armed";
  if (elapsedMs < marks.landing) return "spinning";
  if (elapsedMs < marks.locked) return twoAxes ? "landing" : "spinning";
  if (elapsedMs < marks.resolved) return "locked";
  return "resolved";
}

/** This mode's stage, in the shared ceremony's own vocabulary. */
const SHARED_STAGE: Record<Stage, PeakV2SpinStage> = {
  intro: "idle",
  round: "idle",
  armed: "idle",
  spinning: "spinning",
  landing: "spinning",
  locked: "locking",
  resolved: "revealed",
};

/** The status line under the order row, per stage: the anticipation, in words. */
function statusLine(stage: Stage, roll: TmwRoll | null, oneConstraint: boolean): string {
  if (!roll) return "Rolling…";
  if (stage === "armed") return "Here it comes…";
  if (stage === "spinning") return oneConstraint ? "Drawing the whole draft's pool…" : "Rolling the franchise…";
  if (stage === "landing") return `${roll.franchise_display_name}… and the decade?`;
  if (stage === "locked") return "Locked in";
  if (stage !== "resolved") return "Rolling…";
  return `${roll.candidates.length} eligible ${roll.candidates.length === 1 ? "player" : "players"} still undrafted`;
}

type TmwConstraint = NonNullable<TmwPublicState["constraint"]>;

export interface PeakV2TMWRevealProps {
  roll: TmwRoll | null;
  roundNumber: number | null;
  totalRounds: number;
  open?: boolean;
  /** Which seatless phase the server has open. */
  phase?: "intro" | "reveal";
  /** The briefing is on screen but its clock waits for the table to arrive. */
  arriving?: boolean;
  /** Changes per server turn. A new key re-arms the presentation; the same
   *  key across polls keeps it running from where it is. */
  turnKey?: string;
  seats?: ArenaSeatPublic[];
  yourSeatIndex?: number | null;
  /** "You're up" / "<Seat> is up" — said once the result has resolved. */
  handoffLabel?: string;
  /** The seat the server will hand the pick to when this phase ends. Marks
   *  that seat in the order row and styles the handoff for the viewer. */
  upNextSeatIndex?: number | null;
  /** Seats at the table, for the round's pick range. Defaults to `seats`. */
  seatCount?: number;
  /** A Franchise or Decade Draft's one constraint (`public_state.constraint`).
   *  When set, the slate names it for the whole draft. */
  constraint?: TmwConstraint | null;
  /** When the open turn began, on `performance.now()`'s clock. */
  startedAt?: number | null;
  /** The open turn's full length, in seconds. */
  totalSeconds?: number;
  /** @deprecated legacy geometry callers: the intro card is now `phase="intro"`. */
  showIntro?: boolean;
  /** @deprecated legacy callers: the reveal's length. Used only as a fallback
   *  for `totalSeconds` when the server sent none. */
  revealSeconds?: number;
  /** @deprecated legacy callers: derived `startedAt` from a deadline. */
  deadlineAt?: number | null;
}

export default function PeakV2TMWReveal({
  roll,
  roundNumber,
  totalRounds,
  open = true,
  phase,
  arriving = false,
  turnKey,
  seats,
  yourSeatIndex,
  handoffLabel,
  upNextSeatIndex = null,
  seatCount,
  constraint = null,
  startedAt,
  totalSeconds,
  showIntro = false,
  revealSeconds,
  deadlineAt,
}: PeakV2TMWRevealProps) {
  const reduced = usePrefersReducedMotion();
  const resolvedPhase: "intro" | "reveal" = phase ?? (showIntro ? "intro" : "reveal");
  const total = (totalSeconds ?? revealSeconds ?? TMW_CEREMONY_NOMINAL_MS / 1000) * 1000;
  const marks = useMemo(() => ceremonyMarks(total), [total]);
  const key = turnKey ?? `${resolvedPhase}:${roll?.roll_id ?? "none"}`;
  // Elapsed on the server's timeline, converted at mount/rearm time.
  const elapsedAtMount = useMemo(() => {
    const now = typeof performance !== "undefined" ? performance.now() : 0;
    if (startedAt !== null && startedAt !== undefined) return Math.max(0, now - startedAt);
    if (deadlineAt !== null && deadlineAt !== undefined) return Math.max(0, total - (deadlineAt - now));
    return 0;
    // Recomputed when the turn changes, when the ceremony OPENS, or when the
    // room moves its start (a pick-opened reveal's settle lead) -- never on an
    // ordinary poll, which would reset the local timeline it merely confirms.
    // Keying on `open` is what keeps a late-firing settle timer (a throttled
    // background tab) from replaying the roll from zero while the server's
    // clock has moved on (game-feel pass 5).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, open, startedAt]);

  const twoAxes = !constraint;
  const [stage, setStage] = useState<Stage>(() => stageAt(resolvedPhase, elapsedAtMount, reduced, marks, twoAxes));
  const armedFor = useRef<string | null>(null);
  const [still, setStill] = useState(false);

  useEffect(() => {
    if (!open) return;
    const elapsed = elapsedAtMount;
    if (armedFor.current !== key) {
      armedFor.current = key;
      // Joined after the reels would have settled: show them settled, never
      // replay travel the server has already spent.
      setStill(reduced || (resolvedPhase === "reveal" && elapsed >= marks.locked));
    }
    setStage(stageAt(resolvedPhase, elapsed, reduced, marks, twoAxes));
    if (resolvedPhase !== "reveal") return;
    const timers: number[] = [];
    const arm = (at: number, next: Stage) => {
      if (at <= elapsed) return;
      timers.push(window.setTimeout(() => setStage(next), at - elapsed));
    };
    if (!reduced) {
      arm(marks.armed, "armed");
      arm(marks.spinning, "spinning");
      if (twoAxes && marks.landing < marks.locked) arm(marks.landing, "landing");
      arm(marks.locked, "locked");
      arm(marks.resolved, "resolved");
    }
    return () => timers.forEach((id) => window.clearTimeout(id));
    // `marks` follows `total`, which is fixed per turn; the key already
    // re-arms on a new turn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, open, resolvedPhase, elapsedAtMount, reduced]);

  const franchisePool = useMemo(() => {
    const landing = constraint?.kind === "franchise" ? constraint.label : roll?.franchise_display_name;
    if (!landing) return FRANCHISE_FILLER;
    return [...new Set([landing, ...FRANCHISE_FILLER])];
  }, [roll, constraint]);

  if (!open) return null;

  const introUp = resolvedPhase === "intro";
  const resolved = stage === "resolved";
  const tableSize = seatCount ?? (seats?.length || 3);
  const totalPicks = totalRounds * tableSize;
  const nameOf = (seatIndex: number) =>
    seatIndex === yourSeatIndex
      ? "You"
      : (seats?.find((seat) => seat.seat_index === seatIndex)?.display_name ?? `Seat ${seatIndex + 1}`);
  const order = roundNumber ? roundPickOrder(roundNumber, tableSize) : [];
  const openingOrder = roundPickOrder(1, tableSize);
  const draftName = constraint ? (constraint.kind === "franchise" ? "Franchise Draft" : "Decade Draft") : null;
  const pickRange = draftName
    ? `All ${totalPicks} picks`
    : order.length
      ? `Picks ${order[0].pickNumber}–${order[order.length - 1].pickNumber}`
      : null;
  const handoffIsYou = upNextSeatIndex !== null && upNextSeatIndex === yourSeatIndex;
  const showHandoff = !!roll && resolved && !!handoffLabel;

  // THE APERTURES: the per-round pair, or the one whole-draft constraint.
  const axes: PeakV2SpinAxis[] | null = !roll
    ? null
    : constraint
      ? [
          constraint.kind === "franchise"
            ? { label: "Franchise", value: constraint.label, pool: franchisePool, spinMs: marks.secondaryReelMs, testId: "tmw-roll-franchise" }
            : { label: "Decade", value: constraint.label, pool: DECADES, spinMs: marks.secondaryReelMs, testId: "tmw-roll-decade" },
        ]
      : [
          { label: "Franchise", value: roll.franchise_display_name, pool: franchisePool, spinMs: marks.primaryReelMs, testId: "tmw-roll-franchise" },
          { label: "Decade", value: roll.decade, pool: DECADES, spinMs: marks.secondaryReelMs, testId: "tmw-roll-decade" },
        ];

  return (
    <div
      className="tmw-stage-scrim"
      data-ui-version="v2"
      data-testid="tmw-ceremony-scrim"
      data-stage={stage}
      data-phase={resolvedPhase}
    >
      <div
        className="tmw-lottery"
        data-stage={stage}
        data-phase={resolvedPhase}
        data-variant={constraint?.kind ?? "standard"}
        data-reduced-motion={reduced ? "true" : "false"}
      >
        {/* THE BRIEFING: the match itself, before any roll. Server-timed;
            nothing here can end it. */}
        <div
          data-testid="tmw-intro"
          className="tmw-brief"
          style={{
            gridArea: "stack",
            opacity: introUp ? 1 : 0,
            visibility: introUp ? "visible" : "hidden",
            pointerEvents: "none",
          }}
          aria-hidden={!introUp}
        >
          <p className="tmw-lottery-eyebrow">PEAK3 Arena · {draftName ?? "Draft room"}</p>
          <PeakV2ResultHeadline as="h2" scale="hero" className="mt-2">
            Three-Man <PeakV2DisplayEmphasis>Weave</PeakV2DisplayEmphasis>
          </PeakV2ResultHeadline>
          <p className="tmw-brief-rules">
            {constraint
              ? `${totalRounds} rounds · one ${constraint.kind} for all ${totalPicks} picks, drawn before round one`
              : `${totalRounds} rounds · a new franchise × decade each round · one shared pool`}
          </p>
          {/* THE TABLE, IN THE ORDER IT OPENS. Round one runs forward. */}
          <ol className="tmw-lottery-order tmw-brief-seats" data-testid="tmw-intro-seats" aria-label="Draft order, round 1">
            {(seats?.length ? openingOrder : []).map(({ pickNumber, seatIndex }) => {
              const seat = seats?.find((entry) => entry.seat_index === seatIndex);
              if (!seat) return null;
              const isYou = seatIndex === yourSeatIndex;
              return (
                <li
                  key={seatIndex}
                  className="tmw-intro-seat-chip"
                  data-you={isYou ? "true" : "false"}
                  data-seat-accent={seatAccent(seatIndex)}
                >
                  <span className="tmw-lottery-order-num">{pickNumber}</span>
                  <span className="tmw-lottery-order-name">
                    {seat.display_name}
                    {isYou ? " · You" : ""}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="tmw-brief-objective">Build the best legal five and a bench. PEAK3 ranks the finished lineups.</p>
          <p className="tmw-brief-countdown" data-testid="tmw-intro-countdown" data-arriving={arriving ? "true" : "false"}>
            {arriving ? "Taking seats" : "Entering the draft room"}
          </p>
        </div>

        {/* THE ROLL. Mounted throughout so the stack's height never changes;
            before the first roll arrives it holds the same shape with empty
            apertures. */}
        <div
          data-testid="tmw-roll"
          data-roll-id={roll?.roll_id}
          data-phase={resolved ? "revealed" : stage}
          data-stage={stage}
          data-revealed={resolved ? "true" : "false"}
          data-reduced-motion={reduced ? "true" : "false"}
          className="tmw-roll"
          style={{
            gridArea: "stack",
            opacity: introUp ? 0 : 1,
            visibility: introUp ? "hidden" : "visible",
            pointerEvents: "none",
          }}
          aria-hidden={introUp}
        >
          {/* THE SLATE: which round this roll governs, and which picks. */}
          <div className="tmw-lottery-head">
            <span className="tmw-lottery-round" data-testid="tmw-round-reveal" role="status" aria-live="polite">
              {draftName
                ? `${draftName} · round ${roundNumber ?? 1} of ${totalRounds}`
                : roundNumber
                  ? `Round ${roundNumber} of ${totalRounds}`
                  : "Next round"}
            </span>
            {pickRange ? <span className="tmw-lottery-picks">{pickRange}</span> : null}
          </div>
          <span className="tmw-lottery-rule" aria-hidden="true" />
          <p className="tmw-lottery-kicker">
            {!roll
              ? "Rolling the next franchise and decade…"
              : constraint
                ? constraint.kind === "franchise"
                  ? "One franchise for the whole draft — players from any decade"
                  : "One decade for the whole draft — players from any franchise"
                : "One franchise, one decade — every seat drafts from it"}
          </p>

          <div className="tmw-lottery-reels" data-stage={stage}>
            {roll && axes ? (
              <PeakV2SpinReveal
                runKey={roll.roll_id}
                stage={SHARED_STAGE[stage]}
                still={still}
                className="tmw-lottery-spin"
                testId="tmw-roll-ceremony"
                announcePrefix={draftName ? `${draftName}:` : roundNumber ? `Round ${roundNumber} rolled` : "Rolled"}
                axes={axes}
              />
            ) : (
              <div className="v2-spin tmw-lottery-spin">
                <div className="v2-spin-axes" data-axis-count={2}>
                  {["Franchise", "Decade"].map((label) => (
                    <div className="v2-spin-axis" key={label} data-revealed="false">
                      <span className="v2-spin-axis-label">{label}</span>
                      <span className="v2-spin-axis-value" aria-hidden="true">
                        <span className="v2-spin-axis-armed" />
                      </span>
                      <span className="v2-spin-axis-action" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* WHO TAKES THIS ROUND'S PICKS, and -- once the result has resolved
              -- who opens it. The order is the fixed snake; the mark is the
              server's own next seat. Text carries both: the pick number and the
              "on the clock" words, never the gold alone. */}
          {order.length ? (
            <ol className="tmw-lottery-order" aria-label={`Round ${roundNumber} draft order`}>
              {order.map(({ pickNumber, seatIndex }) => {
                const next = resolved && seatIndex === upNextSeatIndex;
                return (
                  <li
                    key={seatIndex}
                    data-you={seatIndex === yourSeatIndex ? "true" : "false"}
                    data-next={next ? "true" : "false"}
                    data-seat-accent={seatAccent(seatIndex)}
                  >
                    <span className="tmw-lottery-order-num">{pickNumber}</span>
                    <span className="tmw-lottery-order-name">{nameOf(seatIndex)}</span>
                    {next ? <span className="tmw-lottery-order-next">on the clock</span> : null}
                  </li>
                );
              })}
            </ol>
          ) : null}

          <p className="tmw-lottery-status" data-testid="tmw-ceremony-status" data-stage={stage}>
            {statusLine(stage, roll, !!constraint)}
          </p>
          {/* THE HANDOFF: the moment drafting becomes actionable. Always
              mounted and reserved, never popping in. */}
          <p
            className="tmw-lottery-handoff"
            data-testid="tmw-handoff"
            data-you={handoffIsYou ? "true" : "false"}
            data-visible={showHandoff ? "true" : "false"}
            style={{ visibility: showHandoff ? "visible" : "hidden" }}
          >
            {handoffLabel || " "}
          </p>
        </div>
      </div>
    </div>
  );
}
