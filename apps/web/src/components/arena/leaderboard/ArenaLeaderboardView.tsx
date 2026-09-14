"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";

import "./arena-leaderboard.css";

import { useAuth } from "@/lib/auth-context";
import {
  arenaStandingsApi,
  ArenaStandingsError,
  type ArenaLeaderboardResponse,
  type ArenaStandingsApi,
} from "@/lib/arena-leaderboard-api";
import { HUMAN_PREFERENCE_SECONDS } from "@/lib/arena-modes";
import { signInHref } from "@/lib/supabase/safe-next";

import AroundYouPanel, { type AroundYouState } from "./AroundYouPanel";
import SkillCard from "./SkillCard";
import TopPlayersTable from "./TopPlayersTable";
import { modeLabel, populationNote, unlistedNote } from "./leaderboard-copy";

/**
 * The Arena multiplayer leaderboard for one mode.
 *
 * STATES ARE SEPARATE BECAUSE THEY MEAN DIFFERENT THINGS — the lesson
 * `PeakSeasonLeaderboard` records: a failed request must never read as a
 * closed feature.
 *
 *   loading       the request is in flight
 *   arena_off     the Arena itself is not enabled on this server
 *   disabled      the server said `leaderboard_enabled: false`
 *   unknown_mode  the server does not register this mode
 *   failed        the request did not complete — with a retry
 *   ready         rows, or an honest empty board with the server's counts
 *
 * NO POPULATION IS FAKED. Counts, ranks, tiers and percentiles are the
 * server's; when one is withheld the server's reason is shown as a sentence.
 * Bots are never listed, and every rating is shown beside its all-human vs
 * with-bots split.
 */

const PAGE_SIZE = 50;

type BoardState =
  | { phase: "loading" }
  | { phase: "arena_off" }
  | { phase: "disabled" }
  | { phase: "unknown_mode" }
  | { phase: "failed" }
  | { phase: "ready"; data: ArenaLeaderboardResponse; loadingMore: boolean };

export interface ArenaLeaderboardViewProps {
  mode: string;
  /** Injectable for tests; production uses the real endpoints. */
  api?: ArenaStandingsApi;
}

export default function ArenaLeaderboardView({ mode, api = arenaStandingsApi }: ArenaLeaderboardViewProps) {
  const { user, loading: authLoading } = useAuth();
  const [modes, setModes] = useState<string[]>([mode]);
  const [board, setBoard] = useState<BoardState>({ phase: "loading" });
  const [around, setAround] = useState<AroundYouState>({ kind: "loading" });
  const boardRequest = useRef(0);
  const aroundRequest = useRef(0);

  useEffect(() => {
    let cancelled = false;
    api
      .modes()
      .then((list) => {
        if (!cancelled && list.length > 0) setModes(list.map((m) => m.id));
      })
      .catch(() => {
        // The switcher falls back to the mode being viewed; the board itself
        // does not depend on this call.
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const loadBoard = useCallback(async () => {
    const request = ++boardRequest.current;
    setBoard({ phase: "loading" });
    try {
      const data = await api.topPlayers(mode, { limit: PAGE_SIZE, offset: 0 });
      if (request !== boardRequest.current) return;
      setBoard(data.leaderboard_enabled ? { phase: "ready", data, loadingMore: false } : { phase: "disabled" });
    } catch (error) {
      if (request !== boardRequest.current) return;
      if (error instanceof ArenaStandingsError && error.status === 404) {
        setBoard({ phase: "unknown_mode" });
      } else if (error instanceof ArenaStandingsError && error.code === "arena_not_enabled") {
        setBoard({ phase: "arena_off" });
      } else {
        setBoard({ phase: "failed" });
      }
    }
  }, [api, mode]);

  const loadAround = useCallback(async () => {
    const request = ++aroundRequest.current;
    setAround({ kind: "loading" });
    try {
      const data = await api.aroundMe(mode);
      if (request === aroundRequest.current) setAround({ kind: "ready", data });
    } catch {
      if (request === aroundRequest.current) setAround({ kind: "failed" });
    }
  }, [api, mode]);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  const signedIn = !authLoading && !!user;
  useEffect(() => {
    if (signedIn) void loadAround();
  }, [signedIn, loadAround]);

  const loadMore = useCallback(async () => {
    if (board.phase !== "ready" || board.loadingMore) return;
    const current = board.data;
    setBoard({ ...board, loadingMore: true });
    try {
      const next = await api.topPlayers(mode, { limit: PAGE_SIZE, offset: current.entries.length });
      setBoard({
        phase: "ready",
        loadingMore: false,
        data: { ...next, entries: [...current.entries, ...next.entries] },
      });
    } catch {
      setBoard({ phase: "ready", data: current, loadingMore: false });
    }
  }, [api, mode, board]);

  // Signed-out is derived, not stored: no request is made for a reader with
  // no account, and nothing has to be reset when auth resolves.
  const aroundState: AroundYouState = authLoading
    ? { kind: "loading" }
    : !user
      ? { kind: "signed_out" }
      : around;
  const me = aroundState.kind === "ready" && aroundState.data.leaderboard_enabled ? aroundState.data.me : null;
  const label = modeLabel(mode);

  return (
    <div className="alb" data-testid="arena-leaderboard" data-phase={board.phase}>
      <header>
        <p className="alb-eyebrow">PEAK3 Arena · Rated multiplayer</p>
        <h1 className="alb-title">{label} leaderboard</h1>
        <p className="alb-intro">
          Ratings come from public matches only; practice and private rooms never count. Bots are never
          listed.
        </p>
      </header>

      <nav className="alb-modes" aria-label="Leaderboard mode">
        {modes.map((id) => (
          <Link
            key={id}
            href={`/arena/leaderboard/${encodeURIComponent(id)}`}
            className="alb-mode-link"
            aria-current={id === mode ? "page" : undefined}
            data-testid={`alb-mode-${id}`}
          >
            {modeLabel(id)}
          </Link>
        ))}
      </nav>

      <div className="alb-grid">
        <section className="alb-panel" aria-labelledby="alb-top-title">
          <h2 id="alb-top-title" className="alb-panel-title">
            Top players
          </h2>

          {board.phase === "loading" && (
            <p role="status" data-testid="alb-board-loading">
              Loading the board…
            </p>
          )}

          {board.phase === "arena_off" && (
            <div data-testid="alb-board-arena-off">
              <p className="alb-state-title">The Arena is not open on this server</p>
              <p>Multiplayer ratings appear here once it is.</p>
            </div>
          )}

          {board.phase === "disabled" && (
            <div data-testid="alb-board-disabled">
              <p className="alb-state-title">The rated leaderboard isn&apos;t open yet</p>
              <p>Public matches still record results; the board opens once ratings are published.</p>
            </div>
          )}

          {board.phase === "unknown_mode" && (
            <div data-testid="alb-board-unknown">
              <p className="alb-state-title">There is no rated board for this mode</p>
              <p>Pick one of the modes above.</p>
            </div>
          )}

          {board.phase === "failed" && (
            <div role="alert" data-testid="alb-board-failed">
              <p className="alb-state-title">The board could not be loaded</p>
              <p>This is a connection problem, not a closed feature.</p>
              <button type="button" className="alb-button" onClick={() => void loadBoard()} data-testid="alb-board-retry">
                <RefreshCw size={13} aria-hidden="true" />
                Try again
              </button>
            </div>
          )}

          {board.phase === "ready" && board.data.population.rated_population === 0 && (
            <div data-testid="alb-board-empty">
              <p className="alb-state-title">No rated players yet</p>
              <p>
                The first public match to finish puts its players here. Nobody is placed on this board
                until they have actually played.
              </p>
              <Link className="alb-link" href={`/arena/lobby?game=${encodeURIComponent(mode)}`}>
                Find a public match
              </Link>
            </div>
          )}

          {board.phase === "ready" && board.data.population.rated_population > 0 && (
            <>
              <p className="alb-note" data-testid="alb-population-note">
                {populationNote(board.data.population)}
              </p>
              {board.data.entries.length > 0 ? (
                <TopPlayersTable entries={board.data.entries} mode={mode} youHandle={me?.listed ? me.handle : null} />
              ) : (
                <p className="alb-note" data-testid="alb-board-none-listed">
                  No rated player has chosen a public handle yet, so nobody is listed.
                </p>
              )}
              {board.data.entries.length < board.data.total_rated_players && (
                <button
                  type="button"
                  className="alb-button alb-more"
                  disabled={board.loadingMore}
                  onClick={() => void loadMore()}
                  data-testid="alb-board-more"
                >
                  {board.loadingMore
                    ? "Loading…"
                    : `Show more (${board.data.entries.length} of ${board.data.total_rated_players})`}
                </button>
              )}
              {unlistedNote(board.data.population) && (
                <p className="alb-note" data-testid="alb-unlisted-note">
                  {unlistedNote(board.data.population)}
                </p>
              )}
              <p className="alb-note" data-testid="alb-bot-disclosure">
                A public match still waiting after {HUMAN_PREFERENCE_SECONDS} seconds is completed with bots
                and stays rated, scored against each bot&apos;s fixed calibrated rating. The Opponents column
                shows how many of each player&apos;s rated matches were all-human.
              </p>
            </>
          )}
        </section>

        <aside className="alb-side" aria-label="Your standing">
          {me && <SkillCard skill={me} mode={mode} />}
          {!(aroundState.kind === "ready" && !aroundState.data.leaderboard_enabled) && (
            <AroundYouPanel
              state={aroundState}
              mode={mode}
              signInHref={signInHref(`/arena/leaderboard/${encodeURIComponent(mode)}`)}
              onRetry={() => void loadAround()}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
