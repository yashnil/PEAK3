import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Users, GitBranch, Swords, Trophy, BarChart3, Grid3x3, ListOrdered } from "lucide-react";
import GameCard from "@/components/shared/GameCard";
import { MODE_COPY } from "@/lib/modes";
import { getCourtBuilderReadiness } from "@/lib/perfect-season-api";
import { getTeamColors } from "@/lib/team-colors";

export const metadata: Metadata = {
  title: "PEAK3 Arena — Run the Table",
  description:
    "Draft exact NBA peak windows across a branching run, spend scarce credits, and beat three escalating statistical lineups. A basketball strategy game built on a transparent, open-weight rating formula — with receipts on every result.",
};

const HOW_IT_WORKS: { icon: typeof Users; title: string; body: string; team: string }[] = [
  {
    icon: Users,
    title: "Draft",
    body: "Every card is one exact 3-year peak window, priced by the engine. A fixed credit budget means you cannot buy the board — and only the Trade Desk gives credits back.",
    team: "Boston Celtics",
  },
  {
    icon: GitBranch,
    title: "Branch",
    body: "Each act is a map, not a queue. Draft rooms, trade desks, film rooms and rest banks — you pick a path through them and never get to take them all.",
    team: "Denver Nuggets",
  },
  {
    icon: Swords,
    title: "Battle",
    body: "Each act ends against a boss lineup. Five lanes, one point each — statistical impact, production, recognition, playoff rate, team result — and the receipt shows every number that decided it.",
    team: "Golden State Warriors",
  },
];

/**
 * The homepage leads with RUN THE TABLE, the flagship mode.
 *
 * History, because the lead has moved: Peak Duel (Phase 1), then 82-0 PEAK
 * Season (Phase 8E), now RUN THE TABLE. Each time, the previous flagship was
 * demoted to a clearly-labeled secondary card rather than removed — every one
 * of those modes still works and is still supported, and this page still links
 * to all of them.
 *
 * Exactly one card on this page is `featured`. A second gold card would make
 * the word meaningless, which is the whole reason the hierarchy is expressed in
 * the card component rather than in copy.
 *
 * The 82-0 card stays behind the same fail-closed readiness check it has always
 * had: a fetch failure (API down) means the card is not rendered, never a link
 * to a mode that may not work. RUN THE TABLE is not gated on it — that flag
 * describes CourtBuilder only.
 */
export default async function HomePage() {
  let courtBuilderEnabled = false;
  try {
    const readiness = await getCourtBuilderReadiness();
    courtBuilderEnabled = readiness.courtbuilder_enabled;
  } catch {
    courtBuilderEnabled = false;
  }

  const flagship = MODE_COPY["run-the-table"];
  const peakSeason = MODE_COPY["peak-season"];
  const dailyGrid = MODE_COPY["daily-grid"];
  const peakDuel = MODE_COPY["peak-duel"];

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative px-4 pt-24 pb-16 text-center home-hero-glow" aria-labelledby="hero-heading">
        <div className="mx-auto max-w-3xl">
          <p className="mb-6 text-xs font-semibold tracking-[0.2em] uppercase" style={{ color: "var(--peak-accent)" }}>
            Flagship Mode · Run the Table
          </p>

          <h1 id="hero-heading" className="font-display text-5xl font-extrabold tracking-tight md:text-7xl">
            Build a roster of peaks.
            <br />
            <span style={{ color: "var(--peak-accent)" }}>Run the table.</span>
          </h1>

          <p className="mt-6 text-lg text-[var(--text-secondary)] max-w-xl mx-auto leading-relaxed">
            Draft exact NBA 3-year peak windows across a branching run, spend scarce credits, and
            beat three escalating statistical lineups — every battle decided by the five open PEAK3
            components, with a full receipt.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href={flagship.href}
              data-testid="home-primary-cta"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--peak-accent)] px-6 py-3 font-semibold text-[var(--text-inverse)] transition-all hover:bg-[var(--peak-accent-dim)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            >
              Start a Run
              <ArrowRight size={16} />
            </Link>
            <Link
              href="/rankings"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border-default)] px-6 py-3 font-semibold text-[var(--text-primary)] transition-all hover:bg-[var(--bg-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            >
              Explore the PEAK Index
            </Link>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-4 pb-20" aria-labelledby="how-heading">
        <div className="mx-auto max-w-5xl">
          <h2 id="how-heading" className="font-display text-2xl font-bold text-center mb-10">
            How a run works
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {HOW_IT_WORKS.map((step, i) => {
              const Icon = step.icon;
              const colors = getTeamColors(step.team);
              return (
                <div key={step.title} className="card-elevated p-6 flex flex-col items-center text-center gap-3">
                  <div
                    aria-hidden="true"
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: "999px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: `radial-gradient(circle at 32% 28%, color-mix(in srgb, ${colors.primary} 55%, white 12%) 0%, color-mix(in srgb, ${colors.primary} 38%, var(--bg-surface)) 100%)`,
                      boxShadow: `0 0 0 3px color-mix(in srgb, ${colors.primary} 25%, transparent)`,
                    }}
                  >
                    <Icon size={24} color="#fff" strokeWidth={2.25} />
                  </div>
                  <div className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                    Step {i + 1}
                  </div>
                  <h3 className="font-display text-lg font-bold">{step.title}</h3>
                  <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{step.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Ways to play */}
      <section className="px-4 pb-20" aria-labelledby="modes-heading">
        <div className="mx-auto max-w-5xl">
          <h2 id="modes-heading" className="font-display text-2xl font-bold text-center mb-8">
            Ways to play
          </h2>

          <GameCard
            testId="home-flagship-card"
            href={flagship.href}
            eyebrow={flagship.eyebrow}
            title={flagship.title}
            description={flagship.description}
            icon={<Swords size={18} />}
            meta={flagship.meta}
            featured
            cta={flagship.cta}
          />

          {/* Every earlier mode stays on this page. Demoted, never hidden. */}
          {courtBuilderEnabled && (
            <>
              <h3
                className="mt-8 mb-2 text-[11px] font-bold uppercase tracking-[0.18em]"
                style={{ color: "var(--text-muted)" }}
              >
                Full-season mode
              </h3>
              <GameCard
                testId="home-peak-season-card"
                href={peakSeason.href}
                eyebrow={peakSeason.eyebrow}
                title={peakSeason.title}
                description={peakSeason.description}
                icon={<Trophy size={17} />}
                meta={peakSeason.meta}
                cta={peakSeason.cta}
              />
            </>
          )}

          <div className="mt-8 mb-2 flex items-baseline justify-between gap-3">
            <h3
              className="text-[11px] font-bold uppercase tracking-[0.18em]"
              style={{ color: "var(--text-muted)" }}
            >
              Daily games
            </h3>
            <Link
              href="/daily"
              data-testid="home-daily-hub-link"
              className="inline-flex min-h-11 items-center text-xs font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              style={{ color: "var(--peak-accent)" }}
            >
              Daily hub →
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <GameCard
              testId="home-daily-grid-card"
              href={dailyGrid.href}
              eyebrow={dailyGrid.eyebrow}
              title={dailyGrid.title}
              description={dailyGrid.description}
              icon={<Grid3x3 size={17} />}
              cta={dailyGrid.cta}
            />
            <GameCard
              testId="home-daily-duel-card"
              href={peakDuel.href}
              eyebrow={peakDuel.eyebrow}
              title={peakDuel.title}
              description={peakDuel.description}
              icon={<Swords size={17} />}
              cta={peakDuel.cta}
            />
          </div>

          <h3
            className="mt-8 mb-2 text-[11px] font-bold uppercase tracking-[0.18em]"
            style={{ color: "var(--text-muted)" }}
          >
            Browse the model
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <GameCard
              testId="home-rankings-card"
              href="/rankings"
              eyebrow="Rankings"
              title="The PEAK Index"
              description="All-time peak windows and single seasons, with a full component breakdown and row-by-row receipts on every score."
              icon={<BarChart3 size={17} />}
              cta="See the rankings"
            />
            <GameCard
              testId="home-leaderboard-card"
              href="/arena/court/leaderboard"
              eyebrow="Community"
              title="82-0 Leaderboard"
              description="The best submitted 82-0 PEAK Season runs — measure your roster against them."
              icon={<ListOrdered size={17} />}
              cta="View leaderboard"
            />
          </div>
        </div>
      </section>

      {/* Methodology credibility */}
      <section className="border-t border-[var(--border-subtle)] px-4 py-16" aria-labelledby="method-heading">
        <div className="mx-auto max-w-3xl text-center">
          <h2 id="method-heading" className="font-display text-xl font-bold mb-4">
            Transparent formula. Open data.
          </h2>
          <p className="text-[var(--text-secondary)] text-sm leading-relaxed max-w-xl mx-auto">
            Every card is rated by a five-component, open-weight formula applied to Basketball
            Reference statistics from 1979–80 to present. No black boxes. No name recognition bias.
            No hand-picked results.
          </p>
          <div className="mt-8 grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: "Statistical Impact", pct: "38%", color: "var(--comp-si)" },
              { label: "Traditional Production", pct: "21%", color: "var(--comp-tp)" },
              { label: "Individual Recognition", pct: "20%", color: "var(--comp-rec)" },
              { label: "Playoff Rate Impact", pct: "18%", color: "var(--comp-po)" },
              { label: "Team Result", pct: "3%", color: "var(--comp-team)" },
            ].map((c) => (
              <div key={c.label} className="card-surface p-3 text-center" style={{ borderTopColor: c.color, borderTopWidth: "2px" }}>
                <p className="text-xl font-bold score-number" style={{ color: c.color }}>
                  {c.pct}
                </p>
                <p className="mt-1 text-[10px] text-[var(--text-muted)] leading-tight">{c.label}</p>
              </div>
            ))}
          </div>
          <Link href="/methodology" className="mt-8 inline-flex items-center gap-2 text-sm text-[var(--peak-accent)] underline">
            Explore the full methodology
            <ArrowRight size={14} />
          </Link>
        </div>
      </section>
    </div>
  );
}
