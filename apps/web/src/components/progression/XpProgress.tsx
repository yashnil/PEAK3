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
          className="font-display font-bold tabular-nums"
          style={{ color: "var(--peak-accent-text)", fontSize: compact ? "0.875rem" : "1rem" }}
        >
          Lv {level.current_level}
        </span>
        {/* WAS `--text-muted`. "150 / 200 XP" is the whole readout of how far
            through a level a player is — the number the bar beneath it is a
            picture OF. The string itself is unchanged; it is asserted
            verbatim in `progression-components.test.tsx`. */}
        {!compact && (
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
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
          // The track is a RECESS, the fill is what sits in it. `--pk-well` is
          // the shared inset the design system already names for exactly this,
          // and it is the whole difference between a progress bar that reads
          // as a channel and one that reads as two coloured rectangles.
          boxShadow: "var(--pk-well)",
        }}
      >
        <div
          /* Fill travels on the shared decelerate curve rather than Tailwind's
             default ease — XP arriving is something the player caused, so it
             starts at full speed. The global reduced-motion rule collapses the
             duration; nothing here is gated behind it either way, since the
             bar's value is already announced through `aria-valuenow`. */
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: "var(--peak-accent)",
            transition: `width var(--pk-dur-slower) var(--pk-ease-decel)`,
          }}
        />
      </div>
    </div>
  );
}
