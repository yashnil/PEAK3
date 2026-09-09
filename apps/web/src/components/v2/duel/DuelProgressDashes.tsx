"use client";

/**
 * The ten-matchup session strip, shared by the question and the reveal.
 *
 * IT LIVES HERE BECAUSE THE PAGE WAS MOVING UNDER THE PLAYER. The strip was
 * private to `PeakDuelV2Question`, so on Daily it existed between the header
 * and the cards while the player was deciding and vanished the moment the
 * answer landed. Both components pin their header-to-grid gap at `mt-10`
 * precisely so the cards never move (see the comment above the reveal's
 * grid, and `duel-viewport.spec.ts`), and this one element was quietly
 * breaking that on Daily: measured, the cards jumped ~18px on every pick,
 * ten times per daily session. `duel-viewport.spec.ts` did not catch it
 * because that spec runs on Endless, which has no strip in either phase.
 *
 * Rendering it in both phases is also the better product answer. The strip
 * is where a session's progress is legible, and the reveal is the moment
 * that progress actually changes — the dash for the matchup just played
 * turns green or red as its result arrives, which is the one place it can
 * be seen doing so.
 */

import type { DuelResult } from "@/types";

export interface DuelProgressDashesProps {
  results: DuelResult[];
  total: number;
  currentIndex: number;
}

export default function DuelProgressDashes({ results, total, currentIndex }: DuelProgressDashesProps) {
  return (
    <div className="flex items-center gap-1" data-testid="duel-progress-dashes" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => {
        const result = results[i];
        const color =
          result === undefined
            ? i === currentIndex
              ? "var(--v2-color-accent)"
              : "var(--v2-border)"
            : result.correct
              ? "var(--v2-color-positive)"
              : "var(--v2-color-negative)";
        return <span key={i} style={{ width: 14, height: 3, borderRadius: 1, background: color }} />;
      })}
    </div>
  );
}
