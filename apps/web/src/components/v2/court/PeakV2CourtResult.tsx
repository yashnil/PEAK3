"use client";

/**
 * PeakV2CourtResult — the V2 "Broadcast Arena" completion/result
 * presentation for 82-0 Peak Season (Pass 3). Same real data contract as
 * `SeasonResultStub` (legacy) — same props, same numbers, same correctness
 * gating (`is_perfect_season` withheld on an incomplete-score run, the
 * "Estimated" record caveat, the incomplete-score explanation, the
 * peak-value reassurance sentence) — restyled into the CINEMATIC → LIVE
 * pattern already established by `PeakV2RTTBattleResult`:
 *
 *   CINEMATIC: the {wins}-{losses} record is the one big serif headline
 *   (`PeakV2ResultHeadline scale="hero"`), `resultTier(wins)` a small label
 *   above it, `recordFraming(...)` a line beneath — never a second
 *   number treated as the headline.
 *
 *   LIVE: everything else — the real roster ON the real `CourtLayout`
 *   court (reused unchanged, same as `PeakV2CourtLive`), best pick /
 *   weakness, the lineup score, decisive factors, and the already-built
 *   save/play-again/leaderboard/share/insight panels — reads plain,
 *   flattened into hairline-divided sections (`PeakV2Rule`) instead of
 *   legacy's many small bordered pill/box treatments. The technical
 *   receipt (seed/versions/coverage) stays behind a native `<details>`,
 *   exactly as legacy tucks it away.
 *
 * `resultTier` is imported directly (SeasonResultStub exports it).
 * `recordFraming`/`teamIdentityPhrase`/`bestAndWorstPick` are NOT exported
 * by that file, so they are ported here verbatim (same logic, same
 * thresholds, same strings) rather than approximated — see each function's
 * own comment for the exact SeasonResultStub.tsx origin. Keep these three
 * in sync with SeasonResultStub.tsx by hand if that file's logic ever
 * changes; this file does not import from it beyond `resultTier`.
 */

import type { CSSProperties, ReactNode } from "react";
import PeakV2Shell from "../PeakV2Shell";
import PeakV2CinematicStage from "../PeakV2CinematicStage";
import PeakV2ResultHeadline from "../PeakV2ResultHeadline";
import { ScoreTransition } from "@/components/game-feel";
import PeakV2CourtSlot from "../PeakV2CourtSlot";
import PeakV2PrimaryAction from "../PeakV2PrimaryAction";
import CourtLayout from "@/components/court/CourtLayout";
import SaveRunPanel from "@/components/court/SaveRunPanel";
import PlayAgainPanel from "@/components/court/PlayAgainPanel";
import LeaderboardSubmitPanel from "@/components/court/LeaderboardSubmitPanel";
import LineupInsightPanel from "@/components/court/LineupInsightPanel";
import PeakPicksRecap from "@/components/court/PeakPicksRecap";
import ShareRunPanel from "@/components/court/ShareRunPanel";
import { resultTier } from "@/components/court/SeasonResultStub";
import {
  CourtSlotPublic,
  SharedCourtResult,
  SimulationResultPublic,
  STARTER_SLOT_TYPES,
  BENCH_SLOT_TYPES,
  fitLabel,
} from "@/types/perfect-season";
import type { SlotType } from "@/types/perfect-season";

/**
 * The slot's label as a READER sees it.
 *
 * The starters' own slot types are already the abbreviations basketball
 * uses ("PG", "C"), so they pass through. The bench types are internal
 * keys, and printing them raw put literal `bench_1` / `bench_2` / `bench_3`
 * on the result screen (design-review/12) — a database column shown to a
 * player. The API key is unchanged; only what is rendered changes.
 */
function slotDisplayLabel(slotType: SlotType): string {
  const benchIndex = BENCH_SLOT_TYPES.indexOf(slotType);
  return benchIndex >= 0 ? `Bench ${benchIndex + 1}` : slotType;
}

import type { V2Tone } from "../v2-tone";

interface Props {
  state: SharedCourtResult;
  result: SimulationResultPublic;
  onPlayAgain?: () => void;
  playAgainBusy?: boolean;
  readOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Ported verbatim from SeasonResultStub.tsx (not exported there) -- same
// logic, same strings, same thresholds. Keep in sync by hand.
// ---------------------------------------------------------------------------

/** SeasonResultStub.tsx::recordFraming -- an incomplete-score roster never
 * gets the confident "PERFECT SEASON" framing, even if the noisy win
 * formula happened to clamp to 82. */
function recordFraming(wins: number, losses: number, isIncomplete: boolean): string {
  if (isIncomplete) return "Provisional record — not all cards are officially scored";
  if (wins >= 82) return "PERFECT SEASON";
  if (losses === 1) return "One loss from perfect";
  if (losses <= 3) return "So close to perfect";
  if (wins >= 60) return "A strong season";
  if (wins >= 45) return "A playoff-caliber season";
  return "A rebuilding season";
}

const GUARD_POSITIONS = new Set(["PG", "SG"]);
const WING_POSITIONS = new Set(["SF"]);
const BIG_POSITIONS = new Set(["PF", "C"]);

/** SeasonResultStub.tsx::teamIdentityPhrase -- client-side, from
 * already-revealed slot data only, never a new hidden computation. */
function teamIdentityPhrase(slots: CourtSlotPublic[]): string {
  const starters = slots.filter((s) => STARTER_SLOT_TYPES.includes(s.slot_type));
  const guards = starters.filter((s) => s.primary_position && GUARD_POSITIONS.has(s.primary_position)).length;
  const wings = starters.filter((s) => s.primary_position && WING_POSITIONS.has(s.primary_position)).length;
  const bigs = starters.filter((s) => s.primary_position && BIG_POSITIONS.has(s.primary_position)).length;
  const offPosition = starters.filter((s) => s.role_fit === "off_position").length;

  const scores = slots
    .map((s) => s.season_score ?? s.individual_peak_score)
    .filter((v): v is number => v != null);
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  let base: string;
  if (bigs === 0) base = "No interior anchor";
  else if (guards >= 3) base = "Guard overload";
  else if (wings >= 3) base = "Wing factory";
  else if (avgScore != null && avgScore >= 75 && bigs >= 1 && guards >= 1) base = "Balanced contender";
  else if (avgScore != null && avgScore >= 75) base = "Star-heavy";
  else base = "Defensive-minded build";

  if (offPosition >= 3 && !base.includes("position")) {
    return `${base}, but position-broken`;
  }
  return base;
}

/** SeasonResultStub.tsx::bestAndWorstPick -- client-side fallback only used
 * when the server hasn't computed best_pick/structural_weakness (legacy
 * peak-window boards). */
function bestAndWorstPick(slots: CourtSlotPublic[]): { best: string | null; weakness: string } {
  const scored = slots
    .map((s) => ({ name: s.player_name, score: s.season_score ?? s.individual_peak_score }))
    .filter((s): s is { name: string; score: number } => s.name != null && s.score != null);
  if (scored.length === 0) {
    return { best: null, weakness: "No exact-season scores available yet for this roster" };
  }
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
  const unscoredCount = slots.filter((s) => s.filled && s.score_status && s.score_status !== "exact_season_scored").length;
  if (unscoredCount > 0) {
    return { best: best.name, weakness: `${unscoredCount} roster spot${unscoredCount === 1 ? "" : "s"} with no PEAK3 score yet` };
  }
  const worst = scored.reduce((a, b) => (b.score < a.score ? b : a));
  return { best: best.name, weakness: worst.name };
}

/**
 * The cinematic hero's one ambient light color. `showPerfectStyling` (never
 * true on an incomplete-score run -- same gate the headline itself uses)
 * gets the one legitimate gold moment. Otherwise this follows
 * SeasonResultStub.tsx::tierGlow's own real threshold (wins >= 45 is where
 * its scale first turns on) to pick a win/loss-flavored ambient wash, the
 * same outcome-tone convention `PeakV2RTTBattleResult` already uses for its
 * win/loss/draw light -- gold stays reserved for the perfect-season moment,
 * never a blanket "every result gets a gold glow" treatment. An incomplete
 * run gets the same baseline ambient every other V2 cinematic stage uses by
 * default (no outcome color at all), mirroring legacy's own
 * `data-tier-glow={isIncomplete ? "none" : tierGlow(wins)}` override.
 */
function heroLightTone(wins: number, isIncomplete: boolean, showPerfectStyling: boolean): V2Tone {
  if (isIncomplete) return "accent";
  if (showPerfectStyling) return "accent";
  return wins >= 45 ? "positive" : "negative";
}

const sectionLabelStyle: CSSProperties = {
  fontFamily: "var(--v2-font-mono)",
  fontSize: "0.6875rem",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--v2-text-muted)",
};

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

/**
 * ONE SECTION HEAD for the result's reading order (final polish). The screen
 * below the hero used to be a run of identical 11px grey mono labels with
 * the same gap between every block, so the roster, the analysis, the
 * model's detail, four action rows and two disclaimers read as one
 * undifferentiated column. Each section now opens with an index and a
 * label on a hairline, and the sections are grouped by what they are:
 * the result, its explanation, the model's detail, what you can do with
 * it, and the small print. The classes live in `court.css`
 * (`.v2-court-result-*`).
 */
function ResultSectionHead({ index, label, aside }: { index: string; label: ReactNode; aside?: ReactNode }) {
  return (
    <div className="v2-court-result-head">
      <span className="v2-court-result-index" aria-hidden="true">
        {index}
      </span>
      <span className="v2-court-result-label">{label}</span>
      {aside ? <span className="v2-court-result-aside">{aside}</span> : null}
    </div>
  );
}

/**
 * Mirrors `PeakCardCourt.tsx`'s own `fitColor` exactly (same trust-bug fix:
 * a "mild" off-position fit costs 0.0 fit points, so painting it the same
 * warning color as a real -14.0 structural mismatch told users the model
 * had penalized something it scored as free). The reveal was rendering
 * every fit caption in flat muted gray regardless of severity -- silently
 * dropping real, meaningful state on the one screen where a player most
 * wants to know WHY a pick fell short.
 */
function fitColor(roleFit: CourtSlotPublic["role_fit"], severity?: CourtSlotPublic["role_fit_severity"]): string {
  if (roleFit === "off_position") {
    if (severity === "mild") return "var(--v2-text-secondary)"; // neutral: costs nothing
    if (severity === "moderate") return "var(--accent-orange)";
    return "var(--v2-color-negative)";
  }
  if (roleFit === "primary") return "var(--v2-color-accent)";
  if (roleFit === "natural" || roleFit === "secondary") return "var(--v2-color-positive)";
  return "var(--v2-text-muted)";
}

/**
 * One revealed court/bench slot. A simpler, read-only sibling of
 * `PeakV2CourtSlotCard` (the interactive LIVE renderer) -- no click/move
 * affordances, just the real revealed identity + score, in the same
 * `PeakV2CourtSlot` grammar `PeakV2CourtLive` already established for this
 * exact court. Mirrors legacy `PeakCardCourt`'s reveal data (team/season,
 * rounded revealed score, rank for legacy peak-window slots, the
 * "no official score yet" / "season aggregate" notes) -- never fabricates a
 * score for an unscored card, never shows a career-peak substitute for a
 * team-year card. No team logo/avatar image, matching `PeakV2CourtSlotCard`
 * (and CLAUDE.md's no-photos/no-logos design principle) -- identity is
 * carried by name + team/season text alone.
 */
function ResultSlotCard({ slot }: { slot: CourtSlotPublic }) {
  if (!slot.filled) {
    return <PeakV2CourtSlot position={slotDisplayLabel(slot.slot_type)} state="empty" emptyHint="Open" />;
  }

  const isExactSeason = slot.exact_player_season_key != null;
  const revealedScore = isExactSeason ? slot.season_score : slot.individual_peak_score;
  const revealed = revealedScore != null;
  const value = revealed ? Math.round(revealedScore ?? 0) : undefined;

  // Same reveal-discipline testid contract as `PeakV2CourtSlotCard` (the
  // LIVE court) and legacy `PeakCardCourt.tsx`: a real score line only once
  // the server has actually revealed it, a locked/unavailable note
  // otherwise -- courtbuilder.spec.ts's result-credibility tests count
  // these directly (`revealed-score-line` === 8, `peak-locked-note` === 0
  // once every card is scored).
  const scoreLine: ReactNode = isExactSeason ? (
    <span data-testid="exact-season-line">
      {slot.team_name} · {slot.season}
      {/* THE SCORE IS PRINTED ONCE PER TILE. The aligned `PEAK3 <n>` column
          to the right of this line is where a reader compares cards, so
          repeating the same number inline read as two different figures at a
          glance ("… 1998-99 · 29 pts" beside "PEAK3 29"). The element itself
          stays — it is the reveal-discipline marker the result tests count
          (`revealed-score-line` === 8 once every card is scored), and it is
          the text form that pairs the score with its season for assistive
          tech — so it keeps the score and drops only the duplicate glyphs a
          sighted reader was seeing twice. */}
      {revealed ? (
        <span data-testid="revealed-score-line" className="sr-only">
          {" "}· {Math.round(slot.season_score ?? 0)} pts
        </span>
      ) : null}
      {!revealed && slot.score_status === "exact_season_unscored" ? (
        <span data-testid="score-unavailable-note"> · No official score</span>
      ) : null}
      {slot.score_source === "exact_season_aggregate" ? (
        <span data-testid="season-aggregate-note" title="Traded mid-season -- score is the whole-season total, not specific to this exact team stint.">
          {" "}· Season Aggregate
        </span>
      ) : null}
    </span>
  ) : revealed ? (
    <span>
      {slot.anchor_season} · #{slot.individual_peak_rank}
      <span data-testid="revealed-score-line" className="sr-only">
        {" "}· {Math.round(slot.individual_peak_score ?? 0)} pts
      </span>
    </span>
  ) : (
    <span data-testid="peak-locked-note">{slot.anchor_season} · Peak locked</span>
  );

  const fit = fitLabel(slot.role_fit, slot.role_fit_severity);

  return (
    <div className="flex flex-col gap-1">
      <PeakV2CourtSlot
        position={slotDisplayLabel(slot.slot_type)}
        player={{ name: slot.player_name ?? "", meta: scoreLine }}
        value={value}
        valueLabel={value !== undefined ? "PEAK3" : undefined}
        state="filled"
      />
      {fit ? (
        <span data-testid="role-fit-badge" style={{ ...mutedTextStyle, fontSize: "0.625rem", color: fitColor(slot.role_fit, slot.role_fit_severity) }}>
          {fit}
        </span>
      ) : null}
    </div>
  );
}

export default function PeakV2CourtResult({ state, result, onPlayAgain, playAgainBusy = false, readOnly = false }: Props) {
  const starterSlots = state.slots.filter((s) => STARTER_SLOT_TYPES.includes(s.slot_type));
  const benchSlots = state.slots.filter((s) => BENCH_SLOT_TYPES.includes(s.slot_type));
  const isExactSeasonMode = state.experimental_team_year_data_version != null;
  // Same gate as legacy: an incomplete-score run never gets the confident
  // "PERFECT SEASON" gold treatment, even if the noisy win formula clamps
  // to 82 -- one or more cards has no real PEAK3 score.
  const isIncomplete = result.lineup_score_status === "incomplete";
  const showPerfectStyling = result.is_perfect_season && !isIncomplete;
  const identity = teamIdentityPhrase(state.slots);

  const clientFallback = bestAndWorstPick(state.slots);
  const best = result.best_pick ?? clientFallback.best;
  const weakness = result.structural_weakness ?? clientFallback.weakness;
  const weaknessLabel = result.weakness_framing
    ? (result.weakness_framing === "ceiling_limiter" ? "Ceiling limiter" : "Weakness")
    : (result.wins >= 65 ? "Ceiling limiter" : "Weakness");

  // THE SCORES BEHIND THE TWO CLAIMS. "Best pick: Dirk Nowitzki" on its own
  // asks the reader to take it on faith; the number that makes it true is
  // already on the roster the server sent, so it is shown next to the name.
  // Matched by name against the slots because `best_pick`/
  // `structural_weakness` are the server's own strings, and a lookup that
  // misses simply omits the number rather than guessing one.
  function scoreForPlayer(name: string | null): number | null {
    if (!name) return null;
    const hit = state.slots.find((slot) => slot.filled && slot.player_name === name);
    const score = hit?.season_score ?? hit?.individual_peak_score ?? null;
    return typeof score === "number" ? score : null;
  }
  const bestScore = scoreForPlayer(best);
  const weakestScore = scoreForPlayer(weakness);

  // `identity` is the roster's build phrase, already computed above from the
  // real slots (`teamIdentityPhrase`) and already shown under the hero.
  const buildIdentity = identity;
  // The simulator's own positional-fit component, 0-100 on the same scale as
  // every other fit number it publishes. Absent boards simply omit the line.
  const positionalFit =
    typeof result.fit_components?.positional_fit === "number"
      ? result.fit_components.positional_fit
      : null;

  const scoredSlotCount = state.slots.filter((s) => s.score_status === "exact_season_scored").length;
  const filledSlotCount = state.slots.filter((s) => s.filled).length;

  const isDaily = state.challenge_kind === "daily";
  const dailyDateLabel = state.challenge_date
    ? new Date(`${state.challenge_date}T00:00:00Z`).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      })
    : null;

  const eligibility = state.eligibility ?? null;
  const savable = eligibility?.savable ?? true;

  return (
    <PeakV2Shell width="live">
      <div className="py-6" data-testid="season-result">
        <div className="flex items-center justify-between gap-3">
          <span style={sectionLabelStyle}>PEAK3 · {isDaily ? "Daily PEAK Season" : "82-0 Peak Season"}</span>
          <span style={{ ...sectionLabelStyle, fontSize: "0.625rem" }} data-testid="v0-simulator-label">
            Experimental simulator
          </span>
        </div>

        <div data-testid="result-hero" className="mt-2">
          <PeakV2CinematicStage light={{ tone: heroLightTone(result.wins, isIncomplete, showPerfectStyling) }}>
            <span className="v2-court-result-tier" data-testid="result-tier">
              {resultTier(result.wins)}
            </span>
            <div className="mt-2 flex items-start justify-center gap-2">
              {/* THE RECORD ASSEMBLES rather than appearing: a Level-3
                  moment, once per result, counting up from 0-0 to the
                  server's wins-losses. Reduced motion shows it directly.
                  A shared/read-only receipt is a document, not a reveal. */}
              <span data-testid="season-record">
                <PeakV2ResultHeadline as="h1" scale="hero" tone={showPerfectStyling ? "accent" : "primary"}>
                  {readOnly ? (
                    `${result.wins}-${result.losses}`
                  ) : (
                    <>
                      <ScoreTransition value={result.wins} from={0} durationMs={1100} testId="season-record-wins" />
                      -
                      <ScoreTransition value={result.losses} from={0} durationMs={1100} testId="season-record-losses" />
                    </>
                  )}
                </PeakV2ResultHeadline>
              </span>
              {isIncomplete && (
                <span
                  className="mt-2"
                  style={{ ...sectionLabelStyle, fontSize: "0.625rem" }}
                  data-testid="estimated-record-badge"
                  title="One or more cards have no official PEAK3 score yet -- this record uses conservative provisional impact for those cards, based on each card's real games/minutes sample."
                >
                  Estimated
                </span>
              )}
            </div>
            <p
              className="mt-2"
              style={{
                fontFamily: "var(--v2-font-ui)",
                fontSize: "0.9375rem",
                fontWeight: 700,
                color: showPerfectStyling ? "var(--v2-color-accent)" : "var(--v2-text-secondary)",
                margin: 0,
              }}
              data-testid="record-framing"
            >
              {recordFraming(result.wins, result.losses, isIncomplete)}
            </p>
            <p className="mt-1" style={{ ...mutedTextStyle, margin: 0 }} data-testid="team-identity-phrase">
              {identity}
            </p>
            {isDaily && dailyDateLabel && (
              <p
                className="mt-1"
                style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", fontWeight: 700, color: "var(--v2-color-accent)", margin: 0 }}
                data-testid="daily-challenge-label"
              >
                Daily challenge · {dailyDateLabel}
              </p>
            )}
          </PeakV2CinematicStage>
        </div>

        {/* B. YOUR FINAL ROSTER — the visual centrepiece directly under the
            result, on the same court the run was built on. The eight exact
            player-seasons are the receipt; the analysis explains them, so
            it follows them. */}
        <section className="v2-court-result-section" data-testid="result-section-roster">
          <ResultSectionHead index="01" label="Your roster, revealed" aside={`${filledSlotCount} exact player-seasons`} />
          <div className="mt-4">
            <CourtLayout starterSlots={starterSlots} benchSlots={benchSlots} renderSlot={(slot) => <ResultSlotCard slot={slot} />} />
          </div>
        </section>

        {/* C. RUN ANALYSIS — ONE RECEIPT, not four panels.
            Every number here is the server's own (`lineup_peak_score`, the
            slots' `season_score`, `best_pick`, `structural_weakness`,
            `decisive_factors`). Nothing is computed for display, and no
            metric is invented to fill a column. The lineup score at result
            scale, then the two picks that moved it most, each with the real
            score that makes the claim checkable. */}
        <section className="v2-court-result-section" data-testid="result-section-analysis">
          <ResultSectionHead index="02" label="Run analysis" />
          <div data-testid="run-analysis">
            <div className="v2-run-analysis">
              <div className="v2-run-stat" data-testid="lineup-peak-score">
                <span className="v2-run-stat-label">PEAK3 lineup score</span>
                {result.lineup_score_status === "incomplete" ? (
                  <>
                    <span
                      className="v2-run-stat-value v2-run-stat-value--muted"
                      data-testid="lineup-score-incomplete"
                    >
                      Incomplete
                    </span>
                    <span className="v2-run-stat-note" data-testid="score-coverage-note">
                      {scoredSlotCount}/{filledSlotCount} exact season cards scored. One or more
                      player-seasons has no official PEAK3 score yet (below the model&apos;s minutes
                      threshold), so the lineup score is withheld rather than estimated — the
                      projected record above still uses each card&apos;s real games/minutes sample.
                    </span>
                  </>
                ) : (
                  <>
                    <span className="v2-run-stat-value">{result.lineup_peak_score.toFixed(1)}</span>
                    <span className="v2-run-stat-note" data-testid="score-coverage-note">
                      Mean of your {filledSlotCount} cards&apos; real{" "}
                      {isExactSeasonMode ? "exact season" : "peak"} PEAK3 scores — the number to
                      compare across runs. {scoredSlotCount}/{filledSlotCount} scored.
                    </span>
                  </>
                )}
              </div>

              {best ? (
                <div className="v2-run-stat" data-testid="best-and-weakness">
                  <span className="v2-run-stat-label">Best pick</span>
                  <span className="v2-run-stat-name" data-tone="positive">{best}</span>
                  {bestScore !== null ? (
                    <span className="v2-run-stat-sub" data-testid="best-pick-score">
                      {bestScore.toFixed(0)} PEAK3
                    </span>
                  ) : null}
                </div>
              ) : null}

              <div className="v2-run-stat">
                <span className="v2-run-stat-label">{weaknessLabel}</span>
                <span className="v2-run-stat-name" data-tone="caution" data-testid="weakness-label">
                  {weakness}
                </span>
                {weakestScore !== null ? (
                  <span className="v2-run-stat-sub" data-testid="weakest-pick-score">
                    {weakestScore.toFixed(0)} PEAK3
                  </span>
                ) : null}
              </div>

              <div className="v2-run-stat">
                <span className="v2-run-stat-label">Build</span>
                <span className="v2-run-stat-name">{buildIdentity}</span>
                {positionalFit !== null ? (
                  <span className="v2-run-stat-sub" data-testid="positional-fit">
                    Positional fit {positionalFit.toFixed(0)}
                  </span>
                ) : null}
              </div>
            </div>

            {/* A bare label like "thin bench depth" reads as a real basketball
                insult on its own -- this clarifies it's relative to PEAK3's
                0-100 all-time-peak scale, not an absolute real-world judgment. */}
            {result.structural_weakness_detail ? (
              <p className="v2-run-analysis-detail" data-testid="weakness-detail">
                {result.structural_weakness_detail}
              </p>
            ) : null}
          </div>
        </section>

        <section className="v2-court-result-section" data-testid="result-section-factors">
          <ResultSectionHead index="03" label="What decided this" />
          <ul className="v2-court-result-factors" data-testid="decisive-factors">
            {result.decisive_factors.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <p className="v2-court-result-note" data-testid="peak-value-reassurance">
            PEAK3 scores this roster mostly on peak talent and real position fit — it never docks a
            lineup for having too many elite peaks.
          </p>
        </section>

        {/* D. THE MODEL'S DETAIL — round by round, and the seven fit
            components. Secondary by design: it explains the analysis above
            and is grouped as one section so it reads as one thing. */}
        <section className="v2-court-result-section" data-testid="result-section-model">
          <ResultSectionHead index="04" label="The model's detail" />
          <div className="v2-court-result-model">
            {result.peak_picks_recap && result.peak_picks_recap.length > 0 && <PeakPicksRecap recap={result.peak_picks_recap} />}
            <LineupInsightPanel result={result} />
          </div>
        </section>

        {/* E. ACTIONS — grouped on one plane, after the result has been
            read. Save, play again, share and the leaderboard used to be four
            unrelated rows in the same grey as the disclaimers under them;
            they are the things a player can DO with this result, so they
            sit together and read as controls. */}
        <section className="v2-court-result-section v2-court-result-actions" data-testid="result-actions">
          <ResultSectionHead index="05" label={readOnly ? "Your turn" : "This run"} />
          <div className="v2-court-result-actions-grid">
            {readOnly ? (
              <div className="v2-court-result-action">
                <div className="flex items-center justify-between gap-3">
                  <span style={bodyTextStyle}>Think you can build a better roster?</span>
                  <PeakV2PrimaryAction href="/arena/court/practice/apex_1y">Build your own</PeakV2PrimaryAction>
                </div>
              </div>
            ) : null}
            {onPlayAgain && (
              <div className="v2-court-result-action">
                <PlayAgainPanel
                  mode={state.mode}
                  wins={result.wins}
                  losses={result.losses}
                  lineupPeakScore={result.lineup_score_status === "complete" ? result.lineup_peak_score : null}
                  onPlayAgain={onPlayAgain}
                  busy={playAgainBusy}
                  // `SaveRunPanel` beside it already asks a signed-out
                  // player to sign in to save and track this run; the
                  // leaderboard panel asks separately about the global
                  // board. Without this the block held three near-identical
                  // sign-in rows.
                  signInPromptShownAbove
                />
              </div>
            )}
            <div className="v2-court-result-action">
              <SaveRunPanel gameId={state.game_id} wins={result.wins} savable={savable} readOnly={readOnly} />
            </div>
            <div className="v2-court-result-action">
              <ShareRunPanel state={state} result={result} />
            </div>
            {!readOnly && (
              <div className="v2-court-result-action">
                <LeaderboardSubmitPanel gameId={state.game_id} mode={state.mode} lineupScoreStatus={result.lineup_score_status} />
              </div>
            )}
          </div>
          {eligibility && !eligibility.leaderboard_eligible && eligibility.reason !== "game_not_complete" && (
            <p className="v2-court-result-note" data-testid="eligibility-notice">
              <span style={{ fontWeight: 700, color: "var(--warning)" }}>Not leaderboard-eligible · </span>
              {eligibility.reason_detail}
            </p>
          )}
        </section>

        {/* F. THE SMALL PRINT — the simulator's caveat and the board's
            provenance, quiet and last. No "Data receipt" tag: the seed is
            the disclosure's own summary line. */}
        <footer className="v2-court-result-footnotes" data-testid="result-footnotes">
          <p className="v2-court-result-footnote" data-testid="experimental-notice">
            {result.experimental_notice}
          </p>
          <details className="v2-court-provenance" data-testid="result-receipt">
            <summary className="cursor-pointer select-none">Seed {state.board_seed}</summary>
            <div className="flex flex-wrap gap-x-3 gap-y-1 pt-2">
              <span>{state.card_pool_version}</span>
              <span>{result.lineup_model_version}</span>
              <span>{result.simulator_version}</span>
              {state.experimental_team_year_data_version && <span>{state.experimental_team_year_data_version}</span>}
              {state.formula_version && <span>{state.formula_version}</span>}
              {state.coverage_mode && <span>{state.coverage_mode}</span>}
            </div>
          </details>
        </footer>
      </div>
    </PeakV2Shell>
  );
}
