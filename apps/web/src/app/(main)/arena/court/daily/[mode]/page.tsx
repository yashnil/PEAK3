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
    title: "Daily PEAK Season | PEAK3 Arena",
    description: "Today's shared 82-0 PEAK Season challenge — the same spin sequence for everyone.",
  };
}

/**
 * Phase 9A: today's shared Daily PEAK Season challenge.
 *
 * Structurally identical to the free-play practice route -- same engine, same
 * CourtBuilder component, same 8 rounds. The ONLY difference is that the
 * board's seed is derived server-side from the UTC date
 * (nba_peak/perfect_season/daily.py::daily_seed) instead of being random,
 * which is what makes every player's board identical for a given date. No
 * stored board snapshot is involved: the generator is already fully
 * deterministic in the seed.
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

  let gameState;
  let franchiseNames: string[] = [];
  let seasonLabels: string[] = [];
  let rollableTeamSeasonCount = 0;
  let supportedStartSeason: string | null = null;
  let supportedEndSeason: string | null = null;
  let teamLogoUrls: Record<string, string> = {};
  try {
    const [game, readiness] = await Promise.all([
      // No seed passed: for a daily board the server always derives it from
      // the date, and ignores any client-supplied seed by design.
      createCourtGame(mode as CourtMode, undefined, {
        challengeKind: "daily",
        challengeDate: sp.date,
      }),
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
    teamLogoUrls = readiness?.team_logo_urls ?? {};
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
    const message =
      code === "courtbuilder_not_enabled"
        ? "82-0 Peak Season is not enabled in this environment yet."
        : code === "invalid_challenge_date"
          ? "That isn't a valid challenge date. Try today's Daily PEAK Season instead."
          : "Could not start today's Daily PEAK Season. Is the API running?";
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p style={{ color: "#ef4444" }}>{message}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="mx-auto w-full max-w-3xl px-4 pt-6" data-testid="daily-challenge-header">
        <span
          className="text-[10px] font-black uppercase tracking-widest rounded-full px-2.5 py-1"
          style={{ background: "rgba(96,165,250,0.15)", color: "#60a5fa" }}
        >
          Daily PEAK Season
        </span>
        <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
          {gameState.challenge_date
            ? `Everyone gets this exact spin sequence today (${gameState.challenge_date}, UTC). Same teams, same seasons, same candidates.`
            : "Everyone gets this exact spin sequence today. Same teams, same seasons, same candidates."}
        </p>
      </div>
      <CourtBuilder
        initialGameState={gameState}
        franchiseNames={franchiseNames}
        seasonLabels={seasonLabels}
        rollableTeamSeasonCount={rollableTeamSeasonCount}
        supportedStartSeason={supportedStartSeason}
        supportedEndSeason={supportedEndSeason}
        teamLogoUrls={teamLogoUrls}
      />
    </div>
  );
}
