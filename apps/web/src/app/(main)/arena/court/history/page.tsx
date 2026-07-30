"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { getAccessToken } from "@/lib/auth";
import { getMySavedRuns, PerfectSeasonAPIError } from "@/lib/perfect-season-api";
import { COURT_MODE_LABELS, PersonalBests, SavedRun } from "@/types/perfect-season";

/**
 * Phase 9A: PEAK Season run history + personal bests.
 *
 * Private by construction -- the backend only ever returns the authenticated
 * caller's own runs (see /perfect-season/me/saved-runs, and the owner-only
 * RLS on perfect_season_saved_runs). An anonymous visitor gets a CTA that
 * names the benefit rather than an error or an empty table, because
 * anonymous PLAY is fully supported: it's only durable history that needs an
 * account.
 */
export default function CourtHistoryPage() {
  const { user, loading: authLoading } = useAuth();
  const [runs, setRuns] = useState<SavedRun[] | null>(null);
  const [bests, setBests] = useState<PersonalBests | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setRuns(null);
        return;
      }
      const data = await getMySavedRuns(token, 50);
      setRuns(data.runs);
      setBests(data.personal_bests);
    } catch (e) {
      // A signed-in user hitting sign_in_required means an anonymous session
      // token -- treated as "not signed in" rather than as a failure.
      if (e instanceof PerfectSeasonAPIError && e.code === "sign_in_required") {
        setRuns(null);
      } else {
        setError(e instanceof PerfectSeasonAPIError ? e.message : "Could not load your history.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setRuns(null);
      setBests(null);
      return;
    }
    void load();
  }, [user, authLoading, load]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 flex flex-col gap-5" data-testid="court-history-page">
      <div>
        <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
          Your PEAK Season Runs
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          Every run you&apos;ve saved, newest first — with your personal bests. Private to your
          account.
        </p>
      </div>

      {!authLoading && !user && (
        <div
          data-testid="history-signin-cta"
          className="rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border-default)" }}
        >
          <span style={{ color: "var(--text-secondary)" }}>
            Sign in to save completed runs, track personal bests, and keep your history across
            devices. You can play without an account — saving just needs one.
          </span>
          <Link
            href="/signin"
            className="text-xs font-semibold uppercase tracking-wide rounded px-3 py-1.5 shrink-0"
            style={{ background: "var(--peak-accent, #f5c842)", color: "#000" }}
          >
            Sign in
          </Link>
        </div>
      )}

      {error && (
        <div
          role="alert"
          data-testid="history-error"
          className="rounded-lg p-4 text-sm text-center"
          style={{ background: "var(--bg-surface)", color: "#ef4444" }}
        >
          {error}
        </div>
      )}

      {user && bests && bests.total_runs > 0 && (
        <div data-testid="personal-bests-summary" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <BestTile label="Best record" value={bests.best_run ? `${bests.best_run.wins}-${bests.best_run.losses}` : "—"} />
          <BestTile
            label="Best lineup score"
            value={bests.best_lineup_score != null ? bests.best_lineup_score.toFixed(1) : "—"}
            hint={bests.best_lineup_score == null ? "No fully-scored run yet" : undefined}
          />
          <BestTile
            label="Best daily"
            value={bests.best_daily_run ? `${bests.best_daily_run.wins}-${bests.best_daily_run.losses}` : "—"}
            hint={!bests.best_daily_run ? "No daily run yet" : undefined}
          />
          <BestTile label="Runs saved" value={String(bests.total_runs)} hint={bests.perfect_season_count > 0 ? `${bests.perfect_season_count} × 82-0` : undefined} />
        </div>
      )}

      {user && loading && (
        <div className="rounded-lg p-4 text-sm text-center" style={{ background: "var(--bg-surface)", color: "var(--text-muted)" }}>
          Loading your runs…
        </div>
      )}

      {user && !loading && runs && runs.length === 0 && (
        <div
          data-testid="history-empty-state"
          className="rounded-xl p-6 flex flex-col items-center gap-3 text-sm text-center"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border-default)", color: "var(--text-muted)" }}
        >
          <span>No saved runs yet. Finish a PEAK Season run and hit “Save run” to start your history.</span>
          <Link
            href="/arena/court/practice/apex_1y"
            className="text-xs font-semibold uppercase tracking-wide rounded px-3 py-1.5"
            style={{ background: "var(--peak-accent, #f5c842)", color: "#000" }}
          >
            Build a lineup
          </Link>
        </div>
      )}

      {user && runs && runs.length > 0 && (
        <div data-testid="history-table" className="rounded-xl overflow-hidden border" style={{ borderColor: "var(--border-default)" }}>
          {runs.map((r, i) => {
            const isBest = bests?.best_run?.id === r.id;
            return (
              <Link
                key={r.id}
                href={`/arena/court/results/${r.game_id}`}
                data-testid="history-row"
                className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:opacity-80"
                style={{
                  background: i % 2 === 0 ? "var(--bg-surface)" : "var(--bg-elevated)",
                  color: "var(--text-primary)",
                }}
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold" style={{ color: "var(--peak-accent, #f5c842)" }}>
                      {r.wins}-{r.losses}
                    </span>
                    {isBest && (
                      <span
                        data-testid="history-personal-best-marker"
                        className="text-[9px] uppercase font-bold rounded px-1.5 py-0.5"
                        style={{ background: "rgba(245,200,66,0.18)", color: "var(--peak-accent, #f5c842)" }}
                      >
                        Personal best
                      </span>
                    )}
                    {r.challenge_kind === "daily" && (
                      <span
                        data-testid="history-daily-badge"
                        className="text-[9px] uppercase font-semibold rounded px-1.5 py-0.5"
                        style={{ background: "rgba(96,165,250,0.15)", color: "#60a5fa" }}
                      >
                        Daily {r.challenge_date}
                      </span>
                    )}
                    {!r.leaderboard_eligible && (
                      <span
                        className="text-[9px] uppercase font-semibold rounded px-1.5 py-0.5"
                        style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }}
                        title="One or more cards had no official PEAK3 score — provisional, not leaderboard-eligible."
                      >
                        Provisional
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                    {COURT_MODE_LABELS[r.mode] ?? r.mode} ·{" "}
                    {new Date(r.created_at).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                    {r.score_status === "complete"
                      ? ` · ${r.lineup_score.toFixed(1)} score`
                      : ` · score incomplete (${r.exact_cards_scored}/${r.total_cards})`}
                  </span>
                </div>
                <span className="text-xs shrink-0" style={{ color: "var(--peak-accent, #f5c842)" }}>
                  Open →
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BestTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div
      className="rounded-lg p-3 flex flex-col gap-0.5"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--peak-accent-dim)" }}
    >
      <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      <span className="text-lg font-black" style={{ color: "var(--text-primary)" }}>
        {value}
      </span>
      {hint && (
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          {hint}
        </span>
      )}
    </div>
  );
}
