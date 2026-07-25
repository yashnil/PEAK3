"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { getAccessToken } from "@/lib/auth";
import { getLeaderboard, submitRun, PerfectSeasonAPIError } from "@/lib/perfect-season-api";
import { CourtMode, PerfectSeasonRunPublic } from "@/types/perfect-season";

interface Props {
  gameId: string;
  mode: CourtMode;
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
export default function LeaderboardSubmitPanel({ gameId, mode }: Props) {
  const { user } = useAuth();
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
          <span className="font-semibold" style={{ color: "var(--peak-accent, #f5c842)" }}>
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
            href="/signin"
            className="text-xs font-semibold uppercase tracking-wide rounded px-3 py-1.5 shrink-0"
            style={{ background: "var(--peak-accent, #f5c842)", color: "#000" }}
          >
            Sign in
          </a>
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
              style={{ background: "var(--peak-accent, #f5c842)", color: "#000" }}
            >
              {phase === "submitting" ? "Submitting…" : "Submit to leaderboard"}
            </button>
          </div>
          {phase === "error" && errorMessage && (
            <span role="alert" className="text-xs" style={{ color: "#ef4444" }} data-testid="leaderboard-submit-error">
              {errorMessage}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
