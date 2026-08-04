"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getAccessToken } from "@/lib/auth";
import { getLeaderboard, getMyRuns } from "@/lib/perfect-season-api";
import { CourtMode, PerfectSeasonRunPublic } from "@/types/perfect-season";

interface Props {
  mode: CourtMode;
  wins: number;
  losses: number;
  lineupPeakScore: number | null;
  onPlayAgain: () => void;
  busy: boolean;
}

/** Highest wins, tie-broken by lineup_score -- same ordering the global
 * leaderboard itself uses, so "your best" here never disagrees with what a
 * user would see if they scrolled their own runs on the leaderboard page. */
function bestOf(runs: PerfectSeasonRunPublic[]): PerfectSeasonRunPublic | null {
  if (runs.length === 0) return null;
  return runs.reduce((best, r) => {
    if (r.wins !== best.wins) return r.wins > best.wins ? r : best;
    return r.lineup_score > best.lineup_score ? r : best;
  });
}

/**
 * Phase 8D: the end-of-run "loop, not a dead end" panel -- a Play Again
 * button plus, for a signed-in user, a comparison against their own best
 * submitted run in this mode. Deliberately reuses the SAME infrastructure
 * LeaderboardSubmitPanel already uses (getLeaderboard for the feature
 * flag, getMyRuns/getAccessToken for the user's history) rather than
 * inventing a parallel "best run" store -- "personal best" here means best
 * SUBMITTED run, the same durable record the leaderboard itself is built
 * from, not a separate client-only high score that could drift from it.
 * Signed-out users (or leaderboard-off deployments) still get the Play
 * Again button -- only the comparison line is gated.
 */
export default function PlayAgainPanel({ mode, wins, losses, lineupPeakScore, onPlayAgain, busy }: Props) {
  const { user } = useAuth();
  // Carry the current page as ?returnTo= so signing in from a result screen
  // comes back here instead of dropping the player on the homepage. The
  // sign-in page re-validates it with safeNext(), so an attacker-supplied
  // value cannot turn this into an open redirect.
  const pathname = usePathname();
  const signInHref = `/signin?returnTo=${encodeURIComponent(pathname || "/")}`;
  const [leaderboardEnabled, setLeaderboardEnabled] = useState<boolean | null>(null);
  const [personalBest, setPersonalBest] = useState<PerfectSeasonRunPublic | null | "loading">("loading");

  useEffect(() => {
    getLeaderboard({ mode })
      .then((r) => setLeaderboardEnabled(r.leaderboard_enabled))
      .catch(() => setLeaderboardEnabled(false));
  }, [mode]);

  useEffect(() => {
    if (!user || leaderboardEnabled !== true) {
      setPersonalBest(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) {
          if (!cancelled) setPersonalBest(null);
          return;
        }
        const { runs } = await getMyRuns(token);
        const best = bestOf(runs.filter((r) => r.mode === mode));
        if (!cancelled) setPersonalBest(best);
      } catch {
        // Personal-best framing is a nice-to-have -- Play Again must never
        // block on it, so a failed lookup just quietly shows no comparison.
        if (!cancelled) setPersonalBest(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, leaderboardEnabled, mode]);

  const isNewBest =
    personalBest !== "loading" &&
    personalBest !== null &&
    (wins > personalBest.wins || (wins === personalBest.wins && lineupPeakScore != null && lineupPeakScore > personalBest.lineup_score));

  return (
    <div
      data-testid="play-again-panel"
      className="rounded-xl p-3 flex flex-col gap-2.5 text-sm"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--peak-accent-dim)" }}
    >
      {user && leaderboardEnabled && personalBest !== "loading" && (
        <div data-testid="personal-best-compare" style={{ color: isNewBest ? "var(--peak-accent-text, #f5c842)" : "var(--text-secondary)" }}>
          {personalBest === null ? (
            "This is your first submitted run in this mode — set the bar."
          ) : isNewBest ? (
            <>New personal best for this mode! Previous best: {personalBest.wins}-{personalBest.losses}.</>
          ) : (
            <>Your best in this mode: {personalBest.wins}-{personalBest.losses} (score {personalBest.lineup_score.toFixed(1)}).</>
          )}
        </div>
      )}
      {/* Phase 8E: signed-out users get an explicit save-your-best prompt
          instead of the comparison line just silently never appearing --
          matches LeaderboardSubmitPanel's own !user branch exactly (same
          copy tone, same /signin destination) so the two end-of-run panels
          read as one consistent product, not two different auth patterns.
          Hidden entirely when the leaderboard feature itself is off --
          signing in wouldn't unlock anything in that case. */}
      {!user && leaderboardEnabled && (
        <div data-testid="play-again-signin-prompt" className="flex items-center justify-between gap-3">
          <span style={{ color: "var(--text-secondary)" }}>Sign in to save your best run and track it here.</span>
          <a
            href={signInHref}
            className="text-xs font-semibold uppercase tracking-wide rounded px-3 py-1.5 shrink-0"
            style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border-default)" }}
          >
            Sign in
          </a>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <span style={{ color: "var(--text-muted)" }}>
          {wins}-{losses} this run. Ready to run it back?
        </span>
        <button
          data-testid="play-again-btn"
          onClick={onPlayAgain}
          disabled={busy}
          className="text-xs font-semibold uppercase tracking-wide rounded px-3 py-1.5 shrink-0 disabled:opacity-50"
          style={{ background: "var(--peak-accent, #f5c842)", color: "var(--text-inverse)" }}
        >
          {busy ? "Starting a new run…" : "Play again"}
        </button>
      </div>
    </div>
  );
}
