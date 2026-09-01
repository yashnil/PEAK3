"use client";

import { useEffect, useState } from "react";
import { rankedApi } from "@/lib/ranked-api";
import { analytics } from "@/lib/analytics";
import { RANKED_MODE_LABELS, type LeaderboardResponse, type RankedMode } from "@/types/ranked";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import PeakV2SecondaryAction from "@/components/v2/PeakV2SecondaryAction";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { cn } from "@/lib/utils";

interface Props {
  mode: RankedMode;
}

type LoadState = "loading" | "loaded" | "error";

const HEADER_CLASS =
  "px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]";

export default function RankedLeaderboard({ mode }: Props) {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    setState("loading");
    analytics.track({ type: "ranked_leaderboard_viewed", mode });
    rankedApi
      .getLeaderboard(mode)
      .then((res) => {
        setData(res);
        setState("loaded");
      })
      .catch(() => setState("error"));
  }, [mode]);

  return (
    <PeakV2Shell width="live">
      <header className="v2-page-header">
        <p className="v2-page-kicker">Competitive</p>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="v2-page-title">{RANKED_MODE_LABELS[mode]} Leaderboard</h1>
          <PeakV2SecondaryAction href={`/arena/ranked/${mode}`} size="sm">
            Back to queue
          </PeakV2SecondaryAction>
        </div>
      </header>

      {state === "loading" && (
        <div className="mt-6 flex flex-col gap-2">
          <p role="status" className="sr-only">
            Loading leaderboard…
          </p>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} height={40} />
          ))}
        </div>
      )}

      {state === "error" && (
        <div className="mt-6">
          <ErrorState message="Could not load the leaderboard." />
        </div>
      )}

      {state === "loaded" && data && !data.enabled && (
        <div className="mt-6">
          <EmptyState
            title="Leaderboard not open yet"
            description="The public leaderboard is not enabled yet."
          />
        </div>
      )}

      {state === "loaded" && data && data.enabled && data.entries.length === 0 && (
        <div className="mt-6">
          <EmptyState
            title="No established players yet"
            description="A rating needs 7 completed placement matches before it appears here."
          />
        </div>
      )}

      {state === "loaded" && data && data.enabled && data.entries.length > 0 && (
        <div
          className="mt-6 overflow-x-auto rounded-xl border"
          style={{ background: "var(--bg-surface-data)", borderColor: "var(--border-default)" }}
        >
          <table className="w-full text-sm" data-testid="leaderboard-table">
            <caption className="sr-only">{RANKED_MODE_LABELS[mode]} ranked leaderboard</caption>
            <thead>
              <tr
                className="border-b-2 border-[var(--divider-strong)] text-left"
                style={{ background: "var(--bg-elevated)" }}
              >
                <th scope="col" className={cn(HEADER_CLASS, "w-16")}>
                  Rank
                </th>
                <th scope="col" className={HEADER_CLASS}>
                  Player
                </th>
                <th scope="col" className={cn(HEADER_CLASS, "text-right")}>
                  Rating
                </th>
                <th scope="col" className={cn(HEADER_CLASS, "text-right")}>
                  Division
                </th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((entry) => (
                <tr
                  key={entry.handle}
                  className="border-b border-[var(--divider-strong)] transition-colors hover:bg-[var(--bg-surface-hover)]"
                >
                  <td className="score-number px-3 py-2.5" style={{ color: "var(--text-secondary)" }}>
                    {entry.rank}
                  </td>
                  <td className="px-3 py-2.5" style={{ color: "var(--text-primary)" }}>
                    @{entry.handle}
                  </td>
                  <td
                    className="score-number px-3 py-2.5 text-right font-bold"
                    style={{ color: "var(--peak-accent-text)" }}
                  >
                    {entry.rating.toFixed(0)}
                  </td>
                  <td className="px-3 py-2.5 text-right" style={{ color: "var(--text-secondary)" }}>
                    {entry.division}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <p className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>
          Updated {new Date(data.updated_at).toLocaleString()}
        </p>
      )}
    </PeakV2Shell>
  );
}
