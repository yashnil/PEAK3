"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  arenaLobbyApi,
  ArenaAPIError,
  normaliseRoomCode,
  searchLabel,
  type ArenaMatchStub,
  type ArenaReadiness,
  type QueueStatus,
} from "@/lib/arena-lobby-api";
import {
  ENTRY_PATHS,
  HUMAN_PREFERENCE_SECONDS,
  offerableModes,
  type ArenaModeMeta,
  type EntryPathId,
} from "@/lib/arena-modes";

/**
 * The shared Arena lobby. One surface, every mode.
 *
 * MODE-AGNOSTIC BY CONSTRUCTION. There is no branch on a mode id anywhere in
 * this file. A mode is a row in `ARENA_MODES` plus a route; the server's
 * `readiness.modes` decides which rows are offerable. The Three-Man Weave plugs
 * in by existing in both places, not by editing this component.
 *
 * RATED STATE IS SHOWN BEFORE COMMITTING, NEVER DECIDED HERE. Each entry path
 * carries its own `rated` flag, mirroring the schema's
 * `CHECK (rated = (entry_path = 'public_queue'))`. A player sees "Rated" or
 * "Unrated" on the button they are about to press, so a match's status is never
 * a discovery made afterwards. Once a match exists the server's own `rated`
 * field is what any screen displays.
 *
 * WHAT THIS COMPONENT DOES NOT DO: pair players, decide when bots may fill,
 * or compute whether a match counts. All three are the matchmaker's, and two
 * are enforced in the database.
 */

const POLL_MS = 2000;

type Stage = "choose_mode" | "choose_path" | "searching" | "room_open";

export default function ArenaLobby() {
  const router = useRouter();
  const [readiness, setReadiness] = useState<ArenaReadiness | null>(null);
  const [mode, setMode] = useState<ArenaModeMeta | null>(null);
  const [stage, setStage] = useState<Stage>("choose_mode");
  const [queue, setQueue] = useState<QueueStatus | null>(null);
  const [room, setRoom] = useState<ArenaMatchStub | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const modeRef = useRef<ArenaModeMeta | null>(null);
  modeRef.current = mode;

  useEffect(() => {
    arenaLobbyApi
      .readiness()
      .then(setReadiness)
      .catch((err: ArenaAPIError) =>
        setError(
          err.status === 0 ? "Could not reach the PEAK3 API." : err.message,
        ),
      );
  }, []);

  const go = useCallback(
    (target: ArenaModeMeta, matchId: string) => router.push(target.matchPath(matchId)),
    [router],
  );

  const handle = useCallback((err: unknown) => {
    const apiError = err as ArenaAPIError;
    setError(apiError.status === 0 ? "Could not reach the PEAK3 API." : apiError.message);
  }, []);

  // Poll the queue while searching. Stops on match, on cancel and on unmount --
  // a lobby that kept polling behind a started match would keep a dead timer
  // alive and could navigate a player twice.
  useEffect(() => {
    if (stage !== "searching" || !mode) return;
    const id = setInterval(async () => {
      try {
        const status = await arenaLobbyApi.queueStatus(mode.id);
        setQueue(status);
        if (status.status === "matched" && status.match_id) {
          clearInterval(id);
          go(mode, status.match_id);
        }
      } catch (err) {
        handle(err);
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [stage, mode, go, handle]);

  // Poll a private room until it fills. It starts itself the moment the last
  // seat is taken -- there is no "start" button because the server needs no
  // such command.
  useEffect(() => {
    if (stage !== "room_open" || !room || !mode) return;
    const id = setInterval(async () => {
      try {
        const status = await arenaLobbyApi.queueStatus(mode.id).catch(() => null);
        void status;
        // A private room is not a queue entry; poll the match itself.
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/v1/arena/matches/${room.match_id}`,
          { credentials: "include" },
        );
        if (!res.ok) return;
        const view = (await res.json()) as ArenaMatchStub;
        setRoom(view);
        if (view.status === "active") {
          clearInterval(id);
          go(mode, view.match_id);
        }
      } catch {
        /* transient; the next tick retries */
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [stage, room, mode, go]);

  const start = useCallback(
    async (path: EntryPathId) => {
      if (!mode) return;
      setBusy(true);
      setError(null);
      try {
        if (path === "practice") {
          const match = await arenaLobbyApi.startPractice(mode.id);
          go(mode, match.match_id);
        } else if (path === "private_room") {
          const match = await arenaLobbyApi.createPrivate(mode.id);
          setRoom(match);
          setStage("room_open");
        } else {
          setQueue(await arenaLobbyApi.joinQueue(mode.id));
          setStage("searching");
        }
      } catch (err) {
        handle(err);
      } finally {
        setBusy(false);
      }
    },
    [mode, go, handle],
  );

  const cancelSearch = useCallback(async () => {
    if (!mode) return;
    try {
      await arenaLobbyApi.cancelQueue(mode.id);
    } catch (err) {
      handle(err);
    }
    setQueue(null);
    setStage("choose_path");
  }, [mode, handle]);

  const joinByCode = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const match = await arenaLobbyApi.joinPrivate(joinCode);
      const target = offerable.find((m) => m.id === match.mode);
      if (target) go(target, match.match_id);
      else setError("That room is for a mode this build does not know.");
    } catch (err) {
      handle(err);
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinCode, go, handle]);

  if (error && !readiness) {
    return (
      <p className="td-error" role="alert" data-testid="lobby-error">
        {error}
      </p>
    );
  }
  if (!readiness) {
    return <p data-testid="lobby-loading">Loading the Arena…</p>;
  }
  if (!readiness.arena_enabled) {
    return (
      <p data-testid="lobby-disabled">
        The Arena is not open yet. Check back soon.
      </p>
    );
  }

  const offerable = offerableModes(readiness.modes);

  return (
    <div className="td-game" data-testid="arena-lobby">
      <header className="td-header">
        <h1 className="td-title">Arena</h1>
      </header>

      {error ? (
        <p className="td-error" role="alert" data-testid="lobby-error">
          {error}
        </p>
      ) : null}

      {/* ---- mode choice ---- */}
      {stage === "choose_mode" ? (
        <section aria-labelledby="lobby-modes-heading">
          <h2 id="lobby-modes-heading" className="td-receipt-subheading">
            Choose a game
          </h2>
          {offerable.length === 0 ? (
            <p data-testid="lobby-no-modes">No games are available right now.</p>
          ) : (
            <ul className="td-slot-list">
              {offerable.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className="td-slot td-mode-card"
                    data-testid={`lobby-mode-${m.id}`}
                    onClick={() => {
                      setMode(m);
                      setStage("choose_path");
                    }}
                  >
                    <span className="td-slot-body">
                      <span>
                        <span className="td-slot-name">{m.name}</span>
                        <span className="td-positional-score">{m.tagline}</span>
                      </span>
                      <span className="td-slot-price">{m.seatCount}P</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Joining by code does not require choosing a mode first: the code
              already determines which game it is. */}
          <div className="td-bid" style={{ marginTop: "1rem" }}>
            <label className="td-bid-label" htmlFor="lobby-join-code">
              Have a game code?
            </label>
            <div className="td-bid-row">
              <input
                id="lobby-join-code"
                data-testid="lobby-join-code"
                className="td-code-input"
                value={joinCode}
                inputMode="text"
                autoCapitalize="characters"
                placeholder="ABC123"
                onChange={(e) => setJoinCode(normaliseRoomCode(e.target.value))}
              />
              <button
                type="button"
                className="td-btn"
                data-testid="lobby-join-submit"
                disabled={busy || joinCode.length !== 6}
                onClick={() => void joinByCode()}
              >
                Join
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {/* ---- entry path ---- */}
      {stage === "choose_path" && mode ? (
        <section aria-labelledby="lobby-paths-heading">
          <h2 id="lobby-paths-heading" className="td-receipt-subheading">
            {mode.name}
          </h2>
          <p className="td-candidate-meta">{mode.description}</p>

          <ul className="td-slot-list" style={{ marginTop: "1rem" }}>
            {ENTRY_PATHS.map((path) => {
              const unavailable =
                (path.id === "public_queue" && !readiness.public_queue_enabled) ||
                (path.id === "practice" && !readiness.bots_enabled);
              return (
                <li key={path.id}>
                  <button
                    type="button"
                    className="td-slot td-mode-card"
                    data-testid={`lobby-path-${path.id}`}
                    disabled={busy || unavailable}
                    onClick={() => void start(path.id)}
                  >
                    <span className="td-slot-body">
                      <span>
                        <span className="td-slot-name">{path.name}</span>
                        <span className="td-positional-score">{path.description}</span>
                      </span>
                      {/* The commitment moment: rated state is on the button
                          itself, not behind a tooltip or a later screen. */}
                      <span
                        className={path.rated ? "td-rated td-rated-on" : "td-rated"}
                        data-testid={`lobby-rated-${path.id}`}
                      >
                        {path.rated ? "Rated" : "Unrated"}
                      </span>
                    </span>
                  </button>
                  <p className="td-bid-hint" data-testid={`lobby-note-${path.id}`}>
                    {unavailable ? "Not available right now." : path.note}
                  </p>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            className="td-btn"
            data-testid="lobby-back"
            onClick={() => {
              setMode(null);
              setStage("choose_mode");
            }}
          >
            Back
          </button>
        </section>
      ) : null}

      {/* ---- searching ---- */}
      {stage === "searching" && mode ? (
        <section className="td-bid" aria-live="polite" data-testid="lobby-searching">
          <p className="td-bid-label">{mode.name} · public match</p>
          <p data-testid="lobby-search-label">{searchLabel(queue)}</p>
          <p className="td-bid-hint">
            {queue?.waited_seconds != null
              ? `Waiting ${Math.floor(queue.waited_seconds)}s.`
              : ""}{" "}
            We hold a seat for a human for {HUMAN_PREFERENCE_SECONDS} seconds. This
            match is rated either way.
          </p>
          <div className="td-bid-actions">
            {/* "Keep waiting" is the default and needs no command -- the poll
                above IS waiting. The button exists so the choice is explicit. */}
            <button
              type="button"
              className="td-btn td-btn-primary"
              data-testid="lobby-keep-waiting"
              onClick={() => setError(null)}
            >
              Keep waiting
            </button>
            <button
              type="button"
              className="td-btn"
              data-testid="lobby-cancel-search"
              onClick={() => void cancelSearch()}
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {/* ---- private room ---- */}
      {stage === "room_open" && room && mode ? (
        <section className="td-bid" aria-live="polite" data-testid="lobby-room">
          <p className="td-bid-label">{mode.name} · private game</p>
          <p className="td-bid-locked-amount" data-testid="lobby-room-code">
            {room.room_code ?? "······"}
          </p>
          <p className="td-bid-hint">
            Share this code. {room.seats.length} of {room.seat_count} seats taken.
            This game is unrated and starts by itself the moment every seat is
            filled — a private room is never filled automatically.
          </p>
          <button
            type="button"
            className="td-btn"
            data-testid="lobby-leave-room"
            onClick={() => {
              setRoom(null);
              setStage("choose_path");
            }}
          >
            Back
          </button>
        </section>
      ) : null}
    </div>
  );
}
