"use client";

import { use, useEffect } from "react";
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
  const valid = RANKED_MODES.includes(mode as RankedMode);

  // Redirecting from inside the render body (rather than an effect) updates
  // the router while RankedModePage is still rendering, which React reports
  // as "Cannot update a component while rendering a different component" —
  // a real console warning on any hand-typed/malformed `?mode=` URL, since
  // no in-app link ever produces an invalid mode.
  useEffect(() => {
    if (!valid) router.replace("/arena/ranked");
  }, [valid, router]);

  if (!valid) return null;

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
