/**
 * HomePageV2 — PEAK3 V2's production-data-driven homepage.
 *
 * Pass 6 (product-direction, "GLOBAL DESIGN CONSISTENCY + HOMEPAGE PRODUCT
 * DEPTH") recomposes everything below the hero, per the brief's <homepage>
 * section order:
 *
 *   1. HERO — untouched composition (Pass 5's E1-mass/E2-restraint blend).
 *      Only the primary action changed: "GO TO ARENA" → `/arena`, the same
 *      arena-first destination legacy's own hero CTA already leads to
 *      ("Visit Arena" — see `app/(main)/page.tsx`'s docstring). Today's
 *      duel stays the secondary action, unchanged.
 *   2. GAME SLATE — untouched (Pass 5's one instrument-strip grammar).
 *   3. YOUR ARENA — new: a real, personalized/current-state strip
 *      (`HomeV2YourArena`). Client-only, fails closed to nothing for a
 *      visitor with no real state to show.
 *   4. HOW PEAK3 WORKS — the five static percentage labels replaced with
 *      `HomeV2LaneExplainer`, an interactive single-object visualization of
 *      the same frozen weights, backed by the real methodology copy
 *      `/methodology` itself renders.
 *   5. RANKINGS PREVIEW — new: the top of the real Peak Windows board,
 *      plain hairline rows, one action into `/rankings`.
 *   6. WHY PEAKS? — new: a short editorial bridge into Methodology.
 *   7. FAQ — the same real Q&A, now `HomeV2Faq`'s collapsed accordion
 *      instead of five permanently-open paragraphs.
 *
 * Nothing here is fabricated — every value is a prop this file's caller
 * (`app/(main)/page.tsx`) already computed server-side from real fetches,
 * or (Your Arena) a real client-only read the rest of the app already
 * trusts (`useResumeState`, `progressionApi`).
 */

import Link from "next/link";
import PeakV2Shell from "./PeakV2Shell";
import PeakV2CinematicStage from "./PeakV2CinematicStage";
import PeakV2ResultHeadline from "./PeakV2ResultHeadline";
import PeakV2DisplayEmphasis from "./PeakV2DisplayEmphasis";
import PeakV2Rule from "./PeakV2Rule";
import PeakV2DataLane from "./PeakV2DataLane";
import PeakV2PlayerIdentity from "./PeakV2PlayerIdentity";
import PeakV2SecondaryAction from "./PeakV2SecondaryAction";
import HomeV2PrimaryCta from "./HomeV2PrimaryCta";
import HomeV2ResumeRow from "./HomeV2ResumeRow";
import HomeV2YourArena from "./HomeV2YourArena";
import HomeV2LaneExplainer, { type HomeV2Lane } from "./HomeV2LaneExplainer";
import HomeV2Faq from "./HomeV2Faq";
import NbaFactOfTheDay, { type NbaFactView } from "@/components/home/NbaFactOfTheDay";
import type { VignetteWindow, HomeModelProof } from "@/components/home/home-data";
import type { Methodology, RankingComponentKey } from "@/types";
import type { V2Tone } from "./v2-tone";

export interface HomePageV2ComponentWeight {
  key: RankingComponentKey;
  label: string;
  pct: string;
  tone: V2Tone;
}

export interface HomePageV2Mode {
  href: string;
  title: string;
  description: string;
  /** Short instrument-role tag, e.g. "5 QUESTIONS", "3 COURTS", "24 LOTS". Real, never fabricated. */
  tag?: string;
  /** Stable catalogue id (e.g. "three_man_weave"), when the mode came from
   *  one — drives this cell's `data-testid` for e2e navigation coverage. */
  id?: string;
}

export interface HomePageV2Props {
  topWindow: VignetteWindow | null;
  componentWeights: HomePageV2ComponentWeight[];
  proof: HomeModelProof;
  /** RTT — gets the real client-side resume treatment via `HomeV2ResumeRow`. */
  runTheTable: HomePageV2Mode;
  dailyModes: HomePageV2Mode[];
  /** `null` when the Arena's own fail-closed CourtBuilder readiness check
   *  says 82-0 is not enabled — never shown as a link that might 403. */
  peakSeason: HomePageV2Mode | null;
  /** Rendered only when the Arena's own readiness check says these exist —
   *  never guessed, never shown 403-prone. */
  multiplayerModes: HomePageV2Mode[];
  /** The top of the real Peak Windows board — a deeper slice of the same
   *  fetch the hero's data object draws its rank-1 window from. */
  rankingsPreview: VignetteWindow[];
  /** `null` when `/api/v1/methodology` was unreachable — the lane
   *  explainer still renders (weights are always known locally), just
   *  without per-lane description copy. */
  methodology: Methodology | null;
  /** Today's NBA Fact of the Day, chosen server-side by calendar date.
   *  `null` when the fact bank is unreachable — `NbaFactOfTheDay` itself
   *  renders nothing rather than a fabricated fact. */
  nbaFact: NbaFactView | null;
}

const COMPONENT_KEY_TO_TONE: Record<RankingComponentKey, V2Tone> = {
  statistical_impact: "si",
  traditional_production: "tp",
  individual_recognition: "rec",
  postseason_individual_value: "po",
  team_achievement: "team",
};

const COMPONENT_KEY_TO_LABEL: Record<RankingComponentKey, string> = {
  statistical_impact: "Statistical Impact",
  traditional_production: "Traditional Production",
  individual_recognition: "Individual Recognition",
  postseason_individual_value: "Playoff Rate Impact",
  team_achievement: "Team Result",
};

const COMPONENT_ORDER: RankingComponentKey[] = [
  "statistical_impact",
  "traditional_production",
  "individual_recognition",
  "postseason_individual_value",
  "team_achievement",
];

/** One cell of the horizontal game slate. Shared shape for every mode,
 *  including the RTT resume cell (`HomeV2ResumeRow` renders this same
 *  markup so the strip never has one visually different cell). */
export function ModeSlateCell({
  mode,
  badge,
  testId,
}: {
  mode: HomePageV2Mode;
  badge?: string;
  /** Overrides the auto-derived `home-${mode.id}-card` testid — for a mode
   *  whose e2e-observable id predates `MODE_COPY`'s id (e.g. Peak Duel
   *  Daily's card kept its long-standing `home-daily-duel-card` name). */
  testId?: string;
}) {
  return (
    <Link
      href={mode.href}
      className="v2-slate-cell group"
      data-testid={testId ?? (mode.id ? `home-${mode.id}-card` : undefined)}
    >
      <span className="v2-slate-cell-head">
        {mode.tag ? <span className="v2-slate-cell-tag">{mode.tag}</span> : null}
        {badge ? <span className="v2-slate-cell-badge">{badge}</span> : null}
      </span>
      <span className="v2-slate-cell-title">{mode.title}</span>
      <span className="v2-slate-cell-desc">{mode.description}</span>
      <span className="v2-slate-cell-action" aria-hidden="true">
        Play <span className="v2-slate-cell-arrow">→</span>
      </span>
    </Link>
  );
}

export default function HomePageV2({
  topWindow,
  componentWeights,
  proof,
  runTheTable,
  dailyModes,
  peakSeason,
  multiplayerModes,
  rankingsPreview,
  methodology,
  nbaFact,
}: HomePageV2Props) {
  const laneEntries = topWindow?.components
    ? COMPONENT_ORDER.map((key) => ({ key, value: topWindow.components?.[key] ?? null })).filter(
        (e): e is { key: RankingComponentKey; value: number } => e.value !== null,
      )
    : [];

  const [daily1, daily2] = dailyModes;
  const [mp1, mp2] = multiplayerModes;

  // Static, non-fabricated nav entry — a plain route this repository always
  // serves, not a data-dependent card. Kept alongside the other Competitive
  // entry points on `/arena`, unconditional there too.
  const leaderboardMode: HomePageV2Mode = {
    id: "leaderboard",
    href: "/arena/court/leaderboard",
    title: "82-0 Leaderboard",
    description: "The best submitted 82-0 PEAK Season runs — measure your roster against them.",
  };

  const laneDescriptions: Record<string, string> = {};
  for (const c of methodology?.components ?? []) {
    laneDescriptions[c.id] = c.short_description;
  }
  const lanes: HomeV2Lane[] = componentWeights.map((c) => ({
    key: c.key,
    label: c.label,
    weightPct: Number.parseFloat(c.pct),
    tone: c.tone,
  }));

  return (
    <PeakV2Shell width="live">
      {/* ---- 1. CINEMATIC HERO — commanding left statement, substantial right data object ---- */}
      <PeakV2CinematicStage light={{ y: "-10%" }} align="start" className="v2-home-hero">
        <div className="grid w-full grid-cols-1 gap-10 text-left lg:grid-cols-[1.2fr_1fr] lg:items-stretch">
          <div className="flex flex-col justify-center">
            <p className="v2-eyebrow">PEAK3 Arena</p>
            <PeakV2ResultHeadline as="h1" scale="hero" style={{ margin: 0, marginTop: "var(--v2-space-3)", textAlign: "left" }}>
              Five lanes.
              <br />
              <PeakV2DisplayEmphasis>One point each.</PeakV2DisplayEmphasis>
            </PeakV2ResultHeadline>
            <p
              className="mt-5 max-w-[46ch]"
              style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.9375rem", lineHeight: 1.6, color: "var(--v2-text-secondary)" }}
            >
              PEAK3 scores every exact peak window since 1979-80 on five open
              components. Every game in the Arena is settled across those
              same five lanes — Team Result decides one as often as
              Statistical Impact does.
            </p>
            <div className="mt-8">
              <HomeV2PrimaryCta>
                <PeakV2SecondaryAction href="/play/daily">Play today&apos;s duel</PeakV2SecondaryAction>
              </HomeV2PrimaryCta>
            </div>
          </div>

          {topWindow ? (
            <div className="v2-hero-object">
              <div className="v2-hero-object-head">
                <span className="v2-hero-object-kicker">Rank {topWindow.rank} · 3-Year Window</span>
                {topWindow.primeScore !== null ? (
                  <span className="v2-hero-object-score">{topWindow.primeScore.toFixed(1)}</span>
                ) : null}
              </div>
              <div className="mt-2">
                <PeakV2PlayerIdentity
                  name={topWindow.playerName}
                  meta={topWindow.team ? `${topWindow.team} · ${topWindow.label}` : topWindow.label}
                  size="lg"
                />
              </div>
              {laneEntries.length > 0 ? (
                <div className="mt-6 flex flex-col gap-3">
                  {laneEntries.map((e) => (
                    <PeakV2DataLane
                      key={e.key}
                      label={COMPONENT_KEY_TO_LABEL[e.key]}
                      tone={COMPONENT_KEY_TO_TONE[e.key]}
                      leftLabel=""
                      leftValue={e.value.toFixed(1)}
                      leftPosition={e.value}
                      scaleMin={0}
                      scaleMax={Math.max(...laneEntries.map((x) => x.value), 1) * 1.15}
                    />
                  ))}
                </div>
              ) : null}
              <p className="mt-5 text-right">
                <Link href="/rankings" className="v2-hero-object-link">
                  {proof.rankedWindows !== null ? `${proof.rankedWindows.toLocaleString()} windows on the board` : "See the full board"} →
                </Link>
              </p>
            </div>
          ) : null}
        </div>
      </PeakV2CinematicStage>

      {/* ---- NBA FACT OF THE DAY — between the hero and the catalogue.
          General basketball trivia, never a PEAK3 claim; renders nothing
          when the fact bank is unreachable (see `NbaFactOfTheDay`'s own
          docstring). Server-rendered, zero client JavaScript. ---- */}
      <NbaFactOfTheDay fact={nbaFact} />

      {/* ---- 2. GAME SLATE — one instrument strip, full content width ---- */}
      <section aria-labelledby="modes-heading" className="v2-slate-section">
        <div className="v2-slate-heading-row">
          <span className="v2-live-dot" aria-hidden="true" />
          <h2 id="modes-heading" className="v2-slate-heading">
            Choose a game
          </h2>
        </div>
        <div className="v2-slate-grid">
          <HomeV2ResumeRow mode={runTheTable} />
          {daily1 ? <ModeSlateCell mode={daily1} /> : null}
          {/* `home-daily-duel-card` predates `MODE_COPY["peak-duel"].id` and
              stays literal — an e2e-observable identity, not presentation. */}
          {daily2 ? <ModeSlateCell mode={daily2} testId="home-daily-duel-card" /> : null}
          {peakSeason ? <ModeSlateCell mode={peakSeason} /> : null}
          <ModeSlateCell mode={leaderboardMode} />
          {mp1 ? <ModeSlateCell mode={mp1} badge="Live" /> : null}
          {mp2 ? <ModeSlateCell mode={mp2} badge="Live" /> : null}
        </div>
      </section>

      {/* ---- 3. YOUR ARENA — real personalized/current-state strip ---- */}
      <HomeV2YourArena multiplayerModes={multiplayerModes} />

      <PeakV2Rule spacing="lg" />

      {/* ---- 4. HOW PEAK3 WORKS — one interactive object, not five labels ---- */}
      {lanes.length > 0 ? (
        <section aria-labelledby="v2-weights-heading">
          <h2 id="v2-weights-heading" className="v2-section-eyebrow">
            How a player is rated
          </h2>
          <div className="mt-4">
            <HomeV2LaneExplainer lanes={lanes} descriptions={laneDescriptions} />
          </div>
        </section>
      ) : null}

      <PeakV2Rule spacing="lg" />

      {/* ---- 5. GLOBAL BOARD / RANKINGS PREVIEW — real rows, one action ---- */}
      {rankingsPreview.length > 0 ? (
        <section aria-labelledby="v2-rankings-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="v2-rankings-heading" className="v2-section-eyebrow">
              The board
            </h2>
            <Link href="/rankings" className="v2-hero-object-link">
              View rankings →
            </Link>
          </div>
          <ol className="v2-rankings-list">
            {rankingsPreview.map((w) => (
              <li key={w.rowId} className="v2-rankings-row">
                <span className="v2-rankings-rank">{w.rank}</span>
                <span className="v2-rankings-identity">
                  <span className="v2-rankings-name">{w.playerName}</span>
                  <span className="v2-rankings-meta">{w.team ? `${w.team} · ${w.label}` : w.label}</span>
                </span>
                {w.primeScore !== null ? <span className="v2-rankings-score">{w.primeScore.toFixed(1)}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <PeakV2Rule spacing="lg" />

      {/* ---- 6. WHY PEAKS? — a short editorial bridge into Methodology ---- */}
      <section aria-labelledby="v2-why-heading" className="v2-why-section">
        <h2 id="v2-why-heading" className="v2-why-headline">
          Careers are long. <PeakV2DisplayEmphasis>Peaks are exact.</PeakV2DisplayEmphasis>
        </h2>
        <p className="v2-why-body">
          PEAK3 never averages a player down across seasons that were not
          part of their best stretch. It compares the exact window — one
          year, or five — against every other window since 1979-80.
        </p>
        <PeakV2SecondaryAction href="/methodology">EXPLORE THE METHODOLOGY</PeakV2SecondaryAction>
      </section>

      <PeakV2Rule spacing="lg" />

      {/* ---- 7. FAQ — collapsed by default, secondary to everything above it ---- */}
      <HomeV2Faq />

      {proof.playersEvaluated !== null && proof.rankedWindows !== null ? (
        <>
          <PeakV2Rule spacing="lg" />
          <p style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-secondary)", paddingBottom: "var(--v2-space-10)" }}>
            {proof.playersEvaluated.toLocaleString()} players evaluated ·{" "}
            {proof.rankedWindows.toLocaleString()} ranked peak windows
            {proof.modelLabel ? ` · ${proof.modelLabel}` : ""}
          </p>
        </>
      ) : null}
    </PeakV2Shell>
  );
}
