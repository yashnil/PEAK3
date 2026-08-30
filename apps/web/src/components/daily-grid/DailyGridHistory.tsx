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
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import PeakV2Score from "@/components/v2/PeakV2Score";
import PeakV2SecondaryAction from "@/components/v2/PeakV2SecondaryAction";
import type { V2Tone } from "@/components/v2/v2-tone";
import RecentResults from "./RecentResults";

function Stat({ label, value, tone, testId }: { label: string; value: string; tone?: V2Tone; testId: string }) {
  return (
    <div
      className="pk-depth pk-crown flex-1 rounded-lg px-3 py-2 text-center"
      style={{ border: "1px solid var(--v2-border-subtle)" }}
    >
      <PeakV2Score role="instrument" size="sm" tone={tone ?? "neutral"} value={value} label={label} valueTestId={testId} align="center" />
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
      <PeakV2Shell width="live">
        <div className="flex min-h-[50vh] items-center justify-center">
          <p role="status" data-testid="daily-history-loading" style={{ color: "var(--v2-text-muted)" }}>
            Loading your history…
          </p>
        </div>
      </PeakV2Shell>
    );
  }

  const playedToday = today !== "" && hasCompleted(archive, today);

  return (
    <PeakV2Shell width="live">
    <div className="pb-16 pt-6">
      <header>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1
              className="text-2xl font-bold sm:text-3xl"
              style={{ fontFamily: "var(--v2-font-display)", color: "var(--v2-text-primary)" }}
            >
              Daily Grid History
            </h1>
            <p className="mt-1 text-sm" style={{ color: "var(--v2-text-secondary)" }}>
              Every grid you have finished, with the score and today&rsquo;s maximum as they stood on
              the day.
            </p>
          </div>
          <PeakV2SecondaryAction href="/daily/grid" data-testid="daily-history-back" size="sm" className="shrink-0">
            Back to the grid
          </PeakV2SecondaryAction>
        </div>

        <p
          data-testid="daily-history-local-notice"
          className="pk-depth pk-crown mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed"
          style={{ color: "var(--v2-text-secondary)", border: "1px solid var(--v2-border-subtle)" }}
        >
          <strong style={{ color: "var(--v2-text-primary)" }}>Stored in this browser.</strong> Your Daily
          Grid record is not tied to an account and is not ranked against other players — clearing
          site data clears it. Only boards played on their own day count toward the streak.
        </p>
      </header>

      <div className="mt-4 flex gap-2">
        <Stat
          testId="daily-history-current-streak"
          label="Day streak"
          value={String(archive.current_streak)}
          tone="accent"
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
          tone="team"
        />
      </div>

      <div
        data-testid="daily-history-today"
        className={`pk-depth ${playedToday ? "pk-crown" : "pk-crown-accent"} mt-3 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2.5 text-sm`}
        style={{
          border: playedToday
            ? "1px solid var(--v2-border-subtle)"
            : "1px solid var(--v2-color-accent-dim, var(--v2-color-accent))",
        }}
      >
        {playedToday ? (
          <>
            <CalendarClock size={14} aria-hidden="true" style={{ color: "var(--comp-team-text)" }} />
            <strong style={{ color: "var(--comp-team-text)" }}>Today&rsquo;s grid is done.</strong>
            {countdown !== null && (
              <span style={{ color: "var(--v2-text-secondary)" }}>
                Next board in {formatCountdown(countdown)}.
              </span>
            )}
          </>
        ) : (
          <>
            <Flame size={14} aria-hidden="true" style={{ color: "var(--v2-color-accent)" }} />
            <strong style={{ color: "var(--v2-text-primary)" }}>
              You have not played today&rsquo;s grid yet.
            </strong>
            <Link
              href="/daily/grid"
              data-testid="daily-history-play-today"
              className="font-semibold underline underline-offset-2"
              style={{ color: "var(--v2-color-accent)" }}
            >
              Play it now
            </Link>
          </>
        )}
      </div>

      <section className="mt-5" aria-label="Completed grids">
        <h2
          className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em]"
          style={{ fontFamily: "var(--v2-font-mono)", color: "var(--v2-text-muted)" }}
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
    </PeakV2Shell>
  );
}
