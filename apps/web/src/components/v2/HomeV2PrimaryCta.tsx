"use client";

/**
 * HomeV2PrimaryCta — the homepage hero's primary action, with real resume
 * state restored on the V2 surface.
 *
 * ARENA-FIRST PASS (unchanged property, carried over from the legacy
 * `HeroLauncher` this replaces): the primary control always reads "GO TO
 * ARENA" and always leads to `/arena` — it never swaps to a run-specific
 * label. A player with a RUN THE TABLE run already in progress still
 * deserves a fast way back into it, so a second, still-prominent "Continue
 * Run" control renders beside the primary CTA (the bare route — resuming
 * creates nothing), with "Start New Run" one small link further down,
 * offered only once there is a run to prefer it over.
 *
 * `loadActiveRun()` is the same synchronous, localStorage-only pointer check
 * `HeroLauncher` always used — deliberately NOT `useRttResumeState()`'s
 * network-backed richer state (that hook drives `HomeV2ResumeRow`'s in-place
 * act/credits/boss text, a different real feature on the same page). This
 * control only needs to know whether a run exists, never its live detail,
 * so it renders instantly with no fetch and no loading state.
 */

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { loadActiveRun } from "@/lib/run-the-table-state";
import PeakV2PrimaryAction from "./PeakV2PrimaryAction";
import PeakV2SecondaryAction from "./PeakV2SecondaryAction";

export default function HomeV2PrimaryCta({ children }: { children?: ReactNode }) {
  const [hasActiveRun, setHasActiveRun] = useState(false);
  useEffect(() => {
    setHasActiveRun(loadActiveRun() !== null);
  }, []);

  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <PeakV2PrimaryAction href="/arena" data-testid="home-primary-cta">
          GO TO ARENA
        </PeakV2PrimaryAction>
        {hasActiveRun ? (
          <PeakV2SecondaryAction href="/arena/run-the-table" data-testid="home-launcher-resume">
            Continue Run
          </PeakV2SecondaryAction>
        ) : null}
        {children}
      </div>
      {hasActiveRun ? (
        <a
          href="/arena/run-the-table?start=standard"
          data-testid="home-launcher-standard"
          className="v2-hero-object-link"
        >
          Start New Run
        </a>
      ) : null}
    </div>
  );
}
