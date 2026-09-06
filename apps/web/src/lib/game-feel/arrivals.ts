"use client";

/**
 * WHICH SLOTS JUST CHANGED — derived from real state, never from a timer.
 *
 * Both courts (Three-Man Weave's three, 82-0's one) want the same beat: a
 * slot that just went from empty to filled LOCKS for a moment, and two slots
 * whose occupants just traded places light together. Diffing the occupant
 * map this render against last render is what makes the beat fire on the
 * server's pick landing in the snapshot and never on a re-render for any
 * other reason. The beat clears itself after `holdMs`; nothing waits on it.
 */

import { useEffect, useRef, useState } from "react";

export interface Arrivals {
  /** Slots that went EMPTY -> FILLED this change. */
  arrived: string[];
  /** Slots whose occupant CHANGED between two non-empty values. */
  swapped: string[];
}

const NONE: Arrivals = { arrived: [], swapped: [] };

export function useArrivals(occupants: Record<string, string | null>, holdMs = 320): Arrivals {
  const previous = useRef<Record<string, string | null> | null>(null);
  const [beat, setBeat] = useState<Arrivals>(NONE);
  const signature = Object.keys(occupants)
    .sort()
    .map((key) => `${key}=${occupants[key] ?? ""}`)
    .join("|");

  useEffect(() => {
    const prev = previous.current;
    previous.current = { ...occupants };
    if (prev === null) return;
    const arrived: string[] = [];
    const swapped: string[] = [];
    for (const key of Object.keys(occupants)) {
      const now = occupants[key] ?? null;
      const was = prev[key] ?? null;
      if (now && !was) arrived.push(key);
      else if (now && was && now !== was) swapped.push(key);
    }
    if (arrived.length === 0 && swapped.length === 0) return;
    setBeat({ arrived, swapped });
    const id = window.setTimeout(() => setBeat(NONE), holdMs);
    return () => window.clearTimeout(id);
    // `signature` is the diffable identity of `occupants`; the object itself
    // is rebuilt every render by callers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, holdMs]);

  return beat;
}
