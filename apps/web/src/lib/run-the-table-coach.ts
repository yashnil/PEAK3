"use client";

/**
 * PROGRESSIVE TEACHING for RUN THE TABLE.
 *
 * The seven-step first-run tour is gone from the run. A concept is taught the
 * first time it matters, in one line, beside the control it is about — and
 * only once per browser. Nothing here is modal, nothing gates a click, and a
 * chip that has not been dismissed is simply left behind when the player acts.
 *
 * The comprehensive walkthrough still exists (`RUN_THE_TABLE_TOUR`) behind
 * "How to play"; it is never opened by itself.
 */

import { useCallback, useEffect, useState } from "react";

export const RTT_COACH_STORAGE_KEY = "peak3.run-the-table.coach";
export const RTT_COACH_SCHEMA_VERSION = 1;

export type CoachKey = "first_choice" | "first_credit" | "first_life_risk" | "first_boss" | "first_scout";

export interface CoachCopy {
  title: string;
  body: string;
}

export const COACH_COPY: Record<CoachKey, CoachCopy> = {
  first_choice: {
    title: "Pick one. It joins your lineup.",
    body: "A card fits only the slots its role allows. Pass and you keep every credit.",
  },
  first_credit: {
    title: "Credits are limited for the entire run.",
    body: "There is no salary refresh. Boss wins and rest stops are the only income.",
  },
  first_boss: {
    title: "Boss battle — this decision has larger consequences.",
    body: "Your five lanes are scored against theirs. Lose, and one life is gone.",
  },
  first_life_risk: {
    title: "Lose this battle and one life is gone.",
    body: "Three lives for the whole run. At zero, the run ends where it stands.",
  },
  first_scout: {
    title: "Scouting is free. It shows the next boss before you meet it.",
    body: "Prepare one lane for that battle, or spend credits to shape the next market.",
  },
};

interface CoachRecord {
  schema_version: number;
  seen: CoachKey[];
}

function read(): CoachRecord {
  if (typeof window === "undefined") return { schema_version: RTT_COACH_SCHEMA_VERSION, seen: [] };
  try {
    const raw = window.localStorage.getItem(RTT_COACH_STORAGE_KEY);
    if (!raw) return { schema_version: RTT_COACH_SCHEMA_VERSION, seen: [] };
    const parsed = JSON.parse(raw) as Partial<CoachRecord>;
    if (parsed.schema_version !== RTT_COACH_SCHEMA_VERSION || !Array.isArray(parsed.seen)) {
      return { schema_version: RTT_COACH_SCHEMA_VERSION, seen: [] };
    }
    return { schema_version: RTT_COACH_SCHEMA_VERSION, seen: parsed.seen.filter((k): k is CoachKey => k in COACH_COPY) };
  } catch {
    return { schema_version: RTT_COACH_SCHEMA_VERSION, seen: [] };
  }
}

function write(record: CoachRecord): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RTT_COACH_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage blocked: the chip shows again next time, which is harmless.
  }
}

export function coachSeen(key: CoachKey): boolean {
  return read().seen.includes(key);
}

export function markCoachSeen(key: CoachKey): void {
  const record = read();
  if (record.seen.includes(key)) return;
  write({ ...record, seen: [...record.seen, key] });
  listeners.forEach((l) => l());
}

/** Every coach chip shows again — used by tests and by "How to play". */
export function resetCoach(): void {
  write({ schema_version: RTT_COACH_SCHEMA_VERSION, seen: [] });
  listeners.forEach((l) => l());
}

const listeners = new Set<() => void>();

/**
 * Whether the chip for `key` should be on screen right now.
 *
 * `active` is the caller's "this concept matters on this screen" flag. The
 * answer is read from storage on the client after mount (never during SSR,
 * where it would always be "show"), so the chip appears on the first paint
 * that can know, and never flashes for a returning player.
 */
export function useCoach(key: CoachKey, active: boolean): { show: boolean; dismiss: () => void } {
  const [seen, setSeen] = useState(true);
  useEffect(() => {
    const sync = () => setSeen(coachSeen(key));
    sync();
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, [key]);
  const dismiss = useCallback(() => markCoachSeen(key), [key]);
  return { show: active && !seen, dismiss };
}
