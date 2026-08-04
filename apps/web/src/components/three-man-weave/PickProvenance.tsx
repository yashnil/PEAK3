"use client";
import type { TmwPlayer } from "@/types/three-man-weave";
import {
  eligibilityLine,
  hasTradedEvidence,
  scoreSourceNote,
  scoringCardLine,
} from "@/lib/three-man-weave-state";

/**
 * The two facts about a pick, shown SEPARATELY and labelled.
 *
 *   ELIGIBLE THROUGH   Toronto Raptors · 2018-19
 *   SCORING CARD       2016-17 San Antonio Spurs · 1Y PEAK3 87.8
 *
 * These are different claims about different seasons and collapsing them
 * would make the game's central rule unreadable. Kawhi is a legal Raptors
 * pick because of one Toronto season; he is WORTH his best season anywhere in
 * the decade, which is a San Antonio one. Shaquille O'Neal drafted on a 2000s
 * roll scoring 2000-01 rather than his better 1999-00 reads as a straight bug
 * unless this block is on screen — the 1999-00 season belongs to the 1990s.
 *
 * A mid-season trade is disclosed rather than smoothed over, in both
 * directions: as eligibility (the stint is real and is what makes the player
 * legal) and as a score (the number is a whole-season aggregate, which is the
 * complete and correct answer for that season but is not one team's share).
 */
export default function PickProvenance({
  player,
  compact = false,
}: {
  player: TmwPlayer;
  compact?: boolean;
}) {
  const scoring = scoringCardLine(player);
  const sourceNote = scoreSourceNote(player);
  const traded = hasTradedEvidence(player);

  return (
    <dl
      data-testid="tmw-provenance"
      className={`grid grid-cols-[auto_1fr] gap-x-3 ${compact ? "gap-y-0.5" : "gap-y-1"}`}
    >
      <dt
        className="text-[9px] font-bold uppercase tracking-widest self-center"
        style={{ color: "var(--text-muted)" }}
      >
        Eligible through
      </dt>
      <dd
        data-testid="tmw-eligible-through"
        className="text-xs min-w-0 truncate"
        style={{ color: "var(--text-secondary)" }}
      >
        {eligibilityLine(player)}
        {traded && (
          <span
            data-testid="tmw-traded-eligibility"
            className="ml-1.5 text-[9px] font-semibold uppercase tracking-wide"
            style={{ color: "var(--text-muted)" }}
            title="Joined this franchise mid-season in a trade. A real appearance."
          >
            via trade
          </span>
        )}
      </dd>

      <dt
        className="text-[9px] font-bold uppercase tracking-widest self-center"
        style={{ color: "var(--peak-accent-text)" }}
      >
        Scoring card
      </dt>
      <dd
        data-testid="tmw-scoring-card"
        className="text-xs font-semibold min-w-0 truncate"
        style={{ color: "var(--text-primary)" }}
      >
        {scoring ?? "No scored season in this decade"}
      </dd>

      {sourceNote && (
        <dd
          data-testid="tmw-score-source-note"
          className="col-span-2 text-[10px] leading-snug"
          style={{ color: "var(--text-muted)" }}
        >
          {sourceNote}
        </dd>
      )}
    </dl>
  );
}
