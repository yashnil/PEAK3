import type { Metadata } from "next";

import FindThePrimeGame from "@/components/find-the-prime/FindThePrimeGame";

export const metadata: Metadata = {
  title: "Find the Prime · PEAK3 Arena",
  description: "Pick the strongest contiguous stretch of each player's career.",
};

/**
 * One live FIND THE PRIME match. See the Prime Cut page for the routing
 * contract; the same rules apply (`ARENA_FIND_THE_PRIME_ENABLED` gates creation).
 */
export default async function FindThePrimeMatchPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  return <FindThePrimeGame matchId={matchId} />;
}
