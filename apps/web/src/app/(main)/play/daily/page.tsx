"use client";

import { useCallback, useEffect, useState } from "react";
import { getDailyChallenge } from "@/lib/api";
import { getProgressRepository } from "@/lib/progress";
import { GameEngine } from "@/components/game/game-engine";
import {
  type DailyWindowPayload,
  extractDailyWindow,
  formatCountdown,
} from "@/lib/daily-time";
import { useDailyReset } from "@/lib/use-daily-reset";
import type { DailyChallenge } from "@/types";

/**
 * Peak Duel Daily.
 *
 * THE SERVER DECIDES WHAT DAY IT IS. This page used to compute `today` from the
 * browser clock in render scope and send it as `?date=`, and the API only fell
 * back to its own clock when the parameter was absent — so a device an hour
 * ahead of the reset zone played tomorrow's challenge, a device behind played
 * yesterday's, and a tab left open across midnight played a board that no
 * longer existed. The request now carries no date at all; the date comes back
 * IN the response, along with the window it belongs to, and every local lookup
 * is keyed off that.
 */
export default function DailyPage() {
  const [challenge, setChallenge] = useState<DailyChallenge | null>(null);
  const [window_, setWindow] = useState<DailyWindowPayload | null>(null);
  const [alreadyCompleted, setAlreadyCompleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [years] = useState(3);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // No `date` argument: "today" is the server's to decide.
    getDailyChallenge(years)
      .then((c) => {
        if (cancelled) return;
        setChallenge(c);
        setWindow(extractDailyWindow(c));
        // Completion is looked up against the date the SERVER just named, not
        // against a locally derived one — otherwise a player one timezone over
        // sees "already completed" for a challenge they have not been given.
        setAlreadyCompleted(
          getProgressRepository().getDailyCompletion(c.date, years) !== null,
        );
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || "Could not load today's challenge.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [years, reloadToken]);

  // Refetch when the board rolls over, and when the tab comes back from the
  // background past the boundary.
  const { secondsLeft } = useDailyReset({
    dailyKey: window_?.daily_key ?? null,
    secondsRemaining: window_?.seconds_remaining ?? null,
    window: window_,
    onReset: useCallback(() => setReloadToken((t) => t + 1), []),
  });

  const today = challenge?.date ?? window_?.daily_key ?? "";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-[var(--text-muted)] animate-pulse" role="status">
          Loading today&apos;s challenge…
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="card-elevated max-w-md p-8 text-center space-y-4">
          <p className="text-[var(--incorrect)]" role="alert">{error}</p>
          <p className="text-sm text-[var(--text-muted)]">
            Make sure the PEAK3 Arena API is running at{" "}
            <code className="text-xs">localhost:8000</code>.
          </p>
          <button
            type="button"
            onClick={() => setReloadToken((t) => t + 1)}
            className="rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (alreadyCompleted) {
    const repo = getProgressRepository();
    const completion = repo.getDailyCompletion(today, years);
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="card-elevated max-w-md p-8 text-center space-y-4">
          <h1 className="font-display text-2xl font-bold">Already completed!</h1>
          <p className="text-[var(--text-secondary)]">
            You finished today&apos;s challenge.
          </p>
          {completion && (
            <div className="grid grid-cols-2 gap-3">
              <div className="card-surface p-3 text-center">
                <p className="text-xl font-bold score-number text-[var(--peak-accent)]">
                  {completion.correct}/{completion.total}
                </p>
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Correct</p>
              </div>
              <div className="card-surface p-3 text-center">
                <p className="text-xl font-bold score-number text-[var(--peak-accent)]">
                  {completion.arena_points.toLocaleString()}
                </p>
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Points</p>
              </div>
            </div>
          )}
          <p className="text-sm text-[var(--text-muted)]" data-testid="daily-duel-countdown">
            {secondsLeft === null
              ? "New daily board at midnight PT."
              : `New daily board at midnight PT — next one in ${formatCountdown(secondsLeft)}.`}
          </p>
          <a
            href="/play/endless"
            className="block rounded-lg bg-[var(--peak-accent)] py-3 text-sm font-semibold text-[var(--text-inverse)] hover:bg-[var(--peak-accent-dim)]"
          >
            Play Endless Mode
          </a>
        </div>
      </div>
    );
  }

  if (!challenge) return null;

  return (
    <div className="min-h-screen court-grid-bg">
      <div className="mx-auto max-w-2xl px-4">
        <div className="pt-8 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">
            Daily Challenge · {today}
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold">Peak Duel</h1>
          <p className="text-sm text-[var(--text-muted)]">
            10 matchups · {years}-year windows
          </p>
        </div>
        <GameEngine
          mode="daily"
          years={years}
          duels={challenge.duels}
          session_token={challenge.session_token}
          date={today}
        />
      </div>
    </div>
  );
}
