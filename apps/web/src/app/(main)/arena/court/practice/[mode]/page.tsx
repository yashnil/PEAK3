import { notFound } from "next/navigation";
import type { Metadata } from "next";
import CourtBuilder from "@/components/court/CourtBuilder";
import { CourtMode } from "@/types/perfect-season";
import { createCourtGame } from "@/lib/perfect-season-api";

const VALID_MODES: CourtMode[] = ["apex_1y", "prime_3y", "foundation_5y"];

interface Props {
  params: Promise<{ mode: string }>;
  searchParams: Promise<Record<string, string>>;
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "82-0 Peak Season (Prototype) | PEAK3 Arena",
  };
}

export default async function CourtBuilderPracticePage({ params, searchParams }: Props) {
  const { mode } = await params;
  const sp = await searchParams;
  if (!VALID_MODES.includes(mode as CourtMode)) notFound();

  const seed = sp.seed ? parseInt(sp.seed, 10) : undefined;

  let gameState;
  try {
    gameState = await createCourtGame(mode as CourtMode, seed);
  } catch (err) {
    const message =
      err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "courtbuilder_not_enabled"
        ? "82-0 Peak Season is not enabled in this environment yet."
        : "Could not create a CourtBuilder board. Is the API running?";
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p style={{ color: "#ef4444" }}>{message}</p>
      </div>
    );
  }

  return <CourtBuilder initialGameState={gameState} />;
}
