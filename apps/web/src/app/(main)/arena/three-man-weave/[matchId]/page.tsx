import type { Metadata } from "next";

import ThreeManWeaveLoader from "@/components/three-man-weave/ThreeManWeaveLoader";

export const metadata: Metadata = {
  title: "Three-Man Weave | PEAK3 Arena",
  description:
    "A three-player snake draft over shared franchise and decade rolls. Draft six real NBA identities, fill five positions and a bench, and settle it on the PEAK3 lineup score.",
};

/**
 * `/arena/three-man-weave/<match-id>` — ONE LIVE MATCH.
 *
 * THE ROUTE THAT DID NOT EXIST. `arena-modes.ts` has always published
 * `matchPath: (id) => "/arena/three-man-weave/" + id`, and the lobby pushes
 * exactly that after matchmaking succeeds. The app only had
 * `/arena/three-man-weave` reading a `?match=` query, so every created match --
 * public, private and practice alike -- navigated into a Next.js 404. The
 * server was fine: the match existed, the seats were filled and the clock was
 * running behind a white error page.
 *
 * Two lessons are baked in rather than noted:
 *
 *   1. `arena-routes.test.ts` asserts every `ARENA_MODES[].matchPath` resolves
 *      to a real segment in this directory tree, so a published path and a
 *      shipped route cannot disagree again.
 *   2. The `?match=` form still works from `../page.tsx`, so any link already
 *      in the wild keeps resolving. Nothing was moved, only added.
 *
 * A SERVER COMPONENT THAT FETCHES NOTHING AND CREATES NOTHING. Following a link
 * must never burn a match; the loader reads the match client-side from the
 * caller's own session, which is also what makes a refresh mid-draft safe --
 * the server holds the state and this just re-reads it.
 */
export default async function ThreeManWeaveMatchPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;
  return <ThreeManWeaveLoader matchId={matchId} />;
}
