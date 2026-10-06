import type { Metadata } from "next";
import { loadHomeModelData, loadNbaFactOfTheDay } from "@/components/home/home-data";
import { MODE_COPY, type ModeId } from "@/lib/modes";
import { getArenaCatalogue } from "@/lib/arena-readiness-server";
import { getCourtBuilderReadiness } from "@/lib/perfect-season-api";
import HomePageV2 from "@/components/v2/HomePageV2";
import type { V2Tone } from "@/components/v2/v2-tone";
import type { RankingComponentKey } from "@/types";

export const metadata: Metadata = {
  title: "PEAK3 Arena — Run the Table",
  description:
    "Draft exact NBA peak windows across a branching run, spend scarce credits, and beat five escalating statistical lineups. A basketball strategy game built on a transparent, open-weight rating formula — with receipts on every result.",
};

/** The five official component weights, the same numbers the model uses.
 *  `tone` is the V2 token name for the same frozen `--comp-*` hue as
 *  `color` — one real source (`CLAUDE.md`'s five weights), two presentation
 *  layers reading it, per `PeakV2Score`'s tone contract. */
const COMPONENT_WEIGHTS: { key: RankingComponentKey; label: string; pct: string; color: string; tone: V2Tone }[] = [
  { key: "statistical_impact", label: "Statistical Impact", pct: "38%", color: "var(--comp-si)", tone: "si" },
  { key: "traditional_production", label: "Traditional Production", pct: "21%", color: "var(--comp-tp)", tone: "tp" },
  { key: "individual_recognition", label: "Individual Recognition", pct: "20%", color: "var(--comp-rec)", tone: "rec" },
  { key: "postseason_individual_value", label: "Playoff Rate Impact", pct: "18%", color: "var(--comp-po)", tone: "po" },
  { key: "team_achievement", label: "Team Result", pct: "3%", color: "var(--comp-team)", tone: "team" },
];

/**
 * The homepage leads with RUN THE TABLE, the flagship mode. Rendered
 * entirely by `HomePageV2` (`components/v2/HomePageV2.tsx`) — this Server
 * Component's job is just to fetch the real data once (model data, the
 * live Arena catalogue) and hand it down as props, per
 * `CLAUDE.md`/the product brief's "consume the same authoritative state,
 * do not duplicate reducers, API clients, game logic" rule.
 */
export default async function HomePage() {
  const [modelData, arenaCatalogue, courtBuilderEnabled, nbaFact] = await Promise.all([
    loadHomeModelData(),
    // Fail-closed inside the helper, so this cannot reject and cannot take the
    // homepage down when the Arena is unreachable.
    getArenaCatalogue(),
    // Same fail-closed readiness check `/arena` itself gates 82-0 on (ADR-005
    // Decision 7): a fetch failure means "not enabled," never a link that
    // might 403.
    getCourtBuilderReadiness()
      .then((r) => r.courtbuilder_enabled)
      .catch(() => false),
    // NBA Fact of the Day — fail-closed inside the helper (`null` renders no
    // panel, never a fabricated fact or a broken homepage).
    loadNbaFactOfTheDay(),
  ]);

  const flagship = MODE_COPY["run-the-table"];
  const dailyGrid = MODE_COPY["daily-grid"];
  const peakDuel = MODE_COPY["peak-duel"];
  const peakSeason = MODE_COPY["peak-season"];

  return (
    <HomePageV2
      topWindow={modelData.windows[0] ?? null}
      componentWeights={COMPONENT_WEIGHTS.map(({ key, label, pct, tone }) => ({ key, label, pct, tone }))}
      proof={modelData.proof}
      runTheTable={flagship}
      dailyModes={[dailyGrid, peakDuel]}
      peakSeason={courtBuilderEnabled ? peakSeason : null}
      nbaFact={nbaFact}
      multiplayerModes={
        arenaCatalogue.available
          ? arenaCatalogue.modes.map((mode) => ({
              id: mode.id,
              href: mode.href,
              title: mode.name,
              description: mode.description,
              // The catalogue is keyed with underscores (`three_man_weave`)
              // and MODE_COPY with hyphens (`three-man-weave`); they are the
              // same modes, so the authored one-liner is reused rather than
              // the catalogue sentence being truncated at render time.
              // A mode with no MODE_COPY entry (Prime Cut, Find the Prime,
              // Shared Draft) carries its own one-liner in the catalogue.
              blurb: MODE_COPY[mode.id.replace(/_/g, "-") as ModeId]?.blurb ?? mode.blurb,
            }))
          : []
      }
      rankingsPreview={modelData.rankingsPreview}
      methodology={modelData.methodology}
    />
  );
}
