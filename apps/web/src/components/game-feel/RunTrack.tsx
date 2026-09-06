"use client";

/**
 * RunTrack — where you are in a run.
 *
 * A roguelike needs the player to feel "I am somewhere". This draws the
 * whole run as chapters: each act is a row of node marks ending in a boss
 * mark, acts read left to right, and the mark for the CURRENT node is the
 * brightest thing on the strip. Completed marks stay filled; upcoming ones
 * are visible but say nothing beyond their shape; a boss that cost a life
 * keeps a scar. It is state, not navigation: nothing here is clickable.
 *
 * `compact` collapses every act but the current one to its marks alone —
 * the phone treatment. Reduced motion drops the current-mark pulse.
 */

import { usePrefersReducedMotion } from "@/lib/a11y";

export type RunTrackMarkState = "done" | "current" | "locked" | "won" | "lost" | "drawn";

export interface RunTrackMark {
  key: string;
  kind: "stage" | "boss";
  state: RunTrackMarkState;
  label: string;
  /** A boss lost a life here; the mark keeps the scar. */
  lifeLost?: boolean;
}

export interface RunTrackChapter {
  key: string;
  /** "I", "II" … */
  numeral: string;
  title?: string;
  marks: RunTrackMark[];
  state: "done" | "current" | "locked";
}

export interface RunTrackProps {
  chapters: RunTrackChapter[];
  compact?: boolean;
  /** Prefix for each mark's `data-testid`, e.g. `rtt-map-row` → `rtt-map-row-a1s1`. */
  markTestIdPrefix?: string;
  testId?: string;
  className?: string;
  ariaLabel?: string;
}

const STATE_WORD: Record<RunTrackMarkState, string> = {
  done: "done",
  current: "now",
  locked: "ahead",
  won: "won",
  lost: "lost",
  drawn: "drawn",
};

export default function RunTrack({ chapters, compact = false, markTestIdPrefix = "run-track", testId = "run-track", className, ariaLabel = "Run track" }: RunTrackProps) {
  const reduced = usePrefersReducedMotion();
  return (
    <nav
      className={`gf-track ${className ?? ""}`}
      data-testid={testId}
      data-compact={compact ? "true" : "false"}
      data-reduced-motion={reduced ? "true" : "false"}
      aria-label={ariaLabel}
    >
      <ol className="gf-track-chapters">
        {chapters.map((chapter) => (
          <li
            key={chapter.key}
            className="gf-track-chapter"
            data-state={chapter.state}
            data-testid={`${testId}-chapter-${chapter.key}`}
          >
            <span className="gf-track-chapter-label">
              <span className="gf-track-chapter-eyebrow">Act</span>
              <span className="gf-track-chapter-numeral">{chapter.numeral}</span>
            </span>
            <ol className="gf-track-marks">
              {chapter.marks.map((mark) => (
                <li
                  key={mark.key}
                  className="gf-track-mark"
                  data-testid={`${markTestIdPrefix}-${mark.key}`}
                  data-row-kind={mark.kind}
                  data-row-state={mark.state}
                  data-life-lost={mark.lifeLost ? "true" : "false"}
                  aria-current={mark.state === "current" ? "step" : undefined}
                >
                  <span className="gf-track-dot" aria-hidden="true" />
                  <span className="gf-track-mark-label">{mark.label}</span>
                  <span className="sr-only">
                    {mark.kind === "boss" ? "Boss" : "Stop"}: {mark.label}, {STATE_WORD[mark.state]}
                    {mark.lifeLost ? ", life lost" : ""}
                  </span>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
    </nav>
  );
}
