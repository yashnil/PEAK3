"use client";

/**
 * PeakV2TMWReveal — Three-Man Weave's two seatless phases, on the server's clock.
 *
 * THE BRIEFING (`phase="intro"`) and THE CEREMONY (`phase="reveal"`) are
 * both short server turns that every seat watches at once. This component
 * renders whichever is open and derives everything it animates from ONE
 * fact the server published: how far into the turn the server was when the
 * snapshot landed (`startedAt` + `totalSeconds`, converted by the room the
 * instant the response arrived). It never decides when a phase ends and it
 * offers no way to end one. A client that joins mid-phase computes the same
 * elapsed time as everyone else and lands on the same stage; one that joins
 * after the reel has settled renders the settled pair without replaying the
 * travel (`still`).
 *
 * THE CEREMONY'S OWN TIMELINE (absolute milliseconds from the turn's start,
 * inside the server's `REVEAL_SECONDS` = 4.0 s window):
 *
 *     0        ROUND card lands, board dims             (RoundReveal, Level 2)
 *     1550     card clears; the reel shell is ARMED     (anticipation: the
 *                                                        two empty windows)
 *     1750     reels accelerate                         (SpinReel, shared)
 *     2850     both reels have landed; LOCK beat        (accent wash + the
 *                                                        TMW lock pulse)
 *     3250     REVEALED: the pair holds, handoff line   (until the server
 *                                                        opens the pick turn,
 *                                                        ~0.75 s + the poll)
 *
 * Pre-deploy polish: the round card used to clear at 550 ms (measured
 * 370-510 ms on screen) and the lock was 300 ms; the card now holds ~1.5 s,
 * the reels get a short armed beat before they turn, the lock is 400 ms and
 * the pair holds before the pick turn opens. Reduced motion runs the
 * identical machine with the reel still: the pair is simply there, and the
 * beat is the state change.
 *
 * The roll renders through `PeakV2SpinReveal`, the same shared ceremony
 * 82-0's TEAM × SEASON roll uses — same shell, same geometry, same lock beat.
 *
 * GEOMETRY IS RESERVED. The intro block and the ceremony block are always
 * both mounted, stacked in the same grid cell, so this overlay's height is
 * the taller of the two at every stage and nothing recentres as a reel
 * settles. `absolute inset-0` against the caller's `position: relative`
 * shell, so the courts underneath stay the shell's only size contributor.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/a11y";
import PeakV2SpinReveal, { type PeakV2SpinStage } from "../PeakV2SpinReveal";
import PeakV2ResultHeadline from "../PeakV2ResultHeadline";
import PeakV2DisplayEmphasis from "../PeakV2DisplayEmphasis";
import { RoundReveal } from "@/components/game-feel";
import type { ArenaSeatPublic, TmwRoll } from "@/types/three-man-weave";

const DECADES = ["1980s", "1990s", "2000s", "2010s", "2020s"] as const;
const FRANCHISE_FILLER = [
  "Boston Celtics", "Chicago Bulls", "Detroit Pistons", "Golden State Warriors",
  "Houston Rockets", "Los Angeles Lakers", "Miami Heat", "New York Knicks",
  "Philadelphia 76ers", "Phoenix Suns", "San Antonio Spurs", "Utah Jazz",
];

/** The ceremony's beats, in ms from the reveal turn's start. Every seat
 *  derives the same stage from the same server elapsed time, so changing a
 *  number here changes it for the whole table at once. */
export const TMW_CEREMONY = {
  /** How long ROUND N holds over the dimmed board. */
  roundCardMs: 1550,
  /** The armed beat: the reel shell is on screen, both windows empty. */
  armedMs: 200,
  primaryReelMs: 800,
  secondaryReelMs: 1100,
  lockMs: 400,
} as const;
/** The server window these beats were laid out for (`REVEAL_SECONDS`). */
export const TMW_CEREMONY_NOMINAL_MS = 4000;

export interface TmwCeremonyMarks {
  armed: number;
  spinning: number;
  locked: number;
  resolved: number;
  primaryReelMs: number;
  secondaryReelMs: number;
}

/**
 * Absolute marks on the turn's timeline, for a window of `totalMs`.
 *
 * Laid out for the nominal 4.0 s window. A SHORTER published window (an API
 * still serving an older `REVEAL_SECONDS`) compresses every beat by the same
 * ratio, so the pair is always locked and held before the server opens the
 * pick turn -- the reel must never still be turning when the phase ends.
 * Every seat receives the same `turn_total_seconds`, so every seat scales
 * identically and stays in sync. A longer window only lengthens the hold.
 */
export function ceremonyMarks(totalMs: number = TMW_CEREMONY_NOMINAL_MS): TmwCeremonyMarks {
  const k = totalMs > 0 && totalMs < TMW_CEREMONY_NOMINAL_MS ? totalMs / TMW_CEREMONY_NOMINAL_MS : 1;
  const armed = Math.round(TMW_CEREMONY.roundCardMs * k);
  const spinning = armed + Math.round(TMW_CEREMONY.armedMs * k);
  const secondaryReelMs = Math.round(TMW_CEREMONY.secondaryReelMs * k);
  const locked = spinning + secondaryReelMs;
  const resolved = locked + Math.round(TMW_CEREMONY.lockMs * k);
  return {
    armed,
    spinning,
    locked,
    resolved,
    primaryReelMs: Math.round(TMW_CEREMONY.primaryReelMs * k),
    secondaryReelMs,
  };
}
/** The nominal marks, for callers and tests that reason about the design. */
export const TMW_CEREMONY_MARKS = ceremonyMarks();

type Stage = "intro" | "round" | "armed" | "spinning" | "locked" | "resolved";

function stageAt(phase: "intro" | "reveal", elapsedMs: number, reduced: boolean, marks: TmwCeremonyMarks): Stage {
  if (phase === "intro") return "intro";
  // Reduced motion: an immediate lock. The pair is simply there.
  if (reduced) return "resolved";
  if (elapsedMs < marks.armed) return "round";
  if (elapsedMs < marks.spinning) return "armed";
  if (elapsedMs < marks.locked) return "spinning";
  if (elapsedMs < marks.resolved) return "locked";
  return "resolved";
}

/** This mode's stage, in the shared ceremony's own vocabulary. */
const SHARED_STAGE: Record<Stage, PeakV2SpinStage> = {
  intro: "idle",
  round: "idle",
  armed: "idle",
  spinning: "spinning",
  locked: "locking",
  resolved: "revealed",
};

/** The status line under the reels, per stage. */
function statusLine(stage: Stage, roll: TmwRoll | null): string {
  if (!roll) return "Rolling…";
  if (stage === "locked") return "Locked in";
  if (stage !== "resolved") return "Rolling…";
  return `${roll.candidates.length} eligible ${roll.candidates.length === 1 ? "player" : "players"} still undrafted`;
}

export interface PeakV2TMWRevealProps {
  roll: TmwRoll | null;
  roundNumber: number | null;
  totalRounds: number;
  open?: boolean;
  /** Which seatless phase the server has open. */
  phase?: "intro" | "reveal";
  /** Changes per server turn. A new key re-arms the presentation; the same
   *  key across polls keeps it running from where it is. */
  turnKey?: string;
  seats?: ArenaSeatPublic[];
  yourSeatIndex?: number | null;
  handoffLabel?: string;
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
  turnKey,
  seats,
  yourSeatIndex,
  handoffLabel,
  startedAt,
  totalSeconds,
  showIntro = false,
  revealSeconds,
  deadlineAt,
}: PeakV2TMWRevealProps) {
  const reduced = usePrefersReducedMotion();
  const resolvedPhase: "intro" | "reveal" = phase ?? (showIntro ? "intro" : "reveal");
  const total = (totalSeconds ?? revealSeconds ?? 4.0) * 1000;
  const marks = useMemo(() => ceremonyMarks(total), [total]);
  const key = turnKey ?? `${resolvedPhase}:${roll?.roll_id ?? "none"}`;
  // Elapsed on the server's timeline, converted at mount/rearm time.
  const elapsedAtMount = useMemo(() => {
    const now = typeof performance !== "undefined" ? performance.now() : 0;
    if (startedAt !== null && startedAt !== undefined) return Math.max(0, now - startedAt);
    if (deadlineAt !== null && deadlineAt !== undefined) return Math.max(0, total - (deadlineAt - now));
    return 0;
    // Recomputed only when the turn changes -- not on every poll, which would
    // reset the local timeline it merely confirms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const [stage, setStage] = useState<Stage>(() => stageAt(resolvedPhase, elapsedAtMount, reduced, marks));
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
    setStage(stageAt(resolvedPhase, elapsed, reduced, marks));
    if (resolvedPhase !== "reveal") return;
    const timers: number[] = [];
    const arm = (at: number, next: Stage) => {
      if (at <= elapsed) return;
      timers.push(window.setTimeout(() => setStage(next), at - elapsed));
    };
    if (!reduced) {
      arm(marks.armed, "armed");
      arm(marks.spinning, "spinning");
      arm(marks.locked, "locked");
      arm(marks.resolved, "resolved");
    }
    return () => timers.forEach((id) => window.clearTimeout(id));
    // `marks` follows `total`, which is fixed per turn; the key already
    // re-arms on a new turn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, open, resolvedPhase, elapsedAtMount, reduced]);

  const franchisePool = useMemo(() => {
    if (!roll) return FRANCHISE_FILLER;
    return [...new Set([roll.franchise_display_name, ...FRANCHISE_FILLER])];
  }, [roll]);

  if (!open) return null;

  const introUp = resolvedPhase === "intro";
  const resolved = stage === "resolved";
  const roundCard = stage === "round";

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center overflow-y-auto"
      style={{ background: "color-mix(in srgb, var(--v2-bg-page) 88%, transparent)" }}
      data-ui-version="v2"
      data-testid="tmw-ceremony-scrim"
      data-stage={stage}
      data-phase={resolvedPhase}
    >
      {/* ROUND N — the round card, over the whole dimmed board, for the first
          beat of the ceremony only. The reels start underneath the instant
          it clears. */}
      <RoundReveal
        open={!introUp && roundCard}
        eyebrow="Three-Man Weave"
        title={roundNumber ? `Round ${roundNumber}` : "Rolling"}
        detail={roundNumber ? `of ${totalRounds} · one franchise, one decade, everyone drafts` : undefined}
        testId="tmw-round-reveal"
      />
      <div className="mx-auto w-full max-w-2xl px-6 py-16 text-center flex flex-col items-center">
        <div className="grid w-full" style={{ gridTemplateAreas: '"stack"' }}>
          {/* THE BRIEFING: the match itself, before any roll. Server-timed;
              nothing here can end it. */}
          <div
            data-testid="tmw-intro"
            style={{
              gridArea: "stack",
              opacity: introUp ? 1 : 0,
              visibility: introUp ? "visible" : "hidden",
              pointerEvents: "none",
            }}
            aria-hidden={!introUp}
          >
            <p style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--v2-color-accent)" }}>
              PEAK3 Arena · Multiplayer
            </p>
            <PeakV2ResultHeadline as="h1" scale="hero" className="mt-2">
              Three-Man <PeakV2DisplayEmphasis>Weave</PeakV2DisplayEmphasis>
            </PeakV2ResultHeadline>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-4" data-testid="tmw-intro-seats">
              {(seats ?? []).map((seat) => (
                <span
                  key={seat.seat_index}
                  className="tmw-intro-seat-chip"
                  data-you={seat.seat_index === yourSeatIndex ? "true" : "false"}
                  style={{
                    fontFamily: "var(--v2-font-ui)",
                    fontWeight: 700,
                    fontSize: "0.875rem",
                    color: seat.seat_index === yourSeatIndex ? "var(--v2-color-accent)" : "var(--v2-text-secondary)",
                  }}
                >
                  {seat.display_name}
                  {seat.seat_index === yourSeatIndex ? " · You" : ""}
                </span>
              ))}
            </div>
            <p className="mt-4" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.875rem", color: "var(--v2-text-secondary)" }}>
              {totalRounds} franchise × decade rounds. Build the best legal five and a bench.
            </p>
            <p
              className="mt-3"
              data-testid="tmw-intro-countdown"
              style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--v2-text-muted)" }}
            >
              Entering the draft room
            </p>
          </div>

          {/* THE CEREMONY. Mounted throughout so the stack's height never
              changes; before the first roll arrives it holds the same shape
              with placeholders. */}
          <div
            data-testid="tmw-roll"
            data-roll-id={roll?.roll_id}
            data-phase={resolved ? "revealed" : stage}
            data-stage={stage}
            data-revealed={resolved ? "true" : "false"}
            data-reduced-motion={reduced ? "true" : "false"}
            className="relative"
            style={{
              gridArea: "stack",
              opacity: introUp ? 0 : 1,
              visibility: introUp ? "hidden" : "visible",
              pointerEvents: "none",
            }}
            aria-hidden={introUp}
          >
            {/* Hidden outright while the round card is up (no fade OUT --
                the card must land on a clean board); fades IN when the
                reels take over. */}
            <div style={{ opacity: roundCard ? 0 : 1, transition: roundCard ? "none" : "opacity var(--v2-dur-transition, 210ms) var(--v2-ease-out, ease-out)" }}>
              <p style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--v2-text-muted)" }}>
                {roll ? <>Round {roundNumber ?? "—"} of {totalRounds} · everyone drafts from this</> : "Rolling the next franchise and decade…"}
              </p>
              <div className="tmw-ceremony mt-4" data-stage={stage}>
                {roll ? (
                  <PeakV2SpinReveal
                    runKey={roll.roll_id}
                    stage={SHARED_STAGE[stage]}
                    still={still}
                    testId="tmw-roll-ceremony"
                    announcePrefix="Rolled"
                    axes={[
                      {
                        label: "Franchise",
                        value: roll.franchise_display_name,
                        pool: franchisePool,
                        spinMs: marks.primaryReelMs,
                        testId: "tmw-roll-franchise",
                      },
                      {
                        label: "Decade",
                        value: roll.decade,
                        pool: DECADES,
                        spinMs: marks.secondaryReelMs,
                        testId: "tmw-roll-decade",
                      },
                    ]}
                  />
                ) : (
                  <div className="v2-spin">
                    <div className="v2-spin-axes" data-axis-count={2}>
                      {["Franchise", "Decade"].map((label) => (
                        <div className="v2-spin-axis" key={label} data-revealed="false">
                          <span className="v2-spin-axis-label">{label}</span>
                          <span className="v2-spin-axis-value" aria-hidden="true">
                            —
                          </span>
                          <span className="v2-spin-axis-action" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <p
                className="mt-4"
                data-testid="tmw-ceremony-status"
                style={{
                  fontFamily: "var(--v2-font-ui)",
                  fontSize: "0.8125rem",
                  fontWeight: stage === "locked" ? 700 : undefined,
                  letterSpacing: stage === "locked" ? "0.08em" : undefined,
                  textTransform: stage === "locked" ? "uppercase" : undefined,
                  color: stage === "locked" ? "var(--v2-color-accent)" : "var(--v2-text-secondary)",
                }}
              >
                {statusLine(stage, roll)}
              </p>
              {/* Always mounted and reserved, never popping in. */}
              <p
                className="mt-2"
                data-testid="tmw-handoff"
                style={{
                  fontFamily: "var(--v2-font-ui)",
                  fontWeight: 700,
                  fontSize: "0.875rem",
                  color: "var(--v2-color-accent)",
                  visibility: roll && resolved && handoffLabel ? "visible" : "hidden",
                }}
              >
                {handoffLabel || " "}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
