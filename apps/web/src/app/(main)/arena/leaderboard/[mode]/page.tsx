import type { Metadata } from "next";

import ArenaLeaderboardView from "@/components/arena/leaderboard/ArenaLeaderboardView";
import PeakV2Shell from "@/components/v2/PeakV2Shell";

export const metadata: Metadata = {
  title: "Rated Leaderboard · PEAK3 Arena",
  description:
    "Top players, where you stand, and your rating in each PEAK3 Arena multiplayer mode. Public matches only; bots are never listed.",
};

/**
 * The rated multiplayer board for one Arena mode. `[mode]` is whatever mode id
 * the server registers — the view asks the server which modes exist and which
 * board to show, so a newly registered mode needs no change here.
 */
export default async function ArenaModeLeaderboardPage({
  params,
}: {
  params: Promise<{ mode: string }>;
}) {
  const { mode } = await params;
  return (
    <PeakV2Shell width="live">
      <ArenaLeaderboardView mode={decodeURIComponent(mode)} />
    </PeakV2Shell>
  );
}
