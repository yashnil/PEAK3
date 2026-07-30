import { notFound } from "next/navigation";
import type { Metadata } from "next";
import DraftScreen from "@/components/draft/DraftScreen";
import { getDraftGame } from "@/lib/draft-api";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Draft Results · ${id.slice(0, 8)} | PEAK3 Arena`,
  };
}

export default async function DraftResultsPage({ params }: Props) {
  const { id } = await params;

  let gameState;
  try {
    gameState = await getDraftGame(id);
  } catch {
    notFound();
  }

  return <DraftScreen initialGameState={gameState} />;
}
