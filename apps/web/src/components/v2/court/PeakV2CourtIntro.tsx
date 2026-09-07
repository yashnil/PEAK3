"use client";

/**
 * PeakV2CourtIntro — the opening of a FRESHLY CREATED 82-0 run.
 *
 * Identity ("82-0 Peak Season"), one line of what the run is, and the cue
 * into round 1, staged over `COURT_PACING.INTRO_MS` (3.4 s) on the V2
 * cinematic stage. Client presentation only: it changes no server state and
 * gates nothing but the round-1 chooser's mount, which the caller
 * (`CourtBuilder`) owns. It plays once per created run -- a resumed or
 * reloaded run never sees it -- and it is not skippable: it is shorter than
 * the reel it precedes, and a "skip" control on a 3-second title card reads
 * as an apology for the card.
 *
 * Beats are CSS animation delays on data attributes, never timers, so the
 * only clock is the one that ends it. Reduced motion: one static frame held
 * for `INTRO_REDUCED_MS`, no animation, the same words.
 */

import { useEffect, useState } from "react";
import PeakV2CinematicStage from "../PeakV2CinematicStage";
import { COURT_PACING } from "@/lib/court-state";
import { usePrefersReducedMotion } from "@/lib/a11y";

export interface PeakV2CourtIntroProps {
  /** Daily challenge vs. practice -- the eyebrow says which. */
  challengeKind: "free_play" | "daily";
  difficulty: "easy" | "hard";
  totalRounds: number;
  /** Fired once, when the intro has fully left the stage. */
  onDone: () => void;
}

export default function PeakV2CourtIntro({ challengeKind, difficulty, totalRounds, onDone }: PeakV2CourtIntroProps) {
  const reduced = usePrefersReducedMotion();
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const total = reduced ? COURT_PACING.INTRO_REDUCED_MS : COURT_PACING.INTRO_MS;
    const exit = reduced ? 0 : COURT_PACING.INTRO_EXIT_MS;
    const t1 = window.setTimeout(() => setLeaving(true), Math.max(0, total - exit));
    const t2 = window.setTimeout(() => onDone(), total);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
    // Armed once on mount: the intro is a fixed sequence, and `onDone` is
    // the caller's stable state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  return (
    <div
      className="v2-court-intro"
      data-testid="court-intro"
      data-leaving={leaving ? "true" : "false"}
      data-reduced-motion={reduced ? "true" : "false"}
      role="status"
      aria-live="polite"
    >
      <PeakV2CinematicStage light={{ y: "38%" }} className="v2-court-intro-stage">
        <span className="v2-court-intro-eyebrow" data-beat="1">
          PEAK3 Arena · {challengeKind === "daily" ? "Daily challenge" : "Practice run"}
        </span>
        <h2 className="v2-court-intro-title" data-beat="2" data-testid="court-intro-title">
          82-0 <em>Peak Season</em>
        </h2>
        <span className="v2-court-intro-rule" data-beat="3" aria-hidden="true" />
        <p className="v2-court-intro-line" data-beat="4">
          {totalRounds} real team-seasons are drawn. Draft one exact player-season from each, place them on
          the court, and PEAK3 plays the 82.
        </p>
        <p className="v2-court-intro-cue" data-beat="5" data-testid="court-intro-cue">
          Round 1 of {totalRounds} · {difficulty === "hard" ? "Hard" : "Easy"} · the first team-season is
          about to be drawn
        </p>
      </PeakV2CinematicStage>
    </div>
  );
}
