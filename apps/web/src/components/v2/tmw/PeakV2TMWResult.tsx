"use client";

/**
 * PeakV2TMWResult — the end of a Three-Man Weave draft.
 *
 * A CELEBRATION FIRST, A REPORT SECOND (game-feel pass 6). The previous screen
 * put the verdict, the standings, the "why", a head-to-head table, your six,
 * three full courts and a receipt on one page at once -- correct, and read like
 * a report dumped after a game. It now plays out in five beats, top to bottom:
 *
 *   1. THE VERDICT      your placement, one line that says what happened, the
 *                       margin as a number, and the way back in (Play again /
 *                       Back to Arena) -- all on the first screen.
 *   2. THE PODIUM       three seats on plinths, the winner raised and lit. A
 *                       viewer who won gets a one-shot confetti and a spark
 *                       burst; everyone else gets the podium lights alone.
 *   3. THE SUMMARY      your lineup score against the one that beat you (or
 *                       the one you beat), and your six as a compact row.
 *   4. THE WHY          at most two insights, both from the evaluator's own
 *                       payload: the winner's decisive pick and the fit
 *                       measure(s) where the winner separated.
 *   5. THE DETAIL       head-to-head, every final roster and the itemised
 *                       receipt, each folded behind its own disclosure.
 *
 * The first four beats enter in sequence (≈1.2 s in total); reduced motion
 * shows everything settled, with no confetti and no sparks.
 *
 * THE RULES THIS SCREEN KEEPS, unchanged (see `@/lib/three-man-weave-state`'s
 * module comment):
 *
 *   1. THE RANKING BASIS IS NAMED WHEREVER A WINNER IS DECLARED, AND THERE IS
 *      NO PROJECTED RECORD. Six rounds, not eight: no 82-0-style W/L anywhere.
 *   2. AN UNSCOREABLE ROSTER HAS A REAL STATE, NOT A BLANK OR A ZERO. Every
 *      score render switches on `podium()`'s discriminated `.kind`.
 *   3. NOTHING IS RE-SCORED HERE. Every number is one the server reported:
 *      `score`, `detail.fit_components`, `detail.decisive_pick`,
 *      `detail.best_pick`. The only arithmetic is a subtraction (the margin),
 *      a share of the winner's score (the meter under each podium score) and a
 *      comparison (which roster reported the highest value) — never a
 *      weighting.
 *   4. THE MODEL RATES; IT DOES NOT DECREE. Copy says "PEAK3 rates…".
 *   5. COLOUR IS NEVER THE ONLY SIGNAL. Placement is an ordinal word, the
 *      winner is marked "winner", your seat says "you", a leading value says
 *      "best", and every bar has its number beside it. Plinth HEIGHT follows
 *      placement, which the ordinal on the plinth already states.
 *
 * No player photographs: identity is name + season + team text alone.
 */

import { useId, type CSSProperties } from "react";
import type { ArenaResultView, TmwRoster } from "@/types/three-man-weave";
import { TMW_SLOT_TYPES } from "@/types/three-man-weave";
import {
  RANKING_BASIS_LABEL,
  TMW_FIT_MEASURES,
  fitValue,
  ordinal,
  outcomeHeadline,
  podium,
  rankingBasisLabel,
  resultBand,
  resultLine,
  scoreSourceNote,
  marginText,
  seatAccent,
  separationSentence,
  slotAbbrev,
  winnerSeparation,
  winningMargin,
} from "@/lib/three-man-weave-state";
import { usePrefersReducedMotion } from "@/lib/a11y";
import PeakV2Shell from "../PeakV2Shell";
import PeakV2ArenaLight from "../PeakV2ArenaLight";
import PeakV2ResultHeadline from "../PeakV2ResultHeadline";
import PeakV2Score from "../PeakV2Score";
import { GameActionButton, ScoreTransition } from "@/components/game-feel";
import PeakV2SecondaryAction from "../PeakV2SecondaryAction";
import type { V2Tone } from "../v2-tone";
import Celebration from "@/components/shared/Celebration";
import PeakV2TMWCourt from "./PeakV2TMWCourt";

const LABEL_STYLE: CSSProperties = {
  fontFamily: "var(--v2-font-mono)",
  fontSize: "0.6875rem",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--v2-text-secondary)",
};

const bodyTextStyle: CSSProperties = {
  fontFamily: "var(--v2-font-ui)",
  fontSize: "0.8125rem",
  color: "var(--v2-text-secondary)",
};

/** The entrance, in ms from mount. Verdict → podium → summary → why, all
 *  settled by ≈1.2 s. Exported so a test can pin the budget. */
export const TMW_RESULT_ENTRANCE = {
  verdictMs: 0,
  podiumMs: 180,
  summaryMs: 620,
  whyMs: 780,
  /** Each beat's own animation length. */
  beatMs: 420,
} as const;

/** Spark rays around the winner's plinth when the viewer won. Geometry is
 *  derived from the index, never `Math.random()`, so a re-render is stable. */
const SPARKS = 12;

type TmwPodiumRow = ReturnType<typeof podium>[number];

const enter = (delayMs: number): CSSProperties =>
  ({ ["--tmw-enter-delay" as string]: `${delayMs}ms` }) as CSSProperties;

/** "Three-Man Weave: Franchise Draft" → ["Three-Man Weave", "Franchise Draft"];
 *  the standard ruleset is called Classic. */
function splitModeName(modeName: string): { family: string; variant: string } {
  const [family, ...rest] = modeName.split(": ");
  return { family: family || "Three-Man Weave", variant: rest.join(": ") || "Classic" };
}

/**
 * One competitor's finished roster ON THE COMPACT COURT — the same court the
 * draft was played on. Folded under "Every final roster".
 *
 * PROMINENCE IS EARNED TWICE, INDEPENDENTLY. The WINNER's court is lit and
 * their ordinal is gold. The VIEWER's court is outlined and explicitly marked
 * "Your seat" whether they won or lost.
 */
function SeatResultBlock({
  row,
  roster,
  isYou,
}: {
  row: TmwPodiumRow;
  roster: TmwRoster | undefined;
  isYou: boolean;
}) {
  const isFirst = row.result.placement === 1;
  return (
    <div
      data-testid={`tmw-result-${row.result.seat_index}`}
      data-placement={row.result.placement}
      data-is-you={isYou}
      className="tmw-result-seat"
      data-winner={isFirst ? "true" : undefined}
      data-yours={isYou ? "true" : undefined}
    >
      {isYou ? (
        <span className="tmw-result-seat-yours" data-testid={`tmw-result-${row.result.seat_index}-yours`} aria-hidden="true">
          {isFirst ? "Your seat · Winner" : "Your seat"}
        </span>
      ) : null}
      <div className="tmw-result-seat-head">
        <div className="min-w-0">
          {/* ONE ORDINAL PER SEAT: the ordinal WORD carries placement. */}
          <span
            className="tmw-result-seat-place"
            style={{ color: isFirst ? "var(--v2-color-accent)" : "var(--v2-text-primary)" }}
          >
            {ordinal(row.result.placement)} · {row.result.display_name}
          </span>
          {isYou ? <span className="tmw-result-seat-you">You</span> : null}
          {row.tied ? <span className="tmw-result-seat-note">drawn</span> : null}
        </div>
        {row.score.kind === "scored" ? (
          <PeakV2Score
            value={row.score.value.toFixed(1)}
            label={RANKING_BASIS_LABEL}
            tone={isFirst ? "accent" : "neutral"}
            size="md"
          />
        ) : (
          <span data-testid={`tmw-result-${row.result.seat_index}-unranked`} style={bodyTextStyle}>
            {row.score.text}
          </span>
        )}
      </div>

      {roster ? (
        <div className="mt-3" data-testid={`tmw-result-${row.result.seat_index}-roster`}>
          {/* The draft's own court, finished and inert: a result is not a turn. */}
          <PeakV2TMWCourt
            roster={roster}
            isYou={isYou}
            isOnTurn={false}
            edge={null}
            lit={row.result.placement === 1 || isYou}
            interactive={false}
            hideHeader
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * THE HEAD-TO-HEAD. One row per fit measure the lineup score reads, one column
 * per roster in podium order; each cell is the reported value, a bar on the
 * measure's own 0–100 scale, and "best" on the highest value in the row.
 * Then each roster's decisive pick and top-rated card, as text.
 */
function HeadToHead({ rows, yourSeatIndex }: { rows: TmwPodiumRow[]; yourSeatIndex: number | null }) {
  const headingId = useId();
  const columns = { ["--tmw-cols" as string]: rows.length } as CSSProperties;
  return (
    <div className="tmw-h2h" data-testid="tmw-compare">
      <p className="tmw-final-label" id={headingId}>
        How PEAK3 rates each six
      </p>
      <div role="table" aria-labelledby={headingId} className="tmw-h2h-table" style={columns}>
        <div role="row" className="tmw-h2h-row tmw-h2h-row--head">
          <span role="columnheader" className="tmw-h2h-metric">
            Measure
          </span>
          {rows.map((row) => {
            const isYou = row.result.seat_index === yourSeatIndex;
            return (
              <span
                role="columnheader"
                key={row.result.seat_index}
                className="tmw-h2h-seat"
                data-winner={row.result.placement === 1 ? "true" : undefined}
                data-yours={isYou ? "true" : undefined}
                data-seat-accent={seatAccent(row.result.seat_index)}
              >
                <span className="tmw-h2h-seat-place">{ordinal(row.result.placement)}</span>
                <span className="tmw-h2h-seat-name">
                  {row.result.display_name}
                  {isYou ? " (you)" : ""}
                </span>
              </span>
            );
          })}
        </div>

        {TMW_FIT_MEASURES.map((measure) => {
          const values = rows.map((row) => fitValue(row, measure.key));
          const reported = values.filter((value): value is number => value !== null);
          const best = reported.length > 1 ? Math.max(...reported) : null;
          return (
            <div role="row" className="tmw-h2h-row" key={measure.key} data-testid={`tmw-compare-${measure.key}`}>
              <span role="rowheader" className="tmw-h2h-metric">
                {measure.label}
              </span>
              {rows.map((row, index) => {
                const value = values[index];
                const lead = best !== null && value !== null && value === best;
                const share = value === null ? 0 : Math.max(0, Math.min(1, value / 100));
                return (
                  <span
                    role="cell"
                    key={row.result.seat_index}
                    className="tmw-h2h-cell"
                    data-lead={lead ? "true" : undefined}
                    data-seat-accent={seatAccent(row.result.seat_index)}
                    style={{ ["--tmw-fill" as string]: share } as CSSProperties}
                  >
                    <span className="sr-only">{row.result.display_name}: </span>
                    <span className="tmw-h2h-value">{value === null ? "—" : value.toFixed(0)}</span>
                    {lead ? <span className="tmw-h2h-lead">best</span> : null}
                    <span className="tmw-h2h-bar" aria-hidden="true">
                      <span className="tmw-h2h-fill" />
                    </span>
                  </span>
                );
              })}
            </div>
          );
        })}

        <div role="row" className="tmw-h2h-row tmw-h2h-row--text" data-testid="tmw-compare-decisive">
          <span role="rowheader" className="tmw-h2h-metric">
            Decisive pick
          </span>
          {rows.map((row) => {
            const decisive = row.result.detail?.decisive_pick ?? null;
            return (
              <span role="cell" key={row.result.seat_index} className="tmw-h2h-cell tmw-h2h-cell--text">
                <span className="sr-only">{row.result.display_name}: </span>
                {decisive ? (
                  <>
                    <span className="tmw-h2h-name">{decisive.player_name}</span>
                    <span className="tmw-h2h-note">−{decisive.lineup_quality_drop.toFixed(2)} without</span>
                  </>
                ) : (
                  <span className="tmw-h2h-note">Not reported</span>
                )}
              </span>
            );
          })}
        </div>

        <div role="row" className="tmw-h2h-row tmw-h2h-row--text" data-testid="tmw-compare-top-card">
          <span role="rowheader" className="tmw-h2h-metric">
            Top-rated card
          </span>
          {rows.map((row) => (
            <span role="cell" key={row.result.seat_index} className="tmw-h2h-cell tmw-h2h-cell--text">
              <span className="sr-only">{row.result.display_name}: </span>
              <span className="tmw-h2h-name">{row.result.detail?.best_pick ?? "Not reported"}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** WHAT YOU BUILT: the six as a compact row of tiles, with the two cards the
 *  evaluator named. */
function BuildList({
  row,
  roster,
  isYou,
}: {
  row: TmwPodiumRow;
  roster: TmwRoster;
  isYou: boolean;
}) {
  const decisiveSlug = row.result.detail?.decisive_pick?.player_slug ?? null;
  const topName = row.result.detail?.best_pick ?? null;
  return (
    <div className="tmw-build" data-testid="tmw-your-build">
      <p className="tmw-final-label">{isYou ? "What you built" : `${row.result.display_name}'s six`}</p>
      <ol className="tmw-build-list">
        {TMW_SLOT_TYPES.map((slot) => {
          const pick = roster.slots[slot] ?? null;
          const decisive = !!pick && pick.player_slug === decisiveSlug;
          const top = !!pick && !!topName && pick.player_name === topName;
          return (
            <li key={slot} className="tmw-build-row" data-decisive={decisive ? "true" : undefined} data-open={pick ? undefined : "true"}>
              <span className="tmw-build-top">
                <span className="tmw-build-slot">{slotAbbrev(slot)}</span>
                <span className="tmw-build-value">
                  {pick?.scoring_card ? pick.scoring_card.prime_score.toFixed(1) : "—"}
                </span>
              </span>
              <span className="tmw-build-name">{pick ? pick.player_name : "Open"}</span>
              <span className="tmw-build-meta">
                {pick?.scoring_card ? `${pick.scoring_card.season} ${pick.scoring_card.team_id}` : ""}
              </span>
              {decisive || top ? (
                <span className="tmw-build-tags">
                  {decisive ? <span className="tmw-build-tag">decisive</span> : null}
                  {top ? <span className="tmw-build-tag tmw-build-tag--quiet">top card</span> : null}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A folded section of the deeper detail. A native `<details>`: keyboard and
 *  screen-reader disclosure for free, and the content stays in the document. */
function Fold({
  title,
  hint,
  testId,
  toggleTestId,
  children,
}: {
  title: string;
  hint?: string;
  testId: string;
  toggleTestId?: string;
  children: React.ReactNode;
}) {
  return (
    <details className="tmw-fold" data-testid={testId}>
      <summary className="tmw-fold-summary" data-testid={toggleTestId}>
        <span className="tmw-fold-title">{title}</span>
        {hint ? <span className="tmw-fold-hint">{hint}</span> : null}
        <span className="tmw-fold-chevron" aria-hidden="true" />
      </summary>
      <div className="tmw-fold-body">{children}</div>
    </details>
  );
}

export default function PeakV2TMWResult({
  results,
  rosters,
  yourSeatIndex,
  seed = "",
  onPlayAgain,
  playAgainPending = false,
  multiplayer = false,
  modeName = "Three-Man Weave",
  constraintLabel = null,
}: {
  /** The ruleset's name ("Three-Man Weave: Franchise Draft"), for the eyebrow. */
  modeName?: string;
  /** A Franchise or Decade Draft's one constraint ("Chicago Bulls", "1990s"). */
  constraintLabel?: string | null;
  results: ArenaResultView[];
  rosters: TmwRoster[];
  yourSeatIndex: number | null;
  /** Match id. Keys the response bank so repeat plays vary and a reload of
   *  the SAME result says the same thing — see `resultLine()`. */
  seed?: string;
  /** Starts another game. A promise so the button can hold its pending
   *  state for exactly as long as the new match takes to create. */
  onPlayAgain: () => Promise<boolean> | void;
  playAgainPending?: boolean;
  /** A multiplayer table: Play Again returns to the rematch-ready lobby
   *  rather than creating a bot match, and says so. */
  multiplayer?: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  const rows = podium(results);
  const margin = winningMargin(rows, yourSeatIndex);
  /** The winner's score, the denominator for every podium meter. */
  const topScore = rows.reduce(
    (best, row) => (row.score.kind === "scored" ? Math.max(best, row.score.value) : best),
    0,
  );
  const unrankableReason =
    rows.map((row) => row.score).find((score) => score.kind === "unrankable")?.reason ?? null;

  if (!rows.length) {
    return (
      <PeakV2Shell width="live">
        <section data-testid="tmw-podium" className="py-16 text-center">
          <p style={bodyTextStyle}>This match has no recorded result.</p>
        </section>
      </PeakV2Shell>
    );
  }

  const { family, variant } = splitModeName(modeName);
  const yours = rows.find((row) => row.result.seat_index === yourSeatIndex) ?? null;
  const placement = yours?.result.placement ?? null;
  const won = placement === 1;
  const band = resultBand(rows, yourSeatIndex);
  const leaders = rows.filter((row) => row.result.placement === 1);
  const winner = leaders[0] ?? null;
  const soleWinner = leaders.length === 1 ? winner : null;
  const winnerIsYou = winner !== null && winner.result.seat_index === yourSeatIndex;
  const winnerScoreLabel = winner
    ? `${winnerIsYou ? "Your" : `${winner.result.display_name}'s`} ${RANKING_BASIS_LABEL}`
    : RANKING_BASIS_LABEL;

  // THE VERDICT, IN WORDS. The placement ordinal sits beside it once.
  const verdict =
    yours === null
      ? outcomeHeadline(rows)
      : band === "drawn"
        ? "A share of first"
        : won
          ? "You won the draft"
          : soleWinner
            ? `${soleWinner.result.display_name} won the draft`
            : outcomeHeadline(rows);

  // WHO YOUR SCORE IS MEASURED AGAINST: the winner, or -- when you won -- the
  // best of the rest. Two printed numbers side by side; nothing is derived.
  const scored = rows.filter((row) => row.score.kind === "scored");
  const rival =
    yours && yours.score.kind === "scored"
      ? won
        ? (scored.find((row) => row !== yours) ?? null)
        : (scored.find((row) => row.result.placement === 1) ?? null)
      : null;

  // WHY — only from what the evaluator reported.
  const measuresReported = rows.some((row) => !!row.result.detail?.fit_components);
  const separations = winnerSeparation(rows);
  const winnerDecisive = soleWinner?.result.detail?.decisive_pick ?? null;
  const soleWinnerIsYou = soleWinner !== null && soleWinner.result.seat_index === yourSeatIndex;
  const whyAvailable = soleWinner !== null && soleWinner.score.kind === "scored" && (!!winnerDecisive || measuresReported);

  // WHAT YOU BUILT — yours, or the winner's for a viewer with no seat.
  const buildRow = yours ?? winner;
  const buildRoster = buildRow ? rosters.find((entry) => entry.seat_index === buildRow.result.seat_index) : undefined;

  // Same outcome→ambient-light convention the sibling V2 result screens use:
  // gold reserved for the win, a losing band reads negative, a draw or an
  // unranked/no-seat viewer reads neutral accent.
  const lightTone: V2Tone =
    band === "won_clear" || band === "won_close"
      ? "positive"
      : band === "close_loss" || band === "clear_loss"
        ? "negative"
        : "accent";

  // THE PODIUM'S STAGE ORDER. Three distinct placements stand 2nd · 1st · 3rd
  // so the winner is centre-stage; anything else (a draw, a two-seat table)
  // keeps placement order. DOM order is always placement order.
  const classicStage = rows.length === 3 && new Set(rows.map((row) => row.result.placement)).size === 3;
  const celebrate = won && !reduced;

  return (
    <PeakV2Shell width="live-wide">
      <div
        className="tmw-final pb-16 pt-6"
        data-testid="tmw-podium"
        data-your-placement={placement ?? "none"}
        data-band={band}
        data-motion={reduced ? "reduced" : "full"}
      >
        <section className="tmw-final-stage" aria-labelledby="tmw-final-verdict-title">
          {/* Decoration over a decided result: absent under reduced motion,
              and nothing below waits on it. */}
          <Celebration active={won} testId="tmw-celebration" />
          <div className="tmw-final-light" aria-hidden="true">
            <PeakV2ArenaLight tone={lightTone} x="50%" y="0%" />
          </div>

          {/* 1. THE VERDICT — and the way back in. */}
          <header className="tmw-final-verdict tmw-enter" style={enter(TMW_RESULT_ENTRANCE.verdictMs)}>
            <p className="tmw-final-label tmw-final-eyebrow" data-testid="tmw-final-mode">
              {family} · {variant}
              {constraintLabel ? ` · ${constraintLabel}` : ""} · Final
            </p>
            <div className="tmw-final-headline">
              {placement !== null ? (
                <div className="tmw-final-medal" data-won={won ? "true" : "false"}>
                  {/* ONE ORDINAL — the word already carries placement for every
                      reader, so no numeral repeats it (design-review/16). */}
                  <div data-testid="tmw-your-placement">
                    <PeakV2ResultHeadline as="p" scale="hero" tone={won ? "accent" : "primary"}>
                      {ordinal(placement)}
                    </PeakV2ResultHeadline>
                  </div>
                  <span className="tmw-final-medal-of">of {rows.length}</span>
                </div>
              ) : (
                <div data-testid="tmw-your-placement" className="sr-only">
                  Complete
                </div>
              )}
              <div className="tmw-final-headline-copy">
                <h2 id="tmw-final-verdict-title" className="tmw-final-title" data-testid="tmw-outcome">
                  {verdict}
                </h2>
                <div data-testid="tmw-result-line">
                  <PeakV2ResultHeadline as="p" scale="line" tone={won ? "accent" : "primary"}>
                    {resultLine(band, seed || String(placement ?? "none"))}
                  </PeakV2ResultHeadline>
                </div>
                {/* HOW CLOSE IT WAS, as the number. Absent when the comparison
                    would be a claim (a drawn first place, fewer than two scored
                    rosters). */}
                {margin ? (
                  <p className="tmw-final-margin" data-testid="tmw-margin">
                    {margin.winnerName} by {marginText(margin.points)} over {margin.runnerUpName}
                    {margin.yourGap !== null ? ` · you finished ${marginText(margin.yourGap)} back` : ""}
                  </p>
                ) : null}
              </div>
            </div>

            {/* PLAY AGAIN IS ANOTHER GAME, and it is on the first screen. */}
            <div className="tmw-final-actions">
              <GameActionButton
                onAction={onPlayAgain}
                pending={playAgainPending}
                pendingLabel={multiplayer ? "Opening the lobby…" : "Dealing a new draft…"}
                data-testid="tmw-play-again"
              >
                {multiplayer ? "Play again · rematch lobby" : "Play again"}
              </GameActionButton>
              <PeakV2SecondaryAction href="/arena" data-testid="tmw-back-to-arena">
                Back to Arena
              </PeakV2SecondaryAction>
            </div>
          </header>

          {/* 2. THE PODIUM. Plinth height follows placement (stated by the
              ordinal on it); the meter under each score is that seat's score
              as a share of the winner's -- arithmetic over two printed numbers. */}
          <div className="tmw-final-podium tmw-enter" style={enter(TMW_RESULT_ENTRANCE.podiumMs)}>
            <p className="tmw-final-label sr-only">Final standings · {RANKING_BASIS_LABEL}</p>
            <ol
              className="tmw-stands"
              data-testid="tmw-standings"
              data-stage={classicStage ? "classic" : "list"}
              aria-label={`Final standings, ranked on ${RANKING_BASIS_LABEL}`}
            >
              {rows.map((row, index) => {
                const isFirst = row.result.placement === 1;
                const isYou = row.result.seat_index === yourSeatIndex;
                const share =
                  row.score.kind === "scored" && topScore > 0
                    ? Math.max(0.06, Math.min(1, row.score.value / topScore))
                    : 0;
                // The winner's plinth rises LAST: the climax, not the opener.
                const rise = TMW_RESULT_ENTRANCE.podiumMs + (classicStage ? [320, 120, 0][index] : index * 100);
                return (
                  <li
                    key={row.result.seat_index}
                    className="tmw-stand"
                    data-testid={`tmw-standing-${row.result.seat_index}`}
                    data-place={Math.min(3, row.result.placement)}
                    data-winner={isFirst ? "true" : undefined}
                    data-yours={isYou ? "true" : undefined}
                    data-seat-accent={seatAccent(row.result.seat_index)}
                    style={
                      {
                        ["--tmw-share" as string]: share,
                        ["--tmw-rise-delay" as string]: `${rise}ms`,
                      } as CSSProperties
                    }
                  >
                    {isFirst ? (
                      <span className="tmw-stand-light" aria-hidden="true" />
                    ) : null}
                    {isFirst && celebrate ? (
                      <span className="tmw-stand-sparks" aria-hidden="true" data-testid="tmw-sparks">
                        {Array.from({ length: SPARKS }, (_, spark) => (
                          <span
                            key={spark}
                            className="tmw-stand-spark"
                            style={{ ["--tmw-spark-angle" as string]: `${(360 / SPARKS) * spark}deg` } as CSSProperties}
                          />
                        ))}
                      </span>
                    ) : null}
                    <span className="tmw-stand-who">
                      <span className="tmw-stand-name">{row.result.display_name}</span>
                      <span className="tmw-stand-tags">
                        {isFirst ? <span className="tmw-stand-crown">winner</span> : null}
                        {isYou ? <span className="tmw-stand-you">you</span> : null}
                        {row.tied ? <span className="tmw-stand-you">drawn</span> : null}
                      </span>
                    </span>
                    <span className="tmw-stand-score pk-numeral">
                      {row.score.kind === "scored" ? row.score.value.toFixed(1) : row.score.text}
                    </span>
                    <span className="tmw-stand-meter" aria-hidden="true">
                      <span className="tmw-stand-meter-fill" />
                    </span>
                    <span className="tmw-stand-plinth">
                      <span className="tmw-stand-rank pk-numeral">{ordinal(row.result.placement)}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        {/* 3. THE SUMMARY: your score beside the one it was measured against,
            and your six. */}
        {(yours && yours.score.kind === "scored") || winner?.score.kind === "scored" || (buildRow && buildRoster) ? (
          <section className="tmw-final-summary tmw-enter" style={enter(TMW_RESULT_ENTRANCE.summaryMs)}>
            <div className="tmw-final-scores">
              {/* THE VIEWER'S OWN SCORE, not the winner's. Falls back to the
                  winner's, explicitly labelled, for a viewer with no scored seat. */}
              {yours && yours.score.kind === "scored" ? (
                <div className="tmw-final-score" data-testid="tmw-your-score">
                  <PeakV2Score
                    value={<ScoreTransition value={yours.score.value} from={0} durationMs={1100} format={(n) => n.toFixed(1)} testId="tmw-hero-score-value" />}
                    label={`Your ${RANKING_BASIS_LABEL}`}
                    tone="accent"
                    role="moment"
                    size="lg"
                  />
                </div>
              ) : winner && winner.score.kind === "scored" ? (
                <div className="tmw-final-score" data-testid="tmw-winner-score" data-winner-is-you={winnerIsYou}>
                  <PeakV2Score
                    value={<ScoreTransition value={winner.score.value} from={0} durationMs={1100} format={(n) => n.toFixed(1)} testId="tmw-hero-score-value" />}
                    label={winnerScoreLabel}
                    tone="accent"
                    role="moment"
                    size="lg"
                  />
                </div>
              ) : null}
              {rival && rival.score.kind === "scored" ? (
                <div className="tmw-final-rival" data-testid="tmw-rival-score">
                  <span className="tmw-final-rival-vs" aria-hidden="true">
                    vs
                  </span>
                  <PeakV2Score
                    value={rival.score.value.toFixed(1)}
                    label={`${rival.result.display_name} · ${ordinal(rival.result.placement)}`}
                    tone="neutral"
                    size="md"
                  />
                </div>
              ) : null}
            </div>
            {buildRow && buildRoster ? (
              <BuildList row={buildRow} roster={buildRoster} isYou={buildRow === yours} />
            ) : null}
          </section>
        ) : null}

        {unrankableReason ? (
          <p className="mt-4" data-testid="tmw-unranked-reason" style={bodyTextStyle}>
            {unrankableReason}
          </p>
        ) : null}

        {/* 4. THE WHY — at most two insights, from the payload. */}
        {whyAvailable && soleWinner ? (
          <section className="tmw-final-why tmw-enter" data-testid="tmw-why" style={enter(TMW_RESULT_ENTRANCE.whyMs)}>
            <h3 className="tmw-final-why-title">
              {soleWinnerIsYou ? "Why you won" : `Why ${soleWinner.result.display_name} won`}
            </h3>
            <div className="tmw-final-insights">
              {winnerDecisive ? (
                <p className="tmw-final-insight" data-testid="tmw-why-decisive">
                  <span className="tmw-final-why-key">Decisive pick</span>
                  <span className="tmw-final-insight-lead">{winnerDecisive.player_name}</span>
                  <span>
                    {winnerDecisive.season} {winnerDecisive.team_id}, round {winnerDecisive.round_number}. Without that
                    card PEAK3&apos;s lineup score for this six drops{" "}
                    <span className="tmw-final-why-num">{winnerDecisive.lineup_quality_drop.toFixed(2)}</span>, the most
                    of any pick.
                  </span>
                </p>
              ) : null}
              {measuresReported ? (
                <p className="tmw-final-insight" data-testid="tmw-why-edge">
                  <span className="tmw-final-why-key">Where it separated</span>
                  <span>{separationSentence(soleWinner.result.display_name, soleWinnerIsYou, separations)}</span>
                </p>
              ) : null}
            </div>
          </section>
        ) : leaders.length > 1 ? (
          <p className="tmw-final-why-drawn tmw-enter" data-testid="tmw-why-drawn" style={enter(TMW_RESULT_ENTRANCE.whyMs)}>
            First place is shared, so there is no single winning roster to explain.
          </p>
        ) : null}

        {/* 5. THE DETAIL, folded. */}
        <section className="tmw-final-more" aria-label="Match detail">
          {measuresReported ? (
            <Fold title="Head to head" hint="Every fit measure, all three sixes" testId="tmw-fold-compare">
              <HeadToHead rows={rows} yourSeatIndex={yourSeatIndex} />
            </Fold>
          ) : null}

          <Fold title="Final rosters" hint="Each six on the court it was drafted on" testId="tmw-fold-rosters">
            <div className="tmw-result-grid" data-testid="tmw-result-rows">
              {rows.map((row) => {
                const roster = rosters.find((entry) => entry.seat_index === row.result.seat_index);
                const isYou = row.result.seat_index === yourSeatIndex;
                return <SeatResultBlock key={row.result.seat_index} row={row} roster={roster} isYou={isYou} />;
              })}
            </div>
          </Fold>

          {/* THE RECEIPT: the basis sentence, the leave-one-out decisive pick,
              the evaluator's own fit components, the mean season score with its
              "this decides nothing" label, and the traded-score notes — all of
              it the server's own numbers. */}
          <Fold title="Full receipt" hint="How scoring worked" testId="tmw-receipt" toggleTestId="tmw-receipt-toggle">
            <p data-testid="tmw-ranking-basis" style={bodyTextStyle}>
              {rankingBasisLabel()}
            </p>
            <div className="mt-4 flex flex-col gap-6">
              {rows.map((row) => {
                const detail = row.result.detail;
                const roster = rosters.find((entry) => entry.seat_index === row.result.seat_index);
                const notes = TMW_SLOT_TYPES.map((slot) => roster?.slots[slot])
                  .filter((pick) => !!pick && !!scoreSourceNote(pick))
                  .map((pick) => `${pick!.player_name}: ${scoreSourceNote(pick!)}`);
                return (
                  <div key={row.result.seat_index}>
                    <h4 style={{ fontFamily: "var(--v2-font-ui)", fontWeight: 700, fontSize: "0.875rem", color: "var(--v2-text-primary)" }}>
                      {ordinal(row.result.placement)} · {row.result.display_name}
                    </h4>
                    <dl className="mt-2 flex flex-col gap-2">
                      {row.meanSeasonScore !== null ? (
                        <div data-testid={`tmw-mean-${row.result.seat_index}`}>
                          <dt style={LABEL_STYLE}>Mean season PEAK3</dt>
                          <dd className="mt-0.5" style={bodyTextStyle}>
                            {row.meanSeasonScore.toFixed(1)} — reported for reading. It cannot tell a
                            correctly-placed lineup from a scrambled one, so it decides nothing.
                          </dd>
                        </div>
                      ) : null}
                      {detail?.decisive_pick ? (
                        <div data-testid={`tmw-decisive-${row.result.seat_index}`}>
                          <dt style={LABEL_STYLE}>Decisive pick</dt>
                          <dd className="mt-0.5" style={bodyTextStyle}>
                            {detail.decisive_pick.player_name} ({detail.decisive_pick.season}{" "}
                            {detail.decisive_pick.team_id}) — removing them costs{" "}
                            <span style={{ fontFamily: "var(--v2-font-mono)", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "var(--v2-text-primary)" }}>
                              {detail.decisive_pick.lineup_quality_drop.toFixed(2)}
                            </span>{" "}
                            lineup score, the most of the six.
                          </dd>
                        </div>
                      ) : null}
                      {detail?.best_pick ? (
                        <div>
                          <dt style={LABEL_STYLE}>Best value</dt>
                          <dd className="mt-0.5" style={bodyTextStyle}>
                            {detail.best_pick}
                          </dd>
                        </div>
                      ) : null}
                      {detail?.fit_components ? (
                        <div data-testid={`tmw-fit-${row.result.seat_index}`}>
                          <dt style={LABEL_STYLE}>Positional fit</dt>
                          <dd
                            className="mt-0.5"
                            style={{ ...bodyTextStyle, fontFamily: "var(--v2-font-mono)", fontVariantNumeric: "tabular-nums" }}
                          >
                            {detail.fit_components.positional_fit.toFixed(0)} / 100 · starter talent{" "}
                            {detail.fit_components.talent_core.toFixed(1)} · bench{" "}
                            {detail.fit_components.bench_strength.toFixed(1)}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                    {notes.length ? (
                      <ul className="mt-2 flex flex-col gap-1">
                        {notes.map((note) => (
                          <li key={note} style={bodyTextStyle}>
                            {note}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Fold>

          <p className="tmw-final-footer">
            <PeakV2SecondaryAction href="/arena/three-man-weave" data-testid="tmw-back-to-mode" size="sm">
              Three-Man Weave home
            </PeakV2SecondaryAction>
          </p>
        </section>
      </div>
    </PeakV2Shell>
  );
}
