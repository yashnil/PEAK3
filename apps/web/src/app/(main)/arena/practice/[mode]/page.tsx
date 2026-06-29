import { notFound } from "next/navigation";
import type { Metadata } from "next";
import DraftScreen from "@/components/draft/DraftScreen";
import { DraftMode, MODE_LABELS } from "@/types/draft";
import { createDraftGame } from "@/lib/draft-api";

const VALID_MODES: DraftMode[] = ["apex_1y", "prime_3y", "foundation_5y"];

interface Props {
  params: Promise<{ mode: string }>;
  searchParams: Promise<Record<string, string>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { mode } = await params;
  const label = MODE_LABELS[mode as DraftMode] ?? mode;
  return {
    title: `Practice Draft · ${label} | PEAK3 Arena`,
  };
}

export default async function PracticeDraftPage({ params, searchParams }: Props) {
  const { mode } = await params;
  const sp = await searchParams;
  if (!VALID_MODES.includes(mode as DraftMode)) notFound();

  const seed = sp.seed ? parseInt(sp.seed, 10) : undefined;

  let gameState;
  try {
    gameState = await createDraftGame(mode as DraftMode, "practice", { seed });
  } catch {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p style={{ color: "#ef4444" }}>
          Could not create practice board. Is the API running?
        </p>
      </div>
    );
  }

  return <DraftScreen initialGameState={gameState} />;
}
