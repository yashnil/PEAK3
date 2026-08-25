import type { Metadata } from "next";
import { loadHomeModelData } from "@/components/home/home-data";
import { MODE_COPY } from "@/lib/modes";
import { getArenaCatalogue } from "@/lib/arena-readiness-server";
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
  const [modelData, arenaCatalogue] = await Promise.all([
    loadHomeModelData(),
    // Fail-closed inside the helper, so this cannot reject and cannot take the
    // homepage down when the Arena is unreachable.
    getArenaCatalogue(),
  ]);

  const flagship = MODE_COPY["run-the-table"];
  const dailyGrid = MODE_COPY["daily-grid"];
  const peakDuel = MODE_COPY["peak-duel"];

  return (
    <HomePageV2
      topWindow={modelData.windows[0] ?? null}
      componentWeights={COMPONENT_WEIGHTS.map(({ key, label, pct, tone }) => ({ key, label, pct, tone }))}
      proof={modelData.proof}
      runTheTable={flagship}
      dailyModes={[dailyGrid, peakDuel]}
      multiplayerModes={
        arenaCatalogue.available
          ? arenaCatalogue.modes.map((mode) => ({
              href: mode.href,
              title: mode.name,
              description: mode.description,
            }))
          : []
      }
      rankingsPreview={modelData.rankingsPreview}
      methodology={modelData.methodology}
    />
  );
}
