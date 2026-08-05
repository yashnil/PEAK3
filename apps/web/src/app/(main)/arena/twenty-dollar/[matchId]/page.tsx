import type { Metadata } from "next";

import TwentyDollarGame from "@/components/twenty-dollar/TwentyDollarGame";

export const metadata: Metadata = {
  title: "The $20 Showdown · PEAK3",
  description:
    "Two players, sealed bids, twenty dollars. Build a legal starting five one auction at a time.",
};

/**
 * One live $20 Showdown match.
 *
 * The match id is the only thing in the URL. Everything about the board -- and
 * everything the other seat is allowed to know -- is decided server-side by the
 * mode's own projection; possessing this id is worth a 403 to anyone who does
 * not hold a seat.
 */
export default async function TwentyDollarMatchPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;
  return <TwentyDollarGame matchId={matchId} />;
}
