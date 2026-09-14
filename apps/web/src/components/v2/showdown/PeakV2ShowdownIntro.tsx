"use client";

/**
 * PeakV2ShowdownIntro — the $20 Showdown's pre-match, on the SERVER's clock.
 *
 * "Somebody always *overpays*." over the mounted board, four steps, the real
 * per-seat budget mirror, and a bar that drains against the intro turn's own
 * `turn_elapsed_seconds` / `turn_total_seconds` so every client agrees how
 * long is left. There is no dismiss: the intro is a shared timeline; the first lot
 * opens with a full decision window either way.
 */

import { useEffect, useState } from "react";
import PeakV2CinematicStage from "../PeakV2CinematicStage";
import PeakV2ResultHeadline from "../PeakV2ResultHeadline";
import PeakV2DisplayEmphasis from "../PeakV2DisplayEmphasis";
import { formatDollars } from "@/lib/twenty-dollar-api";
import { usePrefersReducedMotion } from "@/lib/a11y";

const STEPS: { n: string; title: string; body: string }[] = [
  { n: "01", title: "A lot opens", body: "One player, their eligible positions. The PEAK3 score stays sealed." },
  { n: "02", title: "Open or raise", body: "Whole dollars inside the legal range, on a running clock." },
  { n: "03", title: "Or step aside", body: "Market skip, pass on this lot, or concede — never a silent decline." },
  { n: "04", title: "Five beats five", body: "Both rosters full, the seal breaks, and the same five lanes settle the match." },
];

export default function PeakV2ShowdownIntro({
  opponentName,
  startingBudget,
  slots,
  marketSkips,
  rated,
  arriving = false,
  elapsedSeconds = null,
  totalSeconds = null,
  turnSeq = null,
}: {
  opponentName: string;
  startingBudget: number;
  slots: number;
  marketSkips: number;
  rated: boolean;
  /** On screen, clock not started: waiting for both bidders to arrive. */
  arriving?: boolean;
  elapsedSeconds?: number | null;
  totalSeconds?: number | null;
  turnSeq?: number | null;
}) {
  const reduced = usePrefersReducedMotion();
  // The bar runs from the server's elapsed figure at the instant this view
  // landed, so a reconnect mid-intro resumes rather than replays.
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (elapsedSeconds === null || totalSeconds === null || totalSeconds <= 0) return;
    const startedAt = performance.now() - elapsedSeconds * 1000;
    const tick = () => setProgress(Math.min(1, (performance.now() - startedAt) / (totalSeconds * 1000)));
    tick();
    const id = window.setInterval(tick, reduced ? 500 : 100);
    return () => window.clearInterval(id);
  }, [elapsedSeconds, totalSeconds, turnSeq, reduced]);

  const secondsLeft = totalSeconds ? Math.max(0, Math.ceil(totalSeconds * (1 - progress))) : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="The $20 Showdown — pre-match"
      className="fixed inset-0 z-50 overflow-y-auto"
      style={{ background: "var(--v2-bg-page)" }}
      data-ui-version="v2"
      data-testid="td-intro"
      data-turn-seq={turnSeq ?? undefined}
    >
      <PeakV2CinematicStage light={{ y: "-6%" }}>
        <span className="sd-intro-eyebrow">
          {rated ? "Rated match" : "Practice match"} · vs {opponentName}
        </span>
        <PeakV2ResultHeadline as="h1" scale="hero" className="mt-3">
          Somebody always <PeakV2DisplayEmphasis>overpays.</PeakV2DisplayEmphasis>
        </PeakV2ResultHeadline>
        <p className="sd-intro-lede mt-4 max-w-lg">
          A peak window&apos;s PEAK3 score stays sealed until its lot sells. You are pricing it yourself, against an
          opponent who needs the same five positions you do.
        </p>

        <div className="mt-10 grid w-full max-w-2xl grid-cols-1 gap-6 text-left sm:grid-cols-2">
          {STEPS.map((step) => (
            <div key={step.n}>
              <span className="sd-intro-n">{step.n}</span>
              <p className="sd-intro-step-title">{step.title}</p>
              <p className="sd-intro-step-body mt-0.5">{step.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex items-center gap-10">
          <div className="text-center">
            <span className="sd-intro-figure">{formatDollars(startingBudget)}</span>
            <p className="sd-intro-figure-label">each budget</p>
          </div>
          <div className="text-center">
            <span className="sd-intro-figure">{slots}</span>
            <p className="sd-intro-figure-label">roster slots</p>
          </div>
          <div className="text-center">
            <span className="sd-intro-figure">{marketSkips}</span>
            <p className="sd-intro-figure-label">market skips</p>
          </div>
        </div>

        <div className="mt-8 flex flex-col items-center gap-3">
          {/* NO SKIP. The intro is a shared timeline: both seats watch the
              same beat and lot 1's clock opens for both when the server's
              turn ends (`showdown_skip_intro` is refused with
              `shared_timeline`). The bar and the countdown say when. */}
          <span
            className="sd-intro-countdown"
            data-testid="td-intro-countdown"
            data-arriving={arriving ? "true" : "false"}
            role="status"
            aria-live="polite"
          >
            {arriving || secondsLeft === null ? "Taking seats" : `Lot 1 opens in ${secondsLeft}s`}
          </span>
          {totalSeconds !== null ? (
            <span className="sd-intro-track" aria-hidden="true" data-testid="td-intro-track">
              <span className="sd-intro-fill" style={{ transform: `scaleX(${1 - progress})` }} />
            </span>
          ) : null}
        </div>
      </PeakV2CinematicStage>
    </div>
  );
}
