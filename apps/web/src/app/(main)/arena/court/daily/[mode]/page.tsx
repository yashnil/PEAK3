import { notFound } from "next/navigation";
import type { Metadata } from "next";
import PeakSeasonStartGate from "@/components/court/PeakSeasonStartGate";
import { CourtMode } from "@/types/perfect-season";
import { getCourtBuilderReadiness } from "@/lib/perfect-season-api";

const VALID_MODES: CourtMode[] = ["apex_1y", "prime_3y", "foundation_5y"];

interface Props {
  params: Promise<{ mode: string }>;
  searchParams: Promise<Record<string, string>>;
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Daily PEAK Season | PEAK3 Arena",
    description: "Today's shared 82-0 PEAK Season challenge — the same spin sequence for everyone.",
  };
}

/**
 * Phase 9A: today's shared Daily PEAK Season challenge.
 * Phase 9B: now behind the explicit Start gate, same as free play.
 *
 * Structurally identical to the free-play practice route -- same engine, same
 * CourtBuilder component, same 8 rounds. The ONLY difference is that the
 * board's seed is derived server-side from the UTC date
 * (nba_peak/perfect_season/daily.py::daily_seed) instead of being random,
 * which is what makes every player's board identical for a given date. No
 * stored board snapshot is involved: the generator is already fully
 * deterministic in the seed.
 *
 * The Start gate matters MORE here than for free play: a daily run is what
 * gets counted as today's attempt, so it must never be consumed by a stray
 * navigation. Game creation happens in PeakSeasonStartGate on an explicit
 * click, never in this server component.
 *
 * Deliberately NOT gated on sign-in: daily play is open to anonymous
 * players, exactly like free play. Only SAVING the result (and therefore
 * comparing it to a personal best, or eventually appearing on a daily
 * leaderboard) requires an account -- see SaveRunPanel.
 *
 * `?date=YYYY-MM-DD` replays an earlier day's challenge, which is why the
 * seed derivation takes the date as an explicit argument rather than reading
 * the clock internally.
 */
export default async function DailyPeakSeasonPage({ params, searchParams }: Props) {
  const { mode } = await params;
  const sp = await searchParams;
  if (!VALID_MODES.includes(mode as CourtMode)) notFound();

  const readiness = await getCourtBuilderReadiness().catch(() => null);
  const franchiseNames = readiness?.team_year_enabled
    ? (readiness?.experimental_team_year_franchise_names ?? [])
    : (readiness?.interim_team_franchise_names ?? []);

  return (
    <PeakSeasonStartGate
      mode={mode as CourtMode}
      challengeKind="daily"
      challengeDate={sp.date}
      resumeGameId={sp.game}
      franchiseNames={franchiseNames}
      seasonLabels={readiness?.experimental_team_year_season_labels ?? []}
      rollableTeamSeasonCount={readiness?.rollable_team_season_count ?? 0}
      supportedStartSeason={readiness?.supported_start_season ?? null}
      supportedEndSeason={readiness?.supported_end_season ?? null}
      teamLogoUrls={readiness?.team_logo_urls ?? {}}
    />
  );
}
