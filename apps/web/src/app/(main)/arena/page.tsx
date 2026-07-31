import Link from "next/link";
import type { Metadata } from "next";
import { Grid3x3, Swords } from "lucide-react";
import GameCard from "@/components/shared/GameCard";
import { getCourtBuilderReadiness } from "@/lib/perfect-season-api";

/**
 * The Arena hub -- now exclusively the flagship 82-0 PEAK Season landing page.
 *
 * Phase 10C: this page used to render the 82-0 hero AND, directly underneath it,
 * the legacy "Peak Draft (Legacy / Labs)" section with 1Y Apex / 3Y Prime / 5Y
 * Foundation mode cards plus a Ranked closed-alpha card. Because both the navbar
 * "Play" link and the homepage "Build Your Perfect Season" CTA landed here, the
 * main product path always showed the old 5-player draft as a co-equal option --
 * which is the routing bug this phase fixes.
 *
 * Those modes now live at /arena/labs ("Legacy Labs"), unlinked from the navbar
 * and homepage. Nothing behind them was deleted: the routes, state machine and
 * ranked queues are all still live and still covered by
 * src/tests/e2e/gameplay.spec.ts, which navigates to them directly.
 *
 * Unrelated and untouched: the 1Y/3Y/5Y window selector on Rankings -> Peak
 * Windows. That is an analytics feature, not a game mode.
 */
export const metadata: Metadata = {
  title: "82-0 PEAK Season | PEAK3 Arena",
  description:
    "Spin a real NBA team-season, draft exact player-season cards, place them on the court, and chase 82-0 with receipts.",
};

export default async function ArenaPage() {
  // CourtBuilder (Phase 5C prototype) is only presented as the flagship
  // when the server reports it enabled -- never assumed available
  // (ADR-005 Decision 7; PHASE_5_COURTBUILDER_VERTICAL_SLICE.md Sec 6
  // rollout boundaries). A fetch failure (e.g. API down) is treated as
  // "not enabled" -- fail closed, never show a link to a mode that may
  // not work.
  let courtBuilderEnabled = false;
  try {
    const readiness = await getCourtBuilderReadiness();
    courtBuilderEnabled = readiness.courtbuilder_enabled;
  } catch {
    courtBuilderEnabled = false;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      {courtBuilderEnabled && (
        <div
          data-testid="courtbuilder-hero"
          className="mb-8 rounded-2xl border p-6 flex flex-col gap-3"
          style={{ background: "var(--bg-elevated)", borderColor: "var(--peak-accent, #f5c842)" }}
        >
          <div className="flex items-center gap-2">
            <span
              className="text-[10px] uppercase tracking-wide rounded px-2 py-0.5"
              style={{ background: "var(--bg-surface)", color: "var(--peak-accent, #f5c842)", border: "1px solid var(--peak-accent, #f5c842)" }}
            >
              Flagship prototype
            </span>
          </div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
            82-0 Peak Season
          </h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Spin a team and era, build a position-aware 5+3 roster from
            exact NBA player-seasons, and chase a perfect season. Ratings
            stay hidden until the final reveal, then you get a full receipt
            — including what PEAK3 itself would have picked each round.
          </p>
          {/* Phase 9A: the daily challenge is the return loop -- given equal
              visual weight beside free play (a distinct blue accent, matching
              the daily badge used on the scorecard and in run history), not
              buried as a secondary link. Free play stays the primary CTA for
              a first-time visitor who hasn't got a reason to care about
              "today's" board yet. */}
          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              href="/arena/court/practice/apex_1y"
              className="px-5 py-2.5 rounded-lg text-sm font-semibold"
              style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
            >
              Build a Perfect Season
            </Link>
            <Link
              href="/arena/court/daily/apex_1y"
              data-testid="daily-peak-season-cta"
              className="px-5 py-2.5 rounded-lg text-sm font-semibold border"
              style={{ background: "rgba(96,165,250,0.12)", color: "#60a5fa", borderColor: "#60a5fa" }}
            >
              Play today&apos;s Daily
            </Link>
            <Link
              href="/arena/court/history"
              data-testid="court-history-link"
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--text-secondary)" }}
            >
              Your runs →
            </Link>
          </div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Everyone gets the same Daily spin sequence each day — save your run to track personal
            bests and come back tomorrow.
          </p>
        </div>
      )}

      {/* Fail-closed state. Before Phase 10C this page always had the legacy
          mode cards to fall back on, so a disabled flagship still rendered
          something. Now that they are gone, say so plainly rather than
          rendering an almost-empty page. */}
      {!courtBuilderEnabled && (
        <div
          data-testid="courtbuilder-unavailable"
          className="mb-8 rounded-2xl border p-6 flex flex-col gap-3"
          style={{ background: "var(--bg-elevated)", borderColor: "var(--border-default)" }}
        >
          <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
            82-0 PEAK Season
          </h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            82-0 PEAK Season is not enabled in this environment yet. Nothing is broken — the mode is
            behind a server flag. In the meantime, the PEAK3 rankings are fully available.
          </p>
          <Link
            href="/rankings"
            className="self-start px-5 py-2.5 rounded-lg text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
          >
            Explore the rankings
          </Link>
        </div>
      )}

      {/* Phase 12A: BOTH daily games, as a labelled section rather than one
          lone card. They are rendered unconditionally -- unlike the 82-0
          flagship they sit behind no server flag, so this hub stays useful even
          in the fail-closed state above. They stay visually secondary to the
          flagship hero: same GameCard component, without `featured`. */}
      <section aria-label="Daily games" className="mb-6">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2
            className="text-[11px] font-bold uppercase tracking-[0.18em]"
            style={{ color: "var(--text-muted)" }}
          >
            Daily games
          </h2>
          <Link
            href="/daily"
            data-testid="arena-daily-hub-link"
            className="text-xs font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            style={{ color: "var(--peak-accent)" }}
          >
            Daily hub →
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <GameCard
            testId="arena-daily-grid-card"
            href="/daily/grid"
            eyebrow="New board every day"
            title="Daily Grid Challenge"
            description="Fill a 3x3 board with exact NBA player-seasons — teams, awards, eras, playoff runs. Nine squares, nine different players, and everyone gets the same board."
            icon={<Grid3x3 size={17} />}
            cta="Play today's grid"
          />
          <GameCard
            testId="arena-daily-duel-card"
            href="/play/daily"
            eyebrow="New questions every day"
            title="Peak Duel Daily"
            description="Ten head-to-head questions: pick which player's peak PEAK3 rates higher. Same ten comparisons for everyone."
            icon={<Swords size={17} />}
            cta="Play today's duel"
          />
        </div>
      </section>

      {/* Legacy modes, deliberately demoted to a footnote: discoverable for
          internal use, never presented as part of the product. Not linked from
          the navbar or the homepage. */}
      <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
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
