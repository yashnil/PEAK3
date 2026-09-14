import type { Metadata } from "next";

import PrimeCutGame from "@/components/prime-cut/PrimeCutGame";

export const metadata: Metadata = {
  title: "Prime Cut · PEAK3 Arena",
  description: "Eight multi-year peaks, one at a time. Keep four, cut four.",
};

/**
 * One live PRIME CUT match.
 *
 * The match id is the only thing in the URL. What each seat may see is decided
 * by the mode's server-side projection; holding this id is worth a 403 to
 * anyone without a seat. Reachable before the Arena catalogue lists the mode
 * (hidden direct route), but a match can only be CREATED while
 * `ARENA_PRIME_CUT_ENABLED` is on.
 */
export default async function PrimeCutMatchPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  return <PrimeCutGame matchId={matchId} />;
}
