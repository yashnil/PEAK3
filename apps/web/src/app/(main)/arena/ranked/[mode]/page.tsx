"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import RankedScreen from "@/components/ranked/RankedScreen";
import { RANKED_MODES, RANKED_MODE_LABELS, type RankedMode } from "@/types/ranked";

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
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-bold mb-4" style={{ color: "var(--text-primary)" }}>
        Ranked · {RANKED_MODE_LABELS[rankedMode]}
      </h1>
      <RankedScreen mode={rankedMode} />
    </div>
  );
}
