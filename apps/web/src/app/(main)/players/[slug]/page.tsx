import { Metadata } from "next";
import Link from "next/link";
import { componentLabel, componentColor, componentTextColor } from "@/lib/utils";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import PeakV2Score from "@/components/v2/PeakV2Score";
import PeakV2SecondaryAction from "@/components/v2/PeakV2SecondaryAction";
import { ErrorState } from "@/components/ui/ErrorState";
import type { PlayerProfile } from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  };
}

type PlayerFetchResult =
  | { status: "ok"; player: PlayerProfile }
  | { status: "not_found" }
  | { status: "error" };

async function getPlayerData(slug: string): Promise<PlayerFetchResult> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/players/${slug}`, {
      next: { revalidate: 3600 },
    });
    if (res.status === 404) return { status: "not_found" };
    if (!res.ok) return { status: "error" };
    return { status: "ok", player: await res.json() };
  } catch {
    return { status: "error" };
  }
}

const COMPONENT_KEYS = [
  "statistical_impact",
  "traditional_production",
  "individual_recognition",
  "postseason_individual_value",
  "team_achievement",
] as const;

/** The three PEAK3 durations that already carry a named brand identity
 *  elsewhere in the app (Ranked's 1Y Apex/3Y Prime/5Y Foundation queues,
 *  `arena/labs`'s mode colors) — reused here, not reinvented. A 2-year
 *  window (the model supports one, per CLAUDE.md) has no named color
 *  anywhere in the app, so it gets the plain neutral treatment rather than
 *  an invented fourth color. */
const DURATION_ACCENT: Record<number, string | null> = {
  1: "var(--apex-coral-text)",
  2: null,
  3: "var(--peak-accent-text)",
  5: "var(--foundation-blue-text)",
};

export default async function PlayerPage({ params }: Props) {
  const { slug } = await params;
  const result = await getPlayerData(slug);

  if (result.status !== "ok") {
    return (
      <PeakV2Shell width="live">
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
          {result.status === "not_found" ? (
            <>
              <h1 className="v2-page-title" style={{ fontSize: "var(--v2-display-size-line)" }}>
                Player not found
              </h1>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                No PEAK3 data for &ldquo;{slug}&rdquo;.
              </p>
            </>
          ) : (
            <ErrorState message="Could not load this player. Try again." />
          )}
          <PeakV2SecondaryAction href="/rankings" size="sm">
            ← Rankings
          </PeakV2SecondaryAction>
        </div>
      </PeakV2Shell>
    );
  }

  const player = result.player;
  const durations = [1, 2, 3, 5].filter((d) => player.windows[String(d)]);

  return (
    <PeakV2Shell width="live">
      <header className="v2-page-header">
        <p className="v2-page-kicker">PEAK3 Profile</p>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="v2-page-title">{player.player_name}</h1>
          <PeakV2SecondaryAction href="/rankings" size="sm">
            ← Rankings
          </PeakV2SecondaryAction>
        </div>
        <p className="v2-page-lede">
          {durations.length} peak window{durations.length !== 1 ? "s" : ""}
        </p>
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-col divide-y" style={{ borderColor: "var(--v2-border-subtle)" }}>
        {durations.map((d) => {
          // Non-null: `d` was filtered from `durations` above precisely
          // because `player.windows[String(d)]` exists.
          const win = player.windows[String(d)]!;
          const accent = DURATION_ACCENT[d];
          return (
            <div key={d} className="flex flex-col gap-5 py-6 first:pt-0">
              {/* Window header */}
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p
                    className="text-xs font-bold uppercase tracking-[0.15em] mb-1"
                    style={{ color: accent ?? "var(--text-muted)" }}
                  >
                    {d}-Year Peak
                  </p>
                  <p className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                    {win.start_season === win.end_season
                      ? win.start_season
                      : `${win.start_season} – ${win.end_season}`}
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    <span className="score-number">Rank #{win.rank}</span> — {d}-year board
                  </p>
                </div>
                <PeakV2Score
                  value={win.prime_score.toFixed(1)}
                  label="Prime Score"
                  role="moment"
                  size="lg"
                  className="items-end text-right"
                />
              </div>
              <p className="-mt-3 text-right text-xs" style={{ color: "var(--text-muted)" }}>
                Index: <span className="score-number">{win.prime_index.toFixed(2)}</span>
              </p>

              {/* Component breakdown */}
              {win.components && (
                <div>
                  <p className="mb-3 text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                    Component breakdown
                  </p>
                  <div className="space-y-2">
                    {COMPONENT_KEYS.map((key) => {
                      const val = win.components![key];
                      const color = componentColor(key);
                      const textColor = componentTextColor(key);
                      const maxVal = 40;
                      const barPct = Math.max(0, Math.min(100, (val / maxVal) * 100));
                      return (
                        <div key={key} className="flex items-center gap-3">
                          <p className="w-36 shrink-0 text-right text-xs" style={{ color: textColor }}>
                            {componentLabel(key)}
                          </p>
                          <div
                            className="h-1.5 flex-1 overflow-hidden rounded-full"
                            style={{ background: "var(--v2-border-subtle)" }}
                          >
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${barPct}%`, backgroundColor: color }}
                            />
                          </div>
                          <p className="score-number w-10 text-right text-xs" style={{ color: "var(--text-secondary)" }}>
                            {val.toFixed(1)}
                          </p>
                        </div>
                      );
                    })}
                    {/* Teammate adjustment — de-emphasized via --text-muted alone
                        (a secondary/adjustment figure, not one of the 5 weighted
                        components). NOT also `opacity-*`: stacking opacity on an
                        already-muted color pushed effective contrast below WCAG
                        AA (caught by this route's first-ever axe pass — a real,
                        pre-existing bug, not introduced by this change). */}
                    <div className="flex items-center gap-3">
                      <p className="w-36 shrink-0 text-right text-xs" style={{ color: "var(--text-muted)" }}>
                        Teammate Adj.
                      </p>
                      <div className="flex-1" />
                      <p className="score-number w-10 text-right text-xs" style={{ color: "var(--text-muted)" }}>
                        {win.components.teammate_adjustment.toFixed(2)}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Duration rank link */}
              <div>
                <Link
                  href={`/rankings?years=${d}`}
                  className="text-xs underline"
                  style={{ color: "var(--peak-accent-text)" }}
                >
                  View {d}-year leaderboard →
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mx-auto mt-6 max-w-2xl text-xs" style={{ color: "var(--text-muted)" }}>
        Rankings reflect the PEAK3 formula. Not a claim of objective historical truth.{" "}
        <Link href="/methodology" className="underline" style={{ color: "var(--peak-accent-text)" }}>
          Methodology
        </Link>
      </p>
    </PeakV2Shell>
  );
}
