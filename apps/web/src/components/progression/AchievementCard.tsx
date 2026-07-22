"use client";

import { Achievement } from "@/lib/progression-api";

const CATEGORY_COLORS: Record<string, string> = {
  onboarding:   "#60a5fa",  // blue
  challenge:    "#fb923c",  // orange
  construction: "#a78bfa",  // violet
  habit:        "#34d399",  // emerald
};

interface Props {
  achievement: Achievement;
  showDescription?: boolean;
}

export function AchievementCard({ achievement, showDescription = false }: Props) {
  const color = CATEGORY_COLORS[achievement.category] ?? "var(--text-secondary)";
  const earned = achievement.earned;

  return (
    <div
      className="rounded-lg border p-3 flex gap-3 items-start"
      style={{
        background: earned ? "var(--bg-surface)" : "var(--bg-page)",
        borderColor: earned ? color + "40" : "var(--border-subtle)",
        opacity: earned ? 1 : 0.65,
      }}
      role="article"
      aria-label={`${achievement.title}${earned ? " — earned" : " — not yet earned"}`}
    >
      {/* Icon / badge */}
      <div
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
        style={{
          background: earned ? color + "20" : "var(--bg-elevated)",
          color: earned ? color : "var(--text-muted)",
          border: `1.5px solid ${earned ? color + "60" : "transparent"}`,
        }}
        aria-hidden="true"
      >
        {earned ? "✓" : "○"}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span
            className="text-sm font-semibold"
            style={{ color: earned ? "var(--text-primary)" : "var(--text-secondary)" }}
          >
            {achievement.title}
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded capitalize"
            style={{ background: color + "18", color }}
          >
            {achievement.category}
          </span>
        </div>

        {showDescription && (
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            {earned ? achievement.description : achievement.requirement_copy}
          </p>
        )}

        {earned && achievement.earned_at && (
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            Earned {new Date(achievement.earned_at).toLocaleDateString()}
          </p>
        )}
      </div>
    </div>
  );
}
