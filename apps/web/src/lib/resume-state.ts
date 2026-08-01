"use client";

/**
 * "Is anything of mine still in flight?" — one answer, for the navigation.
 *
 * The mobile drawer offers a direct "Resume run" action, and the only honest
 * way to decide whether to render it is to look at the same localStorage the
 * game itself resumes from. Three rules make that safe:
 *
 *   1. READ-ONLY. Nothing here writes, clears or migrates storage. The owning
 *      module (`lib/run-the-table-state.ts`, W4) stays the only writer, so this
 *      file can never be the reason a run is lost.
 *   2. NEVER THROWS. A corrupt localStorage entry must never take the navbar
 *      down with it — every reader is wrapped, and every failure degrades to
 *      "nothing in flight", which is the same state a first-time visitor has.
 *   3. SSR-SAFE. Returns the empty summary during server rendering. The hook
 *      below reads AFTER mount rather than during render, so the server and the
 *      first client render agree and React never reports a hydration mismatch.
 *
 * Owner: W1 (UX / Organization / Polish pass).
 */

import { useEffect, useState } from "react";
import { loadActiveRun } from "@/lib/run-the-table-state";
import { hasCompleted, loadArchive, todayUtc } from "@/lib/daily-grid-archive";
import { RUN_THE_TABLE_RUNS_HREF } from "@/lib/modes";
import type { RunType } from "@/types/run-the-table";

export interface ResumableRun {
  runId: string;
  runType: RunType;
  /** ISO timestamp of the last save, or "" when the stored record predates it. */
  updatedAt: string;
  /** Where to send the player. Always the mode's own route — see modes.ts. */
  href: string;
  /** "Resume run" / "Resume today's run" — named for the run type. */
  label: string;
}

export interface DailyGridStanding {
  /** UTC date the archive was evaluated against. */
  date: string;
  /** Has today's board already been finished? */
  completedToday: boolean;
  currentStreak: number;
}

export interface ResumeSummary {
  /** True when at least one surface has something worth returning to. */
  hasAnything: boolean;
  run: ResumableRun | null;
  dailyGrid: DailyGridStanding | null;
}

export const EMPTY_RESUME_STATE: ResumeSummary = {
  hasAnything: false,
  run: null,
  dailyGrid: null,
};

const RUN_LABELS: Record<RunType, string> = {
  standard: "Resume your run",
  daily: "Resume today's run",
  challenge: "Resume challenge run",
};

function readRun(): ResumableRun | null {
  try {
    const stored = loadActiveRun();
    if (!stored) return null;
    return {
      runId: stored.run_id,
      runType: stored.run_type,
      updatedAt: stored.updated_at,
      href: RUN_THE_TABLE_RUNS_HREF,
      label: RUN_LABELS[stored.run_type] ?? RUN_LABELS.standard,
    };
  } catch {
    // `loadActiveRun` is already hardened, but it is not this module's to
    // guarantee — a future change there must not be able to break the navbar.
    return null;
  }
}

function readDailyGrid(now: Date): DailyGridStanding | null {
  try {
    const date = todayUtc(now);
    const archive = loadArchive(date);
    if (!archive || archive.entries.length === 0) return null;
    return {
      date,
      completedToday: hasCompleted(archive, date),
      currentStreak: archive.current_streak ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Reads every resumable surface. Synchronous, cheap, and safe to call from an
 * effect on every route change.
 *
 * `now` is injectable so a test can pin the UTC day rather than racing midnight.
 */
export function readResumeState(now: Date = new Date()): ResumeSummary {
  if (typeof window === "undefined") return EMPTY_RESUME_STATE;

  const run = readRun();
  const dailyGrid = readDailyGrid(now);

  return {
    // The daily grid alone is not "in flight" — a finished board is a record,
    // not something to resume. Only an unfinished board counts.
    hasAnything: run !== null || (dailyGrid !== null && !dailyGrid.completedToday),
    run,
    dailyGrid,
  };
}

/**
 * The same summary as React state.
 *
 * Starts at `EMPTY_RESUME_STATE` and fills in after mount, so the markup the
 * server produced and the markup the client first produces are identical. The
 * cost is that the "Resume run" row appears one frame late; the alternative is
 * a hydration error on every page load for anyone mid-run.
 *
 * `refreshKey` re-reads when it changes — the drawer passes its open state, so
 * a run started in another tab shows up the next time the drawer is opened.
 */
export function useResumeState(refreshKey?: unknown): ResumeSummary {
  const [state, setState] = useState<ResumeSummary>(EMPTY_RESUME_STATE);

  useEffect(() => {
    setState(readResumeState());
  }, [refreshKey]);

  return state;
}
