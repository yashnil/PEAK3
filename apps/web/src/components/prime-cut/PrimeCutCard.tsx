"use client";

/**
 * The incoming peak. Player, exact multi-season window, duration in words, and
 * each season's team -- and no PEAK3 number, because the view carries none.
 *
 * ENTERS rather than swapping in place (`CardArrival`, keyed on the window),
 * and the controls live outside it so a press is never waiting on an animation.
 */

import { Check, Lock, Scissors } from "lucide-react";

import { CardArrival } from "@/components/game-feel";
import type { PrimeCutCard as PrimeCutCardData, PrimeCutDecision, PrimeCutDecisionRecord } from "@/types/prime-cut";

export function teamShort(team: string): string {
  return team === "Multiple teams" ? "2+ teams" : team;
}

export default function PrimeCutCard({
  card,
  decision,
  forcedDecision,
  everyoneForced,
}: {
  card: PrimeCutCardData;
  decision: PrimeCutDecisionRecord | null;
  forcedDecision: PrimeCutDecision | null;
  everyoneForced: boolean;
}) {
  const locked = decision?.decision ?? null;
  return (
    <CardArrival arrivalKey={card.window_id} variant="stage" className="pcut-card-wrap" testId="pcut-card-arrival">
      <article
        className="pcut-card"
        data-testid="pcut-card"
        data-decision={locked ?? "none"}
        aria-label={`${card.player_name}, ${card.duration}-year peak, ${card.start_season} to ${card.end_season}`}
      >
        <div className="pcut-card-top">
          <span className="pcut-duration" data-testid="pcut-card-duration">
            {card.duration}-year peak
          </span>
          <span className="pcut-card-count pk-numeral">Card {card.card_index + 1} of 8</span>
        </div>
        <h2 className="pcut-card-name" data-testid="pcut-card-name">
          {card.player_name}
        </h2>
        <p className="pcut-card-window pk-numeral" data-testid="pcut-card-window">
          {card.start_season}
          <span className="pcut-card-arrow" aria-hidden="true">
            {" "}→{" "}
          </span>
          <span className="sr-only"> to </span>
          {card.end_season}
        </p>
        <ol className="pcut-card-seasons" aria-label="Seasons in this window">
          {card.seasons.map((season) => (
            <li key={season.season} className="pcut-card-season">
              <span className="pk-numeral">{season.season}</span>
              <span className="pcut-card-team">{teamShort(season.team)}</span>
            </li>
          ))}
        </ol>

        {locked ? (
          <p className="pcut-stamp" data-decision={locked} data-testid="pcut-stamp">
            {locked === "keep" ? <Check size={18} aria-hidden="true" /> : <Scissors size={18} aria-hidden="true" />}
            <span>
              {decision?.auto === "forced" ? "Forced " : ""}
              {locked === "keep" ? "Kept" : "Cut"}
            </span>
            <Lock size={14} aria-hidden="true" />
          </p>
        ) : null}
        {!locked && forcedDecision ? (
          <p className="pcut-forced" data-testid="pcut-forced">
            Only {forcedDecision.toUpperCase()} is left for you on this heat.
          </p>
        ) : null}
        {everyoneForced ? (
          <p className="pcut-forced" data-testid="pcut-all-forced">
            Every seat&apos;s call on this card was already decided by their keep and cut counts.
          </p>
        ) : null}
      </article>
    </CardArrival>
  );
}
