import type { Metadata } from "next";

import SharedDraftGame from "@/components/shared-draft/SharedDraftGame";

export const metadata: Metadata = {
  title: "Shared Draft · PEAK3 Arena",
  description: "Two drafters, one board of current NBA players. Whoever you take, they can't.",
};

/**
 * One live SHARED DRAFT match.
 *
 * The match id is the only thing in the URL; what each seat may see is decided
 * by the mode's server-side projection. A match can only be CREATED while
 * `ARENA_SHARED_DRAFT_ENABLED` is on.
 */
export default async function SharedDraftMatchPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  return <SharedDraftGame matchId={matchId} />;
}
