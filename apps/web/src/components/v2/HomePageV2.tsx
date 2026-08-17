/**
 * HomePageV2 — PEAK3 V2's real, production-data-driven homepage (Pass 3,
 * product-direction — full redesign, superseding Pass 2's foundation-only
 * cut).
 *
 * Structure, per the brief's <homepage> section, verified against the real
 * Claude Design reference (`.claude-private/design/PEAK3-Directions-E.pdf`,
 * E2 pages 2-3 — "Five lanes. *One point each.*" / the Q&A hairline-row
 * block):
 *
 *   1. CINEMATIC HERO — a two-column editorial layout at desktop (statement
 *      left, one real ranked window's five-lane breakdown right), one
 *      column on mobile. Mixed regular/italic display via
 *      `PeakV2DisplayEmphasis`, restrained arena light, a real PEAK3
 *      explanation sentence.
 *   2. MODE SLATE — hairline rows, not SaaS cards. RUN THE TABLE's row
 *      swaps in real resume state (`HomeV2ResumeRow`, client-only, since
 *      progress is localStorage-only per CLAUDE.md's Phase 1 limitation).
 *      Multiplayer rows are omitted entirely when the Arena catalogue is
 *      unavailable — never a card that would 403.
 *   3. Q&A — plain hairline question rows linking into the real
 *      Methodology route, never a bordered accordion card grid.
 *
 * Server-safe except for the one resume-state child, exactly like Pass 2:
 * every value here is a prop this file's own caller (`app/(main)/page.tsx`)
 * already computed server-side from real fetches — nothing is fabricated,
 * nothing is fetched a second time.
 */

import Link from "next/link";
import PeakV2Shell from "./PeakV2Shell";
import PeakV2CinematicStage from "./PeakV2CinematicStage";
import PeakV2ResultHeadline from "./PeakV2ResultHeadline";
import PeakV2DisplayEmphasis from "./PeakV2DisplayEmphasis";
import PeakV2Rule from "./PeakV2Rule";
import PeakV2DataLane from "./PeakV2DataLane";
import PeakV2PlayerIdentity from "./PeakV2PlayerIdentity";
import PeakV2LiveHeader from "./PeakV2LiveHeader";
import PeakV2GameStatus from "./PeakV2GameStatus";
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

function ModeRow({ mode }: { mode: HomePageV2Mode }) {
  return (
    <Link
      href={mode.href}
      className="flex items-center justify-between gap-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      style={{ borderBottom: "1px solid var(--v2-border-subtle)" }}
    >
      <div>
        <div
          style={{
            fontFamily: "var(--v2-font-ui)",
            fontWeight: 700,
            fontSize: "0.9375rem",
            color: "var(--v2-text-primary)",
          }}
        >
          {mode.title}
        </div>
        <div style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", color: "var(--v2-text-secondary)" }}>
          {mode.description}
        </div>
      </div>
      <span aria-hidden="true" style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", fontWeight: 700, color: "var(--v2-color-accent)" }}>
        →
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

  return (
    <PeakV2Shell width="live">
      {/* ---- 1. CINEMATIC HERO — two columns at desktop, one on mobile ---- */}
      <PeakV2CinematicStage light={{ y: "-10%" }} align="start">
        <div className="grid w-full grid-cols-1 gap-10 text-left lg:grid-cols-[1.15fr_1fr] lg:items-center">
          <div>
            <p
              style={{
                fontFamily: "var(--v2-font-ui)",
                fontSize: "0.75rem",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--v2-color-accent)",
                margin: 0,
              }}
            >
              PEAK3 Arena
            </p>
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
            <div className="lg:pl-8 lg:border-l" style={{ borderColor: "var(--v2-border-subtle)" }}>
              <div className="flex items-baseline justify-between gap-3">
                <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.04em", color: "var(--v2-text-muted)" }}>
                  Rank {topWindow.rank} · 3-Year Window
                </span>
                {topWindow.primeScore !== null ? (
                  <span style={{ fontFamily: "var(--v2-font-mono)", fontSize: "1.25rem", fontWeight: 700, color: "var(--v2-color-accent)" }}>
                    {topWindow.primeScore.toFixed(1)}
                  </span>
                ) : null}
              </div>
              <div className="mt-1">
                <PeakV2PlayerIdentity
                  name={topWindow.playerName}
                  meta={topWindow.team ? `${topWindow.team} · ${topWindow.label}` : topWindow.label}
                  size="lg"
                />
              </div>
              {laneEntries.length > 0 ? (
                <div className="mt-5 flex flex-col gap-3">
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
              <p className="mt-4 text-right">
                <Link
                  href="/rankings"
                  className="inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                  style={{ fontFamily: "var(--v2-font-ui)", fontSize: "0.75rem", fontWeight: 700, color: "var(--v2-text-secondary)" }}
                >
                  {proof.rankedWindows !== null ? `${proof.rankedWindows.toLocaleString()} windows on the board` : "See the full board"} →
                </Link>
              </p>
            </div>
          ) : null}
        </div>
      </PeakV2CinematicStage>

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

      {/* ---- 2. MODE SLATE — hairline rows, obvious CTA hierarchy ---- */}
      <section aria-labelledby="v2-modes-heading">
        <PeakV2LiveHeader title="Choose a game" status={<PeakV2GameStatus label="Live" state="active" />} />
        <div className="mt-3 flex flex-col gap-1">
          <HomeV2ResumeRow mode={runTheTable} />
          {dailyModes.map((mode) => (
            <ModeRow key={mode.href} mode={mode} />
          ))}
          {multiplayerModes.map((mode) => (
            <ModeRow key={mode.href} mode={mode} />
          ))}
        </div>
      </section>

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
