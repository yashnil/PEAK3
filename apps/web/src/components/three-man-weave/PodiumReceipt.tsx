"use client";
import Link from "next/link";
import type { ArenaResultView, TmwRoster, TmwSlotType } from "@/types/three-man-weave";
import { TMW_SLOT_LABELS, TMW_SLOT_TYPES } from "@/types/three-man-weave";
import {
  RANKING_BASIS_LABEL,
  outcomeHeadline,
  podium,
  rankingBasisLabel,
  scoreSourceNote,
  slotAbbrev,
} from "@/lib/three-man-weave-state";
import Celebration from "@/components/shared/Celebration";

/**
 * The final placement and the three-way receipt.
 *
 * THREE BINDING RULES LIVE ON THIS SURFACE.
 *
 * 1. THE RANKING BASIS IS NAMED WHERE THE WINNER IS DECLARED -- not in a
 *    tooltip, not in a footnote. The number that decided the match is the 82-0
 *    model's lineup-quality index over the six drafted cards, and a reader who
 *    assumed it was the average of the six scores on screen would be wrong in a
 *    way that makes a close result look arbitrary. The basis sentence sits
 *    directly under the headline.
 *
 * 2. THERE IS NO PROJECTED RECORD. Not smaller, not muted, not labelled --
 *    absent. The 82-0 record projection is calibrated for an eight-card roster
 *    and this mode plays six, so "68-14 projected" would be a claim the mode
 *    cannot stand behind however carefully it were hedged. The server does not
 *    send one and there is no field here to render.
 *
 * 3. EVERY EXPLANATION IS A MEASURED COMPONENT, NOT PROSE. "Decisive pick" is a
 *    leave-one-out marginal computed by re-running the same evaluator without
 *    that card; the fit components are the evaluator's own outputs. The
 *    previous receipt carried sentences like "low team-context depth", which
 *    read as a basketball judgement and were really a percentile with no scale
 *    attached.
 *
 * A roster that could not be fully scored gets a real state -- "Not ranked",
 * with the reason -- rather than a blank or a zero. `scoreDisplay` returns a
 * discriminated union precisely so the `unrankable` case cannot be forgotten.
 */
export default function PodiumReceipt({
  results,
  rosters,
  yourSeatIndex,
  onPlayAgain,
}: {
  results: ArenaResultView[];
  rosters: TmwRoster[];
  yourSeatIndex: number | null;
  onPlayAgain: () => void;
}) {
  const rows = podium(results);
  const unrankableReason =
    rows.map((row) => row.score).find((score) => score.kind === "unrankable")?.reason ??
    null;

  if (!rows.length) {
    return (
      <section data-testid="tmw-podium" className="tmw-result">
        <p className="tmw-result-empty">This match has no recorded result.</p>
      </section>
    );
  }

  const yours = rows.find((row) => row.result.seat_index === yourSeatIndex) ?? null;
  const placement = yours?.result.placement ?? null;
  const won = placement === 1;

  return (
    <section
      data-testid="tmw-podium"
      data-your-placement={placement ?? "none"}
      className="tmw-result"
    >
      {/* The celebration is decoration over a decided result and never blocks
          a control: it is `pointer-events: none`, it is skipped entirely under
          reduced motion, and nothing below waits for it. */}
      <Celebration active={won} testId="tmw-celebration" />

      <header className="tmw-result-head" data-tier={tierOf(placement)}>
        <p className="tmw-result-placement" data-testid="tmw-your-placement">
          {placement === null
            ? "Match complete"
            : placement === 1
              ? "1st place"
              : placement === 2
                ? "2nd place"
                : `${ordinal(placement)} place`}
        </p>
        <h2 className="tmw-result-headline" data-testid="tmw-outcome">
          {outcomeHeadline(rows)}
        </h2>
        <p className="tmw-result-basis" data-testid="tmw-ranking-basis">
          {rankingBasisLabel()}
        </p>
      </header>

      <ol className="tmw-result-rows" data-testid="tmw-result-rows">
        {rows.map((row) => {
          const roster = rosters.find(
            (entry) => entry.seat_index === row.result.seat_index,
          );
          const detail = row.result.detail;
          return (
            <li
              key={row.result.seat_index}
              data-testid={`tmw-result-${row.result.seat_index}`}
              data-placement={row.result.placement}
              data-is-you={row.result.seat_index === yourSeatIndex}
              className="tmw-result-row"
            >
              <div className="tmw-result-row-head">
                <span className="tmw-result-rank">{row.result.placement}</span>
                <span className="tmw-result-name">
                  {row.result.display_name}
                  {row.result.seat_index === yourSeatIndex && (
                    <span className="tmw-result-you"> · you</span>
                  )}
                  {row.tied && <span className="tmw-result-tied"> · drawn</span>}
                </span>
                <span className="tmw-result-score">
                  {row.score.kind === "scored" ? (
                    <>
                      <strong>{row.score.text}</strong>
                      <span className="tmw-result-score-label">
                        {RANKING_BASIS_LABEL}
                      </span>
                    </>
                  ) : (
                    <span className="tmw-result-unranked">{row.score.text}</span>
                  )}
                </span>
              </div>

              {row.meanSeasonScore !== null && (
                <p className="tmw-result-secondary" data-testid={`tmw-mean-${row.result.seat_index}`}>
                  Mean season PEAK3 {row.meanSeasonScore.toFixed(1)} — reported for
                  reading, not the basis.
                </p>
              )}

              {roster && (
                <ul className="tmw-result-cards">
                  {TMW_SLOT_TYPES.map((slot) => {
                    const pick = roster.slots[slot];
                    const decisive = detail?.decisive_pick?.slot_type === slot;
                    return (
                      <li
                        key={slot}
                        className="tmw-result-card"
                        data-slot={slot}
                        data-decisive={decisive ? "true" : "false"}
                      >
                        <span className="tmw-result-card-tag">
                          <span aria-hidden="true">{slotAbbrev(slot as TmwSlotType)}</span>
                          <span className="sr-only">
                            {TMW_SLOT_LABELS[slot as TmwSlotType]}
                          </span>
                        </span>
                        <span className="tmw-result-card-body">
                          <span className="tmw-result-card-name">
                            {pick?.player_name ?? "—"}
                          </span>
                          <span className="tmw-result-card-season">
                            {pick?.scoring_card
                              ? `${pick.scoring_card.season} ${pick.scoring_card.team_name}`
                              : "—"}
                          </span>
                          {pick && scoreSourceNote(pick) && (
                            <span className="tmw-result-card-note">
                              {scoreSourceNote(pick)}
                            </span>
                          )}
                          <span className="tmw-result-card-origin">
                            Drafted on {pick?.eligibility.franchise_display_name ?? "—"}{" "}
                            {pick?.decade ?? ""}
                          </span>
                        </span>
                        <span className="tmw-result-card-score">
                          {pick?.scoring_card
                            ? pick.scoring_card.prime_score.toFixed(1)
                            : "—"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}

              {detail && (
                <dl className="tmw-result-facts">
                  {detail.decisive_pick && (
                    <div data-testid={`tmw-decisive-${row.result.seat_index}`}>
                      <dt>Decisive pick</dt>
                      <dd>
                        {detail.decisive_pick.player_name} (
                        {detail.decisive_pick.season} {detail.decisive_pick.team_id}) —
                        removing them costs{" "}
                        {detail.decisive_pick.lineup_quality_drop.toFixed(2)} lineup
                        score, the most of the six.
                      </dd>
                    </div>
                  )}
                  {detail.best_pick && (
                    <div>
                      <dt>Best value</dt>
                      <dd>{detail.best_pick}</dd>
                    </div>
                  )}
                  {detail.fit_components && (
                    <div data-testid={`tmw-fit-${row.result.seat_index}`}>
                      <dt>Positional fit</dt>
                      <dd>
                        {detail.fit_components.positional_fit.toFixed(0)} / 100 ·
                        starter talent{" "}
                        {detail.fit_components.talent_core.toFixed(1)} · bench{" "}
                        {detail.fit_components.bench_strength.toFixed(1)}
                      </dd>
                    </div>
                  )}
                </dl>
              )}
            </li>
          );
        })}
      </ol>

      {unrankableReason && (
        <p className="tmw-result-unranked-note" data-testid="tmw-unranked-reason">
          {unrankableReason}
        </p>
      )}

      <footer className="tmw-result-actions">
        <button
          type="button"
          className="btn-primary"
          data-testid="tmw-play-again"
          onClick={onPlayAgain}
        >
          Play again
        </button>
        <Link href="/arena" className="btn-secondary" data-testid="tmw-back-to-arena">
          Back to Arena
        </Link>
      </footer>
    </section>
  );
}

function tierOf(placement: number | null): string {
  if (placement === 1) return "first";
  if (placement === 2) return "second";
  if (placement === null) return "none";
  return "third";
}

function ordinal(value: number): string {
  const suffix = value === 1 ? "st" : value === 2 ? "nd" : value === 3 ? "rd" : "th";
  return `${value}${suffix}`;
}
