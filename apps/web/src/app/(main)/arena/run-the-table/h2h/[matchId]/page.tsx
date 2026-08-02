import type { Metadata } from "next";

import MatchScreen from "@/components/head-to-head/MatchScreen";

interface Props {
  params: Promise<{ matchId: string }>;
}

/**
 * `/arena/run-the-table/h2h/{matchId}`.
 *
 * `noindex` because a match belongs to two named people. The API answers 403 to
 * anyone who is not a participant regardless, so this is politeness rather than
 * access control — the access control is `_participant_or_403` on the server.
 */
export const metadata: Metadata = {
  title: "Head-to-Head match | PEAK3 Arena",
  robots: { index: false, follow: false },
};

export default async function HeadToHeadMatchPage({ params }: Props) {
  const { matchId } = await params;
  return (
    <main>
      <MatchScreen matchId={matchId} />
    </main>
  );
}
