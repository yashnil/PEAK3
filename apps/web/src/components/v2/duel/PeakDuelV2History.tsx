"use client";

/**
 * PeakDuelV2History — the Daily Duel result-history grid (mission §4).
 *
 * A Wordle-style calendar of PERSISTED completions, never in-memory game
 * state: it reads `LocalProgressRepository`'s local archive and
 * `GET /game/daily/history`'s server record, merges them (`lib/
 * peak-duel-history.ts`), and renders whatever that merge returns. Nothing
 * here is computed from a `GameState` — this component takes no such prop —
 * so it renders identically whether it is mounted right after finishing
 * today's duel (`PeakDuelV2Final`) or on a cold page load days later
 * (`PeakDuelV2AlreadyCompleted`), which is what makes "survives refresh,
 * navigation and browser restart" true by construction rather than by a
 * cache that happens to still be warm.
 *
 * Renders nothing (not an empty state) when there is no history at all yet
 * — a first-ever daily has nothing to show a calendar of, and an empty grid
 * would just be visual noise on the very screen celebrating that first
 * completion.
 */

import { useEffect, useMemo, useState } from "react";
import { getDailyHistory } from "@/lib/api";
import { getProgressRepository } from "@/lib/progress";
import { todayPacific } from "@/lib/daily-time";
import { buildHistoryGrid, mergeDailyHistory, type PeakDuelHistoryDay } from "@/lib/peak-duel-history";
import type { DailyHistoryEntry } from "@/types";

const HISTORY_WINDOW_DAYS = 35; // five 7-day rows — compact, a full calendar month plus change

function cellColor(day: PeakDuelHistoryDay | null): string {
  if (!day || day.duels_total <= 0) return "var(--v2-border-subtle)";
  const ratio = day.correct_count / day.duels_total;
  if (ratio >= 0.8) return "var(--v2-color-positive)";
  if (ratio >= 0.5) return "var(--v2-color-accent)";
  return "var(--v2-color-negative)";
}

function cellLabel(day: PeakDuelHistoryDay | null): string {
  if (!day) return "No attempt on record";
  return `${day.daily_key}: ${day.correct_count}/${day.duels_total} correct`;
}

export default function PeakDuelV2History() {
  const [remote, setRemote] = useState<DailyHistoryEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDailyHistory()
      .then((r) => {
        if (!cancelled) setRemote(r.entries);
      })
      .catch(() => {
        // Fail closed: the merge below still has the local archive, so a
        // network failure degrades to "local-only history", never to a
        // crash or a fabricated one.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-read on every render's dependency change rather than once at mount:
  // `getProgressRepository()` is a singleton over `localStorage` itself, so
  // this always reflects whatever the browser has actually persisted, not a
  // snapshot taken before this component existed.
  const merged = useMemo(() => {
    const local = getProgressRepository().getAll().daily_completions;
    return mergeDailyHistory(local, remote ?? []);
  }, [remote]);

  if (merged.length === 0) return null;

  const today = todayPacific();
  const cells = buildHistoryGrid(merged, HISTORY_WINDOW_DAYS, today);

  return (
    <div className="mt-10 w-full max-w-md text-left" data-testid="peak-duel-history-grid">
      <p
        style={{
          fontFamily: "var(--v2-font-ui)",
          fontSize: "0.75rem",
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--v2-text-muted)",
        }}
      >
        Result history · last {HISTORY_WINDOW_DAYS} days
      </p>
      <div
        className="mt-4 grid grid-cols-7 gap-1.5"
        role="img"
        aria-label={`Daily duel result history: ${merged.length} completed ${merged.length === 1 ? "day" : "days"} in the last ${HISTORY_WINDOW_DAYS} days`}
        data-testid="peak-duel-history-cells"
      >
        {cells.map((day, i) => (
          <span
            key={i}
            title={cellLabel(day)}
            data-testid={`peak-duel-history-cell-${i}`}
            data-completed={day ? "true" : "false"}
            style={{
              display: "inline-block",
              width: 14,
              height: 14,
              borderRadius: 3,
              background: cellColor(day),
            }}
          />
        ))}
      </div>
    </div>
  );
}
