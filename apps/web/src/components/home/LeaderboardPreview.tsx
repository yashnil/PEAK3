"use client";

/**
 * The homepage's leaderboard preview (SYNTHESIS_CONTRACT.md §7): "82-0
 * all-time, daily, personal best, authenticated state."
 *
 * Every row is a real fetch against the same endpoints the leaderboard
 * hub (`/arena/court/leaderboard`, also `platform`-owned) uses — no
 * numbers are duplicated or re-derived here. Client-side, like the hub
 * page itself: this is read-after-mount data (today's status, a signed-in
 * visitor's own personal best), not something the server can know at
 * request time for an anonymous visitor.
 *
 * DEGRADES HONESTLY: leaderboard disabled -> the section says so instead
 * of rendering an empty table; signed out -> no personal-best row at all
 * (never a fake "Sign in to see" placeholder number).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Trophy } from "lucide-react";
import { getLeaderboard, getDailyChallenge, getMyPersonalBests } from "@/lib/perfect-season-api";
import { getAccessToken } from "@/lib/auth";
import { useAuth } from "@/lib/auth-context";
import type { DailyChallenge, PerfectSeasonRunPublic, PersonalBests } from "@/types/perfect-season";
import { EmptyState } from "@/components/ui";

const PREVIEW_COUNT = 3;

export default function LeaderboardPreview() {
  const { user, supabaseEnabled } = useAuth();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [topRuns, setTopRuns] = useState<PerfectSeasonRunPublic[] | null>(null);
  const [daily, setDaily] = useState<DailyChallenge | null>(null);
  const [personalBest, setPersonalBest] = useState<PersonalBests | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLeaderboard({ mode: "apex_1y", limit: PREVIEW_COUNT })
      .then((r) => {
        if (cancelled) return;
        setEnabled(r.leaderboard_enabled);
        setTopRuns(r.runs);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    getDailyChallenge("apex_1y")
      .then((d) => {
        if (!cancelled) setDaily(d);
      })
      .catch(() => {
        if (!cancelled) setDaily(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Personal best only for a signed-in visitor, and only after the base
  // section is worth showing at all.
  useEffect(() => {
    if (!user || !supabaseEnabled) {
      setPersonalBest(null);
      return;
    }
    let cancelled = false;
    getAccessToken()
      .then((token) => {
        if (!token) return null;
        return getMyPersonalBests(token);
      })
      .then((bests) => {
        if (!cancelled) setPersonalBest(bests);
      })
      .catch(() => {
        if (!cancelled) setPersonalBest(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user, supabaseEnabled]);

  if (enabled === false) {
    return (
      <section className="px-4 py-14" aria-labelledby="leaderboard-preview-heading">
        <div className="mx-auto max-w-5xl">
          <h2 id="leaderboard-preview-heading" className="font-display text-xl font-bold">
            Leaderboards
          </h2>
          <EmptyState
            className="mt-5"
            title="The global leaderboard isn't enabled yet"
            description="82-0 PEAK Season play is still fully available — submitting a run to the leaderboard is what's paused."
            data-testid="home-leaderboard-preview-disabled"
          />
        </div>
      </section>
    );
  }

  return (
    <section className="px-4 py-14" aria-labelledby="leaderboard-preview-heading">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="leaderboard-preview-heading" className="font-display text-xl font-bold">
            Leaderboards
          </h2>
          <Link
            href="/arena/court/leaderboard"
            data-testid="home-leaderboard-preview-link"
            className="arena-inline-link"
            style={{ color: "var(--text-secondary)" }}
          >
            All Arena leaderboards
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {/* 82-0 all-time top rows */}
          <div
            className="rounded-xl border p-4"
            style={{ borderColor: "var(--border-default)", background: "var(--bg-surface)" }}
          >
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              82-0 · All-Time
            </p>
            {topRuns === null ? (
              <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
                Loading…
              </p>
            ) : topRuns.length === 0 ? (
              <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
                No runs submitted yet.
              </p>
            ) : (
              <ol className="mt-2 flex flex-col gap-1.5" data-testid="home-leaderboard-top-rows">
                {topRuns.map((r, i) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="w-4 shrink-0 text-right font-mono text-xs"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {i + 1}
                      </span>
                      <span className="truncate font-semibold" style={{ color: "var(--text-primary)" }}>
                        {r.display_name}
                      </span>
                    </span>
                    <span
                      className="shrink-0 font-bold"
                      style={{ color: "var(--peak-accent)", fontVariantNumeric: "tabular-nums" }}
                    >
                      {r.wins}-{r.losses}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* Daily status + personal best (authenticated state) */}
          <div
            className="rounded-xl border p-4"
            style={{ borderColor: "var(--border-default)", background: "var(--bg-surface)" }}
          >
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              82-0 · Today
            </p>
            <p className="mt-2 text-sm" style={{ color: "var(--text-primary)" }}>
              {daily
                ? daily.already_played
                  ? "You've played today's board."
                  : "Today's board is ready."
                : "Checking…"}
            </p>

            {supabaseEnabled && user ? (
              <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
                <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                  Your personal best
                </p>
                {personalBest?.best_lineup_score !== null && personalBest?.best_lineup_score !== undefined ? (
                  <p
                    className="mt-1 flex items-baseline gap-1.5"
                    data-testid="home-leaderboard-personal-best"
                  >
                    <Trophy size={13} aria-hidden="true" style={{ color: "var(--peak-accent)" }} />
                    <span
                      className="score-number text-lg font-bold"
                      style={{ color: "var(--peak-accent)", fontVariantNumeric: "tabular-nums" }}
                    >
                      {personalBest.best_lineup_score.toFixed(1)}
                    </span>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      across {personalBest.total_runs} run{personalBest.total_runs === 1 ? "" : "s"}
                    </span>
                  </p>
                ) : (
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    No scored runs saved yet.
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
                Sign in to track your own personal best.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
