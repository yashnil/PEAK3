"use client";

import { StreakState } from "@/lib/progression-api";
// See its own docstring for why a result number is not `AnimatedNumber`.
import { ResultNumber } from "@/components/game/result-number";

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
          style={{ color: streak.current_streak > 0 ? "var(--peak-accent-text)" : "var(--text-muted)" }}
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
            style={{ background: "var(--peak-accent-bg)", color: "var(--peak-accent-text)" }}
          >
            +1
          </span>
        )}
      </div>
    );
  }

  return (
    /* A LIVE streak is a reward, so it gets the spotlight ring; a dead one
       gets the ordinary raised surface and nothing else. One or the other,
       never both: `.pk-depth` is declared after `.pk-spotlight` in globals.css
       and would overwrite its `box-shadow` outright. */
    <div
      className={`pk-crown rounded-xl border p-4 space-y-3 ${
        streak.current_streak > 0 ? "pk-spotlight" : "pk-depth"
      }`}
      style={{
        background: "var(--bg-surface)",
        borderColor: streak.current_streak > 0 ? undefined : "var(--border-subtle)",
      }}
    >
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-bold" style={{ color: "var(--text-primary)" }}>
          Daily Streak
        </h3>
        {hasReserve && (
          <span
            className="text-xs px-2 py-0.5 rounded"
            style={{ background: "var(--peak-accent-bg)", color: "var(--peak-accent-text)" }}
            title="1 reserve day available — protects one missed day"
            aria-label="Reserve day available"
          >
            Reserve available
          </span>
        )}
      </div>

      <div className="flex items-end gap-4">
        <div>
          {/* The streak counts to itself. The `aria-label` on the wrapper
              still carries the full sentence, and `ResultNumber`'s own
              screen-reader sibling carries the exact figure from the first
              paint, so nothing is behind the animation. */}
          <div
            className="font-display text-3xl font-bold"
            aria-label={`Current streak: ${streak.current_streak} days`}
            style={{ color: streak.current_streak > 0 ? "var(--peak-accent-text)" : "var(--text-secondary)" }}
          >
            <ResultNumber value={streak.current_streak} />
          </div>
          {/* WAS `--text-muted`. Two numbers stacked beside each other need
              the two words that tell them apart. */}
          <div className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            current
          </div>
        </div>
        <div className="mb-1">
          <div
            className="font-display text-lg font-semibold"
            aria-label={`Longest streak: ${streak.longest_streak} days`}
            style={{ color: "var(--text-secondary)" }}
          >
            <ResultNumber value={streak.longest_streak} />
          </div>
          <div className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            best
          </div>
        </div>
      </div>

      {streak.current_streak === 0 && (
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Complete today&apos;s Daily board to start a streak.
        </p>
      )}

      {!hasReserve && streak.current_streak > 0 && streak.current_streak < 7 && (
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
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
