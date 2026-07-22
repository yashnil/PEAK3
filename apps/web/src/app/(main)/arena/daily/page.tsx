"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { draftProgress } from "@/lib/draft-progress";
import { todayUTC } from "@/lib/utils";
import { DraftMode, DraftCompletionSummary, MODE_LABELS } from "@/types/draft";

const MODES: DraftMode[] = ["apex_1y", "prime_3y", "foundation_5y"];

const MODE_SUBTITLES: Record<DraftMode, string> = {
  apex_1y: "Best single season peak",
  prime_3y: "Three-year prime window",
  foundation_5y: "Five-year foundation",
};

export default function DailyHubPage() {
  const today = todayUTC();
  const [completions, setCompletions] = useState<
    Partial<Record<DraftMode, DraftCompletionSummary>>
  >({});

  useEffect(() => {
    document.title = "Daily Peak | PEAK3 Arena";
    setCompletions(draftProgress.getAllDailyCompletions(today));
  }, [today]);

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
