import type { Metadata } from "next";
import Link from "next/link";

import ChallengeCreator from "@/components/head-to-head/ChallengeCreator";
import HeadToHeadHistory from "@/components/head-to-head/HeadToHeadHistory";

/**
 * `/arena/run-the-table/h2h` — the head-to-head hub.
 *
 * A server component that fetches NOTHING and creates NOTHING, for the same
 * reason `/arena/run-the-table` does: merely following a link must never mint
 * a match or burn a run. Both panels below are client components that act only
 * on an explicit press.
 */
export const metadata: Metadata = {
  title: "Head-to-Head | RUN THE TABLE | PEAK3 Arena",
  description:
    "Challenge someone to the same RUN THE TABLE board. Same roster, same offers, same five bosses scaled to the team you build — only your choices differ.",
};

export default function HeadToHeadHubPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <p className="text-xs uppercase tracking-widest opacity-60">RUN THE TABLE</p>
      <h1 className="mt-2 text-3xl font-semibold">Head-to-Head</h1>
      <p className="mt-3 text-sm opacity-80">
        Two players, one board, played whenever each of you has time. PEAK3 rates the
        two finished runs against a published order of tie-breakers — it does not
        decide who is the better basketball mind.
      </p>

      <section className="mt-8" aria-labelledby="h2h-create-heading">
        <h2 id="h2h-create-heading" className="text-lg font-semibold">
          Start a challenge
        </h2>
        <div className="mt-3">
          <ChallengeCreator />
        </div>
      </section>

      <section className="mt-10" aria-labelledby="h2h-history-heading">
        <h2 id="h2h-history-heading" className="text-lg font-semibold">
          Your head-to-heads
        </h2>
        <div className="mt-3">
          <HeadToHeadHistory />
        </div>
      </section>

      <Link
        href="/arena/run-the-table"
        className="mt-10 inline-block text-sm underline opacity-80"
      >
        Back to RUN THE TABLE
      </Link>
    </main>
  );
}
