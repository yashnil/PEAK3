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
  HUMAN_PREFERENCE_SECONDS,
  entryPath,
  seatLabel,
  type EntryPathId,
  type OfferableMode,
} from "@/lib/arena-modes";
import {
  ARENA_COMING_LATER,
  arenaCapability,
  arenaHeadline,
  type ArenaCapability,
} from "@/lib/arena-capability";
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
 * WHAT THE CLOSED-ALPHA PASS CHANGED, AND WHY IT WAS A PRODUCT DEFECT.
 * This component asked readiness ONE question -- `arena_enabled` -- and
 * answered everything else with a `disabled` flag per control. Two consequences,
 * both found by manual review:
 *
 *   1. With the Arena flags absent from an environment, the whole page was one
 *      panel reading "Multiplayer is not open yet ... Three-Man Weave and The
 *      $20 Showdown are in closed alpha." True about human matchmaking, false
 *      about the two modes a reviewer was there to play, and there was no way
 *      past it.
 *   2. Even with the flags right, a closed alpha rendered TWO OF THREE controls
 *      on every card greyed out, under a heading promising "live games against
 *      other people". Four dead buttons on a two-game page.
 *
 * The posture is now derived once (`lib/arena-capability.ts`) and the page is
 * shaped by it: `practice_only` renders playable cards with one primary
 * action, and says what is held back once, at the end, instead of on every
 * card. The wall remains for the states that really are walls -- Arena off, no
 * modes, no way in -- and each of those now says which one it is.
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

  // ONE DERIVED POSTURE, not a boolean per control. See `arena-capability.ts`
  // for why: the lobby used to ask only `arena_enabled` and answer everything
  // else with per-button `disabled` flags, which is how a closed alpha whose
  // whole point is bot practice came to render as "Multiplayer is not open yet".
  const capability: ArenaCapability | null = useMemo(
    () => (readiness ? arenaCapability(readiness) : null),
    [readiness],
  );
  const offerable = useMemo(() => capability?.modes ?? [], [capability]);

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
      <LobbyShell capability={null}>
        <p className="ar-notice" role="alert" data-testid="lobby-error">
          {error}
        </p>
      </LobbyShell>
    );
  }
  if (!readiness || !capability) {
    return (
      <LobbyShell capability={null}>
        <p className="ar-notice" data-testid="lobby-loading">
          Loading the Arena…
        </p>
      </LobbyShell>
    );
  }

  // THE ONLY REMAINING WALL, and it is a real one: the Arena is off, is
  // serving no mode this build can route to, or has no way in at all. It is
  // NOT reached merely because public matchmaking is closed — that used to be
  // the case, and it is what made a playable closed alpha read as unavailable.
  if (capability.posture === "unavailable") {
    return (
      <LobbyShell capability={capability}>
        <Unavailable reason={capability.unavailableReason} />
      </LobbyShell>
    );
  }

  const highlighted = params?.get("game") ?? null;

  // ---- the queue takeover -------------------------------------------------

  if (queueMode) {
    return (
      <LobbyShell capability={capability}>
        <QueuePanel
          mode={queueMode}
          status={queue}
          onCancel={() => void cancelSearch()}
          onFillNow={capability.practiceAvailable ? () => void fillNow() : undefined}
        />
      </LobbyShell>
    );
  }

  if (room && roomMode) {
    return (
      <LobbyShell capability={capability}>
        <RoomPanel
          mode={roomMode}
          room={room}
          onLeave={() => {
            setRoom(null);
            setRoomMode(null);
          }}
          onFill={capability.practiceAvailable ? () => void fillRoom() : undefined}
        />
      </LobbyShell>
    );
  }

  // ---- the catalogue ------------------------------------------------------

  return (
    <LobbyShell capability={capability}>
      {error ? (
        <p className="ar-notice" role="alert" data-testid="lobby-error">
          {error}
        </p>
      ) : null}

      <ul className="ar-grid" data-testid="lobby-mode-grid">
        {capability.modes.map((mode) => (
          <li key={mode.id}>
            <GameCard
              mode={mode}
              highlighted={highlighted === mode.id}
              capability={capability}
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

      {/* WHAT IS HELD BACK, SAID ONCE. It used to be said on every card, as a
          greyed-out button with a sentence beside it — so a two-game closed
          alpha rendered four dead controls, and the page's dominant impression
          was of things that do not work. */}
      {capability.posture === "practice_only" ? <ComingLater /> : null}
    </LobbyShell>
  );
}

/* ------------------------------------------------------------------ */
/* Chrome                                                              */
/* ------------------------------------------------------------------ */

function LobbyShell({
  capability,
  children,
}: {
  /** `null` while readiness is still in flight or unreachable, which is the one
   *  state with no honest sentence to write about what is playable. */
  capability: ArenaCapability | null;
  children: React.ReactNode;
}) {
  // THE HEADING HAS TO MATCH THE PAGE. It said "Live games against other
  // people" in every configuration, including the one where live games against
  // other people are exactly what is not open — so the first sentence a
  // reviewer read was contradicted by every control below it.
  const headline = capability
    ? arenaHeadline(capability)
    : { title: "Multiplayer", intro: "" };
  return (
    <div className="ar-lobby" data-testid="arena-lobby" data-posture={capability?.posture ?? "loading"}>
      <header className="ar-lobby-head">
        <p className="ar-eyebrow">PEAK3 Arena</p>
        <h1 className="ar-lobby-title">{headline.title}</h1>
        {capability?.posture === "practice_only" ? (
          <p className="ar-alpha-line" data-testid="lobby-alpha-line">
            <span className="ar-badge ar-badge-alpha">Closed alpha</span>
            <span>Bot practice is open. Live matchmaking is not.</span>
          </p>
        ) : null}
        {headline.intro ? <p className="ar-lobby-intro">{headline.intro}</p> : null}
      </header>
      {children}
    </div>
  );
}

/** The genuine unavailable states, and only those.
 *
 *  Each reason gets its own sentence because they send a reader to different
 *  places: a disabled Arena is a configuration question, "no modes" is a build
 *  or registry question, and "no way in" is an operational one. The previous
 *  single wall answered all three with the same paragraph — and answered a
 *  fourth situation, a perfectly playable closed alpha, with it as well. */
function Unavailable({
  reason,
}: {
  reason: ArenaCapability["unavailableReason"];
}) {
  const copy =
    reason === "no_modes"
      ? {
          testId: "lobby-no-modes",
          headline: "No multiplayer games are available",
          body: "The Arena is reachable but is not serving a game right now. Try again shortly.",
        }
      : reason === "no_entry_paths"
        ? {
            testId: "lobby-no-entry-paths",
            headline: "Nothing is open right now",
            body: "The Arena is serving its games, but every way in — public matchmaking, private rooms and PEAK3 Bot — is currently closed. Try again shortly.",
          }
        : {
            testId: "lobby-disabled",
            headline: "Multiplayer is not open yet",
            body: "Three-Man Weave and The $20 Showdown are in closed alpha and this build is not serving them. Everything else in the Arena is playable now.",
          };
  return (
    <section className="ar-panel ar-panel-quiet" data-testid={copy.testId}>
      <span className="ar-badge ar-badge-alpha">Closed alpha</span>
      <h2 className="ar-panel-title">{copy.headline}</h2>
      <p className="ar-panel-body">{copy.body}</p>
      <a className="ar-btn" href="/arena">
        Browse every PEAK3 game
      </a>
    </section>
  );
}

/** What closed alpha is holding back — one panel, at the end, after the games
 *  a reader can actually play. */
function ComingLater() {
  return (
    <section className="ar-later" data-testid="lobby-coming-later" aria-labelledby="ar-later-title">
      <h2 className="ar-later-title" id="ar-later-title">
        Coming later in the alpha
      </h2>
      <ul className="ar-later-list">
        {ARENA_COMING_LATER.map((item) => (
          <li key={item.title}>
            <span className="ar-later-name">{item.title}</span>
            <span className="ar-later-detail">{item.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* One game                                                            */
/* ------------------------------------------------------------------ */

function GameCard({
  mode,
  highlighted,
  capability,
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
  capability: ArenaCapability;
  pending: Pending;
  onStart: (path: EntryPathId) => void;
  joinOpen: boolean;
  onToggleJoin: () => void;
  joinCode: string;
  onJoinCode: (value: string) => void;
  onJoinSubmit: () => void;
}) {
  const busyFor = pending?.modeId === mode.id ? pending.path : null;
  const alpha = capability.posture === "practice_only";

  /**
   * WHAT A CARD OFFERS, AND WHY THE LIST IS NOT FIXED.
   *
   * It used to be: all three entry paths, always, with `disabled` and a reason
   * beside the ones that were closed. That rule -- "a greyed-out control with
   * no reason beside it reads as broken" -- is right, and it is why the reasons
   * were there. But it was applied to the wrong question. In a closed alpha
   * TWO OF THE THREE controls on every card are permanently closed, so a
   * two-game lobby drew four dead buttons, and the page's dominant impression
   * was of a product that does not work. A capability that is not coming back
   * this week is not a disabled control; it is not a control.
   *
   * So a path that is unavailable for a POSTURE reason is not rendered here at
   * all -- `ComingLater` says once, at the end, what the alpha is holding back.
   * A path that is unavailable for a TRANSIENT reason keeps the old treatment,
   * because "PEAK3 Bot is offline right now" genuinely is a control that should
   * be back shortly and a reader needs to know why it is not.
   */
  const paths: { id: EntryPathId; primary: boolean; reason: string | null }[] = [];
  if (capability.practiceAvailable) {
    paths.push({ id: "practice", primary: true, reason: null });
  } else if (capability.publicQueueAvailable || capability.privateRoomAvailable) {
    // Bots are off while other doors are open: transient, and worth saying.
    paths.push({ id: "practice", primary: true, reason: "PEAK3 Bot is offline right now." });
  }
  if (capability.publicQueueAvailable) {
    paths.push({ id: "public_queue", primary: false, reason: null });
  }
  if (capability.privateRoomAvailable) {
    paths.push({ id: "private_room", primary: false, reason: null });
  }

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
          {alpha ? (
            // PLAYABLE, and the badge says so. "Closed alpha" on a card whose
            // primary button starts a match reads as "you cannot play this",
            // which was the single most misleading thing on the page.
            <span className="ar-badge ar-badge-play" data-testid={`lobby-${mode.id}-playable`}>
              Playable vs bots
            </span>
          ) : (
            <span className="ar-badge ar-badge-alpha">Closed alpha</span>
          )}
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
        {paths.map(({ id, primary, reason }) => {
          const meta = entryPath(id);
          // "Play vs bots" rather than "Play bots" on the card whose whole job
          // is to say what a reviewer can do right now.
          const label = id === "practice" && alpha ? "Play vs bots" : meta.name;
          return (
            <div className="ar-action" key={id}>
              <button
                type="button"
                className={primary ? "ar-btn ar-btn-primary" : "ar-btn"}
                data-testid={`lobby-${mode.id}-${id}`}
                disabled={Boolean(reason) || busyFor !== null}
                onClick={() => (id === "private_room" ? onToggleJoin() : onStart(id))}
                aria-describedby={`${mode.id}-${id}-note`}
                aria-expanded={id === "private_room" ? joinOpen : undefined}
              >
                {busyFor === id ? "Starting…" : label}
              </button>
              <span className="ar-action-note" id={`${mode.id}-${id}-note`}>
                {reason ?? meta.description}
              </span>
            </div>
          );
        })}
      </div>

      {alpha ? (
        <p className="ar-card-later" data-testid={`lobby-${mode.id}-matchmaking-note`}>
          Live matchmaking against another player comes later in the alpha.
        </p>
      ) : null}

      {/* ONE compact create/join interaction, opened from the Play With Friends
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
      <h2 className="ar-panel-title">{mode.name} · Play With Friends</h2>

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
