"use client";

import { use } from "react";
import type { RankedMode } from "@/types/ranked";
import RankedLeaderboard from "@/components/ranked/RankedLeaderboard";

interface Props {
  params: Promise<{ mode: string }>;
}

export default function RankedLeaderboardPage({ params }: Props) {
  const { mode } = use(params);
  return <RankedLeaderboard mode={mode as RankedMode} />;
}
