"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { draftProgress } from "@/lib/draft-progress";
import { localDailyWindow } from "@/lib/daily-time";
import { useDailyReset } from "@/lib/use-daily-reset";
import { DraftMode, DraftCompletionSummary, MODE_LABELS } from "@/types/draft";

const MODES: DraftMode[] = ["apex_1y", "prime_3y", "foundation_5y"];

const MODE_SUBTITLES: Record<DraftMode, string> = {
  apex_1y: "Best single season peak",
  prime_3y: "Three-year prime window",
  foundation_5y: "Five-year foundation",
};

export default function DailyHubPage() {
  // A purely local hub: nothing here is fetched, so `today` is the local
  // fallback key from `lib/daily-time.ts`. It is used ONLY to pick the right
  // localStorage bucket and is never sent to the server as `?date=` — the
  // board routes it links to resolve the day themselves.
  const [window_, setWindow] = useState(() => localDailyWindow());
  const today = window_.daily_key;
  const [completions, setCompletions] = useState<
    Partial<Record<DraftMode, DraftCompletionSummary>>
  >({});

  useEffect(() => {
    document.title = "Daily Peak | PEAK3 Arena";
    setCompletions(draftProgress.getAllDailyCompletions(today));
  }, [today]);

  // Re-derives the day at the rollover and on returning to a backgrounded tab,
  // so a hub left open overnight stops claiming yesterday's boards are done.
  // The zone is passed to Intl explicitly, so the server render and the first
  // client render produce the same key and hydration stays clean.
  useDailyReset({
    dailyKey: window_.daily_key,
    secondsRemaining: window_.seconds_remaining,
    window: window_,
    onReset: useCallback(() => setWindow(localDailyWindow()), []),
  });

  const dateLabel = new Date(today + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div
      className="max-w-4xl mx-auto px-4 py-8"
      style={{ background: "var(--bg-page)" }}
    >
      {/* Phase 8E: this is the legacy Peak Draft daily hub, not the current
          flagship -- a visible way out to 82-0 Peak Season instead of a
          dead end, for anyone who lands here from an old link/bookmark
          rather than the (now-fixed) homepage/nav routing. */}
      <Link
        href="/arena/court/practice/apex_1y"
        className="mb-6 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm transition-all hover:opacity-90"
        style={{ background: "var(--bg-elevated)", borderColor: "var(--peak-accent, #f5c842)" }}
      >
        <span style={{ color: "var(--text-primary)" }}>
          <strong style={{ color: "var(--peak-accent-text, #f5c842)" }}>New:</strong> build a roster and chase an 82-0 season in 82-0 Peak Season.
        </span>
        <span className="font-semibold shrink-0" style={{ color: "var(--peak-accent-text, #f5c842)" }}>
          Try it →
        </span>
      </Link>

      {/* Header */}
      <div className="mb-8">
        <h1
          className="font-display text-3xl font-bold"
          style={{ color: "var(--text-primary)" }}
        >
          Today&apos;s Peak Draft
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          {dateLabel}
        </p>
      </div>

      {/* Mode cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {MODES.map((mode) => {
          const completion = completions[mode];
          return (
            <div
              key={mode}
              className="rounded-xl p-6 flex flex-col gap-4 border"
              style={{
                background: "var(--bg-elevated)",
                borderColor: "var(--border-default)",
              }}
            >
              {/* Title row */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div
                    className="font-bold text-base"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {MODE_LABELS[mode]}
                  </div>
                  <div
                    className="text-xs mt-0.5"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {MODE_SUBTITLES[mode]}
                  </div>
                </div>
                {completion && (
                  <span
                    className="text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0"
                    style={{ background: "var(--correct)", color: "#fff" }}
                  >
                    ✓ Completed
                  </span>
                )}
              </div>

              {/* Score or CTA */}
              {completion ? (
                <>
                  <div>
                    <span
                      className="text-2xl font-bold score-number"
                      style={{ color: "var(--peak-accent)" }}
                    >
                      {completion.lineup_peak_rating.toFixed(1)}
                    </span>
                    <span
                      className="text-xs ml-1"
                      style={{ color: "var(--text-muted)" }}
                    >
                      lineup rating
                    </span>
                  </div>
                  <Link
                    href={`/arena/daily/${mode}`}
                    className="block text-center py-2 rounded-lg text-sm font-medium border transition-all hover:bg-[var(--bg-surface)]"
                    style={{
                      borderColor: "var(--border-default)",
                      color: "var(--text-primary)",
                    }}
                  >
                    View Result
                  </Link>
                </>
              ) : (
                <Link
                  href={`/arena/daily/${mode}`}
                  className="block text-center py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90"
                  style={{
                    background: "var(--peak-accent)",
                    color: "var(--text-inverse)",
                  }}
                >
                  Play Now
                </Link>
              )}
            </div>
          );
        })}
      </div>

      {/* Rules reminder */}
      <div
        className="mb-8 px-4 py-3 rounded-lg border text-sm"
        style={{
          background: "var(--bg-surface)",
          borderColor: "var(--border-subtle)",
          color: "var(--text-secondary)",
        }}
      >
        <span
          className="font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          Rules:{" "}
        </span>
        1 Hold · 1 Reframe · 5 rounds · Pick the best peak window for each role
      </div>

      {/* Back link */}
      <Link
        href="/arena"
        className="text-sm underline"
        style={{ color: "var(--peak-accent)" }}
      >
        ← Back to Arena
      </Link>
    </div>
  );
}
