"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { getAccessToken } from "@/lib/auth";
import { signInHref } from "@/lib/supabase/safe-next";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import PeakV2SecondaryAction from "@/components/v2/PeakV2SecondaryAction";
import { PersonalPageLoading } from "@/components/ui/PersonalPageLoading";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface HistoryItem {
  id: string;
  board_type: string;
  mode: string;
  date: string | null;
  board_id: string;
  lineup_peak_rating: number;
  draft_efficiency: number | null;
  board_percentile: number | null;
  hold_used: boolean | null;
  reframe_used: boolean | null;
  completed_at: string;
}

interface HistoryResponse {
  items: HistoryItem[];
  next_cursor: string | null;
  total: number;
}

const MODE_LABELS: Record<string, string> = {
  apex_1y: "1Y Apex",
  prime_3y: "3Y Prime",
  foundation_5y: "5Y Foundation",
};

const BOARD_TYPE_LABELS: Record<string, string> = {
  daily: "Daily",
  practice: "Practice",
  challenge: "Challenge",
};

export default function HistoryPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push(signInHref("/history"));
      return;
    }
    loadHistory(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading, router]);

  async function loadHistory(beforeId: string | null) {
    setFetching(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");
      const params = new URLSearchParams({ limit: "20" });
      if (beforeId) params.set("before_id", beforeId);
      const res = await fetch(`${API_BASE}/api/v1/history?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load history");
      const data: HistoryResponse = await res.json();
      setHistory((prev) => (beforeId ? [...prev, ...data.items] : data.items));
      setCursor(data.next_cursor);
      setHasMore(data.next_cursor !== null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history.");
    } finally {
      setFetching(false);
    }
  }

  if (loading) {
    return <PersonalPageLoading />;
  }

  if (!user) return null;

  return (
    <PeakV2Shell width="live">
      <header className="v2-page-header">
        <p className="v2-page-kicker">Record</p>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="v2-page-title">Match History</h1>
          <PeakV2SecondaryAction href="/profile" size="sm">
            ← Profile
          </PeakV2SecondaryAction>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-2">
      {error && <ErrorState message={error} />}

      {!fetching && history.length === 0 && (
        <EmptyState
          title="No completed games yet"
          action={
            <Link href="/arena/daily" className="text-sm underline" style={{ color: "var(--peak-accent-text)" }}>
              Play today&apos;s Daily
            </Link>
          }
        />
      )}

      <div className="flex flex-col gap-3">
        {history.map((item) => (
          <div
            key={item.id}
            className="rounded-xl border p-4 flex flex-col gap-2"
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--border-subtle)",
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className="text-xs px-2 py-0.5 rounded font-semibold"
                  style={{
                    background: "var(--bg-elevated)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {BOARD_TYPE_LABELS[item.board_type] ?? item.board_type}
                </span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {MODE_LABELS[item.mode] ?? item.mode}
                </span>
              </div>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {new Date(item.completed_at).toLocaleDateString()}
              </span>
            </div>

            <div className="flex items-end gap-3">
              <div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Lineup Peak Rating
                </div>
                <div
                  className="score-number text-2xl font-bold"
                  style={{ color: "var(--peak-accent-text)" }}
                >
                  {(Math.round(item.lineup_peak_rating * 10) / 10).toFixed(1)}
                </div>
              </div>
              {item.draft_efficiency != null && (
                <div className="mb-1">
                  <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    {Math.round(item.draft_efficiency * 100)}%
                  </span>
                  <span className="text-xs ml-1" style={{ color: "var(--text-muted)" }}>
                    efficiency
                  </span>
                </div>
              )}
              {item.board_percentile != null && (
                <div className="mb-1">
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Top {Math.round(item.board_percentile)}%
                  </span>
                </div>
              )}
            </div>

            {(item.hold_used || item.reframe_used) && (
              <div className="flex gap-1">
                {item.hold_used && (
                  <span
                    className="text-xs px-1.5 py-0.5 rounded"
                    style={{ background: "var(--peak-accent-bg)", color: "var(--peak-accent-text)" }}
                  >
                    Hold
                  </span>
                )}
                {item.reframe_used && (
                  <span
                    className="text-xs px-1.5 py-0.5 rounded"
                    style={{ background: "color-mix(in srgb, var(--accent-violet) 12%, transparent)", color: "var(--accent-violet)" }}
                  >
                    Reframe
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {hasMore && (
        <button
          onClick={() => cursor && loadHistory(cursor)}
          disabled={fetching}
          className="w-full py-2.5 rounded-lg text-sm font-medium disabled:opacity-60"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-default)",
            color: "var(--text-secondary)",
          }}
        >
          {fetching ? "Loading…" : "Load more"}
        </button>
      )}
      </div>
    </PeakV2Shell>
  );
}
