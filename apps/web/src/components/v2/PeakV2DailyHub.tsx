/**
 * PeakV2DailyHub — the Daily hub, V2 (Pass 5 — new build; legacy had no V2
 * branch at all).
 *
 * Every value here is computed by the caller (`DailyHub.tsx`) from the exact
 * same state the legacy tree renders — this component owns presentation
 * only. Per the brief's <daily_ranked_secondary_pages> section: remove the
 * generic card-grid/pill clutter, make today's playable things the visual
 * focus, one concise daily-reset context line, clear actions.
 */

import Link from "next/link";
import PeakV2Shell from "./PeakV2Shell";
import type { ModeCopy } from "@/lib/modes";

export interface PeakV2DailyHubProps {
  dailyGrid: ModeCopy;
  peakDuel: ModeCopy;
  flagship: ModeCopy;
  peakSeason: ModeCopy;
  countdownLabel: string | null;
  gridPlayed: boolean;
  streak: number;
  totalCompleted: number;
}

export default function PeakV2DailyHub({
  dailyGrid,
  peakDuel,
  flagship,
  peakSeason,
  countdownLabel,
  gridPlayed,
  streak,
  totalCompleted,
}: PeakV2DailyHubProps) {
  return (
    <PeakV2Shell width="live">
      <header className="v2-page-header">
        <p className="v2-page-kicker">Daily · resets at midnight UTC</p>
        <h1 className="v2-page-title">A new board every day.</h1>
        <p className="v2-page-lede">
          Everyone worldwide gets the same board and the same ten questions.
          {countdownLabel ? ` Next reset in ${countdownLabel}.` : ""}
        </p>
      </header>

      <div className="v2-daily-grid">
        <Link href={dailyGrid.href} data-testid="daily-hub-grid-card" className="v2-daily-cell">
          <span className="v2-daily-cell-kicker">{gridPlayed ? "Played today" : "New board today"}</span>
          <h2 className="v2-daily-cell-title">{dailyGrid.title}</h2>
          <p className="v2-daily-cell-desc">{dailyGrid.description}</p>
          <div className="flex items-center justify-between gap-3">
            {streak > 0 ? (
              <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.75rem", fontWeight: 700, color: "var(--v2-color-accent)" }}>
                {streak} day streak
              </span>
            ) : (
              <span />
            )}
            <span className="v2-slate-cell-action">
              {gridPlayed ? "See your result" : "Play today's grid"} <span className="v2-slate-cell-arrow">→</span>
            </span>
          </div>
        </Link>
        <Link href={peakDuel.href} data-testid="daily-hub-duel-card" className="v2-daily-cell">
          <span className="v2-daily-cell-kicker">New questions today</span>
          <h2 className="v2-daily-cell-title">{peakDuel.title}</h2>
          <p className="v2-daily-cell-desc">{peakDuel.description}</p>
          <div className="flex items-center justify-end">
            <span className="v2-slate-cell-action">
              Play today&apos;s duel <span className="v2-slate-cell-arrow">→</span>
            </span>
          </div>
        </Link>
        <div className="v2-daily-row" style={{ gridColumn: "1 / -1" }}>
          <p style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-secondary)" }}>
            {totalCompleted > 0
              ? `You have finished ${totalCompleted} ${totalCompleted === 1 ? "grid" : "grids"}. Kept in this browser.`
              : "Your finished grids are kept in this browser."}
          </p>
          <Link href="/daily/history" data-testid="daily-hub-history-link" className="v2-hero-object-link">
            Daily Grid history →
          </Link>
        </div>
      </div>

      <section className="mt-10" aria-label="Play any time">
        <p className="v2-slate-heading" style={{ marginBottom: "var(--v2-space-3)" }}>
          Play any time
        </p>
        <div className="v2-daily-grid">
          <div className="v2-daily-cell">
            <span className="v2-daily-cell-kicker">Flagship</span>
            <h2 className="v2-daily-cell-title">{flagship.title}</h2>
            <p className="v2-daily-cell-desc">{flagship.description}</p>
            <div className="flex items-center justify-end">
              <Link href={flagship.href} data-testid="daily-hub-flagship-card" className="v2-slate-cell-action">
                Start a run <span className="v2-slate-cell-arrow">→</span>
              </Link>
            </div>
          </div>
          <div className="v2-daily-cell">
            <span className="v2-daily-cell-kicker">Full season</span>
            <h2 className="v2-daily-cell-title">{peakSeason.title}</h2>
            <p className="v2-daily-cell-desc">{peakSeason.description}</p>
            <div className="flex items-center justify-end">
              <Link href={peakSeason.href} data-testid="daily-hub-peak-season-card" className="v2-slate-cell-action">
                Build a roster <span className="v2-slate-cell-arrow">→</span>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </PeakV2Shell>
  );
}
