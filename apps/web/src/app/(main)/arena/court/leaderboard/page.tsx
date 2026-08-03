"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, Swords, Trophy } from "lucide-react";
import { getLeaderboard, getDailyChallenge } from "@/lib/perfect-season-api";
import { COURT_MODE_LABELS, CourtMode, DailyChallenge, PerfectSeasonRunPublic } from "@/types/perfect-season";
import { EmptyState } from "@/components/ui";

const MODES: CourtMode[] = ["apex_1y", "prime_3y", "foundation_5y"];

/**
 * Arena Leaderboards.
 *
 * SYNTHESIS_CONTRACT.md §7 asks for one destination covering every scored
 * mode's standing, not just 82-0's. What is actually real today, per
 * `SCORE_RECONCILIATION.md` §5, decides what each section shows:
 *
 *   - 82-0 ALL-TIME: real, functional (Phase 6G Part E). The table below,
 *     unchanged in substance from the page this replaces.
 *   - 82-0 DAILY: the leaderboard endpoint carries no field distinguishing a
 *     daily submission from a free-play one (`game_type` is a hardcoded
 *     literal, `"peak_season"`, for every row — verified against
 *     `apps/api/app/repositories/leaderboard_protocols.py:46`) and
 *     `SCORE_RECONCILIATION.md` §5 states outright that "82-0 is an all-time
 *     board per mode; no daily reset applies." So this section is NOT a
 *     second, fabricated leaderboard split the data cannot support — it is
 *     today's real daily-challenge status (`GET /perfect-season/daily`) and
 *     a link to play it, honestly labeled as what it is.
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
  const [mode, setMode] = useState<CourtMode>("apex_1y");
  const [noRespinOnly, setNoRespinOnly] = useState(false);
  const [runs, setRuns] = useState<PerfectSeasonRunPublic[] | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [daily, setDaily] = useState<DailyChallenge | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getLeaderboard({ mode, noRespin: noRespinOnly, limit: 50 })
      .then((r) => {
        if (cancelled) return;
        setEnabled(r.leaderboard_enabled);
        setRuns(r.runs);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, noRespinOnly]);

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
          82-0 ALL-TIME — the real, functional leaderboard.
          --------------------------------------------------------------- */}
      <section className="flex flex-col gap-3" aria-labelledby="leaderboard-82-0-heading">
        <div className="flex items-center gap-2">
          <Trophy size={16} aria-hidden="true" style={{ color: "var(--peak-accent-text)" }} />
          <h2 id="leaderboard-82-0-heading" className="text-sm font-bold uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
            82-0 · All-Time
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {MODES.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="text-xs font-semibold uppercase tracking-wide rounded-full px-3 py-1.5"
              style={
                m === mode
                  ? { background: "var(--peak-accent, #f5c842)", color: "var(--text-inverse)" }
                  : { background: "var(--bg-surface)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }
              }
            >
              {COURT_MODE_LABELS[m] ?? m}
            </button>
          ))}
          <label className="flex items-center gap-1.5 text-xs ml-auto" style={{ color: "var(--text-secondary)" }}>
            <input
              type="checkbox"
              checked={noRespinOnly}
              onChange={(e) => setNoRespinOnly(e.target.checked)}
              data-testid="leaderboard-no-respin-filter"
            />
            No-respin runs only
          </label>
        </div>

        {enabled === false && (
          <div className="rounded-lg p-4 text-sm text-center" style={{ background: "var(--bg-surface)", color: "var(--text-muted)" }}>
            The global leaderboard isn&apos;t enabled yet.
          </div>
        )}

        {enabled && !loading && runs && runs.length === 0 && (
          <div className="rounded-lg p-4 text-sm text-center" style={{ background: "var(--bg-surface)", color: "var(--text-muted)" }}>
            No runs submitted yet for this filter.
          </div>
        )}

        {enabled && runs && runs.length > 0 && (
          <div data-testid="leaderboard-table" className="rounded-xl overflow-hidden border" style={{ borderColor: "var(--border-default)" }}>
            {runs.map((r, i) => (
              <div
                key={r.id}
                data-testid="leaderboard-row"
                className="flex items-center justify-between px-3 py-2 text-sm"
                style={{
                  background: i % 2 === 0 ? "var(--bg-surface)" : "var(--bg-elevated)",
                  color: "var(--text-primary)",
                }}
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                    {i + 1}
                  </span>
                  <span className="font-semibold">{r.display_name}</span>
                  {(r.team_respins_used > 0 || r.season_respins_used > 0) && (
                    <span
                      className="text-[9px] uppercase font-semibold rounded px-1.5 py-0.5"
                      style={{ background: "var(--pk-surface-inset, var(--bg-elevated))", color: "var(--text-muted)" }}
                      title={`${r.team_respins_used} team respins, ${r.season_respins_used} season respins`}
                    >
                      respins used
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                  <span className="font-bold" style={{ color: "var(--peak-accent-text, #f5c842)" }}>
                    {r.wins}-{r.losses}
                  </span>
                  <span>{r.lineup_score.toFixed(1)} score</span>
                </div>
              </div>
            ))}
          </div>
        )}
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
