import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Dices, Users, Trophy, BarChart3, Grid3x3, ListOrdered, Swords } from "lucide-react";
import GameCard from "@/components/shared/GameCard";
import { getCourtBuilderReadiness } from "@/lib/perfect-season-api";
import { getTeamColors } from "@/lib/team-colors";

export const metadata: Metadata = {
  title: "PEAK3 Arena — Build a Perfect Season",
  description:
    "Spin a team and era, draft exact NBA player-season cards onto a position-aware court, and chase an 82-0 season. A basketball strategy arcade built on a transparent, open-weight rating formula — with receipts on every pick.",
};

const HOW_IT_WORKS: { icon: typeof Dices; title: string; body: string; team: string }[] = [
  {
    icon: Dices,
    title: "Spin",
    body: "Roll a real team and season. Team and era are independent locks — respin either one without touching the other.",
    team: "Boston Celtics",
  },
  {
    icon: Users,
    title: "Draft",
    body: "Pick from that exact roster — real player-seasons, real constraints — and place each card on a position-aware court. Ratings stay hidden until reveal.",
    team: "Denver Nuggets",
  },
  {
    icon: Trophy,
    title: "Simulate",
    body: "Lock your 5+3 roster and reveal the season. Chase 82-0, see what PEAK3 would have picked each round, then run it back against your own best.",
    team: "Golden State Warriors",
  },
];

/**
 * Phase 8E: homepage rewrite -- the old version led with "Which player had
 * the greater peak?" (Peak Duel, the Phase 1 flagship) and its primary CTA
 * routed to /arena/daily, the legacy Peak Draft hub -- neither reflects
 * what the app actually is now. 82-0 Peak Season / CourtBuilder is the
 * flagship mode; this page leads with it, routes the primary CTA straight
 * to it, and demotes Peak Duel/Peak Draft to clearly-labeled secondary
 * cards rather than removing them (both still work and are intentionally
 * supported). Same fail-closed pattern as /arena/page.tsx: a readiness
 * fetch failure never breaks the page, it just falls back to the /arena
 * hub instead of assuming CourtBuilder is live.
 */
export default async function HomePage() {
  let courtBuilderEnabled = false;
  let coverageLabel: string | null = null;
  try {
    const readiness = await getCourtBuilderReadiness();
    courtBuilderEnabled = readiness.courtbuilder_enabled;
    if (readiness.rollable_team_season_count > 0 && readiness.supported_start_season && readiness.supported_end_season) {
      coverageLabel = `${readiness.rollable_team_season_count.toLocaleString()} rollable team-seasons · ${readiness.supported_start_season} to ${readiness.supported_end_season}`;
    }
  } catch {
    courtBuilderEnabled = false;
  }

  const flagshipHref = courtBuilderEnabled ? "/arena/court/practice/apex_1y" : "/arena";

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative px-4 pt-24 pb-16 text-center home-hero-glow" aria-labelledby="hero-heading">
        <div className="mx-auto max-w-3xl">
          <p className="mb-6 text-xs font-semibold tracking-[0.2em] uppercase" style={{ color: "var(--peak-accent)" }}>
            {courtBuilderEnabled ? "Flagship Mode · 82-0 Peak Season" : "Basketball Strategy Arcade"}
          </p>

          <h1 id="hero-heading" className="font-display text-5xl font-extrabold tracking-tight md:text-7xl">
            Build a legendary roster.
            <br />
            <span style={{ color: "var(--peak-accent)" }}>Chase 82-0.</span>
          </h1>

          <p className="mt-6 text-lg text-[var(--text-secondary)] max-w-xl mx-auto leading-relaxed">
            Spin a real team and era, draft exact NBA player-season cards onto a position-aware
            court, and simulate the year. Every result comes with receipts — the same open
            five-component formula behind every card, plus a round-by-round look at what PEAK3
            itself would have picked.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href={flagshipHref}
              data-testid="home-primary-cta"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--peak-accent)] px-6 py-3 font-semibold text-[var(--text-inverse)] transition-all hover:bg-[var(--peak-accent-dim)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            >
              Build Your Perfect Season
              <ArrowRight size={16} />
            </Link>
            <Link
              href="/rankings"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border-default)] px-6 py-3 font-semibold text-[var(--text-primary)] transition-all hover:bg-[var(--bg-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            >
              Explore the PEAK Index
            </Link>
          </div>

          {coverageLabel && (
            <p className="mt-5 text-xs" style={{ color: "var(--text-muted)" }} data-testid="home-coverage-note">
              {coverageLabel}
            </p>
          )}
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

          {/* Phase 12A: one hierarchy, three tiers, built from the shared
              GameCard so the flagship/daily/browse split is legible at a glance
              instead of being asserted in copy. Exactly one card is `featured`;
              a second gold card would make the word meaningless. */}
          {courtBuilderEnabled && (
            <GameCard
              testId="home-flagship-card"
              href="/arena/court/practice/apex_1y"
              eyebrow="Flagship"
              title="82-0 PEAK Season"
              description="Spin a team and era, draft a position-aware 5+3 roster from exact NBA player-seasons, and chase a perfect season — with a full receipt on every rating and a round-by-round comparison to what PEAK3 itself would have picked."
              icon={<Trophy size={18} />}
              meta={["8 roster slots", "Full-season simulation", "Play any time"]}
              featured
              cta="Play now"
            />
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
              className="text-xs font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              style={{ color: "var(--peak-accent)" }}
            >
              Daily hub →
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <GameCard
              testId="home-daily-grid-card"
              href="/daily/grid"
              eyebrow="New board every day"
              title="Daily Grid Challenge"
              description="Fill a 3x3 board with exact NBA player-seasons — teams, awards, eras, playoff runs. Nine squares, nine different players, same board for everyone."
              icon={<Grid3x3 size={17} />}
              cta="Play today's grid"
            />
            <GameCard
              testId="home-daily-duel-card"
              href="/play/daily"
              eyebrow="New questions every day"
              title="Peak Duel Daily"
              description="Ten head-to-head questions: pick which player's peak PEAK3 rates higher. Real data revealed only after you choose."
              icon={<Swords size={17} />}
              cta="Play today's duel"
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
