"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Crown, RefreshCw } from "lucide-react";

import { getAccessToken } from "@/lib/auth";
import { getLeaderboard, getPersonalPlacement } from "@/lib/perfect-season-api";
import {
  COURT_MODE_LABELS,
  type CourtMode,
  type PerfectSeasonRunPublic,
} from "@/types/perfect-season";

/**
 * The 82-0 PEAK Season global leaderboard.
 *
 * WHAT THIS REPLACES, AND WHY IT WAS NOT MERELY PLAIN. The board was a
 * `runs.map()` of flex rows: an index, a handle, a `wins-losses` and a score.
 * It carried no date, no mode on the row, no way to see the run behind an
 * entry, no pagination past the first fifty, no "where am I", and no
 * distinction whatsoever for the entry at the top. A `catch` set
 * `enabled=false`, so a network failure and a disabled feature rendered the
 * identical sentence — "The global leaderboard isn't enabled yet." — which is
 * the single most misleading thing a board can say, because it sends a reader
 * to the wrong question. Retry was a page refresh.
 *
 * THE STATES ARE SEPARATE BECAUSE THEY MEAN DIFFERENT THINGS:
 *
 *   loading   the request is in flight
 *   disabled  the SERVER said `leaderboard_enabled: false`
 *   failed    the request did not complete — with a retry that retries
 *   empty     enabled, reachable, and nobody has submitted a run in this mode
 *   ranked    rows
 *
 * `failed` used to be folded into `disabled`, which is why the review found a
 * board that "isn't enabled yet" on an API where it was.
 *
 * NOTHING HERE DECIDES A RANK. Rows arrive in the server's own order (wins
 * desc, lineup score desc, fewer respins first, earliest submission first) and
 * are numbered by their position in that sequence, carried across pages by the
 * cursor. `Your best` and its rank come from `GET /leaderboard/me`, which reads
 * the same public rows — so the number beside your name is a position the board
 * would really show you at, not a count of the rows this component happens to
 * be holding.
 */

const MODES: CourtMode[] = ["apex_1y", "prime_3y", "foundation_5y"];
const PAGE_SIZE = 25;

type Phase = "loading" | "disabled" | "failed" | "ready";

interface Page {
  runs: PerfectSeasonRunPublic[];
  nextCursor: string | null;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export interface PeakSeasonLeaderboardProps {
  /** Injectable for tests; production uses the real endpoints. */
  fetchBoard?: typeof getLeaderboard;
  fetchPlacement?: typeof getPersonalPlacement;
  readToken?: typeof getAccessToken;
}

export default function PeakSeasonLeaderboard({
  fetchBoard = getLeaderboard,
  fetchPlacement = getPersonalPlacement,
  readToken = getAccessToken,
}: PeakSeasonLeaderboardProps = {}) {
  const [mode, setMode] = useState<CourtMode>("apex_1y");
  const [daily, setDaily] = useState(false);
  const [phase, setPhase] = useState<Phase>("loading");
  const [page, setPage] = useState<Page>({ runs: [], nextCursor: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [placement, setPlacement] = useState<{
    rank: number;
    run: PerfectSeasonRunPublic;
  } | null>(null);

  const load = useCallback(async () => {
    setPhase("loading");
    setPlacement(null);
    try {
      const result = await fetchBoard({ mode, limit: PAGE_SIZE, daily });
      if (!result.leaderboard_enabled) {
        setPhase("disabled");
        setPage({ runs: [], nextCursor: null });
        return;
      }
      setPage({ runs: result.runs, nextCursor: result.next_cursor ?? null });
      setPhase("ready");
    } catch {
      // A DISTINCT STATE. Folding this into `disabled` is what made a
      // reachable board report itself as a feature nobody had turned on.
      setPhase("failed");
      setPage({ runs: [], nextCursor: null });
    }
  }, [fetchBoard, mode, daily]);

  useEffect(() => {
    void load();
  }, [load]);

  // "Your best", read separately and never inferred from the rows on screen:
  // a reader's own entry is usually not on page one, and counting the rows a
  // component happens to hold would report a rank the board does not have.
  useEffect(() => {
    let cancelled = false;
    if (phase !== "ready") return;
    (async () => {
      try {
        const token = await readToken();
        if (!token) return;
        const result = await fetchPlacement(token, mode);
        if (cancelled) return;
        if (result.leaderboard_enabled && result.rank && result.run) {
          setPlacement({ rank: result.rank, run: result.run });
        }
      } catch {
        // A signed-out reader, or a placement lookup that failed, must never
        // cost anybody the board itself.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, mode, fetchPlacement, readToken]);

  const loadMore = useCallback(async () => {
    if (!page.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await fetchBoard({
        mode,
        limit: PAGE_SIZE,
        cursor: page.nextCursor,
        daily,
      });
      setPage((current) => ({
        runs: [...current.runs, ...result.runs],
        nextCursor: result.next_cursor ?? null,
      }));
    } catch {
      // Keep what is already on screen; the control stays available.
    } finally {
      setLoadingMore(false);
    }
  }, [fetchBoard, mode, daily, page.nextCursor, loadingMore]);

  return (
    <section className="ps-board" data-testid="peak-season-leaderboard" data-phase={phase}>
      <div className="ps-board-controls">
        <div className="ps-tabs" role="tablist" aria-label="Peak Season mode">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={m === mode}
              data-testid={`ps-board-mode-${m}`}
              className="ps-tab"
              onClick={() => setMode(m)}
            >
              {COURT_MODE_LABELS[m] ?? m}
            </button>
          ))}
        </div>
        <div className="ps-tabs" role="tablist" aria-label="Board window">
          {/* THE DAILY VIEW IS THE SAME BOARD, FILTERED. It is not a second
              table and it is not a second ranking: the API applies the
              identical query and tie-break order with `created_at >= today`.
              Labelled as a window rather than as a competition, because that
              is what it is. */}
          <button
            type="button"
            role="tab"
            aria-selected={!daily}
            data-testid="ps-board-window-all-time"
            className="ps-tab"
            onClick={() => setDaily(false)}
          >
            All-time
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={daily}
            data-testid="ps-board-window-today"
            className="ps-tab"
            onClick={() => setDaily(true)}
          >
            Submitted today
          </button>
        </div>
      </div>

      {phase === "loading" && (
        <p className="ps-board-state" role="status" data-testid="ps-board-loading">
          Loading the board…
        </p>
      )}

      {phase === "disabled" && (
        <div className="ps-board-state" data-testid="ps-board-disabled">
          <p className="ps-board-state-title">The global leaderboard isn&apos;t open yet</p>
          <p>
            Your completed runs are still saved to your own history, and every one
            of them can be submitted the moment this opens.
          </p>
        </div>
      )}

      {phase === "failed" && (
        <div className="ps-board-state" role="alert" data-testid="ps-board-failed">
          <p className="ps-board-state-title">The board could not be loaded</p>
          <p>This is a connection problem, not a closed feature.</p>
          <button
            type="button"
            className="ps-board-retry"
            data-testid="ps-board-retry"
            onClick={() => void load()}
          >
            <RefreshCw size={13} aria-hidden="true" />
            Try again
          </button>
        </div>
      )}

      {phase === "ready" && page.runs.length === 0 && (
        <div className="ps-board-state" data-testid="ps-board-empty">
          <p className="ps-board-state-title">
            {daily ? "Nothing submitted today yet" : "No runs on this board yet"}
          </p>
          <p>
            {daily
              ? "The all-time board still has every run ever submitted."
              : "The first completed, fully-scored roster submitted here takes the top spot."}
          </p>
          <Link className="ps-board-cta" href="/arena/court/daily" data-testid="ps-board-play">
            Build a roster
          </Link>
        </div>
      )}

      {phase === "ready" && page.runs.length > 0 && (
        <>
          <div className="ps-board-scroll">
            <table className="ps-table" data-testid="leaderboard-table">
              <caption className="sr-only">
                {COURT_MODE_LABELS[mode] ?? mode} 82-0 leaderboard,
                {daily ? " runs submitted today" : " all time"}. Ranked by wins,
                then lineup score, then fewer respins, then earliest submission.
              </caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Player</th>
                  <th scope="col">Record</th>
                  <th scope="col">Lineup score</th>
                  <th scope="col">Submitted</th>
                  <th scope="col">Seed</th>
                  <th scope="col">
                    <span className="sr-only">Verified roster</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.runs.map((run, index) => {
                  const rank = index + 1;
                  const isLeader = rank === 1;
                  const isYou = placement?.run.id === run.id;
                  return (
                    <tr
                      key={run.id}
                      data-testid="leaderboard-row"
                      data-rank={rank}
                      data-leader={isLeader ? "true" : "false"}
                      data-you={isYou ? "true" : "false"}
                    >
                      <td className="ps-rank">
                        {isLeader ? (
                          <span className="ps-crown" data-testid="ps-board-leader">
                            <Crown size={13} aria-hidden="true" />
                            <span className="sr-only">Leader,</span>1
                          </span>
                        ) : (
                          rank
                        )}
                      </td>
                      <td className="ps-name">
                        <span>{run.display_name}</span>
                        {isYou && (
                          <span className="ps-you" data-testid="ps-board-you-inline">
                            You
                          </span>
                        )}
                        {run.team_respins_used + run.season_respins_used > 0 && (
                          <span
                            className="ps-respins"
                            title={`${run.team_respins_used} team respins, ${run.season_respins_used} season respins`}
                          >
                            {run.team_respins_used + run.season_respins_used} respins
                          </span>
                        )}
                      </td>
                      <td className="ps-record">
                        {run.wins}&ndash;{run.losses}
                      </td>
                      <td className="ps-score">{run.lineup_score.toFixed(1)}</td>
                      <td className="ps-date">{formatDate(run.created_at)}</td>
                      <td className="ps-seed">{run.seed}</td>
                      <td className="ps-link">
                        {/* THE RECEIPT. Every submitted run is a completed game
                            whose result page is already public and already
                            carries the roster it was scored on — the same page
                            the sharer's own link points at. Nothing private is
                            exposed by linking it: `owner_sub` is not in this
                            payload and never has been. */}
                        <Link href={`/arena/court/results/${run.game_id}`} prefetch={false}>
                          Roster<span className="sr-only"> for {run.display_name}</span>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {page.nextCursor && (
            <button
              type="button"
              className="ps-board-more"
              data-testid="ps-board-more"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? "Loading…" : `Show more (${page.runs.length} shown)`}
            </button>
          )}
        </>
      )}

      {/* YOUR BEST, ALWAYS VISIBLE WHEN THERE IS ONE — including when it is
          nowhere near page one, which is the case it exists for. */}
      {phase === "ready" && placement && (
        <div className="ps-you-panel" data-testid="ps-board-your-best">
          <p className="ps-you-eyebrow">Your best on this board</p>
          <p className="ps-you-line">
            <span className="ps-you-rank">#{placement.rank}</span>
            <span>{placement.run.display_name}</span>
            <span className="ps-you-record">
              {placement.run.wins}&ndash;{placement.run.losses}
            </span>
            <span>{placement.run.lineup_score.toFixed(1)}</span>
            <span className="ps-date">{formatDate(placement.run.created_at)}</span>
          </p>
        </div>
      )}
    </section>
  );
}
