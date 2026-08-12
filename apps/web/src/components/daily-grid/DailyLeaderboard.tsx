"use client";

/**
 * TODAY'S LEADERBOARD — the Daily Grid's public daily board (A2).
 *
 * RENDERS WHAT THE SERVER RANKED, AND NOTHING ELSE. Ranks, ordering and the
 * caller's own standing all arrive computed from
 * `GET /api/v1/daily-grid/leaderboard`; this component never sorts, never
 * numbers, and never invents a placement. When the caller sits outside the
 * returned top rows, their real rank renders in a separated "You" row — the
 * server said it, so it can be shown; when they have no entry or no handle,
 * the honest state renders instead.
 *
 * DELIBERATELY SECONDARY to the result it sits under: the completion panel's
 * verdict and numbers stay the headline, and this is a compact table below
 * them, not a second screen.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  DailyLeaderboardResponse,
  fetchDailyLeaderboard,
} from "@/lib/daily-grid-api";
import { useAuth } from "@/lib/auth-context";
import { getAccessToken } from "@/lib/auth";

/** mm:ss.t — the same reading the brief's own mock uses (00:42.8). */
export function formatCompletionTime(ms: number | null): string {
  if (ms === null) return "—";
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${seconds < 10 ? "0" : ""}${seconds.toFixed(1)}`;
}

export default function DailyLeaderboard({
  date,
  /** An archive replay is not today's competition; the board it belongs to is
   *  that DAY's, shown read-only. */
  isArchiveBoard = false,
  /** Bumped by the parent when the official save lands, so a board fetched a
   *  beat before the player's own entry existed refetches and shows it. */
  refreshKey = 0,
}: {
  date: string;
  isArchiveBoard?: boolean;
  refreshKey?: number;
}) {
  const { user, supabaseEnabled } = useAuth();
  const [board, setBoard] = useState<DailyLeaderboardResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const accessToken = await getAccessToken();
        const response = await fetchDailyLeaderboard({ date, limit: 10, accessToken });
        if (!cancelled) {
          setBoard(response);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date, user?.id, refreshKey]);

  // A failed read is a quiet absence, not an error banner over a result the
  // player just earned — the leaderboard is secondary here by design.
  if (failed) return null;
  if (board === null) {
    return (
      <section data-testid="daily-leaderboard" aria-label="Today's leaderboard" className="mt-5">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>
          {isArchiveBoard ? `Leaderboard · ${date}` : "Today's leaderboard"}
        </h3>
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }} data-testid="daily-leaderboard-loading">
          Loading…
        </p>
      </section>
    );
  }

  const you = board.you;
  const youInTop = board.entries.some((row) => row.is_current_user);

  return (
    <section data-testid="daily-leaderboard" aria-label="Today's leaderboard" className="mt-5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>
          {isArchiveBoard ? `Leaderboard · ${date}` : "Today's leaderboard"}
        </h3>
        {board.total_listed > 0 && (
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }} data-testid="daily-leaderboard-count">
            {board.total_listed} on the board
          </span>
        )}
      </div>

      {board.entries.length === 0 ? (
        <p className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }} data-testid="daily-leaderboard-empty">
          {isArchiveBoard
            ? // Only same-day completions ever qualified, so a past day's
              // board with no rows will never gain any — say that, rather
              // than inviting an entry that cannot happen.
              "No entries for this day."
            : "Be the first to finish today’s challenge."}
        </p>
      ) : (
        <ol className="mt-2 flex flex-col" data-testid="daily-leaderboard-rows">
          {board.entries.map((row) => (
            <li
              key={`${row.rank}-${row.handle}`}
              data-testid={`daily-leaderboard-row-${row.rank}`}
              data-you={row.is_current_user ? "true" : "false"}
              className="grid grid-cols-[2.2rem_minmax(0,1fr)_3.5rem_4.5rem] items-baseline gap-2 rounded px-2 py-1.5 text-xs"
              style={{
                background: row.is_current_user ? "var(--peak-accent-bg, rgba(245,200,66,0.08))" : "transparent",
                // Top three get the accent tint on the RANK, not a bigger row —
                // subtle by instruction.
                color: "var(--text-primary)",
              }}
            >
              <span
                className="score-number font-bold"
                style={{ color: row.rank <= 3 ? "var(--peak-accent-text)" : "var(--text-muted)" }}
              >
                #{row.rank}
              </span>
              <span className="truncate font-semibold">
                {row.handle}
                {row.is_current_user && (
                  <span className="ml-1.5 text-[9px] font-bold uppercase" style={{ color: "var(--peak-accent-text)" }}>
                    you
                  </span>
                )}
              </span>
              <span className="score-number text-right">{row.score}</span>
              <span className="score-number text-right" style={{ color: "var(--text-secondary)" }}>
                {formatCompletionTime(row.completion_time_ms)}
              </span>
            </li>
          ))}
        </ol>
      )}

      {/* THE CALLER'S OWN STANDING, only when it is real. Three honest states
          beyond "visible in the top rows above". */}
      {you && you.has_entry && you.listed && !youInTop && (
        <div
          data-testid="daily-leaderboard-you"
          className="mt-1.5 grid grid-cols-[2.2rem_minmax(0,1fr)_3.5rem_4.5rem] items-baseline gap-2 rounded px-2 py-1.5 text-xs"
          style={{
            background: "var(--peak-accent-bg, rgba(245,200,66,0.08))",
            borderTop: "1px dashed var(--border-default)",
            color: "var(--text-primary)",
          }}
        >
          <span className="score-number font-bold" style={{ color: "var(--peak-accent-text)" }}>
            #{you.rank}
          </span>
          <span className="font-semibold">You</span>
          <span className="score-number text-right">{you.score}</span>
          <span className="score-number text-right" style={{ color: "var(--text-secondary)" }}>
            {formatCompletionTime(you.completion_time_ms)}
          </span>
        </div>
      )}
      {you && you.has_entry && !you.has_handle && (
        <p className="mt-2 text-[11px]" style={{ color: "var(--text-secondary)" }} data-testid="daily-leaderboard-handle-cta">
          Your result is in — <Link href="/profile" className="underline" style={{ color: "var(--peak-accent-text)" }}>choose a public handle</Link> to appear on the board.
        </p>
      )}
      {!user && supabaseEnabled && !isArchiveBoard && (
        <p className="mt-2 text-[11px]" style={{ color: "var(--text-secondary)" }} data-testid="daily-leaderboard-signin-cta">
          <Link href="/signin" className="underline" style={{ color: "var(--peak-accent-text)" }}>
            Sign in
          </Link>{" "}
          to appear on today&rsquo;s leaderboard.
        </p>
      )}
    </section>
  );
}
