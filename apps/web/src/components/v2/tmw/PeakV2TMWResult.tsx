"use client";

/**
 * PeakV2TMWResult — the V2 "Broadcast Arena" result screen for Three-Man
 * Weave (TMW's counterpart to `PodiumReceipt.tsx`, following the same
 * CINEMATIC → LIVE restyle `PeakV2ShowdownResult.tsx` and
 * `PeakV2CourtResult.tsx` already established in this pass).
 *
 * SAME REAL DATA, SAME TWO PRODUCT RULES `PodiumReceipt.tsx` ENFORCES — see
 * that file's own docstring and `@/lib/three-man-weave-state`'s module
 * comment for the full reasoning. Repeated here only as a checklist, never
 * re-derived:
 *
 *   1. THE RANKING BASIS IS NAMED WHEREVER A WINNER IS DECLARED, AND THERE IS
 *      NO PROJECTED RECORD. `rankingBasisLabel()`/`RANKING_BASIS_LABEL` are
 *      reused verbatim. Three-Man Weave plays six rounds, not eight, so
 *      there is no 82-0-style win/loss headline anywhere on this screen.
 *   2. AN UNSCOREABLE ROSTER HAS A REAL STATE, NOT A BLANK OR A ZERO.
 *      `podium()` already returns the discriminated `TmwScoreDisplay` union;
 *      every score render below switches on `.kind` and shows `.text` for
 *      the `"unrankable"` case rather than inventing a number.
 *
 * CINEMATIC → LIVE: a brief hero (`PeakV2CinematicStage`) carries the
 * placement badge, the deterministic `resultLine()` sentence (the real
 * response-bank copy, reused verbatim — never rewritten), the outcome
 * headline, and the winner's lineup score as the one hero number. Everything
 * else — the three complete final rosters, the unrankable note, and the
 * itemised receipt (mean season score, decisive pick, best value, positional
 * fit, traded-score-source notes) — reads LIVE/plain, hairline-divided
 * (`PeakV2Rule`) rather than boxed into three side-by-side cards. The
 * receipt stays behind a native `<details>`, same convention as the legacy
 * screen and both sibling V2 result screens.
 *
 * COLOUR IS NEVER THE ONLY SIGNAL. First place gets the one legitimate gold
 * moment (the hero headline, the placement numeral, the winner's score) —
 * every row still prints its rank numeral AND its ordinal word in full, so a
 * reader who cannot perceive colour reads the same podium.
 *
 * No player photographs — matching `PeakV2CourtResult.tsx`'s `ResultSlotCard`
 * choice (and CLAUDE.md's no-photos/no-logos principle) over legacy's
 * `PlayerAvatar` headshots: identity is carried by name + team/season text
 * alone, via `PeakV2PlayerIdentity`.
 */

import type { CSSProperties } from "react";
import type { ArenaResultView, TmwRoster } from "@/types/three-man-weave";
import { TMW_SLOT_TYPES } from "@/types/three-man-weave";
import {
  RANKING_BASIS_LABEL,
  ordinal,
  outcomeHeadline,
  podium,
  rankingBasisLabel,
  resultBand,
  resultLine,
  scoreSourceNote,
} from "@/lib/three-man-weave-state";
import PeakV2Shell from "../PeakV2Shell";
import PeakV2CinematicStage from "../PeakV2CinematicStage";
import PeakV2ResultHeadline from "../PeakV2ResultHeadline";
import PeakV2Rule from "../PeakV2Rule";
import PeakV2Score from "../PeakV2Score";
import PeakV2PrimaryAction from "../PeakV2PrimaryAction";
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
  color: "var(--v2-text-muted)",
};

const SECTION_HEAD_STYLE: CSSProperties = LABEL_STYLE;

const bodyTextStyle: CSSProperties = {
  fontFamily: "var(--v2-font-ui)",
  fontSize: "0.8125rem",
  color: "var(--v2-text-secondary)",
};

const mutedTextStyle: CSSProperties = {
  fontFamily: "var(--v2-font-ui)",
  fontSize: "0.75rem",
  color: "var(--v2-text-muted)",
};

type TmwPodiumRow = ReturnType<typeof podium>[number];

/**
 * One competitor's ending: identity, placement, lineup score, and their
 * finished roster ON THE COMPACT COURT — the same court the draft was played
 * on, the same floor, the same tiles, the same typography.
 *
 * WHAT THIS REPLACES. A flat `<ul>` of six hairline-divided rows per seat,
 * three of them stacked, which made the conclusion of a competitive game read
 * as three transaction ledgers roughly three thousand pixels tall
 * (design-review/17). The data was all there; none of it looked like
 * basketball.
 *
 * PROMINENCE IS EARNED TWICE, INDEPENDENTLY. The WINNER's court is lit and
 * their ordinal is gold. The VIEWER's court is outlined and explicitly
 * marked "YOU" whether they won or lost — so a player who came third can
 * still find themselves instantly, which a winner-only treatment does not
 * give them.
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
      <div className="tmw-result-seat-head">
        <div className="min-w-0">
          {/* ONE ORDINAL PER SEAT, same rule as the hero: the ordinal WORD
              carries placement, so it needs neither a numeral repeating it
              nor colour to be readable. */}
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
          <span data-testid={`tmw-result-${row.result.seat_index}-unranked`} style={mutedTextStyle}>
            {row.score.text}
          </span>
        )}
      </div>

      {roster ? (
        <div className="mt-3" data-testid={`tmw-result-${row.result.seat_index}-roster`}>
          {/* The draft's own court, finished and inert. `interactive={false}`
              and `isOnTurn={false}`: a result is not a turn. Every tile still
              carries the exact season, the team, the positions and the PEAK3
              value — bench included, because in this mode the bench counts
              equally in the score. */}
          <PeakV2TMWCourt
            roster={roster}
            isYou={isYou}
            isOnTurn={false}
            edge={null}
            lit={isFirst || isYou}
            interactive={false}
            hideHeader
          />
        </div>
      ) : null}
    </div>
  );
}

export default function PeakV2TMWResult({
  results,
  rosters,
  yourSeatIndex,
  seed = "",
  onPlayAgain,
}: {
  results: ArenaResultView[];
  rosters: TmwRoster[];
  yourSeatIndex: number | null;
  /** Match id. Keys the response bank so repeat plays vary and a reload of
   *  the SAME result says the same thing — see `resultLine()`. */
  seed?: string;
  onPlayAgain: () => void;
}) {
  const rows = podium(results);
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

  const yours = rows.find((row) => row.result.seat_index === yourSeatIndex) ?? null;
  const placement = yours?.result.placement ?? null;
  const won = placement === 1;
  const band = resultBand(rows, yourSeatIndex);
  const winner = rows.find((row) => row.result.placement === 1) ?? null;
  // Bug fix (mission §13, score-ownership correctness): the hero number
  // directly beneath `outcomeHeadline` (e.g. "Rim Runner wins") is the
  // WINNER's score by design (see this module's docstring) -- which is a
  // DIFFERENT seat from `yourSeatIndex` whenever the viewer did not win.
  // A bare "PEAK3 lineup score" caption on that number, sitting right below
  // the viewer's OWN placement badge, left whose score it was ambiguous —
  // a losing viewer could misread it as their own result. Naming the seat
  // explicitly removes that ambiguity without changing which number is
  // shown or where (no redesign): "Your ..." when the viewer won, the real
  // display name otherwise.
  const winnerIsYou = winner !== null && winner.result.seat_index === yourSeatIndex;
  const winnerScoreLabel = winner
    ? `${winnerIsYou ? "Your" : `${winner.result.display_name}'s`} ${RANKING_BASIS_LABEL}`
    : RANKING_BASIS_LABEL;

  // Same outcome→ambient-light convention `PeakV2ShowdownResult`/
  // `PeakV2CourtResult` already use: gold reserved for the win, a losing
  // band reads negative, a draw or an unranked/no-seat viewer reads neutral
  // accent rather than either status color.
  const lightTone: V2Tone =
    band === "won_clear" || band === "won_close"
      ? "positive"
      : band === "close_loss" || band === "clear_loss"
        ? "negative"
        : "accent";

  return (
    <PeakV2Shell width="live">
      <div className="pb-16 pt-6" data-testid="tmw-podium" data-your-placement={placement ?? "none"} data-band={band}>
        {/* Decoration over a decided result: `pointer-events: none`, absent
            entirely under reduced motion, and nothing below waits on it —
            same real win-only gate `PodiumReceipt.tsx`/`PeakV2ShowdownResult`
            already use. */}
        <Celebration active={won} testId="tmw-celebration" />

        <PeakV2CinematicStage light={{ tone: lightTone }}>
          <span style={LABEL_STYLE}>Three-Man Weave · Draft complete</span>

          {/* ONE ORDINAL. This used to render a mono numeral "3" immediately
              beside the display "3rd" — the same fact twice, a hand's width
              apart, which read as a rendering bug rather than as emphasis
              (design-review/16). It also pushed the headline off the stage's
              centre axis, because the pair was centred, not the ordinal.
              The numeral was there to keep placement from being carried by
              colour alone; the ORDINAL WORD itself already does that, in
              every case, for every reader. */}
          <div className="mt-2" data-testid="tmw-your-placement">
            <PeakV2ResultHeadline as="h1" scale="hero" tone={won ? "accent" : "primary"}>
              {placement === null ? "Complete" : ordinal(placement)}
            </PeakV2ResultHeadline>
          </div>

          <div data-testid="tmw-result-line">
            <PeakV2ResultHeadline as="h2" scale="line" tone="primary" className="mt-3">
              {resultLine(band, seed || String(placement ?? "none"))}
            </PeakV2ResultHeadline>
          </div>

          <p className="mt-2 max-w-md" data-testid="tmw-outcome" style={bodyTextStyle}>
            {outcomeHeadline(rows)}
          </p>

          {/* THE VIEWER'S OWN SCORE, not the winner's.
              The hero used to print the WINNER's number under the viewer's
              own placement badge — so a player who came third read "3rd"
              and then, directly beneath it, 64.3, a number belonging to
              somebody else. Naming the seat (which a previous pass did) made
              it unambiguous but not useful: the one number a player wants
              from their own result is their own. The winner's score is still
              on screen, in the standings immediately below, where it is
              comparable rather than confusable. Falls back to the winner's —
              still explicitly labelled — for a viewer with no scored seat
              (a spectator, or an unscoreable roster). */}
          {yours && yours.score.kind === "scored" ? (
            <div className="mt-5" data-testid="tmw-your-score">
              <PeakV2Score
                value={yours.score.value.toFixed(1)}
                label={`Your ${RANKING_BASIS_LABEL}`}
                tone="accent"
                role="moment"
                size="lg"
              />
            </div>
          ) : winner && winner.score.kind === "scored" ? (
            <div className="mt-5" data-testid="tmw-winner-score" data-winner-is-you={winnerIsYou}>
              <PeakV2Score
                value={winner.score.value.toFixed(1)}
                label={winnerScoreLabel}
                tone="accent"
                role="moment"
                size="lg"
              />
            </div>
          ) : null}
        </PeakV2CinematicStage>

        <PeakV2Rule spacing="lg" />

        {/* Pass 7 (human acceptance testing, task §14): a compact standings
            strip bridges the hero (which only carried the WINNER's number)
            and the full per-seat roster breakdown below — "who won, by how
            much, and what each team looked like" should read in one glance,
            not only after scrolling into six-row-deep receipts. Same `rows`
            data the detailed blocks below already use; nothing invented. */}
        <div className="flex flex-col gap-2" data-testid="tmw-standings">
          {rows.map((row) => {
            const isFirst = row.result.placement === 1;
            const isYou = row.result.seat_index === yourSeatIndex;
            return (
              <div key={row.result.seat_index} className="flex items-baseline justify-between gap-3">
                <span
                  style={{
                    fontFamily: "var(--v2-font-ui)",
                    fontWeight: isFirst ? 700 : 500,
                    fontSize: "0.875rem",
                    color: isFirst ? "var(--v2-color-accent)" : "var(--v2-text-secondary)",
                  }}
                >
                  <span style={{ fontFamily: "var(--v2-font-mono)", fontVariantNumeric: "tabular-nums" }}>
                    {ordinal(row.result.placement)}
                  </span>{" "}
                  {row.result.display_name}
                  {isYou ? <span style={{ color: "var(--v2-text-muted)" }}> · you</span> : null}
                </span>
                <span
                  style={{
                    fontFamily: "var(--v2-font-mono)",
                    fontVariantNumeric: "tabular-nums",
                    fontSize: "0.875rem",
                    fontWeight: 700,
                    color: isFirst ? "var(--v2-color-accent)" : "var(--v2-text-primary)",
                  }}
                >
                  {row.score.kind === "scored" ? row.score.value.toFixed(1) : row.score.text}
                </span>
              </div>
            );
          })}
        </div>

        <PeakV2Rule spacing="lg" />

        {/* THREE COMPETITORS, SIDE BY SIDE — winner first, on the court the
            draft was played on. Stacked vertically these were three ~1000px
            ledgers; abreast they are one comparable composition that fits a
            desktop viewport, and they stack (still winner-first) below the
            breakpoint where three columns would stop being readable. */}
        <div>
          <span style={SECTION_HEAD_STYLE}>Final rosters</span>
          <div className="tmw-result-grid" data-testid="tmw-result-rows">
            {rows.map((row) => {
              const roster = rosters.find((entry) => entry.seat_index === row.result.seat_index);
              const isYou = row.result.seat_index === yourSeatIndex;
              return (
                <SeatResultBlock
                  key={row.result.seat_index}
                  row={row}
                  roster={roster}
                  isYou={isYou}
                />
              );
            })}
          </div>
        </div>

        {unrankableReason ? (
          <p className="mt-4" data-testid="tmw-unranked-reason" style={mutedTextStyle}>
            {unrankableReason}
          </p>
        ) : null}

        <PeakV2Rule spacing="lg" />

        <div className="flex flex-wrap items-center gap-3">
          <PeakV2PrimaryAction onClick={onPlayAgain} data-testid="tmw-play-again">
            Play again
          </PeakV2PrimaryAction>
          <PeakV2SecondaryAction href="/arena" data-testid="tmw-back-to-arena">
            Back to Arena
          </PeakV2SecondaryAction>
        </div>

        {/* THE RECEIPT, ONE CLICK AWAY. Same convention as `PodiumReceipt`'s
            "Full receipt" disclosure and both sibling V2 result screens'
            `<details>`: the basis sentence, the leave-one-out decisive pick,
            the evaluator's own fit components, the mean season score with
            its "this decides nothing" label, and the traded-score-source
            notes — none of it invented, all of it the server's own numbers. */}
        <details className="mt-10" data-testid="tmw-receipt">
          <summary
            data-testid="tmw-receipt-toggle"
            style={{
              fontFamily: "var(--v2-font-ui)",
              fontSize: "0.8125rem",
              fontWeight: 600,
              color: "var(--v2-text-secondary)",
              cursor: "pointer",
            }}
          >
            Full receipt · how scoring worked
          </summary>
          <p className="mt-3" data-testid="tmw-ranking-basis" style={bodyTextStyle}>
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
                  <h3 style={{ fontFamily: "var(--v2-font-ui)", fontWeight: 700, fontSize: "0.875rem", color: "var(--v2-text-primary)" }}>
                    {ordinal(row.result.placement)} · {row.result.display_name}
                  </h3>
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
                        <li key={note} style={mutedTextStyle}>
                          {note}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </div>
        </details>
      </div>
    </PeakV2Shell>
  );
}
