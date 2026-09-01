import type { Metadata } from "next";

import ChallengeCreator from "@/components/head-to-head/ChallengeCreator";
import HeadToHeadHistory from "@/components/head-to-head/HeadToHeadHistory";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import PeakV2SecondaryAction from "@/components/v2/PeakV2SecondaryAction";

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
    <PeakV2Shell width="live">
      <header className="v2-page-header">
        <p className="v2-page-kicker">Run the Table</p>
        <h1 className="v2-page-title" style={{ fontSize: "var(--v2-display-size-line)" }}>
          Head-to-Head
        </h1>
        <p className="v2-page-lede">
          Two players, one board, played whenever each of you has time. PEAK3 rates the
          two finished runs against a published order of tie-breakers — it does not
          decide who is the better basketball mind.
        </p>
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-col divide-y" style={{ borderColor: "var(--v2-border-subtle)" }}>
        <section className="py-6 first:pt-0" aria-labelledby="h2h-create-heading">
          <h2 id="h2h-create-heading" className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            Start a challenge
          </h2>
          <div className="mt-3">
            <ChallengeCreator />
          </div>
        </section>

        <section className="py-6" aria-labelledby="h2h-history-heading">
          <h2 id="h2h-history-heading" className="text-sm font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            Your head-to-heads
          </h2>
          <div className="mt-3">
            <HeadToHeadHistory />
          </div>
        </section>
      </div>

      <PeakV2SecondaryAction href="/arena/run-the-table" size="sm" className="mt-6">
        Back to RUN THE TABLE
      </PeakV2SecondaryAction>
    </PeakV2Shell>
  );
}
