import type { Metadata } from "next";
import PeakV2CourtResult from "@/components/v2/court/PeakV2CourtResult";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import PeakV2PrimaryAction from "@/components/v2/PeakV2PrimaryAction";
import { getSharedCourtResult } from "@/lib/perfect-season-api";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `82-0 Peak Season Result · ${id.slice(0, 8)} | PEAK3 Arena`,
    description: "A completed 82-0 Peak Season run -- exact player-season cards, real receipts.",
  };
}

/**
 * Phase 8H: a real, shareable results URL -- "maybe shareable URL if the
 * run state infrastructure supports it" from the product ask.
 *
 * WHY THIS READS A DIFFERENT ENDPOINT THAN IT USED TO. It was built on GET
 * /perfect-season/games/{id}, which was public-by-id at the time. It no
 * longer is, and correctly so: that payload is the LIVE game -- the candidate
 * pool, the pending selection, and the id every mutator keys off -- so
 * possessing a link must not be enough to read it. The security pass that
 * closed that IDOR broke this page, because the page's need is real but
 * different: it wants a finished run's SCORECARD, not a game.
 *
 * So that is what it now asks for. `/shared-result` returns only
 * `result_ready` runs, strips the owner-scoped and mutable fields
 * server-side (see the endpoint's own docstring), and answers 404 for a run
 * that does not exist AND for one that is not finished -- deliberately the
 * same answer, so the route cannot be used to probe which ids exist or to
 * watch someone's board while they are still playing it. Both cases land on
 * the not-found state below, which is honest about both.
 *
 * Nothing on this page is an owner action. `PeakV2CourtResult`'s `readOnly`
 * flag hides the leaderboard submit panel, and the server would 403 a
 * submission from a non-owner anyway.
 *
 * Batch 8: this used to render the legacy `SeasonResultStub` instead of
 * the same `PeakV2CourtResult` the owner's own result screen uses — same
 * props (`state`/`result`/`onPlayAgain?`/`playAgainBusy?`/`readOnly?`),
 * same `data-testid="season-result"`, confirmed drop-in. That meant
 * sharing a run showed the recipient an older visual generation than the
 * player who just finished it saw seconds earlier.
 */
export default async function CourtResultsPage({ params }: Props) {
  const { id } = await params;

  let state;
  try {
    state = await getSharedCourtResult(id);
  } catch {
    return <NotFoundState />;
  }

  // Belt and braces: the endpoint already refuses anything but a finished
  // run, so this is unreachable through the real API. Kept because the page
  // renders `state.simulation_result` non-null and a narrowing check is
  // cheaper than trusting a remote contract.
  if (state.status !== "result_ready" || !state.simulation_result) {
    return <NotFoundState />;
  }

  return <PeakV2CourtResult state={state} result={state.simulation_result} readOnly />;
}

function NotFoundState() {
  return (
    <PeakV2Shell width="live">
      <div className="mx-auto max-w-lg px-4 py-16 text-center flex flex-col items-center gap-4">
        <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
          Run not found
        </h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          This link may have expired, or the run never existed.
        </p>
        <PeakV2PrimaryAction href="/arena/court/practice/apex_1y">
          Build your own roster
        </PeakV2PrimaryAction>
      </div>
    </PeakV2Shell>
  );
}
