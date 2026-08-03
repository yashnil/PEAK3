"use client";
import { useEffect, useState } from "react";
import { getLeaderboard } from "@/lib/perfect-season-api";
import { COURT_MODE_LABELS, CourtMode, PerfectSeasonRunPublic } from "@/types/perfect-season";

const MODES: CourtMode[] = ["apex_1y", "prime_3y", "foundation_5y"];

/**
 * Phase 6G Part E: public PEAK Season global leaderboard. Reading is public
 * (no sign-in required) -- only submitting a run requires authentication,
 * from the result screen's LeaderboardSubmitPanel. Entirely separate from
 * the PEAK Index (/rankings), which stays untouched.
 */
export default function CourtLeaderboardPage() {
  const [mode, setMode] = useState<CourtMode>("apex_1y");
  const [noRespinOnly, setNoRespinOnly] = useState(false);
  const [runs, setRuns] = useState<PerfectSeasonRunPublic[] | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
          PEAK Season Leaderboard
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          Global leaderboard tracks respins and exact-score coverage. Sign in from a completed
          82-0 Peak Season run to submit your own.
        </p>
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
                    style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}
                    title={`${r.team_respins_used} team respins, ${r.season_respins_used} season respins`}
                  >
                    respins used
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs" style={{ color: "var(--text-secondary)" }}>
                <span className="font-bold" style={{ color: "var(--peak-accent, #f5c842)" }}>
                  {r.wins}-{r.losses}
                </span>
                <span>{r.lineup_score.toFixed(1)} score</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
