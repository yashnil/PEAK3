/**
 * Peak Duel Daily — result-history grid data (mission §4).
 *
 * PERSISTENCE, NOT REACT STATE. Every completed Daily Duel is already
 * persisted twice, independently, by code that predates this file:
 *
 *   - Anonymous / local: `LocalProgressRepository.recordDailyCompletion`
 *     (`lib/progress.ts`) writes one `DailyCompletion` per completed day to
 *     `localStorage`, keyed `${date}-${years}yr` where `date` is always the
 *     server's own Pacific daily key (never a browser-computed date — see
 *     `play/daily/page.tsx`'s docstring). This is the SAME anonymous
 *     persistence strategy Daily Grid's own archive uses.
 *   - Server: `POST /game/daily/result` (`GameEngine`'s completion effect)
 *     writes one row per (owner_sub, mode, daily_key) — signed-in or the
 *     anon cookie — read back here via `GET /game/daily/history`.
 *
 * This module only MERGES the two into one calendar, deterministically, by
 * Pacific daily key. It stores nothing itself and holds no game state, so
 * the grid it feeds is re-derivable from storage/API alone on a fresh page
 * load with nothing in memory.
 */
import type { DailyCompletion, DailyHistoryEntry } from "@/types";
import { shiftDailyKey } from "@/lib/daily-time";

export interface PeakDuelHistoryDay {
  /** Pacific daily key, YYYY-MM-DD. */
  daily_key: string;
  correct_count: number;
  duels_total: number;
  arena_points: number;
  best_streak: number;
  /** Where THIS merged row's numbers came from, after the merge below —
   *  `"remote"` whenever the server had a record for the day, `"local"`
   *  only when it did not (offline, not yet synced, or a guest whose
   *  browser is the only witness). Never affects rendering; kept for
   *  callers/tests that want to distinguish a server-verified day from a
   *  locally-claimed one. */
  source: "remote" | "local";
}

/**
 * Merge this browser's local Daily Duel archive with the server's own
 * record for the same identity, keyed and deduped by Pacific daily key.
 *
 * SERVER WINS ON A SHARED DAY (source of truth for a signed-in — or even
 * anonymous-but-online — identity), but a day recorded ONLY locally is
 * still kept rather than dropped: the server not having a row for a day is
 * not evidence the day was blank, it may simply not have synced yet (the
 * POST failed, the device was offline, or this is a browser whose local
 * archive predates the server ever having a row for a merge to prefer). A
 * completed day's result can therefore never be overwritten by an ABSENT
 * remote row — only replaced by an actual remote row for that same day.
 *
 * `played_on_daily_key: false` (an explicit archive replay of a past board,
 * which the API supports even though the current Peak Duel Daily UI never
 * triggers one) is excluded — this calendar answers "did you play THAT
 * day's own board", the same distinction Daily Grid's streak logic already
 * draws for its own archive.
 */
export function mergeDailyHistory(
  local: Record<string, DailyCompletion>,
  remote: DailyHistoryEntry[],
): PeakDuelHistoryDay[] {
  const byKey = new Map<string, PeakDuelHistoryDay>();

  for (const completion of Object.values(local)) {
    if (!completion || !completion.date) continue;
    byKey.set(completion.date, {
      daily_key: completion.date,
      correct_count: completion.correct,
      duels_total: completion.total,
      arena_points: completion.arena_points,
      best_streak: completion.best_streak,
      source: "local",
    });
  }

  for (const entry of remote) {
    if (!entry.played_on_daily_key) continue;
    byKey.set(entry.daily_key, {
      daily_key: entry.daily_key,
      correct_count: entry.correct_count,
      duels_total: entry.duels_total,
      arena_points: entry.arena_points,
      best_streak: entry.best_streak,
      source: "remote",
    });
  }

  return Array.from(byKey.values()).sort((a, b) => (a.daily_key < b.daily_key ? 1 : -1));
}

/**
 * A fixed-width calendar window ending at `today` (inclusive), oldest day
 * first — `null` for a day with no completed attempt on record. Building a
 * contiguous range (rather than only the days that HAVE a record) is what
 * makes a gap in the calendar visible as a gap, not just a shorter list.
 */
export function buildHistoryGrid(
  days: PeakDuelHistoryDay[],
  windowDays: number,
  today: string,
): Array<PeakDuelHistoryDay | null> {
  const byKey = new Map(days.map((d) => [d.daily_key, d]));
  const cells: Array<PeakDuelHistoryDay | null> = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const key = shiftDailyKey(today, -i);
    cells.push(byKey.get(key) ?? null);
  }
  return cells;
}
