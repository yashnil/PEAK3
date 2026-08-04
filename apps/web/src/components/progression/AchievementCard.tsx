"use client";

import { Achievement } from "@/lib/progression-api";

// Theme-aware — see `--achievement-*` in globals.css for why these are not
// literal hex (P3-G2: measured contrast failure as text on Arena Day).
const CATEGORY_COLORS: Record<string, string> = {
  onboarding:   "var(--achievement-onboarding)",
  challenge:    "var(--achievement-challenge)",
  construction: "var(--achievement-construction)",
  habit:        "var(--achievement-habit)",
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
        // `color-mix`, not a hex-alpha string suffix (`color + "40"`): once
        // `color` became a `var(--achievement-*)` reference (P3-G2), a
        // trailing hex pair produced the invalid CSS color
        // `var(--achievement-onboarding)40`, which the browser drops
        // silently rather than erroring on -- caught by actually reading
        // the computed style, not by assuming string concatenation still
        // worked once the value stopped being a literal hex.
        borderColor: earned ? `color-mix(in srgb, ${color} 40%, transparent)` : "var(--border-subtle)",
        opacity: earned ? 1 : 0.65,
      }}
      role="article"
      aria-label={`${achievement.title}${earned ? " — earned" : " — not yet earned"}`}
    >
      {/* Icon / badge */}
      <div
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
        style={{
          background: earned ? `color-mix(in srgb, ${color} 20%, transparent)` : "var(--bg-elevated)",
          color: earned ? color : "var(--text-muted)",
          border: `1.5px solid ${earned ? `color-mix(in srgb, ${color} 60%, transparent)` : "transparent"}`,
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
            style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}
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
