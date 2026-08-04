import type { Metadata } from "next";
import ThreeManWeaveLoader from "@/components/three-man-weave/ThreeManWeaveLoader";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata: Metadata = {
  title: "Three-Man Weave | PEAK3 Arena",
  description:
    "A three-player snake draft over shared franchise and decade rolls. Draft six real NBA identities, fill five positions and a bench, and settle it on the PEAK3 lineup score.",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * `/arena/three-man-weave`.
 *
 * A server component that fetches NOTHING and creates NOTHING — readiness and
 * match creation both happen client-side behind the explicit start gate, so
 * following a link can never burn a match. `?match=` resumes an existing one,
 * which is also the reload-safe path mid-draft.
 *
 * NO ROSTER OR ROUND COUNTS IN THIS FILE. `RunTheTablePage`'s docstring
 * records why: a sentence naming "six rounds" here cannot be caught by a test
 * when the ruleset moves, so the counts live where they are read from the
 * server.
 */
export default async function ThreeManWeavePage({ searchParams }: Props) {
  const sp = await searchParams;
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
          Three-Man Weave
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Three drafters, one shared franchise and decade per round, and a global lock on every
          name taken.
        </p>
      </header>

      <ThreeManWeaveLoader matchId={first(sp.match)} />
    </div>
  );
}
