"use client";

import { LevelSummary } from "@/lib/progression-api";

interface Props {
  level: LevelSummary;
  compact?: boolean;
}

export function XpProgress({ level, compact = false }: Props) {
  const pct = Math.round(level.progress_fraction * 100);
  const atCap = level.current_level >= level.level_cap;

  return (
    <div className={compact ? "flex items-center gap-2" : "space-y-1"}>
      <div className="flex items-baseline gap-1">
        <span
          className="font-bold tabular-nums"
          style={{ color: "var(--peak-accent)", fontSize: compact ? "0.875rem" : "1rem" }}
        >
          Lv {level.current_level}
        </span>
        {!compact && (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {atCap ? "Max" : `${level.xp_into_level} / ${level.xp_for_next_level} XP`}
          </span>
        )}
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Level ${level.current_level}, ${pct}% to next level`}
        className="rounded-full overflow-hidden"
        style={{
          height: compact ? "4px" : "6px",
          background: "var(--bg-elevated)",
          width: compact ? "64px" : "100%",
        }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: "var(--peak-accent)",
          }}
        />
      </div>
    </div>
  );
}
