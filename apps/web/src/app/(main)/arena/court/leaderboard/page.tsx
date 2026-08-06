"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, Swords, Trophy } from "lucide-react";
import { getDailyChallenge } from "@/lib/perfect-season-api";
import { DailyChallenge } from "@/types/perfect-season";
import { EmptyState } from "@/components/ui";
import PeakSeasonLeaderboard from "@/components/court/PeakSeasonLeaderboard";

/**
 * Arena Leaderboards.
 *
 * SYNTHESIS_CONTRACT.md §7 asks for one destination covering every scored
 * mode's standing, not just 82-0's. What is actually real today, per
 * `SCORE_RECONCILIATION.md` §5, decides what each section shows:
 *
 *   - 82-0: real, functional (Phase 6G Part E), and now a finished board
 *     rather than a debug table — `PeakSeasonLeaderboard` owns the modes, the
 *     all-time/today window, pagination, "Your best", the receipt link, and
 *     the four states this page used to collapse into two. The collapse was
 *     the defect: a `catch` here set `enabled = false`, so a connection
 *     failure and a disabled capability rendered the identical sentence,
 *     "The global leaderboard isn't enabled yet."
 *   - 82-0 DAILY STATUS: NOT a second leaderboard. The board's own "Submitted
 *     today" window is the same query filtered to the current application day
 *     (`nba_peak.daily_key.day_start_utc`), which is all the data supports —
 *     `SCORE_RECONCILIATION.md` §5: "82-0 is an all-time board per mode; no
 *     daily reset applies." The section below is today's real daily-challenge
 *     STATUS (`GET /perfect-season/daily`) and a link to play it.
 *   - RUN THE TABLE: deferred. SYNTHESIS_CONTRACT.md §9: "RTT deferred (its
 *     score contract is explicitly NOT defined this pass)." Said plainly,
 *     not silently omitted.
 *   - RANKED: `PEAK3_RANKED_*` flags stay off for this whole pass
 *     (SYNTHESIS_CONTRACT.md §10). Shown, disabled, as what it is.
 *
 * Reading every section is public; only submitting a run requires
 * authentication (from the result screen's `LeaderboardSubmitPanel`).
 * Entirely separate from the PEAK Index (`/rankings`), which is untouched.
 */
export default function ArenaLeaderboardsPage() {
  const [daily, setDaily] = useState<DailyChallenge | null>(null);

  // Today's daily status is read once, independent of the mode tabs above —
  // it answers "is there a daily to play right now," not "what did this
  // mode's board look like."
  useEffect(() => {
    let cancelled = false;
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

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
          Arena Leaderboards
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          Where every scored mode in the Arena stands — what is live today, and
          what is still to come.
        </p>
      </div>

      {/* ---------------------------------------------------------------
          82-0 — the real, functional leaderboard.

          THE COMPONENT OWNS ITS OWN STATES. This page used to hold the runs,
          the enabled flag and the loading flag itself, and its `catch` set
          `enabled = false` -- so a network failure rendered "The global
          leaderboard isn't enabled yet.", which is a sentence about
          configuration told to somebody with a connection problem. Loading,
          disabled, failed and empty are now four states with four different
          next actions, and retry retries rather than meaning "reload the page".
          --------------------------------------------------------------- */}
      <section className="flex flex-col gap-3" aria-labelledby="leaderboard-82-0-heading">
        <div className="flex items-center gap-2">
          <Trophy size={16} aria-hidden="true" style={{ color: "var(--peak-accent-text)" }} />
          <h2 id="leaderboard-82-0-heading" className="text-sm font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
            82-0 · PEAK Season
          </h2>
        </div>
        <PeakSeasonLeaderboard />
      </section>

      {/* ---------------------------------------------------------------
          82-0 DAILY — real status, honestly not a second leaderboard.
          --------------------------------------------------------------- */}
      <section className="flex flex-col gap-3" aria-labelledby="leaderboard-daily-heading">
        <div className="flex items-center gap-2">
          <CalendarDays size={16} aria-hidden="true" style={{ color: "var(--peak-accent-text)" }} />
          <h2 id="leaderboard-daily-heading" className="text-sm font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
            82-0 · Daily
          </h2>
        </div>
        <div
          className="flex items-center justify-between gap-3 rounded-xl border p-4"
          style={{ borderColor: "var(--border-default)", background: "var(--bg-surface)" }}
        >
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {daily
                ? daily.already_played
                  ? "Today's daily is already played"
                  : "Today's daily board is ready"
                : "Checking today's daily…"}
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              82-0 has no separate daily standings — the same board is shared
              by every player each day, then it folds into the all-time board
              above once submitted. This is a status, not a second
              leaderboard.
            </p>
          </div>
          <Link
            href="/arena/court/daily"
            data-testid="leaderboard-daily-link"
            className="shrink-0 rounded-md px-3 py-2 text-xs font-semibold whitespace-nowrap"
            style={{ background: "var(--peak-accent, #f5c842)", color: "var(--text-inverse)" }}
          >
            {daily?.already_played ? "See today's board" : "Play today's daily"}
          </Link>
        </div>
      </section>

      {/* ---------------------------------------------------------------
          RUN THE TABLE — deferred, said plainly.
          --------------------------------------------------------------- */}
      <section aria-labelledby="leaderboard-rtt-heading">
        <div className="flex items-center gap-2 mb-3">
          <Swords size={16} aria-hidden="true" style={{ color: "var(--text-muted)" }} />
          <h2 id="leaderboard-rtt-heading" className="text-sm font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
            RUN THE TABLE
          </h2>
        </div>
        <EmptyState
          title="No global leaderboard yet"
          description="RUN THE TABLE's score contract for a leaderboard isn't defined yet — this pass covers the run itself, not a competitive standing. Coming in a later pass."
          compact
          data-testid="leaderboard-rtt-deferred"
        />
      </section>

      {/* ---------------------------------------------------------------
          RANKED — off for this whole pass, shown as what it is.
          --------------------------------------------------------------- */}
      <section aria-labelledby="leaderboard-ranked-heading">
        <div className="flex items-center gap-2 mb-3">
          <Trophy size={16} aria-hidden="true" style={{ color: "var(--text-muted)" }} />
          <h2 id="leaderboard-ranked-heading" className="text-sm font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
            Ranked
          </h2>
        </div>
        <EmptyState
          title="Coming later"
          description="Ranked matchmaking and its public leaderboard are built but disabled for this pass."
          compact
          data-testid="leaderboard-ranked-coming-later"
        />
      </section>
    </div>
  );
}
