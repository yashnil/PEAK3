import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Dices, Users, Trophy, BarChart3, ListOrdered, Swords } from "lucide-react";
import { getCourtBuilderReadiness } from "@/lib/perfect-season-api";
import { getTeamColors } from "@/lib/team-colors";

export const metadata: Metadata = {
  title: "PEAK3 Arena — Build a Perfect Season",
  description:
    "Spin a team and era, draft real NBA peak seasons onto a position-aware court, and chase an 82-0 season. A basketball strategy arcade built on a transparent, open-weight rating formula.",
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
    body: "Pick from that exact roster and place each card on a position-aware court. Exact ratings stay hidden until reveal.",
    team: "Denver Nuggets",
  },
  {
    icon: Trophy,
    title: "Simulate",
    body: "Lock your 5+3 roster and reveal the season. Chase 82-0, then run it back against your own best.",
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
            Spin a team and era, draft real NBA peak seasons onto a position-aware court, and simulate
            the season. PEAK3 rates every card with a transparent five-component formula — no
            hand-picked winners, no fabricated data.
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

          {courtBuilderEnabled && (
            <Link
              href="/arena/court/practice/apex_1y"
              data-testid="home-flagship-card"
              className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-2xl border p-6 transition-all hover:opacity-95"
              style={{ background: "var(--bg-elevated)", borderColor: "var(--peak-accent, #f5c842)" }}
            >
              <div>
                <span
                  className="text-[10px] uppercase tracking-wide rounded px-2 py-0.5"
                  style={{ background: "var(--bg-surface)", color: "var(--peak-accent, #f5c842)", border: "1px solid var(--peak-accent, #f5c842)" }}
                >
                  Flagship
                </span>
                <h3 className="mt-2 font-display text-xl font-bold" style={{ color: "var(--text-primary)" }}>
                  82-0 Peak Season
                </h3>
                <p className="mt-1 text-sm max-w-xl" style={{ color: "var(--text-secondary)" }}>
                  Spin a team and era, draft a position-aware 5+3 roster from exact NBA peak windows,
                  and chase a perfect season against your own best run.
                </p>
              </div>
              <span
                className="inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold shrink-0"
                style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
              >
                Play now <ArrowRight size={14} />
              </span>
            </Link>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <ModeCard
              icon={<Swords size={22} style={{ color: "var(--comp-rec)" }} />}
              title="Daily Peak Duel"
              description="10 head-to-head duels. One shot a day. Real data revealed only after you choose."
              href="/play/daily"
              cta="Play today's duel"
            />
            <ModeCard
              icon={<BarChart3 size={22} style={{ color: "var(--comp-si)" }} />}
              title="PEAK Index"
              description="Browse all-time rankings by window length and understand every scoring component."
              href="/rankings"
              cta="See the rankings"
            />
            <ModeCard
              icon={<ListOrdered size={22} style={{ color: "var(--comp-team)" }} />}
              title="Leaderboard"
              description="See the best submitted 82-0 Peak Season runs and measure your roster against them."
              href="/arena/court/leaderboard"
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
              { label: "Postseason Value", pct: "18%", color: "var(--comp-po)" },
              { label: "Team Achievement", pct: "3%", color: "var(--comp-team)" },
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

function ModeCard({
  icon,
  title,
  description,
  href,
  cta,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="card-elevated p-6 flex flex-col">
      <div className="mb-4">{icon}</div>
      <h3 className="font-display text-lg font-bold mb-2">{title}</h3>
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed flex-1">{description}</p>
      <Link href={href} className="mt-6 text-sm font-medium text-[var(--peak-accent)] underline inline-flex items-center gap-1">
        {cta} <ArrowRight size={13} />
      </Link>
    </div>
  );
}
