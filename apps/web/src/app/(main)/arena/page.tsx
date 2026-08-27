import type { Metadata } from "next";
import { getArenaCatalogue } from "@/lib/arena-readiness-server";
import { getCourtBuilderReadiness } from "@/lib/perfect-season-api";
import ArenaPageV2 from "@/components/v2/ArenaPageV2";

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
 * ("Start a standard run", "Resume a saved run") instead of repeating "Your
 * runs →" twice on one screen, and the surfaces vary by tier rather than
 * repeating one bordered rectangle.
 *
 * LAUNCH-POLISH LP2-3 removed the third link, "Play today's shared run" —
 * see `docs/implementation/launch-polish/RTT_DAILY_EVIDENCE.md`. Nothing
 * about the daily mode changed behind it: the route, the seed and any saved
 * daily run are untouched, this page just no longer advertises it as a
 * choice next to Standard.
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

export default async function ArenaPage() {
  let courtBuilderEnabled = false;
  try {
    const readiness = await getCourtBuilderReadiness();
    courtBuilderEnabled = readiness.courtbuilder_enabled;
  } catch {
    courtBuilderEnabled = false;
  }
  // Fail-closed inside the helper, so this cannot reject and cannot take the
  // catalog down when the Arena is unreachable.
  const arenaCatalogue = await getArenaCatalogue();

  return <ArenaPageV2 courtBuilderEnabled={courtBuilderEnabled} arenaCatalogue={arenaCatalogue} />;
}
