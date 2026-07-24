import { notFound } from "next/navigation";
import type { Metadata } from "next";
import CourtBuilder from "@/components/court/CourtBuilder";
import { CourtMode } from "@/types/perfect-season";
import { createCourtGame, getCourtBuilderReadiness } from "@/lib/perfect-season-api";

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

export default async function CourtBuilderPracticePage({ params, searchParams }: Props) {
  const { mode } = await params;
  const sp = await searchParams;
  if (!VALID_MODES.includes(mode as CourtMode)) notFound();

  const seed = sp.seed ? parseInt(sp.seed, 10) : undefined;

  let gameState;
  let franchiseNames: string[] = [];
  let seasonLabels: string[] = [];
  let rollableTeamSeasonCount = 0;
  let supportedStartSeason: string | null = null;
  let supportedEndSeason: string | null = null;
  try {
    // Fetched in parallel: the game itself, and the readiness catalog's
    // franchise-name/season-label lists, which the spin ceremony's reels
    // cycle through for visual variety (see SpinStage -- always the true
    // resolvable set, never a broader decorative list). When the Phase 6A
    // team+year engine is enabled, the team reel's pool comes from the
    // experimental team-year dataset instead of the decade dataset, since
    // that's the actual resolvable set for this board.
    const [game, readiness] = await Promise.all([
      createCourtGame(mode as CourtMode, seed),
      getCourtBuilderReadiness().catch(() => null),
    ]);
    gameState = game;
    franchiseNames = readiness?.team_year_enabled
      ? (readiness?.experimental_team_year_franchise_names ?? [])
      : (readiness?.interim_team_franchise_names ?? []);
    seasonLabels = readiness?.experimental_team_year_season_labels ?? [];
    rollableTeamSeasonCount = readiness?.rollable_team_season_count ?? 0;
    supportedStartSeason = readiness?.supported_start_season ?? null;
    supportedEndSeason = readiness?.supported_end_season ?? null;
  } catch (err) {
    const message =
      err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "courtbuilder_not_enabled"
        ? "82-0 Peak Season is not enabled in this environment yet."
        : "Could not create a CourtBuilder board. Is the API running?";
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p style={{ color: "#ef4444" }}>{message}</p>
      </div>
    );
  }

  return (
    <CourtBuilder
      initialGameState={gameState}
      franchiseNames={franchiseNames}
      seasonLabels={seasonLabels}
      rollableTeamSeasonCount={rollableTeamSeasonCount}
      supportedStartSeason={supportedStartSeason}
      supportedEndSeason={supportedEndSeason}
    />
  );
}
