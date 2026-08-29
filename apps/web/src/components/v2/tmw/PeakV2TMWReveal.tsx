"use client";

/**
 * PeakV2TMWReveal — Three-Man Weave's round-opening ceremony.
 *
 * IT NO LONGER DRAWS ITS OWN REELS. The FRANCHISE × DECADE roll now renders
 * through `PeakV2SpinReveal`, the same shared ceremony 82-0's TEAM × SEASON
 * roll uses — same shell, same fixed geometry, same axis grammar
 * (instrumentation label over a width-stable value window), same lock beat,
 * same live region, same reduced-motion path. Two modes, one ceremony, two
 * sets of labels.
 *
 * WHAT STAYS HERE, AND WHY. This mode keeps the ORCHESTRATION, because
 * TMW's reveal is not a client presentation over a decided roll — it is a
 * real SERVER TURN with a published deadline:
 *
 *   - every seat watches the same window, so the length is a fraction of
 *     `revealSeconds` and never a client-chosen duration (a reel still
 *     turning when the phase ends would put a live pick panel over a moving
 *     wheel);
 *   - a reload must resume where the SERVER says it is, computing elapsed
 *     from the deadline rather than replaying a reel that already finished;
 *   - the match-opening intro card, the skip control and the scrim are TMW's.
 *
 * So the stage is derived here and handed to `PeakV2SpinReveal` via its
 * `stage` prop. Shared presentation, mode-specific state ownership — which
 * is exactly the split that lets one ceremony serve both games without
 * either mode being able to change the other's timing.
 *
 * Courts stay mounted and visible BEHIND this overlay (dimmed by the scrim,
 * not replaced) — the caller renders `PeakV2TMWCourts` underneath and this
 * component only adds the cinematic scrim + card on top, exactly like
 * legacy `WeaveSpinner`'s own `.tmw-ceremony-scrim` positioning.
 *
 * `absolute inset-0`, NOT `fixed inset-0` (final closure pass, task §1). The
 * caller wraps this and `PeakV2TMWCourts` in one shared `position: relative`
 * box (`ThreeManWeaveGame.tsx`'s `tmw-v2-arena-shell`). A viewport-fixed
 * scrim and the courts' own in-flow box are two different elements with two
 * different sizes -- measuring "the outer shell" against a `fixed inset-0`
 * overlay was trivially stable (it's always the viewport) but meaningless,
 * because the instant the overlay closed to reveal the picker, THAT box (the
 * courts' own PeakV2Shell) was a materially different size. Anchoring this
 * overlay to the SAME relative ancestor the courts render into makes both
 * states literally the same element's box: the courts stay mounted
 * throughout and are the only size contributor (this overlay is absolutely
 * positioned, so it contributes none), so there is nothing to "reserve" --
 * the shell never changes size across intro/spinning/locked/resolved/picker
 * because it was never derived from reveal content in the first place.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/a11y";
import { REEL_SPIN_MS } from "@/components/shared/SpinReel";
import PeakV2SpinReveal, { type PeakV2SpinStage } from "../PeakV2SpinReveal";
import PeakV2ResultHeadline from "../PeakV2ResultHeadline";
import PeakV2DisplayEmphasis from "../PeakV2DisplayEmphasis";
import PeakV2SecondaryAction from "../PeakV2SecondaryAction";
import type { ArenaSeatPublic, TmwRoll } from "@/types/three-man-weave";

const DECADES = ["1980s", "1990s", "2000s", "2010s", "2020s"] as const;
const FRANCHISE_FILLER = [
  "Boston Celtics", "Chicago Bulls", "Detroit Pistons", "Golden State Warriors",
  "Houston Rockets", "Los Angeles Lakers", "Miami Heat", "New York Knicks",
  "Philadelphia 76ers", "Phoenix Suns", "San Antonio Spurs", "Utah Jazz",
];

const INTRO_SHARE = 0.5;
const SPIN_SHARE = 0.34;
const RESOLVE_SHARE = 0.35;
const PRIMARY_REEL_SHARE = REEL_SPIN_MS.primary / REEL_SPIN_MS.secondary;

type Stage = "intro" | "spinning" | "locked" | "resolved";

function schedule(totalMs: number, showIntro: boolean) {
  const total = Math.max(1, totalMs);
  const introEnds = showIntro ? total * INTRO_SHARE : 0;
  const reelSpan = total - introEnds;
  const secondaryMs = reelSpan * SPIN_SHARE;
  return {
    total,
    introEnds,
    spinEnds: introEnds + secondaryMs,
    resolvesAt: introEnds + reelSpan * RESOLVE_SHARE,
    primaryMs: secondaryMs * PRIMARY_REEL_SHARE,
    secondaryMs,
  };
}

function stageAt(elapsed: number, plan: ReturnType<typeof schedule>): Stage {
  if (elapsed < plan.introEnds) return "intro";
  if (elapsed < plan.spinEnds) return "spinning";
  if (elapsed < plan.resolvesAt) return "locked";
  return "resolved";
}

/** This mode's stage, in the shared ceremony's own vocabulary. `intro` is
 *  TMW's match-opening card, which happens BEFORE the roll begins — the
 *  shared machine's `idle`, i.e. armed and not yet turning. */
const SHARED_STAGE: Record<Stage, PeakV2SpinStage> = {
  intro: "idle",
  spinning: "spinning",
  locked: "locking",
  resolved: "revealed",
};

export interface PeakV2TMWRevealProps {
  roll: TmwRoll | null;
  roundNumber: number | null;
  totalRounds: number;
  open?: boolean;
  seats?: ArenaSeatPublic[];
  yourSeatIndex?: number | null;
  handoffLabel?: string;
  showIntro?: boolean;
  deadlineAt?: number | null;
  revealSeconds: number;
  onSkip?: () => void;
  skipping?: boolean;
}

export default function PeakV2TMWReveal({
  roll,
  roundNumber,
  totalRounds,
  open = true,
  seats,
  yourSeatIndex,
  handoffLabel,
  showIntro = false,
  deadlineAt,
  revealSeconds,
  onSkip,
  skipping = false,
}: PeakV2TMWRevealProps) {
  const reduced = usePrefersReducedMotion();
  const rollId = roll?.roll_id ?? null;
  const totalMs = Math.max(1, revealSeconds * 1000);
  const plan = useMemo(() => schedule(totalMs, showIntro), [totalMs, showIntro]);
  const [stage, setStage] = useState<Stage>(showIntro ? "intro" : "spinning");
  const decidedFor = useRef<string | null>(null);
  const [animate, setAnimate] = useState(true);

  useEffect(() => {
    if (!rollId || !open) return;
    const remaining = deadlineAt === null || deadlineAt === undefined ? plan.total : deadlineAt - performance.now();
    const elapsed = Math.min(plan.total, Math.max(0, plan.total - remaining));
    if (decidedFor.current !== rollId) {
      decidedFor.current = rollId;
      setAnimate(elapsed < plan.spinEnds);
    }
    setStage(stageAt(elapsed, plan));
    const timers: number[] = [];
    const arm = (at: number, next: Stage) => {
      if (at <= elapsed) return;
      timers.push(window.setTimeout(() => setStage(next), at - elapsed));
    };
    arm(plan.introEnds, "spinning");
    arm(plan.spinEnds, "locked");
    arm(plan.resolvesAt, "resolved");
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [rollId, open, plan, deadlineAt]);

  const franchisePool = useMemo(() => {
    if (!roll) return FRANCHISE_FILLER;
    return [...new Set([roll.franchise_display_name, ...FRANCHISE_FILLER])];
  }, [roll]);

  if (!open) return null;

  const resolved = stage === "resolved";
  const still = reduced || !animate;

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center overflow-y-auto"
      style={{ background: "color-mix(in srgb, var(--v2-bg-page) 88%, transparent)" }}
      data-ui-version="v2"
      data-testid="tmw-ceremony-scrim"
      data-stage={stage}
    >
      {/* RESERVED GEOMETRY (Pass 7, human acceptance testing, task §10; widened
          in the final closure pass to also cover the ONE-TIME match-open
          transition, task §2). The outer shell above is already a fixed
          full-viewport overlay, but the centered text block used to change
          height across intro/spinning/locked/resolved -- read as
          "recentering" once a reel settled. The intro block and the ceremony
          block are ALWAYS both mounted, stacked in the SAME grid cell (same
          technique already used for Peak Duel's cards/reveal, see
          `game-engine.tsx`'s own comment on it), so this container's height
          is always the TALLER of the two, never a per-stage size; only the
          active one is opaque/interactive. The intro block depends only on
          `seats`/`totalRounds`, never on `roll`, so it mounts unconditionally.
          The ceremony block mounts unconditionally too: before the first roll
          has arrived from the server (`roll === null`, the true first frame
          of a match), it renders the identical markup shape with an em-dash
          placeholder standing in for each `SpinReel` instead of the whole
          block being swapped for a smaller, differently-shaped one -- that
          swap was the exact cause of the one-time match-open shell jump this
          pass fixed. The handoff-label line is likewise always reserved
          (kept mounted, `visibility: hidden` until resolved) rather than
          popping into existence and pushing/recentering the block beneath
          it. */}
      {/* `max-w-2xl`, not `max-w-xl`: the shared ceremony puts FRANCHISE and
          DECADE side by side in one shell, and at 576px the franchise axis
          was ~193px — narrow enough that the longest real names in the pool
          ("Portland Trail Blazers", "Oklahoma City Thunder", "Minnesota
          Timberwolves") had to ellipsise. Widening the card gives the axis
          room for every name in the league rather than relying on truncation
          for a third of it. The ellipsis mechanics are still correct beneath
          this, as a floor rather than as the normal case. */}
      {/* `w-full` alongside `max-w-2xl`: this is a flex item inside a
          `justify-center` overlay, so without an explicit width it is
          shrink-to-fit and the max-width never binds — measured 508px
          against a declared 672px cap, which is why widening the cap alone
          changed nothing. */}
      <div className="mx-auto w-full max-w-2xl px-6 py-16 text-center flex flex-col items-center">
      <div className="grid w-full" style={{ gridTemplateAreas: '"stack"' }}>
            <div
              style={{
                gridArea: "stack",
                opacity: showIntro && stage === "intro" ? 1 : 0,
                visibility: showIntro && stage === "intro" ? "visible" : "hidden",
                pointerEvents: showIntro && stage === "intro" ? "auto" : "none",
              }}
              aria-hidden={!(showIntro && stage === "intro")}
            >
              <p style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--v2-color-accent)" }}>
                PEAK3 Arena
              </p>
              <PeakV2ResultHeadline as="h1" scale="hero" className="mt-2">
                Three-Man <PeakV2DisplayEmphasis>Weave</PeakV2DisplayEmphasis>
              </PeakV2ResultHeadline>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
                {(seats ?? []).map((seat) => (
                  <span
                    key={seat.seat_index}
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
            </div>

            <div
              data-testid="tmw-roll"
              data-roll-id={roll?.roll_id}
              data-phase={resolved ? "revealed" : stage}
              data-stage={stage}
              data-revealed={resolved ? "true" : "false"}
              data-reduced-motion={reduced ? "true" : "false"}
              style={{
                gridArea: "stack",
                opacity: showIntro && stage === "intro" ? 0 : 1,
                visibility: showIntro && stage === "intro" ? "hidden" : "visible",
                pointerEvents: showIntro && stage === "intro" ? "none" : "auto",
              }}
              aria-hidden={showIntro && stage === "intro"}
            >
              <p style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--v2-text-muted)" }}>
                {roll ? <>Round {roundNumber ?? "—"} of {totalRounds} · everyone drafts from this</> : "Rolling the next franchise and decade…"}
              </p>
              {/* THE SHARED CEREMONY. Same component, same shell, same
                  geometry and same lock beat as 82-0's TEAM × SEASON roll —
                  only the labels and the values differ, which is the entire
                  point of it being shared.

                  `stage` is handed in rather than left to the component's
                  own machine: see this module's docstring for why TMW's
                  reveal is a server turn and not a client presentation.

                  ROLL-NOT-YET-ARRIVED (`roll === null`, the true first frame
                  of a match) keeps its em-dash placeholder block rather than
                  mounting the ceremony with fabricated values — same markup
                  SHAPE, so the reserved grid stack does not change height
                  when the real roll lands. */}
              <div className="tmw-ceremony mt-4">
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
                        spinMs: plan.primaryMs,
                        testId: "tmw-roll-franchise",
                      },
                      {
                        label: "Decade",
                        value: roll.decade,
                        pool: DECADES,
                        spinMs: plan.secondaryMs,
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
              <p className="mt-4" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", color: "var(--v2-text-secondary)" }}>
                {roll && resolved ? `${roll.candidates.length} eligible ${roll.candidates.length === 1 ? "player" : "players"} still undrafted` : "Rolling…"}
              </p>
              {/* Always mounted and reserved, never popping in -- only its
                  visibility toggles once resolved (task §10: no resizing on
                  reel settle). */}
              <p
                className="mt-2"
                style={{
                  fontFamily: "var(--v2-font-ui)",
                  fontWeight: 700,
                  fontSize: "0.875rem",
                  color: "var(--v2-color-accent)",
                  visibility: roll && resolved && handoffLabel ? "visible" : "hidden",
                }}
              >
                {handoffLabel || " "}
              </p>
            </div>
      </div>

      {onSkip ? (
        <div className="mt-8">
          <PeakV2SecondaryAction disabled={skipping} onClick={onSkip}>
            {skipping ? "Starting…" : stage === "intro" ? "Skip intro" : resolved ? "Draft now" : "Skip reveal"}
          </PeakV2SecondaryAction>
        </div>
      ) : null}
      </div>
    </div>
  );
}
