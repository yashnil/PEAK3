import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ArrowRight, Grid3x3, Swords, Trophy } from "lucide-react";
import GameCard from "@/components/shared/GameCard";
import {
  MODE_COPY,
  RUN_THE_TABLE_DAILY_HREF,
  RUN_THE_TABLE_RUNS_HREF,
} from "@/lib/modes";
import { getCourtBuilderReadiness } from "@/lib/perfect-season-api";

/**
 * The Arena catalog: every playable PEAK3 mode, in one hierarchy.
 *
 * RUN THE TABLE is the flagship and holds the page's only `featured` card.
 * 82-0 PEAK Season keeps its full entry block directly underneath — the daily
 * CTA, run history and leaderboard all still live here — but styled as a
 * section rather than as the page's gold hero, because two gold heroes is the
 * same as none.
 *
 * WHAT THE UX PASS CHANGED (W2). Nothing was removed: this is still the
 * complete catalog, and every mode, link and testid it carried is still here.
 * What changed is that it is no longer the ONLY launcher — the homepage now
 * starts a run directly — so this page is free to be denser and more explicit:
 * groups carry a one-line description, the secondary links say what they do
 * ("Start a standard run", "Play today's shared run") instead of repeating
 * "Your runs →" twice on one screen, and the surfaces vary by tier rather than
 * repeating one bordered rectangle.
 *
 * Phase 10C history, still true: the legacy 1Y Apex / 3Y Prime / 5Y Foundation
 * draft modes are NOT listed here. They live at /arena/labs, unlinked from the
 * navbar and homepage, and nothing behind them was deleted.
 *
 * The 82-0 section stays behind the same fail-closed readiness check it has
 * always had (ADR-005 Decision 7): a fetch failure is treated as "not enabled"
 * rather than shipping a link into a mode that may not work. RUN THE TABLE is
 * deliberately not gated on that flag — it describes CourtBuilder only.
 */
export const metadata: Metadata = {
  title: "Arena | PEAK3",
  description:
    "Every PEAK3 game mode: RUN THE TABLE, 82-0 PEAK Season, the Daily Grid and Peak Duel Daily.",
};

const SECTION_LABEL_CLASS = "text-[11px] font-bold uppercase tracking-[0.18em]";

function GroupHeading({
  id,
  label,
  description,
  action,
}: {
  id: string;
  label: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <h2 id={id} className={SECTION_LABEL_CLASS} style={{ color: "var(--text-muted)" }}>
          {label}
        </h2>
        {description && (
          <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export default async function ArenaPage() {
  let courtBuilderEnabled = false;
  try {
    const readiness = await getCourtBuilderReadiness();
    courtBuilderEnabled = readiness.courtbuilder_enabled;
  } catch {
    courtBuilderEnabled = false;
  }

  const flagship = MODE_COPY["run-the-table"];
  const dailyGrid = MODE_COPY["daily-grid"];
  const peakDuel = MODE_COPY["peak-duel"];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="font-display text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
        Arena
      </h1>
      <p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--text-secondary)" }}>
        Every PEAK3 mode in one place. All of them are decided by the same open five-component
        formula, and all of them show their work.
      </p>

      {/* Flagship */}
      <section className="mt-8" aria-labelledby="arena-flagship-heading">
        <GroupHeading
          id="arena-flagship-heading"
          label="Flagship"
          description="One branching run, five boss battles, roughly a quarter of an hour."
        />
        <GameCard
          testId="arena-flagship-card"
          href={flagship.href}
          eyebrow={flagship.eyebrow}
          title={flagship.title}
          description={flagship.description}
          icon={<Swords size={18} />}
          meta={flagship.meta}
          featured
          cta={flagship.cta}
        />
        <div className="arena-link-row mt-1">
          <Link
            href="/arena/run-the-table?start=standard"
            data-testid="arena-rtt-start-link"
            className="arena-inline-link"
            style={{ color: "var(--peak-accent-text)" }}
          >
            Start a standard run
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
          <Link
            href={RUN_THE_TABLE_DAILY_HREF}
            data-testid="arena-rtt-daily-link"
            className="arena-inline-link"
            style={{ color: "var(--peak-accent-text)" }}
          >
            Play today&apos;s shared run
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
          <Link
            href={RUN_THE_TABLE_RUNS_HREF}
            data-testid="arena-rtt-runs-link"
            className="arena-inline-link"
            style={{ color: "var(--text-secondary)" }}
          >
            Resume a saved run
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </div>
      </section>

      {/* Full-season modes */}
      <section className="mt-9" aria-labelledby="arena-full-season-heading">
        <GroupHeading
          id="arena-full-season-heading"
          label="Full season"
          description="Spin a real franchise and era, then draft a roster against an 82-game standard."
        />

        {courtBuilderEnabled && (
          <div data-testid="courtbuilder-hero" className="home-band flex flex-col gap-3 p-6">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                style={{
                  background: "var(--pk-surface-raised, var(--bg-surface))",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-secondary)",
                }}
              >
                <Trophy size={17} />
              </span>
              <h3 className="font-display text-xl font-bold" style={{ color: "var(--text-primary)" }}>
                82-0 Peak Season
              </h3>
            </div>
            <p className="max-w-2xl text-sm" style={{ color: "var(--text-secondary)" }}>
              {MODE_COPY["peak-season"].description}
            </p>
            {/* The daily challenge is the return loop, so it keeps equal weight
                beside free play (the same blue used by the daily badge on the
                scorecard and in run history). Free play stays first for a
                visitor who has no reason yet to care about "today's" board. */}
            <div className="flex flex-wrap items-center gap-2.5">
              <Link
                href={MODE_COPY["peak-season"].href}
                className="inline-flex items-center border px-5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                style={{
                  minHeight: "var(--pk-tap-min, 44px)",
                  borderRadius: "var(--pk-r-md, 10px)",
                  background: "var(--pk-surface-raised, var(--bg-surface))",
                  color: "var(--text-primary)",
                  borderColor: "var(--border-default)",
                }}
              >
                Build a Perfect Season
              </Link>
              <Link
                href="/arena/court/daily/apex_1y"
                data-testid="daily-peak-season-cta"
                className="inline-flex items-center border px-5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                style={{
                  minHeight: "var(--pk-tap-min, 44px)",
                  borderRadius: "var(--pk-r-md, 10px)",
                  background: "color-mix(in srgb, var(--accent-blue) 12%, transparent)",
                  color: "var(--accent-blue)",
                  borderColor: "var(--accent-blue)",
                }}
              >
                Play today&apos;s Daily
              </Link>
            </div>
            <div className="arena-link-row">
              <Link
                href="/arena/court/history"
                data-testid="court-history-link"
                className="arena-inline-link"
                style={{ color: "var(--text-secondary)" }}
              >
                Your saved seasons
                <ArrowRight size={13} aria-hidden="true" />
              </Link>
              <Link
                href="/arena/court/leaderboard"
                data-testid="arena-leaderboard-link"
                className="arena-inline-link"
                style={{ color: "var(--text-secondary)" }}
              >
                82-0 Leaderboard
                <ArrowRight size={13} aria-hidden="true" />
              </Link>
            </div>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Everyone gets the same Daily spin sequence each day — save your run to track personal
              bests and come back tomorrow.
            </p>
          </div>
        )}

        {/* Fail-closed state. Say plainly that the mode is behind a flag rather
            than rendering an empty section. */}
        {!courtBuilderEnabled && (
          <div
            data-testid="courtbuilder-unavailable"
            className="home-band flex flex-col gap-3 p-6"
          >
            <h3 className="font-display text-xl font-bold" style={{ color: "var(--text-primary)" }}>
              82-0 PEAK Season
            </h3>
            <p className="max-w-2xl text-sm" style={{ color: "var(--text-secondary)" }}>
              82-0 PEAK Season is not enabled in this environment yet. Nothing is broken — the mode
              is behind a server flag. RUN THE TABLE above and the PEAK3 rankings are fully
              available.
            </p>
            <Link
              href="/rankings"
              className="inline-flex items-center self-start border px-5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              style={{
                minHeight: "var(--pk-tap-min, 44px)",
                borderRadius: "var(--pk-r-md, 10px)",
                background: "var(--pk-surface-raised, var(--bg-surface))",
                color: "var(--text-primary)",
                borderColor: "var(--border-default)",
              }}
            >
              Explore the rankings
            </Link>
          </div>
        )}
      </section>

      {/* Daily games. Rendered unconditionally: unlike 82-0 they sit behind no
          server flag, so this hub stays useful in the fail-closed state above. */}
      <section className="mt-9" aria-labelledby="arena-daily-heading">
        <GroupHeading
          id="arena-daily-heading"
          label="Daily · quick play"
          description="One board a day, identical for everyone, a few minutes each."
          action={
            <Link
              href="/daily"
              data-testid="arena-daily-hub-link"
              className="arena-inline-link"
              style={{ color: "var(--peak-accent-text)" }}
            >
              Daily hub
              <ArrowRight size={13} aria-hidden="true" />
            </Link>
          }
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <GameCard
            testId="arena-daily-grid-card"
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
            testId="arena-daily-duel-card"
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
      </section>

      {/* Competitive — the community board and the model's own board. Both were
          already reachable from the 82-0 block and the navbar; naming the group
          makes the catalog complete rather than adding a new destination. */}
      <section className="mt-9" aria-labelledby="arena-competitive-heading">
        <GroupHeading
          id="arena-competitive-heading"
          label="Competitive"
          description="Measure a roster against other players, or against the model itself."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <GameCard
            testId="arena-rankings-card"
            href="/rankings"
            eyebrow="Rankings"
            title="The PEAK Index"
            description="All-time peak windows and single seasons, with a full component breakdown and row-by-row receipts on every score."
            cta="See the rankings"
            tone="quiet"
            compact
          />
          <GameCard
            testId="arena-methodology-card"
            href="/methodology"
            eyebrow="The model"
            title="Formula Explorer"
            description="The five components, their official weights and exactly how a peak window's score is assembled."
            cta="Read the methodology"
            tone="quiet"
            compact
          />
        </div>
      </section>

      {/* Legacy modes, deliberately demoted to a footnote: discoverable for
          internal use, never presented as part of the product. Not linked from
          the navbar or the homepage. */}
      <p className="mt-8 text-xs" style={{ color: "var(--text-muted)" }}>
        Looking for the old Peak Draft modes?{" "}
        <Link
          href="/arena/labs"
          data-testid="legacy-labs-link"
          className="underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          style={{ color: "var(--text-secondary)" }}
        >
          Legacy Labs
        </Link>
        .
      </p>
    </div>
  );
}
