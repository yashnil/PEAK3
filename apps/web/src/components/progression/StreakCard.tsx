"use client";

import { StreakState } from "@/lib/progression-api";

interface Props {
  streak: StreakState;
  compact?: boolean;
}

export function StreakCard({ streak, compact = false }: Props) {
  const hasReserve = streak.reserve_count > 0;

  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        <span
          role="img"
          aria-label="streak flame"
          className="text-sm"
          style={{ color: streak.current_streak > 0 ? "var(--peak-accent)" : "var(--text-muted)" }}
        >
          🔥
        </span>
        <span
          className="font-semibold tabular-nums text-sm"
          style={{ color: streak.current_streak > 0 ? "var(--text-primary)" : "var(--text-muted)" }}
        >
          {streak.current_streak}
        </span>
        {hasReserve && (
          <span
            title="Reserve day available"
            aria-label="Reserve day available"
            className="text-xs px-1 rounded"
            style={{ background: "rgba(245,200,66,0.15)", color: "var(--peak-accent)" }}
          >
            +1
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>
          Daily Streak
        </h3>
        {hasReserve && (
          <span
            className="text-xs px-2 py-0.5 rounded"
            style={{ background: "rgba(245,200,66,0.15)", color: "var(--peak-accent)" }}
            title="1 reserve day available — protects one missed day"
            aria-label="Reserve day available"
          >
            Reserve available
          </span>
        )}
      </div>

      <div className="flex items-end gap-4">
        <div>
          <div
            className="text-3xl font-bold tabular-nums"
            aria-label={`Current streak: ${streak.current_streak} days`}
            style={{ color: streak.current_streak > 0 ? "var(--peak-accent)" : "var(--text-muted)" }}
          >
            {streak.current_streak}
          </div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            current
          </div>
        </div>
        <div className="mb-1">
          <div
            className="text-lg font-semibold tabular-nums"
            aria-label={`Longest streak: ${streak.longest_streak} days`}
            style={{ color: "var(--text-secondary)" }}
          >
            {streak.longest_streak}
          </div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            best
          </div>
        </div>
      </div>

      {streak.current_streak === 0 && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Complete today&apos;s Daily board to start a streak.
        </p>
      )}

      {!hasReserve && streak.current_streak > 0 && streak.current_streak < 7 && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Reach a 7-day streak to earn a reserve day.
        </p>
      )}

      {streak.last_qualifying_date && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Last qualified: {new Date(streak.last_qualifying_date + "T12:00:00").toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
