import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  BarChart3,
  GitBranch,
  Grid3x3,
  ListOrdered,
  Swords,
  Trophy,
  Users,
} from "lucide-react";
import GameCard from "@/components/shared/GameCard";
import HeroLauncher from "@/components/home/HeroLauncher";
import HeroVignette from "@/components/home/HeroVignette";
import ModelProofStrip from "@/components/home/ModelProofStrip";
import { loadHomeModelData } from "@/components/home/home-data";
import { MODE_COPY } from "@/lib/modes";
import { getCourtBuilderReadiness } from "@/lib/perfect-season-api";

export const metadata: Metadata = {
  title: "PEAK3 Arena — Run the Table",
  description:
    "Draft exact NBA peak windows across a branching run, spend scarce credits, and beat three escalating statistical lineups. A basketball strategy game built on a transparent, open-weight rating formula — with receipts on every result.",
};

const HOW_IT_WORKS: { icon: typeof Users; title: string; body: string }[] = [
  {
    icon: Users,
    title: "Draft",
    body: "Every card is one exact 3-year peak window, priced by the engine. A fixed credit budget means you cannot buy the board.",
  },
  {
    icon: GitBranch,
    title: "Branch",
    body: "Each act is a map, not a queue. Draft rooms, trade desks, film rooms and rest banks — you never get to take them all.",
  },
  {
    icon: Swords,
    title: "Battle",
    body: "Each act ends against a boss lineup. Five lanes, one point each, and the receipt shows every number that decided it.",
  },
];

/** The five official component weights, the same numbers the model uses. */
const COMPONENT_WEIGHTS: { label: string; pct: string; color: string }[] = [
  { label: "Statistical Impact", pct: "38%", color: "var(--comp-si)" },
  { label: "Traditional Production", pct: "21%", color: "var(--comp-tp)" },
  { label: "Individual Recognition", pct: "20%", color: "var(--comp-rec)" },
  { label: "Playoff Rate Impact", pct: "18%", color: "var(--comp-po)" },
  { label: "Team Result", pct: "3%", color: "var(--comp-team)" },
];

const GROUP_LABEL_CLASS = "text-[11px] font-bold uppercase tracking-[0.18em]";

/**
 * The homepage leads with RUN THE TABLE, the flagship mode.
 *
 * WHAT THE UX PASS CHANGED (W2, plan §5.1 and brief §6).
 *
 * 1. The first viewport is ACTION, the second is PROOF. The headline lost
 *    roughly half its type size — it is still the same sentence, word for word,
 *    because it is a frozen invariant, but it no longer occupies a screen on
 *    its own. The space it gave back went to `HeroVignette`, which shows real
 *    top-ranked peak windows with their real component contributions: the hero
 *    is now a piece of the game rather than a poster about it.
 *
 * 2. `home-primary-cta` is a menu button, not a link. It used to say "Start a
 *    Run" and land on a page whose first control also said "Start a run". See
 *    `HeroLauncher` for why the second gate could not simply be deleted.
 *
 * 3. The mode cards are grouped (flagship / daily / full season / competitive)
 *    instead of listed, and the groups use different surface tiers so the page
 *    is not one dark rectangle repeated eight times.
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
 *
 * Still a server component: the only client JS this page adds is the launcher
 * island and the vignette's rotation, both small, both hydrating over markup
 * that was already rendered on the server.
 */
export default async function HomePage() {
  const [readinessResult, modelData] = await Promise.all([
    getCourtBuilderReadiness().then(
      (r) => r.courtbuilder_enabled,
      () => false,
    ),
    loadHomeModelData(),
  ]);
  const courtBuilderEnabled = readinessResult;

  const flagship = MODE_COPY["run-the-table"];
  const peakSeason = MODE_COPY["peak-season"];
  const dailyGrid = MODE_COPY["daily-grid"];
  const peakDuel = MODE_COPY["peak-duel"];

  return (
    <div className="min-h-screen">
      {/* ---------------------------------------------------------------
          1. Hero — one promise, one headline, one primary action, and a
          live piece of the actual game.
          --------------------------------------------------------------- */}
      <section
        className="home-hero home-hero-glow px-4 pt-14 pb-12 sm:pt-20"
        aria-labelledby="hero-heading"
      >
        {/* When the API is unreachable the vignette renders nothing, so the
            hero collapses to one column rather than leaving a dead half. */}
        <div
          className="home-hero-grid mx-auto max-w-6xl"
          data-vignette={modelData.windows.length > 0 ? "true" : "false"}
        >
          <div className="min-w-0">
            <p
              className="text-[11px] font-semibold uppercase tracking-[0.2em]"
              style={{ color: "var(--peak-accent)" }}
            >
              Flagship mode · Run the Table
            </p>
            <span className="home-eyebrow-rule" aria-hidden="true" />

            <p className="mt-5 text-sm leading-relaxed sm:text-base" style={{ color: "var(--text-secondary)" }}>
              PEAK3 rates every NBA peak window since 1979-80 on five open components. This is
              the game you play against it.
            </p>

            <h1
              id="hero-heading"
              className="home-hero-h1 font-display mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl"
            >
              Build a roster of peaks.
              <br />
              <span style={{ color: "var(--peak-accent)" }}>Run the table.</span>
            </h1>

            <p className="mt-4 max-w-xl text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              Draft exact 3-year peak windows across a branching run, spend scarce credits, and
              beat three escalating lineups — every battle decided by the five components, with a
              full receipt.
            </p>

            <HeroLauncher className="mt-7">
              <Link
                href="/rankings"
                className="inline-flex items-center justify-center gap-2 border px-5 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                style={{
                  minHeight: "var(--pk-tap-min, 44px)",
                  borderRadius: "var(--pk-r-md, 10px)",
                  borderColor: "var(--border-default)",
                  color: "var(--text-primary)",
                  background: "var(--pk-surface-inset, var(--bg-elevated))",
                }}
              >
                Explore Rankings
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </HeroLauncher>
          </div>

          <HeroVignette windows={modelData.windows} />
        </div>
      </section>

      {/* ---------------------------------------------------------------
          2. The launcher — every mode, grouped, in one compact block.
          --------------------------------------------------------------- */}
      <section className="px-4 pb-14" aria-labelledby="modes-heading">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="modes-heading" className="font-display text-xl font-bold">
              Choose a game
            </h2>
            <Link
              href="/arena"
              data-testid="home-catalog-link"
              className="arena-inline-link"
              style={{ color: "var(--text-secondary)" }}
            >
              Browse the full catalog
              <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </div>

          {/* Flagship */}
          <h3 className={`mt-5 mb-2 ${GROUP_LABEL_CLASS}`} style={{ color: "var(--text-muted)" }}>
            Flagship
          </h3>
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

          {/* Daily — the quick-play tier: one board a day, same for everyone. */}
          <div className="mt-8 mb-2 flex items-baseline justify-between gap-3">
            <h3 className={GROUP_LABEL_CLASS} style={{ color: "var(--text-muted)" }}>
              Daily · quick play
            </h3>
            <Link
              href="/daily"
              data-testid="home-daily-hub-link"
              className="arena-inline-link"
              style={{ color: "var(--peak-accent)" }}
            >
              Daily hub
              <ArrowRight size={13} aria-hidden="true" />
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
              tone="raised"
              compact
            />
            <GameCard
              testId="home-daily-duel-card"
              href={peakDuel.href}
              eyebrow={peakDuel.eyebrow}
              title={peakDuel.title}
              description={peakDuel.description}
              icon={<Swords size={17} />}
              cta={peakDuel.cta}
              tone="raised"
              compact
            />
          </div>

          {/* Full season. Fail-closed: no readiness, no card. */}
          {courtBuilderEnabled && (
            <>
              <h3
                className={`mt-8 mb-2 ${GROUP_LABEL_CLASS}`}
                style={{ color: "var(--text-muted)" }}
              >
                Full season
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
                compact
              />
            </>
          )}

          {/* Competitive — measure yourself against other players, or against
              the model's own board. */}
          <h3 className={`mt-8 mb-2 ${GROUP_LABEL_CLASS}`} style={{ color: "var(--text-muted)" }}>
            Competitive
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <GameCard
              testId="home-leaderboard-card"
              href="/arena/court/leaderboard"
              eyebrow="Community"
              title="82-0 Leaderboard"
              description="The best submitted 82-0 PEAK Season runs — measure your roster against them."
              icon={<ListOrdered size={17} />}
              cta="View leaderboard"
              tone="quiet"
              compact
            />
            <GameCard
              testId="home-rankings-card"
              href="/rankings"
              eyebrow="Rankings"
              title="The PEAK Index"
              description="All-time peak windows and single seasons, with a full component breakdown and row-by-row receipts on every score."
              icon={<BarChart3 size={17} />}
              cta="See the rankings"
              tone="quiet"
              compact
            />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------
          3. Proof — the live model, its coverage, its size, its method.
          Rendered only from real API provenance; see ModelProofStrip.
          --------------------------------------------------------------- */}
      <ModelProofStrip proof={modelData.proof} />

      {/* ---------------------------------------------------------------
          4. How a run works, and what actually decides a battle.
          --------------------------------------------------------------- */}
      <section className="px-4 py-14" aria-labelledby="how-heading">
        <div className="mx-auto max-w-5xl">
          <h2 id="how-heading" className="font-display text-xl font-bold">
            How a run works
          </h2>

          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
            {HOW_IT_WORKS.map((step, i) => {
              const Icon = step.icon;
              return (
                <div key={step.title} className="home-band p-5">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="home-step-index font-display text-sm font-bold"
                      aria-hidden="true"
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span
                      aria-hidden="true"
                      className="flex h-7 w-7 items-center justify-center rounded-lg"
                      style={{
                        background: "var(--pk-surface-raised, var(--bg-surface))",
                        border: "1px solid var(--border-subtle)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      <Icon size={15} />
                    </span>
                    <h3 className="font-display text-base font-bold">{step.title}</h3>
                  </div>
                  <p className="mt-2.5 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                    {step.body}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="home-band mt-3 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              {/* NOT "what decides a battle".
                  A battle is first to 3 of five EQUALLY weighted lanes
                  (`battle.py`, LANES_TO_WIN) -- Team Result is worth exactly as
                  much as Statistical Impact when a lane is contested. These
                  percentages are the weights PEAK3 uses to build a player's
                  RATING, and in a battle they surface only in `roster_total`,
                  the second tie-breaker. Heading this strip "what decides a
                  battle" put the two systems under one title and contradicted
                  "Five lanes, one point each" 320px above it. */}
              <h3 className={GROUP_LABEL_CLASS} style={{ color: "var(--text-muted)" }}>
                How a player is rated
              </h3>
              <Link
                href="/methodology"
                className="arena-inline-link"
                style={{ color: "var(--peak-accent)" }}
              >
                Explore the full methodology
                <ArrowRight size={13} aria-hidden="true" />
              </Link>
            </div>

            <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {COMPONENT_WEIGHTS.map((c) => (
                <li
                  key={c.label}
                  className="p-3"
                  style={{
                    borderRadius: "var(--pk-r-md, 10px)",
                    background: "var(--pk-surface-inset, var(--bg-elevated))",
                    border: "1px solid var(--border-subtle)",
                    borderTop: `2px solid ${c.color}`,
                  }}
                >
                  <p
                    className="score-number text-lg font-bold"
                    style={{ color: c.color, fontVariantNumeric: "tabular-nums" }}
                  >
                    {c.pct}
                  </p>
                  <p className="mt-1 text-[10px] leading-tight" style={{ color: "var(--text-muted)" }}>
                    {c.label}
                  </p>
                </li>
              ))}
            </ul>

            <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              Every card is rated by this five-component, open-weight formula applied to
              Basketball Reference statistics. No black boxes, no name-recognition bias, no
              hand-picked results.
            </p>
            {/* Says the quiet part out loud. Printing 38/21/20/18/3 next to a
                game about five lanes invites exactly the wrong inference. */}
            <p className="mt-1.5 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
              A battle works differently: the five lanes are worth one point each, so Team
              Result decides a lane just as often as Statistical Impact. First to three wins.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
