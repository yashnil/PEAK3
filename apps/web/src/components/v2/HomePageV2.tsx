/**
 * HomePageV2 — PEAK3 V2's production-data-driven homepage (Pass 5 —
 * comprehensive recomposition, superseding Pass 3's foundation cut).
 *
 * Structure, per the brief's <homepage> section — blending E1/3a's strong
 * COMPOSITION (commanding hero, substantial right-side data object, a
 * horizontal game slate spanning the content width directly below the hero)
 * with E2's refined typography/whitespace/serif restraint. Verified against
 * both references (`.claude-private/design/PEAK3-Directions-E.pdf`, pages
 * 2-3 and 12-13):
 *
 *   1. CINEMATIC HERO — two columns at desktop. Left: the product thesis in
 *      mixed regular/italic display type, one explanation sentence, primary
 *      + secondary actions. Right: a BOUNDED panel (real visual mass, not a
 *      thin border-left rule) holding a real #1 ranked window's five-lane
 *      breakdown — the "basketball/data object" the brief calls for.
 *   2. GAME SLATE — one wide instrument strip with vertical hairline
 *      dividers between cells (not five independent cards), spanning the
 *      full content width. Every finished mode reads together as one
 *      designed row at desktop; 2-column then stacked on narrower widths.
 *   3. Weights — the frozen source of truth, plainly stated.
 *   4. Q&A — plain hairline rows linking into the real Methodology route.
 *
 * Server-safe except for the one resume-state cell (`HomeV2ResumeRow`,
 * client-only, localStorage-only per CLAUDE.md's Phase 1 limitation).
 * Nothing here is fabricated — every value is a prop this file's caller
 * (`app/(main)/page.tsx`) already computed server-side from real fetches.
 */

import Link from "next/link";
import PeakV2Shell from "./PeakV2Shell";
import PeakV2CinematicStage from "./PeakV2CinematicStage";
import PeakV2ResultHeadline from "./PeakV2ResultHeadline";
import PeakV2DisplayEmphasis from "./PeakV2DisplayEmphasis";
import PeakV2Rule from "./PeakV2Rule";
import PeakV2DataLane from "./PeakV2DataLane";
import PeakV2PlayerIdentity from "./PeakV2PlayerIdentity";
import PeakV2PrimaryAction from "./PeakV2PrimaryAction";
import PeakV2SecondaryAction from "./PeakV2SecondaryAction";
import HomeV2ResumeRow from "./HomeV2ResumeRow";
import type { VignetteWindow, HomeModelProof } from "@/components/home/home-data";
import type { RankingComponentKey } from "@/types";
import { v2ToneVar, type V2Tone } from "./v2-tone";

export interface HomePageV2ComponentWeight {
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
}

export interface HomePageV2Props {
  topWindow: VignetteWindow | null;
  componentWeights: HomePageV2ComponentWeight[];
  proof: HomeModelProof;
  flagship: HomePageV2Mode;
  /** RTT — gets the real client-side resume treatment via `HomeV2ResumeRow`. */
  runTheTable: HomePageV2Mode;
  dailyModes: HomePageV2Mode[];
  /** Rendered only when the Arena's own readiness check says these exist —
   *  never guessed, never shown 403-prone. */
  multiplayerModes: HomePageV2Mode[];
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
export function ModeSlateCell({ mode, badge }: { mode: HomePageV2Mode; badge?: string }) {
  return (
    <Link href={mode.href} className="v2-slate-cell group">
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

const QA: { q: string; a: React.ReactNode }[] = [
  {
    q: "What is a PEAK3 peak?",
    a: "A contiguous window of seasons — one, two, three or five years — scored as a single unit against every other window since 1979-80. It measures how good a player was at their best, not how long they lasted.",
  },
  {
    q: "Windows, or careers?",
    a: "Windows. A player's greatest stretch can be three seasons or one — PEAK3 never averages a peak down across years that were not part of it.",
  },
  {
    q: "How does PEAK3 rate a player?",
    a: "Five open components — statistical impact, traditional production, individual recognition, playoff rate impact and team result — combined at fixed, published weights. Every game in the Arena is settled on those same five lanes.",
  },
  {
    q: "Does PEAK3 simulate games?",
    a: "No. It rates real, already-played peak windows on real box-score and award data. Nothing here predicts a game that has not happened.",
  },
  {
    q: "Can I compete with other people?",
    a: "Three-Man Weave and The $20 Showdown are live, seat-based games against real opponents. Every other mode is single-player against the model itself, with a leaderboard behind it.",
  },
];

export default function HomePageV2({
  topWindow,
  componentWeights,
  proof,
  flagship,
  runTheTable,
  dailyModes,
  multiplayerModes,
}: HomePageV2Props) {
  const laneEntries = topWindow?.components
    ? COMPONENT_ORDER.map((key) => ({ key, value: topWindow.components?.[key] ?? null })).filter(
        (e): e is { key: RankingComponentKey; value: number } => e.value !== null,
      )
    : [];

  const [daily1, daily2] = dailyModes;
  const [mp1, mp2] = multiplayerModes;

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
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <PeakV2PrimaryAction href={flagship.href}>{flagship.title}</PeakV2PrimaryAction>
              <PeakV2SecondaryAction href="/play/daily">Play today&apos;s duel</PeakV2SecondaryAction>
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

      {/* ---- 2. GAME SLATE — one instrument strip, full content width ---- */}
      <section aria-labelledby="v2-modes-heading" className="v2-slate-section">
        <div className="v2-slate-heading-row">
          <span className="v2-live-dot" aria-hidden="true" />
          <h2 id="v2-modes-heading" className="v2-slate-heading">
            Choose a game
          </h2>
        </div>
        <div className="v2-slate-grid">
          <HomeV2ResumeRow mode={runTheTable} />
          {daily1 ? <ModeSlateCell mode={daily1} /> : null}
          {daily2 ? <ModeSlateCell mode={daily2} /> : null}
          {mp1 ? <ModeSlateCell mode={mp1} badge="Live" /> : null}
          {mp2 ? <ModeSlateCell mode={mp2} badge="Live" /> : null}
        </div>
      </section>

      <PeakV2Rule spacing="lg" />

      {/* ---- Weights — the frozen source of truth, plainly stated ---- */}
      {componentWeights.length > 0 ? (
        <section aria-labelledby="v2-weights-heading">
          <h2
            id="v2-weights-heading"
            style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--v2-text-muted)", margin: 0 }}
          >
            How a player is rated
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-6 sm:grid-cols-5">
            {componentWeights.map((c) => (
              <div key={c.label} className="flex flex-col gap-1">
                <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "1.375rem", fontWeight: 700, color: "var(--v2-text-primary)" }}>{c.pct}</span>
                <span style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-secondary)" }}>{c.label}</span>
                <span aria-hidden="true" style={{ height: 2, width: 24, background: v2ToneVar(c.tone) ?? "var(--v2-color-accent)" }} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <PeakV2Rule spacing="lg" />

      {/* ---- 3. Q&A — plain hairline rows ---- */}
      <section aria-labelledby="v2-qa-heading">
        <h2
          id="v2-qa-heading"
          style={{ fontFamily: "var(--v2-font-display)", fontSize: "1.5rem", fontWeight: 400, color: "var(--v2-text-primary)", margin: 0 }}
        >
          Questions, answered plainly.
        </h2>
        <div className="mt-5 flex flex-col">
          {QA.map((item) => (
            <div key={item.q} className="py-4" style={{ borderBottom: "1px solid var(--v2-border-subtle)" }}>
              <p style={{ fontFamily: "var(--v2-font-ui)", fontWeight: 700, fontSize: "0.9375rem", color: "var(--v2-text-primary)", margin: 0 }}>
                {item.q}
              </p>
              <p className="mt-1.5 max-w-[62ch]" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", lineHeight: 1.6, color: "var(--v2-text-secondary)" }}>
                {item.a}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-4">
          <Link
            href="/methodology"
            className="inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.8125rem", fontWeight: 700, color: "var(--v2-color-accent)" }}
          >
            Read the full methodology →
          </Link>
        </p>
      </section>

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
