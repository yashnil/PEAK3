"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getAccessToken } from "@/lib/auth";
import { getLeaderboard, submitRun, PerfectSeasonAPIError } from "@/lib/perfect-season-api";
import { CourtMode, PerfectSeasonRunPublic } from "@/types/perfect-season";

interface Props {
  gameId: string;
  mode: CourtMode;
  /** Phase 8C: "complete" | "incomplete" -- when incomplete, the backend
   * (apps/api/app/api/v1/perfect_season.py::submit_run) always rejects the
   * submission with `incomplete_score_not_eligible`; this lets the panel
   * show that state proactively (disabled button + explanation) instead of
   * only after the user clicks and the request fails. Optional/undefined
   * for legacy peak-window boards, which are always fully scored. */
  lineupScoreStatus?: "complete" | "incomplete";
}

type SubmitPhase = "idle" | "submitting" | "submitted" | "error";

/**
 * Phase 6G Part E: "Sign in to submit" / "Submit to leaderboard" panel on
 * the result screen. Entirely hidden (not just disabled) if the backend
 * reports the leaderboard feature as off -- checked once on mount via a
 * real GET (not a hardcoded env flag on the frontend, so this can never
 * drift out of sync with the server's actual PEAK3_COURTBUILDER_LEADERBOARD_ENABLED
 * value). Never sends any score/win data itself -- submitRun's body is only
 * { game_id }, the server recomputes everything from the saved game state.
 */
export default function LeaderboardSubmitPanel({ gameId, mode, lineupScoreStatus }: Props) {
  const { user } = useAuth();
  // Carry the current page as ?returnTo= so signing in from a result screen
  // comes back here instead of dropping the player on the homepage. The
  // sign-in page re-validates it with safeNext(), so an attacker-supplied
  // value cannot turn this into an open redirect.
  const pathname = usePathname();
  const signInHref = `/signin?returnTo=${encodeURIComponent(pathname || "/")}`;
  const isIncomplete = lineupScoreStatus === "incomplete";
  const [leaderboardEnabled, setLeaderboardEnabled] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<SubmitPhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submittedRun, setSubmittedRun] = useState<PerfectSeasonRunPublic | null>(null);
  const [rank, setRank] = useState<number | null>(null);

  useEffect(() => {
    getLeaderboard({ mode })
      .then((r) => setLeaderboardEnabled(r.leaderboard_enabled))
      .catch(() => setLeaderboardEnabled(false));
  }, [mode]);

  async function handleSubmit() {
    setPhase("submitting");
    setErrorMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setPhase("error");
        setErrorMessage("Sign in to submit your run.");
        return;
      }
      const run = await submitRun(gameId, token);
      setSubmittedRun(run);
      setPhase("submitted");
      // Best-effort rank lookup -- a leaderboard front page is enough
      // context for most runs; a run far down the list simply shows no
      // rank rather than paging through the whole leaderboard for it.
      try {
        const board = await getLeaderboard({ mode, limit: 100 });
        const idx = board.runs.findIndex((r) => r.id === run.id);
        if (idx >= 0) setRank(idx + 1);
      } catch {
        // Rank is a nice-to-have -- submission itself already succeeded.
      }
    } catch (e) {
      setPhase("error");
      setErrorMessage(e instanceof PerfectSeasonAPIError ? e.message : "Could not submit -- please try again.");
    }
  }

  if (leaderboardEnabled === false) return null;
  if (leaderboardEnabled === null) return null;

  return (
    <div
      data-testid="leaderboard-submit-panel"
      className="rounded-xl p-3 flex flex-col gap-2 text-sm"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border-default)" }}
    >
      {phase === "submitted" && submittedRun ? (
        <div data-testid="leaderboard-submit-confirmation" className="flex flex-col gap-1">
          <span className="font-semibold" style={{ color: "var(--peak-accent-text, #f5c842)" }}>
            Submitted to the global leaderboard as {submittedRun.display_name}
          </span>
          {rank !== null && (
            <span className="text-xs" style={{ color: "var(--text-secondary)" }} data-testid="leaderboard-rank">
              Currently ranked #{rank}
            </span>
          )}
        </div>
      ) : !user ? (
        <div className="flex items-center justify-between gap-3">
          <span style={{ color: "var(--text-secondary)" }}>Sign in to submit your run to the global leaderboard.</span>
          <a
            href={signInHref}
            className="text-xs font-semibold uppercase tracking-wide rounded px-3 py-1.5 shrink-0"
            style={{ background: "var(--peak-accent, #f5c842)", color: "var(--text-inverse)" }}
          >
            Sign in
          </a>
        </div>
      ) : isIncomplete ? (
        // Phase 8C: proactive ineligibility -- the backend always rejects
        // an incomplete-score submission with incomplete_score_not_eligible
        // (apps/api/app/api/v1/perfect_season.py::submit_run); show that
        // up front instead of letting the user click a live-looking button
        // just to get an error back.
        <div className="flex items-center justify-between gap-3" data-testid="leaderboard-ineligible-incomplete">
          <span style={{ color: "var(--text-secondary)" }}>
            This run has one or more cards with no official PEAK3 score yet — only fully-scored
            rosters are eligible for the global leaderboard.
          </span>
          <button
            disabled
            className="text-xs font-semibold uppercase tracking-wide rounded px-3 py-1.5 shrink-0 opacity-40 cursor-not-allowed"
            style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}
            title="Not eligible: one or more cards have no official PEAK3 score yet."
          >
            Not eligible yet
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <span style={{ color: "var(--text-secondary)" }}>
              Global leaderboard tracks respins and exact-score coverage.
            </span>
            <button
              data-testid="leaderboard-submit-btn"
              onClick={handleSubmit}
              disabled={phase === "submitting"}
              className="text-xs font-semibold uppercase tracking-wide rounded px-3 py-1.5 shrink-0 disabled:opacity-50"
              style={{ background: "var(--peak-accent, #f5c842)", color: "var(--text-inverse)" }}
            >
              {phase === "submitting" ? "Submitting…" : "Submit to leaderboard"}
            </button>
          </div>
          {phase === "error" && errorMessage && (
            <span role="alert" className="text-xs" style={{ color: "var(--incorrect)" }} data-testid="leaderboard-submit-error">
              {errorMessage}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
