import { notFound } from "next/navigation";
import type { Metadata } from "next";
import PracticeDraftLoader from "@/components/draft/PracticeDraftLoader";
import { DraftMode, MODE_LABELS } from "@/types/draft";

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

  // The board is created in the BROWSER, not here. See PracticeDraftLoader's
  // header: a server-side create sends the API's ownership cookie to the Next
  // server instead of the player, so the player cannot then act on their own
  // board. This component stays server-side purely for generateMetadata and
  // the invalid-mode notFound() above.
  return <PracticeDraftLoader mode={mode as DraftMode} seed={seed} />;
}
