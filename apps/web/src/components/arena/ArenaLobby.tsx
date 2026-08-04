"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

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
  seatLabel,
  type EntryPathId,
  type OfferableMode,
} from "@/lib/arena-modes";
import HowToPlay from "@/components/arena/HowToPlay";

/**
 * The shared Arena lobby. One surface, every mode.
 *
 * MODE-AGNOSTIC BY CONSTRUCTION. There is no branch on a mode id anywhere in
 * this file. A mode is a row in `ARENA_MODES` plus a route; the server's
 * `readiness.modes` decides which rows are offerable. A new mode plugs in by
 * existing in both places, not by editing this component.
 *
 * WHAT THE REDESIGN CHANGED, AND WHY. The previous lobby was a three-STAGE
 * wizard: pick a game, then pick an entry path, then watch a queue — one
 * decision per screen, each screen mostly empty. Three clicks to reach "play
 * bots", and no screen ever showed both games at once, so the surface could not
 * answer the first question a visitor has ("what is here?"). It is now one
 * screen: both games, each with its three actions on the card. Stage state
 * survives only for the two flows that genuinely have a second step — a public
 * queue that is searching, and a private room waiting on a code.
 *
 * RATED STATE IS SHOWN BEFORE COMMITTING, NEVER DECIDED HERE. Each entry path
 * carries its own `rated` flag, mirroring the schema's
 * `CHECK (rated = (entry_path = 'public_queue'))`. A player sees "Rated" or
 * "Unrated" on the control they are about to press, so a match's status is
 * never a discovery made afterwards. Once a match exists the server's own
 * `rated` field is what any screen displays.
 *
 * WHAT THIS COMPONENT DOES NOT DO: pair players, decide when bots may fill, or
 * compute whether a match counts. All three are the matchmaker's, and two are
 * enforced in the database.
 */

const POLL_MS = 2000;

/** A submission is in flight for exactly one (mode, path) pair at a time. */
type Pending = { modeId: string; path: EntryPathId } | null;

export default function ArenaLobby() {
  const router = useRouter();
  const params = useSearchParams();
  const [readiness, setReadiness] = useState<ArenaReadiness | null>(null);
  const [queueMode, setQueueMode] = useState<OfferableMode | null>(null);
  const [queue, setQueue] = useState<QueueStatus | null>(null);
  const [room, setRoom] = useState<ArenaMatchStub | null>(null);
  const [roomMode, setRoomMode] = useState<OfferableMode | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joinOpenFor, setJoinOpenFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  // A redirect happens exactly once per lobby session. Without this a queue
  // poll that resolves while `router.push` is already navigating fires a second
  // push, and the player lands on the match twice in their history.
  const navigated = useRef(false);

  useEffect(() => {
    arenaLobbyApi
      .readiness()
      .then(setReadiness)
      .catch((err: ArenaAPIError) =>
        setError(err.status === 0 ? "Could not reach the PEAK3 API." : err.message),
      );
  }, []);

  const offerable = useMemo(
    () => (readiness ? offerableModes(readiness.modes) : []),
    [readiness],
  );

  const go = useCallback(
    (target: OfferableMode, matchId: string) => {
      if (navigated.current) return;
      navigated.current = true;
      router.push(target.matchPath(matchId));
    },
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
    if (!queueMode) return;
    const id = setInterval(async () => {
      try {
        const status = await arenaLobbyApi.queueStatus(queueMode.id);
        setQueue(status);
        if (status.status === "matched" && status.match_id) {
          clearInterval(id);
          go(queueMode, status.match_id);
        }
      } catch (err) {
        handle(err);
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [queueMode, go, handle]);

  // Poll a private room until it fills. It starts itself the moment the last
  // seat is taken -- there is no "start" button because the server needs no
  // such command.
  useEffect(() => {
    if (!room || !roomMode) return;
    const id = setInterval(async () => {
      try {
        const view = await arenaLobbyApi.getMatch(room.match_id);
        setRoom(view);
        if (view.status === "active") {
          clearInterval(id);
          go(roomMode, view.match_id);
        }
      } catch {
        /* transient; the next tick retries */
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [room, roomMode, go]);

  const start = useCallback(
    async (mode: OfferableMode, path: EntryPathId) => {
      if (pending) return; // one submission at a time; a double click is not two matches
      setPending({ modeId: mode.id, path });
      setError(null);
      try {
        if (path === "practice") {
          const match = await arenaLobbyApi.startPractice(mode.id);
          go(mode, match.match_id);
        } else if (path === "private_room") {
          const match = await arenaLobbyApi.createPrivate(mode.id);
          setRoomMode(mode);
          setRoom(match);
        } else {
          const status = await arenaLobbyApi.joinQueue(mode.id);
          if (status.status === "matched" && status.match_id) {
            go(mode, status.match_id);
          } else {
            setQueueMode(mode);
            setQueue(status);
          }
        }
      } catch (err) {
        handle(err);
      } finally {
        setPending(null);
      }
    },
    [pending, go, handle],
  );

  const cancelSearch = useCallback(async () => {
    if (!queueMode) return;
    try {
      await arenaLobbyApi.cancelQueue(queueMode.id);
    } catch (err) {
      handle(err);
    }
    setQueue(null);
    setQueueMode(null);
  }, [queueMode, handle]);

  const fillNow = useCallback(async () => {
    if (!queueMode) return;
    try {
      const status = await arenaLobbyApi.fillWithBotsNow(queueMode.id);
      if (status.status === "matched" && status.match_id) go(queueMode, status.match_id);
    } catch (err) {
      handle(err);
    }
  }, [queueMode, go, handle]);

  const fillRoom = useCallback(async () => {
    if (!room || !roomMode) return;
    try {
      const view = await arenaLobbyApi.fillRoomWithBots(room.match_id);
      setRoom(view);
      if (view.status === "active") go(roomMode, view.match_id);
    } catch (err) {
      handle(err);
    }
  }, [room, roomMode, go, handle]);

  const joinByCode = useCallback(async () => {
    setPending({ modeId: joinOpenFor ?? "", path: "private_room" });
    setError(null);
    try {
      const match = await arenaLobbyApi.joinPrivate(joinCode);
      const target = offerable.find((m) => m.id === match.mode);
      if (target) go(target, match.match_id);
      else setError("That room is for a game this build does not know.");
    } catch (err) {
      handle(err);
    } finally {
      setPending(null);
    }
  }, [joinCode, joinOpenFor, offerable, go, handle]);

  // ---- gates -------------------------------------------------------------

  if (error && !readiness) {
    return (
      <LobbyShell>
        <p className="ar-notice" role="alert" data-testid="lobby-error">
          {error}
        </p>
      </LobbyShell>
    );
  }
  if (!readiness) {
    return (
      <LobbyShell>
        <p className="ar-notice" data-testid="lobby-loading">
          Loading the Arena…
        </p>
      </LobbyShell>
    );
  }
  if (!readiness.arena_enabled) {
    return (
      <LobbyShell>
        <ClosedAlpha
          testId="lobby-disabled"
          headline="Multiplayer is not open yet"
          body="Three-Man Weave and The $20 Showdown are in closed alpha. Everything else in the Arena is playable now."
        />
      </LobbyShell>
    );
  }

  const highlighted = params?.get("game") ?? null;

  // ---- the queue takeover -------------------------------------------------

  if (queueMode) {
    return (
      <LobbyShell>
        <QueuePanel
          mode={queueMode}
          status={queue}
          onCancel={() => void cancelSearch()}
          onFillNow={readiness.bots_enabled ? () => void fillNow() : undefined}
        />
      </LobbyShell>
    );
  }

  if (room && roomMode) {
    return (
      <LobbyShell>
        <RoomPanel
          mode={roomMode}
          room={room}
          onLeave={() => {
            setRoom(null);
            setRoomMode(null);
          }}
          onFill={readiness.bots_enabled ? () => void fillRoom() : undefined}
        />
      </LobbyShell>
    );
  }

  // ---- the catalogue ------------------------------------------------------

  return (
    <LobbyShell>
      {error ? (
        <p className="ar-notice" role="alert" data-testid="lobby-error">
          {error}
        </p>
      ) : null}

      {offerable.length === 0 ? (
        <ClosedAlpha
          testId="lobby-no-modes"
          headline="No multiplayer games are available"
          body="The Arena is reachable but is not serving a game right now. Try again shortly."
        />
      ) : (
        <ul className="ar-grid" data-testid="lobby-mode-grid">
          {offerable.map((mode) => (
            <li key={mode.id}>
              <GameCard
                mode={mode}
                highlighted={highlighted === mode.id}
                readiness={readiness}
                pending={pending}
                onStart={(path) => void start(mode, path)}
                joinOpen={joinOpenFor === mode.id}
                onToggleJoin={() =>
                  setJoinOpenFor((current) => (current === mode.id ? null : mode.id))
                }
                joinCode={joinCode}
                onJoinCode={setJoinCode}
                onJoinSubmit={() => void joinByCode()}
              />
            </li>
          ))}
        </ul>
      )}
    </LobbyShell>
  );
}

/* ------------------------------------------------------------------ */
/* Chrome                                                              */
/* ------------------------------------------------------------------ */

function LobbyShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="ar-lobby" data-testid="arena-lobby">
      <header className="ar-lobby-head">
        <p className="ar-eyebrow">PEAK3 Arena</p>
        <h1 className="ar-lobby-title">Multiplayer</h1>
        <p className="ar-lobby-intro">
          Live games against other people, decided by the same open five-component
          formula as the rest of PEAK3 — with a full receipt at the end.
        </p>
      </header>
      {children}
    </div>
  );
}

function ClosedAlpha({
  testId,
  headline,
  body,
}: {
  testId: string;
  headline: string;
  body: string;
}) {
  return (
    <section className="ar-panel ar-panel-quiet" data-testid={testId}>
      <span className="ar-badge ar-badge-alpha">Closed alpha</span>
      <h2 className="ar-panel-title">{headline}</h2>
      <p className="ar-panel-body">{body}</p>
      <a className="ar-btn" href="/arena">
        Browse every PEAK3 game
      </a>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* One game                                                            */
/* ------------------------------------------------------------------ */

function GameCard({
  mode,
  highlighted,
  readiness,
  pending,
  onStart,
  joinOpen,
  onToggleJoin,
  joinCode,
  onJoinCode,
  onJoinSubmit,
}: {
  mode: OfferableMode;
  highlighted: boolean;
  readiness: ArenaReadiness;
  pending: Pending;
  onStart: (path: EntryPathId) => void;
  joinOpen: boolean;
  onToggleJoin: () => void;
  joinCode: string;
  onJoinCode: (value: string) => void;
  onJoinSubmit: () => void;
}) {
  const busyFor = pending?.modeId === mode.id ? pending.path : null;

  /**
   * Why a path is unavailable, as words. A greyed-out control with no reason
   * beside it reads as broken; the brief calls this out as a defect in its own
   * right, and it is the same rule the bid button follows in the auction room.
   */
  const blocked = (path: EntryPathId): string | null => {
    if (path === "public_queue" && !readiness.public_queue_enabled) {
      return "Public matchmaking is paused.";
    }
    if (path === "practice" && !readiness.bots_enabled) {
      return "PEAK3 Bot is offline right now.";
    }
    return null;
  };

  return (
    <article
      className="ar-card"
      data-testid={`lobby-mode-${mode.id}`}
      data-highlighted={highlighted ? "true" : "false"}
    >
      <span className="ar-card-rail" aria-hidden="true" />

      <div className="ar-card-head">
        <div className="ar-card-badges">
          <span className="ar-badge">{mode.kindBadge}</span>
          <span className="ar-badge ar-badge-alpha">Closed alpha</span>
        </div>
        <h2 className="ar-card-title">{mode.name}</h2>
        <p className="ar-card-tagline">{mode.tagline}</p>
      </div>

      <p className="ar-card-body">{mode.description}</p>

      <ul className="ar-facts">
        <li>{seatLabel(mode.seatCount)}</li>
        <li>{mode.duration}</li>
        <li>Unrated in alpha</li>
      </ul>

      <div className="ar-actions">
        {ENTRY_PATHS.map((path) => {
          const reason = blocked(path.id);
          const primary = path.id === "practice";
          return (
            <div className="ar-action" key={path.id}>
              <button
                type="button"
                className={primary ? "ar-btn ar-btn-primary" : "ar-btn"}
                data-testid={`lobby-${mode.id}-${path.id}`}
                disabled={Boolean(reason) || busyFor !== null}
                onClick={() => (path.id === "private_room" ? onToggleJoin() : onStart(path.id))}
                aria-describedby={`${mode.id}-${path.id}-note`}
                aria-expanded={path.id === "private_room" ? joinOpen : undefined}
              >
                {busyFor === path.id ? "Starting…" : path.name}
              </button>
              <span className="ar-action-note" id={`${mode.id}-${path.id}-note`}>
                {reason ?? path.description}
              </span>
            </div>
          );
        })}
      </div>

      {/* ONE compact create/join interaction, opened from the Private room
          button rather than living permanently on the card. */}
      {joinOpen ? (
        <div className="ar-private" data-testid={`lobby-${mode.id}-private`}>
          <button
            type="button"
            className="ar-btn ar-btn-primary"
            data-testid={`lobby-${mode.id}-create-room`}
            disabled={busyFor !== null}
            onClick={() => onStart("private_room")}
          >
            Create room
          </button>
          <span className="ar-private-or">or</span>
          <label className="ar-sr-only" htmlFor={`join-${mode.id}`}>
            Six-character room code
          </label>
          <input
            id={`join-${mode.id}`}
            data-testid={`lobby-${mode.id}-join-code`}
            className="ar-code-input"
            value={joinCode}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="ABC123"
            maxLength={6}
            onChange={(e) => onJoinCode(normaliseRoomCode(e.target.value))}
          />
          <button
            type="button"
            className="ar-btn"
            data-testid={`lobby-${mode.id}-join-submit`}
            disabled={busyFor !== null || joinCode.length !== 6}
            onClick={onJoinSubmit}
          >
            Join
          </button>
        </div>
      ) : null}

      <HowToPlay title={mode.name} rules={mode.rules} testId={`lobby-rules-${mode.id}`} />
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Public queue                                                        */
/* ------------------------------------------------------------------ */

function QueuePanel({
  mode,
  status,
  onCancel,
  onFillNow,
}: {
  mode: OfferableMode;
  status: QueueStatus | null;
  onCancel: () => void;
  onFillNow?: () => void;
}) {
  const waited = Math.min(
    HUMAN_PREFERENCE_SECONDS,
    Math.floor(status?.waited_seconds ?? 0),
  );
  const remaining = Math.max(0, HUMAN_PREFERENCE_SECONDS - waited);
  const seated = status?.status === "matched" ? mode.seatCount : 1;
  const progress = Math.round((waited / HUMAN_PREFERENCE_SECONDS) * 100);

  return (
    <section className="ar-panel" aria-live="polite" data-testid="lobby-searching">
      <span className="ar-badge">{mode.kindBadge}</span>
      <h2 className="ar-panel-title">{mode.name} · public match</h2>

      <dl className="ar-queue-facts">
        <div>
          <dt>Seats</dt>
          <dd data-testid="lobby-queue-seats">
            {seated} of {mode.seatCount}
          </dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd data-testid="lobby-search-label">{searchLabel(status)}</dd>
        </div>
        <div>
          <dt>Bots fill in</dt>
          <dd data-testid="lobby-queue-countdown">
            {remaining > 0 ? `${remaining}s` : "any moment"}
          </dd>
        </div>
      </dl>

      {/* A real progress element, so assistive tech reads a value rather than a
          decorative bar, and so forced-colours mode still shows it. */}
      <progress
        className="ar-progress"
        data-testid="lobby-queue-progress"
        max={HUMAN_PREFERENCE_SECONDS}
        value={waited}
        aria-label={`Waiting for a human opponent, ${waited} of ${HUMAN_PREFERENCE_SECONDS} seconds`}
      >
        {progress}%
      </progress>

      <div className="ar-panel-actions">
        {onFillNow ? (
          <button
            type="button"
            className="ar-btn ar-btn-primary"
            data-testid="lobby-fill-now"
            onClick={onFillNow}
          >
            Start with bots now
          </button>
        ) : null}
        <button
          type="button"
          className="ar-btn"
          data-testid="lobby-cancel-search"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Private room                                                        */
/* ------------------------------------------------------------------ */

function RoomPanel({
  mode,
  room,
  onLeave,
  onFill,
}: {
  mode: OfferableMode;
  room: ArenaMatchStub;
  onLeave: () => void;
  onFill?: () => void;
}) {
  const isHost = room.your_seat_index === 0;
  return (
    <section className="ar-panel" aria-live="polite" data-testid="lobby-room">
      <span className="ar-badge">{mode.kindBadge}</span>
      <h2 className="ar-panel-title">{mode.name} · private room</h2>

      <p className="ar-room-code" data-testid="lobby-room-code">
        {room.room_code ?? "······"}
      </p>
      <p className="ar-panel-body">
        Share this code. {room.seats.length} of {room.seat_count} seats taken — the
        game starts by itself when the last one fills.
      </p>

      <div className="ar-panel-actions">
        {onFill && isHost ? (
          <button
            type="button"
            className="ar-btn ar-btn-primary"
            data-testid="lobby-room-fill-bots"
            onClick={onFill}
          >
            Fill empty seats with bots
          </button>
        ) : null}
        <button type="button" className="ar-btn" data-testid="lobby-leave-room" onClick={onLeave}>
          Back
        </button>
      </div>
    </section>
  );
}
