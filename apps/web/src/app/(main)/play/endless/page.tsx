"use client";

import { useState, useCallback } from "react";
import { getEndlessSession } from "@/lib/api";
import { GameEngine } from "@/components/game/game-engine";
import { getProgressRepository } from "@/lib/progress";
import type { EndlessSession } from "@/types";
import { cn } from "@/lib/utils";

const DURATION_OPTIONS = [1, 2, 3, 5] as const;

export default function EndlessPage() {
  const [years, setYears] = useState<1 | 2 | 3 | 5>(3);
  const [session, setSession] = useState<EndlessSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(0);

  const repo = getProgressRepository();
  const progress = repo.getAll();

  const startSession = useCallback(async (y: 1 | 2 | 3 | 5) => {
    setLoading(true);
    setError(null);
    try {
      const s = await getEndlessSession(y, { count: 30 });
      setSession(s);
      setYears(y);
      getProgressRepository().setPreferredDuration(y);
      setKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start session.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!session) {
    return (
      <div className="min-h-screen court-grid-bg flex items-center justify-center px-4">
        <div className="card-elevated max-w-md w-full p-8 space-y-6">
          <div className="text-center">
            <h1 className="font-display text-3xl font-bold">Endless Mode</h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Choose your peak window length and keep going.
            </p>
          </div>

          {/* Stats */}
          {(progress.endless_high_score > 0 || progress.endless_best_streak > 0) && (
            <div className="grid grid-cols-2 gap-3">
              {/* Standing personal bests, not a result: they are DISPLAYED,
                  so they do not count up. The captions were 10px muted, which
                  is the weakest ink in the app under the two numbers a
                  returning player is here to beat. */}
              <div className="card-surface pk-depth pk-crown p-3 text-center">
                <p className="font-display text-lg font-bold score-number text-[var(--peak-accent-text)]">
                  {progress.endless_high_score.toLocaleString()}
                </p>
                <p className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Best score</p>
              </div>
              <div className="card-surface pk-depth pk-crown p-3 text-center">
                <p className="font-display text-lg font-bold score-number text-[var(--peak-accent-text)]">
                  {progress.endless_best_streak}
                </p>
                <p className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Best streak</p>
              </div>
            </div>
          )}

          {/* Duration selector */}
          <div>
            {/* WAS `--text-muted`. It labels the control group beneath it. */}
            <p className="text-xs font-semibold text-[var(--text-secondary)] mb-3 uppercase tracking-wider">
              Peak window
            </p>
            <div className="grid grid-cols-4 gap-2">
              {DURATION_OPTIONS.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => setYears(y)}
                  aria-pressed={years === y}
                  className={cn(
                    "pk-lift pk-press rounded-lg border py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
                    years === y
                      ? "border-[var(--peak-accent)] bg-[var(--peak-accent-bg)] text-[var(--peak-accent-text)]"
                      : "border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--border-emphasis)]"
                  )}
                >
                  {y}yr
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-sm text-[var(--incorrect)]" role="alert">{error}</p>
          )}

          <button
            type="button"
            onClick={() => startSession(years)}
            disabled={loading}
            className="pk-lift pk-press pk-sheen w-full rounded-lg bg-[var(--peak-accent)] py-3 font-semibold text-[var(--text-inverse)] hover:bg-[var(--peak-accent-dim)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          >
            {loading ? "Loading…" : "Start Endless"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen court-grid-bg">
      <div className="mx-auto max-w-2xl px-4">
        <div className="pt-8 flex items-center justify-between">
          <div>
            <h1 className="font-display text-xl font-bold">Endless Mode</h1>
            <p className="text-xs text-[var(--text-secondary)]">{years}-year windows</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSession(null);
              setError(null);
            }}
            className="pk-press text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline"
          >
            Change duration
          </button>
        </div>

        <GameEngine
          key={key}
          mode="endless"
          years={years}
          duels={session.duels}
          session_token={session.session_token}
          seed={session.seed}
          onComplete={() => {
            // Auto-load more duels when complete
            startSession(years);
          }}
        />
      </div>
    </div>
  );
}
