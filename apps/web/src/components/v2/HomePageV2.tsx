/**
 * HomePageV2 — PEAK3 V2's real, production-data-driven proof point (brief
 * §Design References: "Homepage: editorial hierarchy, dark negative space,
 * one strong data object").
 *
 * Deliberately NOT a section-for-section recreation of the legacy homepage
 * — Pass 2 is the foundation pass, not the full redesign, and the brief's
 * own reference calls for restraint here specifically ("one strong data
 * object," not eight). Every value rendered is a prop computed by
 * `app/(main)/page.tsx`'s existing server-side data loading (same
 * `loadHomeModelData`/`MODE_COPY` calls legacy already makes — nothing is
 * fetched a second time, nothing is fabricated). If a real top-ranked
 * window is unavailable (API unreachable), the hero's data-object slot is
 * simply omitted — a truthful empty state, never a placeholder number.
 *
 * Server-safe: this receives already-resolved data as props and renders
 * no client-only state itself (the `PeakV2CinematicStage` it uses is
 * `"use client"` only for its own reduced-motion entrance, not for
 * anything this component owns).
 */

import Link from "next/link";
import PeakV2Shell from "./PeakV2Shell";
import PeakV2CinematicStage from "./PeakV2CinematicStage";
import PeakV2ResultHeadline from "./PeakV2ResultHeadline";
import PeakV2Rule from "./PeakV2Rule";
import PeakV2Score from "./PeakV2Score";
import PeakV2PlayerIdentity from "./PeakV2PlayerIdentity";
import PeakV2LiveHeader from "./PeakV2LiveHeader";
import PeakV2GameStatus from "./PeakV2GameStatus";
import PeakV2PrimaryAction from "./PeakV2PrimaryAction";
import PeakV2SecondaryAction from "./PeakV2SecondaryAction";
import type { VignetteWindow, HomeModelProof } from "@/components/home/home-data";
import type { V2Tone } from "./v2-tone";

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
  dailyModes: HomePageV2Mode[];
}

export default function HomePageV2({
  topWindow,
  componentWeights,
  proof,
  flagship,
  dailyModes,
}: HomePageV2Props) {
  return (
    <PeakV2Shell width="live">
      <PeakV2CinematicStage light={{ y: "-10%" }}>
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
        <PeakV2ResultHeadline as="h1" scale="hero" className="mt-3">
          Build a roster of peaks.
          <br />
          Run the table.
        </PeakV2ResultHeadline>
        <PeakV2ResultHeadline as="p" scale="line" tone="accent" className="mt-4" style={{ maxWidth: "40ch" }}>
          Every battle decided by five open components. Full receipts, every time.
        </PeakV2ResultHeadline>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <PeakV2PrimaryAction href={flagship.href}>{flagship.title}</PeakV2PrimaryAction>
          <PeakV2SecondaryAction href="/rankings">Explore rankings</PeakV2SecondaryAction>
        </div>

        {topWindow ? (
          <div className="mt-14 flex flex-col items-center gap-2">
            <span
              style={{
                fontFamily: "var(--v2-font-mono)",
                fontSize: "0.6875rem",
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--v2-text-muted)",
              }}
            >
              Rank {topWindow.rank}
            </span>
            <PeakV2PlayerIdentity
              name={topWindow.playerName}
              meta={topWindow.team ? `${topWindow.team} · ${topWindow.label}` : topWindow.label}
              size="lg"
              align="center"
              state="current"
            />
            {topWindow.primeScore !== null ? (
              <PeakV2Score value={topWindow.primeScore.toFixed(1)} label="Prime score" tone="accent" size="lg" />
            ) : null}
          </div>
        ) : null}
      </PeakV2CinematicStage>

      <PeakV2Rule spacing="lg" />

      {componentWeights.length > 0 ? (
        <section aria-labelledby="v2-weights-heading">
          <h2
            id="v2-weights-heading"
            style={{
              fontFamily: "var(--v2-font-ui)",
              fontSize: "0.75rem",
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--v2-text-muted)",
              margin: 0,
            }}
          >
            How a player is rated
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-6 sm:grid-cols-5">
            {componentWeights.map((c) => (
              <PeakV2Score key={c.label} value={c.pct} label={c.label} tone={c.tone} />
            ))}
          </div>
        </section>
      ) : null}

      <PeakV2Rule spacing="lg" />

      <section aria-labelledby="v2-modes-heading">
        <PeakV2LiveHeader
          title="Choose a game"
          status={<PeakV2GameStatus label="Live" state="active" />}
        />
        <div className="mt-3 flex flex-col gap-1">
          {dailyModes.map((mode) => (
            <Link
              key={mode.href}
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
                <div
                  style={{
                    fontFamily: "var(--v2-font-ui)",
                    fontSize: "0.75rem",
                    color: "var(--v2-text-secondary)",
                  }}
                >
                  {mode.description}
                </div>
              </div>
              <span aria-hidden="true" style={{ color: "var(--v2-color-accent)", fontFamily: "var(--v2-font-mono)" }}>
                →
              </span>
            </Link>
          ))}
        </div>
      </section>

      {proof.playersEvaluated !== null && proof.rankedWindows !== null ? (
        <>
          <PeakV2Rule spacing="lg" />
          <p
            style={{
              fontFamily: "var(--v2-font-ui)",
              fontSize: "0.75rem",
              color: "var(--v2-text-secondary)",
              paddingBottom: "var(--v2-space-10)",
            }}
          >
            {proof.playersEvaluated.toLocaleString()} players evaluated ·{" "}
            {proof.rankedWindows.toLocaleString()} ranked peak windows
            {proof.modelLabel ? ` · ${proof.modelLabel}` : ""}
          </p>
        </>
      ) : null}
    </PeakV2Shell>
  );
}
