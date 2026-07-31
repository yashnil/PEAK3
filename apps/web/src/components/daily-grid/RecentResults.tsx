"use client";

import Link from "next/link";
import { DailyGridArchiveEntry } from "@/types/daily-grid";
import { formatElapsed } from "@/lib/daily-grid-state";

interface Props {
  entries: DailyGridArchiveEntry[];
  /** Rendered when there is nothing yet. */
  emptyMessage?: string;
  /** Link each row to its archive board. Off on the completion panel, where a
   *  link away from the result the player just earned is the wrong offer. */
  linkToBoards?: boolean;
}

/**
 * A list of finished Daily Grid boards, newest first.
 *
 * Shared by the completion panel (a short preview) and /daily/history (the
 * full list), so the two can never drift into showing different numbers for
 * the same day.
 *
 * Every value is read from the stored snapshot rather than recomputed — an
 * archive row is what the board actually paid on the day it was played, and
 * re-deriving it would let a later model or taxonomy change quietly rewrite
 * someone's history.
 */
export default function RecentResults({ entries, emptyMessage, linkToBoards }: Props) {
  if (entries.length === 0) {
    return (
      <p data-testid="recent-results-empty" className="text-xs" style={{ color: "var(--text-muted)" }}>
        {emptyMessage ?? "No completed grids yet. Finish today's board to start your history."}
      </p>
    );
  }

  return (
    <ul data-testid="recent-results" className="space-y-1.5">
      {entries.map((entry) => {
        const body = (
          <>
            <span className="flex min-w-0 flex-col">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                  {entry.date}
                </span>
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {entry.theme}
                </span>
                {!entry.counted_for_streak && (
                  <span
                    data-testid="recent-results-replay-tag"
                    className="rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.08em]"
                    style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}
                  >
                    Replay
                  </span>
                )}
              </span>
              <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                {entry.grade ?? "Completed"}
                {entry.elapsed_seconds !== null
                  ? ` · ${formatElapsed(entry.elapsed_seconds * 1000)}`
                  : ""}
                {` · ${entry.misses} ${entry.misses === 1 ? "miss" : "misses"}`}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span
                className="score-number font-display block text-sm font-bold"
                style={{ color: "var(--peak-accent)" }}
              >
                {entry.score}
                {entry.today_max !== null ? (
                  <span style={{ color: "var(--text-muted)" }}>/{entry.today_max}</span>
                ) : null}
              </span>
              {entry.percent_of_max !== null && (
                <span className="block text-[10px]" style={{ color: "var(--comp-team)" }}>
                  {entry.percent_of_max}%
                </span>
              )}
            </span>
          </>
        );

        const className =
          "flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-xs";
        const style = {
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
        } as const;

        return (
          <li key={entry.board_id} data-testid="recent-results-row" data-date={entry.date}>
            {linkToBoards ? (
              <Link
                href={`/daily/grid?date=${entry.date}`}
                className={`${className} transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]`}
                style={style}
                aria-label={`Review the ${entry.date} grid, ${entry.theme}, ${entry.score} points`}
              >
                {body}
              </Link>
            ) : (
              <div className={className} style={style}>
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
