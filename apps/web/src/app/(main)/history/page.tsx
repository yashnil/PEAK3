"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { getAccessToken } from "@/lib/auth";

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
      router.push("/signin?returnTo=/history");
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
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--border-default)] border-t-[var(--peak-accent)]" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
          Match History
        </h1>
        <Link
          href="/profile"
          className="text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          ← Profile
        </Link>
      </div>

      {error && (
        <p role="alert" className="text-sm rounded-lg px-3 py-2" style={{ background: "#ef444420", color: "#ef4444" }}>
          {error}
        </p>
      )}

      {!fetching && history.length === 0 && (
        <div
          className="text-center py-16 text-sm"
          style={{ color: "var(--text-muted)" }}
        >
          No completed games yet.{" "}
          <Link href="/arena/daily" className="underline" style={{ color: "var(--peak-accent)" }}>
            Play today&apos;s Daily
          </Link>
        </div>
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
                  className="text-2xl font-bold tabular-nums"
                  style={{ color: "var(--peak-accent)" }}
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
                    style={{ background: "rgba(245,200,66,0.12)", color: "var(--peak-accent)" }}
                  >
                    Hold
                  </span>
                )}
                {item.reframe_used && (
                  <span
                    className="text-xs px-1.5 py-0.5 rounded"
                    style={{ background: "rgba(167,139,250,0.12)", color: "#a78bfa" }}
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
  );
}
