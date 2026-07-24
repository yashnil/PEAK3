"use client";

import { useState, useEffect } from "react";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import { getLeaderboard, getPeaks } from "@/lib/api";
import type { LeaderboardRow, LeaderboardResponse, PeaksResponse } from "@/types";
import { cn } from "@/lib/utils";
import Link from "next/link";
import PlayerAvatar from "@/components/court/PlayerAvatar";

const DURATION_OPTIONS = [1, 2, 3, 5] as const;
const PEAK_WINDOW_OPTIONS = ["1y", "3y", "5y"] as const;
const PAGE_SIZE = 50;

type Pool = "top250" | "top1000";

export default function RankingsPage() {
  const [pool, setPool] = useState<Pool>("top250");
  const [years, setYears] = useState<1 | 2 | 3 | 5>(1);
  const [peakWindow, setPeakWindow] = useState<"1y" | "3y" | "5y">("1y");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [peaksData, setPeaksData] = useState<PeaksResponse | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Reset offset on filter change
  useEffect(() => {
    setOffset(0);
  }, [years, debouncedSearch, pool]);

  // Load data (Top 250 canonical pool)
  useEffect(() => {
    if (pool !== "top250") return;
    setLoading(true);
    setError(null);
    getLeaderboard(years, {
      limit: PAGE_SIZE,
      offset,
      search: debouncedSearch,
    })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [pool, years, offset, debouncedSearch]);

  // Load data (Top 1000 experimental, broader-universe peaks)
  useEffect(() => {
    if (pool !== "top1000") return;
    setLoading(true);
    setError(null);
    getPeaks(peakWindow, { limit: 1000, search: debouncedSearch })
      .then(setPeaksData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [pool, peakWindow, debouncedSearch]);

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-display text-3xl font-bold">PEAK3 Rankings</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {pool === "top250"
              ? "Top 250 players by consecutive peak window."
              : `Top ${peaksData?.total_available ?? 1000} players by consecutive peak window, across a broader ${peaksData?.universe_identity_count ?? ""}-player universe (experimental).`}{" "}
            <Link href="/methodology" className="text-[var(--peak-accent)] underline">
              Methodology →
            </Link>
          </p>
        </div>

        {/* Pool toggle */}
        <div className="flex gap-1 rounded-lg border border-[var(--border-default)] p-1 bg-[var(--bg-elevated)] w-fit" role="tablist" aria-label="Ranking pool">
          <button
            role="tab"
            aria-selected={pool === "top250"}
            data-testid="pool-tab-top250"
            onClick={() => setPool("top250")}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
              pool === "top250"
                ? "bg-[var(--bg-surface)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            )}
          >
            Top 250 (canonical)
          </button>
          <button
            role="tab"
            aria-selected={pool === "top1000"}
            data-testid="pool-tab-top1000"
            onClick={() => setPool("top1000")}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
              pool === "top1000"
                ? "bg-[var(--bg-surface)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            )}
          >
            PEAK Index · Top 1000
          </button>
        </div>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Duration tabs */}
          {pool === "top250" ? (
            <div className="flex gap-1 rounded-lg border border-[var(--border-default)] p-1 bg-[var(--bg-elevated)]" role="tablist" aria-label="Peak window duration">
              {DURATION_OPTIONS.map((y) => (
                <button
                  key={y}
                  role="tab"
                  aria-selected={years === y}
                  onClick={() => setYears(y)}
                  className={cn(
                    "rounded-md px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
                    years === y
                      ? "bg-[var(--bg-surface)] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  )}
                >
                  {y}-Year
                </button>
              ))}
            </div>
          ) : (
            <div className="flex gap-1 rounded-lg border border-[var(--border-default)] p-1 bg-[var(--bg-elevated)]" role="tablist" aria-label="Peak window duration">
              {PEAK_WINDOW_OPTIONS.map((w) => (
                <button
                  key={w}
                  role="tab"
                  aria-selected={peakWindow === w}
                  data-testid={`peak-window-tab-${w}`}
                  onClick={() => setPeakWindow(w)}
                  className={cn(
                    "rounded-md px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
                    peakWindow === w
                      ? "bg-[var(--bg-surface)] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  )}
                >
                  {w.toUpperCase()} Peaks
                </button>
              ))}
            </div>
          )}

          {/* Search */}
          <div className="relative flex-1">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
              aria-hidden="true"
            />
            <input
              type="search"
              placeholder="Search players…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search players"
              className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] pl-8 pr-4 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            />
          </div>
        </div>

        {pool === "top1000" && peaksData && (
          <p className="text-xs text-[var(--text-muted)]" data-testid="peak-index-data-version">
            Data version: {peaksData.dataset_version} · {peaksData.formula_version} · Coverage:{" "}
            {peaksData.supported_start_season}–{peaksData.supported_end_season}
          </p>
        )}

        {/* Table */}
        {pool === "top1000" ? (
          <div className="card-elevated overflow-hidden">
            {loading && (
              <div className="py-12 text-center text-sm text-[var(--text-muted)] animate-pulse" role="status">
                Loading…
              </div>
            )}
            {error && (
              <div className="py-12 text-center text-sm text-[var(--incorrect)]" role="alert">
                {error}
              </div>
            )}
            {!loading && !error && peaksData && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="peak-index-table">
                  <caption className="sr-only">PEAK3 Index -- top {peaksData.total_available} {peakWindow} peaks</caption>
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-left">
                      <th className="px-4 py-3 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider w-12">Rank</th>
                      <th className="px-4 py-3 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Player</th>
                      <th className="px-4 py-3 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Window</th>
                      <th className="px-4 py-3 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider hidden sm:table-cell">Team</th>
                      <th className="px-4 py-3 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {peaksData.rows.map((row) => (
                      <tr key={row.player_slug + row.window_label} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface)] transition-colors" data-testid="peak-index-row">
                        <td className="px-4 py-3 text-[var(--text-muted)] score-number font-medium">{row.rank}</td>
                        <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
                          <div className="flex items-center gap-2">
                            <PlayerAvatar name={row.player_name} size={24} imageUrl={row.headshot_url} />
                            {row.player_name}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[var(--text-secondary)] text-xs">{row.window_label}</td>
                        <td className="px-4 py-3 text-[var(--text-secondary)] text-xs hidden sm:table-cell">{row.team ?? "—"}</td>
                        <td className="px-4 py-3 text-right score-number font-bold text-[var(--peak-accent)]">{row.prime_score.toFixed(1)}</td>
                      </tr>
                    ))}
                    {peaksData.rows.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">
                          No players match &ldquo;{debouncedSearch}&rdquo;
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {!loading && !error && peaksData && peaksData.total_available < 1000 && !debouncedSearch && (
              <p className="px-4 py-2 text-[11px]" style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border-subtle)" }} data-testid="peak-index-eligibility-note">
                {peaksData.total_available.toLocaleString()} rows for {peakWindow.toUpperCase()} — this is the real count of
                players with at least one eligible {peakWindow.replace("y", "")}-consecutive-season window in the data, not a
                cap or a bug. Shorter windows (1Y) have more eligible players than longer ones (5Y needs 5 consecutive
                qualifying seasons).
              </p>
            )}
          </div>
        ) : (
        <div className="card-elevated overflow-hidden">
          {loading && (
            <div className="py-12 text-center text-sm text-[var(--text-muted)] animate-pulse" role="status">
              Loading…
            </div>
          )}
          {error && (
            <div className="py-12 text-center text-sm text-[var(--incorrect)]" role="alert">
              {error}
            </div>
          )}
          {!loading && !error && data && (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    PEAK3 {years}-year peak rankings
                  </caption>
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-left">
                      <th className="px-4 py-3 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider w-12">Rank</th>
                      <th className="px-4 py-3 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Player</th>
                      <th className="px-4 py-3 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Window</th>
                      <th className="px-4 py-3 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider text-right">Score</th>
                      <th className="px-4 py-3 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider text-right hidden lg:table-cell">SI</th>
                      <th className="px-4 py-3 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider text-right hidden lg:table-cell">TP</th>
                      <th className="px-4 py-3 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider text-right hidden lg:table-cell">Rec</th>
                      <th className="px-4 py-3 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider text-right hidden lg:table-cell">PO</th>
                      <th className="px-4 py-3 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider text-right hidden lg:table-cell">Team</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <LeaderboardTableRow key={row.id} row={row} />
                    ))}
                    {data.rows.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">
                          No players match &ldquo;{debouncedSearch}&rdquo;
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile list */}
              <div className="md:hidden divide-y divide-[var(--border-subtle)]">
                {data.rows.map((row) => (
                  <MobileLeaderboardRow key={row.id} row={row} />
                ))}
                {data.rows.length === 0 && (
                  <p className="py-12 text-center text-sm text-[var(--text-muted)]">
                    No players match &ldquo;{debouncedSearch}&rdquo;
                  </p>
                )}
              </div>

              {/* Pagination */}
              {data.total > PAGE_SIZE && (
                <div className="border-t border-[var(--border-subtle)] px-4 py-3 flex items-center justify-between">
                  <p className="text-xs text-[var(--text-muted)]">
                    {offset + 1}–{Math.min(offset + PAGE_SIZE, data.total)} of {data.total}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                      aria-label="Previous page"
                      className="rounded p-1 text-[var(--text-secondary)] disabled:opacity-30 hover:bg-[var(--bg-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      type="button"
                      disabled={offset + PAGE_SIZE >= data.total}
                      onClick={() => setOffset(offset + PAGE_SIZE)}
                      aria-label="Next page"
                      className="rounded p-1 text-[var(--text-secondary)] disabled:opacity-30 hover:bg-[var(--bg-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        )}

        {/* Disclaimer */}
        <p className="text-xs text-[var(--text-muted)] text-center">
          Rankings reflect the PEAK3 formula. They are not a claim of objective historical truth.{" "}
          <Link href="/methodology" className="text-[var(--peak-accent)] underline">
            Learn about the methodology.
          </Link>
        </p>
      </div>
    </div>
  );
}

function LeaderboardTableRow({ row }: { row: LeaderboardRow }) {
  return (
    <tr className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface)] transition-colors">
      <td className="px-4 py-3 text-[var(--text-muted)] score-number font-medium">
        {row.rank}
      </td>
      <td className="px-4 py-3">
        <Link
          href={`/players/${row.player_slug}`}
          className="font-medium text-[var(--text-primary)] hover:text-[var(--peak-accent)] transition-colors"
        >
          {row.player_name}
        </Link>
      </td>
      <td className="px-4 py-3 text-[var(--text-secondary)] text-xs">
        {row.start_season === row.end_season
          ? row.start_season
          : `${row.start_season} – ${row.end_season}`}
      </td>
      <td className="px-4 py-3 text-right score-number font-bold text-[var(--peak-accent)]">
        {row.prime_score.toFixed(1)}
      </td>
      <td className="px-4 py-3 text-right score-number text-xs text-[var(--text-muted)] hidden lg:table-cell" style={{ color: "var(--comp-si)" }}>
        {row.components.statistical_impact.toFixed(1)}
      </td>
      <td className="px-4 py-3 text-right score-number text-xs text-[var(--text-muted)] hidden lg:table-cell" style={{ color: "var(--comp-tp)" }}>
        {row.components.traditional_production.toFixed(1)}
      </td>
      <td className="px-4 py-3 text-right score-number text-xs text-[var(--text-muted)] hidden lg:table-cell" style={{ color: "var(--comp-rec)" }}>
        {row.components.individual_recognition.toFixed(1)}
      </td>
      <td className="px-4 py-3 text-right score-number text-xs text-[var(--text-muted)] hidden lg:table-cell" style={{ color: "var(--comp-po)" }}>
        {row.components.postseason_individual_value.toFixed(1)}
      </td>
      <td className="px-4 py-3 text-right score-number text-xs text-[var(--text-muted)] hidden lg:table-cell" style={{ color: "var(--comp-team)" }}>
        {row.components.team_achievement.toFixed(1)}
      </td>
    </tr>
  );
}

function MobileLeaderboardRow({ row }: { row: LeaderboardRow }) {
  return (
    <Link
      href={`/players/${row.player_slug}`}
      className="flex items-center gap-4 px-4 py-4 hover:bg-[var(--bg-surface)] transition-colors"
    >
      <span className="w-8 shrink-0 text-center text-sm font-medium text-[var(--text-muted)] score-number">
        {row.rank}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-[var(--text-primary)] truncate">{row.player_name}</p>
        <p className="text-xs text-[var(--text-muted)]">
          {row.start_season === row.end_season
            ? row.start_season
            : `${row.start_season} – ${row.end_season}`}
        </p>
      </div>
      <span className="score-number text-lg font-bold text-[var(--peak-accent)]">
        {row.prime_score.toFixed(1)}
      </span>
    </Link>
  );
}
