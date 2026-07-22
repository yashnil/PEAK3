"use client";

import Link from "next/link";
import { ProgressionSummary } from "@/lib/progression-api";
import { XpProgress } from "./XpProgress";
import { StreakCard } from "./StreakCard";

interface Props {
  summary: ProgressionSummary;
  streakState: {
    current_streak: number;
    longest_streak: number;
    last_qualifying_date: string | null;
    reserve_count: number;
    reserve_cap: number;
    policy_version: string;
  };
  compact?: boolean;
}

export function ProgressSummary({ summary, streakState, compact = false }: Props) {
  if (compact) {
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <XpProgress level={summary.level} compact />
        <StreakCard streak={streakState} compact />
        {summary.achievement_count > 0 && (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {summary.achievement_count} achievement{summary.achievement_count !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        className="rounded-xl border p-4 space-y-3"
        style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>
            Progress
          </span>
          <Link
            href="/profile"
            className="text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            View profile →
          </Link>
        </div>
        <XpProgress level={summary.level} />
      </div>
      <StreakCard streak={streakState} />
    </div>
  );
}
