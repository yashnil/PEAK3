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
    title: "82-0 Peak Season (Prototype) | PEAK3 Arena",
  };
}

/**
 * Phase 9B: this route NO LONGER creates a game.
 *
 * It used to call createCourtGame() right here in the server component -- so
 * merely following the "Try 82-0" CTA created a run and started the spin
 * ceremony before the user had agreed to anything. Now the route only fetches
 * the readiness catalog (the franchise/season pools the reels need) and hands
 * it to PeakSeasonStartGate, which creates the game on an explicit click. See
 * that component's docstring for the full rationale.
 *
 * Side benefit of moving creation out of the server component: readiness is a
 * safe no-auth diagnostic, so a readiness failure no longer blocks the page
 * from rendering at all (the reels just fall back to their own defaults) --
 * the old version returned a full-page error if game creation threw.
 */
export default async function CourtBuilderPracticePage({ params, searchParams }: Props) {
  const { mode } = await params;
  const sp = await searchParams;
  if (!VALID_MODES.includes(mode as CourtMode)) notFound();

  const parsedSeed = sp.seed ? parseInt(sp.seed, 10) : NaN;
  const readiness = await getCourtBuilderReadiness().catch(() => null);
  const franchiseNames = readiness?.team_year_enabled
    ? (readiness?.experimental_team_year_franchise_names ?? [])
    : (readiness?.interim_team_franchise_names ?? []);

  return (
    <PeakSeasonStartGate
      mode={mode as CourtMode}
      challengeKind="free_play"
      seed={Number.isFinite(parsedSeed) ? parsedSeed : undefined}
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
