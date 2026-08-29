"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import RankedScreen from "@/components/ranked/RankedScreen";
import { RANKED_MODES, RANKED_MODE_LABELS, type RankedMode } from "@/types/ranked";
import PeakV2Shell from "@/components/v2/PeakV2Shell";

interface Props {
  params: Promise<{ mode: string }>;
}

export default function RankedModePage({ params }: Props) {
  const { mode } = use(params);
  const router = useRouter();

  if (!RANKED_MODES.includes(mode as RankedMode)) {
    router.replace("/arena/ranked");
    return null;
  }

  const rankedMode = mode as RankedMode;

  return (
    <PeakV2Shell width="live-wide">
      <header className="v2-page-header">
        <p className="v2-page-kicker">Competitive</p>
        <h1 className="v2-page-title">Ranked · {RANKED_MODE_LABELS[rankedMode]}</h1>
      </header>
      <RankedScreen mode={rankedMode} />
    </PeakV2Shell>
  );
}
