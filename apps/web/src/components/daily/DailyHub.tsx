"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Grid3x3, Swords } from "lucide-react";
import GameCard from "@/components/shared/GameCard";
import type { DailyGridArchive } from "@/types/daily-grid";
import {
  formatCountdown,
  hasCompleted,
  loadArchive,
  msUntilNextBoard,
  todayUtc,
} from "@/lib/daily-grid-archive";

/**
 * The Daily hub: every PEAK3 game that resets once a day, in one place.
 *
 * Phase 12A. The Daily Grid lived at `/daily` and Peak Duel Daily at
 * `/play/daily`, with nothing linking them — a player who found one had no way
 * to discover the other. The Grid moved to `/daily/grid` and this became the
 * hub.
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
  const [today, setToday] = useState("");
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    setArchive(loadArchive());
    setToday(todayUtc());
    const update = () => setCountdown(msUntilNextBoard());
    update();
    const id = window.setInterval(update, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const gridPlayed = today !== "" && archive !== null && hasCompleted(archive, today);
  const streak = archive?.current_streak ?? 0;

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
          Two PEAK3 games reset at midnight UTC, and everyone worldwide gets the same one. Come
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
          </p>
        )}
      </header>

      <section className="mt-6" aria-label="Daily games">
        <div className="grid gap-3 sm:grid-cols-2">
          <GameCard
            testId="daily-hub-grid-card"
            href="/daily/grid"
            eyebrow="Puzzle"
            title="Daily Grid Challenge"
            description="Fill a 3x3 grid with exact NBA player-seasons — nine squares, nine different players. Scores stay hidden until each pick locks, then you are measured against the day's maximum."
            icon={<Grid3x3 size={17} />}
            meta={["3x3 board", "Picks are final", "One player per board"]}
            cta={gridPlayed ? "See your result" : "Play today's grid"}
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
            href="/play/daily"
            eyebrow="Head to head"
            title="Peak Duel Daily"
            description="Ten questions, one board for everyone: pick which player's peak PEAK3 rates higher. Fast, and the same ten comparisons worldwide."
            icon={<Swords size={17} />}
            meta={["10 questions", "Same board for everyone"]}
            cta="Play today's duel"
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

      <section className="mt-6" aria-label="Other modes">
        <p
          className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em]"
          style={{ color: "var(--text-muted)" }}
        >
          Looking for the main mode?
        </p>
        <GameCard
          testId="daily-hub-flagship-card"
          href="/arena/court/practice/apex_1y"
          eyebrow="Flagship"
          title="82-0 PEAK Season"
          description="Build an eight-slot roster from spun player-seasons and simulate a full season. The deepest PEAK3 mode — play it any time, not just once a day."
          meta={["8 roster slots", "Full-season simulation"]}
          cta="Build a roster"
        />
      </section>
    </div>
  );
}
