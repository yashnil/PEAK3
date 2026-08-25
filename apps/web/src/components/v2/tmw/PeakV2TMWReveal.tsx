"use client";

/**
 * PeakV2TMWReveal — the round-opening ceremony (Pass 3): "large franchise /
 * decade identity, split-flap roll resolution, short controlled lighting,
 * automatic transition into drafting" (brief). Reuses `SpinReel` verbatim —
 * the real split-flap/slot-reel primitive already in production for this
 * exact roll, per its own docstring — and the exact same server-timed
 * schedule fractions `WeaveSpinner` uses, so the ceremony's length is still
 * the server's turn window, never a client-invented duration.
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
import { seatAccent } from "@/lib/three-man-weave-state";
import SpinReel, { REEL_SPIN_MS } from "@/components/shared/SpinReel";
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

  const noteSettled = () => {};

  if (!open) return null;

  const resolved = stage === "resolved";
  const still = reduced || !animate;

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center overflow-y-auto"
      style={{ background: "color-mix(in srgb, var(--v2-bg-page) 88%, transparent)" }}
      data-ui-version="v2"
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
      <div className="mx-auto max-w-xl px-6 py-16 text-center flex flex-col items-center">
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
              {/* `tmw-ceremony` is a CSS hook only (three-man-weave.css's real,
                  already-tuned `.tmw-ceremony .spin-reel-strip` aperture/mask/
                  payline rules) — reusing the exact real split-flap frame
                  rather than approximating it a second time. */}
              <div className="tmw-ceremony mt-4 flex items-center justify-center gap-6">
                <span style={{ fontFamily: "var(--v2-font-display)", fontSize: "var(--v2-display-size-line)", color: "var(--v2-text-primary)" }} data-seat-accent={seatAccent(0)}>
                  {roll ? (
                    <SpinReel pool={franchisePool} target={roll.franchise_display_name} spinMs={plan.primaryMs} runKey={`${roll.roll_id}-franchise`} reduced={still} testId="tmw-roll-franchise" onSettled={noteSettled} />
                  ) : (
                    <span aria-hidden="true">—</span>
                  )}
                </span>
                <span aria-hidden="true" style={{ fontFamily: "var(--v2-font-display)", fontStyle: "italic", fontSize: "1.5rem", color: "var(--v2-color-accent)" }}>
                  ×
                </span>
                <span style={{ fontFamily: "var(--v2-font-display)", fontSize: "var(--v2-display-size-line)", color: "var(--v2-color-accent)" }}>
                  {roll ? (
                    <SpinReel pool={DECADES} target={roll.decade} spinMs={plan.secondaryMs} runKey={`${roll.roll_id}-decade`} reduced={still} testId="tmw-roll-decade" onSettled={noteSettled} />
                  ) : (
                    <span aria-hidden="true">—</span>
                  )}
                </span>
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
