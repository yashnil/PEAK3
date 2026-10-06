"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { reportMatchmakingWait } from "@/lib/game-feel/action-timing";
import { primeMatchView } from "@/lib/game-feel/match-handoff";

import {
  arenaLobbyApi,
  ArenaAPIError,
  normaliseRoomCode,
  searchLabel,
  skillBandLabel,
  type ArenaMatchStub,
  type ArenaReadiness,
  type QueueStatus,
} from "@/lib/arena-lobby-api";
import {
  BOT_PRACTICE_LABEL,
  HUMAN_PREFERENCE_SECONDS,
  entryPath,
  groupModeFamilies,
  seatLabel,
  variantLabelOf,
  type EntryPathId,
  type ModeFamily,
  type OfferableMode,
} from "@/lib/arena-modes";
import {
  ARENA_COMING_LATER,
  arenaCapability,
  arenaHeadline,
  type ArenaCapability,
} from "@/lib/arena-capability";
import HowToPlay from "@/components/arena/HowToPlay";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import PeakV2Rule from "@/components/v2/PeakV2Rule";
import PeakV2PrimaryAction from "@/components/v2/PeakV2PrimaryAction";
import PeakV2SecondaryAction from "@/components/v2/PeakV2SecondaryAction";
import { StatusChip } from "@/components/ui/StatusChip";

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
  // When the current public search was pressed, for the wait telemetry.
  const queueJoinedAt = useRef<number | null>(null);

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

  // A public-queue match: report the search's length once, then go.
  const matchedFromQueue = useCallback(
    (target: OfferableMode, matchId: string) => {
      if (queueJoinedAt.current !== null && !navigated.current) {
        reportMatchmakingWait(target.id, queueJoinedAt.current);
        queueJoinedAt.current = null;
      }
      go(target, matchId);
    },
    [go],
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
          matchedFromQueue(queueMode, status.match_id);
        }
      } catch (err) {
        handle(err);
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [queueMode, matchedFromQueue, handle]);

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
          // The room mounts on this authoritative view instead of reading it again.
          primeMatchView(match);
          go(mode, match.match_id);
        } else if (path === "private_room") {
          const match = await arenaLobbyApi.createPrivate(mode.id);
          setRoomMode(mode);
          setRoom(match);
        } else {
          queueJoinedAt.current = performance.now();
          const status = await arenaLobbyApi.joinQueue(mode.id);
          if (status.status === "matched" && status.match_id) {
            matchedFromQueue(mode, status.match_id);
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
    [pending, go, matchedFromQueue, handle],
  );

  const cancelSearch = useCallback(async () => {
    if (!queueMode) return;
    try {
      await arenaLobbyApi.cancelQueue(queueMode.id);
    } catch (err) {
      handle(err);
    }
    queueJoinedAt.current = null;
    setQueue(null);
    setQueueMode(null);
  }, [queueMode, handle]);

  const fillNow = useCallback(async () => {
    if (!queueMode) return;
    try {
      const status = await arenaLobbyApi.fillWithBotsNow(queueMode.id);
      if (status.status === "matched" && status.match_id) matchedFromQueue(queueMode, status.match_id);
    } catch (err) {
      handle(err);
    }
  }, [queueMode, matchedFromQueue, handle]);

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
        <p
          className="pk-depth pk-crown rounded-2xl p-5 text-sm"
          role="alert"
          data-testid="lobby-error"
          style={{ border: "1px solid var(--v2-border-subtle)", color: "var(--v2-text-secondary)" }}
        >
          {error}
        </p>
      </LobbyShell>
    );
  }
  if (!readiness || !capability) {
    return (
      <LobbyShell capability={null}>
        <p
          className="pk-depth pk-crown rounded-2xl p-5 text-sm"
          data-testid="lobby-loading"
          style={{ border: "1px solid var(--v2-border-subtle)", color: "var(--v2-text-secondary)" }}
        >
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
  // `?family=` names a whole game (the Play menu's Three-Man Weave row) rather
  // than one of its rulesets.
  const highlightedFamily = params?.get("family") ?? null;

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
        <p
          className="pk-depth pk-crown mb-4 rounded-2xl p-5 text-sm"
          role="alert"
          data-testid="lobby-error"
          style={{ border: "1px solid var(--v2-border-subtle)", color: "var(--v2-text-secondary)" }}
        >
          {error}
        </p>
      ) : null}

      {/* ONE CARD PER GAME, NOT PER RULESET. Franchise Draft and Decade Draft
          are ways to play Three-Man Weave, so they render as that family's
          formats inside one card rather than as further games beside it.
          Grouped from `variantOf` alone; nothing here names a mode. */}
      <ul className="ar-grid" data-testid="lobby-mode-grid">
        {withRowSpans(groupModeFamilies(capability.modes)).map(({ family, spanRow }) => {
          const actions: EntryActionsShared = {
            capability,
            pending,
            onStart: (mode, path) => void start(mode, path),
            joinOpenFor,
            onToggleJoin: (modeId) =>
              setJoinOpenFor((current) => (current === modeId ? null : modeId)),
            joinCode,
            onJoinCode: setJoinCode,
            onJoinSubmit: () => void joinByCode(),
          };
          if (family.variants.length > 1) {
            return (
              <li
                key={family.id}
                className="ar-grid-family"
                style={{ "--ar-variant-count": family.variants.length } as CSSProperties}
              >
                <FamilyCard
                  family={family}
                  highlightedModeId={highlighted}
                  familyHighlighted={highlightedFamily === family.id}
                  {...actions}
                />
              </li>
            );
          }
          const mode = family.variants[0];
          return (
            <li key={mode.id} data-span={spanRow ? "row" : undefined}>
              <GameCard mode={mode} highlighted={highlighted === mode.id} {...actions} />
            </li>
          );
        })}
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
    <PeakV2Shell width="live">
      {/* THE LOBBY IS THE CONCOURSE, and it no longer has to say so itself.
          This used to carry `.pk-atmosphere` so the mode cards sat on the
          same floodlights and grid as both game rooms; the page-level
          `PeakV2ArenaBackdrop` now puts every one of those surfaces on one
          continuous floor, which is what that comment was reaching for.
          `PeakV2Shell` supplies the page-width/centering this element used
          to hand-mimic via a CSS override. */}
      <div
        className="ar-lobby-page pb-14 pt-9"
        data-testid="arena-lobby"
        data-posture={capability?.posture ?? "loading"}
        style={{ "--pk-court-grid-size": "96px" } as CSSProperties}
      >
        <header className="flex flex-col gap-1.5 pb-1">
          <p
            className="text-xs font-bold uppercase tracking-[0.14em]"
            style={{ color: "var(--v2-color-accent)" }}
          >
            PEAK3 Arena
          </p>
          <h1
            className="text-4xl font-bold sm:text-[2.75rem]"
            style={{ fontFamily: "var(--v2-font-display)", color: "var(--v2-text-primary)" }}
          >
            {headline.title}
          </h1>
          {capability?.posture === "practice_only" ? (
            <p
              className="mt-1 flex flex-wrap items-center gap-2 text-sm"
              data-testid="lobby-alpha-line"
              style={{ color: "var(--v2-text-secondary)" }}
            >
              <StatusChip tone="accent">Closed alpha</StatusChip>
              <span>Bot practice is open. Live matchmaking is not.</span>
            </p>
          ) : null}
          {headline.intro ? (
            <p className="mt-1 max-w-2xl text-sm leading-relaxed" style={{ color: "var(--v2-text-secondary)" }}>
              {headline.intro}
            </p>
          ) : null}
          <p className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <Link
              href="/arena/leaderboard"
              data-testid="lobby-leaderboard-link"
              className="font-semibold underline-offset-4 hover:underline"
              style={{ color: "var(--v2-color-accent)" }}
            >
              Rated leaderboards →
            </Link>
            {/* A game the lobby does not have yet is exactly the note the
                homepage's feedback form exists for; it opens with that kind
                chosen. */}
            <Link
              href="/?feedback=game_idea#feedback"
              data-testid="lobby-suggest-mode"
              className="font-semibold underline-offset-4 hover:underline"
              style={{ color: "var(--v2-text-secondary)" }}
            >
              Suggest a game mode →
            </Link>
          </p>
        </header>
        <PeakV2Rule spacing="md" />
        {children}
      </div>
    </PeakV2Shell>
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
            body: `The Arena is serving its games, but every way in — public matchmaking, private rooms and ${BOT_PRACTICE_LABEL} — is currently closed. Try again shortly.`,
          }
        : {
            testId: "lobby-disabled",
            headline: "Multiplayer is not open yet",
            body: "The live multiplayer games are in closed alpha and this build is not serving them. Everything else in the Arena is playable now.",
          };
  return (
    <section
      className="pk-depth pk-crown flex flex-col items-start gap-3 rounded-2xl p-7"
      data-testid={copy.testId}
      style={{ border: "1px solid var(--v2-border-subtle)" }}
    >
      <StatusChip tone="accent">Closed alpha</StatusChip>
      <h2
        className="text-xl font-bold"
        style={{ fontFamily: "var(--v2-font-display)", color: "var(--v2-text-primary)" }}
      >
        {copy.headline}
      </h2>
      <p className="max-w-xl text-sm leading-relaxed" style={{ color: "var(--v2-text-secondary)" }}>
        {copy.body}
      </p>
      <PeakV2SecondaryAction href="/arena">Browse every PEAK3 game</PeakV2SecondaryAction>
    </section>
  );
}

/** What closed alpha is holding back — one panel, at the end, after the games
 *  a reader can actually play. */
function ComingLater() {
  return (
    <section
      className="pk-depth mt-2 rounded-2xl p-5"
      data-testid="lobby-coming-later"
      aria-labelledby="ar-later-title"
      style={{ border: "1px dashed var(--v2-border)" }}
    >
      <h2
        className="text-[11px] font-bold uppercase tracking-[0.14em]"
        id="ar-later-title"
        style={{ fontFamily: "var(--v2-font-mono)", color: "var(--v2-text-muted)" }}
      >
        Coming later in the alpha
      </h2>
      {/* Explicit Tailwind breakpoints rather than `repeat(auto-fit,
          minmax(...))`: the auto-fit version fit exactly 2 of these 3 items
          per row at 768px, wrapping the third alone onto its own row — an
          orphaned-looking layout for a page this otherwise considered. */}
      <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
        {ARENA_COMING_LATER.map((item) => (
          <li key={item.title} className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold" style={{ color: "var(--v2-text-secondary)" }}>
              {item.title}
            </span>
            <span className="text-xs leading-relaxed" style={{ color: "var(--v2-text-muted)" }}>
              {item.detail}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* One game                                                            */
/* ------------------------------------------------------------------ */

/**
 * Which single-ruleset cards would sit alone in a row of the two-up grid.
 *
 * A family card takes a whole row (see `arena-lobby.css`), so a lone card
 * before it -- or at the end of the list -- would leave half a row empty. Those
 * cards are marked to take the row instead. On a one-column phone the mark
 * changes nothing.
 */
function withRowSpans<T extends OfferableMode>(families: ModeFamily<T>[]) {
  const out = families.map((family) => ({ family, spanRow: false }));
  let open: number | null = null; // a single card waiting for a partner
  out.forEach((entry, index) => {
    if (entry.family.variants.length > 1) {
      if (open !== null) out[open].spanRow = true;
      open = null;
    } else {
      open = open === null ? index : null;
    }
  });
  if (open !== null) out[open].spanRow = true;
  return out;
}

/** What every card's actions need from the lobby, for any mode on it. */
interface EntryActionsShared {
  capability: ArenaCapability;
  pending: Pending;
  onStart: (mode: OfferableMode, path: EntryPathId) => void;
  /** The mode whose Play With Friends control is open, if any. */
  joinOpenFor: string | null;
  onToggleJoin: (modeId: string) => void;
  joinCode: string;
  onJoinCode: (value: string) => void;
  onJoinSubmit: () => void;
}

function GameCard({
  mode,
  highlighted,
  ...shared
}: EntryActionsShared & {
  mode: OfferableMode;
  highlighted: boolean;
}) {
  const alpha = shared.capability.posture === "practice_only";

  return (
    <article
      // A mode card is the object you pick a match from. `.pk-lift` gives it
      // the product's one hover behaviour -- the same two pixels and the same
      // shadow tier every other card in the app uses -- and `.pk-crown` the
      // lit top edge. No `.pk-press`: the card itself is not the control, the
      // buttons inside it are, and a card that depresses under a click that
      // lands on a button would be claiming the press.
      className="ar-card pk-lift pk-crown"
      data-testid={`lobby-mode-${mode.id}`}
      data-highlighted={highlighted ? "true" : "false"}
    >
      <span className="ar-card-rail" aria-hidden="true" />

      <CardHead
        testIdBase={mode.id}
        kindBadge={mode.kindBadge}
        alpha={alpha}
        title={mode.name}
        tagline={mode.tagline}
      />

      <p className="ar-card-body">{mode.description}</p>

      <ul className="ar-facts">
        <li>{seatLabel(mode.seatCount)}</li>
        <li>{mode.duration}</li>
        <li>Unrated in alpha</li>
      </ul>

      <EntryActions mode={mode} {...shared} />

      {alpha ? (
        <p className="ar-card-later" data-testid={`lobby-${mode.id}-matchmaking-note`}>
          Live matchmaking against another player comes later in the alpha.
        </p>
      ) : null}

      <PrivateJoin mode={mode} {...shared} />

      <HowToPlay title={mode.name} rules={mode.rules} testId={`lobby-rules-${mode.id}`} />
    </article>
  );
}

/**
 * ONE GAME PLAYED UNDER SEVERAL RULESETS: one card, its formats as rows.
 *
 * THE DEFECT THIS REPLACES. Franchise Draft and Decade Draft rendered as two
 * more cards beside Three-Man Weave, each repeating the Weave's badges, seat
 * count and snake-draft pitch, so the lobby read as three unrelated games and
 * the relationship between them was left for the visitor to work out. The
 * family is now the card and each ruleset a row inside it -- its own name,
 * one line on how it differs, its own length, its own actions and rules. All
 * rows are on screen at once: choosing a format is one press, not a tab
 * switch followed by a press, and every ruleset's actions keep their own
 * `lobby-<modeId>-<path>` testids.
 */
function FamilyCard({
  family,
  highlightedModeId,
  familyHighlighted,
  ...shared
}: EntryActionsShared & {
  family: ModeFamily<OfferableMode>;
  /** `?game=`: a ruleset the visitor was sent to. */
  highlightedModeId: string | null;
  /** `?family=`: the whole game. */
  familyHighlighted: boolean;
}) {
  const alpha = shared.capability.posture === "practice_only";
  const lead = family.variants[0];
  const intro = family.parent?.family;
  const rowHighlighted = family.variants.some((variant) => variant.id === highlightedModeId);
  const headingId = `lobby-family-${family.id}-formats`;

  return (
    <article
      className="ar-card ar-family pk-lift pk-crown"
      data-testid={`lobby-mode-${family.id}`}
      data-family={family.id}
      data-highlighted={familyHighlighted || rowHighlighted ? "true" : "false"}
    >
      <span className="ar-card-rail" aria-hidden="true" />

      <CardHead
        testIdBase={family.id}
        kindBadge={(family.parent ?? lead).kindBadge}
        alpha={alpha}
        title={family.name}
        tagline={intro?.tagline ?? lead.tagline}
      />

      <p className="ar-card-body">{intro?.description ?? lead.description}</p>

      <ul className="ar-facts">
        <li>{seatLabel(lead.seatCount)}</li>
        <li>{family.variants.length} formats</li>
        <li>Unrated in alpha</li>
      </ul>

      <p className="ar-variants-label" id={headingId}>
        Choose a format
      </p>
      <ol className="ar-variants" aria-labelledby={headingId} data-testid={`lobby-family-${family.id}`}>
        {family.variants.map((variant) => {
          const highlighted = variant.id === highlightedModeId;
          return (
            <li
              key={variant.id}
              className="ar-variant"
              data-testid={`lobby-variant-${variant.id}`}
              data-highlighted={highlighted ? "true" : "false"}
              aria-current={highlighted ? "true" : undefined}
            >
              <div className="ar-variant-head">
                <h3 className="ar-variant-title">{variantLabelOf(variant)}</h3>
                <span className="ar-variant-duration">{variant.duration}</span>
              </div>
              <p className="ar-variant-summary">{variant.variantSummary ?? variant.tagline}</p>
              <EntryActions mode={variant} compact {...shared} />
              <PrivateJoin mode={variant} {...shared} />
              <HowToPlay
                title={variant.name}
                rules={variant.rules}
                testId={`lobby-rules-${variant.id}`}
                summary={`How ${variantLabelOf(variant)} works`}
              />
            </li>
          );
        })}
      </ol>

      {alpha ? (
        <p className="ar-card-later" data-testid={`lobby-${family.id}-matchmaking-note`}>
          Live matchmaking against another player comes later in the alpha.
        </p>
      ) : null}
    </article>
  );
}

/** The badges, title and tagline every lobby card opens with. */
function CardHead({
  testIdBase,
  kindBadge,
  alpha,
  title,
  tagline,
}: {
  testIdBase: string;
  kindBadge: string;
  alpha: boolean;
  title: string;
  tagline: string;
}) {
  return (
    <div className="ar-card-head">
      <div className="ar-card-badges flex flex-wrap items-center gap-1.5">
        <StatusChip tone="neutral">{kindBadge}</StatusChip>
        {alpha ? (
          // PLAYABLE, and the badge says so. "Closed alpha" on a card whose
          // primary button starts a match reads as "you cannot play this",
          // which was the single most misleading thing on the page.
          <StatusChip tone="positive" data-testid={`lobby-${testIdBase}-playable`}>
            Playable vs bots
          </StatusChip>
        ) : (
          <StatusChip tone="accent">Closed alpha</StatusChip>
        )}
      </div>
      <h2 className="ar-card-title">{title}</h2>
      <p className="ar-card-tagline">{tagline}</p>
    </div>
  );
}

/** ONE compact create/join interaction for `mode`, opened from its Play With
 *  Friends button rather than living permanently on the card. */
function PrivateJoin({
  mode,
  pending,
  onStart,
  joinOpenFor,
  joinCode,
  onJoinCode,
  onJoinSubmit,
}: EntryActionsShared & { mode: OfferableMode }) {
  if (joinOpenFor !== mode.id) return null;
  const busy = pending?.modeId === mode.id;
  return (
    <div className="ar-private" data-testid={`lobby-${mode.id}-private`}>
      <PeakV2PrimaryAction
        type="button"
        size="sm"
        data-testid={`lobby-${mode.id}-create-room`}
        disabled={busy}
        onClick={() => onStart(mode, "private_room")}
      >
        Create room
      </PeakV2PrimaryAction>
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
      <PeakV2SecondaryAction
        type="button"
        size="sm"
        data-testid={`lobby-${mode.id}-join-submit`}
        disabled={busy || joinCode.length !== 6}
        onClick={onJoinSubmit}
      >
        Join
      </PeakV2SecondaryAction>
    </div>
  );
}

/** The entry paths `mode` offers, as buttons. `compact` (a ruleset row inside
 *  a family card) swaps each path's sentence for its rated/unrated word: the
 *  card above already says what each path is, and the rated state is the one
 *  fact that must still be visible before committing. */
function EntryActions({
  mode,
  capability,
  pending,
  onStart,
  joinOpenFor,
  onToggleJoin,
  compact = false,
}: EntryActionsShared & { mode: OfferableMode; compact?: boolean }) {
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
   * because "bot practice is offline right now" genuinely is a control that
   * should be back shortly and a reader needs to know why it is not.
   */
  const paths: { id: EntryPathId; primary: boolean; reason: string | null }[] = [];
  if (capability.practiceAvailable) {
    paths.push({ id: "practice", primary: true, reason: null });
  } else if (capability.publicQueueAvailable || capability.privateRoomAvailable) {
    // Bots are off while other doors are open: transient, and worth saying.
    // Capitalised here because this renders as a standalone sentence, unlike
    // `BOT_PRACTICE_LABEL`'s other (mid-sentence) uses.
    paths.push({ id: "practice", primary: true, reason: "Bot practice is offline right now." });
  }
  if (capability.publicQueueAvailable) {
    paths.push({ id: "public_queue", primary: false, reason: null });
  }
  if (capability.privateRoomAvailable) {
    paths.push({ id: "private_room", primary: false, reason: null });
  }

  return (
    <div className="ar-actions">
      {paths.map(({ id, primary, reason }) => {
        const meta = entryPath(id);
        // "Play vs bots" rather than "Play bots" on the card whose whole job
        // is to say what a reviewer can do right now.
        const label = id === "practice" && alpha ? "Play vs bots" : meta.name;
        const Action = primary ? PeakV2PrimaryAction : PeakV2SecondaryAction;
        const note = reason ?? (compact ? (meta.rated ? "Rated" : "Unrated") : meta.description);
        return (
          <div className="ar-action" key={id}>
            <Action
              type="button"
              size="sm"
              className="w-full"
              data-testid={`lobby-${mode.id}-${id}`}
              disabled={Boolean(reason) || busyFor !== null}
              onClick={() => (id === "private_room" ? onToggleJoin(mode.id) : onStart(mode, id))}
              aria-describedby={`${mode.id}-${id}-note`}
              aria-expanded={id === "private_room" ? joinOpenFor === mode.id : undefined}
            >
              {busyFor === id ? "Starting…" : label}
            </Action>
            <span className="ar-action-note" id={`${mode.id}-${id}-note`}>
              {note}
            </span>
          </div>
        );
      })}
    </div>
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
    <section
      className="pk-depth pk-crown flex flex-col items-start gap-3.5 rounded-2xl p-7"
      aria-live="polite"
      data-testid="lobby-searching"
      style={{ border: "1px solid var(--v2-border-subtle)" }}
    >
      <StatusChip tone="neutral">{mode.kindBadge}</StatusChip>
      <h2
        className="text-xl font-bold"
        style={{ fontFamily: "var(--v2-font-display)", color: "var(--v2-text-primary)" }}
      >
        {mode.name} · public match
      </h2>

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
        {skillBandLabel(status) ? (
          <div>
            <dt>Skill range</dt>
            <dd data-testid="lobby-queue-band">{skillBandLabel(status)}</dd>
          </div>
        ) : null}
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

      <div className="flex flex-wrap gap-2.5">
        {onFillNow ? (
          <PeakV2PrimaryAction type="button" data-testid="lobby-fill-now" onClick={onFillNow}>
            Start with bots now
          </PeakV2PrimaryAction>
        ) : null}
        <PeakV2SecondaryAction
          type="button"
          data-testid="lobby-cancel-search"
          onClick={onCancel}
        >
          Cancel
        </PeakV2SecondaryAction>
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
    <section
      className="pk-depth pk-crown flex flex-col items-start gap-3.5 rounded-2xl p-7"
      aria-live="polite"
      data-testid="lobby-room"
      style={{ border: "1px solid var(--v2-border-subtle)" }}
    >
      <StatusChip tone="neutral">{mode.kindBadge}</StatusChip>
      <h2
        className="text-xl font-bold"
        style={{ fontFamily: "var(--v2-font-display)", color: "var(--v2-text-primary)" }}
      >
        {mode.name} · Play With Friends
      </h2>

      <p className="ar-room-code" data-testid="lobby-room-code">
        {room.room_code ?? "······"}
      </p>
      <p className="max-w-xl text-sm leading-relaxed" style={{ color: "var(--v2-text-secondary)" }}>
        Share this code. {room.seats.length} of {room.seat_count} seats taken — the
        game starts by itself when the last one fills.
      </p>

      <div className="flex flex-wrap gap-2.5">
        {onFill && isHost ? (
          <PeakV2PrimaryAction type="button" data-testid="lobby-room-fill-bots" onClick={onFill}>
            Fill empty seats with bots
          </PeakV2PrimaryAction>
        ) : null}
        <PeakV2SecondaryAction type="button" data-testid="lobby-leave-room" onClick={onLeave}>
          Back
        </PeakV2SecondaryAction>
      </div>
    </section>
  );
}
