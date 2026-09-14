import Link from "next/link";

import type { ArenaSkill } from "@/lib/arena-leaderboard-api";
import { formatRating, modeLabel } from "./leaderboard-copy";

/**
 * A compact rating chip that links to the mode's leaderboard.
 *
 * PRESENTATIONAL AND DATA-IN. It fetches nothing, so the lobby or a result
 * screen can render it from a skill card it already holds
 * (`arenaStandingsApi.skill(mode)` or `PersonalRecordResponse.skill`) without a
 * second request. Every state is a real server state:
 *
 *   unrated      no rated match in this mode (or no skill card at all)
 *   provisional  rated, not yet established — no tier name is shown
 *   rated        rating plus the tier the server assigned
 */

export type SkillBadgeState = "unrated" | "provisional" | "rated";

export interface SkillBadgeText {
  state: SkillBadgeState;
  primary: string;
  secondary: string;
}

export function skillBadgeText(skill: ArenaSkill | null | undefined): SkillBadgeText {
  if (!skill || !skill.rated) {
    return { state: "unrated", primary: "Unrated", secondary: "Play a public match" };
  }
  if (skill.provisional) {
    const needed = skill.population.provisional_until;
    const played = Math.min(skill.rated_matches, needed);
    return {
      state: "provisional",
      primary: formatRating(skill.rating),
      secondary: `Provisional ${played}/${needed}`,
    };
  }
  return { state: "rated", primary: formatRating(skill.rating), secondary: skill.tier ?? "Rated" };
}

export interface ArenaSkillBadgeProps {
  mode: string;
  skill: ArenaSkill | null | undefined;
  /** Defaults to the mode's leaderboard. Pass `null` to render without a link. */
  href?: string | null;
  className?: string;
}

export default function ArenaSkillBadge({ mode, skill, href, className }: ArenaSkillBadgeProps) {
  const text = skillBadgeText(skill);
  const label = `Your ${modeLabel(mode)} rating: ${text.primary}, ${text.secondary}`;
  const body = (
    <>
      <span className="alb-badge-primary">{text.primary}</span>
      <span className="alb-badge-secondary">{text.secondary}</span>
    </>
  );
  const classes = ["alb-badge", className].filter(Boolean).join(" ");
  const target = href === undefined ? `/arena/leaderboard/${encodeURIComponent(mode)}` : href;

  if (target === null) {
    return (
      <span className={classes} data-testid="arena-skill-badge" data-state={text.state} aria-label={label}>
        {body}
      </span>
    );
  }
  return (
    <Link
      href={target}
      className={classes}
      data-testid="arena-skill-badge"
      data-state={text.state}
      aria-label={`${label}. View the leaderboard.`}
    >
      {body}
    </Link>
  );
}
