"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { rankedApi } from "@/lib/ranked-api";
import { analytics } from "@/lib/analytics";
import { RANKED_MODE_LABELS, type LeaderboardResponse, type RankedMode } from "@/types/ranked";

interface Props {
  params: Promise<{ mode: string }>;
}

type LoadState = "loading" | "loaded" | "error";

export default function RankedLeaderboardPage({ params }: Props) {
  const { mode } = use(params);
  const rankedMode = mode as RankedMode;
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    setState("loading");
    analytics.track({ type: "ranked_leaderboard_viewed", mode: rankedMode });
    rankedApi
      .getLeaderboard(rankedMode)
      .then((res) => {
        setData(res);
        setState("loaded");
      })
      .catch(() => setState("error"));
  }, [rankedMode]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
          {RANKED_MODE_LABELS[rankedMode]} Leaderboard
        </h1>
        <Link href={`/arena/ranked/${rankedMode}`} className="text-sm" style={{ color: "var(--peak-accent)" }}>
          Back to queue
        </Link>
      </div>

      {state === "loading" && (
        <p role="status" className="text-sm" style={{ color: "var(--text-muted)" }}>
          Loading leaderboard…
        </p>
      )}

      {state === "error" && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Could not load the leaderboard.
        </p>
      )}

      {state === "loaded" && data && !data.enabled && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          The public leaderboard is not enabled yet.
        </p>
      )}

      {state === "loaded" && data && data.enabled && data.entries.length === 0 && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          No established players yet.
        </p>
      )}

      {state === "loaded" && data && data.enabled && data.entries.length > 0 && (
        <table className="w-full text-sm" data-testid="leaderboard-table">
          <caption className="sr-only">{RANKED_MODE_LABELS[rankedMode]} ranked leaderboard</caption>
          <thead>
            <tr style={{ color: "var(--text-muted)" }}>
              <th scope="col" className="text-left py-2">Rank</th>
              <th scope="col" className="text-left py-2">Player</th>
              <th scope="col" className="text-right py-2">Rating</th>
              <th scope="col" className="text-right py-2">Division</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((entry) => (
              <tr key={entry.owner_sub} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                <td className="py-2 tabular-nums" style={{ color: "var(--text-secondary)" }}>{entry.rank}</td>
                <td className="py-2" style={{ color: "var(--text-primary)" }}>{entry.owner_sub}</td>
                <td className="py-2 text-right tabular-nums" style={{ color: "var(--text-primary)" }}>{entry.rating.toFixed(0)}</td>
                <td className="py-2 text-right" style={{ color: "var(--text-secondary)" }}>{entry.division}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data && (
        <p className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>
          Updated {new Date(data.updated_at).toLocaleString()}
        </p>
      )}
    </div>
  );
}
