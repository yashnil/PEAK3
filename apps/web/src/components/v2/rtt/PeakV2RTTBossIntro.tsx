"use client";

/**
 * PeakV2RTTBossIntro — phase 1 of the RTT boss-reveal cinematic (Pass 3).
 *
 * Verified against the reference (E2 page 16): "SCOUTING OPPONENT" eyebrow,
 * a large gold act numeral, the boss name in display serif, the rule
 * sentence beneath it. Same underlying beat as legacy `BossIntro` (a 3-2-1
 * countdown, skippable from the first frame, `onComplete` fires exactly
 * once) — this is a V2 presentation of the identical timing, not a second
 * countdown implementation.
 */

import { useEffect, useRef, useState } from "react";
import PeakV2CinematicStage from "../PeakV2CinematicStage";
import PeakV2ResultHeadline from "../PeakV2ResultHeadline";
import PeakV2DisplayEmphasis from "../PeakV2DisplayEmphasis";
import PeakV2SecondaryAction from "../PeakV2SecondaryAction";
import { lanesToWinSentence } from "@/lib/run-the-table-copy";
import type { BossPublic } from "@/types/run-the-table";

const COUNTDOWN_STEP_MS = 700;
const NUMERALS = [3, 2, 1] as const;

export interface PeakV2RTTBossIntroProps {
  boss: BossPublic;
  lanesToWin?: number;
  reducedMotion: boolean;
  onComplete: () => void;
}

export default function PeakV2RTTBossIntro({ boss, lanesToWin, reducedMotion, onComplete }: PeakV2RTTBossIntroProps) {
  const [count, setCount] = useState<number>(reducedMotion ? 0 : NUMERALS.length);
  const doneRef = useRef(false);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onComplete();
  };

  useEffect(() => {
    if (reducedMotion) {
      finish();
      return;
    }
    if (count <= 0) {
      finish();
      return;
    }
    const id = window.setTimeout(() => setCount((c) => c - 1), COUNTDOWN_STEP_MS);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, reducedMotion]);

  const numeral = NUMERALS[NUMERALS.length - count] ?? null;

  return (
    // Plain, unstyled wrapper — carries the surface testid only.
    // `PeakV2CinematicStage` renders a `<section>` with no prop for
    // arbitrary `data-*` attributes, and every other V2 RTT surface
    // (system-select, node-choice, choice-node, boss-preview, draft-room,
    // trade-desk, battle-reveal, the reveal sequence) exposes its own root
    // testid, so this one should too, for QA/e2e-ability. Adds no visual
    // nesting: a block-level div with no styling around a full-width
    // section renders identically to the section alone.
    <div data-testid="rtt-boss-intro">
      <PeakV2CinematicStage light={{ y: "-4%" }}>
      <span
        style={{
          fontFamily: "var(--v2-font-mono)",
          fontSize: "0.6875rem",
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--v2-color-accent)",
        }}
      >
        Scouting opponent
      </span>
      <span
        aria-hidden="true"
        className="mt-2"
        style={{ fontFamily: "var(--v2-font-display)", fontSize: "3.5rem", color: "var(--v2-color-accent)" }}
      >
        {boss.act}
      </span>
      <PeakV2ResultHeadline as="h1" scale="moment" className="mt-1">
        {boss.name}
      </PeakV2ResultHeadline>
      <p
        className="mt-2 max-w-md"
        style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.875rem", color: "var(--v2-text-secondary)" }}
      >
        {boss.tagline}
      </p>
      {lanesToWin != null ? (
        <p
          className="mt-1"
          style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", fontWeight: 700, color: "var(--v2-text-primary)" }}
        >
          Rule in force · <PeakV2DisplayEmphasis tone="inherit">{lanesToWinSentence(lanesToWin)}</PeakV2DisplayEmphasis>
        </p>
      ) : null}

      <div
        aria-hidden="true"
        data-testid="rtt-boss-intro-countdown"
        className="mt-8 flex h-24 w-24 items-center justify-center rounded-full border"
        style={{ borderColor: "var(--v2-color-accent)", background: "color-mix(in srgb, var(--v2-color-accent) 10%, transparent)" }}
      >
        <span style={{ fontFamily: "var(--v2-font-display)", fontSize: "3rem", color: "var(--v2-color-accent)" }}>
          {numeral ?? "GO"}
        </span>
      </div>

      <PeakV2SecondaryAction data-testid="rtt-boss-intro-skip" size="sm" className="mt-6" onClick={finish}>
        Skip
      </PeakV2SecondaryAction>
      </PeakV2CinematicStage>
    </div>
  );
}
