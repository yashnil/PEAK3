"use client";

/**
 * Real, client-only "resume a run" state for PEAK3 V2 (Pass 3).
 *
 * RUN THE TABLE progress is localStorage-only (CLAUDE.md's Phase 1 known
 * limitation — no user accounts), so a server component can never know
 * whether a visitor has a run in progress. `loadActiveRun()` already reads
 * that pointer (see `HeroLauncher`, unchanged); this hook goes one step
 * further and fetches the run's real current public state so V2's cinematic
 * "Act 4 — The Wall" resume moment can render actual credits/lives/stage/
 * boss data instead of just a "Continue Run" link with no state attached.
 *
 * Fails closed: a 404 (finished/expired run — `shouldClearStoredRun`'s own
 * codes), a network error, or no stored pointer at all all resolve to
 * `run: null` — the caller falls back to its non-resume presentation, never
 * a loading spinner or a broken card.
 */

import { useEffect, useState } from "react";
import { loadActiveRun, isTerminal } from "./run-the-table-state";
import { getRun } from "./run-the-table-api";
import type { RunPublicState } from "@/types/run-the-table";

export interface RttResumeState {
  /** `undefined` while the client-only check is in flight (first paint is
   *  always the no-resume state — see the module docstring on why this can
   *  only be known after mount). `null` once resolved with nothing to
   *  resume. A real, live `RunPublicState` otherwise. */
  run: RunPublicState | null | undefined;
}

export function useRttResumeState(): RttResumeState {
  const [run, setRun] = useState<RunPublicState | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const pointer = loadActiveRun();
    if (!pointer) {
      setRun(null);
      return;
    }
    getRun(pointer.run_id)
      .then((state) => {
        if (cancelled) return;
        // A concluded/abandoned run is not "in progress" — the result
        // screen or a fresh start is the truthful next step for it, not a
        // resume card claiming a live act/stage.
        setRun(isTerminal(state.status) || state.abandoned ? null : state);
      })
      .catch(() => {
        if (!cancelled) setRun(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { run };
}
