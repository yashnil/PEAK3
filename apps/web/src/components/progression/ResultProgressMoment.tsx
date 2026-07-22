"use client";

import { ResultProgressMoment as Moment, RECORD_TYPE_LABELS } from "@/lib/progression-api";

interface Props {
  moment: Moment;
  achievementTitles?: Record<string, string>;
}

export function ResultProgressMoment({ moment, achievementTitles = {} }: Props) {
  // Pick the single most meaningful progression moment to surface
  // Priority: new achievement > new level > new personal record > streak advance > XP
  const lines: { label: string; value: string; accent?: boolean }[] = [];

  for (const key of moment.new_achievements) {
    const title = achievementTitles[key] ?? key;
    lines.push({ label: "Achievement", value: title, accent: true });
  }

  if (moment.new_level) {
    lines.push({ label: "Level reached", value: `Level ${moment.new_level}`, accent: true });
  }

  for (const pr of moment.new_personal_records) {
    const label = `${RECORD_TYPE_LABELS[pr.record_type] ?? pr.record_type} PB`;
    const val =
      pr.record_type === "draft_efficiency"
        ? `${(pr.value * 100).toFixed(1)}%`
        : pr.value.toFixed(1);
    lines.push({ label, value: val });
  }

  if (moment.streak_advanced && (moment.current_streak ?? 0) > 0) {
    lines.push({
      label: moment.streak_reserve_consumed ? "Streak (reserve used)" : "Streak",
      value: `${moment.current_streak} day${(moment.current_streak ?? 0) !== 1 ? "s" : ""}`,
    });
  }

  if (moment.streak_reserve_earned) {
    lines.push({ label: "Reserve earned", value: "One skip protected" });
  }

  if (moment.xp_awarded > 0) {
    lines.push({ label: "XP", value: `+${moment.xp_awarded}` });
  }

  if (lines.length === 0) return null;

  // Show at most 2 items to avoid overwhelming the receipt
  const visible = lines.slice(0, 2);

  return (
    <div
      className="rounded-lg border px-3 py-2.5 flex flex-col gap-1.5"
      style={{ background: "var(--bg-elevated)", borderColor: "var(--border-subtle)" }}
      aria-label="Your progression this game"
      role="region"
    >
      {visible.map((line, i) => (
        <div key={i} className="flex items-center justify-between gap-2">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {line.label}
          </span>
          <span
            className="text-xs font-semibold"
            style={{ color: line.accent ? "var(--peak-accent)" : "var(--text-primary)" }}
          >
            {line.value}
          </span>
        </div>
      ))}
    </div>
  );
}
