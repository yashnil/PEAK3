"use client";
import Link from "next/link";
import type { ArenaResultView, TmwRoster, TmwSlotType } from "@/types/three-man-weave";
import { TMW_SLOT_LABELS, TMW_SLOT_TYPES } from "@/types/three-man-weave";
import {
  RANKING_BASIS_LABEL,
  ordinal,
  outcomeHeadline,
  podium,
  rankingBasisLabel,
  resultBand,
  resultLine,
  scoreSourceNote,
  seatAccent,
  slotAbbrev,
} from "@/lib/three-man-weave-state";
import PlayerAvatar from "@/components/court/PlayerAvatar";
import Celebration from "@/components/shared/Celebration";

/**
 * THE FINISH. A competitive result, not an analytics report.
 *
 * WHAT TMW-14 DELETED FROM THE CELEBRATION LAYER, and why each one had to go:
 *
 *   * the long "Ranked on PEAK3 lineup score — the 82-0 model's lineup-quality
 *     index over these six seasons…" paragraph, directly under the headline;
 *   * "Decisive pick", a leave-one-out marginal printed to two decimals;
 *   * "Best value";
 *   * "Positional fit  100 / 100 · starter talent 70.0 · bench 55.0";
 *   * the mean-season-score explanation, on every row;
 *   * and the separate "Show all three final rosters" disclosure, which
 *     duplicated the rosters this screen was already showing.
 *
 * None of that is wrong and none of it is deleted from the product -- it is all
 * still here, one click away, under "Full receipt". It simply is not what the
 * end of a match should open with. THE MODULE RULE STILL HOLDS: the ranking
 * basis is named wherever a winner is declared, and there is still no projected
 * record anywhere, because the 82-0 record projection is calibrated for eight
 * cards and this mode plays six.
 *
 * WHAT REPLACED IT:
 *
 *   * a placement badge and a deterministic line from a small response bank,
 *     keyed to placement AND margin -- so a two-tenths loss reads "One pick
 *     away" and a fifteen-point loss does not;
 *   * the winner and the final lineup score, as the two numbers that decided it;
 *   * three ranking cards, each carrying that team's COMPLETE final roster with
 *     headshots, so the payoff screen shows the thing six rounds were spent
 *     building;
 *   * a centred, max-width composition with the winner elevated -- not three
 *     cards stretched across a 1700px monitor.
 *
 * COLOUR IS NEVER THE ONLY SIGNAL. First place takes the gold championship
 * treatment and second and third take distinct muted families, and every card
 * also carries its rank numeral, its ordinal in words and, for the human, an
 * explicit "you" marker.
 *
 * A roster that could not be fully scored gets a real state -- "Not ranked",
 * with the reason -- rather than a blank or a zero. `scoreDisplay` returns a
 * discriminated union precisely so the `unrankable` case cannot be forgotten.
 */
export default function PodiumReceipt({
  results,
  rosters,
  yourSeatIndex,
  seed = "",
  onPlayAgain,
}: {
  results: ArenaResultView[];
  rosters: TmwRoster[];
  yourSeatIndex: number | null;
  /** Match id. Keys the response bank so repeat plays vary and a reload of the
   *  SAME result says the same thing. */
  seed?: string;
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
  const band = resultBand(rows, yourSeatIndex);
  const winner = rows.find((row) => row.result.placement === 1) ?? null;

  return (
    <section
      data-testid="tmw-podium"
      data-your-placement={placement ?? "none"}
      data-band={band}
      className="tmw-result"
    >
      {/* Decoration over a decided result: `pointer-events: none`, skipped
          entirely under reduced motion, and nothing below waits for it. */}
      <Celebration active={won} testId="tmw-celebration" />

      <header className="tmw-result-head" data-tier={tierOf(placement)}>
        <p className="tmw-result-badge" data-testid="tmw-your-placement">
          <span className="tmw-result-badge-rank pk-numeral" aria-hidden="true">
            {placement ?? "—"}
          </span>
          <span className="tmw-result-badge-word">
            {placement === null ? "Complete" : ordinal(placement)}
          </span>
        </p>
        <h2 className="tmw-result-line" data-testid="tmw-result-line">
          {resultLine(band, seed || String(placement ?? "none"))}
        </h2>
        <p className="tmw-result-headline" data-testid="tmw-outcome">
          {outcomeHeadline(rows)}
          {winner && winner.score.kind === "scored" ? (
            <span className="tmw-result-headline-score score-number">
              {winner.score.text}
            </span>
          ) : null}
        </p>
      </header>

      <ol className="tmw-result-rows" data-testid="tmw-result-rows">
        {rows.map((row) => {
          const roster = rosters.find(
            (entry) => entry.seat_index === row.result.seat_index,
          );
          const isYou = row.result.seat_index === yourSeatIndex;
          return (
            <li
              key={row.result.seat_index}
              data-testid={`tmw-result-${row.result.seat_index}`}
              data-placement={row.result.placement}
              data-is-you={isYou}
              data-seat-accent={seatAccent(row.result.seat_index)}
              className="tmw-result-card"
            >
              <div className="tmw-result-card-head">
                <span className="tmw-result-rank pk-numeral" aria-hidden="true">
                  {row.result.placement}
                </span>
                <span className="tmw-result-name">
                  {row.result.display_name}
                  <span className="sr-only">{`, ${ordinal(row.result.placement)}`}</span>
                  {isYou && <span className="tmw-result-you"> · you</span>}
                  {row.tied && <span className="tmw-result-tied"> · drawn</span>}
                </span>
                <span className="tmw-result-score">
                  {row.score.kind === "scored" ? (
                    <>
                      <strong className="score-number">{row.score.text}</strong>
                      <span className="tmw-result-score-label">
                        {RANKING_BASIS_LABEL}
                      </span>
                    </>
                  ) : (
                    <span className="tmw-result-unranked">{row.score.text}</span>
                  )}
                </span>
              </div>

              {roster && (
                <ul className="tmw-result-roster">
                  {TMW_SLOT_TYPES.map((slot) => {
                    const pick = roster.slots[slot];
                    return (
                      <li key={slot} className="tmw-result-slot" data-slot={slot}>
                        <span className="tmw-result-slot-tag">
                          <span aria-hidden="true">{slotAbbrev(slot as TmwSlotType)}</span>
                          <span className="sr-only">
                            {TMW_SLOT_LABELS[slot as TmwSlotType]}
                          </span>
                        </span>
                        {pick ? (
                          <>
                            <PlayerAvatar
                              name={pick.player_name}
                              imageUrl={pick.headshot_url}
                              size={30}
                            />
                            <span className="tmw-result-slot-body">
                              <span className="tmw-result-slot-name">
                                {pick.player_name}
                              </span>
                              <span className="tmw-result-slot-season pk-numeral">
                                {pick.scoring_card
                                  ? `${pick.scoring_card.season} ${pick.scoring_card.team_name}`
                                  : "—"}
                              </span>
                            </span>
                            <span className="tmw-result-slot-score score-number">
                              {pick.scoring_card
                                ? pick.scoring_card.prime_score.toFixed(1)
                                : "—"}
                            </span>
                          </>
                        ) : (
                          <span className="tmw-result-slot-open">Not filled</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
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

      {/* THE RECEIPT, ONE CLICK AWAY. Everything the previous screen opened
          with lives here: the basis sentence, the leave-one-out decisive pick,
          the evaluator's own fit components and the mean season score with its
          "this decides nothing" label. Accessible, auditable, and not in the
          celebration layer. */}
      <details className="tmw-result-receipt" data-testid="tmw-receipt">
        <summary data-testid="tmw-receipt-toggle">Full receipt · how scoring worked</summary>
        <p className="tmw-result-basis" data-testid="tmw-ranking-basis">
          {rankingBasisLabel()}
        </p>
        <ol className="tmw-receipt-rows">
          {rows.map((row) => {
            const detail = row.result.detail;
            return (
              <li key={row.result.seat_index} className="tmw-receipt-row">
                <h3 className="tmw-receipt-name">
                  {ordinal(row.result.placement)} · {row.result.display_name}
                </h3>
                <dl className="tmw-result-facts">
                  {row.meanSeasonScore !== null && (
                    <div data-testid={`tmw-mean-${row.result.seat_index}`}>
                      <dt>Mean season PEAK3</dt>
                      <dd className="pk-numeral">
                        {row.meanSeasonScore.toFixed(1)} — reported for reading. It
                        cannot tell a correctly-placed lineup from a scrambled one, so
                        it decides nothing.
                      </dd>
                    </div>
                  )}
                  {detail?.decisive_pick && (
                    <div data-testid={`tmw-decisive-${row.result.seat_index}`}>
                      <dt>Decisive pick</dt>
                      <dd>
                        {detail.decisive_pick.player_name} (
                        {detail.decisive_pick.season} {detail.decisive_pick.team_id}) —
                        removing them costs{" "}
                        <span className="pk-numeral">
                          {detail.decisive_pick.lineup_quality_drop.toFixed(2)}
                        </span>{" "}
                        lineup score, the most of the six.
                      </dd>
                    </div>
                  )}
                  {detail?.best_pick && (
                    <div>
                      <dt>Best value</dt>
                      <dd>{detail.best_pick}</dd>
                    </div>
                  )}
                  {detail?.fit_components && (
                    <div data-testid={`tmw-fit-${row.result.seat_index}`}>
                      <dt>Positional fit</dt>
                      <dd className="pk-numeral">
                        {detail.fit_components.positional_fit.toFixed(0)} / 100 · starter
                        talent {detail.fit_components.talent_core.toFixed(1)} · bench{" "}
                        {detail.fit_components.bench_strength.toFixed(1)}
                      </dd>
                    </div>
                  )}
                </dl>
                {/* The traded-SCORE disclosure: a claim about the number, so it
                    belongs on the receipt rather than on a celebration card. */}
                {(() => {
                  const roster = rosters.find(
                    (entry) => entry.seat_index === row.result.seat_index,
                  );
                  const notes = TMW_SLOT_TYPES.map((slot) => roster?.slots[slot])
                    .filter((pick) => !!pick && !!scoreSourceNote(pick))
                    .map((pick) => `${pick!.player_name}: ${scoreSourceNote(pick!)}`);
                  return notes.length ? (
                    <ul className="tmw-receipt-notes">
                      {notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  ) : null;
                })()}
              </li>
            );
          })}
        </ol>
      </details>
    </section>
  );
}

function tierOf(placement: number | null): string {
  if (placement === 1) return "first";
  if (placement === 2) return "second";
  if (placement === null) return "none";
  return "third";
}
