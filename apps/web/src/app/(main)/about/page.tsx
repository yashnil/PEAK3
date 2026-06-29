import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About",
};

export default function AboutPage() {
  return (
    <div className="min-h-screen px-4 py-12">
      <div className="mx-auto max-w-2xl space-y-10">
        <div>
          <h1 className="font-display text-3xl font-bold">About PEAK3 Arena</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            An open basketball analytics project.
          </p>
        </div>

        <Section title="What PEAK3 measures">
          <p>
            PEAK3 measures the quality of an NBA player&apos;s consecutive peak seasons —
            their best 1-, 2-, 3-, or 5-year window — using a transparent, open-weight
            formula applied to Basketball Reference statistics from 1979–80 through the
            present season.
          </p>
          <p className="mt-3">
            The formula weighs five components: Statistical Impact (38%), Traditional
            Production (21%), Individual Recognition (20%), Postseason Individual Value
            (18%), and Team Achievement (3%). A small teammate adjustment (±0.5) accounts
            for surrounding talent.
          </p>
        </Section>

        <Section title="What PEAK3 does not claim">
          <p>
            PEAK3 does not claim to determine who the &ldquo;greatest NBA player of all
            time&rdquo; is in any absolute sense. The formula is one transparent
            analytical lens, not an objective truth. Different weightings produce different
            rankings. Pre-1979 players are excluded because consistent advanced metrics are
            unavailable. The model is open for scrutiny and criticism.
          </p>
        </Section>

        <Section title="Data provenance">
          <p>
            All statistics are sourced from{" "}
            <strong className="text-[var(--text-primary)]">Basketball Reference</strong>.
            Data is cached locally and processed deterministically. No real-time scraping
            occurs during a game session. The current dataset covers the 1979–80 through
            2025–26 seasons. Advanced metrics (EPM, LEBRON, RAPTOR) are incorporated where
            available and do not penalize players from eras when they were unavailable.
          </p>
        </Section>

        <Section title="Model transparency">
          <p>
            The complete scoring formula, weights, calibration logic, and test suite are
            published in the open repository. Rankings are produced by deterministic Python
            code. No hand-picking, no LLM interpretation of statistics, and no exceptions
            for specific named players.
          </p>
          <p className="mt-3">
            <Link href="/methodology" className="text-[var(--peak-accent)] hover:underline">
              Read the methodology →
            </Link>
          </p>
        </Section>

        <Section title="Product status">
          <p>
            PEAK3 Arena is in early development (Phase 1). It supports guest play with
            local score persistence. Future phases will add user accounts, global
            leaderboards, and friend comparisons.
          </p>
          <p className="mt-3 text-xs text-[var(--text-muted)]">
            Local scores are stored in your browser and are not verifiable for a global
            leaderboard. This is an intentional design limitation of the current phase.
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-display text-xl font-bold mb-3">{title}</h2>
      <div className="text-sm text-[var(--text-secondary)] leading-relaxed">{children}</div>
    </section>
  );
}
