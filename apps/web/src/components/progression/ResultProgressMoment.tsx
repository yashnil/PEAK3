"use client";

import { ResultProgressMoment as Moment, RECORD_TYPE_LABELS } from "@/lib/progression-api";

interface Props {
  moment: Moment;
  achievementTitles?: Record<string, string>;
}

/**
 * What the last game moved.
 *
 * This block is a REWARD — an achievement, a level, a personal best — and it
 * was rendering as a two-row definition list in 12px grey on a flat panel,
 * indistinguishable from the receipt rows around it. It now reads as a lit
 * plate: `.pk-depth` for the raised surface, the ACCENT crown (`.pk-crown
 * -accent`) along its top edge because this is the good news on the screen,
 * and each row arriving on the shared `--pk-stagger` rhythm.
 *
 * ONE EFFECT, NOT A STACK. There is no spotlight ring here as well as the
 * crown, and no pulse: `AchievementUnlock` is the surface that gets the
 * spotlight, and two reward treatments competing on one receipt is how a game
 * screen starts looking like a slot machine.
 *
 * NO COUNT-UP ON THE VALUES, DELIBERATELY. `+100` is asserted as exact text in
 * `progression-components.test.tsx`, and every count-up component here carries
 * a visually-hidden sibling with the authoritative value, which doubles the
 * element's text content. The values are short enough that a count-up would be
 * two frames of motion anyway.
 */
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
      className="pk-depth pk-crown pk-crown-accent rounded-lg border px-3 py-2.5 flex flex-col gap-1.5"
      style={{ borderColor: "var(--border-subtle)" }}
      aria-label="Your progression this game"
      role="region"
    >
      {visible.map((line, i) => (
        <div
          key={i}
          className="pk-reveal flex items-center justify-between gap-2"
          style={{ "--pk-reveal-index": i } as React.CSSProperties}
        >
          {/* WAS `--text-muted`. It names the reward beside it — "Achievement",
              "Level reached", "Streak" — which is the half of the row that
              tells you what just happened. */}
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            {line.label}
          </span>
          {/* The value carries the display face now: this is the payoff line
              on the receipt, not a table cell. */}
          <span
            className="font-display text-sm font-bold"
            style={{ color: line.accent ? "var(--peak-accent-text)" : "var(--text-primary)" }}
          >
            {line.value}
          </span>
        </div>
      ))}
    </div>
  );
}
