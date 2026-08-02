"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

import { getAccessToken } from "@/lib/auth";
import {
  headToHeadApi,
  HeadToHeadAPIError,
  type HeadToHeadHistoryEntry,
} from "@/lib/head-to-head-api";

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
    return <p className="text-sm opacity-70" aria-busy="true">Loading your head-to-heads…</p>;
  }

  if (error) {
    return (
      <p className="text-sm opacity-80" role="status">
        {error}
      </p>
    );
  }

  if (matches.length === 0) {
    return (
      <p className="text-sm opacity-80" data-testid="h2h-history-empty">
        No head-to-heads yet. Finish a RUN THE TABLE run and challenge someone to the
        same board.
      </p>
    );
  }

  const rows = typeof limit === "number" ? matches.slice(0, limit) : matches;

  return (
    <ul className="divide-y divide-white/10" data-testid="h2h-history">
      {rows.map((m) => (
        <li key={m.match_id} className="flex items-center justify-between gap-4 py-3">
          <div>
            <Link
              href={`/arena/run-the-table/h2h/${m.match_id}`}
              className="text-sm underline"
            >
              vs {m.opponent_display_name ?? "an open invite"}
            </Link>
            <p className="text-xs opacity-60">
              {new Date(m.created_at).toLocaleDateString()} · you were the{" "}
              {m.your_role}
            </p>
          </div>
          <span className="text-sm" data-testid={`h2h-history-outcome-${m.match_id}`}>
            {outcomeLabel(m)}
          </span>
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
