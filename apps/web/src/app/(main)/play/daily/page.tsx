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
import GameIntro from "@/components/shared/GameIntro";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import PeakDuelV2AlreadyCompleted from "@/components/v2/duel/PeakDuelV2AlreadyCompleted";

const PEAK_DUEL_INTRO_RULES = [
  { label: "Pick the higher peak", detail: "two real player peak-windows, side by side — choose the one PEAK3 rates higher" },
  { label: "Ten matchups", detail: "the same ten comparisons for everyone today, one at a time" },
  { label: "Instant reveal", detail: "the real numbers show right after you pick, no waiting for a result screen" },
];

function PeakDuelIntroVisual() {
  return (
    <div className="pd-intro-visual" aria-hidden="true">
      <span className="pd-intro-card">Player A</span>
      <span className="pd-intro-vs">VS</span>
      <span className="pd-intro-card">Player B</span>
    </div>
  );
}

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
  const [introOpen, setIntroOpen] = useState(true);

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
          <p className="text-sm text-[var(--text-secondary)]">
            Make sure the PEAK3 Arena API is running at{" "}
            <code className="text-xs">localhost:8000</code>.
          </p>
          <button
            type="button"
            onClick={() => setReloadToken((t) => t + 1)}
            className="pk-lift pk-press rounded-lg border border-[var(--border-default)] px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
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
    const countdownLabel =
      secondsLeft === null
        ? "New daily board at midnight PT."
        : `New daily board at midnight PT — next one in ${formatCountdown(secondsLeft)}.`;
    return (
      <PeakV2Shell width="live">
        <PeakDuelV2AlreadyCompleted completion={completion} countdownLabel={countdownLabel} />
      </PeakV2Shell>
    );
  }

  if (!challenge) return null;

  return (
    <div className="min-h-screen">
      <GameIntro
        open={introOpen}
        onStart={() => setIntroOpen(false)}
        onSkip={() => setIntroOpen(false)}
        eyebrow="Daily Challenge"
        title="Peak Duel"
        objective="Ten head-to-head matchups — pick which player's peak PEAK3 rates higher."
        rules={PEAK_DUEL_INTRO_RULES}
        visual={<PeakDuelIntroVisual />}
        accent="var(--comp-si)"
        startLabel="Start today's duel"
        testId="peak-duel-game-intro"
      />
      <div>
        {/* Once the V2 game mounts, `PeakV2LiveHeader` (question/reveal) and
            `PeakDuelV2Final`'s own eyebrow already carry this exact same
            "Peak Duel · N of 10" identity with V2 typography — so this plain
            header stays only for the intro backdrop and disappears once the
            real V2 screen takes over, rather than doubling it. */}
        {introOpen && (
          <div className="pt-8 text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">
              Daily Challenge · {today}
            </p>
            <h1 className="mt-1 font-display text-2xl font-bold">Peak Duel</h1>
            <p className="text-sm text-[var(--text-secondary)]">
              10 matchups · {years}-year windows
            </p>
          </div>
        )}
        {!introOpen && (
          <GameEngine
            mode="daily"
            years={years}
            duels={challenge.duels}
            session_token={challenge.session_token}
            date={today}
          />
        )}
      </div>
    </div>
  );
}
