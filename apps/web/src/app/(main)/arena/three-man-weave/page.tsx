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
 * `/arena/three-man-weave` — the mode's own start gate.
 *
 * A server component that fetches NOTHING and creates NOTHING — readiness and
 * match creation both happen client-side behind the explicit start gate, so
 * following a link can never burn a match.
 *
 * `?match=` still resumes an existing match here. It predates
 * `/arena/three-man-weave/<id>` and any link already in the wild must keep
 * working, so the canonical route was ADDED rather than the query form moved.
 *
 * NO ROSTER OR ROUND COUNTS IN THIS FILE. `RunTheTablePage`'s docstring records
 * why: a sentence naming "six rounds" here cannot be caught by a test when the
 * ruleset moves, so the counts live where they are read from the server — or,
 * for the rules disclosure, in `lib/arena-modes.ts`, where one edit reaches
 * every surface that states them.
 */
export default async function ThreeManWeavePage({ searchParams }: Props) {
  const sp = await searchParams;
  return <ThreeManWeaveLoader matchId={first(sp.match)} />;
}
