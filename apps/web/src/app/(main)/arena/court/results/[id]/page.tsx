import type { Metadata } from "next";
import Link from "next/link";
import SeasonResultStub from "@/components/court/SeasonResultStub";
import { getCourtGame } from "@/lib/perfect-season-api";

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
 * run state infrastructure supports it" from the product ask. This reuses
 * the EXACT SAME server-authoritative game record CourtBuilder itself
 * already persists (GET /perfect-season/games/{id}, already public-by-id,
 * no ownership check -- same "anonymous-friendly, share by unguessable
 * link" model the rest of this product already uses) -- no parallel
 * persistence, no new backend surface, just a read-only view onto data
 * that already exists once a run completes.
 *
 * A game that isn't finished yet (or doesn't exist / expired) never shows
 * partial/spoiler data -- the API itself withholds every score until
 * result_ready regardless, and this page additionally just declines to
 * render the result screen at all outside that state.
 */
export default async function CourtResultsPage({ params }: Props) {
  const { id } = await params;

  let state;
  try {
    state = await getCourtGame(id);
  } catch {
    return <NotFoundState />;
  }

  if (state.status !== "result_ready" || !state.simulation_result) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center flex flex-col items-center gap-4">
        <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
          This run isn&apos;t finished yet
        </h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Whoever shared this link hasn&apos;t completed their 82-0 Peak Season run. Check back once
          they&apos;ve locked their roster and simulated the season.
        </p>
        <Link
          href="/arena/court/practice/apex_1y"
          className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold"
          style={{ background: "var(--peak-accent, #f5c842)", color: "#000" }}
        >
          Build your own roster
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl w-full px-4 py-8">
      <SeasonResultStub state={state} result={state.simulation_result} readOnly />
    </div>
  );
}

function NotFoundState() {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center flex flex-col items-center gap-4">
      <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
        Run not found
      </h1>
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        This link may have expired, or the run never existed.
      </p>
      <Link
        href="/arena/court/practice/apex_1y"
        className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold"
        style={{ background: "var(--peak-accent, #f5c842)", color: "#000" }}
      >
        Build your own roster
      </Link>
    </div>
  );
}
