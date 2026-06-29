import Link from "next/link";
import { ArrowRight, BarChart3, BookOpen, Trophy } from "lucide-react";

export default function HomePage() {
  return (
    <div className="court-grid-bg min-h-screen">
      {/* Hero */}
      <section className="relative px-4 pt-24 pb-20 text-center" aria-labelledby="hero-heading">
        <div className="mx-auto max-w-3xl">
          {/* Eyebrow */}
          <p className="mb-6 text-xs font-semibold tracking-[0.2em] uppercase text-[var(--text-muted)]">
            Basketball Analytics Game
          </p>

          {/* Headline */}
          <h1
            id="hero-heading"
            className="font-display text-5xl font-extrabold tracking-tight md:text-7xl"
          >
            Which player had{" "}
            <span className="text-[var(--peak-accent)]">the greater peak?</span>
          </h1>

          {/* Sub-headline */}
          <p className="mt-6 text-lg text-[var(--text-secondary)] max-w-xl mx-auto leading-relaxed">
            PEAK3 measures NBA greatness through a transparent five-component formula.
            Test your knowledge. See the real data. Understand the gap.
          </p>

          {/* CTAs */}
          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/play/daily"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--peak-accent)] px-6 py-3 font-semibold text-[var(--text-inverse)] transition-all hover:bg-[var(--peak-accent-dim)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            >
              Play today&apos;s challenge
              <ArrowRight size={16} />
            </Link>
            <Link
              href="/rankings"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border-default)] px-6 py-3 font-semibold text-[var(--text-primary)] transition-all hover:bg-[var(--bg-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            >
              Explore the rankings
            </Link>
          </div>
        </div>
      </section>

      {/* Duel Preview */}
      <section className="px-4 pb-20" aria-labelledby="preview-heading">
        <div className="mx-auto max-w-3xl">
          <h2 id="preview-heading" className="sr-only">
            Peak Duel preview
          </h2>
          <div className="card-elevated overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                Peak Duel · 3-Year Window
              </span>
              <span className="text-xs font-medium text-amber-400">Photo Finish</span>
            </div>
            <div className="grid grid-cols-2 divide-x divide-[var(--border-subtle)]">
              {/* Left */}
              <div className="p-6 text-center group">
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)] mb-3">
                  Player A
                </p>
                <p className="font-display text-2xl font-bold text-[var(--text-primary)] leading-tight">
                  Michael<br />Jordan
                </p>
                <p className="mt-3 text-sm text-[var(--text-secondary)]">3-year peak</p>
                <p className="text-xs text-[var(--text-muted)]">1988–91</p>
                <div className="mt-5 rounded-lg bg-[var(--bg-page)] px-4 py-3 text-sm text-[var(--text-muted)] italic">
                  Choose this player →
                </div>
              </div>
              {/* Right */}
              <div className="p-6 text-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)] mb-3">
                  Player B
                </p>
                <p className="font-display text-2xl font-bold text-[var(--text-primary)] leading-tight">
                  LeBron<br />James
                </p>
                <p className="mt-3 text-sm text-[var(--text-secondary)]">3-year peak</p>
                <p className="text-xs text-[var(--text-muted)]">2011–14</p>
                <div className="mt-5 rounded-lg bg-[var(--bg-page)] px-4 py-3 text-sm text-[var(--text-muted)] italic">
                  ← Choose this player
                </div>
              </div>
            </div>
            <div className="border-t border-[var(--border-subtle)] px-4 py-3 text-center text-xs text-[var(--text-muted)]">
              No scores shown until you choose. Real data. Real reveal.
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="px-4 pb-24" aria-labelledby="features-heading">
        <div className="mx-auto max-w-5xl">
          <h2
            id="features-heading"
            className="font-display text-2xl font-bold text-center mb-12"
          >
            Three ways to play
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <FeatureCard
              icon={<Trophy size={22} className="text-[var(--peak-accent)]" />}
              title="Daily Challenge"
              description="10 duels. One shot. A new challenge every day. Track your streak and compete against yesterday's score."
              href="/play/daily"
              cta="Play today"
            />
            <FeatureCard
              icon={<BarChart3 size={22} className="text-[var(--comp-si)]" />}
              title="Endless Mode"
              description="Choose your window length — 1, 2, 3, or 5 years. Keep going as long as you like. Push your streak."
              href="/play/endless"
              cta="Start endless"
            />
            <FeatureCard
              icon={<BookOpen size={22} className="text-[var(--comp-rec)]" />}
              title="Rankings + Formula"
              description="Browse all 250 PEAK3 rankings by window length. Understand every component through the interactive explorer."
              href="/rankings"
              cta="See rankings"
            />
          </div>
        </div>
      </section>

      {/* Methodology credibility */}
      <section className="border-t border-[var(--border-subtle)] px-4 py-16" aria-labelledby="method-heading">
        <div className="mx-auto max-w-3xl text-center">
          <h2
            id="method-heading"
            className="font-display text-xl font-bold mb-4"
          >
            Transparent formula. Open data.
          </h2>
          <p className="text-[var(--text-secondary)] text-sm leading-relaxed max-w-xl mx-auto">
            Every ranking is produced by a five-component, open-weight formula applied to
            Basketball Reference statistics from 1979–80 to present.
            No black boxes. No name recognition bias. No hand-picked results.
          </p>
          <div className="mt-8 grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: "Statistical Impact", pct: "38%", color: "var(--comp-si)" },
              { label: "Traditional Production", pct: "21%", color: "var(--comp-tp)" },
              { label: "Individual Recognition", pct: "20%", color: "var(--comp-rec)" },
              { label: "Postseason Value", pct: "18%", color: "var(--comp-po)" },
              { label: "Team Achievement", pct: "3%", color: "var(--comp-team)" },
            ].map((c) => (
              <div
                key={c.label}
                className="card-surface p-3 text-center"
                style={{ borderTopColor: c.color, borderTopWidth: "2px" }}
              >
                <p
                  className="text-xl font-bold score-number"
                  style={{ color: c.color }}
                >
                  {c.pct}
                </p>
                <p className="mt-1 text-[10px] text-[var(--text-muted)] leading-tight">
                  {c.label}
                </p>
              </div>
            ))}
          </div>
          <Link
            href="/methodology"
            className="mt-8 inline-flex items-center gap-2 text-sm text-[var(--peak-accent)] hover:underline"
          >
            Explore the full methodology
            <ArrowRight size={14} />
          </Link>
        </div>
      </section>
    </div>
  );
}

function FeatureCard({
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
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed flex-1">
        {description}
      </p>
      <Link
        href={href}
        className="mt-6 text-sm font-medium text-[var(--peak-accent)] hover:underline inline-flex items-center gap-1"
      >
        {cta} <ArrowRight size={13} />
      </Link>
    </div>
  );
}
