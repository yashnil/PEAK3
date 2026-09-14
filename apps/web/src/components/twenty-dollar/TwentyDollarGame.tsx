"use client";

import { primeMatchView, takeMatchView } from "@/lib/game-feel/match-handoff";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  SHOWDOWN_COMMAND_INTRO_SEEN,
  showdownIdempotencyKey,
  twentyDollarApi,
  TwentyDollarAPIError,
  timeoutConsequence,
  formatDollars,
  type TwentyDollarMatchView,
} from "@/lib/twenty-dollar-api";
import {
  explainRejection,
  explainTransportError,
  type AttemptedAction,
  type RejectionExplanation,
} from "@/lib/arena-rejection";
import { BOT_DISPLAY_NAME, modeMeta } from "@/lib/arena-modes";
import { isNewer, useCommandLane } from "@/lib/game-feel/authoritative";
import { reportHandoff, startActionTimer } from "@/lib/game-feel/action-timing";
import { serverTimingOf } from "@/lib/game-feel/server-timing";
import type { EventMomentData } from "@/components/game-feel";
import HowToPlay from "@/components/arena/HowToPlay";
import { deadlineFromSeconds } from "@/components/shared/ArenaTimer";
import { useLotLedger } from "./LotLedger";
import { buildShowdownShareText, type TwentyDollarReceiptData } from "./TwentyDollarReceipt";
import { useShowdownPhase } from "./useShowdownPhase";
import PeakV2ShowdownIntro from "@/components/v2/showdown/PeakV2ShowdownIntro";
import PeakV2ShowdownLive from "@/components/v2/showdown/PeakV2ShowdownLive";
import PeakV2ShowdownResult from "@/components/v2/showdown/PeakV2ShowdownResult";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import PeakV2PrimaryAction from "@/components/v2/PeakV2PrimaryAction";
import PeakV2SecondaryAction from "@/components/v2/PeakV2SecondaryAction";

/**
 * One $20 Showdown match — the auction room.
 *
 * SERVER-AUTHORITATIVE, ONE SNAPSHOT PER RENDER. The entire client state is
 * "the last view the server sent", held with the clocks derived from it and
 * the moment it announced, so nothing paints a message before the board it
 * describes. There is no local reducer mirroring the rules.
 *
 * THE INTERACTION CONTRACT (shared with Three-Man Weave and 82-0; see
 * `docs/design/GAME_FEEL.md`):
 *
 *   1. NEWER WINS, OLDER IS DROPPED. `applyView` applies a response only if
 *      `isNewer` says so, so a poll issued before a command and landing after
 *      it cannot roll the board back.
 *   2. COMMANDS ARE SERIALIZED, NEVER DROPPED. Every command goes through one
 *      `useCommandLane`. A bid or pass is an exclusive kind: a second press
 *      while one is pending is refused before any handler runs, which is what
 *      "one click, one action" means at the transport layer. The idempotency
 *      key is DERIVED from the intent and the version current at execution.
 *   3. THE BOT'S REPLY IS READ WHEN IT IS DUE. The view publishes
 *      `bot_reply_in_seconds`; the room schedules one read for that instant
 *      (plus a short retry ladder) instead of a fixed 2000ms poll that landed
 *      the reply up to a whole interval late. Measured before this pass: the
 *      bot's move was visible 4-5s after every human action, of which the
 *      network was 40ms.
 *   4. NO CLIENT BEAT GATES A CONTROL. The previous room held the controls
 *      shut for a 1.1s "reveal" and a 0.7s "handoff" while the server clock
 *      ran. Both are gone; a new lot's card ENTERS and the SOLD moment plays
 *      over the stage while the controls are already live.
 *
 * WHY THIS POLLS. There is no realtime transport in this codebase; polling
 * the same authenticated route a refresh would hit reuses the whole projection
 * and permission model. The cadence is a function of whose turn it is.
 */

/** Ordinary cadence on the human's own turn — a safety net for timeouts and
 *  another tab's action, not the path a reply arrives by. */
const POLL_OWN_TURN_MS = 3000;
/** A human rival's turn: their action can land at any moment. */
const POLL_RIVAL_MS = 1000;
/** After the read the server said would carry the bot's move, if it did not
 *  (clock skew, a slow request), read again on this ladder. */
const BOT_RETRY_LADDER_MS = [250, 400, 700, 1000, 1500] as const;
/** Slack added to the server's `bot_reply_in_seconds`. */
const BOT_REPLY_SLACK_MS = 60;
/** A seatless beat (intro, unwinnable lot, forced fill): read when it ends. */
const SEATLESS_SLACK_MS = 90;
const SEATLESS_MAX_WAIT_MS = 1600;

/** Backoff for a failed FIRST read (see `load`). About three seconds in total. */
const FIRST_READ_RETRY_MS = [400, 800, 1600] as const;

/** How much a local deadline may drift from a freshly published one before a
 *  same-version poll is allowed to correct it (a suspended tab). */
const DRIFT_MS = 750;

interface Room {
  view: TwentyDollarMatchView;
  deadlineAt: number | null;
  turnDeadlineAt: number | null;
  moment: EventMomentData | null;
}

type Source = "load" | "poll" | "command";

function roomFrom(view: TwentyDollarMatchView, moment: EventMomentData | null): Room {
  return {
    view,
    deadlineAt: deadlineFromSeconds(view.seconds_remaining),
    turnDeadlineAt: deadlineFromSeconds(view.turn_seconds_remaining),
    moment,
  };
}

function driftExceeded(current: number | null, fresh: number | null): boolean {
  if (current === null || fresh === null) return current !== fresh;
  return Math.abs(current - fresh) > DRIFT_MS;
}

/**
 * The moment a transition announces, derived from the two snapshots in the
 * same render the new one lands. Only the OTHER seat's actions become a
 * moment: the player's own action is acknowledged by the control that sent
 * it, and a settled lot is announced by the SOLD reveal instead.
 */
export function describeTransition(
  prev: TwentyDollarMatchView,
  next: TwentyDollarMatchView,
): EventMomentData | null {
  const before = prev.public_state;
  const after = next.public_state;
  if (after.phase === "complete") return null;
  if (after.history.length !== before.history.length) return null; // the reveal owns it
  if (after.lot_index !== before.lot_index) return null;
  const actions = after.lot_actions;
  if (actions.length <= before.lot_actions.length || actions.length === 0) return null;
  const last = actions[actions.length - 1];
  const yours = last.seat_index === next.your_seat_index;
  if (yours) return null;
  const names = after.seat_names ?? next.seats.map((seat) => seat.display_name);
  const who = names[last.seat_index] ?? "Opponent";
  const id = `${after.lot_index}:${actions.length}`;
  if (last.action === "bid") {
    const raise = actions.filter((a) => a.action === "bid").length > 1;
    return {
      id,
      kind: raise ? "outbid" : "opened",
      title: raise ? `${who} raises to ${formatDollars(last.amount)}` : `${who} opens at ${formatDollars(last.amount)}`,
      detail: raise ? "You are outbid" : "Your move",
      tone: raise ? "negative" : "accent",
      durationMs: 1300,
    };
  }
  return {
    id,
    kind: "pass",
    title: last.timed_out ? `${who} ran out of time` : `${who} passes`,
    detail: last.consumed_skip ? "Market skip used" : undefined,
    tone: "neutral",
    durationMs: 1000,
  };
}

export default function TwentyDollarGame({ matchId }: { matchId: string }) {
  // KEYED BY MATCH ID: Play Again replaces the route with a fresh match and
  // nothing from this room survives into the next one.
  return <ShowdownRoom key={matchId} matchId={matchId} />;
}

function ShowdownRoom({ matchId }: { matchId: string }) {
  const router = useRouter();
  const [room, setRoom] = useState<Room | null>(null);
  const latest = useRef<Room | null>(null);
  const [error, setError] = useState<RejectionExplanation | null>(null);
  const [loadFailure, setLoadFailure] = useState<TwentyDollarAPIError | null>(null);
  const [inFlightAction, setInFlightAction] = useState<{ command: "bid" | "pass"; amount: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [locallyExpired, setLocallyExpired] = useState(false);
  const lane = useCommandLane();
  /** When the read that handed this seat the clock landed; reported once the
   *  room renders it actionable. See `lib/game-feel/action-timing`. */
  const handoffSince = useRef<number | null>(null);

  /** Apply an authoritative view, unless it is older than what is on screen. */
  const applyView = useCallback((next: TwentyDollarMatchView, source: Source): boolean => {
    const prev = latest.current;
    if (prev !== null) {
      const newer = isNewer(
        { version: prev.view.state_version, phase: prev.view.turn_phase },
        { version: next.state_version, phase: next.turn_phase },
      );
      if (!newer) {
        // A SAME-VERSION poll changes nothing -- except a clock that has
        // drifted far enough (a suspended tab) to be worth correcting. An
        // OLDER response corrects nothing at all: its clocks describe a turn
        // that is already over.
        if (next.state_version !== prev.view.state_version) return false;
        const fresh = deadlineFromSeconds(next.seconds_remaining);
        const freshTurn = deadlineFromSeconds(next.turn_seconds_remaining);
        if (driftExceeded(prev.deadlineAt, fresh) || driftExceeded(prev.turnDeadlineAt, freshTurn)) {
          const corrected = { ...prev, deadlineAt: fresh, turnDeadlineAt: freshTurn };
          latest.current = corrected;
          setRoom(corrected);
        }
        return false;
      }
    }
    const moment = prev && source !== "load" ? describeTransition(prev.view, next) : null;
    if (prev && source !== "command" && !prev.view.private_state.is_your_turn && next.private_state.is_your_turn) {
      handoffSince.current = typeof performance !== "undefined" ? performance.now() : null;
    }
    // THE PLAYER'S OWN PRESS SUPERSEDES WHATEVER WAS BEING ANNOUNCED. Carrying
    // the previous moment across a command left "Finisher opens at $1 · Your
    // move" on the news row for the whole of the bot's deliberation that
    // followed -- a line telling the player it was their move while the room
    // said the other bench was thinking.
    const nextRoom = roomFrom(next, moment ?? (source === "command" ? null : (prev?.moment ?? null)));
    latest.current = nextRoom;
    setRoom(nextRoom);
    setLocallyExpired(false);
    // ERRORS CLEAR ON AN AUTHORITATIVE TRANSITION. A rejection explains a
    // moment; once the board has moved past it the explanation is history.
    setError(null);
    return true;
  }, []);

  const firstReadAttempts = useRef(0);
  // Bumped after EVERY read completes, changed or not, so the polling effect
  // below re-arms. A read that changed nothing (the bot has not moved yet)
  // used to leave no timer behind and the room went quiet until something
  // else happened to re-render it -- measured once as a 97-second stall.
  const [pollEpoch, setPollEpoch] = useState(0);

  const load = useCallback(async () => {
    // Never race a command: its response is newer by construction and is
    // applied the instant it lands.
    if (lane.busyNow()) return;
    try {
      const next = await twentyDollarApi.getMatch(matchId);
      if (lane.busyNow()) return;
      applyView(next, latest.current ? "poll" : "load");
      setLoadFailure(null);
    } catch (err) {
      const apiError = err as TwentyDollarAPIError;
      if (!latest.current) {
        // THE FIRST READ RETRIES BEFORE IT GIVES UP. A freshly started server
        // and a session that has not finished hydrating can turn the very
        // first request into a 401/403 that a second request a moment later
        // would not produce, and a room that showed "not your seat" on that
        // one answer -- with no poll running yet to correct it -- stayed
        // there for good. A real 404 needs no retry.
        const attempt = firstReadAttempts.current;
        if (apiError.status !== 404 && attempt < FIRST_READ_RETRY_MS.length) {
          firstReadAttempts.current = attempt + 1;
          window.setTimeout(() => void loadRef.current(), FIRST_READ_RETRY_MS[attempt]);
          return;
        }
        setError(explainTransportError(apiError.status, apiError.code, apiError.message, "load"));
      }
      setLoadFailure((current) => current ?? apiError);
    } finally {
      setPollEpoch((n) => n + 1);
    }
  }, [matchId, applyView, lane]);

  // THE FIRST READ, once per room. Through the ref, so a re-render (the lane
  // publishing its pending state, an error) can never trigger a second read.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    // A match the lobby just started arrives with its view (see match-handoff):
    // mount on it now, and let the normal polling read from there.
    const handedOff = takeMatchView<TwentyDollarMatchView>(matchId);
    if (handedOff && !latest.current) {
      applyView(handedOff, "load");
      setPollEpoch((n) => n + 1);
      return;
    }
    void loadRef.current();
  }, [matchId, applyView]);

  const view = room?.view ?? null;
  const complete = view?.public_state?.phase === "complete";

  useEffect(() => {
    if (handoffSince.current === null || !view) return;
    if (!view.private_state.is_your_turn || view.turn_phase !== "auction") return;
    reportHandoff(view.mode, handoffSince.current);
    handoffSince.current = null;
  }, [view]);

  // -- polling: whose turn decides the cadence ---------------------------
  const timer = useRef<number | null>(null);
  const retryStep = useRef(0);
  const lastScheduledVersion = useRef(-1);

  const schedule = useCallback((delayMs: number) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void loadRef.current();
    }, Math.max(40, delayMs));
  }, []);

  useEffect(() => {
    if (!view || complete) return;
    if (view.state_version !== lastScheduledVersion.current) {
      lastScheduledVersion.current = view.state_version;
      retryStep.current = 0;
    }
    const seatless =
      view.public_state.active_seat === null || view.turn_phase === "intro" || view.turn_phase === "arrival";
    const botReply = view.bot_reply_in_seconds ?? null;
    let delay: number;
    if (seatless) {
      const left = view.turn_seconds_remaining ?? null;
      delay = left === null ? 600 : Math.min(SEATLESS_MAX_WAIT_MS, left * 1000 + SEATLESS_SLACK_MS);
      if (retryStep.current > 0) delay = BOT_RETRY_LADDER_MS[Math.min(retryStep.current - 1, BOT_RETRY_LADDER_MS.length - 1)];
    } else if (botReply !== null) {
      // THE READ THE SERVER SAID WOULD CARRY THE MOVE, then the ladder.
      delay =
        retryStep.current === 0
          ? botReply * 1000 + BOT_REPLY_SLACK_MS
          : BOT_RETRY_LADDER_MS[Math.min(retryStep.current - 1, BOT_RETRY_LADDER_MS.length - 1)];
    } else if (view.private_state.is_your_turn) {
      delay = POLL_OWN_TURN_MS;
    } else {
      delay = POLL_RIVAL_MS;
    }
    retryStep.current += 1;
    schedule(delay);
    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
    // `room` (not `view`) so a same-version drift correction re-arms too;
    // `pollEpoch` so an unchanged read re-arms as well.
  }, [room, view, complete, schedule, pollEpoch]);

  useEffect(() => {
    // A BACKGROUNDED TAB IS THROTTLED, so the first frame back is stale.
    const wake = () => {
      if (document.visibilityState === "visible") void loadRef.current();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, []);

  // -- commands ----------------------------------------------------------
  /**
   * Bid or pass. Returns true when the server ACCEPTED the action, false
   * when it was refused (a rejection, a transport failure) or when the lane
   * refused to run it (a duplicate press). The control that sent it reads
   * the answer for its confirmed / error beat.
   */
  const act = useCallback(
    async (command: "bid" | "pass", amount: number): Promise<boolean> => {
      const timer = startActionTimer("twenty_dollar", command);
      const result = await lane.run("act", async () => {
        const current = latest.current;
        if (!current || current.view.public_state.phase === "complete") return false;
        const snapshot = current.view;
        const attempt: AttemptedAction = {
          command,
          amount,
          lotIndex: snapshot.public_state.lot_index,
          standingBid: snapshot.public_state.current_bid,
          wouldSpendSkip: snapshot.private_state.pass_consumes_skip,
        };
        const payload = command === "bid" ? { amount } : {};
        const key = showdownIdempotencyKey(matchId, snapshot.your_seat_index, snapshot.state_version, command, payload);
        setInFlightAction({ command, amount });
        setError(null);
        setLocallyExpired(false);
        try {
          const response = await twentyDollarApi.submitCommand(matchId, command, payload, snapshot.state_version, key);
          timer.responded(serverTimingOf(response));
          applyView(response.match, "command");
          timer.settled(response.accepted || response.replayed ? "accepted" : "refused");
          if (!response.accepted) {
            setError(
              explainRejection(
                response.rejection_code,
                response.message,
                attempt,
                response.match.public_state,
                response.match.public_state.seat_names ?? response.match.seats.map((seat) => seat.display_name),
                response.match.your_seat_index,
              ),
            );
            return false;
          }
          return true;
        } catch (err) {
          const apiError = err as TwentyDollarAPIError;
          timer.settled("failed");
          setError(explainTransportError(apiError.status, apiError.code, apiError.message, command));
          return false;
        } finally {
          setInFlightAction(null);
        }
      });
      return result === true;
    },
    [matchId, lane, applyView],
  );

  /** Concede. Server-resolved, like every other move. (The intro has no
   *  skip any more: it is a shared timeline that ends on its own clock.) */
  const sendLifecycle = useCallback(
    async (command: "showdown_forfeit"): Promise<boolean> => {
      const timer = startActionTimer("twenty_dollar", "forfeit");
      const result = await lane.run(command, async () => {
        const current = latest.current;
        if (!current) return false;
        const snapshot = current.view;
        try {
          const response = await twentyDollarApi.submitCommand(
            matchId,
            command,
            {},
            snapshot.state_version,
            showdownIdempotencyKey(matchId, snapshot.your_seat_index, snapshot.state_version, command, {}),
          );
          timer.responded(serverTimingOf(response));
          applyView(response.match, "command");
          timer.settled(response.accepted || response.replayed ? "accepted" : "refused");
          if (!response.accepted && command === "showdown_forfeit") {
            setError(explainTransportError(409, response.rejection_code ?? null, response.message ?? "", "load"));
            return false;
          }
          return true;
        } catch (err) {
          const apiError = err as TwentyDollarAPIError;
          if (command === "showdown_forfeit") {
            setError(explainTransportError(apiError.status, apiError.code, apiError.message, "load"));
          }
          return false;
        }
      });
      return result === true;
    },
    [matchId, lane, applyView],
  );

  /**
   * ARRIVAL: TELL THE SERVER THE INTRO IS ON THIS SCREEN. Its clock starts
   * when both bidders have (a bot is already there), never at match creation.
   * Sent once after the intro rendered; re-armed only if it did not land.
   */
  const arrivalSent = useRef(false);
  const mayReportArrival =
    view?.turn_phase === "arrival" && (view?.legal_commands ?? []).includes(SHOWDOWN_COMMAND_INTRO_SEEN);
  useEffect(() => {
    if (!mayReportArrival || arrivalSent.current) return;
    arrivalSent.current = true;
    void lane
      .run(
        "intro_seen",
        async () => {
          const current = latest.current;
          if (!current) return false;
          const snapshot = current.view;
          const timer = startActionTimer("twenty_dollar", "intro_seen");
          const response = await twentyDollarApi.submitCommand(
            matchId,
            SHOWDOWN_COMMAND_INTRO_SEEN,
            {},
            snapshot.state_version,
            showdownIdempotencyKey(matchId, snapshot.your_seat_index, snapshot.state_version, SHOWDOWN_COMMAND_INTRO_SEEN, {}),
          );
          timer.responded(serverTimingOf(response));
          applyView(response.match, "command");
          timer.settled(response.accepted || response.replayed ? "accepted" : "refused");
          return response.accepted || response.replayed;
        },
        { exclusive: false },
      )
      .then((ok) => {
        if (!ok) arrivalSent.current = false;
      })
      .catch(() => {
        arrivalSent.current = false;
      });
  }, [mayReportArrival, lane, matchId, applyView]);

  const hasBots = view?.seats.some((seat) => seat.is_bot) ?? false;

  /**
   * PLAY AGAIN: against bots, a fresh practice match is created and the route
   * is REPLACED with its id, so the loader mounts a brand-new room. A human
   * table has no rematch primitive yet, so it returns to the lobby with this
   * game preselected.
   */
  const playAgain = useCallback(async (): Promise<boolean> => {
    const result = await lane.run("replay", async () => {
      if (hasBots) {
        const created = await twentyDollarApi.startPractice();
        // The rematch's room mounts on this authoritative view (see match-handoff).
        primeMatchView(created);
        router.replace(`/arena/twenty-dollar/${created.match_id}`);
        return true;
      }
      router.push("/arena/lobby?game=twenty_dollar");
      return true;
    });
    return result === true;
  }, [hasBots, lane, router]);

  const dismissMoment = useCallback((id: string) => {
    const current = latest.current;
    if (!current || current.moment?.id !== id) return;
    const next = { ...current, moment: null };
    latest.current = next;
    setRoom(next);
  }, []);

  const meta = modeMeta("twenty_dollar");

  // ---- gates -------------------------------------------------------------

  if (loadFailure && !view) {
    const notYours = loadFailure.status === 403;
    return (
      <PeakV2Shell width="live">
        <div
          className="pk-depth pk-crown mx-auto my-16 flex max-w-xl flex-col items-start gap-3 rounded-2xl p-8"
          role="alert"
          data-testid="td-match-error"
          style={{ border: "1px solid var(--v2-border-subtle)" }}
        >
          <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ fontFamily: "var(--v2-font-mono)", color: "var(--v2-text-muted)" }}>
            {notYours ? "Not your seat" : "Match not found"}
          </p>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--v2-font-display)", color: "var(--v2-text-primary)" }}>
            {notYours ? "This auction belongs to someone else" : "We could not find that auction"}
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: "var(--v2-text-secondary)" }}>
            {notYours
              ? "Only the two bidders seated in a match can open it. If a friend sent you a room code, join from the multiplayer lobby instead."
              : "That match id does not resolve. Matches expire after two hours, so a link copied from an old session may have outlived its game."}
          </p>
          <div className="flex flex-wrap gap-2.5">
            <PeakV2PrimaryAction href="/arena/lobby">Back to multiplayer</PeakV2PrimaryAction>
            <PeakV2SecondaryAction href="/arena">Every PEAK3 game</PeakV2SecondaryAction>
          </div>
        </div>
      </PeakV2Shell>
    );
  }

  if (!view || !room) {
    return (
      <PeakV2Shell width="live">
        <div className="py-9">
          <p role="status" className="text-sm" style={{ color: "var(--v2-text-secondary)" }}>
            Loading the auction…
          </p>
        </div>
      </PeakV2Shell>
    );
  }

  return (
    <AuctionRoom
      room={room}
      meta={meta}
      error={error}
      pendingKind={lane.pending}
      inFlightAction={inFlightAction}
      locallyExpired={locallyExpired}
      copied={copied}
      onExpire={() => {
        setLocallyExpired(true);
        // The server settles an expired turn on its next read; ask for it just
        // past the action-grace window instead of waiting out the own-turn
        // cadence.
        window.setTimeout(() => void loadRef.current(), 450);
      }}
      onDismissError={() => setError(null)}
      onDismissMoment={dismissMoment}
      onAct={act}
      onForfeit={() => sendLifecycle("showdown_forfeit")}
      onCopy={setCopied}
      onPlayAgain={playAgain}
    />
  );
}

/**
 * The room itself, split out so the ledger and the phase machine can key off a
 * state that is guaranteed to exist. Hooks cannot run behind the loading gates
 * above.
 */
function AuctionRoom({
  room,
  meta,
  error,
  pendingKind,
  inFlightAction,
  locallyExpired,
  copied,
  onExpire,
  onDismissError,
  onDismissMoment,
  onAct,
  onForfeit,
  onCopy,
  onPlayAgain,
}: {
  room: Room;
  meta: ReturnType<typeof modeMeta>;
  error: RejectionExplanation | null;
  pendingKind: string | null;
  inFlightAction: { command: "bid" | "pass"; amount: number } | null;
  locallyExpired: boolean;
  copied: boolean;
  onExpire: () => void;
  onDismissError: () => void;
  onDismissMoment: (id: string) => void;
  onAct: (command: "bid" | "pass", amount: number) => Promise<boolean>;
  onForfeit: () => Promise<boolean>;
  onCopy: (value: boolean) => void;
  onPlayAgain: () => Promise<boolean>;
}) {
  const { view, deadlineAt, turnDeadlineAt, moment } = room;
  const publicState = view.public_state;
  const privateState = view.private_state;
  const yourSeat = view.your_seat_index;
  const complete = publicState.phase === "complete";
  const seatNames = useMemo(
    () => publicState.seat_names ?? view.seats.map((s) => s.display_name),
    [publicState.seat_names, view.seats],
  );
  const receipt = publicState.receipt as TwentyDollarReceiptData | undefined;

  const { recap, reveal, queued, acknowledgeRecap } = useLotLedger(view.match_id, publicState);

  const actPending = pendingKind === "act";
  const { phase, clockDeadlineAt, controlsLive } = useShowdownPhase({
    activeSeat: publicState.active_seat,
    yourSeat,
    deadlineAt,
    pending: actPending,
    complete,
    introOpen: view.turn_phase === "intro" || view.turn_phase === "arrival",
  });

  const yourTurn = privateState.is_your_turn && !complete;
  const opponentSeats = useMemo(
    () => publicState.seats.filter((seat) => seat.seat_index !== yourSeat),
    [publicState.seats, yourSeat],
  );
  const yourSeatPublic = publicState.seats[yourSeat ?? 0];
  const opponentIndex = opponentSeats[0]?.seat_index ?? 1;
  const opponentName = seatNames[opponentIndex] ?? BOT_DISPLAY_NAME;
  const opponentIsBot = view.seats.find((seat) => seat.seat_index === opponentIndex)?.is_bot ?? false;

  if (complete && receipt) {
    const onCopyResult = () => {
      void navigator.clipboard?.writeText(buildShowdownShareText(receipt, yourSeat)).then(() => onCopy(true));
    };
    return (
      <div data-testid="td-game" data-phase="complete">
        <PeakV2ShowdownResult
          receipt={receipt}
          publicState={publicState}
          seatNames={seatNames}
          yourSeat={yourSeat}
          onPlayAgain={onPlayAgain}
          playAgainPending={pendingKind === "replay"}
          onCopy={onCopyResult}
          copied={copied}
        />
      </div>
    );
  }

  return (
    <>
      <PeakV2ShowdownLive
        view={view}
        seatNames={seatNames}
        yourSeat={yourSeat}
        opponentIsBot={opponentIsBot}
        phase={phase}
        clockDeadlineAt={clockDeadlineAt}
        turnDeadlineAt={turnDeadlineAt}
        controlsLive={controlsLive}
        pending={actPending}
        inFlightAction={inFlightAction}
        locallyExpired={locallyExpired}
        consequence={yourTurn ? timeoutConsequence(privateState, seatNames, publicState) : null}
        reveal={reveal}
        queued={queued}
        recap={recap}
        moment={moment}
        onDismissMoment={onDismissMoment}
        onAcknowledgeRecap={acknowledgeRecap}
        error={error}
        onExpire={onExpire}
        onDismissError={onDismissError}
        onAct={onAct}
        helpControl={meta ? <HowToPlay title={meta.name} rules={meta.rules} testId="td-rules" /> : null}
        forfeitControl={<ForfeitControl onConfirm={onForfeit} busy={pendingKind === "showdown_forfeit"} />}
      />
      {phase === "intro" ? (
        <PeakV2ShowdownIntro
          opponentName={opponentName}
          startingBudget={yourSeatPublic?.budget ?? 20}
          slots={publicState.slots.length}
          marketSkips={publicState.market_skips_per_seat}
          rated={view.rated}
          arriving={view.turn_phase === "arrival"}
          elapsedSeconds={view.turn_phase === "arrival" ? null : (view.turn_elapsed_seconds ?? null)}
          totalSeconds={view.turn_phase === "arrival" ? null : (view.turn_total_seconds ?? null)}
          turnSeq={view.turn_seq ?? null}
        />
      ) : null}
    </>
  );
}

/**
 * FORFEIT MATCH — a secondary control that takes two deliberate actions.
 * It ends the match with a loss and cannot be undone; the first press only
 * reveals the confirmation, the destructive choice is never the one under the
 * cursor, and Escape backs out. Not a `window.confirm`: that is unstyleable,
 * unannounceable, and blocks the poll.
 */
function ForfeitControl({ onConfirm, busy }: { onConfirm: () => Promise<boolean>; busy: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);

  useEffect(() => {
    if (!confirming) return;
    cancelRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setConfirming(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming]);

  if (!confirming) {
    return (
      <PeakV2SecondaryAction type="button" size="sm" data-testid="td-forfeit" onClick={() => setConfirming(true)}>
        Forfeit match
      </PeakV2SecondaryAction>
    );
  }

  return (
    <div className="td-forfeit-confirm" data-testid="td-forfeit-confirm" role="group" aria-label="Confirm forfeit">
      <p className="td-forfeit-question">Concede this match?</p>
      <PeakV2SecondaryAction type="button" size="sm" ref={cancelRef} data-testid="td-forfeit-cancel" onClick={() => setConfirming(false)}>
        Keep playing
      </PeakV2SecondaryAction>
      <PeakV2SecondaryAction
        type="button"
        size="sm"
        data-testid="td-forfeit-confirm-button"
        disabled={busy}
        onClick={() => void onConfirm()}
        style={{ color: "var(--v2-color-negative)", borderColor: "var(--v2-color-negative)" }}
      >
        {busy ? "Conceding…" : "Forfeit"}
      </PeakV2SecondaryAction>
    </div>
  );
}
