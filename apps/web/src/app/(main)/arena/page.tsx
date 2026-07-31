import Link from "next/link";
import type { Metadata } from "next";
import { Grid3x3, Swords, Trophy } from "lucide-react";
import GameCard from "@/components/shared/GameCard";
import {
  MODE_COPY,
  RUN_THE_TABLE_DAILY_HREF,
  RUN_THE_TABLE_RUNS_HREF,
} from "@/lib/modes";
import { getCourtBuilderReadiness } from "@/lib/perfect-season-api";

/**
 * The Arena hub: every playable PEAK3 mode, in one hierarchy.
 *
 * RUN THE TABLE is the flagship and holds the page's only `featured` card.
 * 82-0 PEAK Season keeps its full entry block directly underneath — the daily
 * CTA, run history and leaderboard all still live here — but styled as a
 * section rather than as the page's gold hero, because two gold heroes is the
 * same as none.
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
      <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
        Every PEAK3 mode in one place. All of them are decided by the same open five-component
        formula, and all of them show their work.
      </p>

      {/* Flagship */}
      <section className="mt-6" aria-labelledby="arena-flagship-heading">
        <h2 id="arena-flagship-heading" className="sr-only">
          Flagship mode
        </h2>
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
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link
            href={RUN_THE_TABLE_DAILY_HREF}
            data-testid="arena-rtt-daily-link"
            className="inline-flex min-h-11 items-center text-xs font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            style={{ color: "var(--peak-accent)" }}
          >
            Today&apos;s run →
          </Link>
          <Link
            href={RUN_THE_TABLE_RUNS_HREF}
            data-testid="arena-rtt-runs-link"
            className="inline-flex min-h-11 items-center text-xs font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            style={{ color: "var(--text-secondary)" }}
          >
            Your runs →
          </Link>
        </div>
      </section>

      {/* Full-season modes */}
      <section className="mt-8" aria-labelledby="arena-full-season-heading">
        <h2
          id="arena-full-season-heading"
          className={`mb-2 ${SECTION_LABEL_CLASS}`}
          style={{ color: "var(--text-muted)" }}
        >
          Full-season modes
        </h2>

        {courtBuilderEnabled && (
          <div
            data-testid="courtbuilder-hero"
            className="rounded-2xl border p-6 flex flex-col gap-3"
            style={{ background: "var(--bg-elevated)", borderColor: "var(--border-default)" }}
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                style={{
                  background: "var(--bg-surface)",
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
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {MODE_COPY["peak-season"].description}
            </p>
            {/* The daily challenge is the return loop, so it keeps equal weight
                beside free play (the same blue used by the daily badge on the
                scorecard and in run history). Free play stays first for a
                visitor who has no reason yet to care about "today's" board. */}
            <div className="flex flex-wrap items-center gap-2.5">
              <Link
                href={MODE_COPY["peak-season"].href}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                style={{
                  background: "var(--bg-surface)",
                  color: "var(--text-primary)",
                  borderColor: "var(--border-default)",
                }}
              >
                Build a Perfect Season
              </Link>
              <Link
                href="/arena/court/daily/apex_1y"
                data-testid="daily-peak-season-cta"
                className="px-5 py-2.5 rounded-lg text-sm font-semibold border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                style={{ background: "rgba(96,165,250,0.12)", color: "#60a5fa", borderColor: "#60a5fa" }}
              >
                Play today&apos;s Daily
              </Link>
              <Link
                href="/arena/court/history"
                data-testid="court-history-link"
                className="text-xs font-semibold uppercase tracking-wide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                style={{ color: "var(--text-secondary)" }}
              >
                Your runs →
              </Link>
              <Link
                href="/arena/court/leaderboard"
                data-testid="arena-leaderboard-link"
                className="text-xs font-semibold uppercase tracking-wide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                style={{ color: "var(--text-secondary)" }}
              >
                82-0 Leaderboard →
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
            className="rounded-2xl border p-6 flex flex-col gap-3"
            style={{ background: "var(--bg-elevated)", borderColor: "var(--border-default)" }}
          >
            <h3 className="font-display text-xl font-bold" style={{ color: "var(--text-primary)" }}>
              82-0 PEAK Season
            </h3>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              82-0 PEAK Season is not enabled in this environment yet. Nothing is broken — the mode
              is behind a server flag. RUN THE TABLE above and the PEAK3 rankings are fully
              available.
            </p>
            <Link
              href="/rankings"
              className="self-start px-5 py-2.5 rounded-lg text-sm font-semibold border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              style={{
                background: "var(--bg-surface)",
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
      <section className="mt-8" aria-labelledby="arena-daily-heading">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2
            id="arena-daily-heading"
            className={SECTION_LABEL_CLASS}
            style={{ color: "var(--text-muted)" }}
          >
            Daily games
          </h2>
          <Link
            href="/daily"
            data-testid="arena-daily-hub-link"
            className="inline-flex min-h-11 items-center text-xs font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            style={{ color: "var(--peak-accent)" }}
          >
            Daily hub →
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <GameCard
            testId="arena-daily-grid-card"
            href={dailyGrid.href}
            eyebrow={dailyGrid.eyebrow}
            title={dailyGrid.title}
            description={dailyGrid.description}
            icon={<Grid3x3 size={17} />}
            cta={dailyGrid.cta}
          />
          <GameCard
            testId="arena-daily-duel-card"
            href={peakDuel.href}
            eyebrow={peakDuel.eyebrow}
            title={peakDuel.title}
            description={peakDuel.description}
            icon={<Swords size={17} />}
            cta={peakDuel.cta}
          />
        </div>
      </section>

      {/* Legacy modes, deliberately demoted to a footnote: discoverable for
          internal use, never presented as part of the product. Not linked from
          the navbar or the homepage. */}
      <p className="mt-6 text-xs" style={{ color: "var(--text-muted)" }}>
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
