import { notFound } from "next/navigation";
import type { Metadata } from "next";
import DraftScreen from "@/components/draft/DraftScreen";
import { DraftMode, MODE_LABELS } from "@/types/draft";
import { getDailyDraft } from "@/lib/draft-api";

const VALID_MODES: DraftMode[] = ["apex_1y", "prime_3y", "foundation_5y"];

interface Props {
  params: Promise<{ mode: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { mode } = await params;
  const label = MODE_LABELS[mode as DraftMode] ?? mode;
  return {
    title: `Daily Draft · ${label} | PEAK3 Arena`,
  };
}

export default async function DailyDraftPage({ params }: Props) {
  const { mode } = await params;
  if (!VALID_MODES.includes(mode as DraftMode)) notFound();

  let gameState;
  try {
    gameState = await getDailyDraft(mode as DraftMode);
  } catch {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p style={{ color: "#ef4444" }}>
          Could not load today&apos;s board. Is the API running?
        </p>
      </div>
    );
  }

  return <DraftScreen initialGameState={gameState} />;
}
