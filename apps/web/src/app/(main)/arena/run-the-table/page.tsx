import type { Metadata } from "next";
import RunTheTableGame from "@/components/run-the-table/RunTheTableGame";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata: Metadata = {
  title: "Run the Table | PEAK3 Arena",
  description:
    "Build and evolve a roster of exact NBA 3-year peaks across a branching run, manage scarce credits, and beat three escalating statistical lineups.",
};

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * `/arena/run-the-table`.
 *
 * This server component fetches NOTHING and creates NOTHING. Readiness, the
 * daily descriptor and any resume all happen client-side behind the explicit
 * Start gate — the same structural fix PeakSeasonStartGate's docstring
 * describes: merely following a link must never burn a run.
 *
 * `?seed=` replays a specific free-play seed, `?date=` an earlier daily, and
 * `?c=` carries a challenge token. `?mode=daily` only changes which start
 * button is emphasised — it deliberately does NOT auto-start, because that
 * would let a shared link burn someone's daily attempt.
 */
export default async function RunTheTablePage({ searchParams }: Props) {
  const sp = await searchParams;
  const rawSeed = first(sp.seed);
  const parsedSeed = rawSeed !== undefined ? Number.parseInt(rawSeed, 10) : NaN;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
          Run the Table
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          A front-office run over exact PEAK3 3-year peak windows. Three acts, three lives, five
          component lanes.
        </p>
      </header>

      <RunTheTableGame
        initialSeed={Number.isFinite(parsedSeed) ? parsedSeed : undefined}
        initialDate={first(sp.date)}
        challengeToken={first(sp.c)}
        preferredMode={first(sp.mode) === "daily" ? "daily" : undefined}
      />
    </div>
  );
}
