import { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { componentLabel, componentColor } from "@/lib/utils";

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

async function getPlayerData(slug: string) {
  try {
    const res = await fetch(`${API_BASE}/api/v1/players/${slug}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

const COMPONENT_KEYS = [
  "statistical_impact",
  "traditional_production",
  "individual_recognition",
  "postseason_individual_value",
  "team_achievement",
] as const;

export default async function PlayerPage({ params }: Props) {
  const { slug } = await params;
  const player = await getPlayerData(slug);

  if (!player) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="card-elevated max-w-md p-8 text-center space-y-4">
          <h1 className="font-display text-xl font-bold">Player not found</h1>
          <p className="text-sm text-[var(--text-muted)]">
            No PEAK3 data for &ldquo;{slug}&rdquo;.
          </p>
          <Link
            href="/rankings"
            className="inline-flex items-center gap-2 text-sm text-[var(--peak-accent)] hover:underline"
          >
            <ArrowLeft size={14} /> Back to rankings
          </Link>
        </div>
      </div>
    );
  }

  const durations = [1, 2, 3, 5].filter((d) => player.windows[String(d)]);

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-8">
        {/* Breadcrumb */}
        <Link
          href="/rankings"
          className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          Rankings
        </Link>

        {/* Header */}
        <div>
          <h1 className="font-display text-4xl font-extrabold">
            {player.player_name}
          </h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            PEAK3 profile · {durations.length} peak window{durations.length !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Windows */}
        <div className="space-y-5">
          {durations.map((d) => {
            const win = player.windows[String(d)];
            if (!win) return null;
            return (
              <div key={d} className="card-elevated p-6 space-y-5">
                {/* Window header */}
                <div className="flex items-start justify-between flex-wrap gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--text-muted)] mb-1">
                      {d}-Year Peak
                    </p>
                    <p className="text-lg font-semibold text-[var(--text-primary)]">
                      {win.start_season === win.end_season
                        ? win.start_season
                        : `${win.start_season} – ${win.end_season}`}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                      Rank #{win.rank} (1–year window)
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-4xl font-bold score-number font-display text-[var(--peak-accent)]">
                      {win.prime_score.toFixed(1)}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">Prime Score</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      Index: {win.prime_index.toFixed(2)}
                    </p>
                  </div>
                </div>

                {/* Component breakdown */}
                {win.components && (
                  <div>
                    <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-3">
                      Component breakdown
                    </p>
                    <div className="space-y-2">
                      {COMPONENT_KEYS.map((key) => {
                        const val = win.components[key];
                        const color = componentColor(key);
                        const maxVal = 40;
                        const barPct = Math.max(0, Math.min(100, (val / maxVal) * 100));
                        return (
                          <div key={key} className="flex items-center gap-3">
                            <p
                              className="text-xs w-36 shrink-0 text-right"
                              style={{ color }}
                            >
                              {componentLabel(key)}
                            </p>
                            <div className="flex-1 h-1.5 rounded-full bg-[var(--border-subtle)] overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${barPct}%`,
                                  backgroundColor: color,
                                }}
                              />
                            </div>
                            <p className="text-xs font-mono text-[var(--text-secondary)] w-10 text-right score-number">
                              {val.toFixed(1)}
                            </p>
                          </div>
                        );
                      })}
                      {/* Teammate adjustment */}
                      <div className="flex items-center gap-3 opacity-60">
                        <p className="text-xs w-36 shrink-0 text-right text-[var(--text-muted)]">
                          Teammate Adj.
                        </p>
                        <div className="flex-1" />
                        <p className="text-xs font-mono text-[var(--text-muted)] w-10 text-right score-number">
                          {win.components.teammate_adjustment.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Duration rank link */}
                <div className="pt-2 border-t border-[var(--border-subtle)]">
                  <Link
                    href={`/rankings?years=${d}`}
                    className="text-xs text-[var(--peak-accent)] hover:underline"
                  >
                    View {d}-year leaderboard →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-[var(--text-muted)]">
          Rankings reflect the PEAK3 formula. Not a claim of objective historical truth.{" "}
          <Link href="/methodology" className="text-[var(--peak-accent)] hover:underline">
            Methodology
          </Link>
        </p>
      </div>
    </div>
  );
}
