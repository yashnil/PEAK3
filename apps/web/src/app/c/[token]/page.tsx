import { notFound } from "next/navigation";
import type { Metadata } from "next";
import DraftScreen from "@/components/draft/DraftScreen";
import { loadChallenge } from "@/lib/draft-api";

interface Props {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  return {
    title: `Challenge Draft | PEAK3 Arena`,
    description: "Someone challenged you to match their Peak Draft lineup.",
  };
}

export default async function ChallengeTokenPage({ params }: Props) {
  const { token } = await params;

  let gameState;
  try {
    gameState = await loadChallenge(token);
  } catch {
    notFound();
  }

  return (
    <div>
      <div
        className="mx-auto max-w-lg px-4 pt-6"
      >
        <div
          className="text-xs px-3 py-2 rounded-lg border mb-4"
          style={{
            background: "#60a5fa10",
            borderColor: "#60a5fa40",
            color: "#60a5fa",
          }}
        >
          Challenge board — same offers as the person who shared this link. Can you beat their lineup?
        </div>
      </div>
      <DraftScreen initialGameState={gameState} />
    </div>
  );
}
