"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Grid3x3, Swords, Trophy } from "lucide-react";
import GameCard from "@/components/shared/GameCard";
import { MODE_COPY } from "@/lib/modes";
import type { DailyGridArchive } from "@/types/daily-grid";
import { hasCompleted, loadArchive } from "@/lib/daily-grid-archive";
import { getDailyGridBoard } from "@/lib/daily-grid-api";
import {
  type DailyWindowPayload,
  extractDailyWindow,
  formatCountdown,
  localDailyWindow,
} from "@/lib/daily-time";
import { useDailyReset } from "@/lib/use-daily-reset";

/**
 * The Daily hub: every PEAK3 game that resets once a day, in one place.
 *
 * Phase 12A. The Daily Grid lived at `/daily` and Peak Duel Daily at
 * `/play/daily`, with nothing linking them — a player who found one had no way
 * to discover the other. The Grid moved to `/daily/grid` and this became the
 * hub.
 *
 * Every card's title/description/meta comes from `lib/modes.ts`, so this hub
 * cannot drift from the homepage and the Arena hub the way it did before. The
 * only thing this file decides is the Grid's CTA, which depends on whether you
 * already played today — state, not copy.
 *
 * The Grid's status (streak, played-today) is read from localStorage in an
 * effect, not during render: this is a client component under a server-rendered
 * route, and touching storage on the first pass would hydrate differently on
 * the server and the client. Peak Duel Daily carries no status here because its
 * completion lives in a different store — showing a blank where the Grid shows
 * a streak would read as "you have no streak" rather than "not tracked here".
 */
export default function DailyHub() {
  const [archive, setArchive] = useState<DailyGridArchive | null>(null);
  // The server's window. `today` is read off it rather than computed here, so
  // this page and the board the player is about to open can never disagree
  // about which day it is.
  const [window_, setWindow] = useState<DailyWindowPayload | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const board = await getDailyGridBoard();
        if (cancelled) return;
        setWindow(extractDailyWindow(board) ?? localDailyWindow());
      } catch {
        // The hub is navigation, not gameplay: if the API is unreachable it
        // still has to render every card. The countdown falls back to the same
        // zone and the same arithmetic the server uses, which is right unless
        // this device's own clock is wrong.
        if (!cancelled) setWindow(localDailyWindow());
      }
      // The archive is read after the window so `today` and the streak are
      // evaluated against the same day.
      if (!cancelled) setArchive(loadArchive());
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  // Re-derives everything at the boundary, and on returning to a tab that was
  // away past it. This effect used to have `[]` deps and never ran again: the
  // countdown ticked to 0s and stayed there, and "played today" kept pointing
  // at yesterday until the page was reloaded by hand.
  const { secondsLeft } = useDailyReset({
    dailyKey: window_?.daily_key ?? null,
    secondsRemaining: window_?.seconds_remaining ?? null,
    window: window_,
    onReset: useCallback(() => setReloadToken((t) => t + 1), []),
  });

  const today = window_?.daily_key ?? "";
  const countdown = secondsLeft ?? window_?.seconds_remaining ?? null;
  const gridPlayed = today !== "" && archive !== null && hasCompleted(archive, today);
  const streak = archive?.current_streak ?? 0;

  const dailyGrid = MODE_COPY["daily-grid"];
  const peakDuel = MODE_COPY["peak-duel"];
  const flagship = MODE_COPY["run-the-table"];
  const peakSeason = MODE_COPY["peak-season"];

  return (
    <div className="mx-auto w-full max-w-5xl px-3 pb-16 pt-8 sm:px-4">
      <header className="home-hero-glow -mx-3 rounded-2xl px-4 py-8 sm:-mx-4 sm:px-6 sm:py-10">
        <p
          className="text-[11px] font-bold uppercase tracking-[0.2em]"
          style={{ color: "var(--peak-accent)" }}
        >
          Daily Games
        </p>
        <h1 className="font-display mt-2 text-3xl font-bold sm:text-4xl">
          A new board every day.
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed sm:text-base" style={{ color: "var(--text-secondary)" }}>
          New daily board at midnight PT, and everyone worldwide gets the same one. Come
          back tomorrow for a different puzzle.
        </p>
        {countdown !== null && (
          <p
            data-testid="daily-hub-countdown"
            className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs"
            style={{ background: "var(--bg-surface)", color: "var(--text-secondary)" }}
          >
            <CalendarClock size={13} aria-hidden="true" style={{ color: "var(--peak-accent)" }} />
            Next boards in {formatCountdown(countdown)}
            <span className="sr-only"> (new daily board at midnight PT)</span>
          </p>
        )}
      </header>

      <section className="mt-6" aria-label="Daily games">
        <div className="grid gap-3 sm:grid-cols-2">
          <GameCard
            testId="daily-hub-grid-card"
            href={dailyGrid.href}
            eyebrow={dailyGrid.eyebrow}
            title={dailyGrid.title}
            description={dailyGrid.description}
            icon={<Grid3x3 size={17} />}
            meta={dailyGrid.meta}
            cta={gridPlayed ? "See your result" : dailyGrid.cta}
            status={
              archive === null ? null : (
                <span className="flex flex-col items-end gap-1">
                  {gridPlayed && (
                    <span
                      data-testid="daily-hub-grid-played"
                      className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em]"
                      style={{ background: "var(--correct-bg)", color: "var(--correct)" }}
                    >
                      Played today
                    </span>
                  )}
                  {streak > 0 && (
                    <span
                      data-testid="daily-hub-grid-streak"
                      className="text-[11px] font-semibold"
                      style={{ color: "var(--peak-accent)" }}
                    >
                      {streak} day streak
                    </span>
                  )}
                </span>
              )
            }
          />

          <GameCard
            testId="daily-hub-duel-card"
            href={peakDuel.href}
            eyebrow={peakDuel.eyebrow}
            title={peakDuel.title}
            description={peakDuel.description}
            icon={<Swords size={17} />}
            meta={peakDuel.meta}
            cta={peakDuel.cta}
          />
        </div>
      </section>

      <section className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}
      >
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {archive && archive.total_completed > 0
            ? `You have finished ${archive.total_completed} ${archive.total_completed === 1 ? "grid" : "grids"}.`
            : "Your finished grids are kept in this browser."}
        </p>
        <Link
          href="/daily/history"
          data-testid="daily-hub-history-link"
          className="text-xs font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          style={{ color: "var(--peak-accent)" }}
        >
          Daily Grid history →
        </Link>
      </section>

      {/* The modes you can play any time, not just once a day. The flagship
          leads; 82-0 PEAK Season sits beside it rather than being dropped —
          plenty of players arrive here for it specifically. */}
      <section className="mt-6" aria-label="Play any time">
        <p
          className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em]"
          style={{ color: "var(--text-muted)" }}
        >
          Play any time
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <GameCard
            testId="daily-hub-flagship-card"
            href={flagship.href}
            eyebrow={flagship.eyebrow}
            title={flagship.title}
            description={flagship.description}
            icon={<Swords size={17} />}
            meta={flagship.meta}
            cta={flagship.cta}
          />
          <GameCard
            testId="daily-hub-peak-season-card"
            href={peakSeason.href}
            eyebrow={peakSeason.eyebrow}
            title={peakSeason.title}
            description={peakSeason.description}
            icon={<Trophy size={17} />}
            meta={peakSeason.meta}
            cta={peakSeason.cta}
          />
        </div>
      </section>
    </div>
  );
}
