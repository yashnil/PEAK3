"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Flame } from "lucide-react";
import { DailyGridArchive } from "@/types/daily-grid";
import { hasCompleted, loadArchive } from "@/lib/daily-grid-archive";
import { getDailyGridBoard } from "@/lib/daily-grid-api";
import {
  type DailyWindowPayload,
  extractDailyWindow,
  formatCountdown,
  localDailyWindow,
} from "@/lib/daily-time";
import { useDailyReset } from "@/lib/use-daily-reset";
import RecentResults from "./RecentResults";

function Stat({ label, value, accent, testId }: { label: string; value: string; accent?: string; testId: string }) {
  return (
    <div className="card-surface flex-1 px-3 py-3 text-center">
      <p
        data-testid={testId}
        className="score-number font-display text-2xl font-bold leading-none"
        style={{ color: accent ?? "var(--text-primary)" }}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
    </div>
  );
}

/**
 * The player's own Daily Grid record.
 *
 * LOCAL ONLY, and the page says so in as many words rather than in a footnote.
 * There is no account behind this, no server copy, and no comparison to other
 * players — a global leaderboard needs account-backed, server-validated
 * attempts, which Phase 11D deliberately stops short of shipping for anonymous
 * play (see docs/game-design/DAILY_GRID.md § Leaderboards).
 *
 * Reads storage in an effect rather than during render: this is a client
 * component under a server-rendered route, and touching localStorage during
 * the first pass would hydrate differently on the server and the client.
 */
export default function DailyGridHistory() {
  const [archive, setArchive] = useState<DailyGridArchive | null>(null);
  // The day the streak is evaluated against comes from the server's window, so
  // history and the board itself can never disagree about which day it is.
  const [window_, setWindow] = useState<DailyWindowPayload | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const board = await getDailyGridBoard();
        if (!cancelled) setWindow(extractDailyWindow(board) ?? localDailyWindow());
      } catch {
        // History is local data; it must render with no API at all. The
        // countdown falls back to the same zone the server uses.
        if (!cancelled) setWindow(localDailyWindow());
      }
      if (!cancelled) setArchive(loadArchive());
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  // Previously `[]`: `today` was captured once at mount and the countdown ran
  // to 0s and stopped there, so a page left open overnight showed a streak
  // evaluated against yesterday with an expired countdown beside it.
  const { secondsLeft } = useDailyReset({
    dailyKey: window_?.daily_key ?? null,
    secondsRemaining: window_?.seconds_remaining ?? null,
    window: window_,
    onReset: useCallback(() => setReloadToken((t) => t + 1), []),
  });

  const today = window_?.daily_key ?? "";
  const countdown = secondsLeft ?? window_?.seconds_remaining ?? null;

  if (archive === null) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p role="status" data-testid="daily-history-loading" style={{ color: "var(--text-muted)" }}>
          Loading your history…
        </p>
      </div>
    );
  }

  const playedToday = today !== "" && hasCompleted(archive, today);

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-16 pt-6 sm:px-4">
      <header>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold sm:text-3xl">Daily Grid History</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
              Every grid you have finished, with the score and today&rsquo;s maximum as they stood on
              the day.
            </p>
          </div>
          <Link
            href="/daily/grid"
            data-testid="daily-history-back"
            className="shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
          >
            Back to the grid
          </Link>
        </div>

        <p
          data-testid="daily-history-local-notice"
          className="mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed"
          style={{ background: "var(--bg-surface)", color: "var(--text-secondary)" }}
        >
          <strong style={{ color: "var(--text-primary)" }}>Stored in this browser.</strong> Your Daily
          Grid record is not tied to an account and is not ranked against other players — clearing
          site data clears it. Only boards played on their own day count toward the streak.
        </p>
      </header>

      <div className="mt-4 flex gap-2">
        <Stat
          testId="daily-history-current-streak"
          label="Day streak"
          value={String(archive.current_streak)}
          accent="var(--peak-accent)"
        />
        <Stat
          testId="daily-history-longest-streak"
          label="Longest streak"
          value={String(archive.longest_streak)}
        />
        <Stat
          testId="daily-history-total"
          label="Grids played"
          value={String(archive.total_completed)}
        />
        <Stat
          testId="daily-history-best-percent"
          label="Best % of max"
          value={archive.best_percent_of_max === null ? "—" : `${archive.best_percent_of_max}%`}
          accent="var(--comp-team)"
        />
      </div>

      <div
        data-testid="daily-history-today"
        className="mt-3 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2.5 text-sm"
        style={{
          background: playedToday ? "var(--bg-surface)" : "var(--peak-accent-bg)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        {playedToday ? (
          <>
            <CalendarClock size={14} aria-hidden="true" style={{ color: "var(--comp-team)" }} />
            <strong style={{ color: "var(--comp-team)" }}>Today&rsquo;s grid is done.</strong>
            {countdown !== null && (
              <span style={{ color: "var(--text-secondary)" }}>
                Next board in {formatCountdown(countdown)}.
              </span>
            )}
          </>
        ) : (
          <>
            <Flame size={14} aria-hidden="true" style={{ color: "var(--peak-accent)" }} />
            <strong style={{ color: "var(--text-primary)" }}>
              You have not played today&rsquo;s grid yet.
            </strong>
            <Link
              href="/daily/grid"
              data-testid="daily-history-play-today"
              className="font-semibold underline underline-offset-2"
              style={{ color: "var(--peak-accent)" }}
            >
              Play it now
            </Link>
          </>
        )}
      </div>

      <section className="mt-5" aria-label="Completed grids">
        <h2
          className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em]"
          style={{ color: "var(--text-muted)" }}
        >
          {archive.total_completed > 0
            ? `All ${archive.total_completed} completed grids`
            : "Completed grids"}
        </h2>
        <RecentResults
          entries={archive.entries}
          linkToBoards
          emptyMessage="No completed grids yet. Finish today's board and it will appear here."
        />
      </section>
    </div>
  );
}
