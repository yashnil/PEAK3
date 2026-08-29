"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

import { getAccessToken } from "@/lib/auth";
import {
  headToHeadApi,
  HeadToHeadAPIError,
  type HeadToHeadHistoryEntry,
} from "@/lib/head-to-head-api";
import { StatusChip, type StatusChipTone } from "@/components/ui/StatusChip";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * Head-to-head history (spec §6, "Experience": profile history).
 *
 * SPOILER-SAFE. `your_outcome` is `null` for any match that has not settled,
 * because a list view is exactly where a player with a match still open would
 * otherwise read the answer. The server withholds it; this renders "In
 * progress" rather than inferring one.
 *
 * Usable both as the head-to-head hub page and, embedded, as a profile
 * section -- it takes no props and reads only the signed-in caller's own
 * matches.
 */
export default function HeadToHeadHistory({ limit }: { limit?: number }) {
  const [matches, setMatches] = useState<HeadToHeadHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getAccessToken();
      if (!token) {
        if (!cancelled) {
          setError("Sign in to see your head-to-head history.");
          setMatches([]);
        }
        return;
      }
      try {
        const data = await headToHeadApi.getHistory(token);
        if (!cancelled) setMatches(data.matches);
      } catch (err) {
        if (!cancelled) {
          setError((err as HeadToHeadAPIError).message);
          setMatches([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (matches === null) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }} aria-busy="true">
        Loading your head-to-heads…
      </p>
    );
  }

  if (error) {
    return (
      <p className="text-sm" style={{ color: "var(--text-secondary)" }} role="status">
        {error}
      </p>
    );
  }

  if (matches.length === 0) {
    return (
      <div data-testid="h2h-history-empty">
        <EmptyState
          title="No head-to-heads yet"
          description="Finish a RUN THE TABLE run and challenge someone to the same board."
        />
      </div>
    );
  }

  const rows = typeof limit === "number" ? matches.slice(0, limit) : matches;

  return (
    <ul className="divide-y" style={{ borderColor: "var(--border-subtle)" }} data-testid="h2h-history">
      {rows.map((m) => (
        <li key={m.match_id} className="flex items-center justify-between gap-4 py-3">
          <div>
            <Link
              href={`/arena/run-the-table/h2h/${m.match_id}`}
              className="text-sm underline"
              style={{ color: "var(--text-primary)" }}
            >
              vs {m.opponent_display_name ?? "an open invite"}
            </Link>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {new Date(m.created_at).toLocaleDateString()} · you were the{" "}
              {m.your_role}
            </p>
          </div>
          <StatusChip
            tone={outcomeTone(m)}
            data-testid={`h2h-history-outcome-${m.match_id}`}
          >
            {outcomeLabel(m)}
          </StatusChip>
        </li>
      ))}
    </ul>
  );
}

function outcomeLabel(m: HeadToHeadHistoryEntry): string {
  if (!m.your_outcome) return "In progress";
  if (m.your_outcome === "draw") return "Draw";
  return m.your_outcome === "won" ? "Won" : "Lost";
}

function outcomeTone(m: HeadToHeadHistoryEntry): StatusChipTone {
  if (!m.your_outcome) return "muted";
  if (m.your_outcome === "won") return "positive";
  if (m.your_outcome === "lost") return "negative";
  return "neutral";
}
