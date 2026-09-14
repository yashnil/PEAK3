import Link from "next/link";

import type { ArenaSkill } from "@/lib/arena-leaderboard-api";
import {
  compositionCopy,
  formatRating,
  percentileCopy,
  reasonCopy,
  recordCopy,
} from "./leaderboard-copy";

/**
 * "Your rating" — one player's competitive identity in one mode.
 *
 * Every line is either a server value or the server's reason for withholding
 * it. The bot line is not optional: a public match that waits out its search
 * is filled with bots and still rated, so a rating is always shown next to how
 * much of it was earned against people.
 */
export default function SkillCard({ skill, mode }: { skill: ArenaSkill; mode: string }) {
  if (!skill.rated) {
    return (
      <section className="alb-panel alb-skill" aria-labelledby="alb-skill-title" data-testid="alb-skill-card" data-state="unrated">
        <h2 id="alb-skill-title" className="alb-panel-title">
          Your rating
        </h2>
        <p className="alb-skill-empty">{reasonCopy(skill.tier_reason ?? "not_rated", skill)}</p>
        <Link className="alb-link" href={`/arena/lobby?game=${encodeURIComponent(mode)}`}>
          Find a public match
        </Link>
      </section>
    );
  }

  const tierLine = skill.tier
    ? skill.tier_capped
      ? `${skill.tier} (top tiers open at a larger player base)`
      : skill.tier
    : reasonCopy(skill.tier_reason, skill);

  return (
    <section
      className="alb-panel alb-skill"
      aria-labelledby="alb-skill-title"
      data-testid="alb-skill-card"
      data-state={skill.provisional ? "provisional" : "rated"}
    >
      <h2 id="alb-skill-title" className="alb-panel-title">
        Your rating
      </h2>
      <p className="alb-skill-rating">
        <span className="alb-skill-number" data-testid="alb-skill-rating">
          {formatRating(skill.rating)}
        </span>
        <span className="alb-skill-tier" data-testid="alb-skill-tier">
          {tierLine}
        </span>
      </p>
      {skill.next_tier && skill.next_tier_rating != null && (
        <p className="alb-skill-next">
          {skill.next_tier} at {formatRating(skill.next_tier_rating)}
        </p>
      )}
      <dl className="alb-facts">
        <div>
          <dt>Rank</dt>
          <dd data-testid="alb-skill-rank">
            {skill.rank != null
              ? `#${skill.rank.toLocaleString()} of ${skill.population.rated_population.toLocaleString()}`
              : reasonCopy(skill.rank_reason, skill)}
          </dd>
        </div>
        <div>
          <dt>Percentile</dt>
          <dd data-testid="alb-skill-percentile">{percentileCopy(skill)}</dd>
        </div>
        <div>
          <dt>Rated record</dt>
          <dd>{recordCopy(skill.wins, skill.losses, skill.draws)}</dd>
        </div>
        <div>
          <dt>Rated matches</dt>
          <dd data-testid="alb-skill-composition">
            {skill.rated_matches_counted.toLocaleString()} ·{" "}
            {compositionCopy(skill.matches_all_human, skill.matches_with_bots)}
          </dd>
        </div>
        {skill.best_rated_score != null && (
          <div>
            <dt>Best rated score</dt>
            <dd>{skill.best_rated_score.toLocaleString(undefined, { maximumFractionDigits: 1 })}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
